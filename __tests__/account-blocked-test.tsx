import { Platform, Alert } from "react-native";
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
// jest.mock se eleva sobre los imports: AccountBlocked ya recibe los mocks.
import AccountBlocked from "@/components/AccountBlocked";

const mockCerrarSesion = jest.fn(async () => {});
let mockRol: "admin" | "staff" = "admin";

jest.mock("@/lib/auth", () => ({
  useAuth: () => ({ role: mockRol, cerrarSesion: mockCerrarSesion }),
}));
let mockEstadoServidor: "actualizado" | "pendiente" | "desconocido" = "pendiente";
jest.mock("@/lib/cuenta", () => ({
  ...jest.requireActual("@/lib/cuenta"),
  estadoServidorCuentas: jest.fn(async () => ({ estado: mockEstadoServidor })),
}));
jest.mock("@/lib/tenant", () => ({
  useTenant: () => ({ tenant: { name: "Barbería Central", phone: "", address: "", slug: "barberia-central" } }),
}));


function conPlataforma(os: "ios" | "android") {
  Object.defineProperty(Platform, "OS", { configurable: true, get: () => os });
}

describe("AccountBlocked", () => {
  const osOriginal = Platform.OS;
  afterEach(() => {
    conPlataforma(osOriginal as "ios" | "android");
    mockCerrarSesion.mockClear();
    mockRol = "admin";
    mockEstadoServidor = "pendiente";
    jest.restoreAllMocks();
  });

  test("iOS: sin botón de pago (3.1.1) y con eliminar cuenta (5.1.1(v))", async () => {
    conPlataforma("ios");
    await render(<AccountBlocked />);
    expect(screen.queryByText("Pagar mi plan")).toBeNull();
    expect(screen.getByRole("button", { name: /Eliminar mi cuenta/ })).toBeOnTheScreen();
    expect(screen.getByText("Política de privacidad")).toBeOnTheScreen();
  });

  test("Android: el dueño ve el pago; el staff nunca", async () => {
    conPlataforma("android");
    await render(<AccountBlocked />);
    expect(screen.getByText("Pagar mi plan")).toBeOnTheScreen();

    mockRol = "staff";
    await render(<AccountBlocked />);
    expect(screen.queryByText("Pagar mi plan")).toBeNull();
  });

  test("Cerrar sesión usa cerrarSesion (limpia push y funciona sin red)", async () => {
    await render(<AccountBlocked />);
    await fireEvent.press(screen.getByRole("button", { name: /Cerrar sesión/ }));
    expect(mockCerrarSesion).toHaveBeenCalledTimes(1);
  });

  test("Eliminar cuenta pide doble confirmación", async () => {
    const alerta = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    await render(<AccountBlocked />);
    await fireEvent.press(screen.getByRole("button", { name: /Eliminar mi cuenta/ }));
    expect(alerta).toHaveBeenCalledWith("Eliminar cuenta", expect.any(String), expect.any(Array));
  });

  test("colaborador sin la migración: no borra (arrastraría sus citas) y remite a soporte", async () => {
    mockRol = "staff";
    mockEstadoServidor = "pendiente";
    const alerta = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    await render(<AccountBlocked />);
    await fireEvent.press(screen.getByRole("button", { name: /Eliminar mi cuenta/ }));
    await waitFor(() => expect(alerta).toHaveBeenCalled());
    const [titulo, mensaje, botones] = alerta.mock.calls[0];
    expect(titulo).toBe("Eliminar cuenta");
    expect(mensaje).toMatch(/soporte/);
    expect((botones ?? []).map(b => b.text)).toEqual(["Cancelar", "Ir a soporte"]);
  });

  test("colaborador sin poder verificar el servidor: no sigue", async () => {
    mockRol = "staff";
    mockEstadoServidor = "desconocido";
    const alerta = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    await render(<AccountBlocked />);
    await fireEvent.press(screen.getByRole("button", { name: /Eliminar mi cuenta/ }));
    await waitFor(() => expect(alerta).toHaveBeenCalledWith("No se pudo continuar", expect.any(String)));
  });

  test("colaborador con la migración aplicada: doble confirmación", async () => {
    mockRol = "staff";
    mockEstadoServidor = "actualizado";
    const alerta = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    await render(<AccountBlocked />);
    await fireEvent.press(screen.getByRole("button", { name: /Eliminar mi cuenta/ }));
    await waitFor(() => expect(alerta).toHaveBeenCalledWith("Eliminar cuenta", expect.stringMatching(/colaborador/), expect.any(Array)));
  });
});
