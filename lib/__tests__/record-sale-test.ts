import { findOpenCashSession, recordSale, voidSale, type RecordSaleInput } from "@/lib/record-sale";

// Base en memoria con lo justo del query builder de supabase-js, para probar
// cobro y anulación: errores, compensación e idempotencia (D8).
type Fila = Record<string, any>;
type Falla = { tabla: string; op: string; veces: number; perderRespuesta?: boolean };

const mockDb: { t: Record<string, Fila[]>; fallas: Falla[]; seq: number } = { t: {}, fallas: [], seq: 0 };

function mockReset() {
  mockDb.t = {
    pos_sales: [], pos_sale_items: [], cash_movements: [], inventory_movements: [],
    appointments: [], cash_sessions: [], invoices: [], gift_card_transactions: [], products: [],
  };
  mockDb.fallas = [];
}

jest.mock("@/lib/active-location", () => ({ getActiveLocationId: async () => null }));
jest.mock("@/lib/auth", () => ({ verificarContrasena: async (p: string) => ({ ok: p === "bien", mensaje: "La contraseña no es correcta." }) }));
jest.mock("@/lib/supabase", () => {
  const ERR_RED = { message: "TypeError: Network request failed", code: "" };
  function ejecutar(st: any): { data: any; error: any; count?: number } {
    const tabla: Fila[] = mockDb.t[st.tabla];
    const falla = mockDb.fallas.find(f => f.tabla === st.tabla && f.op === st.op && f.veces > 0);
    if (falla) falla.veces--;
    if (falla && !falla.perderRespuesta) return { data: null, error: ERR_RED };
    const pasa = (r: Fila) => st.filtros.every((f: (r: Fila) => boolean) => f(r));
    let out: any = { data: null, error: null };
    if (st.op === "select") {
      let filas = tabla.filter(pasa).map(r => ({ ...r }));
      if (st.tabla === "cash_movements") {
        filas = filas.map(r => ({ ...r, cash_sessions: { closed_at: mockDb.t.cash_sessions.find(s => s.id === r.session_id)?.closed_at ?? null } }));
      }
      if (st.tabla === "inventory_movements") {
        filas = filas.map(r => {
          const p = mockDb.t.products.find(x => x.id === r.product_id);
          return { ...r, products: p ? { location_id: p.location_id ?? null } : null };
        });
      }
      if (st.limit) filas = filas.slice(0, st.limit);
      if (st.count) out = { data: null, error: null, count: filas.length };
      else if (st.single) out = { data: filas[0] ?? null, error: st.single === "one" && !filas[0] ? { code: "PGRST116", message: "0 rows" } : null };
      else out = { data: filas, error: null };
    } else if (st.op === "insert") {
      for (const r of st.payload) {
        if (r.id && tabla.some(x => x.id === r.id)) return { data: null, error: { code: "23505", message: "duplicate key" } };
      }
      for (const r of st.payload) tabla.push({ id: r.id ?? `gen-${++mockDb.seq}`, ...r });
    } else if (st.op === "update") {
      const filas = tabla.filter(pasa);
      filas.forEach(r => Object.assign(r, st.payload));
      out = { data: st.selectDespues ? filas.map(r => ({ id: r.id })) : null, error: null };
    } else if (st.op === "delete") {
      const borrar = tabla.filter(pasa);
      mockDb.t[st.tabla] = tabla.filter(r => !pasa(r));
      if (st.tabla === "pos_sales") {
        const ids = borrar.map(r => r.id);
        mockDb.t.pos_sale_items = mockDb.t.pos_sale_items.filter(r => !ids.includes(r.sale_id));   // cascade
        mockDb.t.cash_movements.forEach(r => { if (ids.includes(r.pos_sale_id)) r.pos_sale_id = null; });   // set null
      }
      out = { data: st.selectDespues ? borrar.map(r => ({ id: r.id })) : null, error: null };
    }
    return falla?.perderRespuesta ? { data: null, error: ERR_RED } : out;
  }
  const from = (tabla: string) => {
    const st: any = { tabla, op: "select", filtros: [], payload: null, count: false, single: null, limit: null, selectDespues: false };
    const api: any = {
      select: (_c?: string, o?: { count?: string; head?: boolean }) => { if (st.op === "select") st.count = !!o?.count; else st.selectDespues = true; return api; },
      insert: (rows: any) => { st.op = "insert"; st.payload = Array.isArray(rows) ? rows : [rows]; return api; },
      update: (v: any) => { st.op = "update"; st.payload = v; return api; },
      delete: () => { st.op = "delete"; return api; },
      eq: (c: string, v: any) => { st.filtros.push((r: Fila) => r[c] === v); return api; },
      neq: (c: string, v: any) => { st.filtros.push((r: Fila) => r[c] !== v); return api; },
      in: (c: string, vs: any[]) => { st.filtros.push((r: Fila) => vs.includes(r[c])); return api; },
      is: (c: string, v: any) => { st.filtros.push((r: Fila) => (r[c] ?? null) === v); return api; },
      // Solo la forma que usa la app: "col.eq.valor,col.is.null".
      or: (f: string) => {
        const conds = f.split(",").map(x => x.split("."));
        st.filtros.push((r: Fila) => conds.some(([c, op, v]) => op === "is" ? (r[c] ?? null) === null : r[c] === v));
        return api;
      },
      order: () => api,
      limit: (n: number) => { st.limit = n; return api; },
      maybeSingle: () => { st.single = "maybe"; return Promise.resolve(ejecutar(st)); },
      single: () => { st.single = "one"; return Promise.resolve(ejecutar(st)); },
      then: (ok: any, ko: any) => Promise.resolve(ejecutar(st)).then(ok, ko),
    };
    return api;
  };
  return { supabase: { from } };
});

const T = "tenant-1";
const venta = (extra: Partial<RecordSaleInput> = {}): RecordSaleInput => ({
  saleId: "venta-1",
  tenantId: T,
  total: 50000,
  paymentMethod: "efectivo",
  items: [
    { name: "Corte", price: 30000, quantity: 1, service_id: "s1", item_type: "service" },
    { name: "Cera", price: 20000, quantity: 1, product_id: "p1", item_type: "product" },
  ],
  appointmentId: "cita-1",
  ...extra,
});

beforeEach(() => {
  mockReset();
  mockDb.t.cash_sessions.push({ id: "caja-hoy", tenant_id: T, location_id: null, closed_at: null, opened_at: "2026-09-26T13:00:00Z" });
  mockDb.t.appointments.push({ id: "cita-1", tenant_id: T, status: "confirmed" });
});

describe("recordSale", () => {
  test("cobro completo: venta, ítems, caja, inventario y cita", async () => {
    const r = await recordSale(venta());
    expect(r).toEqual({ ok: true, saleId: "venta-1" });
    expect(mockDb.t.pos_sales).toHaveLength(1);
    expect(mockDb.t.pos_sale_items).toHaveLength(2);
    expect(mockDb.t.cash_movements).toHaveLength(1);
    expect(mockDb.t.inventory_movements).toEqual([expect.objectContaining({ type: "sale", quantity: -1, reference: "venta-1" })]);
    expect(mockDb.t.appointments[0].status).toBe("completed");
  });

  test("sin caja abierta no toca nada", async () => {
    mockDb.t.cash_sessions[0].closed_at = "2026-09-26T20:00:00Z";
    const r = await recordSale(venta());
    expect(r).toMatchObject({ ok: false, error: "NO_CASH_SESSION" });
    expect(mockDb.t.pos_sales).toHaveLength(0);
  });

  test("si falla el ingreso en caja, se deshace la venta (nada de venta invisible en el arqueo)", async () => {
    mockDb.fallas.push({ tabla: "cash_movements", op: "insert", veces: 5 });
    const r = await recordSale(venta());
    expect(r).toMatchObject({ ok: false, error: "SALE_FAILED" });
    expect(mockDb.t.pos_sales).toHaveLength(0);
    expect(mockDb.t.pos_sale_items).toHaveLength(0);
    expect(mockDb.t.inventory_movements).toHaveLength(0);
    expect(mockDb.t.appointments[0].status).toBe("confirmed");
  });

  test("respuesta perdida del insert de la venta: no se duplica", async () => {
    mockDb.fallas.push({ tabla: "pos_sales", op: "insert", veces: 1, perderRespuesta: true });
    const r = await recordSale(venta());
    expect(r.ok).toBe(true);
    expect(mockDb.t.pos_sales).toHaveLength(1);
    expect(mockDb.t.cash_movements).toHaveLength(1);
  });

  test("quedó a medias sin red para compensar: el reintento con el mismo id completa sin duplicar", async () => {
    mockDb.fallas.push({ tabla: "cash_movements", op: "insert", veces: 5 });
    mockDb.fallas.push({ tabla: "pos_sales", op: "delete", veces: 5 });
    const r1 = await recordSale(venta());
    expect(r1).toMatchObject({ ok: false, error: "SALE_FAILED", pendiente: true });
    expect(mockDb.t.pos_sales).toHaveLength(1);

    mockDb.fallas = [];
    const r2 = await recordSale(venta());
    expect(r2).toEqual({ ok: true, saleId: "venta-1", yaExistia: true });
    expect(mockDb.t.pos_sales).toHaveLength(1);
    expect(mockDb.t.pos_sale_items).toHaveLength(2);
    expect(mockDb.t.cash_movements).toHaveLength(1);
    expect(mockDb.t.inventory_movements).toHaveLength(1);
  });

  test("una cita ya cobrada no se cobra dos veces", async () => {
    mockDb.t.pos_sales.push({ id: "otra", tenant_id: T, appointment_id: "cita-1", total: 50000 });
    const r = await recordSale(venta());
    expect(r).toMatchObject({ ok: false, error: "ALREADY_CHARGED", saleId: "otra" });
    expect(mockDb.t.pos_sales).toHaveLength(1);
  });

  test("doble toque con el mismo id comparte la operación", async () => {
    const [a, b] = await Promise.all([recordSale(venta()), recordSale(venta())]);
    expect(a).toEqual(b);
    expect(mockDb.t.pos_sales).toHaveLength(1);
    expect(mockDb.t.cash_movements).toHaveLength(1);
  });
});

describe("sedes en el inventario (auditoría #11)", () => {
  beforeEach(() => {
    mockDb.t.cash_sessions = [{ id: "caja-a", tenant_id: T, location_id: "sede-a", closed_at: null, opened_at: "2026-09-29T13:00:00Z" }];
  });

  test("la salida de stock va a la sede del producto; uno viejo sin sede, a la de la venta", async () => {
    const r = await recordSale(venta({
      locationId: "sede-a",
      items: [
        { name: "Cera", price: 20000, quantity: 1, product_id: "p1", item_type: "product", location_id: "sede-b" },
        { name: "Gel", price: 10000, quantity: 2, product_id: "p2", item_type: "product", location_id: null },
      ],
    }));
    expect(r.ok).toBe(true);
    expect(mockDb.t.inventory_movements.map(m => [m.product_id, m.location_id])).toEqual([["p1", "sede-b"], ["p2", "sede-a"]]);
  });

  test("anular una venta vieja sin sede en el stock: la devolución va a la sede del producto o, si no tiene, a la de la venta", async () => {
    mockDb.t.products.push({ id: "p1", location_id: "sede-b" }, { id: "p2", location_id: null });
    mockDb.t.pos_sales.push({ id: "v-vieja", tenant_id: T, location_id: "sede-a", appointment_id: null, total: 30000 });
    mockDb.t.inventory_movements.push(
      { id: "s1", product_id: "p1", type: "sale", quantity: -1, reference: "v-vieja", location_id: null },
      { id: "s2", product_id: "p2", type: "sale", quantity: -2, reference: "v-vieja", location_id: null },
    );
    const r = await voidSale("v-vieja");
    expect(r).toEqual({ ok: true });
    const devoluciones = mockDb.t.inventory_movements.filter(m => m.type === "return");
    expect(devoluciones.map(m => [m.product_id, m.quantity, m.location_id])).toEqual([["p1", 1, "sede-b"], ["p2", 2, "sede-a"]]);
  });
});

describe("findOpenCashSession", () => {
  test("por defecto solo la caja de la sede: la general (sin sede) no cuenta", async () => {
    mockDb.t.cash_sessions = [{ id: "general", tenant_id: T, location_id: null, closed_at: null }];
    expect(await findOpenCashSession(T, "sede-a")).toBeNull();
  });

  test("con incluirGeneral cuenta la general, pero primero la de la sede", async () => {
    mockDb.t.cash_sessions = [{ id: "general", tenant_id: T, location_id: null, closed_at: null }];
    expect(await findOpenCashSession(T, "sede-a", { incluirGeneral: true })).toEqual({ id: "general", location_id: null });
    mockDb.t.cash_sessions.push({ id: "caja-a", tenant_id: T, location_id: "sede-a", closed_at: null });
    expect(await findOpenCashSession(T, "sede-a", { incluirGeneral: true })).toEqual({ id: "caja-a", location_id: "sede-a" });
  });
});

describe("voidSale", () => {
  test("caja abierta: borra el ingreso y la venta, repone stock y devuelve la cita", async () => {
    await recordSale(venta());
    const r = await voidSale("venta-1", "cita-1");
    expect(r).toEqual({ ok: true });
    expect(mockDb.t.pos_sales).toHaveLength(0);
    expect(mockDb.t.cash_movements).toHaveLength(0);
    expect(mockDb.t.inventory_movements.map(m => [m.type, m.quantity])).toEqual([["sale", -1], ["return", 1]]);
    expect(mockDb.t.appointments[0].status).toBe("confirmed");
  });

  test("caja ya cerrada: no reescribe su historia, registra el egreso en la caja de hoy", async () => {
    mockDb.t.cash_sessions.push({ id: "caja-ayer", tenant_id: T, location_id: null, closed_at: "2026-09-25T23:00:00Z" });
    mockDb.t.pos_sales.push({ id: "v-ayer", tenant_id: T, location_id: null, appointment_id: null, total: 40000 });
    mockDb.t.cash_movements.push({ id: "m-ayer", session_id: "caja-ayer", tenant_id: T, type: "ingreso", amount: 40000, description: "Venta POS", category: "POS", payment_method: "efectivo", pos_sale_id: "v-ayer" });
    const r = await voidSale("v-ayer");
    expect(r).toEqual({ ok: true });
    const ayer = mockDb.t.cash_movements.find(m => m.id === "m-ayer");
    expect(ayer).toBeDefined();
    const egreso = mockDb.t.cash_movements.find(m => m.session_id === "caja-hoy");
    expect(egreso).toMatchObject({ type: "egreso", amount: 40000, payment_method: "efectivo" });
    expect(mockDb.t.pos_sales).toHaveLength(0);
  });

  test("caja cerrada y ninguna abierta: no toca nada", async () => {
    mockDb.t.cash_sessions[0].closed_at = "2026-09-26T20:00:00Z";
    mockDb.t.pos_sales.push({ id: "v", tenant_id: T, location_id: null, appointment_id: null, total: 1 });
    mockDb.t.cash_movements.push({ id: "m", session_id: "caja-hoy", tenant_id: T, type: "ingreso", amount: 1, description: "x", category: "POS", payment_method: "efectivo", pos_sale_id: "v" });
    const r = await voidSale("v");
    expect(r).toMatchObject({ ok: false, error: "NO_CASH_SESSION" });
    expect(mockDb.t.pos_sales).toHaveLength(1);
    expect(mockDb.t.cash_movements).toHaveLength(1);
  });

  test("con factura electrónica vigente no se anula", async () => {
    await recordSale(venta());
    mockDb.t.invoices.push({ id: "f1", pos_sale_id: "venta-1", credit_note_cufe: null });
    const r = await voidSale("venta-1");
    expect(r).toMatchObject({ ok: false, error: "HAS_INVOICE" });
    expect(mockDb.t.pos_sales).toHaveLength(1);
  });

  test("un intento de factura rechazado o ya acreditado no bloquea la anulación", async () => {
    await recordSale(venta());
    mockDb.t.invoices.push({ id: "f1", pos_sale_id: "venta-1", status: "rejected", credit_note_cufe: null });
    mockDb.t.invoices.push({ id: "f2", pos_sale_id: "venta-1", status: "credited", credit_note_cufe: null });
    const r = await voidSale("venta-1");
    expect(r).toMatchObject({ ok: true });
    expect(mockDb.t.pos_sales).toHaveLength(0);
  });

  test("si falla borrar la venta, la caja queda como estaba", async () => {
    await recordSale(venta());
    mockDb.fallas.push({ tabla: "pos_sales", op: "delete", veces: 1 });
    const r = await voidSale("venta-1");
    expect(r).toMatchObject({ ok: false, error: "FAILED" });
    expect(mockDb.t.pos_sales).toHaveLength(1);
    expect(mockDb.t.cash_movements).toEqual([expect.objectContaining({ pos_sale_id: "venta-1", amount: 50000 })]);
  });

  test("con contraseña equivocada no anula", async () => {
    await recordSale(venta());
    const r = await voidSale("venta-1", null, { contrasena: "mal" });
    expect(r).toMatchObject({ ok: false, error: "NOT_ALLOWED" });
    expect(mockDb.t.pos_sales).toHaveLength(1);
  });
});
