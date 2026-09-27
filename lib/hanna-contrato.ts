/**
 * Contrato con el portal web para Hanna (campañas y copiloto).
 *
 * La app publicada no se actualiza al ritmo del web: cuando el web cambió
 * /api/admin/hanna-campaigns de `mensaje` a `contenidos[]` multicanal
 * (commit d88aee6), las tarjetas salieron vacías y "Guardar como plantilla"
 * chocaba con el NOT NULL de wa_templates.message (COM-01). Aquí se lee la
 * respuesta de forma tolerante (formato viejo y nuevo) y se descarta lo que
 * no sirve, en vez de pintar undefined.
 *
 * Fuente de verdad: ../ZyncraSas_v1/src/app/api/admin/hanna-campaigns/route.ts
 * y ../ZyncraSas_v1/src/app/api/admin/hanna-chat/route.ts.
 */

// ─── Campañas ────────────────────────────────────────────────────────────────

export type CanalCampana = "whatsapp" | "instagram" | "facebook" | "email";
export type SegmentoCampana = "all" | "active" | "inactive";

/** Lo que devuelve el web por canal (ver ChannelContent en el route). */
export type ContenidoCanal = {
  canal: CanalCampana;
  texto: string;
  asunto?: string;
  hashtags?: string[];
};

/** Borrador ya listo para la app: solo el texto de WhatsApp. */
export type BorradorCampana = {
  tipo: string;
  nombre: string;
  segmento: SegmentoCampana;
  razon: string;
  /** Texto para WhatsApp, con {{nombre}} y {{negocio}}. Nunca vacío. */
  mensaje: string;
};

/** Cuerpo del POST: la app solo usa WhatsApp; pedir los 4 canales tarda más y gasta cuota. */
export function cuerpoGenerarCampanas(brief?: string | null): { channels: CanalCampana[]; brief?: string } {
  const b = (brief ?? "").trim().slice(0, 300);
  return b ? { channels: ["whatsapp"], brief: b } : { channels: ["whatsapp"] };
}

const SEGMENTOS: SegmentoCampana[] = ["all", "active", "inactive"];

function texto(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/**
 * Convierte `json.campanas` (formato nuevo con `contenidos[]` o viejo con
 * `mensaje`) en borradores con texto de WhatsApp. Los que no traen texto se
 * descartan: sin texto no hay nada que mostrar ni que guardar.
 */
export function normalizarCampanas(json: unknown): BorradorCampana[] {
  const lista = (json as { campanas?: unknown } | null)?.campanas;
  if (!Array.isArray(lista)) return [];
  const out: BorradorCampana[] = [];
  for (const raw of lista) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as Record<string, unknown>;
    const nombre = texto(c.nombre, 80);
    if (!nombre) continue;
    const contenidos = Array.isArray(c.contenidos) ? (c.contenidos as unknown[]) : [];
    const deWhatsapp = contenidos.find(
      (x): x is ContenidoCanal => !!x && typeof x === "object" && (x as ContenidoCanal).canal === "whatsapp",
    );
    // wa_templates.message y el wa.me aceptan textos largos, pero el web ya
    // corta en 700: se respeta ese tope.
    const mensaje = texto(deWhatsapp?.texto, 700) || texto(c.mensaje, 700);
    if (!mensaje) continue;
    const segmento = SEGMENTOS.includes(c.segmento as SegmentoCampana) ? (c.segmento as SegmentoCampana) : "all";
    out.push({
      tipo: texto(c.tipo, 20) || "personalizada",
      nombre,
      segmento,
      razon: texto(c.razon, 200),
      mensaje,
    });
  }
  return out;
}

// ─── Copiloto (hanna-chat) ───────────────────────────────────────────────────

/**
 * Acción destructiva que el servidor NO ejecutó y espera que el dueño apruebe
 * (cancelar una cita, editar o borrar un servicio). Se confirma con
 * POST { confirm: { tool, args }, locationId }.
 */
export type AccionPendiente = {
  tool: string;
  args: Record<string, unknown>;
  summary: string;
};

export function leerAccionPendiente(json: unknown): AccionPendiente | null {
  const p = (json as { pendingAction?: unknown } | null)?.pendingAction;
  if (!p || typeof p !== "object") return null;
  const a = p as Record<string, unknown>;
  if (typeof a.tool !== "string" || !a.tool) return null;
  const args = a.args && typeof a.args === "object" && !Array.isArray(a.args) ? (a.args as Record<string, unknown>) : {};
  const summary = typeof a.summary === "string" && a.summary.trim() ? a.summary.trim() : "Hanna quiere hacer un cambio en tu negocio.";
  return { tool: a.tool, args, summary };
}
