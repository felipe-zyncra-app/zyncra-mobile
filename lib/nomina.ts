import { Config, authedFetch } from "./config";

/**
 * Nómina del equipo (2026-10-01, pedido de Imperio Capilar).
 *
 * El cálculo vive SOLO en el servidor (src/lib/nomina.ts del repo web, detrás
 * de /api/nomina/*), así que el panel web y esta app muestran lo mismo. Aquí
 * no se calcula nada: estos son los tipos de lo que responde el servidor, las
 * llamadas, y ayudas de presentación (periodos, etiquetas).
 *
 * Lo que sí se escribe directo en la base, con la RLS del dueño:
 *   · payroll_profiles: básico, periodicidad, desde cuándo, % de productos.
 *   · commission_service_rules: comisión por servicio (y por persona).
 *   · payroll_adjustments: novedades manuales (bonus | tip | deduction).
 * Las propinas de caja y del POS las vuelve novedad un trigger.
 */

export type Dia = string;
export type ReglaTipo = "percentage" | "fixed";
export type Periodicidad = "mensual" | "quincenal" | "semanal";
export type TipoNovedad = "bonus" | "tip" | "deduction";

export interface Tramo { desde: Dia; hasta: Dia }

export interface Totales {
  citas: number;
  ventasServicios: number;
  comisionServicios: number;
  ventasProductos: number;
  comisionProductos: number;
}

export interface TramoComision extends Tramo, Totales { lineas: number }

export interface BasicoPendiente {
  salario: number;
  periodo: Periodicidad;
  desde: Dia;
  tramos: Tramo[];
  /** Días que se pagan: comerciales (30 por mes) o de calendario si es semanal. */
  dias: number;
  monto: number;
}

export interface Novedad {
  id: string;
  professional_id: string;
  kind: TipoNovedad;
  amount: number;
  entry_date: Dia;
  concept: string | null;
  source: "manual" | "caja" | "pos";
  pos_sale_item_id: string | null;
  statement_id: string | null;
}

export interface Pendiente {
  tramosComision: TramoComision[];
  comisiones: Totales;
  basico: BasicoPendiente | null;
  novedades: Novedad[];
  propinas: number;
  bonos: number;
  descuentos: number;
  total: number;
}

export interface Linea {
  tipo: "servicio" | "producto";
  professional_id: string;
  dia: Dia;
  cita_id: string | null;
  venta_id: string | null;
  item_id: string | null;
  service_id: string | null;
  nombre: string;
  cantidad: number;
  /** Lo cobrado por la línea, con el descuento de la venta repartido. */
  valor: number;
  comision: number;
  regla: "servicio" | "general" | "producto" | "ninguna";
  cliente: string | null;
  hora: string | null;
  /** El día ya está cubierto por una liquidación de comisión. */
  liquidada: boolean;
}

export interface ResumenProfesional {
  professional_id: string;
  nombre: string;
  activo: boolean;
  /** Todo lo atendido en el rango, pagado o no ("productividad"). */
  periodo: Totales;
  comisionLiquidada: number;
  pendiente: Pendiente;
  /** Para el dueño, solo con profesional_id o detalle=1. */
  lineas: Linea[];
  /** Citas pasadas del rango sin cerrar ni cobrar: no cuentan hasta cerrarlas. */
  citasSinCerrar: number;
  /** Se manda al liquidar: si algo cambió, el servidor responde 409. */
  firma: string;
}

export interface ResumenNomina {
  desde: Dia;
  hasta: Dia;
  hoy: Dia;
  rol: "owner" | "staff";
  profesionales: ResumenProfesional[];
  sinAsignar: { ventasServicios: number; ventasProductos: number };
}

/** Fila del historial: una colilla de nómina o una liquidación de comisión vieja. */
export interface ItemHistorial {
  tipo: "nomina" | "comision";
  id: string;
  professional_id: string;
  profesional: string;
  period_start: Dia;
  period_end: Dia;
  appointments_count: number;
  service_sales: number;
  service_commission: number;
  product_sales?: number;
  product_commission?: number;
  base_amount?: number;
  base_days?: number;
  tips_amount?: number;
  bonus_amount?: number;
  deduction_amount?: number;
  total_amount: number;
  note: string | null;
  paid_at: string;
}

export interface DetalleColilla {
  version: 1;
  profesional: string;
  desde: Dia;
  hasta: Dia;
  basico: (BasicoPendiente & { manual: boolean; calculado: number }) | null;
  lineas: Pick<Linea, "tipo" | "dia" | "hora" | "cliente" | "nombre" | "cantidad" | "valor" | "comision" | "regla">[];
  novedades: Pick<Novedad, "kind" | "amount" | "entry_date" | "concept" | "source">[];
}

export interface Colilla {
  liquidacion: {
    id: string;
    professional_id: string;
    period_start: Dia;
    period_end: Dia;
    appointments_count: number;
    service_sales: number;
    service_commission: number;
    product_sales: number;
    product_commission: number;
    base_amount: number;
    base_days: number;
    tips_amount: number;
    bonus_amount: number;
    deduction_amount: number;
    total_amount: number;
    note: string | null;
    paid_at: string;
    detail: DetalleColilla | null;
  };
  profesional: { nombre: string; cargo: string | null };
  negocio: { nombre: string; logo: string | null };
}

// ─── Llamadas ────────────────────────────────────────────────────────────────

/** Error del servidor con su código (p. ej. "cambio" en un 409 al liquidar). */
export class ErrorNomina extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = "ErrorNomina";
  }
}

async function pedir<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await authedFetch(url, init);
  const cuerpo = await res.json().catch(() => null) as { error?: string; code?: string } | null;
  if (!res.ok) {
    const porDefecto = res.status === 403
      ? "No tienes permiso para ver la nómina."
      : "No se pudo cargar la nómina. Revisa tu conexión e inténtalo de nuevo.";
    throw new ErrorNomina(cuerpo?.error || porDefecto, res.status, cuerpo?.code);
  }
  return cuerpo as T;
}

const qs = (p: Record<string, string | number | null | undefined>) =>
  Object.entries(p)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");

export function leerResumen(p: {
  tenantId: string; desde: Dia; hasta: Dia; profesionalId?: string | null; detalle?: boolean;
}): Promise<ResumenNomina> {
  return pedir(`${Config.api.nomina}/resumen?${qs({
    tenant_id: p.tenantId, desde: p.desde, hasta: p.hasta,
    profesional_id: p.profesionalId, detalle: p.detalle ? 1 : null,
  })}`);
}

export function liquidar(p: {
  tenantId: string; profesionalId: string; desde: Dia; hasta: Dia; firma: string;
  /** uuid generado al abrir la confirmación: reintentar con el mismo no duplica. */
  statementId: string;
  basicoManual?: number | null;
  nota?: string | null;
}): Promise<{ ok: true; statementId: string; total: number; duplicado?: boolean }> {
  return pedir(`${Config.api.nomina}/liquidar`, { method: "POST", body: JSON.stringify(p) });
}

export function leerHistorial(p: {
  tenantId: string; profesionalId?: string | null; limit?: number; antes?: string | null;
}): Promise<{ items: ItemHistorial[]; hayMas: boolean }> {
  return pedir(`${Config.api.nomina}/liquidaciones?${qs({
    tenant_id: p.tenantId, profesional_id: p.profesionalId, limit: p.limit, antes: p.antes,
  })}`);
}

export function leerColilla(tenantId: string, id: string): Promise<Colilla> {
  return pedir(`${Config.api.nomina}/liquidaciones/${encodeURIComponent(id)}?${qs({ tenant_id: tenantId })}`);
}

export function anularLiquidacion(tenantId: string, statementId: string): Promise<{ ok: true }> {
  return pedir(`${Config.api.nomina}/anular`, { method: "POST", body: JSON.stringify({ tenantId, statementId }) });
}

// ─── Periodos rápidos (mismas reglas que el web) ─────────────────────────────

function ultimoDiaDelMes(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function sumarDias(d: Dia, n: number): Dia {
  const [y, m, dd] = d.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, dd + n));
  return t.toISOString().slice(0, 10);
}

/** Quincena de `hoy`: 1 al 15, o 16 a fin de mes. */
export function quincenaDe(hoy: Dia): Tramo {
  const y = Number(hoy.slice(0, 4));
  const m = Number(hoy.slice(5, 7));
  const d = Number(hoy.slice(8, 10));
  const mm = String(m).padStart(2, "0");
  if (d <= 15) return { desde: `${y}-${mm}-01`, hasta: `${y}-${mm}-15` };
  return { desde: `${y}-${mm}-16`, hasta: `${y}-${mm}-${String(ultimoDiaDelMes(y, m)).padStart(2, "0")}` };
}

/** Mes de `hoy`. */
export function mesDe(hoy: Dia): Tramo {
  const y = Number(hoy.slice(0, 4));
  const m = Number(hoy.slice(5, 7));
  const mm = String(m).padStart(2, "0");
  return { desde: `${y}-${mm}-01`, hasta: `${y}-${mm}-${String(ultimoDiaDelMes(y, m)).padStart(2, "0")}` };
}

/** Semana (lunes a domingo) de `hoy`. */
export function semanaDe(hoy: Dia): Tramo {
  const [y, m, d] = hoy.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const desde = sumarDias(hoy, dow === 0 ? -6 : 1 - dow);
  return { desde, hasta: sumarDias(desde, 6) };
}

export type TipoPeriodo = "quincena" | "mes" | "semana";

export function periodoDe(tipo: TipoPeriodo, hoy: Dia): Tramo {
  return tipo === "quincena" ? quincenaDe(hoy) : tipo === "mes" ? mesDe(hoy) : semanaDe(hoy);
}

/** El periodo anterior (o siguiente, con paso 1) del mismo tipo. */
export function moverPeriodo(tipo: TipoPeriodo, actual: Tramo, paso: -1 | 1): Tramo {
  const ancla = paso < 0 ? sumarDias(actual.desde, -1) : sumarDias(actual.hasta, 1);
  return periodoDe(tipo, ancla);
}

// ─── Etiquetas ───────────────────────────────────────────────────────────────

export const ETIQUETA_NOVEDAD: Record<TipoNovedad, string> = {
  bonus: "Bonificación",
  tip: "Propina",
  deduction: "Descuento o adelanto",
};

export const ETIQUETA_PERIODICIDAD: Record<Periodicidad, string> = {
  mensual: "Mensual",
  quincenal: "Quincenal",
  semanal: "Semanal",
};

export const ETIQUETA_REGLA: Record<Linea["regla"], string> = {
  servicio: "Regla del servicio",
  general: "Regla general",
  producto: "% de productos",
  ninguna: "Sin comisión",
};

/** ¿Hay algo que pagarle? (comisión, básico o novedades pendientes). */
export function hayPendiente(p: Pendiente): boolean {
  return p.tramosComision.length > 0 || p.basico !== null || p.novedades.length > 0;
}
