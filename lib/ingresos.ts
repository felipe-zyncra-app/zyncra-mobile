import { salePaymentLines, type PaymentLine } from "./pos-payments";
import { MEDIOS, MEDIO_OTRO } from "./medios-pago";

/**
 * Ingresos del Panel, Reportes y Comisiones. Funciones puras (se prueban en
 * lib/__tests__/ingresos-test.ts).
 *
 * CRITERIO (D10): ingreso = SOLO lo cobrado, es decir, lo que está en
 * pos_sales. Antes una cita "completed" sin venta se valoraba al precio de
 * lista del servicio: marcar "Completada" a mano en la agenda inventaba un
 * ingreso (y una comisión) sin que entrara un peso a caja. Ahora esa cita es
 * "por cobrar". Y al revés: una cita cobrada cuenta aunque alguien le haya
 * cambiado el estado después, porque la venta sigue en la caja.
 *
 * Las ventas se piden embebidas en la cita
 *   appointments.select("id, ..., pos_sales(total, payment_method, payments)")
 * en vez de un .in("appointment_id", [cientos de ids]) aparte: esa URL crecía
 * con cada cita, y si el servidor la rechazaba el error se ignoraba y todo
 * caía al precio de lista (CAL-05 / DIN-13).
 */

/** Venta POS tal como llega embebida en una cita o suelta. */
export type VentaResumen = {
  total: number | string | null;
  payment_method?: string | null;
  /** Desglose del pago dividido: [{ method, amount }]. Viene como Json. */
  payments?: unknown;
  created_at?: string | null;
};

type ConVentas = { pos_sales?: VentaResumen[] | VentaResumen | null };

/** Las ventas de una cita. El embed 1-N llega como arreglo; se toleran objeto y null. */
export function ventasDe(cita: ConVentas | null | undefined): VentaResumen[] {
  const v = cita?.pos_sales;
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

/** Monto de una venta (el total puede llegar como texto desde numeric). */
export function montoDe(venta: Pick<VentaResumen, "total"> | null | undefined): number {
  const n = Number(venta?.total ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Lo cobrado por una cita. Si tiene dos ventas se SUMAN (antes se quedaba con
 * la última y la Caja contaba las dos: DIN-06).
 */
export function cobradoDe(cita: ConVentas | null | undefined): number {
  return ventasDe(cita).reduce((s, v) => s + montoDe(v), 0);
}

/** true si la cita tiene al menos una venta: está cobrada, sea cual sea su estado. */
export function estaCobrada(cita: ConVentas | null | undefined): boolean {
  return ventasDe(cita).length > 0;
}

/**
 * Precio de lista de la cita: servicio principal + adicionales
 * (appointment_services), igual que el POS (DIN-23). Solo para "por cobrar" y
 * "pérdidas", nunca para ingresos.
 */
export function precioDeLista(cita: {
  services?: { price?: number | string | null } | null;
  appointment_services?: { price?: number | string | null }[] | null;
} | null | undefined): number {
  const base = Number(cita?.services?.price ?? 0);
  const extras = (cita?.appointment_services ?? []).reduce((s, x) => s + (Number(x?.price) || 0), 0);
  const n = (Number.isFinite(base) ? base : 0) + extras;
  return Number.isFinite(n) ? n : 0;
}

// ─── Medios de pago ──────────────────────────────────────────────────────────

/** Mismos colores que el portal web (PM_META de admin/page.tsx) más los que el web no tiene. */
// Nombre y color salen de lib/medios-pago: los mismos de la hoja de cobro.
export const MEDIOS_PAGO: Record<string, { label: string; color: string }> = Object.fromEntries(
  [...MEDIOS, MEDIO_OTRO].map(m => [m.key, { label: m.label, color: m.color }]),
);

/** Líneas de pago de una venta, con `payments` validado (llega como Json sin tipo). */
export function lineasDePago(venta: VentaResumen): PaymentLine[] {
  const p = Array.isArray(venta.payments)
    ? (venta.payments as unknown[])
        .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
        .map(x => ({ method: String(x.method ?? "otro"), amount: Number(x.amount) || 0 }))
    : null;
  return salePaymentLines({ payment_method: venta.payment_method, total: montoDe(venta), payments: p });
}

/**
 * Suma por medio de pago, EXPANDIENDO los pagos divididos: una venta de
 * $100.000 con $60.000 en efectivo y $40.000 por Nequi cuenta en cada uno, no
 * como una porción "mixto" (DIN-14 / CAL-23; igual que POS, Historial y Finanzas).
 */
export function desglosePorMedio(ventas: readonly VentaResumen[]): { key: string; label: string; value: number; color: string }[] {
  const mapa: Record<string, number> = {};
  for (const v of ventas) {
    for (const l of lineasDePago(v)) {
      const k = l.method || "otro";
      mapa[k] = (mapa[k] ?? 0) + l.amount;
    }
  }
  return Object.entries(mapa)
    .filter(([, value]) => value !== 0)
    .map(([key, value]) => ({
      key,
      value,
      label: MEDIOS_PAGO[key]?.label ?? key.charAt(0).toUpperCase() + key.slice(1),
      color: MEDIOS_PAGO[key]?.color ?? MEDIOS_PAGO.otro.color,
    }))
    .sort((a, b) => b.value - a.value);
}

// ─── Horas de las gráficas ───────────────────────────────────────────────────

/**
 * Horas a pintar en una gráfica por hora: el rango base (8–19 h) ampliado con
 * las horas que tengan datos. Antes se recortaba fijo y los cobros de las
 * 20 h no aparecían aunque sí sumaban en el número grande (TZ-09).
 */
export function rangoDeHoras(horasConDatos: readonly number[], min = 8, max = 19): number[] {
  let a = min, b = max;
  for (const h of horasConDatos) {
    if (!Number.isInteger(h) || h < 0 || h > 23) continue;
    if (h < a) a = h;
    if (h > b) b = h;
  }
  const out: number[] = [];
  for (let h = a; h <= b; h++) out.push(h);
  return out;
}

/** Hora (0–23) de un 'HH:MM[:SS]'; NaN si no se puede leer. */
export function horaDe(hhmm: string | null | undefined): number {
  const h = parseInt(String(hhmm ?? "").slice(0, 2), 10);
  return Number.isFinite(h) ? h : NaN;
}
