import {
  esErrorDeRed, mensajeError, exigirFilas, traerTodo, traerTodoDetalle, traerPorIds,
  patchTenantSettings, nuevoId, ErrorDB,
} from "@/lib/db";

// Supabase de mentira: solo lo que usan traerTodo y patchTenantSettings.
const mockEstado: { rpc: { data: unknown; error: unknown }; actualizado: unknown } = {
  rpc: { data: null, error: { code: "PGRST202", message: "Could not find the function" } },
  actualizado: null,
};
jest.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: async () => mockEstado.rpc,
    from: () => {
      const q: any = {
        _upd: null,
        select: () => q,
        eq: () => q,
        single: async () => ({ data: { settings: { timezone: "Europe/Madrid", schedule: { a: 1 } } }, error: null }),
        update: (v: unknown) => { q._upd = v; return q; },
        then: (ok: (v: unknown) => unknown) => {
          mockEstado.actualizado = q._upd;
          return Promise.resolve({ data: [{ id: "t1" }], error: null }).then(ok);
        },
      };
      return q;
    },
  },
}));

describe("lib/db", () => {
  test("distingue error de red de error de base", () => {
    expect(esErrorDeRed({ message: "TypeError: Network request failed", code: "" })).toBe(true);
    expect(esErrorDeRed({ message: "duplicate key", code: "23505" })).toBe(false);
  });

  test("mensajes en español, con contexto; los RAISE de la base pasan tal cual", () => {
    expect(mensajeError({ code: "23505", message: "dup" }, "No se pudo guardar el cliente"))
      .toBe("No se pudo guardar el cliente. Ya existe un registro con esos datos.");
    expect(mensajeError({ code: "P0001", message: "Este servicio tiene citas." })).toBe("Este servicio tiene citas.");
  });

  test("exigirFilas detecta el update que no tocó nada (RLS)", () => {
    expect(() => exigirFilas({ data: [], error: null })).toThrow(ErrorDB);
  });

  test("traerTodo pagina por bloques de 1000 y lanza si un bloque falla", async () => {
    const todas = Array.from({ length: 2500 }, (_, i) => i);
    const pedidos: [number, number][] = [];
    const filas = await traerTodo(async (d, h) => { pedidos.push([d, h]); return { data: todas.slice(d, h + 1), error: null }; });
    expect(filas).toHaveLength(2500);
    expect(pedidos).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);

    const r = await traerTodoDetalle(async (d, h) => ({ data: todas.slice(d, h + 1), error: null }), { tope: 1500 });
    expect([r.filas.length, r.truncado]).toEqual([1500, true]);

    await expect(traerTodo(async () => ({ data: null, error: { message: "Network request failed" } })))
      .rejects.toThrow("Revisa tu conexión");
  });

  test("traerPorIds parte la lista en lotes", async () => {
    const lotes: number[] = [];
    const ids = Array.from({ length: 320 }, (_, i) => `id${i}`);
    const r = await traerPorIds(ids, async (lote, d, h) => { lotes.push(lote.length); return { data: lote.slice(d, h + 1), error: null }; });
    expect(r).toHaveLength(320);
    expect(lotes).toEqual([150, 150, 20]);
  });

  test("patchTenantSettings sin la RPC fusiona con lo leído, sin pisar lo demás", async () => {
    const r = await patchTenantSettings("t1", { timezone: "America/Bogota", sobra: undefined });
    expect(r).toEqual({ timezone: "America/Bogota", schedule: { a: 1 } });
    expect(mockEstado.actualizado).toEqual({ settings: { timezone: "America/Bogota", schedule: { a: 1 } } });
  });

  test("patchTenantSettings usa la RPC cuando existe y propaga sus errores", async () => {
    mockEstado.rpc = { data: { timezone: "X", schedule: { a: 1 } }, error: null };
    await expect(patchTenantSettings("t1", { timezone: "X" })).resolves.toEqual({ timezone: "X", schedule: { a: 1 } });
    mockEstado.rpc = { data: null, error: { code: "42501", message: "permission denied" } };
    await expect(patchTenantSettings("t1", { timezone: "X" })).rejects.toThrow("No tienes permiso");
  });

  test("nuevoId genera uuid v4 sin crypto.randomUUID", () => {
    const vistos = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const id = nuevoId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      vistos.add(id);
    }
    expect(vistos.size).toBe(2000);
  });
});
