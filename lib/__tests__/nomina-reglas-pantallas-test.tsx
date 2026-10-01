import { Alert } from "react-native";
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import TabNovedades from "@/components/nomina/TabNovedades";
import TabReglas from "@/components/nomina/TabReglas";
import { fmtMoneyFull } from "@/lib/format";
import { hoyNegocio } from "@/lib/tz";

// Nómina → Novedades y Nómina → Reglas con Supabase simulado: qué se lee, qué
// se escribe (y con qué filtros) y qué no se deja tocar. Las reglas puras
// están en lib/__tests__/nomina-reglas-test.ts.
// (jest.mock se eleva sobre los imports; las variables "mock*" se leen al usar.)

const ZONA = "America/Bogota";

jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- dentro de jest.mock no se puede usar import
  const React = require("react");
  return {
    // Como useFocusEffect con la pantalla enfocada: corre al montar y si cambia el callback.
    useFocusEffect: (cb: () => void | (() => void)) => { React.useEffect(() => cb(), [cb]); },
  };
});
jest.mock("@/lib/tenant", () => ({ useTenant: () => ({ timezone: "America/Bogota", ready: true }) }));
jest.mock("@/lib/active-location", () => ({
  getActiveLocationId: async () => null,
  suscribirSedeActiva: () => () => {},
}));

// ─── Supabase simulado con estado ────────────────────────────────────────────
type Fila = Record<string, unknown>;
type Filtro = [op: string, col: string, val: unknown];
type Accion = "select" | "insert" | "update" | "delete" | "upsert";
type Op = { tabla: string; accion: Accion; payload?: unknown; opciones?: { onConflict?: string }; filtros: Filtro[] };

const mockBase: {
  tablas: Record<string, Fila[]>;
  ops: Op[];
  /** Cuántos insert de esa tabla fallan antes de dejar pasar. */
  fallarInsert: Record<string, number>;
} = { tablas: {}, ops: [], fallarInsert: {} };

function mockCumple(f: Fila, filtros: Filtro[]): boolean {
  return filtros.every(([op, col, val]) => {
    const v = f[col] ?? null;
    if (op === "eq" || op === "is") return v === val;
    if (op === "gte") return String(v) >= String(val);
    if (op === "lte") return String(v) <= String(val);
    return true;
  });
}

let mockSiguienteId = 1;

jest.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabla: string) => {
      const st: Op = { tabla, accion: "select", filtros: [] };
      let rango: [number, number] | null = null;
      const responder = () => {
        const filas = (mockBase.tablas[tabla] ??= []);
        if (st.accion !== "select") mockBase.ops.push(st);
        switch (st.accion) {
          case "select": {
            const r = filas.filter(f => mockCumple(f, st.filtros));
            return { data: rango ? r.slice(rango[0], rango[1] + 1) : r, error: null };
          }
          case "insert": {
            if ((mockBase.fallarInsert[tabla] ?? 0) > 0) {
              mockBase.fallarInsert[tabla]--;
              return { data: null, error: { code: "23514", message: "new row violates check constraint" } };
            }
            const nuevas = (Array.isArray(st.payload) ? st.payload : [st.payload]) as Fila[];
            const conId = nuevas.map(n => ({ id: `gen-${mockSiguienteId++}`, ...n }));
            filas.push(...conId);
            return { data: conId.map(n => ({ id: n.id })), error: null };
          }
          case "update": {
            const tocadas = filas.filter(f => mockCumple(f, st.filtros));
            tocadas.forEach(f => Object.assign(f, st.payload as Fila));
            return { data: tocadas.map(f => ({ id: f.id })), error: null };
          }
          case "delete": {
            const borrar = filas.filter(f => mockCumple(f, st.filtros));
            mockBase.tablas[tabla] = filas.filter(f => !borrar.includes(f));
            return { data: borrar.map(f => ({ id: f.id })), error: null };
          }
          case "upsert": {
            const v = st.payload as Fila;
            const claves = (st.opciones?.onConflict ?? "id").split(",");
            const previa = filas.find(f => claves.every(k => f[k] === v[k]));
            if (previa) Object.assign(previa, v);
            else filas.push({ id: `gen-${mockSiguienteId++}`, ...v });
            return { data: [{ id: previa?.id ?? "nuevo" }], error: null };
          }
        }
      };
      const q: Record<string, unknown> = {
        select: () => q,
        insert: (v: unknown) => { st.accion = "insert"; st.payload = v; return q; },
        update: (v: unknown) => { st.accion = "update"; st.payload = v; return q; },
        delete: () => { st.accion = "delete"; return q; },
        upsert: (v: unknown, o?: { onConflict?: string }) => { st.accion = "upsert"; st.payload = v; st.opciones = o; return q; },
        eq: (c: string, v: unknown) => { st.filtros.push(["eq", c, v]); return q; },
        is: (c: string, v: unknown) => { st.filtros.push(["is", c, v]); return q; },
        gte: (c: string, v: unknown) => { st.filtros.push(["gte", c, v]); return q; },
        lte: (c: string, v: unknown) => { st.filtros.push(["lte", c, v]); return q; },
        order: () => q,
        range: (d: number, h: number) => { rango = [d, h]; return q; },
        then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve().then(responder).then(ok, ko),
      };
      return q;
    },
  },
}));

const hoy = hoyNegocio(ZONA);
const ops = (tabla: string, accion: Accion) => mockBase.ops.filter(o => o.tabla === tabla && o.accion === accion);

/** Alert.alert que confirma (toca el botón que no es "Cancelar"). */
function confirmarAlertas() {
  return jest.spyOn(Alert, "alert").mockImplementation((_t, _m, botones) => {
    botones?.find(b => b.style !== "cancel")?.onPress?.();
  });
}

beforeEach(() => {
  mockSiguienteId = 1;
  mockBase.ops = [];
  mockBase.fallarInsert = {};
  mockBase.tablas = {
    professionals: [
      { id: "ana", tenant_id: "t1", name: "Ana", role: "Estilista", is_active: true },
      { id: "luis", tenant_id: "t1", name: "Luis", role: "Barbero", is_active: true },
      { id: "marta", tenant_id: "t1", name: "Marta", role: "Estilista", is_active: false },
    ],
    payroll_adjustments: [
      { id: "n1", tenant_id: "t1", professional_id: "ana", kind: "bonus", amount: 20000, entry_date: hoy, concept: "Meta de ventas", source: "manual", statement_id: null },
      { id: "n2", tenant_id: "t1", professional_id: "luis", kind: "tip", amount: "5000", entry_date: hoy, concept: null, source: "caja", statement_id: null },
      { id: "n3", tenant_id: "t1", professional_id: "ana", kind: "deduction", amount: 10000, entry_date: hoy, concept: "Adelanto pagado", source: "manual", statement_id: "s1" },
    ],
    commission_rules: [],
    payroll_profiles: [],
    services: [
      { id: "s1", tenant_id: "t1", name: "Corte clásico", price: 30000, category: "Cortes", code: null, is_active: true },
    ],
    commission_service_rules: [
      { id: "r1", tenant_id: "t1", service_id: "s1", professional_id: "marta", type: "percentage", value: 30 },
    ],
  };
});
afterEach(() => jest.restoreAllMocks());

describe("Nómina → Novedades", () => {
  test("por pagar: solo las pendientes, con su total; las de caja no se editan", async () => {
    const alerta = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    await render(<TabNovedades tenantId="t1" timezone={ZONA} />);

    expect(await screen.findByText("Meta de ventas")).toBeOnTheScreen();
    expect(screen.getByText("Ana · Bonificación")).toBeOnTheScreen();
    expect(screen.getByText("Luis · Propina")).toBeOnTheScreen();
    // La pagada no está entre las pendientes.
    expect(screen.queryByText("Adelanto pagado")).toBeNull();
    // Neto: 20.000 + 5.000.
    expect(screen.getByText(fmtMoneyFull(25000))).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: /^Luis, Propina/ }));
    expect(alerta).toHaveBeenCalledWith("Esta novedad no se cambia aquí", expect.stringMatching(/Caja/));
    expect(screen.queryByText("Editar novedad")).toBeNull();
  });

  test("por periodo: también las pagadas, que se ven como pagadas", async () => {
    await render(<TabNovedades tenantId="t1" timezone={ZONA} />);
    await screen.findByText("Meta de ventas");
    await fireEvent.press(screen.getByRole("tab", { name: "Por periodo" }));
    expect(await screen.findByText("Adelanto pagado")).toBeOnTheScreen();
    expect(screen.getByText("Pagada")).toBeOnTheScreen();
  });

  test("anotar: valida y escribe una novedad manual del negocio", async () => {
    await render(<TabNovedades tenantId="t1" timezone={ZONA} />);
    await screen.findByText("Meta de ventas");

    await fireEvent.press(screen.getByRole("button", { name: "Anotar novedad" }));
    await fireEvent.press(screen.getByRole("button", { name: "Anotar" }));
    expect(screen.getByText("Elige a quién es la novedad.")).toBeOnTheScreen();
    expect(ops("payroll_adjustments", "insert")).toHaveLength(0);

    // El inactivo no sale para elegir (solo en la lista, si tiene novedades).
    expect(screen.queryByRole("button", { name: /Marta/ })).toBeNull();
    const luis = screen.getAllByRole("button", { name: "Luis" });
    await fireEvent.press(luis[luis.length - 1]);
    await fireEvent.press(screen.getByRole("radio", { name: /^Propina/ }));
    await fireEvent.changeText(screen.getByLabelText("Monto"), "50.000");
    await fireEvent.press(screen.getByRole("button", { name: "Anotar" }));

    await waitFor(() => expect(ops("payroll_adjustments", "insert")).toHaveLength(1));
    expect(ops("payroll_adjustments", "insert")[0].payload).toEqual({
      id: expect.any(String),
      tenant_id: "t1",
      source: "manual",
      professional_id: "luis",
      kind: "tip",
      amount: 50000,
      entry_date: hoy,
      concept: null,
    });
    expect(await screen.findByText(/Quedó anotada: propina de \$50\.000 para Luis/)).toBeOnTheScreen();
  });

  test("borrar: pide confirmación y solo toca una manual sin pagar", async () => {
    confirmarAlertas();
    await render(<TabNovedades tenantId="t1" timezone={ZONA} />);
    await screen.findByText("Meta de ventas");

    await fireEvent.press(screen.getByRole("button", { name: /^Ana, Bonificación/ }));
    expect(screen.getByRole("header", { name: "Editar novedad" })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Borrar novedad" }));

    await waitFor(() => expect(ops("payroll_adjustments", "delete")).toHaveLength(1));
    expect(ops("payroll_adjustments", "delete")[0].filtros).toEqual(expect.arrayContaining([
      ["eq", "id", "n1"], ["eq", "tenant_id", "t1"], ["eq", "source", "manual"], ["is", "statement_id", null],
    ]));
    expect(await screen.findByText(`Se borró bonificación de ${fmtMoneyFull(20000)} de Ana.`)).toBeOnTheScreen();
    expect(screen.queryByText("Meta de ventas")).toBeNull();
  });
});

describe("Nómina → Reglas", () => {
  test("pago: la comisión general va a commission_rules y sin básico no se crea perfil", async () => {
    await render(<TabReglas tenantId="t1" timezone={ZONA} />);
    await fireEvent.press(await screen.findByRole("button", { name: /^Ana\. Básico/ }));
    expect(screen.getByRole("header", { name: "Pago de Ana" })).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("radio", { name: "% de lo cobrado" }));
    await fireEvent.changeText(screen.getByLabelText("Porcentaje de la comisión general"), "40");
    await fireEvent.press(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(ops("commission_rules", "upsert")).toHaveLength(1));
    const op = ops("commission_rules", "upsert")[0];
    expect(op.payload).toEqual(expect.objectContaining({ tenant_id: "t1", professional_id: "ana", type: "percentage", value: 40 }));
    expect(op.opciones).toEqual({ onConflict: "tenant_id,professional_id" });
    expect(ops("payroll_profiles", "upsert")).toHaveLength(0);
    expect(await screen.findByText(/Se guardó el pago de Ana/)).toBeOnTheScreen();
  });

  test("pago: con básico se escribe el perfil desde la fecha elegida", async () => {
    await render(<TabReglas tenantId="t1" timezone={ZONA} />);
    await fireEvent.press(await screen.findByRole("button", { name: /^Luis\. Básico/ }));
    await fireEvent.changeText(screen.getByLabelText("Monto del básico"), "1.300.000");
    await fireEvent.press(screen.getByRole("radio", { name: "Quincenal" }));
    await fireEvent.changeText(screen.getByLabelText("Porcentaje de comisión por productos"), "10");
    await fireEvent.press(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(ops("payroll_profiles", "upsert")).toHaveLength(1));
    const op = ops("payroll_profiles", "upsert")[0];
    expect(op.payload).toEqual(expect.objectContaining({
      tenant_id: "t1", professional_id: "luis",
      base_salary: 1300000, base_period: "quincenal", base_since: hoy, product_commission_pct: 10,
    }));
    expect(op.opciones).toEqual({ onConflict: "tenant_id,professional_id" });
    // Sin comisión general antes ni ahora: no se toca commission_rules.
    expect(mockBase.ops.filter(o => o.tabla === "commission_rules")).toHaveLength(0);
  });

  test("pago: un inactivo con reglas se ve pero no se edita", async () => {
    const alerta = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    await render(<TabReglas tenantId="t1" timezone={ZONA} />);
    await fireEvent.press(await screen.findByRole("button", { name: /^Marta, inactivo/ }));
    expect(alerta).toHaveBeenCalledWith("Marta está inactivo", expect.any(String));
    expect(screen.queryByRole("header", { name: "Pago de Marta" })).toBeNull();
  });

  test("servicio: borra y vuelve a escribir sus reglas, sin perder las de inactivos", async () => {
    await render(<TabReglas tenantId="t1" timezone={ZONA} />);
    await screen.findByRole("button", { name: /^Ana\. Básico/ });
    await fireEvent.press(screen.getByRole("tab", { name: "Por servicio" }));
    await fireEvent.press(screen.getByRole("button", { name: /^Corte clásico,/ }));

    expect(screen.getByText(/Marta \(inactivo\): 30%/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("radio", { name: "% de lo cobrado" }));
    await fireEvent.changeText(screen.getByLabelText("Porcentaje para todos"), "40");
    await fireEvent.press(screen.getByRole("button", { name: "Agregar a alguien" }));
    await fireEvent.press(screen.getByRole("button", { name: "Ana" }));
    const radiosFijo = screen.getAllByRole("radio", { name: "Fijo por vez" });
    await fireEvent.press(radiosFijo[radiosFijo.length - 1]);
    await fireEvent.changeText(screen.getByLabelText("Comisión de Ana"), "15.000");
    await fireEvent.press(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(ops("commission_service_rules", "insert")).toHaveLength(1));
    const borrado = ops("commission_service_rules", "delete");
    expect(borrado).toHaveLength(1);
    expect(borrado[0].filtros).toEqual(expect.arrayContaining([["eq", "tenant_id", "t1"], ["eq", "service_id", "s1"]]));
    expect(ops("commission_service_rules", "insert")[0].payload).toEqual([
      { tenant_id: "t1", service_id: "s1", professional_id: null, type: "percentage", value: 40 },
      { tenant_id: "t1", service_id: "s1", professional_id: "ana", type: "fixed", value: 15000 },
      { tenant_id: "t1", service_id: "s1", professional_id: "marta", type: "percentage", value: 30 },
    ]);
    expect(await screen.findByText("Se guardó la comisión de Corte clásico.")).toBeOnTheScreen();
  });

  test("servicio: si la escritura nueva falla, vuelven las reglas de antes", async () => {
    mockBase.fallarInsert = { commission_service_rules: 1 };
    await render(<TabReglas tenantId="t1" timezone={ZONA} />);
    await screen.findByRole("button", { name: /^Ana\. Básico/ });
    await fireEvent.press(screen.getByRole("tab", { name: "Por servicio" }));
    await fireEvent.press(screen.getByRole("button", { name: /^Corte clásico,/ }));
    await fireEvent.press(screen.getByRole("radio", { name: "Fijo por vez" }));
    await fireEvent.changeText(screen.getByLabelText("Monto fijo para todos"), "5000");
    await fireEvent.press(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText(/quedaron como estaban/)).toBeOnTheScreen();
    expect(ops("commission_service_rules", "insert")).toHaveLength(2);
    expect(mockBase.tablas.commission_service_rules).toEqual([
      expect.objectContaining({ service_id: "s1", professional_id: "marta", type: "percentage", value: 30 }),
    ]);
  });

  test("servicio: sin cambios no se escribe nada", async () => {
    await render(<TabReglas tenantId="t1" timezone={ZONA} />);
    await screen.findByRole("button", { name: /^Ana\. Básico/ });
    await fireEvent.press(screen.getByRole("tab", { name: "Por servicio" }));
    await fireEvent.press(screen.getByRole("button", { name: /^Corte clásico,/ }));
    await fireEvent.press(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(screen.queryByRole("header", { name: "Corte clásico" })).toBeNull());
    expect(mockBase.ops).toHaveLength(0);
  });
});
