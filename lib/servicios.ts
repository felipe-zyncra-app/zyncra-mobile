/**
 * Reglas de los servicios del catálogo (Ajustes → Servicios).
 *
 * Existen porque el móvil y el web escribían la misma fila de formas
 * distintas:
 *  · tags: el móvil guardaba strings (["corte"]) y el web {name, color}. El
 *    POS web se caía al buscar (t.name de un string) y el móvil se caía al
 *    pintar un objeto dentro de <Text> (ESQ-06). Además mandaba null, y la
 *    columna es NOT NULL: guardar un servicio sin etiquetas fallaba (ESQ-10).
 *  · duración: el móvil editaba duration_min y la agenda, la reserva y el web
 *    leen duration_minutes (AJU-04 / CAL-03 / ESQ-11).
 *  · precio: "25.000" se guardaba como 25 (AJU-12).
 */

export type EtiquetaServicio = { name: string; color: string };

/** Mismos colores que TAG_COLORS del web (src/app/admin/services/page.tsx). */
export const COLORES_ETIQUETA = [
  "#ef4444", "#f97316", "#f59e0b", "#10b981", "#06b6d4",
  "#3b82f6", "#8b5cf6", "#ec4899", "#64748b",
] as const;

/** Color con el que la migración convierte las etiquetas viejas (TAG_COLORS[0]). */
export const COLOR_ETIQUETA_POR_DEFECTO = COLORES_ETIQUETA[0];

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Lee services.tags en cualquiera de los dos formatos (string u objeto) y
 * devuelve siempre {name, color}[]. Nunca devuelve null.
 */
export function normalizarEtiquetas(raw: unknown): EtiquetaServicio[] {
  if (!Array.isArray(raw)) return [];
  const out: EtiquetaServicio[] = [];
  const vistos = new Set<string>();
  for (const t of raw) {
    let name = "";
    let color: string = COLOR_ETIQUETA_POR_DEFECTO;
    if (typeof t === "string") {
      name = t.trim();
    } else if (t && typeof t === "object") {
      const o = t as { name?: unknown; color?: unknown };
      name = typeof o.name === "string" ? o.name.trim() : "";
      if (typeof o.color === "string" && HEX.test(o.color)) color = o.color;
    }
    const clave = name.toLowerCase();
    if (!name || vistos.has(clave)) continue;
    vistos.add(clave);
    out.push({ name, color });
  }
  return out;
}

/** "cabello, tintura" para el campo de texto del formulario. */
export function textoDeEtiquetas(tags: readonly EtiquetaServicio[]): string {
  return tags.map(t => t.name).join(", ");
}

/**
 * Convierte lo escrito ("cabello, tintura") en etiquetas del formato del web.
 * Las que ya existían conservan su color (lo pudo elegir el dueño en el web);
 * las nuevas toman el siguiente color de la paleta.
 */
export function etiquetasDesdeTexto(texto: string, previas: readonly EtiquetaServicio[] = []): EtiquetaServicio[] {
  const colorPrevio = new Map(previas.map(p => [p.name.toLowerCase(), p.color]));
  const out: EtiquetaServicio[] = [];
  const vistos = new Set<string>();
  let siguiente = previas.length;
  for (const parte of texto.split(",")) {
    const name = parte.trim().slice(0, 40);
    const clave = name.toLowerCase();
    if (!name || vistos.has(clave)) continue;
    vistos.add(clave);
    const color = colorPrevio.get(clave) ?? COLORES_ETIQUETA[siguiente++ % COLORES_ETIQUETA.length];
    out.push({ name, color });
  }
  return out;
}

// ─── Duración ────────────────────────────────────────────────────────────────

export const DURACION_MINIMA = 5;
export const DURACION_MAXIMA = 480;
export const DURACION_POR_DEFECTO = 30;

/** Duración real del servicio: duration_minutes manda (la usan agenda y reserva). */
export function duracionDe(s: { duration_minutes?: number | null; duration_min?: number | null }): number {
  const v = s.duration_minutes ?? s.duration_min;
  return typeof v === "number" && v > 0 ? v : DURACION_POR_DEFECTO;
}

export type Parseo = { ok: true; valor: number } | { ok: false; error: string };

/** Minutos enteros entre 5 y 480. Vacío = 30 (lo mismo que el web por defecto). */
export function parsearDuracion(texto: string): Parseo {
  const t = texto.trim();
  if (!t) return { ok: true, valor: DURACION_POR_DEFECTO };
  if (!/^\d+$/.test(t)) return { ok: false, error: "La duración va en minutos enteros (ej: 45)." };
  const n = Number(t);
  if (n < DURACION_MINIMA || n > DURACION_MAXIMA) {
    return { ok: false, error: `La duración debe estar entre ${DURACION_MINIMA} y ${DURACION_MAXIMA} minutos.` };
  }
  return { ok: true, valor: n };
}

// ─── Precio ──────────────────────────────────────────────────────────────────

/** Monedas que en la práctica no usan decimales (el peso colombiano, el chileno…). */
const SIN_DECIMALES = new Set(["COP", "CLP", "PYG", "JPY", "KRW", "VND", "ISK", "UGX", "XAF", "XOF"]);

export function monedaSinDecimales(currency: string | null | undefined): boolean {
  return SIN_DECIMALES.has((currency ?? "COP").toUpperCase());
}

export const PRECIO_MAXIMO = 1_000_000_000;

/**
 * Precio escrito a mano, con o sin separadores de miles:
 *   "25.000" → 25000 · "25,000" → 25000 · "$ 25.000" → 25000
 *   "12500.00" → 12500 · "19,99" (USD) → 19.99
 * Un separador seguido de 1 o 2 dígitos al final es el decimal; los demás son
 * de miles. En monedas sin decimales (COP) se redondea al entero.
 * El precio 0 es válido (hay servicios de cortesía creados en el web).
 */
export function parsearPrecio(texto: string, currency: string = "COP"): Parseo {
  // Se toleran el símbolo o el código de la moneda y los espacios; cualquier
  // otra cosa (letras, un "-") es un error visible, no un NaN silencioso.
  const sinMoneda = texto.replace(/\b[A-Za-z]{3}\b/g, "").replace(/[$€£¥₡₲₱₩\s]/g, "");
  if (!/\d/.test(sinMoneda)) return { ok: false, error: "Escribe el precio (solo números, ej: 25000)." };
  if (/[^\d.,]/.test(sinMoneda)) return { ok: false, error: "Escribe el precio solo con números (ej: 25000)." };
  const limpio = sinMoneda;

  let entero = limpio;
  let decimales = "";
  const m = /[.,](\d{1,2})$/.exec(limpio);
  if (m) {
    decimales = m[1];
    entero = limpio.slice(0, m.index);
  }
  const digitosEnteros = entero.replace(/[.,]/g, "");
  const valor = Number(`${digitosEnteros || "0"}${decimales ? `.${decimales}` : ""}`);
  if (!Number.isFinite(valor) || valor < 0) return { ok: false, error: "Escribe un precio válido." };
  if (valor > PRECIO_MAXIMO) return { ok: false, error: "El precio es demasiado alto. Revísalo." };

  const redondeado = monedaSinDecimales(currency) ? Math.round(valor) : Math.round(valor * 100) / 100;
  return { ok: true, valor: redondeado };
}

/** Precio para precargar el campo al editar: sin separadores, para que se pueda corregir. */
export function textoDePrecio(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "";
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}
