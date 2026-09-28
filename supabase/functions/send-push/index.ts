import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * send-push: manda una notificación al teléfono registrado del negocio del
 * que llama (tenants.push_token).
 *
 * Hoy ni la app ni el portal la invocan (el portal envía directo a Expo en
 * src/lib/push.ts), pero está desplegada con verify_jwt, así que se deja
 * cerrada (SEG-17, COM-25):
 *   · solo el DUEÑO del negocio, y solo a SU propio token;
 *   · con varios negocios por dueño hay que decir cuál (tenant_id);
 *   · lotes cortos: la suma de esperas no pasa de 50 s (antes 10 × 120 s =
 *     20 min, más que el límite de ejecución: los últimos se perdían);
 *   · límite de frecuencia por negocio;
 *   · CORS solo para el portal (la app nativa no manda Origin);
 *   · errores genéricos hacia afuera, el detalle va al log.
 */

const ORIGENES_PERMITIDOS = new Set(["https://www.zyncra.app", "https://zyncra.app"]);
const MAX_MENSAJES = 5;
const MAX_ESPERA_MS = 30_000;
const MAX_ESPERA_TOTAL_MS = 50_000;
const LIMITE_POR_MINUTO = 10;
const TOPE_EXPO_MS = 10_000;
const TOKEN_EXPO = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cabecerasCors(req: Request): Record<string, string> {
  const h: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  const origen = req.headers.get("Origin");
  if (origen && ORIGENES_PERMITIDOS.has(origen)) h["Access-Control-Allow-Origin"] = origen;
  return h;
}

function responder(body: unknown, status: number, cabeceras: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cabeceras, "Content-Type": "application/json" },
  });
}

function texto(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function dormir(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Límite de frecuencia en memoria, por negocio. Es por instancia (no global),
// pero corta las ráfagas, que es lo que importa aquí.
const ventanas = new Map<string, number[]>();
function dentroDelLimite(clave: string): boolean {
  const ahora = Date.now();
  const recientes = (ventanas.get(clave) ?? []).filter((t) => ahora - t < 60_000);
  if (recientes.length >= LIMITE_POR_MINUTO) {
    ventanas.set(clave, recientes);
    return false;
  }
  recientes.push(ahora);
  ventanas.set(clave, recientes);
  if (ventanas.size > 5_000) ventanas.clear(); // tope de memoria
  return true;
}

type ResultadoExpo = { ok: boolean; ticketId: string | null; error: string | null };

async function enviarAExpo(token: string, title: string, body: string): Promise<ResultadoExpo> {
  try {
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Accept-Encoding": "gzip, deflate",
      },
      body: JSON.stringify({ to: token, title, body, sound: "default", priority: "high", channelId: "reminders" }),
      signal: AbortSignal.timeout(TOPE_EXPO_MS),
    });
    const data = await res.json().catch(() => ({}));
    const ticket = data?.data;
    if (!res.ok || ticket?.status === "error") {
      return { ok: false, ticketId: null, error: String(ticket?.details?.error ?? ticket?.message ?? `HTTP ${res.status}`) };
    }
    return { ok: true, ticketId: typeof ticket?.id === "string" ? ticket.id : null, error: null };
  } catch (e) {
    return { ok: false, ticketId: null, error: e instanceof Error ? e.name : "fetch" };
  }
}

Deno.serve(async (req: Request) => {
  const cors = cabecerasCors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return responder({ error: "Método no permitido" }, 405, cors);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) {
      console.error("send-push: faltan variables de entorno");
      return responder({ error: "Error interno" }, 500, cors);
    }

    // ── Autenticación ──────────────────────────────────────────────────────
    const auth = req.headers.get("Authorization") ?? "";
    const jwt = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!jwt) return responder({ error: "No autorizado" }, 401, cors);

    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: userData, error: authError } = await admin.auth.getUser(jwt);
    const caller = userData?.user;
    if (authError || !caller) return responder({ error: "No autorizado" }, 401, cors);

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return responder({ error: "Cuerpo inválido" }, 400, cors);
    }

    // ── Autorización: solo el dueño y solo a SU token ──────────────────────
    const tenantPedido = typeof body.tenant_id === "string" ? body.tenant_id : null;
    if (tenantPedido !== null && !UUID.test(tenantPedido)) return responder({ error: "tenant_id inválido" }, 400, cors);
    let consulta = admin.from("tenants").select("id, push_token").eq("owner_id", caller.id);
    if (tenantPedido) consulta = consulta.eq("id", tenantPedido);
    const { data: negocios, error: tenantError } = await consulta.limit(2);
    if (tenantError) {
      console.error("send-push: error leyendo tenants", tenantError.message);
      return responder({ error: "Error interno" }, 500, cors);
    }
    if (!negocios || negocios.length === 0) return responder({ error: "No eres dueño de este negocio" }, 403, cors);
    // .single() respondía "Not an owner" a quien tenía dos negocios.
    if (negocios.length > 1) return responder({ error: "Tienes más de un negocio: indica tenant_id" }, 400, cors);
    const tenant = negocios[0] as { id: string; push_token: string | null };

    if (!dentroDelLimite(tenant.id)) {
      return responder({ error: "Demasiadas solicitudes. Espera un minuto." }, 429, { ...cors, "Retry-After": "60" });
    }

    const token = typeof tenant.push_token === "string" ? tenant.push_token : "";
    if (!TOKEN_EXPO.test(token)) {
      return responder({ error: "No hay un dispositivo registrado para este negocio" }, 400, cors);
    }

    // Expo avisa cuando el token ya no existe (app desinstalada): se borra
    // para no seguir intentando. Solo si sigue siendo el mismo token.
    const limpiarSiNoExiste = async (r: ResultadoExpo) => {
      if (r.error === "DeviceNotRegistered") {
        await admin.from("tenants").update({ push_token: null }).eq("id", tenant.id).eq("push_token", token);
      }
    };

    // ── Lote: secuencia corta con esperas, entregada desde el servidor ─────
    if (body.messages !== undefined) {
      if (!Array.isArray(body.messages) || body.messages.length === 0) {
        return responder({ error: "Faltan mensajes" }, 400, cors);
      }
      if (body.messages.length > MAX_MENSAJES) {
        return responder({ error: `Máximo ${MAX_MENSAJES} mensajes por lote` }, 400, cors);
      }
      const mensajes: { title: string; body: string; delayMs: number }[] = [];
      let esperaTotal = 0;
      for (const m of body.messages) {
        const cuerpo = texto(m?.body, 400);
        if (!cuerpo) return responder({ error: "Cada mensaje necesita texto" }, 400, cors);
        const espera = Math.max(0, Math.min(Number(m?.delayMs) || 0, MAX_ESPERA_MS));
        esperaTotal += espera;
        if (esperaTotal > MAX_ESPERA_TOTAL_MS) {
          return responder({ error: "La secuencia es demasiado larga" }, 400, cors);
        }
        mensajes.push({ title: texto(m?.title, 120) || "Zyncra", body: cuerpo, delayMs: espera });
      }

      const secuencia = async () => {
        for (const m of mensajes) {
          await dormir(m.delayMs);
          const r = await enviarAExpo(token, m.title, m.body);
          if (!r.ok) {
            console.error("send-push: Expo rechazó un mensaje del lote", { tenant: tenant.id, error: r.error });
            await limpiarSiNoExiste(r);
            if (r.error === "DeviceNotRegistered") return;
          }
        }
      };
      // @ts-ignore EdgeRuntime es un global de Supabase Edge para tareas en segundo plano
      EdgeRuntime.waitUntil(secuencia());
      return responder({ ok: true, scheduled: mensajes.length }, 200, cors);
    }

    // ── Envío único ────────────────────────────────────────────────────────
    const title = texto(body.title, 120) || "Zyncra";
    const mensaje = texto(body.body, 400);
    if (!mensaje) return responder({ error: "Falta el mensaje" }, 400, cors);

    const r = await enviarAExpo(token, title, mensaje);
    if (!r.ok) {
      console.error("send-push: Expo rechazó el envío", { tenant: tenant.id, error: r.error });
      await limpiarSiNoExiste(r);
      return responder({ error: "No se pudo enviar la notificación" }, 502, cors);
    }
    return responder({ ok: true, ticket: r.ticketId }, 200, cors);
  } catch (e) {
    console.error("send-push: error inesperado", e instanceof Error ? e.message : e);
    return responder({ error: "Error interno" }, 500, cors);
  }
});
