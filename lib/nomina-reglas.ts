import { leerMonto, montoATexto } from "./dinero";
import { fmtMoneyFull } from "./format";
import { diasEntre, sumarDias } from "./tz";
import type { Periodicidad, ReglaTipo, TipoNovedad } from "./nomina";

/**
 * Lo que el dueño escribe directo en la base (con su RLS) desde Nómina →
 * Novedades y Nómina → Reglas: validación de lo que escribe y armado de las
 * filas. Puro (lib/__tests__/nomina-reglas-test.ts).
 *
 * Aquí NO se calcula la nómina: eso es del servidor (lib/nomina.ts). Los
 * topes son los de la migración 20261001_nomina del repo web:
 *   · payroll_adjustments: amount > 0, kind bonus | tip | deduction; a mano
 *     solo source 'manual', y lo ya liquidado (statement_id) no se toca;
 *   · payroll_profiles: base_salary ≥ 0, base_period mensual | quincenal |
 *     semanal, product_commission_pct entre 0 y 100;
 *   · commission_service_rules: value ≥ 0 (y ≤ 100 si es %), una por
 *     (negocio, servicio, profesional) con professional_id NULL = para todos.
 *
 * Qué comisión se le paga a alguien por un servicio (lo decide el servidor):
 * la regla del servicio para esa persona, si no la del servicio para todos,
 * y si tampoco hay, su comisión general (commission_rules: % de lo cobrado o
 * un fijo una vez por cita).
 */

export type Resultado<T> = { ok: true; valor: T } | { ok: false; error: string };

const ok = <T>(valor: T): Resultado<T> => ({ ok: true, valor });
const falla = <T>(error: string): Resultado<T> => ({ ok: false, error });

/** Tope de cordura para montos escritos a mano (igual que el precio de un servicio). */
export const TOPE_MONTO = 1_000_000_000;

// ─── Lectura de lo que se escribe ────────────────────────────────────────────

/** 'YYYY-MM-DD' que existe de verdad (2026-02-30 no). */
export function esFechaReal(dia: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia ?? "");
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/**
 * Porcentaje escrito a mano: "40", "12,5", "12.5", "40 %". null si no es un
 * número (o es negativo). No lo acota: "150" es 150 y lo rechaza la validación,
 * para no guardar 100 cuando alguien quiso escribir 15.
 */
export function leerPorcentaje(texto: string | null | undefined): number | null {
  const s = String(texto ?? "").replace(/%/g, "").replace(/\s/g, "");
  if (!/^(\d+([.,]\d*)?|[.,]\d+)$/.test(s)) return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Valor de una regla: % (leerPorcentaje) o monto en la moneda del negocio (leerMonto). */
export function leerValorRegla(tipo: ReglaTipo, texto: string | null | undefined): number | null {
  return tipo === "percentage" ? leerPorcentaje(texto) : leerMonto(texto);
}

/**
 * Valida el valor de una regla. `de` dice de qué regla se habla en el mensaje:
 * "la comisión general" → "Escribe el valor de la comisión general."
 */
export function validarValorRegla(tipo: ReglaTipo, texto: string, de: string): Resultado<number> {
  const v = leerValorRegla(tipo, texto);
  if (v === null || !Number.isFinite(v) || v < 0) return falla(`Escribe el valor de ${de}.`);
  if (tipo === "percentage" && v > 100) return falla(`El porcentaje de ${de} no puede pasar de 100.`);
  if (tipo === "fixed" && v > TOPE_MONTO) return falla(`El monto de ${de} es demasiado grande.`);
  return ok(v);
}

/** Un % para mostrar: "40%", "12,5%". */
export function fmtPorcentaje(n: number): string {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return `${String(v).replace(".", ",")}%`;
}

/** "40%", "$10.000" o "$10.000 por cita" (la general fija se paga una vez por cita). */
export function textoRegla(r: { type: ReglaTipo; value: number } | null | undefined, porCita = false): string {
  if (!r) return "—";
  return r.type === "percentage" ? fmtPorcentaje(r.value) : `${fmtMoneyFull(r.value)}${porCita ? " por cita" : ""}`;
}

/** Valor guardado → texto del campo, que leerValorRegla vuelve a leer igual. */
export function valorReglaATexto(tipo: ReglaTipo, valor: number): string {
  const n = Number(valor) || 0;
  if (n === 0) return "0";
  return tipo === "percentage" ? String(Math.round(n * 100) / 100) : montoATexto(n);
}

// ─── Novedades ───────────────────────────────────────────────────────────────

export type OrigenNovedad = "manual" | "caja" | "pos";

export const ETIQUETA_ORIGEN: Record<OrigenNovedad, string> = {
  manual: "A mano",
  caja: "Caja",
  pos: "POS",
};

export const TIPOS_NOVEDAD: readonly { valor: TipoNovedad; ayuda: string; signo: 1 | -1 }[] = [
  { valor: "bonus", ayuda: "Suma: meta cumplida, puntualidad, ventas…", signo: 1 },
  { valor: "tip", ayuda: "Suma: lo que dejó el cliente para esta persona.", signo: 1 },
  { valor: "deduction", ayuda: "Resta: vales, adelantos, préstamos, faltantes.", signo: -1 },
];

export function esTipoNovedad(x: unknown): x is TipoNovedad {
  return x === "bonus" || x === "tip" || x === "deduction";
}

export const LARGO_CONCEPTO = 120;

/** Lo que llena el dueño en la hoja de la novedad. */
export type FormNovedad = {
  professional_id: string | null;
  kind: TipoNovedad;
  /** Monto como se escribió ("50.000"). */
  monto: string;
  entry_date: string;
  concept: string;
};

/** Columnas de payroll_adjustments que escribe el dueño (insert o update). */
export type DatosNovedad = {
  professional_id: string;
  kind: TipoNovedad;
  amount: number;
  entry_date: string;
  concept: string | null;
};

/**
 * Valida una novedad manual. La fecha es un día del negocio; puede ser
 * futura (un adelanto que se descuenta en la próxima quincena) pero no más
 * de un año: la novedad queda pendiente hasta la liquidación que cubra ese día.
 */
export function validarNovedad(f: FormNovedad, hoy: string): Resultado<DatosNovedad> {
  if (!f.professional_id) return falla("Elige a quién es la novedad.");
  if (!esTipoNovedad(f.kind)) return falla("Elige el tipo de novedad.");
  const amount = leerMonto(f.monto);
  if (amount === null || !(amount > 0)) return falla("Escribe un monto mayor que cero.");
  if (amount > TOPE_MONTO) return falla("El monto es demasiado grande.");
  if (!esFechaReal(f.entry_date)) return falla("Elige la fecha de la novedad.");
  if (f.entry_date < "2000-01-01") return falla("Revisa la fecha de la novedad.");
  if (esFechaReal(hoy) && f.entry_date > sumarDias(hoy, 366)) {
    return falla("La fecha no puede pasar de un año hacia adelante.");
  }
  const concept = f.concept.trim().replace(/\s+/g, " ").slice(0, LARGO_CONCEPTO);
  return ok({
    professional_id: f.professional_id,
    kind: f.kind,
    amount,
    entry_date: f.entry_date,
    concept: concept || null,
  });
}

type NovedadMinima = { source: string; statement_id: string | null };

/** Solo se cambian o borran a mano las manuales que no se han pagado. */
export function novedadEditable(n: NovedadMinima): boolean {
  return n.source === "manual" && !n.statement_id;
}

/** Por qué una novedad no se puede tocar aquí (null si sí se puede). */
export function motivoNoEditable(n: NovedadMinima): string | null {
  if (n.statement_id) {
    return "Ya se pagó en una liquidación, así que no se cambia. Si hubo un error, anula esa liquidación en Historial: la novedad vuelve a quedar pendiente.";
  }
  if (n.source === "caja") {
    return "Es una propina registrada en Caja. Se cambia o se borra desde ese movimiento de caja y aquí se ajusta sola.";
  }
  if (n.source === "pos") {
    return "Es la propina de una venta del POS. Sale de esa venta y no se cambia aquí.";
  }
  return null;
}

export type TotalesNovedades = { propinas: number; bonos: number; descuentos: number; neto: number };

/** Suma lo que se está viendo en la lista (no es la nómina: eso lo calcula el servidor). */
export function totalesNovedades(filas: readonly { kind: string; amount: number | string }[]): TotalesNovedades {
  let propinas = 0, bonos = 0, descuentos = 0;
  for (const f of filas) {
    const v = Number(f.amount) || 0;
    if (f.kind === "tip") propinas += v;
    else if (f.kind === "bonus") bonos += v;
    else if (f.kind === "deduction") descuentos += v;
  }
  const r = (x: number) => Math.round(x * 100) / 100;
  return { propinas: r(propinas), bonos: r(bonos), descuentos: r(descuentos), neto: r(propinas + bonos - descuentos) };
}

// ─── Pago de cada profesional ────────────────────────────────────────────────

export const PERIODICIDADES: readonly Periodicidad[] = ["mensual", "quincenal", "semanal"];

export type ReglaGeneral = { type: ReglaTipo; value: number };

export type PerfilPago = {
  base_salary: number;
  base_period: Periodicidad;
  /** Desde cuándo se causa el básico; null = sin básico. */
  base_since: string | null;
  /**
   * null = igual que la comisión general (migración 20261001c del web). Así el
   * % de productos no se congela si después cambia la general.
   */
  product_commission_pct: number | null;
};

export type FormPago = {
  general: { tipo: ReglaTipo | "none"; valor: string };
  basico: string;
  periodo: Periodicidad;
  /** Desde cuándo se cuenta el básico ('YYYY-MM-DD'). */
  desde: string;
  /** Vacío = el % de la comisión general (lo que hace el servidor sin perfil). */
  pctProductos: string;
};

export function formPagoInicial(regla: ReglaGeneral | null, perfil: PerfilPago | null, hoy: string): FormPago {
  return {
    general: regla
      ? { tipo: regla.type, valor: valorReglaATexto(regla.type, regla.value) }
      : { tipo: "none", valor: "" },
    basico: perfil && perfil.base_salary > 0 ? montoATexto(perfil.base_salary) : "",
    periodo: perfil?.base_period ?? "mensual",
    desde: perfil?.base_since ?? hoy,
    pctProductos: perfil && perfil.product_commission_pct !== null ? valorReglaATexto("percentage", perfil.product_commission_pct) : "",
  };
}

export type PagoValidado = {
  /** null = sin comisión general (se borra la regla si había). */
  general: ReglaGeneral | null;
  /**
   * null = no hace falta perfil: no se configuró básico ni % de productos
   * propio. Los productos siguen el % de la comisión general, como hace el
   * servidor sin perfil, en vez de congelar el % de hoy.
   */
  perfil: PerfilPago | null;
  /** Había perfil y ya no hace falta (básico 0 y % vacío): se borra, como en el web. */
  borrarPerfil: boolean;
};

/** % de productos que aplica el servidor sin perfil de pago: el de la general si es %. */
export function pctProductosPorDefecto(general: ReglaGeneral | null): number {
  return general?.type === "percentage" ? general.value : 0;
}

export function validarPago(f: FormPago, ctx: { perfilExiste: boolean; hoy: string }): Resultado<PagoValidado> {
  let general: ReglaGeneral | null = null;
  if (f.general.tipo !== "none") {
    const v = validarValorRegla(f.general.tipo, f.general.valor, "la comisión general");
    if (!v.ok) return v;
    general = { type: f.general.tipo, value: v.valor };
  }

  const basicoTxt = f.basico.trim();
  const basico = basicoTxt ? leerMonto(basicoTxt) : 0;
  if (basico === null || basico < 0) return falla("El básico no es válido: escribe solo el monto, o déjalo vacío si no tiene.");
  if (basico > TOPE_MONTO) return falla("El básico es demasiado grande.");
  if (!PERIODICIDADES.includes(f.periodo)) return falla("Elige cada cuánto se paga el básico.");
  if (basico > 0) {
    if (!esFechaReal(f.desde)) return falla("Escribe desde cuándo se cuenta el básico, como AAAA-MM-DD (por ejemplo 2026-10-01).");
    if (f.desde < "2000-01-01") return falla("Revisa desde cuándo se cuenta el básico.");
    if (esFechaReal(ctx.hoy) && f.desde > sumarDias(ctx.hoy, 366)) {
      return falla("El básico no puede empezar a contarse en más de un año.");
    }
  }

  const pctTxt = f.pctProductos.trim();
  // Vacío = null: "igual que la comisión general". Antes se copiaba el % de
  // la general y quedaba congelado aunque la general cambiara después.
  let pct: number | null = null;
  if (pctTxt) {
    const p = leerPorcentaje(pctTxt);
    if (p === null) return falla("El % de productos no es válido.");
    if (p > 100) return falla("El % de productos no puede pasar de 100.");
    pct = p;
  }

  const hacePerfil = basico > 0 || pct !== null;
  return ok({
    general,
    perfil: hacePerfil
      ? { base_salary: basico, base_period: f.periodo, base_since: basico > 0 ? f.desde : null, product_commission_pct: pct }
      : null,
    borrarPerfil: ctx.perfilExiste && !hacePerfil,
  });
}

/** Días de calendario antes de hoy desde los que se contaría el básico (0 si empieza hoy o después). */
export function diasDeBasicoAtras(desde: string, hoy: string): number {
  if (!esFechaReal(desde) || !esFechaReal(hoy) || desde >= hoy) return 0;
  return diasEntre(desde, hoy) - 1;
}

export function mismaRegla(a: ReglaGeneral | null, b: ReglaGeneral | null): boolean {
  if (!a || !b) return a === b;
  return a.type === b.type && Number(a.value) === Number(b.value);
}

export function mismoPerfil(a: PerfilPago | null, b: PerfilPago | null): boolean {
  if (!a || !b) return a === b;
  return Number(a.base_salary) === Number(b.base_salary)
    && a.base_period === b.base_period
    && (a.base_since ?? null) === (b.base_since ?? null)
    && (a.product_commission_pct === null ? null : Number(a.product_commission_pct))
      === (b.product_commission_pct === null ? null : Number(b.product_commission_pct));
}

// ─── Comisión por servicio ───────────────────────────────────────────────────

export type ReglaServicio = { professional_id: string | null; type: ReglaTipo; value: number };

export type FilaPersonaServicio = {
  professional_id: string;
  nombre: string;
  tipo: ReglaTipo;
  valor: string;
};

export type FormServicio = {
  /** "none" = sin regla para todos: cada uno con su comisión general. */
  todos: { tipo: ReglaTipo | "none"; valor: string };
  /** Las que se editan: profesionales activos. */
  personas: FilaPersonaServicio[];
  /**
   * Las de profesionales inactivos: no se editan, pero guardar borra y
   * vuelve a escribir todas las del servicio, así que se reescriben iguales.
   */
  conservar: ReglaServicio[];
};

/** Arma la hoja del servicio a partir de sus reglas guardadas. */
export function formServicioInicial(
  reglas: readonly ReglaServicio[],
  esActivo: (professionalId: string) => boolean,
  nombreDe: (professionalId: string) => string,
): FormServicio {
  const todos = reglas.find(r => r.professional_id === null);
  const personas: FilaPersonaServicio[] = [];
  const conservar: ReglaServicio[] = [];
  for (const r of reglas) {
    if (r.professional_id === null) continue;
    if (esActivo(r.professional_id)) {
      personas.push({
        professional_id: r.professional_id,
        nombre: nombreDe(r.professional_id),
        tipo: r.type,
        valor: valorReglaATexto(r.type, r.value),
      });
    } else {
      conservar.push({ professional_id: r.professional_id, type: r.type, value: Number(r.value) || 0 });
    }
  }
  personas.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  return {
    todos: todos ? { tipo: todos.type, valor: valorReglaATexto(todos.type, todos.value) } : { tipo: "none", valor: "" },
    personas,
    conservar,
  };
}

/**
 * El conjunto completo de reglas del servicio que queda guardado: la de
 * todos (si hay), la de cada persona activa y, sin cambios, las de las
 * inactivas. Valida cada valor y que nadie esté dos veces (la base tiene una
 * restricción única por servicio y profesional).
 */
export function armarReglasServicio(f: FormServicio): Resultado<ReglaServicio[]> {
  const out: ReglaServicio[] = [];
  if (f.todos.tipo !== "none") {
    const v = validarValorRegla(f.todos.tipo, f.todos.valor, "la comisión para todos");
    if (!v.ok) return v;
    out.push({ professional_id: null, type: f.todos.tipo, value: v.valor });
  }
  const vistos = new Set<string>();
  for (const p of f.personas) {
    if (!p.professional_id) continue;
    if (vistos.has(p.professional_id)) return falla(`${p.nombre || "Alguien"} está dos veces: deja una sola comisión por persona.`);
    vistos.add(p.professional_id);
    const v = validarValorRegla(p.tipo, p.valor, `la comisión de ${p.nombre || "esa persona"}`);
    if (!v.ok) return v;
    out.push({ professional_id: p.professional_id, type: p.tipo, value: v.valor });
  }
  for (const c of f.conservar) {
    if (c.professional_id === null || vistos.has(c.professional_id)) continue;
    vistos.add(c.professional_id);
    out.push({ professional_id: c.professional_id, type: c.type, value: Number(c.value) || 0 });
  }
  return ok(out);
}

/** Filas para insertar en commission_service_rules. */
export function filasReglasServicio(tenantId: string, serviceId: string, reglas: readonly ReglaServicio[]) {
  return reglas.map(r => ({
    tenant_id: tenantId,
    service_id: serviceId,
    professional_id: r.professional_id,
    type: r.type,
    value: r.value,
  }));
}

/** true si los dos conjuntos son iguales (sin importar el orden): no hay nada que guardar. */
export function mismasReglasServicio(a: readonly ReglaServicio[], b: readonly ReglaServicio[]): boolean {
  if (a.length !== b.length) return false;
  const clave = (r: ReglaServicio) => `${r.professional_id ?? "*"}|${r.type}|${Number(r.value)}`;
  const sa = a.map(clave).sort();
  const sb = b.map(clave).sort();
  return sa.every((x, i) => x === sb[i]);
}

const sinAcentos = (x: string) => x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Buscador de la lista de servicios: nombre, categoría o código, sin importar tildes ni mayúsculas. */
export function buscarServicios<T extends { name: string; category?: string | null; code?: string | null }>(
  lista: readonly T[],
  texto: string,
): T[] {
  const q = sinAcentos(texto.trim());
  if (!q) return [...lista];
  return lista.filter(s => sinAcentos(`${s.name} ${s.category ?? ""} ${s.code ?? ""}`).includes(q));
}

/** "40% para todos" / "La general de cada uno", y cuántas personas tienen la suya. */
export function resumenReglasServicio(reglas: readonly ReglaServicio[]): { todos: string | null; distintas: number } {
  const todos = reglas.find(r => r.professional_id === null);
  return {
    todos: todos ? textoRegla(todos) : null,
    distintas: reglas.filter(r => r.professional_id !== null).length,
  };
}
