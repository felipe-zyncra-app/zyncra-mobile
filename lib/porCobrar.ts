import type { Href } from "expo-router";
import { supabase } from "./supabase";
import { esErrorDeRed, traerTodo } from "./db";
import { precioDeLista } from "./ingresos";
import { fmtDia } from "./tz";

/**
 * "Por cobrar": la tarjeta del Panel y su pantalla de detalle
 * (app/(admin)/por-cobrar.tsx) salen de AQUÍ, con la misma consulta y la
 * misma suma, así la cifra de la tarjeta y la de la pantalla son iguales por
 * construcción. Antes el Panel mostraba "$1.4M por cobrar" sin forma de saber
 * de qué citas era.
 *
 * QUÉ ENTRA (D10): toda cita, de CUALQUIER fecha, pendiente, confirmada o
 * completada que no tenga ninguna venta (pos_sales). No depende del periodo
 * Hoy / 7 días / 30 días del Panel. Una cita vive aquí hasta que alguien la
 * cobra o la marca Cancelada / No asistió. Se valora a precio de lista
 * (servicio principal + adicionales, lib/ingresos.ts): es plata comprometida,
 * nunca ingreso.
 *
 * VENCIDA / HOY / PRÓXIMA se decide con el día DEL NEGOCIO (hoyNegocio de
 * lib/tz.ts, que pasa quien llama): después de las 7 PM de Bogotá el UTC ya
 * es mañana, y una cita de esta mañana no está "vencida" todavía.
 * appointment_date y appointment_time ya están en la hora del negocio: se
 * muestran tal cual, sin convertir.
 *
 * Las funciones de agrupación son puras (lib/__tests__/por-cobrar-test.ts).
 */

/** Pantalla de detalle. Ruta nueva: las rutas tipadas (.expo/types) se regeneran con `expo start`. */
export const RUTA_POR_COBRAR = "/(admin)/por-cobrar" as Href;

/** Estados que siguen esperando cobro (con el anti-join de pos_sales). */
export const ESTADOS_POR_COBRAR = ["pending", "confirmed", "completed"] as const;

type Precio = number | string | null;

/** Lo mínimo para sumar: fecha, estado y precio de lista. */
export type CitaPorCobrar = {
  id: string;
  appointment_date: string;
  /** Solo lo trae la consulta de detalle; sirve para ordenar dentro del día. */
  appointment_time?: string | null;
  status: string;
  services: { name?: string | null; price?: Precio } | null;
  appointment_services: { name?: string | null; price: Precio }[] | null;
  pos_sales?: { id: string }[] | null;
};

/** Lo que muestra la pantalla: además hora, cliente, servicios, profesional y sede. */
export type CitaPorCobrarDetalle = CitaPorCobrar & {
  appointment_time: string;
  client_id: string | null;
  service_id: string | null;
  professional_id: string | null;
  location_id: string | null;
  clients: { name: string | null; phone?: string | null } | null;
  professionals: { name: string | null } | null;
};

// Dos selects con la MISMA consulta: el del Panel es liviano (la tarjeta solo
// suma) y el de la pantalla trae lo que se lista. pos_sales(id) va en los dos
// porque el anti-join (pos_sales=is.null) necesita el embed en el select.
// La sede se nombra con la lista de sedes (location_id), sin otro embed.
export const SELECT_TARJETA = "id, appointment_date, status, services(price), appointment_services(price), pos_sales(id)";
export const SELECT_DETALLE =
  "id, appointment_date, appointment_time, status, client_id, service_id, professional_id, location_id, "
  + "clients(name, phone), services(name, price), appointment_services(name, price), professionals(name), pos_sales(id)";

const CONTEXTO = "No se pudo calcular lo que está por cobrar";

/**
 * Citas sin cobrar de la sede `loc` (null = negocio sin sedes: todas).
 * Lanza ErrorDB si falla: nunca devuelve una lista a medias como si fuera
 * completa.
 */
async function consultar<T extends CitaPorCobrar>(select: string, tenantId: string, loc: string | null): Promise<T[]> {
  try {
    // Anti-join de PostgREST (pos_sales=is.null): solo las citas sin ninguna venta.
    return await traerTodo<T>((d, h) => {
      let q = supabase.from("appointments")
        .select(select)
        .eq("tenant_id", tenantId)
        .in("status", [...ESTADOS_POR_COBRAR])
        // Historial migrado de otro sistema (imported): ya se cobró allá.
        // Mismo filtro que el portal web (src/lib/por-cobrar.ts).
        .eq("imported", false)
        .is("pos_sales", null);
      if (loc) q = q.eq("location_id", loc);
      // Descendente: si algún día se llega al tope, se pierden las más viejas
      // (probablemente abandonadas) y no las futuras, que son compromisos reales.
      return q.order("appointment_date", { ascending: false }).order("id").range(d, h)
        .overrideTypes<T[], { merge: false }>();
    }, { contexto: CONTEXTO });
  } catch (e) {
    if (esErrorDeRed(e)) throw e;
    // Un servidor sin anti-join responde error de sintaxis: se cae al criterio
    // anterior (pendientes y confirmadas) quitando las que ya tienen venta.
    const filas = await traerTodo<T>((d, h) => {
      let q = supabase.from("appointments")
        .select(select)
        .eq("tenant_id", tenantId)
        .in("status", ["pending", "confirmed"])
        .eq("imported", false);
      if (loc) q = q.eq("location_id", loc);
      return q.order("appointment_date", { ascending: false }).order("id").range(d, h)
        .overrideTypes<T[], { merge: false }>();
    }, { contexto: CONTEXTO });
    return filas.filter(a => !(a.pos_sales && a.pos_sales.length > 0));
  }
}

/** Para la tarjeta del Panel: solo lo necesario para sumar. */
export function traerPorCobrar(tenantId: string, loc: string | null): Promise<CitaPorCobrar[]> {
  return consultar<CitaPorCobrar>(SELECT_TARJETA, tenantId, loc);
}

/** Para la pantalla Por cobrar: el mismo filtro, con lo que se lista. */
export function traerPorCobrarDetalle(tenantId: string, loc: string | null): Promise<CitaPorCobrarDetalle[]> {
  return consultar<CitaPorCobrarDetalle>(SELECT_DETALLE, tenantId, loc);
}

// ─── Agrupación (pura) ───────────────────────────────────────────────────────

export type Tramo<T> = { citas: T[]; total: number };

export type ResumenPorCobrar<T> = {
  /** Día del negocio con que se agrupó. */
  hoy: string;
  /** Lo mismo que muestra la tarjeta del Panel. */
  total: number;
  cantidad: number;
  /** Ya pasaron y nadie las cobró. Las más recientes primero. */
  vencidas: Tramo<T>;
  /** De hoy, por hora. */
  deHoy: Tramo<T>;
  /** De mañana en adelante, por fecha y hora. */
  proximas: Tramo<T>;
  /** Completadas sin venta (de cualquier fecha): por cobrar, no ingreso. */
  completadasSinCobro: number;
};

const comparar = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** Fecha y hora ordenables ('YYYY-MM-DD|HH:MM:SS'); sin hora, queda la fecha. */
const claveOrden = (c: CitaPorCobrar) => `${c.appointment_date ?? ""}|${(c.appointment_time ?? "").slice(0, 8)}`;
const ascendente = (a: CitaPorCobrar, b: CitaPorCobrar) => comparar(claveOrden(a), claveOrden(b)) || comparar(a.id, b.id);
const descendente = (a: CitaPorCobrar, b: CitaPorCobrar) => comparar(claveOrden(b), claveOrden(a)) || comparar(a.id, b.id);

function tramo<T extends CitaPorCobrar>(citas: T[], orden: (a: T, b: T) => number): Tramo<T> {
  const ordenadas = [...citas].sort(orden);
  return { citas: ordenadas, total: sumarPorCobrar(ordenadas) };
}

/** Suma a precio de lista (servicio + adicionales), igual que el POS. */
export function sumarPorCobrar(citas: readonly CitaPorCobrar[]): number {
  return citas.reduce((s, c) => s + precioDeLista(c), 0);
}

/**
 * Reparte las citas sin cobrar en vencidas / hoy / próximas según `hoy`, el
 * día DEL NEGOCIO ('YYYY-MM-DD', de hoyNegocio(timezone)). Cada cita cae en
 * un solo tramo, así que total = vencidas + hoy + próximas.
 */
export function agruparPorCobrar<T extends CitaPorCobrar>(citas: readonly T[], hoy: string): ResumenPorCobrar<T> {
  const vencidas: T[] = [], deHoy: T[] = [], proximas: T[] = [];
  for (const c of citas) {
    const dia = c.appointment_date ?? "";
    if (dia < hoy) vencidas.push(c);
    else if (dia === hoy) deHoy.push(c);
    else proximas.push(c);
  }
  const v = tramo(vencidas, descendente);
  const h = tramo(deHoy, ascendente);
  const p = tramo(proximas, ascendente);
  return {
    hoy,
    total: v.total + h.total + p.total,
    cantidad: citas.length,
    vencidas: v,
    deHoy: h,
    proximas: p,
    completadasSinCobro: citas.filter(c => c.status === "completed").length,
  };
}

/** Citas de un tramo agrupadas por día, en el orden en que vienen. */
export function porDia<T extends CitaPorCobrar>(citas: readonly T[]): { dia: string; citas: T[]; total: number }[] {
  const out: { dia: string; citas: T[]; total: number }[] = [];
  for (const c of citas) {
    const ultimo = out[out.length - 1];
    if (ultimo && ultimo.dia === c.appointment_date) {
      ultimo.citas.push(c);
      ultimo.total += precioDeLista(c);
    } else {
      out.push({ dia: c.appointment_date, citas: [c], total: precioDeLista(c) });
    }
  }
  return out;
}

// ─── Textos de cada fila ─────────────────────────────────────────────────────

const ESTADO: Record<string, string> = { pending: "Pendiente", confirmed: "Confirmada", completed: "Completada" };

/**
 * Estado a mostrar. Una completada sin venta siempre dice "sin cobro" (D10:
 * no es ingreso); una pendiente o confirmada lo dice cuando ya pasó.
 */
export function estadoPorCobrar(status: string, vencida: boolean): string {
  const base = ESTADO[status] ?? status;
  return status === "completed" || vencida ? `${base} sin cobro` : base;
}

/** "Corte + Barba": el servicio principal y los adicionales. */
export function serviciosDe(c: Pick<CitaPorCobrar, "services" | "appointment_services">): string {
  const nombres = [c.services?.name, ...(c.appointment_services ?? []).map(x => x?.name)]
    .map(n => (typeof n === "string" ? n.trim() : ""))
    .filter(Boolean);
  return nombres.length > 0 ? nombres.join(" + ") : "Sin servicio";
}

/** "sáb 12 jun" (con el año si no es el de `hoy`: una vencida puede ser de otro año). */
export function fechaPorCobrar(dia: string, hoy: string): string {
  const texto = fmtDia(dia, "semana-dia-mes");
  return dia.slice(0, 4) !== hoy.slice(0, 4) ? `${texto} ${dia.slice(0, 4)}` : texto;
}
