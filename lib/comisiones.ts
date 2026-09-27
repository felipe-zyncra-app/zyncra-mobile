import { listaDeDias, diasEntre } from "./tz";
import { cobradoDe, estaCobrada, type VentaResumen } from "./ingresos";

/**
 * Comisiones: la misma cuenta para Comisiones (dueño) y Mi Perfil (staff).
 * Funciones puras (lib/__tests__/comisiones-test.ts).
 *
 * Base de la comisión: lo COBRADO de las citas del profesional (pos_sales.total,
 * igual que el web). Una cita completada sin venta no genera comisión hasta
 * que se cobre (D10).
 */

export type ReglaComision = { type: string; value: number | string };

/** Comisión según la regla: % de lo cobrado o un fijo por cita cobrada. Sin regla, 0. */
export function calcularComision(regla: ReglaComision | null | undefined, ingresos: number, citas: number): number {
  if (!regla) return 0;
  const v = Number(regla.value) || 0;
  if (regla.type === "percentage") return Math.round((ingresos * v) / 100);
  return Math.round(v * citas);
}

/** "40% de lo cobrado" / "$20.000 por cita". */
export function describirRegla(regla: ReglaComision, fmtMonto: (n: number) => string): string {
  const v = Number(regla.value) || 0;
  return regla.type === "percentage" ? `${v}% de lo cobrado` : `${fmtMonto(v)} por cita`;
}

// ─── Citas del periodo ───────────────────────────────────────────────────────

export type CitaComision = {
  id: string;
  appointment_date: string;
  status?: string | null;
  pos_sales?: VentaResumen[] | VentaResumen | null;
};

export type Totales = { citas: number; ingresos: number; comision: number };

/**
 * Totales de un profesional entre `desde` y `hasta` (inclusive): solo citas
 * cobradas, valoradas por lo cobrado.
 */
export function totalesEntre(
  citas: readonly CitaComision[],
  regla: ReglaComision | null | undefined,
  desde: string,
  hasta: string,
): Totales {
  let n = 0, ingresos = 0;
  for (const c of citas) {
    if (c.appointment_date < desde || c.appointment_date > hasta) continue;
    if (!estaCobrada(c)) continue;
    n++;
    ingresos += cobradoDe(c);
  }
  return { citas: n, ingresos, comision: calcularComision(regla, ingresos, n) };
}

/** Citas completadas sin venta: no suman hasta que se cobren (se avisa en pantalla). */
export function completadasSinCobro(citas: readonly CitaComision[]): number {
  return citas.filter(c => c.status === "completed" && !estaCobrada(c)).length;
}

// ─── Liquidaciones sin duplicados (DIN-15) ───────────────────────────────────

export type PeriodoPagado = { period_start: string; period_end: string };
export type Tramo = { desde: string; hasta: string };

/**
 * Tramos de días de [desde, hasta] que NO cubre ninguna liquidación. Si el
 * dueño liquida "Esta semana" el miércoles y otra vez el sábado, el sábado solo
 * quedan jueves a domingo: antes se volvía a pagar de lunes a miércoles.
 */
export function diasSinLiquidar(desde: string, hasta: string, pagos: readonly PeriodoPagado[]): Tramo[] {
  if (!desde || !hasta || desde > hasta) return [];
  // Un rango absurdo (fecha mal escrita) no debe colgar el teléfono.
  if (diasEntre(desde, hasta) > 3700) return [{ desde, hasta }];
  const cubierto = (d: string) => pagos.some(p => p.period_start <= d && d <= p.period_end);
  const tramos: Tramo[] = [];
  let actual: Tramo | null = null;
  for (const d of listaDeDias(desde, hasta)) {
    if (cubierto(d)) {
      actual = null;
      continue;
    }
    if (actual) actual.hasta = d;
    else {
      actual = { desde: d, hasta: d };
      tramos.push(actual);
    }
  }
  return tramos;
}

/**
 * Quita de los tramos los días que aún no llegan. Liquidar "Este mes" el 15
 * guardaba period_end = 30: esos días quedarían marcados como pagados y las
 * citas del 16 al 30 no se liquidarían nunca.
 */
export function recortarHastaHoy(tramos: readonly Tramo[], hoy: string): Tramo[] {
  return tramos
    .filter(t => t.desde <= hoy)
    .map(t => ({ desde: t.desde, hasta: t.hasta > hoy ? hoy : t.hasta }));
}

export type PagoConTotales = PeriodoPagado & {
  appointments_count?: number | string | null;
  revenue_total?: number | string | null;
};

/**
 * Cobros de días YA liquidados que no entraron en esa liquidación: la cita se
 * cobró después (una "vencida" cobrada días más tarde, o un cobro de la noche
 * después de liquidar "incluye hoy"). diasSinLiquidar no los vuelve a ofrecer
 * para no pagar doble, así que hay que mostrarlos aparte y no decir "Liquidado".
 *
 * Solo compara las liquidaciones enteras dentro de [desde, hasta]: de una que
 * se sale del rango no se tienen todas sus citas. Nunca devuelve negativos
 * (liquidaciones viejas valoraban completadas sin venta al precio de lista).
 */
export function cobradoDespuesDeLiquidar(
  citas: readonly CitaComision[],
  pagos: readonly PagoConTotales[],
  desde: string,
  hasta: string,
): { citas: number; ingresos: number } {
  let citasHoy = 0, ingresosHoy = 0, citasPagadas = 0, ingresosPagados = 0;
  for (const p of pagos) {
    if (p.period_start < desde || p.period_end > hasta) continue;
    const t = totalesEntre(citas, null, p.period_start, p.period_end);
    citasHoy += t.citas;
    ingresosHoy += t.ingresos;
    citasPagadas += Number(p.appointments_count) || 0;
    ingresosPagados += Number(p.revenue_total) || 0;
  }
  return {
    citas: Math.max(0, citasHoy - citasPagadas),
    // Se ignoran diferencias de centavos (redondeos de numeric).
    ingresos: Math.max(0, Math.round(ingresosHoy - ingresosPagados)),
  };
}

/** Lo liquidado que se cruza con [desde, hasta]. */
export function pagosQueSeCruzan<T extends PeriodoPagado>(pagos: readonly T[], desde: string, hasta: string): T[] {
  return pagos.filter(p => p.period_start <= hasta && p.period_end >= desde);
}

// ─── Color del profesional ───────────────────────────────────────────────────
// professionals no tiene columna color (ESQ-09): pedirla hacía fallar la
// consulta entera. Se deriva del id, así el mismo profesional sale siempre del
// mismo color en todas las pantallas.

const PALETA = ["#fb0f05", "#0027fe", "#10b981", "#f59e0b", "#8b5cf6", "#06b6d4", "#ec4899", "#f97316", "#14b8a6", "#6366f1"];

export function colorDeProfesional(id: string | null | undefined): string {
  const s = id ?? "";
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETA[h % PALETA.length];
}
