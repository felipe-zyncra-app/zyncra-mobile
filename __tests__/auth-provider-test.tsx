import { Text } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, render, screen, waitFor } from "@testing-library/react-native";
// jest.mock se eleva sobre los imports: AuthProvider ya recibe los mocks.
import { AuthProvider, useAuth } from "@/lib/auth";

type Callback = (evento: string, sesion: unknown) => void;

let mockOyente: Callback | null = null;
let mockSesionInicial: unknown = null;
const mockFrom = jest.fn();
const mockReplace = jest.fn();

/** Consulta encadenable de supabase que resuelve con `resultado`. */
function consulta(resultado: unknown) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit"]) q[m] = () => q;
  q.then = (ok: (v: unknown) => unknown, mal: (e: unknown) => unknown) => Promise.resolve(resultado).then(ok, mal);
  return q;
}

jest.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: mockSesionInicial } }),
      onAuthStateChange: (cb: Callback) => {
        mockOyente = cb;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
    from: (tabla: string) => mockFrom(tabla),
  },
}));
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSegments: () => ["(auth)", "login"],
}));
jest.mock("@/lib/notifications", () => ({
  borrarPushTokenDelServidor: jest.fn(async () => {}),
  cancelarTodasLasNotificaciones: jest.fn(async () => {}),
}));
jest.mock("@/lib/active-location", () => ({ clearActiveLocationCache: jest.fn() }));

const sesion = { user: { id: "u-duena", email: "duena@negocio.co" }, access_token: "x" };

function Estado() {
  const { estado, tenantId } = useAuth();
  return <Text testID="estado">{`${estado}|${tenantId ?? ""}`}</Text>;
}

describe("AuthProvider", () => {
  beforeEach(async () => {
    // Lo guardado para arrancar rápido (lib/memoria-arranque) no pasa de un test a otro.
    await AsyncStorage.clear();
    mockOyente = null;
    mockSesionInicial = null;
    mockFrom.mockReset();
    mockReplace.mockReset();
    mockFrom.mockImplementation((tabla: string) =>
      tabla === "tenants"
        ? consulta({ data: [{ id: "t-1" }], error: null })
        : consulta({ data: [], error: null }),
    );
  });

  test("arranque sin red con el token vencido: el refresco posterior resuelve el rol", async () => {
    // getSession devolvió null (auth-js no pudo refrescar sin red) y
    // conserva la sesión guardada; INITIAL_SESSION llega sin sesión.
    await render(<AuthProvider><Estado /></AuthProvider>);
    await act(async () => { mockOyente!("INITIAL_SESSION", null); });
    expect(screen.getByTestId("estado")).toHaveTextContent("sin-sesion|");

    // Vuelve la red y el refresco automático recupera la sesión.
    await act(async () => { mockOyente!("TOKEN_REFRESHED", sesion); });
    await waitFor(() => expect(screen.getByTestId("estado")).toHaveTextContent("admin|t-1"));
  });

  test("el refresco horario del token de un usuario ya resuelto no vuelve a consultar el rol", async () => {
    mockSesionInicial = sesion;
    await render(<AuthProvider><Estado /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("estado")).toHaveTextContent("admin|t-1"));
    const consultas = mockFrom.mock.calls.length;

    await act(async () => { mockOyente!("TOKEN_REFRESHED", sesion); });
    expect(screen.getByTestId("estado")).toHaveTextContent("admin|t-1");
    expect(mockFrom.mock.calls.length).toBe(consultas);
  });

  test("el staff pregunta si es dueño y si es del equipo a la vez, no una tras otra", async () => {
    mockSesionInicial = { user: { id: "u-laura", email: "laura@negocio.co" }, access_token: "x" };
    // La consulta del dueño no responde hasta que se le diga: si la del equipo
    // esperara a la del dueño, todavía no se habría pedido.
    let soltarDueno: (v: unknown) => void = () => {};
    const dueno = new Promise(r => { soltarDueno = r; });
    mockFrom.mockImplementation((tabla: string) => {
      if (tabla === "tenants") {
        const q: Record<string, unknown> = {};
        for (const m of ["select", "eq", "order", "limit"]) q[m] = () => q;
        q.then = (ok: (v: unknown) => unknown, mal: (e: unknown) => unknown) => dueno.then(ok, mal);
        return q;
      }
      return consulta({ data: [{ id: "p-1", tenant_id: "t-1", is_active: true, permissions: null }], error: null });
    });
    await render(<AuthProvider><Estado /></AuthProvider>);
    await waitFor(() => expect(mockFrom.mock.calls.map(c => c[0])).toEqual(expect.arrayContaining(["tenants", "professionals"])));
    await act(async () => { soltarDueno({ data: [], error: null }); });
    await waitFor(() => expect(screen.getByTestId("estado")).toHaveTextContent("staff|t-1"));
  });

  test("con el rol guardado en el teléfono, entra de una y confirma con el servidor en silencio", async () => {
    mockSesionInicial = sesion;
    await AsyncStorage.setItem("zyncra_acceso_u-duena", JSON.stringify({ estado: "admin", tenantId: "t-guardado", professionalId: null, permisos: null }));
    // El servidor tarda: mientras tanto la app ya está adentro con lo guardado.
    let soltar: (v: unknown) => void = () => {};
    const respuesta = new Promise(r => { soltar = r; });
    mockFrom.mockImplementation((tabla: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "limit"]) q[m] = () => q;
      const res = tabla === "tenants" ? respuesta : Promise.resolve({ data: [], error: null });
      q.then = (ok: (v: unknown) => unknown, mal: (e: unknown) => unknown) => res.then(ok, mal);
      return q;
    });
    await render(<AuthProvider><Estado /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("estado")).toHaveTextContent("admin|t-guardado"));

    // Responde el servidor con otro negocio: manda el servidor.
    await act(async () => { soltar({ data: [{ id: "t-1" }], error: null }); });
    await waitFor(() => expect(screen.getByTestId("estado")).toHaveTextContent("admin|t-1"));
    expect(JSON.parse((await AsyncStorage.getItem("zyncra_acceso_u-duena"))!).tenantId).toBe("t-1");
  });

  test("si el servidor dice que ya no tiene acceso, sale aunque hubiera un rol guardado", async () => {
    mockSesionInicial = sesion;
    await AsyncStorage.setItem("zyncra_acceso_u-duena", JSON.stringify({ estado: "admin", tenantId: "t-guardado", professionalId: null, permisos: null }));
    mockFrom.mockImplementation(() => consulta({ data: [], error: null }));
    await render(<AuthProvider><Estado /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("estado")).toHaveTextContent("sin-rol|"));
    expect(await AsyncStorage.getItem("zyncra_acceso_u-duena")).toBeNull();
  });
});
