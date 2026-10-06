import {
  agruparPorCobrar, estadoPorCobrar, fechaPorCobrar, porDia, serviciosDe, sumarPorCobrar,
  traerPorCobrar, traerPorCobrarDetalle, SELECT_DETALLE, SELECT_TARJETA, type CitaPorCobrar,
} from "@/lib/porCobrar";
import { diaLocalDe } from "@/lib/tz";

// "Por cobrar" del Panel y de su pantalla (lib/porCobrar.ts): la agrupación
// en vencidas / hoy / próximas con el día DEL NEGOCIO, la suma a precio de
// lista con los adicionales, el orden, y la consulta (anti-join, sede y
// respaldo) que comparten la tarjeta y la pantalla.

// ─── Supabase simulado: registra cada consulta y responde con mockSb.responder ──
type Filtro = [op: string, columna: string, valor: unknown];
type Llamada = { tabla: string; select?: string; filtros: Filtro[]; orden: string[]; rango?: [number, number] };
type Res = { data: unknown; error: unknown };
const mockSb: { llamadas: Llamada[]; responder: (ll: Llamada) => Res } = {
  llamadas: [],
  responder: () => ({ data: [], error: null }),
};
jest.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabla: string) => {
      const ll: Llamada = { tabla, filtros: [], orden: [] };
      const q: Record<string, unknown> = {
        select: (c: string) => { ll.select = c; return q; },
        eq: (c: string, v: unknown) => { ll.filtros.push(["eq", c, v]); return q; },
        in: (c: string, v: unknown) => { ll.filtros.push(["in", c, v]); return q; },
        is: (c: string, v: unknown) => { ll.filtros.push(["is", c, v]); return q; },
        order: (c: string) => { ll.orden.push(c); return q; },
        range: (d: number, h: number) => { ll.rango = [d, h]; return q; },
        overrideTypes: () => q,
        then: (ok: (v: Res) => unknown, ko?: (e: unknown) => unknown) =>
          Promise.resolve().then(() => { mockSb.llamadas.push(ll); return mockSb.responder(ll); }).then(ok, ko),
      };
      return q;
    },
  },
}));

beforeEach(() => {
  mockSb.llamadas = [];
  mockSb.responder = () => ({ data: [], error: null });
});

const cita = (id: string, fecha: string, extra: Partial<CitaPorCobrar> = {}): CitaPorCobrar => ({
  id,
  appointment_date: fecha,
  appointment_time: "10:00:00",
  status: "confirmed",
  services: { name: "Corte", price: 20000 },
  appointment_services: [],
  pos_sales: [],
  ...extra,
});

describe("agruparPorCobrar", () => {
  test("reparte en vencidas, hoy y próximas; cada cita en un solo tramo", () => {
    const r = agruparPorCobrar([
      cita("a", "2026-09-27"),
      cita("b", "2026-09-28"),
      cita("c", "2026-09-29"),
      cita("d", "2026-06-10", { status: "completed" }),
    ], "2026-09-28");
    expect(r.vencidas.citas.map(c => c.id)).toEqual(["a", "d"]);
    expect(r.deHoy.citas.map(c => c.id)).toEqual(["b"]);
    expect(r.proximas.citas.map(c => c.id)).toEqual(["c"]);
    expect(r.cantidad).toBe(4);
    expect(r.total).toBe(r.vencidas.total + r.deHoy.total + r.proximas.total);
    expect(r.total).toBe(80000);
    expect(r.completadasSinCobro).toBe(1);
  });

  test("8 PM de Bogotá: el UTC ya es mañana, pero la cita de hoy no está vencida", () => {
    // 28-sep 8:00 PM en Bogotá = 29-sep 01:00 UTC.
    const instante = new Date("2026-09-29T01:00:00Z");
    const hoy = diaLocalDe(instante, "America/Bogota");
    expect(hoy).toBe("2026-09-28");
    expect(instante.toISOString().slice(0, 10)).toBe("2026-09-29");

    const citas = [cita("hoy", "2026-09-28"), cita("manana", "2026-09-29")];
    const r = agruparPorCobrar(citas, hoy);
    expect(r.vencidas.citas).toHaveLength(0);
    expect(r.deHoy.citas.map(c => c.id)).toEqual(["hoy"]);
    expect(r.proximas.citas.map(c => c.id)).toEqual(["manana"]);

    // Con el día UTC (el error de antes) la de hoy salía vencida y la de mañana, de hoy.
    const conUTC = agruparPorCobrar(citas, instante.toISOString().slice(0, 10));
    expect(conUTC.vencidas.citas.map(c => c.id)).toEqual(["hoy"]);
  });

  test("suma el servicio principal y los adicionales, también si llegan como texto", () => {
    const r = agruparPorCobrar([
      cita("a", "2026-09-20", { services: { price: "30000" }, appointment_services: [{ name: "Barba", price: 10000 }, { name: "Cejas", price: "5000" }] }),
      cita("b", "2026-09-30", { services: null, appointment_services: [{ price: 8000 }, { price: null }] }),
      cita("c", "2026-09-28", { services: { price: null }, appointment_services: null }),
    ], "2026-09-28");
    expect(r.vencidas.total).toBe(45000);
    expect(r.proximas.total).toBe(8000);
    expect(r.deHoy.total).toBe(0);
    expect(r.total).toBe(53000);
    expect(sumarPorCobrar([cita("x", "2026-01-01"), cita("y", "2026-01-02")])).toBe(40000);
  });

  test("orden: vencidas de la más reciente a la más vieja; hoy y próximas por fecha y hora", () => {
    const r = agruparPorCobrar([
      cita("v-vieja", "2026-06-01", { appointment_time: "18:00:00" }),
      cita("v-ayer-tarde", "2026-09-27", { appointment_time: "17:00:00" }),
      cita("v-ayer-manana", "2026-09-27", { appointment_time: "09:00:00" }),
      cita("h-tarde", "2026-09-28", { appointment_time: "16:30:00" }),
      cita("h-manana", "2026-09-28", { appointment_time: "08:00:00" }),
      cita("p-lejos", "2026-10-15", { appointment_time: "09:00:00" }),
      cita("p-manana-2", "2026-09-29", { appointment_time: "11:00:00" }),
      cita("p-manana-1", "2026-09-29", { appointment_time: "10:00:00" }),
    ], "2026-09-28");
    expect(r.vencidas.citas.map(c => c.id)).toEqual(["v-ayer-tarde", "v-ayer-manana", "v-vieja"]);
    expect(r.deHoy.citas.map(c => c.id)).toEqual(["h-manana", "h-tarde"]);
    expect(r.proximas.citas.map(c => c.id)).toEqual(["p-manana-1", "p-manana-2", "p-lejos"]);

    // Próximas agrupadas por día, con su total.
    expect(porDia(r.proximas.citas).map(g => [g.dia, g.citas.length, g.total])).toEqual([
      ["2026-09-29", 2, 40000],
      ["2026-10-15", 1, 20000],
    ]);
  });

  test("sin citas: todo en cero", () => {
    const r = agruparPorCobrar([], "2026-09-28");
    expect(r.total).toBe(0);
    expect(r.cantidad).toBe(0);
    expect(porDia(r.proximas.citas)).toEqual([]);
  });
});

describe("textos de la fila", () => {
  test("estado: una completada siempre dice 'sin cobro'; las demás, cuando ya pasaron", () => {
    expect(estadoPorCobrar("completed", true)).toBe("Completada sin cobro");
    expect(estadoPorCobrar("completed", false)).toBe("Completada sin cobro");
    expect(estadoPorCobrar("confirmed", true)).toBe("Confirmada sin cobro");
    expect(estadoPorCobrar("pending", false)).toBe("Pendiente");
  });

  test("servicios: el principal y los adicionales", () => {
    expect(serviciosDe({ services: { name: "Corte" }, appointment_services: [{ name: "Barba", price: 1 }] })).toBe("Corte + Barba");
    expect(serviciosDe({ services: null, appointment_services: [] })).toBe("Sin servicio");
  });

  test("fecha: con el año solo si no es el de hoy", () => {
    expect(fechaPorCobrar("2026-06-12", "2026-09-28")).toBe("vie 12 jun");
    expect(fechaPorCobrar("2025-12-30", "2026-09-28")).toBe("mar 30 dic 2025");
  });
});

describe("consulta compartida (tarjeta y pantalla)", () => {
  const filtro = (ll: Llamada, op: string, col: string) => ll.filtros.find(f => f[0] === op && f[1] === col);

  test("anti-join de cobros, estados por cobrar y la sede activa", async () => {
    mockSb.responder = () => ({ data: [cita("a", "2026-09-27")], error: null });
    const filas = await traerPorCobrar("t1", "sede-1");
    expect(filas.map(f => f.id)).toEqual(["a"]);
    const [ll] = mockSb.llamadas;
    expect(ll.tabla).toBe("appointments");
    expect(ll.select).toBe(SELECT_TARJETA);
    expect(filtro(ll, "eq", "tenant_id")?.[2]).toBe("t1");
    expect(filtro(ll, "in", "status")?.[2]).toEqual(["pending", "confirmed", "completed"]);
    expect(filtro(ll, "is", "pos_sales")?.[2]).toBeNull();
    // El historial migrado de otro sistema (imported) ya se cobró allá: fuera.
    expect(filtro(ll, "eq", "imported")?.[2]).toBe(false);
    expect(filtro(ll, "eq", "location_id")?.[2]).toBe("sede-1");
    expect(ll.orden).toEqual(["appointment_date", "id"]);
    expect(ll.rango).toEqual([0, 999]);
  });

  test("la pantalla usa el mismo filtro, con el detalle; sin sede no filtra por sede", async () => {
    await traerPorCobrarDetalle("t1", null);
    const [ll] = mockSb.llamadas;
    expect(ll.select).toBe(SELECT_DETALLE);
    expect(ll.select).toContain("pos_sales(id)");
    expect(ll.select).toContain("appointment_services(name, price)");
    expect(filtro(ll, "is", "pos_sales")?.[2]).toBeNull();
    expect(filtro(ll, "in", "status")?.[2]).toEqual(["pending", "confirmed", "completed"]);
    expect(filtro(ll, "eq", "location_id")).toBeUndefined();
  });

  test("servidor sin anti-join: cae a pendientes y confirmadas y quita las cobradas", async () => {
    mockSb.responder = ll => filtro(ll, "is", "pos_sales")
      ? { data: null, error: { code: "PGRST100", message: "failed to parse filter" } }
      : { data: [cita("libre", "2026-09-27"), cita("cobrada", "2026-09-26", { pos_sales: [{ id: "v1" }] })], error: null };
    const filas = await traerPorCobrar("t1", null);
    expect(filas.map(f => f.id)).toEqual(["libre"]);
    expect(mockSb.llamadas).toHaveLength(2);
    expect(filtro(mockSb.llamadas[1], "in", "status")?.[2]).toEqual(["pending", "confirmed"]);
  });

  test("un corte de red no cae al respaldo: se informa", async () => {
    mockSb.responder = () => ({ data: null, error: { code: "", message: "TypeError: Network request failed" } });
    await expect(traerPorCobrar("t1", null)).rejects.toMatchObject({ deRed: true });
    expect(mockSb.llamadas).toHaveLength(1);
  });
});
