import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
import { zonaActiva } from "./tz";

// ─── Moneda ──────────────────────────────────────────────────────────────────
// El web formatea con tenants.settings.currency / locale (admin/layout.tsx). El
// móvil tenía fijo "$" + es-CO y redondeaba: un servicio de 12.50 USD se veía
// "$13". TenantProvider llama a configurarMoneda() al cargar el negocio, así
// que fmtMoney/fmtMoneyFull respetan la moneda sin tocar a sus ~100 llamadores.
// Con COP (o sin configurar) el resultado es idéntico al de siempre.

let monedaActual = "COP";
let localeActual = "es-CO";

/** Solo la llama TenantProvider. Sin argumentos vuelve a COP / es-CO. */
export function configurarMoneda(currency?: string | null, locale?: string | null): void {
  monedaActual = typeof currency === "string" && /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : "COP";
  localeActual = typeof locale === "string" && locale.length >= 2 ? locale : "es-CO";
}

export function monedaActiva(): { currency: string; locale: string } {
  return { currency: monedaActual, locale: localeActual };
}

function fmtOtraMoneda(n: number): string | null {
  try {
    const conCentavos = Math.round(n * 100) % 100 !== 0;
    return new Intl.NumberFormat(localeActual, {
      style: "currency",
      currency: monedaActual,
      minimumFractionDigits: conCentavos ? 2 : 0,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return null;   // motor sin soporte de esa moneda: se cae al formato de siempre
  }
}

export function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  return fmtMoneyFull(n);
}

export function fmtMoneyFull(n: number): string {
  const v = Number(n) || 0;
  if (monedaActual !== "COP") {
    const otro = fmtOtraMoneda(v);
    if (otro) return otro;
  }
  return "$" + Math.round(v).toLocaleString("es-CO");
}

// ─── Fechas ──────────────────────────────────────────────────────────────────
// Para fechas del NEGOCIO usa lib/tz.ts (hoyNegocio, fmtDia, diaLocalDe).
// fmtDateCompact / fmtDateFull / fmtTime muestran un instante (created_at) en
// la hora del negocio (zona activa), y un 'YYYY-MM-DD' como día de calendario.

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/**
 * "YYYY-MM-DD" en la hora del TELÉFONO. Para "hoy" del negocio usa
 * hoyNegocio(timezone) de lib/tz: si el teléfono está en otra zona, esto da
 * otro día.
 */
export function localDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "26 sep 2026" de un día 'YYYY-MM-DD' (se lee como fecha local, sin pasar por UTC). */
export function fmtDateShort(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d ?? "");
  if (!m) return "";
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

const SOLO_DIA = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * new Date("2026-09-26") es medianoche UTC: en Colombia se veía "25 sep"
 * (commissions.tsx pasa period_start/end así). Un día solo se arma a mediodía
 * local, que no se corre en ninguna zona. Un instante se muestra en la zona
 * del negocio; si el motor no acepta timeZone, en la del teléfono (como antes).
 */
function fmtInstante(iso: string, opciones: Intl.DateTimeFormatOptions, soloHora = false): string {
  const texto = typeof iso === "string" ? iso.trim() : "";
  const dia = soloHora ? null : SOLO_DIA.exec(texto);
  if (dia) {
    return new Date(Number(dia[1]), Number(dia[2]) - 1, Number(dia[3]), 12)
      .toLocaleDateString("es-CO", opciones);
  }
  const d = new Date(texto);
  if (Number.isNaN(d.getTime())) return "";
  const mostrar = (o: Intl.DateTimeFormatOptions) =>
    soloHora ? d.toLocaleTimeString("es-CO", o) : d.toLocaleDateString("es-CO", o);
  try {
    return mostrar({ ...opciones, timeZone: zonaActiva() });
  } catch {
    return mostrar(opciones);
  }
}

export function fmtDateCompact(iso: string): string {
  return fmtInstante(iso, { day: "numeric", month: "short" });
}

export function fmtDateFull(iso: string): string {
  return fmtInstante(iso, { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtTime(iso: string): string {
  return fmtInstante(iso, { hour: "2-digit", minute: "2-digit" }, true);
}

/**
 * "HH:MM" o "HH:MM:SS" (24 h) → "9:30 AM". Acepta también la hora de una
 * cifra ("9:30", que antes salía "9:0 AM") y "24:00" (cierre a medianoche).
 * De 24:00 a 47:59 es el día siguiente: minsToTime no da la vuelta, así que
 * la hora de fin de una cita de 23:30 que dura 2 h llega como "25:30".
 */
export function fmt12(t: string): string {
  const m = /^\s*(\d{1,2}):(\d{2})/.exec(t ?? "");
  if (!m) return t ?? "";
  const h = Number(m[1]);
  if (h >= 48) return t;
  const h24 = h % 24;
  return `${h24 % 12 || 12}:${m[2]} ${h24 >= 12 ? "PM" : "AM"}`;
}

/**
 * Antes fijaba ":00" y descartaba los minutos: con cupos cada 30 min, 9:00 y
 * 9:30 se veían iguales (AGE-01 / CAL-02). Ningún llamador dependía de eso
 * (grilla de cupos, resumen, "Otra hora" y el horario de Ajustes quieren la
 * hora real), así que ahora es un alias de fmt12.
 */
export function fmt12Hour(t: string): string {
  return fmt12(t);
}

export function pct(n: number): string {
  return `${Math.round(n)}%`;
}

// ─── Teléfonos y WhatsApp ────────────────────────────────────────────────────
// clients.phone se guarda como indicativo + número sin "+" (combinePhone), pero
// hay clientes viejos con 10 dígitos colombianos sin indicativo. Antes cada
// pantalla armaba el enlace a su manera: fmtPhone anteponía "57" a todo (un
// mexicano 5255… quedaba 575255…, un número que no existe) y otras usaban los
// dígitos pelados (un 3001234567 sin indicativo no abre en WhatsApp). Todo
// pasa ahora por telefonoE164, basado en libphonenumber-js.

export const PAIS_POR_DEFECTO: CountryCode = "CO";

export type OpcionesTelefono = {
  /** País para números nacionales sin indicativo. Default CO. */
  pais?: CountryCode;
  /** Indicativo guardado aparte (clients.phone_country_code), p. ej. "52". */
  indicativo?: string | null;
};

function intentarE164(texto: string, pais?: CountryCode, aceptarPosible = false): string | null {
  // México quitó el "1" de los celulares en 2019, pero muchos contactos siguen
  // guardados como +52 1 55…: libphonenumber ya no los reconoce.
  const mx = /^\+521(\d{10})$/.exec(texto);
  if (mx) texto = `+52${mx[1]}`;
  const n = parsePhoneNumberFromString(texto, pais);
  if (!n) return null;
  if (n.isValid() || (aceptarPosible && n.isPossible())) return n.number;
  return null;
}

/**
 * Teléfono en E.164 ("+573001234567") o null si no se reconoce como número real.
 *   telefonoE164("3001234567")            → "+573001234567"  (nacional CO)
 *   telefonoE164("573001234567")          → "+573001234567"  (guardado con indicativo)
 *   telefonoE164("525512345678")          → "+525512345678"  (México guardado sin "+")
 *   telefonoE164("+34 612 34 56 78")      → "+34612345678"
 *   telefonoE164("5512345678", { indicativo: "52" }) → "+525512345678"
 */
export function telefonoE164(raw: string | null | undefined, opciones: OpcionesTelefono = {}): string | null {
  const bruto = typeof raw === "string" ? raw.trim() : "";
  const digitos = bruto.replace(/\D/g, "");
  if (digitos.length < 6) return null;
  const pais = opciones.pais ?? PAIS_POR_DEFECTO;

  // 1. Con "+" o "00" el usuario ya dijo el país.
  if (bruto.startsWith("+")) return intentarE164(`+${digitos}`, undefined, true);
  if (digitos.startsWith("00")) return intentarE164(`+${digitos.slice(2)}`, undefined, true);

  // 2. Indicativo conocido por separado.
  const ind = (opciones.indicativo ?? "").replace(/\D/g, "");
  if (ind) {
    if (digitos.startsWith(ind)) {
      const r = intentarE164(`+${digitos}`);
      if (r) return r;
    }
    const r = intentarE164(`+${ind}${digitos}`);
    if (r) return r;
  }

  // 3. Número nacional del país por defecto (los 10 dígitos de siempre). Va
  //    antes que el internacional porque "3001234567" también podría leerse
  //    como +30… Si ya trae el indicativo del país (573001234567),
  //    libphonenumber lo reconoce y lo quita solo.
  const nacional = intentarE164(digitos, pais);
  if (nacional) return nacional;

  // 4. Guardado con indicativo de otro país, sin "+" (525512345678, 34612345678).
  return intentarE164(`+${digitos}`);
}

/** Enlace de WhatsApp (https://wa.me/573001234567?text=…) o null si el número no es válido. */
export function enlaceWhatsApp(
  raw: string | null | undefined,
  opciones: OpcionesTelefono & { texto?: string } = {},
): string | null {
  const e164 = telefonoE164(raw, opciones);
  if (!e164) return null;
  const texto = opciones.texto ? `?text=${encodeURIComponent(opciones.texto)}` : "";
  return `https://wa.me/${e164.slice(1)}${texto}`;
}

/**
 * Enlace para llamar (tel:+573001234567). Con el "+" el marcador no depende
 * del país del SIM. Si el número no se reconoce, se marcan los dígitos tal
 * cual (mejor que no poder llamar); null solo si no hay dígitos.
 */
export function enlaceTel(raw: string | null | undefined, opciones: OpcionesTelefono = {}): string | null {
  const e164 = telefonoE164(raw, opciones);
  if (e164) return `tel:${e164}`;
  const digitos = (raw ?? "").replace(/\D/g, "");
  return digitos ? `tel:${digitos}` : null;
}

/** Teléfono legible ("+57 300 1234567"). Si no se reconoce, devuelve el texto original. */
export function fmtTelefono(raw: string | null | undefined, opciones: OpcionesTelefono = {}): string {
  const e164 = telefonoE164(raw, opciones);
  if (!e164) return raw ?? "";
  return parsePhoneNumberFromString(e164)?.formatInternational() ?? e164;
}

/**
 * Compatibilidad: dígitos con indicativo, sin "+" (lo que va después de
 * wa.me/). Ya no antepone "57" a ciegas; si el número no se reconoce devuelve
 * sus dígitos. Para enlaces nuevos usa enlaceWhatsApp, que devuelve null
 * cuando el número no sirve y así se puede avisar en vez de abrir un chat
 * con un desconocido.
 */
export function fmtPhone(phone: string): string {
  const e164 = telefonoE164(phone);
  return e164 ? e164.slice(1) : (phone ?? "").replace(/\D/g, "");
}
