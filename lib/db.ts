import { supabase } from "./supabase";

/**
 * Utilidades comunes para hablar con Supabase sin tragarse los errores.
 *
 * supabase-js NO lanza: devuelve { data: null, error } y la app lo ignoraba en
 * ~150 sitios, así que un corte de red se veía como "Sin clientes aún", $0 o
 * "Guardado". Aquí está lo mínimo para hacerlo bien:
 *   · revisar()         → lanza ErrorDB si hubo error (con mensaje en español)
 *   · exigirFilas()     → además detecta un update/delete que no tocó nada (RLS)
 *   · mensajeError()    → texto para Alert/ErrorState a partir de cualquier error
 *   · traerTodo()       → pagina por bloques de 1000 (el tope del servidor)
 *   · traerPorIds()     → .in() por lotes, para listas largas de ids
 *   · patchTenantSettings() → escribe tenants.settings sin pisar lo demás
 *   · nuevoId()         → uuid v4 generado en el teléfono (idempotencia)
 */

// ─── Errores ─────────────────────────────────────────────────────────────────

type ErrorCrudo = { message?: string; code?: string; details?: string | null; hint?: string | null; status?: number; name?: string };

/** Error de base con mensaje en español listo para mostrar (`message`). */
export class ErrorDB extends Error {
  /** Código de Postgres/PostgREST ("23505", "PGRST116"…) o "" si fue de red. */
  code: string;
  /** true si fue un problema de conexión (reintentable). */
  deRed: boolean;
  /** Error original, para depurar. */
  original: unknown;
  /** El motivo sin el contexto ("Ya existe un registro con esos datos."). */
  razon: string;

  constructor(original: unknown, contexto?: string) {
    const razon = razonError(original);
    super(unirContexto(contexto, razon));
    this.razon = razon;
    this.name = "ErrorDB";
    const e = (original ?? {}) as ErrorCrudo;
    this.code = typeof e.code === "string" ? e.code : "";
    this.deRed = esErrorDeRed(original);
    this.original = original;
  }
}

const PATRON_RED = /network request failed|failed to fetch|network ?error|fetch failed|load failed|internet connection|offline|ECONN|ETIMEDOUT|socket|aborted|abort/i;
const PATRON_TIEMPO = /timeout|timed out|tardó demasiado|TimeoutError/i;

/** true si el error viene de la conexión y no de la base (vale la pena reintentar). */
export function esErrorDeRed(err: unknown): boolean {
  if (!err) return false;
  if (typeof err === "string") return PATRON_RED.test(err) || PATRON_TIEMPO.test(err);
  const e = err as ErrorCrudo;
  if (e instanceof ErrorDB) return e.deRed;
  // PostgREST devuelve code "" (o sin code) cuando el fetch ni siquiera llegó.
  if (e.code && /^[0-9A-Z]{5}$|^PGRST/.test(e.code)) return false;
  const texto = `${e.name ?? ""} ${e.message ?? ""} ${e.details ?? ""}`;
  return PATRON_RED.test(texto) || PATRON_TIEMPO.test(texto);
}

/**
 * true si la RPC no existe todavía (migración sin aplicar). Sirve para
 * degradar: el código del móvil tiene que funcionar antes y después de la
 * migración.
 */
export function esFuncionInexistente(err: unknown): boolean {
  if (!err) return false;
  const e = err as ErrorCrudo;
  if (e.code === "PGRST202" || e.code === "42883") return true;
  return e.status === 404 && /function|rpc/i.test(e.message ?? "");
}

/**
 * Mensaje en español para cualquier error de Supabase, fetch o JS.
 * Con `contexto` ("No se pudo guardar el servicio") se antepone:
 * "No se pudo guardar el servicio. Revisa tu conexión…".
 */
export function mensajeError(err: unknown, contexto?: string): string {
  // Un ErrorDB ya trae su contexto: si llega otro, lo reemplaza en vez de
  // quedar "No se pudo guardar. No se pudo guardar. Ya existe…".
  if (err instanceof ErrorDB && !contexto) return err.message;
  return unirContexto(contexto, razonError(err));
}

function unirContexto(contexto: string | undefined, razon: string): string {
  return contexto ? `${contexto.replace(/[.\s]+$/, "")}. ${razon}` : razon;
}

/**
 * Postgres escribe sus mensajes en inglés, en minúscula y sin punto final.
 * Los RAISE EXCEPTION de nuestras migraciones vienen en español y con
 * mayúscula, y no siempre con P0001: "Solo el dueño del negocio puede
 * cambiar estos ajustes." (42501), "El teléfono del negocio no puede quedar
 * vacío…" (23514). Esos se muestran tal cual en vez del texto genérico.
 */
function esMensajePropio(code: string, msg: string): boolean {
  if (!msg || !/^[0-9A-Z]{5}$/.test(code)) return false;   // solo SQLSTATE, no PGRST ni red
  if (/row-level security|permission denied|violates|duplicate key|null value|invalid input|must be owner/i.test(msg)) return false;
  return /^[¿¡"«]?[A-ZÁÉÍÓÚÑ]/.test(msg);
}

function razonError(err: unknown): string {
  if (!err) return "Ocurrió un error inesperado. Inténtalo de nuevo.";
  if (err instanceof ErrorDB) return err.razon;
  const e = err as ErrorCrudo;
  const code = typeof e.code === "string" ? e.code : "";
  const msg = typeof e.message === "string" ? e.message : typeof err === "string" ? err : "";

  if (PATRON_TIEMPO.test(`${e.name ?? ""} ${msg}`)) return "El servidor tardó demasiado en responder. Inténtalo de nuevo.";
  if (esErrorDeRed(err)) return "Revisa tu conexión a internet e inténtalo de nuevo.";
  if (esMensajePropio(code, msg)) return msg;

  switch (code) {
    // RAISE EXCEPTION de nuestros triggers y funciones: ya viene en español.
    case "P0001": return msg || "La operación no está permitida.";
    case "42501":
    case "PGRST301": return "No tienes permiso para hacer esto.";
    case "PGRST303":
    case "PGRST302": return "Tu sesión expiró. Cierra sesión y vuelve a entrar.";
    case "23505": return "Ya existe un registro con esos datos.";
    case "23503": return "No se puede completar porque hay otros registros que dependen de este.";
    case "23502": return "Falta un dato obligatorio.";
    case "23514": return "Algún valor no es válido.";
    case "22P02":
    case "22007":
    case "22008": return "Hay un dato con un formato inválido.";
    case "22001": return "Uno de los textos es demasiado largo.";
    case "PGRST116": return "No se encontró el registro.";
    case "PGRST204":
    case "42703": return "La app está desactualizada respecto al servidor. Actualízala e inténtalo de nuevo.";
    case "PGRST202":
    case "42883": return "Esta función aún no está disponible en el servidor.";
    case "SIN_FILAS": return msg || "No se guardó ningún cambio: puede que no tengas permiso o que el registro ya no exista.";
  }
  if (/row-level security|permission denied/i.test(msg)) return "No tienes permiso para hacer esto.";
  if (/JWT expired|invalid JWT|No active session/i.test(msg)) return "Tu sesión expiró. Cierra sesión y vuelve a entrar.";
  return code
    ? `Ocurrió un error inesperado (código ${code}). Inténtalo de nuevo.`
    : "Ocurrió un error inesperado. Inténtalo de nuevo.";
}

/**
 * Texto de error que devuelve un endpoint propio (edge function o API del
 * portal) en `body.error`. Unos vienen en español (los RAISE de nuestros
 * triggers: "Una entrada clínica firmada no puede eliminarse") y otros en
 * inglés o técnicos ("User not found", "duplicate key…"). Solo se muestra
 * tal cual lo que parece español; lo demás cae al respaldo.
 */
export function textoParaUsuario(texto: unknown, respaldo: string): string {
  if (typeof texto !== "string" || !texto.trim()) return respaldo;
  const t = texto.trim();
  const ingles = /\b(the|not found|failed|unauthori[sz]ed|invalid|violates|duplicate key|permission denied|internal server)\b/i;
  const espanol = /[áéíóúñ¿¡]|\b(no|la|el|de|los|las|una?|puede|cuenta|negocio|sesi[oó]n)\b/i;
  return espanol.test(t) && !ingles.test(t) ? t : respaldo;
}

type Respuesta<T> = { data: T; error: unknown };

/**
 * Devuelve `data` o lanza ErrorDB.
 *   const clientes = revisar(await supabase.from("clients").select("id,name").eq(...), "No se pudieron cargar los clientes");
 */
export function revisar<T>(res: Respuesta<T>, contexto?: string): T {
  if (res.error) throw new ErrorDB(res.error, contexto);
  return res.data;
}

/**
 * Para update/delete con `.select("id")`: lanza si hubo error o si no se tocó
 * ninguna fila. Con RLS un update prohibido "funciona" sin error y afecta 0
 * filas; sin esto la UI dice "Guardado" y no guardó nada.
 *   exigirFilas(await supabase.from("appointments").update({ status }).eq("id", id).select("id"), "No se pudo cambiar el estado");
 */
export function exigirFilas<T>(res: Respuesta<T[] | null>, contexto?: string): T[] {
  if (res.error) throw new ErrorDB(res.error, contexto);
  const filas = res.data ?? [];
  if (filas.length === 0) throw new ErrorDB({ code: "SIN_FILAS", message: "" }, contexto);
  return filas;
}

/** Rechaza con un error de tiempo si la promesa no termina en `ms`. No cancela la operación. */
export function conTimeout<T>(p: PromiseLike<T>, ms: number, mensaje = "La operación tardó demasiado (timeout)."): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      const e = new Error(mensaje);
      e.name = "TimeoutError";
      reject(e);
    }, ms);
    Promise.resolve(p).then(
      v => { clearTimeout(t); resolve(v); },
      e => { clearTimeout(t); reject(e); },
    );
  });
}

// ─── Paginación ──────────────────────────────────────────────────────────────
// PostgREST corta cada respuesta en 1000 filas (max-rows) aunque se pida
// .limit(2000): el resto se pierde sin aviso. traerTodo pide bloques con
// .range() hasta que llega uno incompleto.
//
// OJO: la consulta tiene que tener un orden estable y único, o las páginas se
// pisan (filas repetidas o perdidas). Ordena por una columna y desempata por id:
//   .order("created_at", { ascending: false }).order("id")

export const FILAS_POR_BLOQUE = 1000;
export const TOPE_POR_DEFECTO = 20_000;

export type OpcionesPaginacion = {
  /** Filas por petición (máx. 1000, que es lo que deja el servidor). */
  bloque?: number;
  /** Máximo total a traer. Default 20.000: evita colgar el teléfono con un negocio enorme. */
  tope?: number;
  /** Texto para el error ("No se pudieron cargar los clientes"). */
  contexto?: string;
};

type Consulta<T> = (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: unknown }>;

/** Un bloque. Si la promesa se rechaza (timeout, fetch) también sale ErrorDB con el contexto. */
async function pedirBloque<T>(consulta: Consulta<T>, desde: number, hasta: number, contexto?: string): Promise<T[]> {
  let res: { data: T[] | null; error: unknown };
  try {
    res = await consulta(desde, hasta);
  } catch (e) {
    throw e instanceof ErrorDB ? e : new ErrorDB(e, contexto);
  }
  if (res?.error) throw new ErrorDB(res.error, contexto);
  return res?.data ?? [];
}

/**
 * Pide bloques hasta uno incompleto o hasta `tope`. `sondear`: al llegar justo
 * al tope, pide una fila más para saber si de verdad quedó algo afuera.
 */
async function paginar<T>(
  consulta: Consulta<T>,
  opciones: OpcionesPaginacion,
  sondear: boolean,
): Promise<{ filas: T[]; truncado: boolean }> {
  const bloque = Math.max(1, Math.min(opciones.bloque ?? FILAS_POR_BLOQUE, FILAS_POR_BLOQUE));
  const tope = Math.max(1, opciones.tope ?? TOPE_POR_DEFECTO);
  const filas: T[] = [];
  let desde = 0;
  while (filas.length < tope) {
    const hasta = Math.min(desde + bloque, tope) - 1;
    const pagina = await pedirBloque(consulta, desde, hasta, opciones.contexto);
    filas.push(...pagina);
    if (pagina.length < hasta - desde + 1) return { filas, truncado: false };
    desde = hasta + 1;
  }
  if (!sondear) return { filas, truncado: true };
  // Justo en el tope: solo está truncado si queda al menos otra fila (con
  // exactamente `tope` filas antes decía truncado y no faltaba nada).
  const resto = await pedirBloque(consulta, filas.length, filas.length, opciones.contexto);
  return { filas, truncado: resto.length > 0 };
}

/** Como traerTodo, pero dice si se llegó al tope (hay más filas que no se trajeron). */
export async function traerTodoDetalle<T>(
  consulta: Consulta<T>,
  opciones: OpcionesPaginacion = {},
): Promise<{ filas: T[]; truncado: boolean }> {
  return paginar(consulta, opciones, true);
}

/**
 * Trae todas las filas por bloques de 1000 (hasta `tope`). Lanza ErrorDB si
 * falla cualquier bloque: nunca devuelve una lista a medias como si fuera completa.
 *
 *   const citas = await traerTodo<Cita>((desde, hasta) =>
 *     supabase.from("appointments")
 *       .select("id, appointment_date, status")
 *       .eq("tenant_id", tenantId)
 *       .gte("appointment_date", r.desde).lte("appointment_date", r.hasta)
 *       .order("appointment_date").order("id")
 *       .range(desde, hasta),
 *   { contexto: "No se pudieron cargar las citas" });
 */
export async function traerTodo<T>(consulta: Consulta<T>, opciones: OpcionesPaginacion = {}): Promise<T[]> {
  // Sin sondeo: truncado se descarta aquí, y con `tope` usado como límite
  // ("las últimas 1000") cada carga pagaría otra petición que, si falla,
  // tumbaría una lista que ya estaba completa.
  return (await paginar(consulta, opciones, false)).filas;
}

/**
 * `.in("col", ids)` con cientos de ids arma una URL enorme que el servidor
 * rechaza. Esto parte la lista en lotes y junta los resultados (cada lote
 * también se pagina por si devuelve más de 1000 filas).
 *
 *   const items = await traerPorIds<Item>(saleIds, (lote, desde, hasta) =>
 *     supabase.from("pos_sale_items").select("sale_id, price, quantity")
 *       .in("sale_id", lote).order("id").range(desde, hasta));
 */
export async function traerPorIds<T>(
  ids: readonly string[],
  consulta: (lote: string[], desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  opciones: OpcionesPaginacion & { tamanoLote?: number } = {},
): Promise<T[]> {
  const unicos = Array.from(new Set(ids.filter(Boolean)));
  const tamano = Math.max(1, opciones.tamanoLote ?? 150);
  const out: T[] = [];
  for (let i = 0; i < unicos.length; i += tamano) {
    const lote = unicos.slice(i, i + tamano);
    out.push(...await traerTodo<T>((desde, hasta) => consulta(lote, desde, hasta), opciones));
  }
  return out;
}

// ─── tenants.settings ────────────────────────────────────────────────────────

export type Ajustes = Record<string, unknown>;

/**
 * Escribe claves de tenants.settings SIN pisar las demás.
 *
 * Antes cada pantalla hacía `{ ...copiaVieja, clave }` y escribía el objeto
 * completo: si la lectura había fallado (o era de hace un rato), borraba el
 * horario, la zona horaria, el logo o los colores que había guardado el web.
 *
 * 1. Intenta la RPC patch_tenant_settings(p_patch jsonb), que hace
 *    `settings = settings || p_patch` en el servidor, atómico.
 * 2. Si la RPC no existe (migración sin aplicar): lee settings FRESCO
 *    revisando el error, fusiona y escribe revisando el error y que se haya
 *    tocado la fila. Si la lectura falla, NO escribe nada.
 *
 * La fusión es de primer nivel, igual que `||` de Postgres: si cambias una
 * clave anidada (p. ej. `schedule`), manda el objeto completo de esa clave.
 * Una clave en null queda en null (igual que `||`, en los dos caminos): para
 * quien lee con `settings.x ?? valorPorDefecto` equivale a borrarla.
 *
 * Devuelve los settings resultantes (si el servidor los informa) y lanza
 * ErrorDB con mensaje en español si algo falla.
 *
 *   await patchTenantSettings(tenantId, { timezone: "Europe/Madrid" });
 */
export async function patchTenantSettings(tenantId: string, patch: Ajustes): Promise<Ajustes> {
  if (!tenantId) throw new ErrorDB({ code: "SIN_FILAS", message: "No hay un negocio activo." }, "No se pudieron guardar los ajustes");
  const limpio: Ajustes = {};
  for (const [k, v] of Object.entries(patch ?? {})) if (v !== undefined) limpio[k] = v;
  if (Object.keys(limpio).length === 0) return {};

  // p_tenant_id: sin él la RPC escribe en el negocio MÁS ANTIGUO del dueño,
  // que no tiene por qué ser el activo en el teléfono.
  const rpc = await supabase.rpc("patch_tenant_settings", { p_patch: limpio, p_tenant_id: tenantId });
  if (!rpc.error) {
    // La RPC devuelve el settings resultante (jsonb) tal cual.
    const d = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
    return d && typeof d === "object" && !Array.isArray(d) ? (d as Ajustes) : limpio;
  }
  if (!esFuncionInexistente(rpc.error)) throw new ErrorDB(rpc.error, "No se pudieron guardar los ajustes");

  // Respaldo sin la RPC: leer fresco → fusionar → escribir.
  const leido = await supabase.from("tenants").select("settings").eq("id", tenantId).single();
  if (leido.error) throw new ErrorDB(leido.error, "No se pudieron leer los ajustes actuales, así que no se guardó nada");
  const actual = leido.data?.settings;
  const base: Ajustes = actual && typeof actual === "object" && !Array.isArray(actual) ? (actual as Ajustes) : {};
  const nuevo: Ajustes = { ...base, ...limpio };
  exigirFilas(
    await supabase.from("tenants").update({ settings: nuevo }).eq("id", tenantId).select("id"),
    "No se pudieron guardar los ajustes",
  );
  return nuevo;
}

// ─── Ids ─────────────────────────────────────────────────────────────────────

/**
 * uuid v4. Hermes no trae crypto.randomUUID (y aquí no está instalado
 * react-native-get-random-values), así que se usa crypto.getRandomValues si
 * existe y Math.random si no. Sirve como clave de idempotencia (un cobro, una
 * entrega), no como secreto.
 */
export function nuevoId(): string {
  const b = new Uint8Array(16);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  let conCrypto = false;
  if (c && typeof c.getRandomValues === "function") {
    try { c.getRandomValues(b); conCrypto = true; } catch { conCrypto = false; }
  }
  if (!conCrypto) {
    for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    // Mezcla la hora para que dos teléfonos con la misma semilla no choquen.
    const t = Date.now();
    for (let i = 0; i < 6; i++) b[i] ^= (t / 2 ** (8 * i)) & 0xff;
  }
  b[6] = (b[6] & 0x0f) | 0x40; // versión 4
  b[8] = (b[8] & 0x3f) | 0x80; // variante RFC 4122
  const h = Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
