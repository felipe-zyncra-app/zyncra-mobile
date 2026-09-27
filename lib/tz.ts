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
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
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

/** Instante UTC en que empieza el dia `diaISO` (YYYY-MM-DD) en `timeZone`. */
export function inicioDelDiaUTC(diaISO: string, timeZone = ZONA_POR_DEFECTO): string {
  const ingenuo = new Date(`${diaISO}T00:00:00Z`);
  const off = offsetMinutes(ingenuo, timeZone);
  if (off === null) return `${diaISO}T00:00:00`;   // sin soporte: como antes
  return new Date(ingenuo.getTime() - off * 60000).toISOString();
}

/** Instante UTC en que termina el dia `diaISO` en `timeZone` (inclusive). */
export function finDelDiaUTC(diaISO: string, timeZone = ZONA_POR_DEFECTO): string {
  const ingenuo = new Date(`${diaISO}T23:59:59.999Z`);
  const off = offsetMinutes(ingenuo, timeZone);
  if (off === null) return `${diaISO}T23:59:59`;   // sin soporte: como antes
  return new Date(ingenuo.getTime() - off * 60000).toISOString();
}

/**
 * A que dia local pertenece un instante. Sirve para agrupar cobros por dia:
 * `new Date(x).toISOString().slice(0,10)` da el dia en UTC, que es justo el
 * error que esto corrige.
 */
export function diaLocalDe(instante: string | Date, timeZone = ZONA_POR_DEFECTO): string {
  const d = typeof instante === "string" ? new Date(instante) : instante;
  const off = offsetMinutes(d, timeZone);
  if (off === null) return d.toISOString().slice(0, 10);
  return new Date(d.getTime() + off * 60000).toISOString().slice(0, 10);
}

/** Zona del negocio, con respaldo. Lee tenants.settings.timezone. */
export function zonaDelNegocio(settings: any): string {
  const z = settings?.timezone;
  return typeof z === "string" && z.length > 0 ? z : ZONA_POR_DEFECTO;
}
