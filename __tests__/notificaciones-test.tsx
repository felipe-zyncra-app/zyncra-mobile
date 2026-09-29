import { render, screen, fireEvent } from "@testing-library/react-native";
import NotificacionesScreen from "@/app/(admin)/notificaciones";
import CampanaAvisos from "@/components/CampanaAvisos";
import type { EstadoCampana } from "@/lib/useAvisos";
import type { AvisoVisible } from "@/lib/avisos";

// Campana del Panel y su pantalla: contador de no leídos, lista agrupada,
// tocar un aviso lleva a la Agenda en ese día, descartar, y los estados de
// carga, vacío y error. Los datos (useAvisos) se simulan: sus reglas se
// prueban en lib/__tests__/avisos-test.ts.
// (jest.mock se eleva sobre los imports; las variables "mock*" se leen al usar.)

const mockRouter = {
  push: jest.fn(), back: jest.fn(), replace: jest.fn(), dismissTo: jest.fn(), canGoBack: jest.fn(() => true),
};
jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));

let mockEstado: EstadoCampana;
jest.mock("@/lib/useAvisos", () => ({
  RUTA_AVISOS: "/(admin)/notificaciones",
  useAvisos: () => mockEstado,
}));

const aviso = (extra: Partial<AvisoVisible>): AvisoVisible => ({
  id: "B_c1", citaId: "c1", tipo: "sin_confirmar", grupo: "urgente",
  cliente: "Juan Pérez", servicio: "Corte", fecha: "2026-09-28",
  cuando: "Hoy · 4:30 PM", etiqueta: "En 1 h 30 min", leido: false,
  ...extra,
});

function estado(extra: Partial<EstadoCampana> = {}): EstadoCampana {
  return {
    avisos: [], noLeidos: 0, cargado: true, error: null, sede: null,
    recargar: jest.fn(async () => {}), marcarLeido: jest.fn(), descartar: jest.fn(), marcarTodosLeidos: jest.fn(),
    ...extra,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockEstado = estado();
});

describe("campana del Panel", () => {
  test("sin avisos: solo la campana, sin contador", async () => {
    await render(<CampanaAvisos />);
    expect(screen.getByLabelText("Notificaciones")).toBeOnTheScreen();
  });

  test("con no leídos: contador y etiqueta para el lector; tocar abre la lista", async () => {
    mockEstado = estado({ noLeidos: 3 });
    await render(<CampanaAvisos />);
    // El número se ve, pero el lector de pantalla lo oye en la etiqueta del botón.
    expect(screen.getByText("3", { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.queryByText("3")).toBeNull();
    await fireEvent.press(screen.getByLabelText("Notificaciones, 3 sin leer"));
    expect(mockRouter.push).toHaveBeenCalledWith("/(admin)/notificaciones");
  });

  test("más de 99 se muestra como 99+", async () => {
    mockEstado = estado({ noLeidos: 120 });
    await render(<CampanaAvisos />);
    expect(screen.getByText("99+", { includeHiddenElements: true })).toBeOnTheScreen();
  });
});

describe("pantalla de notificaciones", () => {
  test("cargando: sin lista todavía", async () => {
    mockEstado = estado({ cargado: false });
    await render(<NotificacionesScreen />);
    expect(screen.queryByText("No tienes avisos")).toBeNull();
  });

  test("vacío: 'No tienes avisos'", async () => {
    await render(<NotificacionesScreen />);
    expect(screen.getByText("No tienes avisos")).toBeOnTheScreen();
    expect(screen.getByText("Todo en orden por ahora")).toBeOnTheScreen();
  });

  test("error sin datos: ErrorState con reintento", async () => {
    const recargar = jest.fn(async () => {});
    mockEstado = estado({ cargado: false, error: new Error("Network request failed"), recargar });
    await render(<NotificacionesScreen />);
    await fireEvent.press(screen.getByText("Reintentar"));
    expect(recargar).toHaveBeenCalled();
  });

  test("lista agrupada; tocar un aviso lo marca leído y abre la Agenda en ese día", async () => {
    mockEstado = estado({
      avisos: [
        aviso({}),
        aviso({ id: "D_c2", citaId: "c2", tipo: "nueva_cita", grupo: "actividad", cliente: "Ana", fecha: "2026-10-03", cuando: "sáb 3 oct · 3:00 PM", etiqueta: "Hace 5 min", leido: true }),
      ],
      noLeidos: 1,
      sede: "Sede Norte",
    });
    await render(<NotificacionesScreen />);
    expect(screen.getByText("1 sin leer · Sede Norte")).toBeOnTheScreen();
    expect(screen.getByText("Urgente · 1")).toBeOnTheScreen();
    expect(screen.getByText("Actividad reciente · 1")).toBeOnTheScreen();
    expect(screen.getByText("Corte · Hoy · 4:30 PM")).toBeOnTheScreen();

    await fireEvent.press(screen.getByLabelText("Nueva cita: Ana, Corte · sáb 3 oct · 3:00 PM. Hace 5 min"));
    expect(mockEstado.marcarLeido).toHaveBeenCalledWith("D_c2");
    expect(mockRouter.dismissTo).toHaveBeenCalledWith({
      pathname: "/(admin)/(tabs)/agenda",
      params: { fecha: "2026-10-03", cita: "c2" },
    });
  });

  test("descartar un aviso y marcar todos como leídos", async () => {
    mockEstado = estado({ avisos: [aviso({})], noLeidos: 1 });
    await render(<NotificacionesScreen />);
    await fireEvent.press(screen.getByLabelText("Descartar aviso de Juan Pérez"));
    expect(mockEstado.descartar).toHaveBeenCalledWith("B_c1");
    await fireEvent.press(screen.getByLabelText("Marcar todos como leídos"));
    expect(mockEstado.marcarTodosLeidos).toHaveBeenCalled();
  });
});
