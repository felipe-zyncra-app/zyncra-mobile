import { Alert } from "react-native";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import PorCobrarScreen from "@/app/(admin)/por-cobrar";
import DashboardScreen from "@/app/(admin)/(tabs)/index";
import { fmtMoneyFull } from "@/lib/format";
import { hoyNegocio, sumarDias } from "@/lib/tz";

// Pantalla Por cobrar y la tarjeta del Panel que la abre, con Supabase
// simulado: secciones, total igual a la suma (y a la tarjeta), "No asistió"
// y "Cobrar" sacan la fila, una próxima abre la Agenda, y los estados de
// vacío y error. Las reglas puras están en lib/__tests__/por-cobrar-test.ts.
// (jest.mock se eleva sobre los imports; las variables "mock*" se leen al usar.)

const ZONA = "America/Bogota";

const mockRouter = {
  push: jest.fn(), back: jest.fn(), replace: jest.fn(), dismissTo: jest.fn(), navigate: jest.fn(), canGoBack: jest.fn(() => true),
};
jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- dentro de jest.mock no se puede usar import
  const React = require("react");
  return {
    useRouter: () => mockRouter,
    // Como useFocusEffect con la pantalla enfocada: corre al montar y si cambia el callback.
    useFocusEffect: (cb: () => void | (() => void)) => { React.useEffect(() => cb(), [cb]); },
  };
});
jest.mock("@/lib/auth", () => ({ useAuth: () => ({ tenantId: "t1", role: "admin" }) }));
jest.mock("@/lib/tenant", () => ({
  useTenant: () => ({ timezone: "America/Bogota", ready: true, tenant: { name: "Barbería de prueba" } }),
}));
jest.mock("@/lib/active-location", () => ({
  getActiveLocationId: async () => null,
  suscribirSedeActiva: () => () => {},
}));
const mockRecordatorio = jest.fn(async (..._args: unknown[]) => {});
jest.mock("@/lib/notifications", () => ({
  reprogramarRecordatorioCita: (...args: unknown[]) => mockRecordatorio(...args),
  refreshAllReminders: async () => {},
}));
// La hoja de cobro tiene su propio flujo (catálogo, caja, recordSale): aquí
// solo importa con qué cita se abre y qué pasa al guardar.
type PropsCobro = { target: unknown; onSaved: () => void; onClose: () => void; visible: boolean };
const mockCobro: { props: PropsCobro | null } = { props: null };
jest.mock("@/components/ChargeSheet", () => ({
  __esModule: true,
  default: (p: PropsCobro) => { mockCobro.props = p; return null; },
}));
jest.mock("@/components/NewApptModal", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/SubscriptionBanner", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/CampanaAvisos", () => ({ __esModule: true, default: () => null }));
// Las cifras del Panel cuentan desde 0 con requestAnimationFrame: en el test
// se muestran ya en su valor final (y sin avisos de act).
jest.mock("@/components/ui", () => ({
  ...jest.requireActual("@/components/ui"),
  useCountUp: (n: number) => n,
}));

// ─── Supabase simulado con estado ────────────────────────────────────────────
// Aplica los filtros eq / in / is / gte / lte sobre filas en memoria, así un
// update de estado se nota en la recarga siguiente.
type Fila = Record<string, unknown> & { id: string };
type Filtro = [op: string, col: string, val: unknown];
const mockBase: {
  citas: Fila[];
  ventas: Record<string, { id: string }[]>;
  errorCitas: unknown;
  updates: { payload: unknown; filtros: Filtro[] }[];
  /** Si está, la revisión de cobro (pos_sales) espera a que se resuelva. */
  esperaVenta: Promise<void> | null;
} = { citas: [], ventas: {}, errorCitas: null, updates: [], esperaVenta: null };

function mockCumple(fila: Fila, filtros: Filtro[]): boolean {
  return filtros.every(([op, col, val]) => {
    const v = col === "pos_sales" ? mockBase.ventas[fila.id] ?? [] : fila[col];
    if (op === "eq") return v === val;
    if (op === "in") return (val as unknown[]).includes(v);
    if (op === "is") return col === "pos_sales" ? (v as unknown[]).length === 0 : v === val;
    if (op === "gte") return String(v) >= String(val);
    if (op === "lte") return String(v) <= String(val);
    return true;
  });
}

jest.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabla: string) => {
      const st: { filtros: Filtro[]; update?: unknown; rango?: [number, number]; head?: boolean } = { filtros: [] };
      const responder = (): unknown => {
        if (tabla === "appointments" && st.update !== undefined) {
          const tocadas = mockBase.citas.filter(c => mockCumple(c, st.filtros));
          mockBase.updates.push({ payload: st.update, filtros: st.filtros });
          tocadas.forEach(c => Object.assign(c, st.update as object));
          return { data: tocadas.map(c => ({ id: c.id })), error: null };
        }
        if (tabla === "appointments") {
          if (mockBase.errorCitas) return { data: null, error: mockBase.errorCitas };
          const filas = mockBase.citas
            .filter(c => mockCumple(c, st.filtros))
            .map(c => ({ ...c, pos_sales: mockBase.ventas[c.id] ?? [] }));
          const [d, h] = st.rango ?? [0, filas.length];
          return { data: filas.slice(d, h + 1), error: null };
        }
        if (tabla === "pos_sales") {
          const cita = st.filtros.find(f => f[1] === "appointment_id")?.[2];
          const res = { data: typeof cita === "string" ? mockBase.ventas[cita] ?? [] : [], error: null };
          return mockBase.esperaVenta ? mockBase.esperaVenta.then(() => res) : res;
        }
        if (tabla === "clients" && st.head) return { data: null, count: 0, error: null };
        return { data: [], error: null };
      };
      const q: Record<string, unknown> = {
        select: (_c: string, o?: { head?: boolean }) => { if (o?.head) st.head = true; return q; },
        update: (v: unknown) => { st.update = v; return q; },
        eq: (c: string, v: unknown) => { st.filtros.push(["eq", c, v]); return q; },
        in: (c: string, v: unknown) => { st.filtros.push(["in", c, v]); return q; },
        is: (c: string, v: unknown) => { st.filtros.push(["is", c, v]); return q; },
        gte: (c: string, v: unknown) => { st.filtros.push(["gte", c, v]); return q; },
        lte: (c: string, v: unknown) => { st.filtros.push(["lte", c, v]); return q; },
        order: () => q,
        limit: () => q,
        range: (d: number, h: number) => { st.rango = [d, h]; return q; },
        overrideTypes: () => q,
        then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve().then(responder).then(ok, ko),
      };
      return q;
    },
  },
}));

// ─── Datos: fechas relativas al hoy DEL NEGOCIO ───────────────────────────────
const hoy = hoyNegocio(ZONA);
const cita = (id: string, dias: number, hora: string, status: string, cliente: string, servicio: string, precio: number | string, extras: { name: string; price: number }[] = []): Fila => ({
  // imported: false como el default de la base; la consulta real lo filtra (historial migrado fuera).
  id, tenant_id: "t1", imported: false, appointment_date: sumarDias(hoy, dias), appointment_time: `${hora}:00`, status,
  client_id: `cli-${id}`, service_id: `svc-${id}`, professional_id: "pro-1", location_id: null,
  clients: { name: cliente, phone: "3001234567" },
  services: { name: servicio, price: precio },
  appointment_services: extras,
  professionals: { name: "Laura" },
});

function datosDePrueba() {
  mockBase.citas = [
    cita("v1", -3, "10:00", "completed", "Ana", "Corte", 20000, [{ name: "Barba", price: 5000 }]),   // 25.000
    cita("v2", -40, "15:30", "confirmed", "Luis", "Tinte", 60000),                                     // 60.000
    cita("h1", 0, "16:00", "pending", "Marta", "Corte", 20000),                                       // 20.000
    cita("p1", 1, "09:00", "confirmed", "Pedro", "Corte", 20000),                                     // 20.000
    cita("p2", 5, "11:00", "pending", "Sofía", "Manicure", "18000"),                                  // 18.000
    // No entran: cancelada, y una cobrada.
    cita("x1", -2, "12:00", "cancelled", "Carlos", "Corte", 20000),
    cita("x2", -1, "12:00", "completed", "Diana", "Corte", 20000),
  ];
  mockBase.ventas = { x2: [{ id: "venta-x2" }] };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockBase.errorCitas = null;
  mockBase.updates = [];
  mockBase.esperaVenta = null;
  mockCobro.props = null;
  datosDePrueba();
});
afterEach(() => jest.restoreAllMocks());

/** Alert.alert que confirma (toca el botón que no es "Cancelar"). */
function confirmarAlertas() {
  return jest.spyOn(Alert, "alert").mockImplementation((_t, _m, botones) => {
    botones?.find(b => b.style !== "cancel")?.onPress?.();
  });
}

describe("pantalla Por cobrar", () => {
  test("secciones, total igual a la suma y resumen por tramo", async () => {
    await render(<PorCobrarScreen />);
    expect(await screen.findByText(fmtMoneyFull(143000))).toBeOnTheScreen();
    expect(screen.getByText("5 citas sin cobro")).toBeOnTheScreen();
    expect(screen.getByText(/No depende del periodo del Panel/)).toBeOnTheScreen();

    expect(screen.getByText(`Vencido ${fmtMoneyFull(85000)} (2)`)).toBeOnTheScreen();
    expect(screen.getByText(`Hoy ${fmtMoneyFull(20000)} (1)`)).toBeOnTheScreen();
    expect(screen.getByText(`Próximas ${fmtMoneyFull(38000)} (2)`)).toBeOnTheScreen();

    expect(screen.getByText("Vencidas")).toBeOnTheScreen();
    expect(screen.getByText("Hoy")).toBeOnTheScreen();
    expect(screen.getByText("Próximas")).toBeOnTheScreen();
    expect(screen.getByText(/Ya pasaron y nadie las cobró/)).toBeOnTheScreen();

    // Cada fila: cliente, servicios (principal + adicionales), profesional y estado.
    expect(screen.getByText("Corte + Barba · con Laura")).toBeOnTheScreen();
    expect(screen.getByText("Completada sin cobro")).toBeOnTheScreen();
    expect(screen.getByText("Confirmada sin cobro")).toBeOnTheScreen();
    expect(screen.getByText(/^Mañana · /)).toBeOnTheScreen();
    // Ni la cancelada ni la cobrada.
    expect(screen.queryByText("Carlos")).toBeNull();
    expect(screen.queryByText("Diana")).toBeNull();

    // Vencidas: las más recientes primero (Ana hace 3 días, Luis hace 40).
    const clientes = screen.getAllByText(/^(Ana|Luis|Marta|Pedro|Sofía)$/).map(n => n.props.children);
    expect(clientes).toEqual(["Ana", "Luis", "Marta", "Pedro", "Sofía"]);
  });

  test("'No asistió' confirma, guarda el estado y saca la fila; los totales se recalculan", async () => {
    const alerta = confirmarAlertas();
    await render(<PorCobrarScreen />);
    await screen.findByText(fmtMoneyFull(143000));

    await fireEvent.press(screen.getByRole("button", { name: "Marcar la cita de Ana como No asistió" }));
    await waitFor(() => expect(screen.queryByText("Ana")).toBeNull());

    expect(alerta).toHaveBeenCalledWith("¿Marcar como No asistió?", expect.stringContaining("Ana"), expect.any(Array), expect.any(Object));
    expect(mockBase.updates).toHaveLength(1);
    expect(mockBase.updates[0].payload).toEqual({ status: "no_show" });
    expect(mockBase.updates[0].filtros).toContainEqual(["eq", "id", "v1"]);
    expect(mockRecordatorio).toHaveBeenCalledWith("t1", expect.objectContaining({ id: "v1", status: "no_show" }), ZONA);

    expect(await screen.findByText(fmtMoneyFull(118000))).toBeOnTheScreen();
    expect(screen.getByText(`Vencido ${fmtMoneyFull(60000)} (1)`)).toBeOnTheScreen();
    expect(screen.getByText("4 citas sin cobro")).toBeOnTheScreen();
  });

  test("si otro la cobró mientras tanto, no cambia el estado y la saca", async () => {
    confirmarAlertas();
    await render(<PorCobrarScreen />);
    await screen.findByText(fmtMoneyFull(143000));
    mockBase.ventas.v2 = [{ id: "venta-web" }];

    await fireEvent.press(screen.getByRole("button", { name: "Marcar la cita de Luis como Cancelada" }));
    await waitFor(() => expect(screen.queryByText("Luis")).toBeNull());
    expect(mockBase.updates).toHaveLength(0);
    expect(Alert.alert).toHaveBeenCalledWith("Esta cita ya se cobró", expect.any(String));
  });

  test("mientras se guarda 'Cancelada', el que espera es ESE botón y los demás se bloquean", async () => {
    confirmarAlertas();
    // La revisión del cobro no responde hasta soltar(): así se ve el estado intermedio.
    let soltar: () => void = () => {};
    mockBase.esperaVenta = new Promise<void>(r => { soltar = r; });
    await render(<PorCobrarScreen />);
    await screen.findByText(fmtMoneyFull(143000));

    const tick = () => new Promise(r => setTimeout(r, 0));
    // Sin esperar a fireEvent: devuelve la promesa del handler, que sigue en la revisión.
    await act(async () => {
      void fireEvent.press(screen.getByRole("button", { name: "Marcar la cita de Luis como Cancelada" }));
      await tick();
    });
    expect(screen.getByRole("button", { name: "Marcar la cita de Luis como Cancelada" })).toBeBusy();
    const noAsistio = screen.getByRole("button", { name: "Marcar la cita de Luis como No asistió" });
    expect(noAsistio).not.toBeBusy();
    expect(noAsistio).toBeDisabled();
    expect(screen.getByRole("button", { name: `Cobrar la cita de Ana, ${fmtMoneyFull(25000)}` })).toBeDisabled();

    await act(async () => { soltar(); await tick(); });
    await waitFor(() => expect(screen.queryByText("Luis")).toBeNull());
    expect(mockBase.updates[0].payload).toEqual({ status: "cancelled" });
  });

  test("si la hoja encuentra la cita ya cobrada (y seguía completada), al cerrarla la fila sale", async () => {
    await render(<PorCobrarScreen />);
    await screen.findByText(fmtMoneyFull(143000));
    // Ana (completada) se cobró desde el portal: la hoja lo detecta y no llama onSaved.
    mockBase.ventas.v1 = [{ id: "venta-web" }];
    await fireEvent.press(screen.getByRole("button", { name: `Cobrar la cita de Ana, ${fmtMoneyFull(25000)}` }));
    await act(async () => { mockCobro.props?.onClose(); });
    await waitFor(() => expect(screen.queryByText("Ana")).toBeNull());
    expect(await screen.findByText(fmtMoneyFull(118000))).toBeOnTheScreen();
    expect(mockCobro.props?.visible).toBe(false);
  });

  test("'Cobrar' abre la hoja con la cita y, al cobrar, la fila sale", async () => {
    await render(<PorCobrarScreen />);
    await screen.findByText(fmtMoneyFull(143000));
    // Hoy solo ofrece cobrar.
    expect(screen.queryByRole("button", { name: "Marcar la cita de Marta como No asistió" })).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: `Cobrar la cita de Marta, ${fmtMoneyFull(20000)}` }));
    expect(mockCobro.props?.visible).toBe(true);
    expect(mockCobro.props?.target).toMatchObject({
      kind: "appointment",
      appt: { id: "h1", clientName: "Marta", serviceName: "Corte", servicePrice: 20000, time: "16:00:00" },
    });

    mockBase.ventas.h1 = [{ id: "venta-h1" }];
    await act(async () => { mockCobro.props?.onSaved(); });
    await waitFor(() => expect(screen.queryByText("Marta")).toBeNull());
    expect(await screen.findByText(fmtMoneyFull(123000))).toBeOnTheScreen();
  });

  test("tocar una próxima abre la Agenda en ese día con el detalle", async () => {
    await render(<PorCobrarScreen />);
    await screen.findByText(fmtMoneyFull(143000));
    await fireEvent.press(screen.getByRole("button", { name: /Pedro/ }));
    expect(mockRouter.dismissTo).toHaveBeenCalledWith({
      pathname: "/(admin)/(tabs)/agenda",
      params: { fecha: sumarDias(hoy, 1), cita: "p1" },
    });
  });

  test("vacío: 'No tienes nada por cobrar'", async () => {
    mockBase.citas = [];
    await render(<PorCobrarScreen />);
    expect(await screen.findByText("No tienes nada por cobrar")).toBeOnTheScreen();
    expect(screen.getByText("Todo cobrado")).toBeOnTheScreen();
  });

  test("error sin datos: ErrorState con reintento", async () => {
    mockBase.errorCitas = { code: "", message: "TypeError: Network request failed" };
    await render(<PorCobrarScreen />);
    expect(await screen.findByText("Error de conexión")).toBeOnTheScreen();

    mockBase.errorCitas = null;
    await fireEvent.press(screen.getByText("Reintentar"));
    expect(await screen.findByText(fmtMoneyFull(143000))).toBeOnTheScreen();
  });
});

describe("tarjeta Por cobrar del Panel", () => {
  test("suma lo mismo que la pantalla y al tocarla la abre", async () => {
    await render(<DashboardScreen />);
    // La etiqueta del lector lleva el monto completo (la tarjeta abrevia desde $1M).
    const tarjeta = await screen.findByRole("button", {
      name: `Por cobrar: ${fmtMoneyFull(143000)}, ${fmtMoneyFull(85000)} vencido. Ver detalle`,
    });
    // La cifra visible es la misma que el total de la pantalla.
    expect(screen.getByText(fmtMoneyFull(143000))).toBeOnTheScreen();
    expect(screen.getByText(`${fmtMoneyFull(85000)} vencido · 2 sin cobrar`)).toBeOnTheScreen();
    expect(screen.getByText("Ver detalle")).toBeOnTheScreen();
    await fireEvent.press(tarjeta);
    expect(mockRouter.push).toHaveBeenCalledWith("/(admin)/por-cobrar");
  });
});
