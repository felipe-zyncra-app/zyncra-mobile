import { supabase } from "./supabase";
import { getActiveLocationId } from "./active-location";

/**
 * Registro de un cobro desde el móvil — espejo del POS web
 * (src/app/admin/pos/page.tsx, handleCharge). Una venta son TRES filas:
 *
 *   · pos_sales       → la venta: dashboards, "total gastado" del CRM, finanzas
 *   · pos_sale_items  → el detalle: la Caja web muestra los ítems de cada venta
 *   · cash_movements  → el ingreso en la caja abierta: Caja (web y móvil) suma
 *                       SOLO cash_movements, así que una venta sin movimiento
 *                       es invisible en el arqueo y el cierre nunca cuadra
 *
 * Antes el móvil insertaba únicamente pos_sales: los cobros hechos desde el
 * celular aparecían en el dashboard pero nunca en la Caja.
 *
 * Igual que el web, exige caja abierta en la sede activa. Si no hay, devuelve
 * NO_CASH_SESSION sin tocar nada y el caller decide (aviso + ir a Caja).
 */

export type OpenCashSession = { id: string; location_id: string | null };

/**
 * Caja abierta con el mismo alcance que /admin/caja y el POS web: si hay sede
 * activa, la sesión tiene que ser de ESA sede; sin sede, cualquier abierta.
 * `locationId` undefined → se resuelve la sede activa; null → sin filtro de sede.
 */
export async function findOpenCashSession(
  tenantId: string,
  locationId?: string | null,
): Promise<OpenCashSession | null> {
  const loc = locationId === undefined ? await getActiveLocationId(tenantId) : locationId;
  let q = supabase.from("cash_sessions")
    .select("id, location_id")
    .eq("tenant_id", tenantId)
    .is("closed_at", null);
  if (loc) q = q.eq("location_id", loc);
  const { data } = await q.order("opened_at", { ascending: false }).limit(1).maybeSingle();
  return data ? { id: data.id, location_id: (data.location_id as string | null) ?? null } : null;
}

export interface SaleItemInput {
  name: string;
  price: number;
  quantity: number;
  service_id?: string | null;
  product_id?: string | null;
  item_type?: "service" | "product";
  /** Costo unitario del producto (para el costo de lo vendido en inventario). */
  unit_cost?: number | null;
}

export interface PaymentLine { method: string; amount: number }

export interface RecordSaleInput {
  tenantId: string;
  total: number;
  /** Antes del descuento. Default: total. */
  subtotal?: number;
  discountType?: "percentage" | "fixed" | null;
  discountValue?: number;
  /** Método único, o "mixto" si viene `payments` (pago dividido, igual que el POS web). */
  paymentMethod: string;
  /** Pago dividido: un movimiento de caja por cada línea, para que Caja los separe sola. */
  payments?: PaymentLine[] | null;
  items: SaleItemInput[];
  clientId?: string | null;
  appointmentId?: string | null;
  /** Sede de la venta (la de la cita). Si no viene, se usa la sede activa. */
  locationId?: string | null;
  note?: string | null;
  /** Texto del movimiento de caja. Default: "Venta POS · {note}". */
  description?: string;
}

export type RecordSaleResult =
  | { ok: true; saleId: string }
  | { ok: false; error: "NO_CASH_SESSION" | "SALE_FAILED" | "APPOINTMENT_FAILED" };

export async function recordSale(input: RecordSaleInput): Promise<RecordSaleResult> {
  const locationId = input.locationId ?? await getActiveLocationId(input.tenantId);
  const session = await findOpenCashSession(input.tenantId, locationId);
  if (!session) return { ok: false, error: "NO_CASH_SESSION" };

  const payments = input.payments && input.payments.length > 0 ? input.payments : null;
  const paymentMethod = payments ? "mixto" : input.paymentMethod;
  const saleLocation = locationId ?? session.location_id;

  const { data: sale, error: saleErr } = await supabase.from("pos_sales").insert({
    tenant_id: input.tenantId,
    // En vista sin sede la venta hereda la sede de la caja abierta (igual que el web)
    location_id: saleLocation,
    client_id: input.clientId ?? null,
    appointment_id: input.appointmentId ?? null,
    subtotal: input.subtotal ?? input.total,
    discount_type: input.discountType ?? null,
    discount_value: input.discountValue ?? 0,
    total: input.total,
    payment_method: paymentMethod,
    payments,
    note: input.note ?? null,
  }).select("id").single();
  if (saleErr || !sale) return { ok: false, error: "SALE_FAILED" };

  await supabase.from("pos_sale_items").insert(
    input.items.map(i => ({
      sale_id: sale.id,
      service_id: i.service_id ?? null,
      product_id: i.product_id ?? null,
      item_type: i.item_type ?? "service",
      name: i.name,
      price: i.price,
      quantity: i.quantity,
    })),
  );

  // Productos vendidos → salida de inventario (el stock se recalcula desde los
  // movimientos, igual que hace el POS web).
  const productItems = input.items.filter(i => i.product_id);
  if (productItems.length > 0) {
    await supabase.from("inventory_movements").insert(
      productItems.map(i => ({
        tenant_id: input.tenantId,
        product_id: i.product_id,
        type: "sale",
        quantity: -i.quantity,
        reference: sale.id,
        notes: `Venta POS${input.note ? ` · ${input.note}` : ""}`,
        unit_cost: i.unit_cost ?? null,
        ...(saleLocation ? { location_id: saleLocation } : {}),
      })),
    );
  }

  const description = input.description ?? `Venta POS${input.note ? ` · ${input.note}` : ""}`;
  const movementBase = {
    session_id: session.id,
    tenant_id: input.tenantId,
    type: "ingreso",
    description,
    category: "POS",
    pos_sale_id: sale.id,
  };
  await supabase.from("cash_movements").insert(
    payments
      ? payments.map(p => ({ ...movementBase, amount: p.amount, payment_method: p.method }))
      : [{ ...movementBase, amount: input.total, payment_method: input.paymentMethod }],
  );

  // La cita se marca al final: si no hay caja o la venta falla, la cita no
  // queda "completada" sin cobro registrado.
  if (input.appointmentId) {
    const { error } = await supabase.from("appointments")
      .update({ status: "completed" })
      .eq("id", input.appointmentId);
    if (error) return { ok: false, error: "APPOINTMENT_FAILED" };
  }

  return { ok: true, saleId: sale.id };
}

/**
 * Anula un cobro. cash_movements.pos_sale_id es ON DELETE SET NULL (no
 * cascade): sin borrarlo explícito quedaba un ingreso huérfano en la caja y el
 * arqueo seguía contando la venta anulada. pos_sale_items sí cascadea.
 */
export async function voidSale(saleId: string, appointmentId?: string | null): Promise<{ ok: boolean }> {
  await supabase.from("cash_movements").delete().eq("pos_sale_id", saleId);
  const { error } = await supabase.from("pos_sales").delete().eq("id", saleId);
  if (error) return { ok: false };
  if (appointmentId) {
    await supabase.from("appointments").update({ status: "confirmed" }).eq("id", appointmentId);
  }
  return { ok: true };
}
