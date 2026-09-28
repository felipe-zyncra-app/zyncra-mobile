import {
  ErrorDB, mensajeError, esErrorDeRed, esFuncionInexistente, revisar, exigirFilas, conTimeout,
  traerTodo, traerTodoDetalle, traerPorIds, patchTenantSettings, nuevoId, FILAS_POR_BLOQUE,
} from "@/lib/db";
import { supabase } from "@/lib/supabase";

// Cliente Supabase simulado que registra cada llamada: sirve para probar la
// paginación (D11) y patchTenantSettings (D7) por los dos caminos (con la RPC
// de la migración y sin ella), sin tocar la red.

type Res = { data: unknown; error: unknown };
type Llamada = {
  tipo: "rpc" | "select" | "update";
  fn?: string;
  args?: unknown;
  tabla?: string;
  columnas?: string;
  filtros: [string, unknown][];
  orden: string[];
  rango?: [number, number];
  payload?: unknown;
  selectDespues?: string;
};

const FUNCION_INEXISTENTE = { code: "PGRST202", message: "Could not find the function public.patch_tenant_settings(p_patch, p_tenant_id) in the schema cache" };
const RED = { message: "TypeError: Network request failed", code: "" };

const mockSb: { llamadas: Llamada[]; rpc: Res; lectura: Res; escritura: Res; filas: unknown[]; fallaRango?: [number, Res] } = {
  llamadas: [], rpc: { data: null, error: null }, lectura: { data: null, error: null }, escritura: { data: null, error: null }, filas: [],
};

jest.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: async (fn: string, args: unknown) => {
      mockSb.llamadas.push({ tipo: "rpc", fn, args, filtros: [], orden: [] });
      return mockSb.rpc;
    },
    from: (tabla: string) => {
      const st: Llamada = { tipo: "select", tabla, filtros: [], orden: [] };
      const resolver = (): Res => {
        mockSb.llamadas.push(st);
        if (st.tipo === "update") return mockSb.escritura;
        if (st.rango) {
          const [d, h] = st.rango;
          if (mockSb.fallaRango && mockSb.fallaRango[0] === d) return mockSb.fallaRango[1];
          return { data: mockSb.filas.slice(d, h + 1), error: null };
        }
        return mockSb.lectura;
      };
      const q: any = {
        select: (c: string) => { if (st.tipo === "select") st.columnas = c; else st.selectDespues = c; return q; },
        eq: (c: string, v: unknown) => { st.filtros.push([c, v]); return q; },
        order: (c: string) => { st.orden.push(c); return q; },
        range: (d: number, h: number) => { st.rango = [d, h]; return q; },
        update: (v: unknown) => { st.tipo = "update"; st.payload = v; return q; },
        single: async () => resolver(),
        then: (ok: (v: Res) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve().then(resolver).then(ok, ko),
      };
      return q;
    },
  },
}));


const AJUSTES_WEB = {
  timezone: "America/Bogota",
  schedule: { mon: { open: "09:00", close: "18:00" }, sat: { open: "09:00", close: "13:00" } },
  logo_url: "https://cdn.zyncra.app/logo.png",
  colors: { primary: "#6D28D9" },
  currency: "COP",
};

beforeEach(() => {
  mockSb.llamadas = [];
  mockSb.rpc = { data: null, error: FUNCION_INEXISTENTE };
  mockSb.lectura = { data: { settings: { ...AJUSTES_WEB } }, error: null };
  mockSb.escritura = { data: [{ id: "t1" }], error: null };
  mockSb.filas = [];
  mockSb.fallaRango = undefined;
});

const deTipo = (t: Llamada["tipo"]) => mockSb.llamadas.filter(l => l.tipo === t);

// ─── Paginación ──────────────────────────────────────────────────────────────

/** Consulta como la de la documentación: .order(col).order("id").range(d, h). */
const consultaClientes = (d: number, h: number) =>
  supabase.from("clients").select("id,name").eq("tenant_id", "t1").order("name").order("id").range(d, h) as unknown as PromiseLike<{ data: { id: number }[] | null; error: unknown }>;

const filas = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i }));
const rangos = () => mockSb.llamadas.filter(l => l.rango).map(l => l.rango);

describe("traerTodo / traerTodoDetalle", () => {
  test("el servidor corta en 1000: se piden bloques con .range() hasta uno incompleto", async () => {
    expect(FILAS_POR_BLOQUE).toBe(1000);
    mockSb.filas = filas(2500);
    const r = await traerTodo(consultaClientes);
    expect(r).toHaveLength(2500);
    expect(r.map(x => x.id)).toEqual(filas(2500).map(x => x.id));   // en orden y sin repetir
    expect(rangos()).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    // Usa la consulta tal cual: filtro, orden estable y único.
    expect(mockSb.llamadas[0]).toMatchObject({ tabla: "clients", filtros: [["tenant_id", "t1"]], orden: ["name", "id"] });
  });

  test.each([
    [0, [[0, 999]]],
    [999, [[0, 999]]],
    [1000, [[0, 999], [1000, 1999]]],
    [1001, [[0, 999], [1000, 1999]]],
    [2000, [[0, 999], [1000, 1999], [2000, 2999]]],
  ])("%i filas → rangos %j", async (n, esperados) => {
    mockSb.filas = filas(n as number);
    const r = await traerTodoDetalle(consultaClientes);
    expect(r).toEqual({ filas: filas(n as number), truncado: false });
    expect(rangos()).toEqual(esperados);
  });

  test("bloque propio, nunca mayor que 1000 ni menor que 1", async () => {
    mockSb.filas = filas(600);
    await traerTodo(consultaClientes, { bloque: 250 });
    expect(rangos()).toEqual([[0, 249], [250, 499], [500, 749]]);

    mockSb.llamadas = [];
    await traerTodo(consultaClientes, { bloque: 5000 });
    expect(rangos()).toEqual([[0, 999]]);

    mockSb.llamadas = [];
    mockSb.filas = filas(2);
    await traerTodo(consultaClientes, { bloque: 0 });
    expect(rangos()).toEqual([[0, 0], [1, 1], [2, 2]]);
  });

  test("tope: corta y avisa que quedó truncado", async () => {
    mockSb.filas = filas(2500);
    const r = await traerTodoDetalle(consultaClientes, { tope: 1500 });
    expect(r.filas).toHaveLength(1500);
    expect(r.truncado).toBe(true);
    expect(rangos()).toEqual([[0, 999], [1000, 1499], [1500, 1500]]);
  });

  test("exactamente `tope` filas no es truncado (antes decía que sí)", async () => {
    mockSb.filas = filas(1500);
    const r = await traerTodoDetalle(consultaClientes, { tope: 1500 });
    expect([r.filas.length, r.truncado]).toEqual([1500, false]);
    mockSb.llamadas = [];
    mockSb.filas = filas(1000);
    const s = await traerTodoDetalle(consultaClientes, { tope: 1000 });
    expect([s.filas.length, s.truncado]).toEqual([1000, false]);
    expect(rangos()).toEqual([[0, 999], [1000, 1000]]);
  });

  test("traerTodo con `tope` como límite no hace la petición extra (y no falla por ella)", async () => {
    mockSb.filas = filas(1500);
    mockSb.fallaRango = [1000, { data: null, error: RED }];   // la fila de sondeo daría error
    const r = await traerTodo(consultaClientes, { tope: 1000 });
    expect(r).toHaveLength(1000);
    expect(rangos()).toEqual([[0, 999]]);
  });

  test("tope por defecto: 20.000 filas", async () => {
    mockSb.filas = filas(20_050);
    const r = await traerTodoDetalle(consultaClientes);
    expect([r.filas.length, r.truncado]).toEqual([20_000, true]);
  });

  test("si falla un bloque del medio, lanza ErrorDB con el contexto y no devuelve una lista a medias", async () => {
    mockSb.filas = filas(2500);
    mockSb.fallaRango = [1000, { data: null, error: RED }];
    const p = traerTodo(consultaClientes, { contexto: "No se pudieron cargar los clientes" });
    await expect(p).rejects.toBeInstanceOf(ErrorDB);
    await expect(p).rejects.toMatchObject({
      message: "No se pudieron cargar los clientes. Revisa tu conexión a internet e inténtalo de nuevo.",
      deRed: true,
    });
    expect(rangos()).toEqual([[0, 999], [1000, 1999]]);   // no siguió pidiendo
  });

  test("error de base en un bloque: conserva el código", async () => {
    mockSb.filas = filas(10);
    mockSb.fallaRango = [0, { data: null, error: { code: "42501", message: "permission denied for table clients" } }];
    await expect(traerTodo(consultaClientes)).rejects.toMatchObject({ code: "42501", deRed: false, message: "No tienes permiso para hacer esto." });
  });

  test("si la consulta se rechaza (timeout, fetch) también sale ErrorDB con el contexto", async () => {
    const p = traerTodo(async () => { throw Object.assign(new Error("La consulta tardó demasiado (timeout)."), { name: "TimeoutError" }); },
      { contexto: "No se pudo cargar la agenda" });
    await expect(p).rejects.toBeInstanceOf(ErrorDB);
    await expect(p).rejects.toThrow("No se pudo cargar la agenda. El servidor tardó demasiado en responder. Inténtalo de nuevo.");
  });

  test("data null sin error cuenta como bloque vacío", async () => {
    await expect(traerTodo(async () => ({ data: null, error: null }))).resolves.toEqual([]);
  });
});

describe("traerPorIds", () => {
  test("lista vacía: no consulta", async () => {
    const consulta = jest.fn();
    await expect(traerPorIds([], consulta)).resolves.toEqual([]);
    expect(consulta).not.toHaveBeenCalled();
  });

  test("quita repetidos y vacíos antes de partir en lotes", async () => {
    const lotes: string[][] = [];
    await traerPorIds(["a", "a", "", "b", null as unknown as string, "b", "c"], async (lote) => {
      lotes.push(lote);
      return { data: [], error: null };
    });
    expect(lotes).toEqual([["a", "b", "c"]]);
  });

  test("lotes del tamaño pedido (150 por defecto)", async () => {
    const tamanos: number[] = [];
    const ids = Array.from({ length: 401 }, (_, i) => `id${i}`);
    const r = await traerPorIds(ids, async (lote, d, h) => { tamanos.push(lote.length); return { data: lote.slice(d, h + 1), error: null }; });
    expect(r).toEqual(ids);
    expect(tamanos).toEqual([150, 150, 101]);
    tamanos.length = 0;
    await traerPorIds(ids, async (lote) => { tamanos.push(lote.length); return { data: [], error: null }; }, { tamanoLote: 200 });
    expect(tamanos).toEqual([200, 200, 1]);
  });

  test("cada lote también se pagina (un lote puede traer más de 1000 filas)", async () => {
    const pedidos: [number, number][] = [];
    const r = await traerPorIds(["v1", "v2"], async (_lote, d, h) => {
      pedidos.push([d, h]);
      return { data: filas(1200).slice(d, h + 1), error: null };
    });
    expect(r).toHaveLength(1200);
    expect(pedidos).toEqual([[0, 999], [1000, 1999]]);
  });

  test("si falla un lote, lanza y no pide los siguientes", async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `id${i}`);
    let n = 0;
    const p = traerPorIds(ids, async () => (++n === 2 ? { data: null, error: RED } : { data: [], error: null }),
      { contexto: "No se pudieron cargar los ítems" });
    await expect(p).rejects.toThrow("No se pudieron cargar los ítems. Revisa tu conexión");
    expect(n).toBe(2);
  });
});

// ─── patchTenantSettings ─────────────────────────────────────────────────────

describe("patchTenantSettings con la RPC de la migración", () => {
  test("manda solo el cambio y el negocio activo (sin p_tenant_id escribiría en el más antiguo del dueño)", async () => {
    mockSb.rpc = { data: { ...AJUSTES_WEB, timezone: "Europe/Madrid" }, error: null };
    const r = await patchTenantSettings("t1", { timezone: "Europe/Madrid" });
    expect(deTipo("rpc")).toEqual([expect.objectContaining({ fn: "patch_tenant_settings", args: { p_patch: { timezone: "Europe/Madrid" }, p_tenant_id: "t1" } })]);
    expect(deTipo("select")).toHaveLength(0);
    expect(deTipo("update")).toHaveLength(0);
    expect(r).toEqual({ ...AJUSTES_WEB, timezone: "Europe/Madrid" });
  });

  test("devuelve el settings completo tal cual, aunque tenga una clave llamada 'settings'", async () => {
    const devuelto = { ...AJUSTES_WEB, settings: { notas: "clave del negocio" } };
    mockSb.rpc = { data: devuelto, error: null };
    await expect(patchTenantSettings("t1", { currency: "COP" })).resolves.toEqual(devuelto);
  });

  test("acepta la respuesta envuelta en un arreglo; sin datos devuelve el cambio", async () => {
    mockSb.rpc = { data: [{ a: 1 }], error: null };
    await expect(patchTenantSettings("t1", { a: 1 })).resolves.toEqual({ a: 1 });
    mockSb.rpc = { data: null, error: null };
    await expect(patchTenantSettings("t1", { b: 2 })).resolves.toEqual({ b: 2 });
  });

  test("un error que no es 'función inexistente' se propaga y NO cae al respaldo", async () => {
    mockSb.rpc = { data: null, error: { code: "42501", message: "Solo el dueño del negocio puede cambiar estos ajustes." } };
    await expect(patchTenantSettings("t1", { timezone: "X" }))
      .rejects.toThrow("No se pudieron guardar los ajustes. Solo el dueño del negocio puede cambiar estos ajustes.");
    mockSb.rpc = { data: null, error: RED };
    await expect(patchTenantSettings("t1", { timezone: "X" })).rejects.toThrow("Revisa tu conexión");
    expect(deTipo("select")).toHaveLength(0);
    expect(deTipo("update")).toHaveLength(0);
  });

  test("null viaja como null (Postgres || deja la clave en null)", async () => {
    mockSb.rpc = { data: { logo_url: null }, error: null };
    await patchTenantSettings("t1", { logo_url: null, sobra: undefined });
    expect(deTipo("rpc")[0].args).toEqual({ p_patch: { logo_url: null }, p_tenant_id: "t1" });
  });
});

describe("patchTenantSettings sin la RPC (migración sin aplicar)", () => {
  test.each([
    ["PGRST202", FUNCION_INEXISTENTE],
    ["42883", { code: "42883", message: "function public.patch_tenant_settings(jsonb, uuid) does not exist" }],
    ["404", { status: 404, message: "Could not find the function" }],
  ])("%s → lee fresco, fusiona y escribe sin pisar lo del web", async (_n, error) => {
    mockSb.rpc = { data: null, error };
    const r = await patchTenantSettings("t1", { timezone: "Europe/Madrid", tema: "oscuro" });
    const esperado = { ...AJUSTES_WEB, timezone: "Europe/Madrid", tema: "oscuro" };
    expect(r).toEqual(esperado);
    const [lectura] = deTipo("select");
    expect(lectura).toMatchObject({ tabla: "tenants", columnas: "settings", filtros: [["id", "t1"]] });
    const [escritura] = deTipo("update");
    expect(escritura).toMatchObject({ tabla: "tenants", payload: { settings: esperado }, filtros: [["id", "t1"]], selectDespues: "id" });
  });

  test("fusión de primer nivel: schedule se reemplaza entero, igual que con la RPC", async () => {
    const r = await patchTenantSettings("t1", { schedule: { mon: { open: "10:00", close: "19:00" } } });
    expect(r.schedule).toEqual({ mon: { open: "10:00", close: "19:00" } });
    expect(r.logo_url).toBe(AJUSTES_WEB.logo_url);
  });

  test("null deja la clave en null, igual que la RPC", async () => {
    const r = await patchTenantSettings("t1", { logo_url: null });
    expect(r).toEqual({ ...AJUSTES_WEB, logo_url: null });
  });

  test("settings vacío, nulo o con forma rara en la base: parte de {}", async () => {
    for (const settings of [null, [], "texto", 42]) {
      mockSb.llamadas = [];
      mockSb.lectura = { data: { settings }, error: null };
      await expect(patchTenantSettings("t1", { a: 1 })).resolves.toEqual({ a: 1 });
    }
  });

  test("si la lectura falla, NO escribe (antes borraba horario, logo y colores)", async () => {
    mockSb.lectura = { data: null, error: RED };
    await expect(patchTenantSettings("t1", { timezone: "X" }))
      .rejects.toThrow("No se pudieron leer los ajustes actuales, así que no se guardó nada. Revisa tu conexión");
    expect(deTipo("update")).toHaveLength(0);

    mockSb.lectura = { data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" } };
    await expect(patchTenantSettings("t1", { timezone: "X" })).rejects.toThrow("No se encontró el registro.");
    expect(deTipo("update")).toHaveLength(0);
  });

  test("un update que no toca ninguna fila (RLS) no se reporta como guardado", async () => {
    mockSb.escritura = { data: [], error: null };
    await expect(patchTenantSettings("t1", { timezone: "X" }))
      .rejects.toThrow("No se pudieron guardar los ajustes. No se guardó ningún cambio");
  });

  test("error al escribir: ErrorDB con el mensaje en español", async () => {
    mockSb.escritura = { data: null, error: { code: "23514", message: 'new row for relation "tenants" violates check constraint "x"' } };
    await expect(patchTenantSettings("t1", { timezone: "X" })).rejects.toThrow("No se pudieron guardar los ajustes. Algún valor no es válido.");
  });
});

describe("patchTenantSettings: entradas", () => {
  test("sin negocio activo: lanza sin consultar nada", async () => {
    await expect(patchTenantSettings("", { a: 1 })).rejects.toThrow("No se pudieron guardar los ajustes. No hay un negocio activo.");
    expect(mockSb.llamadas).toHaveLength(0);
  });

  test("cambio vacío o solo con undefined: no consulta nada", async () => {
    await expect(patchTenantSettings("t1", {})).resolves.toEqual({});
    await expect(patchTenantSettings("t1", { a: undefined })).resolves.toEqual({});
    expect(mockSb.llamadas).toHaveLength(0);
  });
});

// ─── Errores ─────────────────────────────────────────────────────────────────

describe("mensajeError", () => {
  test.each([
    [{ code: "23505", message: "duplicate key value violates unique constraint" }, "Ya existe un registro con esos datos."],
    [{ code: "23503", message: "update or delete on table violates foreign key constraint" }, "No se puede completar porque hay otros registros que dependen de este."],
    [{ code: "23502", message: "null value in column" }, "Falta un dato obligatorio."],
    [{ code: "22P02", message: "invalid input syntax for type uuid" }, "Hay un dato con un formato inválido."],
    [{ code: "22001", message: "value too long for type character varying(50)" }, "Uno de los textos es demasiado largo."],
    [{ code: "42501", message: "permission denied for table tenants" }, "No tienes permiso para hacer esto."],
    [{ code: "42501", message: 'new row violates row-level security policy for table "clients"' }, "No tienes permiso para hacer esto."],
    [{ code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" }, "No se encontró el registro."],
    [{ code: "PGRST204", message: "Could not find the 'x' column" }, "La app está desactualizada respecto al servidor. Actualízala e inténtalo de nuevo."],
    [{ code: "PGRST202", message: "Could not find the function" }, "Esta función aún no está disponible en el servidor."],
    [{ code: "PGRST303", message: "JWT expired" }, "Tu sesión expiró. Cierra sesión y vuelve a entrar."],
    [{ message: "JWT expired" }, "Tu sesión expiró. Cierra sesión y vuelve a entrar."],
    [{ code: "57014", message: "canceling statement due to statement timeout" }, "El servidor tardó demasiado en responder. Inténtalo de nuevo."],
    [{ code: "XX000", message: "internal error" }, "Ocurrió un error inesperado (código XX000). Inténtalo de nuevo."],
    [new TypeError("Network request failed"), "Revisa tu conexión a internet e inténtalo de nuevo."],
    [Object.assign(new Error("Aborted"), { name: "AbortError" }), "Revisa tu conexión a internet e inténtalo de nuevo."],
    ["Network request failed", "Revisa tu conexión a internet e inténtalo de nuevo."],
    [null, "Ocurrió un error inesperado. Inténtalo de nuevo."],
    [undefined, "Ocurrió un error inesperado. Inténtalo de nuevo."],
  ])("%p → %s", (err, esperado) => {
    expect(mensajeError(err)).toBe(esperado);
  });

  test("los RAISE en español de la migración pasan tal cual, con P0001, 42501, 23514 o 22023", () => {
    for (const [code, message] of [
      ["P0001", "No se puede eliminar el servicio \"Corte\" porque tiene 3 cita(s) registradas. Archívalo: deja de aparecer en la agenda y en la reserva, y el historial se conserva."],
      ["P0001", "Esta cita ya tiene un cobro registrado. Si necesitas cobrarla de nuevo, anula primero el cobro anterior desde el historial."],
      ["42501", "Solo el dueño del negocio puede cambiar estos ajustes."],
      ["42501", "Inicia sesión."],
      ["23514", "El teléfono del negocio no puede quedar vacío. Es la forma de contactarlo."],
      ["23514", "El pedido mínimo de \"Tinte\" es de 6 unidades."],
      ["22023", "Los ajustes deben enviarse como un objeto."],
    ]) {
      expect(mensajeError({ code, message })).toBe(message);
    }
  });

  test("contexto: se antepone y se limpia el punto final", () => {
    expect(mensajeError({ code: "23505", message: "dup" }, "No se pudo guardar el cliente.  "))
      .toBe("No se pudo guardar el cliente. Ya existe un registro con esos datos.");
    expect(mensajeError({ code: "P0001", message: "Esta cita ya tiene un cobro registrado." }, "No se pudo cobrar"))
      .toBe("No se pudo cobrar. Esta cita ya tiene un cobro registrado.");
  });

  test("un ErrorDB ya trae su contexto: otro contexto lo reemplaza, no se duplica", () => {
    const e = new ErrorDB({ code: "23505", message: "dup" }, "No se pudo guardar el cliente");
    expect(e.message).toBe("No se pudo guardar el cliente. Ya existe un registro con esos datos.");
    expect(e.razon).toBe("Ya existe un registro con esos datos.");
    expect(mensajeError(e)).toBe("No se pudo guardar el cliente. Ya existe un registro con esos datos.");
    expect(mensajeError(e, "No se pudo guardar el cliente")).toBe("No se pudo guardar el cliente. Ya existe un registro con esos datos.");
    expect(mensajeError(e, "No se pudo importar")).toBe("No se pudo importar. Ya existe un registro con esos datos.");
  });
});

describe("ErrorDB y ayudantes de errores", () => {
  test("ErrorDB conserva código, origen de red y el error original", () => {
    const original = { code: "23505", message: "dup" };
    const e = new ErrorDB(original);
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(ErrorDB);
    expect([e.name, e.code, e.deRed, e.original]).toEqual(["ErrorDB", "23505", false, original]);
    const r = new ErrorDB(RED, "No se pudo cargar");
    expect([r.code, r.deRed]).toEqual(["", true]);
    expect(esErrorDeRed(r)).toBe(true);
  });

  test("esErrorDeRed", () => {
    expect(esErrorDeRed(RED)).toBe(true);
    expect(esErrorDeRed({ message: "Failed to fetch" })).toBe(true);
    expect(esErrorDeRed({ name: "TimeoutError", message: "x" })).toBe(true);
    expect(esErrorDeRed("Network request failed")).toBe(true);
    expect(esErrorDeRed({ code: "57014", message: "canceling statement due to statement timeout" })).toBe(false);
    expect(esErrorDeRed({ code: "PGRST116", message: "network" })).toBe(false);
    expect(esErrorDeRed({ code: "23505", message: "duplicate key" })).toBe(false);
    expect(esErrorDeRed(null)).toBe(false);
  });

  test("esFuncionInexistente: solo cuando la RPC no existe", () => {
    expect(esFuncionInexistente(FUNCION_INEXISTENTE)).toBe(true);
    expect(esFuncionInexistente({ code: "42883", message: "function does not exist" })).toBe(true);
    expect(esFuncionInexistente({ status: 404, message: "Could not find the function" })).toBe(true);
    expect(esFuncionInexistente({ status: 404, message: "Not Found" })).toBe(false);
    expect(esFuncionInexistente({ code: "42501", message: "permission denied" })).toBe(false);
    expect(esFuncionInexistente(RED)).toBe(false);
    expect(esFuncionInexistente(null)).toBe(false);
  });

  test("revisar devuelve data o lanza ErrorDB", () => {
    expect(revisar({ data: [1, 2], error: null })).toEqual([1, 2]);
    expect(revisar({ data: null, error: null })).toBeNull();
    expect(() => revisar({ data: null, error: { code: "23505", message: "dup" } }, "No se pudo guardar"))
      .toThrow(new ErrorDB({ code: "23505" }, "No se pudo guardar").message);
  });

  test("exigirFilas: error, cero filas (RLS) o filas", () => {
    expect(exigirFilas({ data: [{ id: 1 }], error: null })).toEqual([{ id: 1 }]);
    expect(() => exigirFilas({ data: null, error: null })).toThrow("No se guardó ningún cambio");
    expect(() => exigirFilas({ data: [], error: null }, "No se pudo cambiar el estado")).toThrow("No se pudo cambiar el estado. No se guardó ningún cambio");
    try {
      exigirFilas({ data: [], error: null });
    } catch (e) {
      expect((e as ErrorDB).code).toBe("SIN_FILAS");
    }
    expect(() => exigirFilas({ data: null, error: RED })).toThrow("Revisa tu conexión");
  });

  test("conTimeout: resuelve a tiempo, o rechaza con TimeoutError sin cancelar", async () => {
    jest.useFakeTimers();
    try {
      await expect(conTimeout(Promise.resolve(7), 1000)).resolves.toBe(7);
      expect(jest.getTimerCount()).toBe(0);   // limpió su temporizador

      const lenta = new Promise(() => {});
      const p = conTimeout(lenta, 1000, "La consulta tardó demasiado.");
      jest.advanceTimersByTime(1000);
      await expect(p).rejects.toMatchObject({ name: "TimeoutError", message: "La consulta tardó demasiado." });

      await expect(conTimeout(Promise.reject(new Error("otra cosa")), 1000)).rejects.toThrow("otra cosa");
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  test("mensaje de un timeout", () => {
    const e = Object.assign(new Error("La operación tardó demasiado (timeout)."), { name: "TimeoutError" });
    expect(mensajeError(e, "No se pudo guardar")).toBe("No se pudo guardar. El servidor tardó demasiado en responder. Inténtalo de nuevo.");
  });
});

describe("nuevoId", () => {
  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  function sinCrypto(valor: unknown, fn: () => void) {
    const desc = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    Object.defineProperty(globalThis, "crypto", { value: valor, configurable: true, writable: true });
    try {
      fn();
    } finally {
      if (desc) Object.defineProperty(globalThis, "crypto", desc);
      else delete (globalThis as { crypto?: unknown }).crypto;
    }
  }

  test("con crypto.getRandomValues", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => nuevoId()));
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(id).toMatch(UUID_V4);
  });

  test("sin crypto (Hermes sin polyfill): Math.random, sigue siendo uuid v4 y único", () => {
    sinCrypto(undefined, () => {
      const ids = new Set(Array.from({ length: 1000 }, () => nuevoId()));
      expect(ids.size).toBe(1000);
      for (const id of ids) expect(id).toMatch(UUID_V4);
    });
  });

  test("si getRandomValues lanza, cae a Math.random sin romper", () => {
    sinCrypto({ getRandomValues: () => { throw new Error("no disponible"); } }, () => {
      expect(nuevoId()).toMatch(UUID_V4);
    });
  });
});
