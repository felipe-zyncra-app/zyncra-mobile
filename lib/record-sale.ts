import { supabase } from "./supabase";
import { getActiveLocationId } from "./active-location";
import { esErrorDeRed, mensajeError, nuevoId } from "./db";
import { verificarContrasena } from "./auth";
import { filtroSedeOGeneral, preferirCajaDeSede, sedeDeStock } from "./sedes";

/**
 * Registro de un cobro desde el móvil — espejo del POS web
 * (src/app/admin/pos/page.tsx, handleCharge). Una venta son estas filas:
 *
 *   · pos_sales           → la venta: dashboards, "total gastado" del CRM, finanzas
 *   · pos_sale_items      → el detalle: la Caja web muestra los ítems de cada venta
 *   · cash_movements      → el ingreso en la caja abierta: Caja (web y móvil) suma
 *                           SOLO cash_movements, así que una venta sin movimiento
 *                           es invisible en el arqueo y el cierre nunca cuadra
 *   · inventory_movements → salida de stock de los productos (un trigger AFTER
 *                           INSERT descuenta products.stock_quantity)
 *
 * Igual que el web, exige caja abierta en la sede activa. Si no hay, devuelve
 * NO_CASH_SESSION sin tocar nada y el caller decide (aviso + ir a Caja).
 *
 * ATOMICIDAD SIN RPC (DIN-04 / CAL-06)
 * Lo correcto es una función SQL transaccional; mientras no exista:
 *   · el id de la venta lo genera el teléfono (`saleId`, uno por hoja de
 *     cobro). Si se pierde la respuesta de un insert que sí entró, el
 *     reintento con el MISMO id encuentra la venta y completa lo que falte en
 *     vez de crear otra (sin doble ingreso ni doble salida de inventario);
 *   · cada paso revisa su error; si uno falla, se deshace lo creado
 *     (compensación) y se devuelve el error con un mensaje en español;
 *   · dos llamadas simultáneas con el mismo saleId (doble toque) comparten la
 *     misma operación;
 *   · no se cobra dos veces una cita que ya tiene venta (DIN-06).
 * El inventario va al final porque es lo único que no se deshace borrando: el
 * trigger solo actúa al insertar.
 */

export type OpenCashSession = { id: string; location_id: string | null };

/**
 * Caja abierta con el mismo alcance que /admin/caja y el POS web: si hay sede
 * activa, la sesión tiene que ser de ESA sede; sin sede, cualquier abierta.
 * `locationId` undefined → se resuelve la sede activa; null → sin filtro de sede.
 * `incluirGeneral`: la caja general (sin sede) también cuenta, prefiriendo la
 * de la sede (negocio de una sola sede, ver incluyeCajaGeneral). El cobro no
 * lo usa: el POS web exige la caja de la sede.
 * Devuelve null si no hay caja abierta y LANZA si la consulta falla (antes un
 * corte de red se leía como "la caja está cerrada").
 */
export async function findOpenCashSession(
  tenantId: string,
  locationId?: string | null,
  opciones: { incluirGeneral?: boolean } = {},
): Promise<OpenCashSession | null> {
  const loc = locationId === undefined ? await getActiveLocationId(tenantId) : locationId;
  let q = supabase.from("cash_sessions")
    .select("id, location_id")
    .eq("tenant_id", tenantId)
    .is("closed_at", null);
  const conGeneral = !!loc && !!opciones.incluirGeneral;
  if (loc && conGeneral) q = q.or(filtroSedeOGeneral(loc));
  else if (loc) q = q.eq("location_id", loc);
  const { data, error } = await q.order("opened_at", { ascending: false }).limit(conGeneral ? 2 : 1);
  if (error) throw error;
  const lista = (data ?? []).map(c => ({ id: c.id, location_id: (c.location_id as string | null) ?? null }));
  return conGeneral ? preferirCajaDeSede(lista, loc) : lista[0] ?? null;
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
  /**
   * Sede del producto (dueña del stock): su salida de inventario va a esa sede.
   * null/undefined = producto viejo sin sede → la de la venta.
   */
  location_id?: string | null;
}

export interface PaymentLine { method: string; amount: number }

export interface RecordSaleInput {
  /**
   * Clave de idempotencia = id de la venta. Generarla UNA vez al abrir la hoja
   * de cobro (nuevoId() de lib/db) y reutilizarla en cada reintento. Si no
   * viene se genera aquí, pero entonces un reintento no se reconoce.
   */
  saleId?: string;
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

export type RecordSaleError = "NO_CASH_SESSION" | "SALE_FAILED" | "APPOINTMENT_FAILED" | "ALREADY_CHARGED";

export type RecordSaleResult =
  | {
      ok: true;
      saleId: string;
      /** true si la venta ya existía (reintento de un cobro que sí había entrado). */
      yaExistia?: boolean;
    }
  | {
      ok: false;
      error: RecordSaleError;
      /** Mensaje en español listo para mostrar. */
      message: string;
      /** ALREADY_CHARGED: la venta existente. APPOINTMENT_FAILED: la venta creada. */
      saleId?: string;
      /**
       * true si quedó algo a medias que no se pudo deshacer (sin red). Reintentar
       * con el MISMO saleId lo completa.
       */
      pendiente?: boolean;
    };

const MSG_RED = "Revisa tu conexión e inténtalo de nuevo. Si el cobro alcanzó a guardarse, el reintento no lo duplica.";

const enVuelo = new Map<string, Promise<RecordSaleResult>>();

export function recordSale(input: RecordSaleInput): Promise<RecordSaleResult> {
  const saleId = input.saleId || nuevoId();
  const previa = enVuelo.get(saleId);
  if (previa) return previa;
  const p = registrar({ ...input, saleId }).finally(() => enVuelo.delete(saleId));
  enVuelo.set(saleId, p);
  return p;
}

function fallo(error: RecordSaleError, err: unknown, extra: { saleId?: string; pendiente?: boolean } = {}): RecordSaleResult {
  const message = error === "SALE_FAILED"
    ? (esErrorDeRed(err) ? MSG_RED : mensajeError(err, "No se pudo registrar el cobro"))
    : mensajeError(err);
  return { ok: false, error, message, ...extra };
}

async function contar(tabla: "pos_sale_items" | "cash_movements" | "inventory_movements", col: string, saleId: string, extra?: (q: any) => any): Promise<number> {
  let q = supabase.from(tabla).select("id", { count: "exact", head: true }).eq(col, saleId);
  if (extra) q = extra(q);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

async function ventaExiste(saleId: string): Promise<boolean> {
  const { data, error } = await supabase.from("pos_sales").select("id").eq("id", saleId).maybeSingle();
  if (error) throw error;
  return !!data;
}

/** Deshace lo creado. Devuelve false si no se pudo (queda pendiente para el reintento). */
async function compensar(saleId: string, pasos: { movimientos?: boolean }): Promise<boolean> {
  try {
    if (pasos.movimientos) {
      const { error } = await supabase.from("cash_movements").delete().eq("pos_sale_id", saleId);
      if (error) return false;
    }
    // pos_sale_items cae en cascada con la venta.
    const { error } = await supabase.from("pos_sales").delete().eq("id", saleId);
    return !error;
  } catch {
    return false;
  }
}

async function registrar(input: RecordSaleInput & { saleId: string }): Promise<RecordSaleResult> {
  const { saleId } = input;
  const payments = input.payments && input.payments.length > 0 ? input.payments : null;
  const paymentMethod = payments ? "mixto" : input.paymentMethod;

  let session: OpenCashSession | null;
  let locationId: string | null;
  let existia = false;
  try {
    locationId = input.locationId ?? await getActiveLocationId(input.tenantId);
    existia = await ventaExiste(saleId);

    // Una cita ya cobrada (por otra hoja, otro dispositivo o el web) no se
    // vuelve a cobrar: panel y comisiones contaban una venta y la Caja dos.
    if (!existia && input.appointmentId) {
      const { data: otra, error } = await supabase.from("pos_sales")
        .select("id").eq("appointment_id", input.appointmentId).neq("id", saleId).limit(1);
      if (error) throw error;
      if (otra && otra.length > 0) {
        // La cita pudo quedar sin marcar si aquel cobro falló al final.
        await supabase.from("appointments").update({ status: "completed" })
          .eq("id", input.appointmentId).in("status", ["pending", "confirmed"]);
        return {
          ok: false,
          error: "ALREADY_CHARGED",
          saleId: otra[0].id,
          message: "Esta cita ya tiene un cobro registrado. Si hay que corregirlo, anúlalo desde el historial de cobros y vuelve a cobrar.",
        };
      }
    }

    session = await findOpenCashSession(input.tenantId, locationId);
  } catch (e) {
    return fallo("SALE_FAILED", e);
  }
  if (!session) {
    return {
      ok: false,
      error: "NO_CASH_SESSION",
      message: "La caja está cerrada. Abre la caja de esta sede antes de cobrar.",
    };
  }
  const saleLocation = locationId ?? session.location_id;

  // 1. La venta.
  if (!existia) {
    const { error } = await supabase.from("pos_sales").insert({
      id: saleId,
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
    });
    if (error) {
      // ¿Entró aunque se perdió la respuesta, o un doble envío ganó la carrera?
      let entro = false;
      try { entro = await ventaExiste(saleId); } catch { entro = false; }
      if (!entro) {
        if ((error as { code?: string }).code === "23505" && input.appointmentId) {
          // Índice único por cita (cuando exista): otro dispositivo la cobró.
          return { ok: false, error: "ALREADY_CHARGED", message: "Esta cita ya tiene un cobro registrado." };
        }
        return fallo("SALE_FAILED", error);
      }
      existia = true;
    }
  }

  // 2. Ítems (todo o nada: un solo insert).
  try {
    const yaHay = existia ? await contar("pos_sale_items", "sale_id", saleId) : 0;
    if (yaHay === 0 && input.items.length > 0) {
      const { error } = await supabase.from("pos_sale_items").insert(
        input.items.map(i => ({
          sale_id: saleId,
          service_id: i.service_id ?? null,
          product_id: i.product_id ?? null,
          item_type: i.item_type ?? "service",
          name: i.name,
          price: i.price,
          quantity: i.quantity,
        })),
      );
      if (error && (await contar("pos_sale_items", "sale_id", saleId).catch(() => 0)) === 0) throw error;
    }
  } catch (e) {
    const ok = await compensar(saleId, {});
    return fallo("SALE_FAILED", e, { pendiente: !ok });
  }

  // 3. Ingreso en la caja abierta.
  try {
    const yaHay = existia ? await contar("cash_movements", "pos_sale_id", saleId) : 0;
    if (yaHay === 0) {
      const description = input.description ?? `Venta POS${input.note ? ` · ${input.note}` : ""}`;
      const base = {
        session_id: session.id,
        tenant_id: input.tenantId,
        type: "ingreso",
        description,
        category: "POS",
        pos_sale_id: saleId,
      };
      const { error } = await supabase.from("cash_movements").insert(
        payments
          ? payments.map(p => ({ ...base, amount: p.amount, payment_method: p.method }))
          : [{ ...base, amount: input.total, payment_method: input.paymentMethod }],
      );
      if (error && (await contar("cash_movements", "pos_sale_id", saleId).catch(() => 0)) === 0) throw error;
    }
  } catch (e) {
    const ok = await compensar(saleId, { movimientos: true });
    return fallo("SALE_FAILED", e, { pendiente: !ok });
  }

  // 4. Salida de inventario (al final: no se deshace borrando).
  const productItems = input.items.filter(i => i.product_id);
  if (productItems.length > 0) {
    try {
      const yaHay = existia
        ? await contar("inventory_movements", "reference", saleId, q => q.eq("type", "sale"))
        : 0;
      if (yaHay === 0) {
        const { error } = await supabase.from("inventory_movements").insert(
          productItems.map(i => ({
            tenant_id: input.tenantId,
            product_id: i.product_id,
            type: "sale",
            quantity: -i.quantity,
            reference: saleId,
            notes: `Venta POS${input.note ? ` · ${input.note}` : ""}`,
            unit_cost: i.unit_cost ?? null,
            // Sede del producto, o la de la venta si es uno viejo sin sede
            // (igual que el POS web, auditoría #11).
            location_id: sedeDeStock(i.location_id, saleLocation),
          })),
        );
        if (error) {
          const entro = await contar("inventory_movements", "reference", saleId, q => q.eq("type", "sale")).catch(() => -1);
          if (entro === 0) throw error;
          if (entro < 0) {
            // No se sabe si entró: no se deshace la venta (podría descontar
            // stock dos veces); el reintento con el mismo id lo aclara.
            return fallo("SALE_FAILED", error, { saleId, pendiente: true });
          }
        }
      }
    } catch (e) {
      const ok = await compensar(saleId, { movimientos: true });
      return fallo("SALE_FAILED", e, { pendiente: !ok });
    }
  }

  // 5. La cita se marca al final: si no hay caja o la venta falla, la cita no
  // queda "completada" sin cobro registrado. .select() detecta 0 filas (RLS).
  if (input.appointmentId) {
    const { data, error } = await supabase.from("appointments")
      .update({ status: "completed" })
      .eq("id", input.appointmentId)
      .select("id");
    if (error || !data || data.length === 0) {
      return {
        ok: false,
        error: "APPOINTMENT_FAILED",
        saleId,
        message: "El cobro quedó registrado en la caja, pero la cita no se marcó como completada. Revísala en la agenda.",
      };
    }
  }

  return { ok: true, saleId, ...(existia ? { yaExistia: true } : {}) };
}

// ─── Anular un cobro ──────────────────────────────────────────────────────────

export type VoidSaleError = "NOT_ALLOWED" | "HAS_INVOICE" | "HAS_GIFT_CARD" | "NO_CASH_SESSION" | "FAILED";

export type VoidSaleResult =
  | {
      ok: true;
      /** Algo secundario no se pudo (stock o estado de la cita): mostrarlo como aviso. */
      aviso?: string;
    }
  | { ok: false; error: VoidSaleError; message: string };

type MovimientoCaja = {
  id: string;
  session_id: string;
  tenant_id: string;
  type: string;
  amount: number;
  description: string;
  category: string | null;
  payment_method: string | null;
  created_at: string;
  cash_sessions: { closed_at: string | null } | null;
};

type MovimientoStock = {
  product_id: string;
  quantity: number;
  type: string;
  unit_cost: number | null;
  location_id: string | null;
  products: { location_id: string | null } | null;
};

/**
 * Anula un cobro (DIN-08 / ESQ-20).
 *
 *  · Con `contrasena`, primero verifica la del usuario (el web la exige). La
 *    UI debería pedirla; si no viene, se anula como antes.
 *  · No anula ventas con factura electrónica vigente ni con bono redimido:
 *    eso se revierte desde el panel web.
 *  · Movimientos de una caja YA CERRADA no se borran (su arqueo ya se contó):
 *    se registra un egreso "Anulación" en la caja abierta de hoy, que es de
 *    donde sale el dinero devuelto.
 *  · Movimientos de la caja abierta se borran (cash_movements.pos_sale_id es
 *    SET NULL, no cascade: sin borrarlos quedaba un ingreso huérfano).
 *  · Devuelve el stock con movimientos 'return' (borrar los 'sale' no repone:
 *    el trigger solo actúa al insertar).
 *  · Devuelve la cita a "confirmada" solo si no le queda otra venta.
 */
export async function voidSale(
  saleId: string,
  appointmentId?: string | null,
  opciones: { contrasena?: string } = {},
): Promise<VoidSaleResult> {
  const falla = (e: unknown, ctx = "No se pudo anular el cobro"): VoidSaleResult =>
    ({ ok: false, error: "FAILED", message: mensajeError(e, ctx) });

  if (opciones.contrasena !== undefined) {
    const v = await verificarContrasena(opciones.contrasena);
    if (!v.ok) return { ok: false, error: "NOT_ALLOWED", message: v.mensaje ?? "La contraseña no es correcta." };
  }

  // 0. Leer todo antes de tocar nada.
  const { data: sale, error: eSale } = await supabase.from("pos_sales")
    .select("id, tenant_id, location_id, appointment_id, total")
    .eq("id", saleId).maybeSingle();
  if (eSale) return falla(eSale);
  if (!sale) return { ok: true };   // ya estaba anulada: nada que hacer
  const apptId = appointmentId ?? (sale.appointment_id as string | null) ?? null;

  const [inv, gift, movs, stock] = await Promise.all([
    supabase.from("invoices").select("id, number, status, credit_note_cufe").eq("pos_sale_id", saleId),
    supabase.from("gift_card_transactions").select("id").eq("pos_sale_id", saleId).eq("type", "redencion"),
    supabase.from("cash_movements")
      .select("id, session_id, tenant_id, type, amount, description, category, payment_method, created_at, cash_sessions(closed_at)")
      .eq("pos_sale_id", saleId),
    supabase.from("inventory_movements")
      .select("product_id, quantity, type, unit_cost, location_id, products(location_id)")
      .eq("reference", saleId),
  ]);
  const errLectura = inv.error || gift.error || movs.error || stock.error;
  if (errLectura) return falla(errLectura);

  // Factura vigente = emitida y sin nota crédito. Mismo criterio que el portal
  // (/api/factus y pos-sales/delete): los borradores 'rejected' nunca se
  // emitieron y las 'credited' ya tienen su nota crédito, así que no bloquean.
  const vigente = (inv.data ?? []).find(f =>
    !f.credit_note_cufe && f.status !== "rejected" && f.status !== "credited");
  if (vigente) {
    return {
      ok: false,
      error: "HAS_INVOICE",
      message: `Este cobro tiene la factura electrónica #${vigente.number || "—"} vigente. Emite primero su nota crédito desde el panel web y luego anula el cobro.`,
    };
  }
  // No hay forma atómica de devolver el saldo de un bono: ni el móvil ni el
  // portal anulan estos cobros. Mismo mensaje que el portal.
  if ((gift.data ?? []).length > 0) {
    return {
      ok: false,
      error: "HAS_GIFT_CARD",
      message: "Este cobro se pagó con un bono de regalo y no se puede anular. Si hay que devolverle ese dinero al cliente, emítele un bono de cortesía desde el panel web (Bonos → «Emitir cortesía»). El cobro queda como está.",
    };
  }

  const movimientos = (movs.data ?? []) as unknown as MovimientoCaja[];
  const abiertos = movimientos.filter(m => !m.cash_sessions?.closed_at);
  const cerrados = movimientos.filter(m => !!m.cash_sessions?.closed_at);

  // 1. Caja ya cerrada → egreso en la caja abierta de hoy.
  let egresosCreados: string[] = [];
  if (cerrados.length > 0) {
    let abierta: OpenCashSession | null;
    try {
      abierta = await findOpenCashSession(sale.tenant_id as string, (sale.location_id as string | null) ?? null);
    } catch (e) {
      return falla(e);
    }
    if (!abierta) {
      return {
        ok: false,
        error: "NO_CASH_SESSION",
        message: "Este cobro es de una caja ya cerrada. Abre la caja de hoy para registrar la devolución del dinero y vuelve a intentarlo.",
      };
    }
    const filas = cerrados.map(m => ({
      id: nuevoId(),
      session_id: abierta!.id,
      tenant_id: m.tenant_id,
      type: m.type === "ingreso" ? "egreso" : "ingreso",
      amount: m.amount,
      payment_method: m.payment_method,
      category: m.category ?? "POS",
      description: `Anulación · ${m.description}`.slice(0, 500),
      pos_sale_id: null,
    }));
    const { error } = await supabase.from("cash_movements").insert(filas);
    if (error) return falla(error);
    egresosCreados = filas.map(f => f.id);
  }

  const deshacerEgresos = async () => {
    if (egresosCreados.length > 0) await supabase.from("cash_movements").delete().in("id", egresosCreados);
  };

  // 2. Borrar los ingresos de la caja abierta (por id: después de borrar la
  //    venta quedarían con pos_sale_id null y ya no se podrían encontrar).
  if (abiertos.length > 0) {
    const { error } = await supabase.from("cash_movements").delete().in("id", abiertos.map(m => m.id));
    if (error) {
      await deshacerEgresos();
      return falla(error);
    }
  }

  // 3. Borrar la venta (los ítems caen en cascada).
  const { data: borrada, error: eDel } = await supabase.from("pos_sales").delete().eq("id", saleId).select("id");
  if (eDel || !borrada || borrada.length === 0) {
    // Devolver la caja a como estaba.
    if (abiertos.length > 0) {
      await supabase.from("cash_movements").insert(abiertos.map(m => ({
        id: m.id,
        session_id: m.session_id,
        tenant_id: m.tenant_id,
        type: m.type,
        amount: m.amount,
        description: m.description,
        category: m.category,
        payment_method: m.payment_method,
        created_at: m.created_at,
        pos_sale_id: saleId,
      })));
    }
    await deshacerEgresos();
    return eDel
      ? falla(eDel)
      : { ok: false, error: "NOT_ALLOWED", message: "No tienes permiso para anular este cobro." };
  }

  const avisos: string[] = [];

  // 4. Reponer stock de lo que salió por esta venta (si no se repuso ya).
  //    La devolución va a la misma sede que la salida. Las salidas anteriores
  //    al 29-sep no tienen sede: se usa la del producto y, si tampoco tiene,
  //    la de la venta (mismo orden que pos-sales/delete del portal).
  const movsStock = (stock.data ?? []) as unknown as MovimientoStock[];
  const salidas = movsStock.filter(m => m.type === "sale");
  const yaRepuesto = movsStock.some(m => m.type === "return");
  if (salidas.length > 0 && !yaRepuesto) {
    const { error } = await supabase.from("inventory_movements").insert(salidas.map(m => ({
      tenant_id: sale.tenant_id,
      product_id: m.product_id,
      type: "return",
      quantity: Math.abs(Number(m.quantity) || 0),
      reference: saleId,
      notes: "Anulación de venta POS",
      unit_cost: m.unit_cost ?? null,
      location_id: sedeDeStock(m.location_id ?? m.products?.location_id, (sale.location_id as string | null) ?? null),
    })));
    if (error) avisos.push("No se pudo devolver el stock de los productos: ajústalo en Inventario.");
  }

  // 5. La cita vuelve a confirmada solo si no le queda otra venta.
  if (apptId) {
    const { data: otras, error } = await supabase.from("pos_sales").select("id").eq("appointment_id", apptId).limit(1);
    if (!error && (otras ?? []).length === 0) {
      const { error: eAppt } = await supabase.from("appointments")
        .update({ status: "confirmed" }).eq("id", apptId).eq("status", "completed");
      if (eAppt) avisos.push("La cita no volvió a quedar confirmada: revísala en la agenda.");
    } else if (error) {
      avisos.push("No se pudo revisar el estado de la cita: revísala en la agenda.");
    }
  }

  return avisos.length > 0 ? { ok: true, aviso: `El cobro se anuló. ${avisos.join(" ")}` } : { ok: true };
}
