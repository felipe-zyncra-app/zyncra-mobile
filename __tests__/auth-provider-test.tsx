import { Text } from "react-native";
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
  beforeEach(() => {
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
});
