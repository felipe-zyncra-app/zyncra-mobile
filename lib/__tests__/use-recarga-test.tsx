import { useState } from "react";
import { AppState } from "react-native";
import { renderHook, act } from "@testing-library/react-native";
import { useRecarga, useGuardRespuestas, useHoyNegocio } from "@/lib/useRecarga";

// useRecarga (D12): carga al enfocar y recarga al volver a la pantalla, al
// volver a primer plano, a medianoche del negocio, al cambiar de sede o de
// deps. Se simulan el foco de expo-router, AppState y la sede activa.

// Foco de la pantalla: como useFocusEffect de React Navigation, corre el
// efecto al enfocar, lo limpia al desenfocar y lo repite si cambia el callback
// mientras la pantalla se ve.
const mockFoco = { enfocada: true, subs: new Set<() => void>() };
jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- dentro de jest.mock no se puede usar import
  const React = require("react");
  return {
    useFocusEffect: (cb: () => void | (() => void)) => {
      const enfocada = React.useSyncExternalStore(
        (f: () => void) => { mockFoco.subs.add(f); return () => { mockFoco.subs.delete(f); }; },
        () => mockFoco.enfocada,
      );
      React.useEffect(() => (enfocada ? cb() : undefined), [cb, enfocada]);
    },
  };
});

const mockSede = { subs: new Set<() => void>() };
jest.mock("@/lib/active-location", () => ({
  suscribirSedeActiva: (fn: () => void) => {
    mockSede.subs.add(fn);
    return () => { mockSede.subs.delete(fn); };
  },
}));

const oyentesApp = new Set<(s: string) => void>();
beforeEach(() => {
  mockFoco.enfocada = true;
  oyentesApp.clear();
  jest.spyOn(AppState, "addEventListener").mockImplementation(((_tipo: string, h: (s: string) => void) => {
    oyentesApp.add(h);
    return { remove: () => { oyentesApp.delete(h); } };
  }) as unknown as typeof AppState.addEventListener);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const BOG = "America/Bogota";
const MAD = "Europe/Madrid";

async function enfocar(v: boolean) {
  await act(async () => {
    mockFoco.enfocada = v;
    mockFoco.subs.forEach(f => f());
  });
}
async function primerPlano() {
  await act(async () => { oyentesApp.forEach(h => h("background")); });
  await act(async () => { oyentesApp.forEach(h => h("active")); });
}
async function cambiarSede() {
  await act(async () => { mockSede.subs.forEach(f => f()); });
}
async function avanzar(ms: number) {
  await act(async () => { jest.advanceTimersByTime(ms); });
}

function diferido<T>() {
  let resolve!: (v: T) => void;
  const promesa = new Promise<T>(r => { resolve = r; });
  return { promesa, resolve };
}

describe("useRecarga: cuándo carga", () => {
  test("carga al enfocar la primera vez, una sola vez", async () => {
    const cargar = jest.fn();
    await renderHook(() => useRecarga(cargar, ["t1"], { timeZone: BOG }));
    expect(cargar).toHaveBeenCalledTimes(1);
  });

  test("no carga mientras no está habilitado (sin tenantId o sin useTenant().ready)", async () => {
    const cargar = jest.fn();
    const h = await renderHook(({ hab }: { hab: boolean }) => useRecarga(cargar, ["t1"], { timeZone: BOG, habilitado: hab }), { initialProps: { hab: false } });
    expect(cargar).not.toHaveBeenCalled();
    await act(async () => { await h.result.current.recargar(); });
    expect(cargar).not.toHaveBeenCalled();
    await h.rerender({ hab: true });
    expect(cargar).toHaveBeenCalledTimes(1);
  });

  test("recarga cuando cambian las deps (filtro, zona), no cuando se repiten", async () => {
    const cargar = jest.fn();
    const h = await renderHook(({ filtro }: { filtro: string }) => useRecarga(cargar, ["t1", filtro], { timeZone: BOG }), { initialProps: { filtro: "hoy" } });
    await h.rerender({ filtro: "hoy" });
    expect(cargar).toHaveBeenCalledTimes(1);
    await h.rerender({ filtro: "semana" });
    expect(cargar).toHaveBeenCalledTimes(2);
  });

  test("recarga al volver a la pantalla (volver de cobrar o de crear una cita)", async () => {
    const cargar = jest.fn();
    await renderHook(() => useRecarga(cargar, [], { timeZone: BOG }));
    await enfocar(false);
    expect(cargar).toHaveBeenCalledTimes(1);
    await enfocar(true);
    expect(cargar).toHaveBeenCalledTimes(2);
  });

  test("si cambian las deps con la pantalla oculta, carga al volver y una sola vez", async () => {
    const cargar = jest.fn();
    const h = await renderHook(({ z }: { z: string }) => useRecarga(cargar, [z], { timeZone: BOG }), { initialProps: { z: BOG } });
    await enfocar(false);
    await h.rerender({ z: MAD });
    expect(cargar).toHaveBeenCalledTimes(1);
    await enfocar(true);
    expect(cargar).toHaveBeenCalledTimes(2);
  });

  test("frescuraMs: al volver dentro de la ventana no recarga; pasada la ventana sí", async () => {
    jest.useFakeTimers({ now: new Date("2026-09-26T15:00:00Z") });
    const cargar = jest.fn();
    await renderHook(() => useRecarga(cargar, [], { timeZone: BOG, frescuraMs: 30_000 }));
    await enfocar(false);
    await enfocar(true);
    expect(cargar).toHaveBeenCalledTimes(1);
    await enfocar(false);
    await avanzar(31_000);
    await enfocar(true);
    expect(cargar).toHaveBeenCalledTimes(2);
  });
});

describe("useRecarga: primer plano, medianoche y sede", () => {
  test("recarga al volver a primer plano con la pantalla visible", async () => {
    jest.useFakeTimers({ now: new Date("2026-09-26T15:00:00Z") });
    const cargar = jest.fn();
    await renderHook(() => useRecarga(cargar, [], { timeZone: BOG }));
    await avanzar(2_000);
    await primerPlano();
    expect(cargar).toHaveBeenCalledTimes(2);
  });

  test("alVolver: false no recarga al volver a primer plano", async () => {
    jest.useFakeTimers({ now: new Date("2026-09-26T15:00:00Z") });
    const cargar = jest.fn();
    await renderHook(() => useRecarga(cargar, [], { timeZone: BOG, alVolver: false }));
    await avanzar(2_000);
    await primerPlano();
    expect(cargar).toHaveBeenCalledTimes(1);
  });

  test("a primer plano con la pantalla oculta: no carga ya, pero sí al volver (aunque esté fresca)", async () => {
    jest.useFakeTimers({ now: new Date("2026-09-26T15:00:00Z") });
    const cargar = jest.fn();
    await renderHook(() => useRecarga(cargar, [], { timeZone: BOG, frescuraMs: 600_000 }));
    await enfocar(false);
    await avanzar(2_000);
    await primerPlano();
    expect(cargar).toHaveBeenCalledTimes(1);
    await enfocar(true);
    expect(cargar).toHaveBeenCalledTimes(2);
  });

  test("a medianoche del negocio recarga y `hoy` pasa al día siguiente", async () => {
    // 11:59 PM del sábado 26 en Bogotá.
    jest.useFakeTimers({ now: new Date("2026-09-27T04:59:30Z") });
    const cargar = jest.fn();
    const h = await renderHook(() => useRecarga(cargar, [], { timeZone: BOG }));
    expect(h.result.current.hoy).toBe("2026-09-26");
    await avanzar(60_000);
    expect(h.result.current.hoy).toBe("2026-09-27");
    expect(cargar).toHaveBeenCalledTimes(2);
  });

  test("medianoche es la del negocio, no la del teléfono ni la de UTC", async () => {
    // 7:30 PM en Bogotá: en UTC ya es el 27, pero el negocio sigue en el 26.
    jest.useFakeTimers({ now: new Date("2026-09-27T00:30:00Z") });
    const cargar = jest.fn();
    const h = await renderHook(() => useRecarga(cargar, [], { timeZone: BOG }));
    expect(h.result.current.hoy).toBe("2026-09-26");
    await avanzar(10 * 60_000);
    expect(cargar).toHaveBeenCalledTimes(1);
  });

  test("alCambiarDia: false no recarga a medianoche (pero `hoy` sí cambia)", async () => {
    jest.useFakeTimers({ now: new Date("2026-09-27T04:59:30Z") });
    const cargar = jest.fn();
    const h = await renderHook(() => useRecarga(cargar, [], { timeZone: BOG, alCambiarDia: false }));
    await avanzar(60_000);
    expect(h.result.current.hoy).toBe("2026-09-27");
    expect(cargar).toHaveBeenCalledTimes(1);
  });

  test("volver a primer plano al día siguiente carga una sola vez, no dos", async () => {
    jest.useFakeTimers({ now: new Date("2026-09-27T04:00:00Z") });
    const cargar = jest.fn();
    const h = await renderHook(() => useRecarga(cargar, [], { timeZone: BOG }));
    // El teléfono estuvo dormido toda la noche: el intervalo no corrió.
    jest.setSystemTime(new Date("2026-09-27T14:00:00Z"));
    await primerPlano();
    expect(h.result.current.hoy).toBe("2026-09-27");
    expect(cargar).toHaveBeenCalledTimes(2);
  });

  test("cambio de sede: recarga si se ve; si no, al volver", async () => {
    const cargar = jest.fn();
    await renderHook(() => useRecarga(cargar, [], { timeZone: BOG }));
    await cambiarSede();
    expect(cargar).toHaveBeenCalledTimes(2);
    await enfocar(false);
    await cambiarSede();
    expect(cargar).toHaveBeenCalledTimes(2);
    await enfocar(true);
    expect(cargar).toHaveBeenCalledTimes(3);
  });

  test("alCambiarSede: false no se suscribe", async () => {
    const cargar = jest.fn();
    await renderHook(() => useRecarga(cargar, [], { timeZone: BOG, alCambiarSede: false }));
    expect(mockSede.subs.size).toBe(0);
  });

  test("al desmontar suelta AppState, el intervalo y la sede", async () => {
    jest.useFakeTimers({ now: new Date("2026-09-26T15:00:00Z") });
    const creados = jest.spyOn(global, "setInterval");
    const limpiados = jest.spyOn(global, "clearInterval");
    const h = await renderHook(() => useRecarga(jest.fn(), [], { timeZone: BOG }));
    expect(oyentesApp.size).toBeGreaterThan(0);
    expect(mockSede.subs.size).toBe(1);
    expect(creados).toHaveBeenCalled();
    await h.unmount();
    expect(oyentesApp.size).toBe(0);
    expect(mockSede.subs.size).toBe(0);
    const ids = limpiados.mock.calls.map(c => c[0]);
    for (const r of creados.mock.results) expect(ids).toContain(r.value);
  });
});

describe("useRecarga: recargar y cargando", () => {
  test("recargar() espera a que termine la carga y `cargando` lo refleja", async () => {
    const d = diferido<void>();
    const cargar = jest.fn(() => d.promesa);
    const h = await renderHook(() => useRecarga(cargar, [], { timeZone: BOG }));
    expect(h.result.current.cargando).toBe(true);
    await act(async () => { d.resolve(); });
    expect(h.result.current.cargando).toBe(false);

    const cargar2 = jest.fn(async () => {});
    cargar.mockImplementation(cargar2);
    await act(async () => { await h.result.current.recargar(); });
    expect(cargar2).toHaveBeenCalledTimes(1);
    expect(h.result.current.cargando).toBe(false);
  });

  test("usa siempre la última versión de `cargar` (no una closure vieja)", async () => {
    const vistos: string[] = [];
    const h = await renderHook(({ texto }: { texto: string }) => useRecarga(() => { vistos.push(texto); }, [], { timeZone: BOG }), { initialProps: { texto: "viejo" } });
    await h.rerender({ texto: "nuevo" });
    await act(async () => { await h.result.current.recargar(); });
    expect(vistos).toEqual(["viejo", "nuevo"]);
  });

  test("si `cargar` lanza, el hook no se rompe y `cargando` vuelve a false", async () => {
    const cargar = jest.fn(async () => { throw new Error("sin red"); });
    const h = await renderHook(() => useRecarga(cargar, [], { timeZone: BOG }));
    await act(async () => { await h.result.current.recargar(); });
    expect(cargar).toHaveBeenCalledTimes(2);
    expect(h.result.current.cargando).toBe(false);
  });
});

describe("useGuardRespuestas con useRecarga (reemplazo de la bandera `cancelled`)", () => {
  test("una respuesta vieja que llega después de la nueva no la pisa", async () => {
    const pedidos: Record<string, ReturnType<typeof diferido<string>>> = {};
    const h = await renderHook(({ filtro }: { filtro: string }) => {
      const guard = useGuardRespuestas();
      const [datos, setDatos] = useState<string | null>(null);
      useRecarga(async () => {
        const turno = guard.nuevo();
        pedidos[filtro] = diferido<string>();
        const r = await pedidos[filtro].promesa;
        if (turno.vigente()) setDatos(r);
      }, [filtro], { timeZone: BOG });
      return datos;
    }, { initialProps: { filtro: "lunes" } });

    await h.rerender({ filtro: "martes" });
    await act(async () => { pedidos.martes.resolve("citas del martes"); });
    expect(h.result.current).toBe("citas del martes");
    await act(async () => { pedidos.lunes.resolve("citas del lunes"); });
    expect(h.result.current).toBe("citas del martes");
  });

  test("tras desmontar, ninguna respuesta queda vigente", async () => {
    let turnoVigente: (() => boolean) | null = null;
    const h = await renderHook(() => {
      const guard = useGuardRespuestas();
      useRecarga(() => { turnoVigente = guard.nuevo().vigente; }, [], { timeZone: BOG });
    });
    expect(turnoVigente!()).toBe(true);
    await h.unmount();
    expect(turnoVigente!()).toBe(false);
  });

  test("el guard es el mismo objeto en cada render", async () => {
    const h = await renderHook(({ n }: { n: number }) => { void n; return useGuardRespuestas(); }, { initialProps: { n: 1 } });
    const primero = h.result.current;
    await h.rerender({ n: 2 });
    expect(h.result.current).toBe(primero);
  });
});

describe("useHoyNegocio", () => {
  test("día del negocio, que cambia a su medianoche y con la zona", async () => {
    jest.useFakeTimers({ now: new Date("2026-09-26T21:59:30Z") });   // 23:59 en Madrid, 16:59 en Bogotá
    const h = await renderHook(({ z }: { z: string }) => useHoyNegocio(z), { initialProps: { z: MAD } });
    expect(h.result.current).toBe("2026-09-26");
    await avanzar(60_000);
    expect(h.result.current).toBe("2026-09-27");
    await h.rerender({ z: BOG });
    expect(h.result.current).toBe("2026-09-26");
  });

  test("se pone al día al volver a primer plano", async () => {
    jest.useFakeTimers({ now: new Date("2026-09-26T15:00:00Z") });
    const h = await renderHook(() => useHoyNegocio(BOG));
    jest.setSystemTime(new Date("2026-09-28T15:00:00Z"));
    await primerPlano();
    expect(h.result.current).toBe("2026-09-28");
  });
});
