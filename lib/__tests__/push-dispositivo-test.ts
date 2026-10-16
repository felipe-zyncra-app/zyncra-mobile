import type * as NotifModulo from "@/lib/notifications";

// Registro de cada teléfono para los avisos de citas (push_devices), dueño y
// colaborador, y su liberación al cerrar sesión.

let mockRpcError: { message: string } | null = null;

jest.mock("@react-native-async-storage/async-storage", () => {
  const almacen: Record<string, string> = {};
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (k: string) => almacen[k] ?? null),
      setItem: jest.fn(async (k: string, v: string) => { almacen[k] = v; }),
      removeItem: jest.fn(async (k: string) => { delete almacen[k]; }),
      multiRemove: jest.fn(async (ks: string[]) => { ks.forEach(k => { delete almacen[k]; }); }),
    },
  };
});

jest.mock("expo-constants", () => ({ __esModule: true, default: { expoConfig: { extra: { eas: { projectId: "p1" } } } } }));

jest.mock("expo-notifications", () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => null),
  getPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: "ExponentPushToken[abc123]" })),
  AndroidImportance: { HIGH: 4 },
}));

jest.mock("@/lib/supabase", () => {
  const builder = () => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "update", "order", "limit"]) b[m] = jest.fn(() => b);
    b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
    return b;
  };
  return {
    supabase: {
      from: jest.fn(() => builder()),
      rpc: jest.fn(async (nombre: string) => ({ error: nombre === "registrar_push_dispositivo" ? mockRpcError : null })),
      auth: { getSession: jest.fn(async () => ({ data: { session: { user: { id: "u1" } } } })) },
    },
  };
});

function cargar() {
  let n!: typeof NotifModulo;
  let supabase!: { from: jest.Mock; rpc: jest.Mock };
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- copia aislada del módulo
    supabase = (require("@/lib/supabase") as { supabase: { from: jest.Mock; rpc: jest.Mock } }).supabase;
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- copia aislada del módulo
    n = require("@/lib/notifications") as typeof NotifModulo;
  });
  supabase.from.mockClear();
  supabase.rpc.mockClear();
  return { n, supabase };
}

beforeEach(() => { mockRpcError = null; });

describe("registro del teléfono para los avisos de citas", () => {
  it("el colaborador se anota con su rol sin tocar tenants.push_token", async () => {
    const { n, supabase } = cargar();
    const token = await n.registrarPushDelDispositivo("t1", { rol: "staff" });
    expect(token).toBe("ExponentPushToken[abc123]");
    expect(supabase.rpc).toHaveBeenCalledWith("registrar_push_dispositivo", {
      p_tenant_id: "t1", p_token: "ExponentPushToken[abc123]", p_platform: expect.any(String),
    });
    expect(supabase.from).not.toHaveBeenCalledWith("tenants");
  });

  it("el dueño se anota y además deja tenants.push_token para las versiones viejas", async () => {
    const { n, supabase } = cargar();
    await n.registrarPushDelDispositivo("t1");
    expect(supabase.rpc).toHaveBeenCalledWith("registrar_push_dispositivo", expect.objectContaining({ p_tenant_id: "t1" }));
    expect(supabase.from).toHaveBeenCalledWith("tenants");
  });

  it("si la base no lo acepta, el colaborador queda sin registrar", async () => {
    mockRpcError = { message: "No perteneces a este negocio" };
    const { n } = cargar();
    jest.spyOn(console, "warn").mockImplementation(() => {});
    expect(await n.registrarPushDelDispositivo("t1", { rol: "staff" })).toBeNull();
  });

  it("al cerrar sesión se libera el teléfono de los avisos", async () => {
    const { n, supabase } = cargar();
    await n.registrarPushDelDispositivo("t1", { rol: "staff" });
    supabase.rpc.mockClear();
    await n.borrarPushTokenDelServidor("t1");
    expect(supabase.rpc).toHaveBeenCalledWith("liberar_push_dispositivo", { p_token: "ExponentPushToken[abc123]" });
    expect(supabase.rpc).toHaveBeenCalledWith("liberar_push_token", { p_token: "ExponentPushToken[abc123]" });
  });
});
