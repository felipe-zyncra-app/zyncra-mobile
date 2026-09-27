/**
 * Fronteras de dia en la zona horaria del negocio.
 *
 * EL PROBLEMA QUE RESUELVE
 * La base corre en UTC. Las consultas escribian los limites de dia como
 * literales sin zona:
 *
 *     .lte("created_at", `${hoy}T23:59:59`)
 *
 * Postgres interpreta ese texto en UTC, no en la hora del negocio. Un cobro
 * de las 8 PM en Colombia se guarda como 1 AM UTC del dia siguiente y cae
 * FUERA del filtro de "hoy". Medido en produccion: 86 de 499 cobros (17,2%)
 * caen en un dia distinto segun se miren en UTC o en local.
 *
 * Peor aun, no se corren de dia: desaparecen. La consulta los excluye por el
 * limite en UTC, y cuando la ventana del dia siguiente si los trae, el
 * agrupamiento por fecha local los descarta porque pertenecen al dia anterior.
 *
 * Y el daño mayor no son esas ventas sueltas: la misma consulta es la que
 * adjunta el total realmente cobrado a cada cita. Si el cobro queda fuera de
 * la ventana, getPrice() cae al precio de lista y se pierden los adicionales,
 * productos y descuentos del POS.
 *
 * SOBRE HERMES
 * El soporte de `timeZone` en Intl depende del motor. Si no esta disponible,
 * offsetMinutes devuelve null y todo cae al comportamiento anterior — mismo
 * resultado que hoy, nunca peor. Verificar con `soportaZonas()` antes de
 * prometer que esto funciona en un dispositivo real.
 */

/** Zona que se asume cuando el negocio no ha configurado la suya. */
export const ZONA_POR_DEFECTO = "America/Bogota";

// ─── Zona activa ─────────────────────────────────────────────────────────────
// TenantProvider la fija en cuanto conoce la zona del negocio (y la devuelve a
// la de por defecto al cerrar sesión). Es el valor por defecto de todos los
// helpers de este archivo: quien olvide pasar la zona obtiene la del negocio y
// no la de Bogotá. Igual conviene pasarla explícita desde useTenant().timezone,
// para que el efecto de la pantalla dependa de ella y recargue cuando llegue.
let zonaActual = ZONA_POR_DEFECTO;

/** Solo la llama TenantProvider. */
export function establecerZonaActiva(timeZone: string | null | undefined): void {
  zonaActual = typeof timeZone === "string" && timeZone.length > 0 ? timeZone : ZONA_POR_DEFECTO;
}

/** Zona del negocio con sesión, o la de por defecto si aún no se conoce. */
export function zonaActiva(): string {
  return zonaActual;
}

// Un formateador por zona. Crearlo es lo caro (≈8 veces más que usarlo, y más
// en Hermes), y diaLocalDe se llama por cada fila al agrupar miles de cobros.
// null = el motor no acepta esa zona (se recuerda para no reintentar).
const formateadores = new Map<string, Intl.DateTimeFormat | null>();

function formateador(timeZone: string): Intl.DateTimeFormat | null {
  let dtf = formateadores.get(timeZone);
  if (dtf === undefined) {
    try {
      dtf = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour12: false,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
      });
    } catch {
      dtf = null;
    }
    formateadores.set(timeZone, dtf);
  }
  return dtf;
}

/**
 * Minutos de desfase respecto a UTC de `timeZone` en el instante `at`.
 * Se calcula por instante y no por zona porque el horario de verano cambia el
 * desfase a lo largo del año: Colombia no lo usa, pero Chile o Mexico si, y
 * la idea es que esto siga sirviendo cuando el primer cliente salga del pais.
 *
 * Devuelve null si el motor no soporta zonas horarias.
 */
function offsetMinutes(at: Date, timeZone: string): number | null {
  try {
    const dtf = formateador(timeZone);
    if (!dtf) return null;
    const p: Record<string, string> = {};
    for (const part of dtf.formatToParts(at)) p[part.type] = part.value;
    if (!p.year || !p.hour) return null;
    // Que hora marcaba el reloj de esa zona, leido como si fuera UTC.
    const comoUTC = Date.UTC(
      Number(p.year), Number(p.month) - 1, Number(p.day),
      Number(p.hour) % 24, Number(p.minute), Number(p.second),
    );
    const off = Math.round((comoUTC - at.getTime()) / 60000);
    // Cordura: ninguna zona real pasa de ±14 h. Si sale algo raro, es que el
    // motor ignoro la opcion timeZone y formateo en local.
    return Math.abs(off) <= 14 * 60 ? off : null;
  } catch {
    return null;
  }
}

/** true si el motor puede hacer cuentas con zonas horarias reales. */
export function soportaZonas(): boolean {
  // Bogota es UTC-5 todo el año: si el motor responde -300, sabe de zonas.
  return offsetMinutes(new Date("2026-06-15T12:00:00Z"), "America/Bogota") === -300;
}

// ─── Aritmetica de dias 'YYYY-MM-DD' ─────────────────────────────────────────
// Todo se hace sobre el texto con Date.UTC: un dia de calendario no tiene zona,
// y mezclarlo con la hora del telefono es justo lo que corria las semanas.

const FORMA_DIA = /^(\d{4})-(\d{2})-(\d{2})/;
const DIA_MS = 86_400_000;

function partesDia(diaISO: string): [number, number, number] | null {
  const m = FORMA_DIA.exec(diaISO ?? "");
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function diaDesdeUTC(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Suma (o resta) `n` dias de calendario a 'YYYY-MM-DD'. "" si la fecha no es valida. */
export function sumarDias(diaISO: string, n: number): string {
  const p = partesDia(diaISO);
  if (!p) return "";
  return diaDesdeUTC(Date.UTC(p[0], p[1] - 1, p[2] + n));
}

/** Dia de la semana: 1 = lunes … 7 = domingo (semana de lunes a domingo). */
export function diaDeSemana(diaISO: string): number {
  const p = partesDia(diaISO);
  if (!p) return 1;
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay(); // 0 = domingo
  return d === 0 ? 7 : d;
}

/** Lunes de la semana de `diaISO`. */
export function inicioDeSemana(diaISO: string): string {
  return sumarDias(diaISO, 1 - diaDeSemana(diaISO));
}

/** Domingo de la semana de `diaISO`. */
export function finDeSemana(diaISO: string): string {
  return sumarDias(inicioDeSemana(diaISO), 6);
}

export function inicioDeMes(diaISO: string): string {
  const p = partesDia(diaISO);
  return p ? diaDesdeUTC(Date.UTC(p[0], p[1] - 1, 1)) : "";
}

export function finDeMes(diaISO: string): string {
  const p = partesDia(diaISO);
  // Dia 0 del mes siguiente = ultimo dia de este mes.
  return p ? diaDesdeUTC(Date.UTC(p[0], p[1], 0)) : "";
}

export function inicioDeAnio(diaISO: string): string {
  const p = partesDia(diaISO);
  return p ? `${p[0]}-01-01` : "";
}

export function finDeAnio(diaISO: string): string {
  const p = partesDia(diaISO);
  return p ? `${p[0]}-12-31` : "";
}

/** 'YYYY-MM' del dia (para agrupar por mes). */
export function mesDe(diaISO: string): string {
  return (diaISO ?? "").slice(0, 7);
}

/** Dias entre dos fechas, ambas inclusive. `hasta` < `desde` → 0. */
export function diasEntre(desde: string, hasta: string): number {
  const a = partesDia(desde), b = partesDia(hasta);
  if (!a || !b) return 0;
  const diff = (Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86_400_000;
  return diff < 0 ? 0 : Math.round(diff) + 1;
}

/** Lista de dias 'YYYY-MM-DD' de `desde` a `hasta` (inclusive). Para armar series por dia. */
export function listaDeDias(desde: string, hasta: string): string[] {
  const n = diasEntre(desde, hasta);
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(sumarDias(desde, i));
  return out;
}

// ─── Instantes y dias en la zona del negocio ─────────────────────────────────

/**
 * Instante real (Date) en que el reloj del negocio marca `hhmm` el dia
 * `diaISO`. Es lo que hay que usar para programar un recordatorio o comparar
 * "ya paso la cita": `new Date("2026-09-26T10:00")` es las 10:00 del TELEFONO,
 * no del negocio. Sin soporte de zonas cae a la hora del telefono (como antes).
 */
export function instanteDe(diaISO: string, hhmm: string, timeZone: string = zonaActiva()): Date {
  const p = partesDia(diaISO);
  const [h, m] = (hhmm ?? "00:00").split(":").map(x => Number(x) || 0);
  if (!p) return new Date(NaN);
  const ingenuo = Date.UTC(p[0], p[1] - 1, p[2], h, m);
  const off = offsetMinutes(new Date(ingenuo), timeZone);
  if (off === null) {
    return new Date(p[0], p[1] - 1, p[2], h, m);   // sin soporte: hora del telefono
  }
  // Desfases posibles: el de esa hora y los de un dia antes y despues (cubren
  // cualquier cambio de horario cercano; ninguna zona cambia dos veces en 48 h).
  const offs = Array.from(new Set([
    offsetMinutes(new Date(ingenuo - DIA_MS), timeZone) ?? off,
    off,
    offsetMinutes(new Date(ingenuo + DIA_MS), timeZone) ?? off,
  ]));
  // Candidato valido = en ese instante el reloj del negocio marca justo hhmm.
  const validos = offs
    .map(o => ingenuo - o * 60000)
    .filter(t => offsetMinutes(new Date(t), timeZone) === (ingenuo - t) / 60000);
  // Hora repetida (el reloj se atrasa): la primera vez que ocurre.
  if (validos.length > 0) return new Date(Math.min(...validos));
  // Hora que no existe (el reloj salta): se corre hacia adelante lo que dura
  // el salto, como hace Date. Santiago el 6-sep-2026 pasa de 00:00 a 01:00:
  // 00:00 → 01:00 (el dia empieza ahi, no a las 23:00 del dia anterior como
  // daba la cuenta de dos pasadas) y 00:30 → 01:30.
  return new Date(ingenuo - Math.min(...offs) * 60000);
}

/** Instante UTC en que empieza el dia `diaISO` (YYYY-MM-DD) en `timeZone`. */
export function inicioDelDiaUTC(diaISO: string, timeZone: string = zonaActiva()): string {
  if (offsetMinutes(new Date(`${diaISO}T12:00:00Z`), timeZone) === null) {
    return `${diaISO}T00:00:00`;   // sin soporte: como antes
  }
  return instanteDe(diaISO, "00:00", timeZone).toISOString();
}

/** Instante UTC en que termina el dia `diaISO` en `timeZone` (inclusive). */
export function finDelDiaUTC(diaISO: string, timeZone: string = zonaActiva()): string {
  if (offsetMinutes(new Date(`${diaISO}T12:00:00Z`), timeZone) === null) {
    return `${diaISO}T23:59:59`;   // sin soporte: como antes
  }
  // Un milisegundo antes de que empiece el dia siguiente: tambien es correcto
  // el dia en que cambia el horario de verano (dura 23 o 25 horas).
  return new Date(instanteDe(sumarDias(diaISO, 1), "00:00", timeZone).getTime() - 1).toISOString();
}

/**
 * A que dia local pertenece un instante. Sirve para agrupar cobros por dia:
 * `new Date(x).toISOString().slice(0,10)` da el dia en UTC, que es justo el
 * error que esto corrige.
 */
export function diaLocalDe(instante: string | Date, timeZone: string = zonaActiva()): string {
  const d = typeof instante === "string" ? new Date(instante) : instante;
  // Fecha invalida (campo vacio o nulo): devolver "" como hacia el slice(0,10)
  // que esto reemplaza. toISOString() lanzaria y tumbaria la pantalla.
  if (!d || Number.isNaN(d.getTime())) return "";
  const off = offsetMinutes(d, timeZone);
  if (off === null) return d.toISOString().slice(0, 10);
  return new Date(d.getTime() + off * 60000).toISOString().slice(0, 10);
}

/** 'HH:MM' que marca el reloj del negocio en ese instante (p. ej. la linea de "ahora"). */
export function horaLocalDe(instante: string | Date, timeZone: string = zonaActiva()): string {
  const d = typeof instante === "string" ? new Date(instante) : instante;
  if (!d || Number.isNaN(d.getTime())) return "";
  const off = offsetMinutes(d, timeZone);
  const local = off === null
    ? new Date(d.getTime() - d.getTimezoneOffset() * 60000)   // sin soporte: hora del telefono
    : new Date(d.getTime() + off * 60000);
  return local.toISOString().slice(11, 16);
}

/** Minutos desde la medianoche del negocio (para comparar con 'HH:MM' de citas). */
export function minutosDelDia(instante: string | Date = new Date(), timeZone: string = zonaActiva()): number {
  const hhmm = horaLocalDe(instante, timeZone);
  if (!hhmm) return 0;
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
}

/** "Hoy" en el negocio: después de las 7 PM de Bogotá el UTC ya es mañana. */
export function hoyNegocio(timeZone: string = zonaActiva()): string {
  return diaLocalDe(new Date(), timeZone);
}

export function esHoy(diaISO: string, timeZone: string = zonaActiva()): boolean {
  return diaISO === hoyNegocio(timeZone);
}

// ─── Periodos (reportes, comisiones, historial) ──────────────────────────────

export type Periodo = "dia" | "semana" | "mes" | "anio";

/**
 * Un rango listo para usar en las dos mitades del problema:
 *  · consulta:  .gte("created_at", r.desdeUTC).lte("created_at", r.hastaUTC)
 *               .gte("appointment_date", r.desde).lte("appointment_date", r.hasta)
 *  · memoria:   diaLocalDe(fila.created_at, r.timeZone) y comparar con desde/hasta
 */
export type RangoNegocio = {
  periodo: Periodo | "personalizado";
  /** Primer dia local, inclusive. */
  desde: string;
  /** Ultimo dia local, inclusive. */
  hasta: string;
  /** Instante UTC en que empieza `desde` en la zona del negocio. */
  desdeUTC: string;
  /** Instante UTC en que termina `hasta` (inclusive). */
  hastaUTC: string;
  /** Cantidad de dias del rango. */
  dias: number;
  timeZone: string;
};

/** Rango de dias locales cualquiera. Si vienen al reves, se ordenan. */
export function rangoPersonalizado(desde: string, hasta: string, timeZone: string = zonaActiva()): RangoNegocio {
  const [a, b] = desde <= hasta ? [desde, hasta] : [hasta, desde];
  return {
    periodo: "personalizado",
    desde: a,
    hasta: b,
    desdeUTC: inicioDelDiaUTC(a, timeZone),
    hastaUTC: finDelDiaUTC(b, timeZone),
    dias: diasEntre(a, b),
    timeZone,
  };
}

/**
 * Rango del periodo que contiene `referencia` (por defecto, hoy del negocio).
 * Semana = lunes a domingo; mes y año de calendario.
 */
export function rangoDePeriodo(
  periodo: Periodo,
  timeZone: string = zonaActiva(),
  referencia: string = hoyNegocio(timeZone),
): RangoNegocio {
  let desde: string, hasta: string;
  switch (periodo) {
    case "dia":    desde = referencia;                 hasta = referencia;              break;
    case "semana": desde = inicioDeSemana(referencia); hasta = finDeSemana(referencia); break;
    case "mes":    desde = inicioDeMes(referencia);    hasta = finDeMes(referencia);    break;
    case "anio":   desde = inicioDeAnio(referencia);   hasta = finDeAnio(referencia);   break;
  }
  return { ...rangoPersonalizado(desde, hasta, timeZone), periodo };
}

/**
 * Nueva referencia al moverse `pasos` periodos (−1 = anterior, +1 = siguiente).
 * Para el mes se ancla al dia 1: pasar del 31 de enero a "febrero" no debe
 * caer en marzo.
 */
export function moverReferencia(periodo: Periodo, referencia: string, pasos: number): string {
  const p = partesDia(referencia);
  if (!p) return referencia;
  switch (periodo) {
    case "dia":    return sumarDias(referencia, pasos);
    case "semana": return sumarDias(referencia, 7 * pasos);
    case "mes":    return diaDesdeUTC(Date.UTC(p[0], p[1] - 1 + pasos, 1));
    case "anio":   return `${p[0] + pasos}-01-01`;
  }
}

/** El mismo tipo de periodo, `pasos` hacia atras o adelante. Un personalizado se corre por su largo. */
export function moverRango(r: RangoNegocio, pasos: number): RangoNegocio {
  if (r.periodo === "personalizado") {
    return rangoPersonalizado(sumarDias(r.desde, r.dias * pasos), sumarDias(r.hasta, r.dias * pasos), r.timeZone);
  }
  return rangoDePeriodo(r.periodo, r.timeZone, moverReferencia(r.periodo, r.desde, pasos));
}

/** Periodo anterior (para "vs. periodo anterior"). */
export function rangoAnterior(r: RangoNegocio): RangoNegocio {
  return moverRango(r, -1);
}

/** Periodo siguiente. */
export function rangoSiguiente(r: RangoNegocio): RangoNegocio {
  return moverRango(r, 1);
}

/** true si el rango incluye el dia de hoy del negocio (para deshabilitar "siguiente"). */
export function rangoIncluyeHoy(r: RangoNegocio): boolean {
  const hoy = hoyNegocio(r.timeZone);
  return r.desde <= hoy && hoy <= r.hasta;
}

// ─── Mostrar fechas solo-dia sin parsearlas como UTC ─────────────────────────
// new Date("2026-09-26") es medianoche UTC: en Colombia se muestra como el 25.
// Aqui se arma la fecha a mediodia LOCAL solo para leer sus componentes; el
// dia de calendario no se mueve en ninguna zona.

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MESES_LARGOS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS_CORTOS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const DIAS_LARGOS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** Date a mediodia local del dia. Solo para pickers o para leer componentes; nunca para fronteras. */
export function fechaDeDia(diaISO: string): Date {
  const p = partesDia(diaISO);
  return p ? new Date(p[0], p[1] - 1, p[2], 12, 0, 0) : new Date(NaN);
}

export type EstiloDia =
  | "corto"        // 26 sep 2026
  | "dia-mes"      // 26 sep
  | "semana-dia"   // sáb 26
  | "largo"        // sábado 26 de septiembre
  | "completo"     // sábado 26 de septiembre de 2026
  | "mes-anio";    // septiembre 2026

/**
 * Formatea un dia 'YYYY-MM-DD' para mostrar, sin pasar por UTC. Acepta tambien
 * un timestamp: en ese caso toma sus primeros 10 caracteres, asi que para un
 * `created_at` primero conviertelo con diaLocalDe().
 */
export function fmtDia(diaISO: string, estilo: EstiloDia = "corto"): string {
  const p = partesDia(diaISO);
  if (!p) return "";
  const [y, m, d] = p;
  const sem = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  switch (estilo) {
    case "corto":      return `${d} ${MESES_CORTOS[m - 1]} ${y}`;
    case "dia-mes":    return `${d} ${MESES_CORTOS[m - 1]}`;
    case "semana-dia": return `${DIAS_CORTOS[sem]} ${d}`;
    case "largo":      return `${DIAS_LARGOS[sem]} ${d} de ${MESES_LARGOS[m - 1]}`;
    case "completo":   return `${DIAS_LARGOS[sem]} ${d} de ${MESES_LARGOS[m - 1]} de ${y}`;
    case "mes-anio":   return `${MESES_LARGOS[m - 1]} ${y}`;
  }
}

/** Etiqueta legible de un rango: "hoy", "22 – 28 sep 2026", "septiembre 2026", "2026". */
export function etiquetaRango(r: RangoNegocio): string {
  if (r.periodo === "dia") return esHoy(r.desde, r.timeZone) ? "Hoy" : fmtDia(r.desde, "largo");
  if (r.periodo === "mes") return fmtDia(r.desde, "mes-anio");
  if (r.periodo === "anio") return r.desde.slice(0, 4);
  if (r.desde === r.hasta) return fmtDia(r.desde, "corto");
  const mismoAnio = r.desde.slice(0, 4) === r.hasta.slice(0, 4);
  const mismoMes = mismoAnio && r.desde.slice(5, 7) === r.hasta.slice(5, 7);
  if (mismoMes) return `${Number(r.desde.slice(8, 10))} – ${fmtDia(r.hasta, "corto")}`;
  if (mismoAnio) return `${fmtDia(r.desde, "dia-mes")} – ${fmtDia(r.hasta, "corto")}`;
  return `${fmtDia(r.desde, "corto")} – ${fmtDia(r.hasta, "corto")}`;
}

/** Zona del negocio, con respaldo. Lee tenants.settings.timezone. */
export function zonaDelNegocio(settings: any): string {
  const z = settings?.timezone;
  return typeof z === "string" && z.length > 0 ? z : ZONA_POR_DEFECTO;
}

/**
 * Zonas que puede elegir un negocio. Se limita a America Latina y Espana —
 * que es a donde puede crecer Zyncra — en vez de ofrecer las ~400 de la base
 * IANA: una lista larga es peor que una corta cuando el usuario ya sabe cual
 * es la suya. Si algun dia hace falta otra, se agrega aqui.
 *
 * Las que tienen horario de verano van marcadas: no cambia nada en el codigo
 * (el desfase se calcula por instante), pero ayuda a entender por que el
 * mismo negocio puede ver un corte de dia distinto en enero y en julio.
 */
export const ZONAS_DISPONIBLES: { id: string; label: string; dst?: boolean }[] = [
  { id: "America/Bogota",      label: "Colombia — Bogotá" },
  { id: "America/Mexico_City", label: "México — Ciudad de México" },
  { id: "America/Lima",        label: "Perú — Lima" },
  { id: "America/Guayaquil",   label: "Ecuador — Guayaquil" },
  { id: "America/Caracas",     label: "Venezuela — Caracas" },
  { id: "America/Panama",      label: "Panamá" },
  { id: "America/Costa_Rica",  label: "Costa Rica" },
  { id: "America/Guatemala",   label: "Guatemala" },
  { id: "America/El_Salvador", label: "El Salvador" },
  { id: "America/Tegucigalpa", label: "Honduras" },
  { id: "America/Managua",     label: "Nicaragua" },
  { id: "America/Santo_Domingo", label: "República Dominicana" },
  { id: "America/La_Paz",      label: "Bolivia — La Paz" },
  // Paraguay dejó el horario de verano en oct-2024 (UTC-3 fijo, tzdata 2024b).
  { id: "America/Asuncion",    label: "Paraguay — Asunción" },
  { id: "America/Santiago",    label: "Chile — Santiago",    dst: true },
  { id: "America/Argentina/Buenos_Aires", label: "Argentina — Buenos Aires" },
  { id: "America/Montevideo",  label: "Uruguay — Montevideo" },
  { id: "America/Sao_Paulo",   label: "Brasil — São Paulo" },
  { id: "Europe/Madrid",       label: "España — Madrid",     dst: true },
];

/** Etiqueta legible de una zona, o el id si no esta en la lista. */
export function etiquetaZona(id: string): string {
  return ZONAS_DISPONIBLES.find(z => z.id === id)?.label ?? id;
}
