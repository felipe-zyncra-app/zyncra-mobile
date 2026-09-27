/**
 * Utilidades puras de la bandeja de WhatsApp, las campañas y las reseñas.
 * Sin React ni Supabase para poder probarlas (lib/__tests__/mensajeria-test.ts).
 */

// ─── Bandeja ─────────────────────────────────────────────────────────────────

export type EstadoMensaje = "sending" | "sent" | "delivered" | "read" | "failed";

export type MensajeChat = {
  id: string;
  phone: string;
  direction: "in" | "out";
  sender: "client" | "hanna" | "human";
  body: string;
  created_at: string;
  /** Estado de entrega que informa Meta (webhook). null en mensajes viejos. */
  status?: EstadoMensaje | null;
  /** Motivo cuando Meta no entregó el mensaje (status = failed). */
  error?: string | null;
  sender_name?: string | null;
};

/** Columnas que pide la app (mismas que el panel web, sin client_msg_id). */
export const COLUMNAS_MENSAJE = "id,phone,direction,sender,body,created_at,status,error,sender_name";

export type ChatResumen = {
  tenant_id: string;
  phone: string;
  client_name: string | null;
  bot_paused: boolean;
  unread: number;
  last_message_at: string;
  last_message_preview: string | null;
};

/** Sin pending_batch/batch_token/locked_until: son internos del webhook. */
export const COLUMNAS_CHAT = "tenant_id,phone,client_name,bot_paused,unread,last_message_at,last_message_preview";

/** Ventana de 24 h de Meta para responder texto libre. */
export const VENTANA_MS = 24 * 60 * 60 * 1000;

function porFechaAsc(a: MensajeChat, b: MensajeChat): number {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Une mensajes nuevos (sondeo, Realtime o respuesta del envío) con los que ya
 * hay, sin duplicar: el mismo id se reemplaza (p. ej. cuando llega el estado
 * "delivered"). Resultado en orden cronológico ascendente.
 */
export function fusionarMensajes(previos: MensajeChat[], nuevos: MensajeChat[]): MensajeChat[] {
  if (nuevos.length === 0) return previos;
  const mapa = new Map<string, MensajeChat>();
  for (const m of previos) mapa.set(m.id, m);
  for (const m of nuevos) {
    const viejo = mapa.get(m.id);
    mapa.set(m.id, viejo ? { ...viejo, ...m } : m);
  }
  return Array.from(mapa.values()).sort(porFechaAsc);
}

/** created_at del último mensaje confirmado (desde donde pedir lo nuevo). */
export function ultimoConfirmado(mensajes: MensajeChat[]): string | null {
  for (let i = mensajes.length - 1; i >= 0; i--) {
    const s = mensajes[i].status;
    if (s !== "sending" && s !== "failed") return mensajes[i].created_at;
  }
  return null;
}

/** El más reciente de dos instantes ISO (cualquiera puede faltar). */
export function masReciente(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

/** true si el último mensaje DEL CLIENTE tiene menos de 24 h. */
export function ventanaAbierta(ultimoEntrante: string | null | undefined, ahora: number = Date.now()): boolean {
  if (!ultimoEntrante) return false;
  const t = new Date(ultimoEntrante).getTime();
  return Number.isFinite(t) && ahora - t < VENTANA_MS;
}

/** Une chats por teléfono y los deja del más reciente al más viejo. */
export function fusionarChats(previos: ChatResumen[], nuevos: ChatResumen[]): ChatResumen[] {
  if (nuevos.length === 0) return previos;
  const mapa = new Map<string, ChatResumen>();
  for (const c of previos) mapa.set(c.phone, c);
  for (const c of nuevos) mapa.set(c.phone, { ...(mapa.get(c.phone) ?? {}), ...c });
  return Array.from(mapa.values()).sort((a, b) =>
    a.last_message_at === b.last_message_at ? a.phone.localeCompare(b.phone) : b.last_message_at.localeCompare(a.last_message_at),
  );
}

// ─── Búsqueda en el servidor ─────────────────────────────────────────────────

/**
 * Texto seguro para meter en un filtro `.or()` de PostgREST: sin comas,
 * paréntesis, comillas ni comodines, que romperían la sintaxis o cambiarían
 * el sentido del filtro. null si no queda nada que buscar.
 */
export function textoBusqueda(q: string, minimo = 2): string | null {
  const limpio = q.replace(/[,()"'\\*%:;]/g, " ").replace(/\s+/g, " ").trim();
  return limpio.length >= minimo ? limpio.slice(0, 60) : null;
}

/**
 * Filtro `.or()` para buscar por nombre y por teléfono. Los teléfonos se
 * guardan como dígitos con indicativo, así que por teléfono se busca solo con
 * los dígitos que escribió el usuario (si escribió al menos 3).
 */
export function filtroNombreTelefono(q: string, colNombre = "name", colTelefono = "phone"): string | null {
  const t = textoBusqueda(q);
  if (!t) return null;
  const digitos = t.replace(/\D/g, "");
  const partes = [`${colNombre}.ilike.%${t}%`];
  if (digitos.length >= 3) partes.push(`${colTelefono}.ilike.%${digitos}%`);
  return partes.join(",");
}

// ─── Campañas ────────────────────────────────────────────────────────────────

export type SegmentoClientes = "all" | "active" | "inactive";

/** Reemplaza {{nombre}} y {{negocio}} (las variables que ofrece la pantalla). */
export function reemplazarVariables(plantilla: string, valores: { nombre?: string; negocio?: string; link?: string }): string {
  // Con función y no con string: en un string de reemplazo "$&", "$1" o "$$"
  // son patrones, y un nombre o un link con "$" salía cambiado.
  const { nombre, negocio, link } = valores;
  let out = plantilla;
  if (nombre !== undefined) out = out.replace(/\{\{\s*nombre\s*\}\}/g, () => nombre);
  if (negocio !== undefined) out = out.replace(/\{\{\s*negocio\s*\}\}/g, () => negocio);
  if (link !== undefined) out = out.replace(/\{\{\s*link\s*\}\}/g, () => link);
  return out;
}

/** Clientes de un segmento, según los ids con cita reciente. */
export function filtrarSegmento<T extends { id: string }>(clientes: T[], activos: ReadonlySet<string>, segmento: SegmentoClientes): T[] {
  if (segmento === "all") return clientes;
  if (segmento === "active") return clientes.filter(c => activos.has(c.id));
  return clientes.filter(c => !activos.has(c.id));
}

/**
 * Quita teléfonos repetidos (dos fichas del mismo cliente recibirían el
 * mensaje dos veces). `clave` devuelve el teléfono normalizado o null si no es
 * válido; los inválidos se conservan todos para que el dueño los vea.
 */
export function sinTelefonosRepetidos<T>(lista: T[], clave: (x: T) => string | null): T[] {
  const vistos = new Set<string>();
  const out: T[] = [];
  for (const x of lista) {
    const k = clave(x);
    if (k) {
      if (vistos.has(k)) continue;
      vistos.add(k);
    }
    out.push(x);
  }
  return out;
}
