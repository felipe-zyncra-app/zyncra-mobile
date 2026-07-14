import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendExpoPush(token: string, title: string, body: string) {
  const res = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Accept-Encoding": "gzip, deflate",
    },
    body: JSON.stringify({
      to: token,
      title,
      body,
      sound: "default",
      priority: "high",
      channelId: "reminders",
    }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && data?.data?.status !== "error", data };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });

    const callerClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });

    const { data: tenant } = await adminClient
      .from("tenants").select("id, push_token").eq("owner_id", caller.id).single();
    if (!tenant) return new Response(JSON.stringify({ error: "Not an owner" }), { status: 403, headers: corsHeaders });
    if (!tenant.push_token) {
      return new Response(JSON.stringify({ error: "No hay un dispositivo registrado para este negocio" }), { status: 400, headers: corsHeaders });
    }

    const body = await req.json().catch(() => ({}));

    // ── Batch mode: staggered sequence of notifications, delivered server-side ──
    // so it keeps firing even if the phone's screen is off / app is backgrounded.
    if (Array.isArray(body.messages) && body.messages.length > 0) {
      const messages = body.messages
        .slice(0, 10)
        .map((m: any) => ({
          title: (m.title ?? "Zyncra").toString().slice(0, 120),
          body: (m.body ?? "").toString().slice(0, 400),
          delayMs: Math.max(0, Math.min(Number(m.delayMs) || 0, 120_000)),
        }))
        .filter((m: any) => m.body);

      if (!messages.length) {
        return new Response(JSON.stringify({ error: "Faltan mensajes" }), { status: 400, headers: corsHeaders });
      }

      const pushToken = tenant.push_token as string;
      const runSequence = async () => {
        for (const m of messages) {
          await sleep(m.delayMs);
          await sendExpoPush(pushToken, m.title, m.body);
        }
      };

      // @ts-ignore EdgeRuntime is a Supabase/Deno Deploy global for background tasks
      EdgeRuntime.waitUntil(runSequence());

      return new Response(JSON.stringify({ ok: true, scheduled: messages.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Single immediate push ──
    const title = (body.title ?? "Zyncra").toString().slice(0, 120);
    const message = (body.body ?? "").toString().slice(0, 400);
    if (!message) {
      return new Response(JSON.stringify({ error: "Falta el mensaje" }), { status: 400, headers: corsHeaders });
    }

    const { ok, data: expoData } = await sendExpoPush(tenant.push_token, title, message);
    if (!ok) {
      return new Response(JSON.stringify({ error: expoData?.data?.message ?? "Expo push API error", expo: expoData }), { status: 502, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ ok: true, ticket: expoData?.data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders });
  }
});
