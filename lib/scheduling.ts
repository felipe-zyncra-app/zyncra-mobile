import { supabase } from "./supabase";
import { ErrorDB, mensajeError, revisar } from "./db";
import { diaDeSemana, inicioDeSemana, sumarDias } from "./tz";
import { fmt12 } from "./format";
import { duracionDe } from "./servicios";

/**
 * Reglas de agenda compartidas por la Agenda del dueño, la del staff, Nueva
 * cita y Modificar cita. Antes cada pantalla tenía su copia (computeAvailable,
 * la tira de la semana, la validación de choques) y ya habían divergido: una
 * miraba el descanso y otra no, ninguna miraba blocked_slots, y el domingo
 * caía en la semana siguiente.
 *
 * Los días se manejan como 'YYYY-MM-DD' del NEGOCIO (lib/tz), nunca como Date
 * del teléfono: con el negocio en Bogotá y el teléfono en Madrid el "hoy" y el
 * día de la semana no coinciden.
 */

// ─── Horas ───────────────────────────────────────────────────────────────────

/** "HH:MM" o "HH:MM:SS" → minutos desde la medianoche. Texto inválido → 0. */
export function timeToMins(t: string): number {
  const [h, m] = String(t ?? "").split(":").map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

export function minsToTime(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

/**
 * Interpreta lo que escribe el usuario en "Otra hora". Devuelve 'HH:MM' (24 h)
 * o null si no es una hora clara.
 *
 * Antes se quitaban los separadores y "12:5" se leía como 01:25 AM, y "9:5" se
 * descartaba sin avisar. Ahora:
 *  · con separador (":", "." o "h") los minutos van con dos dígitos: "9:05", "14.30";
 *  · sin separador, los dos últimos dígitos son los minutos: "930" → 09:30, "1430" → 14:30;
 *  · una o dos cifras son la hora en punto: "9" → 09:00;
 *  · acepta "am"/"pm": "2:30 pm" → 14:30.
 */
export function parsearHora(texto: string): string | null {
  let s = String(texto ?? "").trim().toLowerCase();
  if (!s) return null;
  let sufijo: "am" | "pm" | null = null;
  const suf = /\s*([ap])\.?\s*m\.?\s*$/.exec(s);
  if (suf) {
    sufijo = suf[1] === "p" ? "pm" : "am";
    s = s.slice(0, suf.index).trim();
  }
  let h: number, m: number;
  const conSep = /^(\d{1,2})\s*[:.h]\s*(\d{2})$/.exec(s);
  if (conSep) {
    h = Number(conSep[1]); m = Number(conSep[2]);
  } else if (/^\d{1,2}$/.test(s)) {
    h = Number(s); m = 0;
  } else if (/^\d{3,4}$/.test(s)) {
    h = Number(s.slice(0, -2)); m = Number(s.slice(-2));
  } else {
    return null;
  }
  if (sufijo) {
    if (h < 1 || h > 12) return null;
    if (sufijo === "pm" && h < 12) h += 12;
    if (sufijo === "am" && h === 12) h = 0;
  }
  if (h > 23 || m > 59) return null;
  return minsToTime(h * 60 + m);
}

export const DEFAULT_SLOT_INTERVAL = 30;

/** Igual que el web (src/lib/datetime.ts): fuera de 5–480 min se usa el default. */
export function normalizeSlotInterval(v: unknown): number {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) && n >= 5 && n <= 480 ? n : DEFAULT_SLOT_INTERVAL;
}

export type DayHours = {
  open: boolean;
  start: string;
  end: string;
  /** Descanso del día (almuerzo). Null o ausente = sin descanso. */
  break_start?: string | null;
  break_end?: string | null;
  /** true = el descanso solo corta la grilla; no rechaza servicios que lo pisen (espejo de la web). */
  break_soft?: boolean | null;
};

/**
 * Horas de inicio válidas de un día.
 *
 * El paso sale de `tenants.settings.slot_interval_min` y el descanso corta la
 * grilla, igual que en la web y en la reserva pública. La grilla VUELVE A
 * ANCLAR al terminar el descanso: con 90 min desde las 09:00 y almuerzo
 * 12:30–13:00 da 09:00, 10:30, 12:00 · 13:00, 14:30, 16:00, 17:30.
 */
export function generateSlotsForDay(
  day: DayHours,
  duration: number,
  intervalMin: number = DEFAULT_SLOT_INTERVAL,
): string[] {
  const step      = normalizeSlotInterval(intervalMin);
  const startMins = timeToMins(day.start);
  const endMins   = timeToMins(day.end);
  const bs = day.break_start ? timeToMins(day.break_start) : null;
  const be = day.break_end   ? timeToMins(day.break_end)   : null;
  const hasBreak = bs != null && be != null && bs > startMins && be < endMins && be > bs;

  const segments: [number, number][] = hasBreak
    ? [[startMins, bs!], [be!, endMins]]
    : [[startMins, endMins]];

  const slots: string[] = [];
  for (const [from, to] of segments) {
    for (let m = from; m < to && slots.length < 200; m += step) {
      // El servicio completo tiene que caber antes del cierre…
      if (m + duration > endMins) break;
      // …y no puede quedar montado sobre el descanso (salvo descanso "suave").
      if (hasBreak && !day.break_soft && m < be! && bs! < m + duration) continue;
      slots.push(minsToTime(m));
    }
  }
  return slots;
}

/** ¿El servicio [m, m+dur) pisa el descanso del día? */
export function overlapsDayBreak(m: number, duration: number, day: DayHours | null | undefined): boolean {
  if (!day?.break_start || !day?.break_end) return false;
  if (day.break_soft) return false;
  const bs = timeToMins(day.break_start), be = timeToMins(day.break_end);
  return m < be && bs < m + duration;
}

// ─── Semanas ─────────────────────────────────────────────────────────────────

/**
 * Los 7 días (lunes a domingo) de la semana de `dia`. Un domingo pertenece a
 * la semana que TERMINA: antes buildWeek mandaba el domingo a la semana
 * siguiente y hoy no aparecía en la tira (AGE-02 / TZ-X1).
 */
export function semanaDe(dia: string): string[] {
  const lunes = inicioDeSemana(dia);
  return Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i));
}

/** Clave del día en settings.schedule: "0" = domingo … "6" = sábado (Date.getDay()). */
export function claveDia(dia: string): string {
  return String(diaDeSemana(dia) % 7);
}

/** @deprecated Usa semanaDe(dia) con días del negocio. Se deja corregido (lunes a domingo). */
export function buildWeek(base: Date): Date[] {
  const start = new Date(base);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ─── Horario del negocio ─────────────────────────────────────────────────────

/** Mismo respaldo que el web (/api/ai/availability) cuando no hay horario guardado. */
export const HORARIO_POR_DEFECTO: DayHours = { open: true, start: "08:00", end: "19:00" };

export type HorarioNegocio = {
  /** Claves "0".."6" (domingo a sábado), siempre las 7. */
  dias: Record<string, DayHours>;
  /**
   * true si el negocio nunca guardó horario: se usa HORARIO_POR_DEFECTO y la
   * app debe invitar a configurarlo (antes salía "Día no laborable" en todos
   * los días y no se podía agendar, AGE-04).
   */
  porDefecto: boolean;
  origen: "schedule" | "businessHours" | "defecto";
};

// Formato legado del editor móvil ({mon..sun} con {enabled}).
const LEGACY_DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

type Crudo = Record<string, unknown>;
const esObjeto = (v: unknown): v is Crudo => !!v && typeof v === "object" && !Array.isArray(v);
const texto = (v: unknown): string | null => (typeof v === "string" && v.length >= 4 ? v : null);

function normalizarDia(raw: unknown, legado: boolean): DayHours | null {
  if (!esObjeto(raw)) return null;
  if (legado) {
    // settings.businessHours: { enabled, open, close }
    return {
      open: raw.enabled !== false,
      start: texto(raw.open) ?? HORARIO_POR_DEFECTO.start,
      end: texto(raw.close) ?? HORARIO_POR_DEFECTO.end,
    };
  }
  return {
    open: raw.open !== undefined ? raw.open !== false : raw.enabled !== false,
    start: texto(raw.start) ?? HORARIO_POR_DEFECTO.start,
    end: texto(raw.end) ?? HORARIO_POR_DEFECTO.end,
    break_start: texto(raw.break_start),
    break_end: texto(raw.break_end),
    break_soft: typeof raw.break_soft === "boolean" ? raw.break_soft : null,
  };
}

/**
 * Horario del negocio a partir de tenants.settings, con la misma precedencia
 * que el web: `schedule` (lo que edita Ajustes → Horario); si no existe,
 * `businessHours` (esquema viejo); si tampoco, 08:00–19:00 todos los días.
 * Un día que falte en el objeto usa el horario por defecto, como el web.
 */
export function leerHorarioNegocio(settings: unknown): HorarioNegocio {
  const s = esObjeto(settings) ? settings : {};
  const schedule = esObjeto(s.schedule) && Object.keys(s.schedule).length > 0 ? s.schedule : null;
  const legado = !schedule && esObjeto(s.businessHours) && Object.keys(s.businessHours).length > 0
    ? s.businessHours : null;
  const fuente = schedule ?? legado;
  const dias: Record<string, DayHours> = {};
  for (let d = 0; d < 7; d++) {
    const raw = fuente ? (fuente[String(d)] ?? fuente[LEGACY_DAY_KEYS[d]]) : null;
    dias[String(d)] = normalizarDia(raw, !!legado) ?? { ...HORARIO_POR_DEFECTO };
  }
  return {
    dias,
    porDefecto: !fuente,
    origen: schedule ? "schedule" : legado ? "businessHours" : "defecto",
  };
}

/**
 * Horario efectivo de un día: el propio del profesional (si tiene ese día)
 * manda sobre el del negocio, igual que la reserva online y el web. Lo que el
 * profesional no tenga escrito (hora de apertura, descanso) se hereda del
 * negocio en vez de inventar 09:00–18:00.
 */
export function effectiveDayHours(dia: string, negocio: HorarioNegocio | null | undefined, proSchedule: unknown): DayHours {
  const clave = claveDia(dia);
  const bd = negocio?.dias[clave] ?? HORARIO_POR_DEFECTO;
  const ps = esObjeto(proSchedule) ? proSchedule : null;
  const pd = ps ? (ps[clave] ?? ps[LEGACY_DAY_KEYS[Number(clave)]]) : null;
  if (esObjeto(pd)) {
    return {
      open:  !!(pd.open ?? pd.enabled),
      start: texto(pd.start) ?? bd.start,
      end:   texto(pd.end) ?? bd.end,
      break_start: texto(pd.break_start) ?? bd.break_start ?? null,
      break_end:   texto(pd.break_end) ?? bd.break_end ?? null,
      break_soft:  typeof pd.break_soft === "boolean" ? pd.break_soft : bd.break_soft ?? null,
    };
  }
  return bd;
}

/**
 * Avisos para una hora puesta a mano ("Otra hora") que no salió de la grilla:
 * fuera de la jornada, encima del descanso o con el negocio cerrado. No
 * bloquean (el negocio a veces acomoda a alguien), pero se piden confirmar.
 */
export function avisosDeHorario(dia: DayHours | null | undefined, hora: string, duracion: number): string[] {
  const inicio = timeToMins(hora);
  const fin = inicio + duracion;
  if (!dia || !dia.open) return ["Según el horario, ese día no se atiende."];
  const avisos: string[] = [];
  const abre = timeToMins(dia.start), cierra = timeToMins(dia.end);
  if (inicio < abre) avisos.push(`Empieza antes de la apertura (${fmt12(dia.start)}).`);
  if (fin > cierra) avisos.push(`Termina después del cierre (${fmt12(dia.end)}).`);
  if (overlapsDayBreak(inicio, duracion, dia)) {
    avisos.push(`Se cruza con el descanso (${fmt12(dia.break_start!)} – ${fmt12(dia.break_end!)}).`);
  }
  return avisos;
}

// ─── Servicios y profesionales ───────────────────────────────────────────────

type ConDuracion = { duration_minutes?: number | null; duration_min?: number | null } | null | undefined;

/**
 * Duración de un servicio tal como llega embebido en una cita
 * (`services(duration_minutes, duration_min)`, objeto o arreglo).
 *
 * Si hay servicio, la regla es la de Ajustes → Servicios (duracionDe, D3):
 * duration_minutes y, si falta, duration_min; sin ninguna válida, 30 min como
 * el web. `porDefecto` solo aplica a una cita SIN servicio (service_id null):
 * se le reservan 60 min para no ofrecer encima un cupo que quizá no alcanza.
 */
export function duracionServicio(s: ConDuracion | ConDuracion[], porDefecto = 60): number {
  const x = Array.isArray(s) ? s[0] : s;
  if (!x) return porDefecto;
  // Los numeric pueden llegar como texto: duracionDe solo acepta números.
  const aNumero = (v: unknown) => (v == null || v === "" ? null : Number(v));
  return duracionDe({ duration_minutes: aNumero(x.duration_minutes), duration_min: aNumero(x.duration_min) });
}

/**
 * Profesionales que atienden en la sede activa (o sin sede asignada). Si con
 * el filtro no queda nadie, se devuelven todos: mejor ofrecer la lista
 * completa que dejar al dueño sin poder agendar (AGE-16).
 */
export function profesionalesDeLaSede<T extends { location_id?: string | null }>(pros: T[], sede: string | null): T[] {
  if (!sede) return pros;
  const deLaSede = pros.filter(p => !p.location_id || p.location_id === sede);
  return deLaSede.length > 0 ? deLaSede : pros;
}

export type ServicioAgenda = {
  id: string;
  name: string;
  price: number;
  duracion: number;
  /** false si el servicio está archivado (services.is_active, llega con la migración). */
  activo: boolean;
  /** Código que el negocio le asigna en el admin (services.code, ej. "101"). */
  code?: string | null;
};

export type ProfesionalAgenda = {
  id: string;
  name: string;
  role?: string | null;
  schedule?: unknown;
  location_id?: string | null;
};

export type CatalogoAgenda = {
  servicios: ServicioAgenda[];
  profesionales: ProfesionalAgenda[];
  horario: HorarioNegocio;
  intervalo: number;
};

/**
 * Convierte una fila de services (con o sin is_active) al formato de la
 * agenda. La duración se lee con la misma regla de Ajustes → Servicios
 * (duracionDe) y un servicio archivado queda con activo=false: Nueva cita no
 * lo ofrece y Modificar cita solo lo conserva si ya era el de la cita.
 */
export function aServicioAgenda(s: Crudo): ServicioAgenda {
  return {
    id: String(s.id),
    name: String(s.name ?? "Servicio"),
    price: Number(s.price ?? 0) || 0,
    duracion: duracionServicio(s as ConDuracion),
    activo: s.is_active !== false,
    code: typeof s.code === "string" && s.code.trim() ? s.code.trim() : null,
  };
}

/**
 * Buscador del paso "Servicio" de Nueva cita: por nombre o por código, igual
 * que el panel web. Sin texto devuelve la lista entera.
 */
export function filtrarServicios<T extends Pick<ServicioAgenda, "name" | "code">>(lista: readonly T[], texto: string): T[] {
  const q = texto.trim().toLowerCase();
  if (!q) return [...lista];
  return lista.filter(x => x.name.toLowerCase().includes(q) || (x.code ?? "").toLowerCase().includes(q));
}

/** El servicio cuyo código es EXACTAMENTE lo tecleado (se elige solo), o null. */
export function servicioPorCodigo<T extends Pick<ServicioAgenda, "code">>(lista: readonly T[], texto: string): T | null {
  const q = texto.trim().toLowerCase();
  if (!q) return null;
  return lista.find(x => (x.code ?? "").toLowerCase() === q) ?? null;
}

/**
 * Servicios, profesionales activos y horario del negocio para agendar. Lanza
 * ErrorDB si algo falla: antes un corte de red dejaba el horario vacío y todos
 * los días salían "no laborables".
 *
 * services se lee con "*" a propósito: services.is_active lo agrega la
 * migración y pedirlo por nombre rompería la consulta antes de aplicarla.
 */
export async function cargarCatalogoAgenda(tenantId: string): Promise<CatalogoAgenda> {
  const [svc, pros, ten] = await Promise.all([
    supabase.from("services").select("*").eq("tenant_id", tenantId).order("name"),
    supabase.from("professionals").select("id, name, role, schedule, location_id")
      .eq("tenant_id", tenantId).eq("is_active", true).order("name"),
    supabase.from("tenants").select("settings").eq("id", tenantId).single(),
  ]);
  const servicios = (revisar(svc, "No se pudieron cargar los servicios") ?? []) as Crudo[];
  const profesionales = (revisar(pros, "No se pudo cargar el equipo") ?? []) as ProfesionalAgenda[];
  const tenant = revisar(ten, "No se pudo cargar el horario del negocio") as { settings?: unknown } | null;
  const settings = esObjeto(tenant?.settings) ? tenant!.settings as Crudo : {};
  return {
    servicios: servicios.map(aServicioAgenda),
    profesionales,
    horario: leerHorarioNegocio(settings),
    intervalo: normalizeSlotInterval(settings.slot_interval_min),
  };
}

// ─── Ocupación del día ───────────────────────────────────────────────────────

export type Ocupado = {
  inicio: number;
  fin: number;
  tipo: "cita" | "bloqueo";
  /** id de la cita o del bloqueo. */
  id?: string;
  /** Bloqueo: null = cierre de todo el negocio. */
  professionalId: string | null;
  motivo?: string | null;
};

/** Bloqueos (blocked_slots) de un día que afectan a un profesional: los suyos y los de todo el negocio. */
export function bloqueosQueAplican<T extends { professional_id?: string | null }>(bloqueos: T[], professionalId: string | null): T[] {
  return bloqueos.filter(b => !b.professional_id || b.professional_id === professionalId);
}

/**
 * Lo que ya ocupa el día de un profesional: sus citas no canceladas (con la
 * duración de su servicio) y los bloqueos de blocked_slots (sus ausencias y
 * los cierres del negocio). Antes la app solo miraba las citas y ofrecía
 * cupos dentro de una ausencia registrada en el web (AGE-05).
 *
 * Lanza ErrorDB si la consulta falla: tomar un error como "día libre" ofrecía
 * todos los cupos aunque el profesional tuviera citas (AGE-X1).
 */
export async function ocupacionDelDia(o: {
  tenantId: string;
  professionalId: string;
  dia: string;
  excluirCitaId?: string | null;
}): Promise<Ocupado[]> {
  let citasQ = supabase.from("appointments")
    .select("id, appointment_time, services(duration_minutes, duration_min)")
    .eq("tenant_id", o.tenantId)
    .eq("professional_id", o.professionalId)
    .eq("appointment_date", o.dia)
    .neq("status", "cancelled");
  if (o.excluirCitaId) citasQ = citasQ.neq("id", o.excluirCitaId);
  const [citasRes, bloqRes] = await Promise.all([
    citasQ,
    supabase.from("blocked_slots")
      .select("id, start_time, end_time, professional_id, reason")
      .eq("tenant_id", o.tenantId)
      .eq("blocked_date", o.dia),
  ]);
  if (citasRes.error) throw new ErrorDB(citasRes.error, "No se pudo verificar la agenda");
  if (bloqRes.error) throw new ErrorDB(bloqRes.error, "No se pudo verificar la agenda");

  const out: Ocupado[] = [];
  for (const a of (citasRes.data ?? []) as Crudo[]) {
    const inicio = timeToMins(String(a.appointment_time ?? "").slice(0, 5));
    out.push({
      inicio,
      fin: inicio + duracionServicio(a.services as ConDuracion | ConDuracion[]),
      tipo: "cita",
      id: String(a.id),
      professionalId: o.professionalId,
    });
  }
  const bloqueos = (bloqRes.data ?? []) as { id: string; start_time: string; end_time: string; professional_id: string | null; reason: string | null }[];
  for (const b of bloqueosQueAplican(bloqueos, o.professionalId)) {
    const inicio = timeToMins(b.start_time), fin = timeToMins(b.end_time);
    if (fin <= inicio) continue;
    out.push({ inicio, fin, tipo: "bloqueo", id: b.id, professionalId: b.professional_id, motivo: b.reason });
  }
  return out;
}

/** El primer ocupado que se cruza con [inicio, inicio+duracion), o null. */
export function choqueCon(inicio: number, duracion: number, ocupados: Ocupado[]): Ocupado | null {
  const fin = inicio + duracion;
  return ocupados.find(o => inicio < o.fin && o.inicio < fin) ?? null;
}

/** Cupos de la grilla que no se cruzan con citas ni bloqueos. */
/**
 * Margen mínimo antes de ofrecer un cupo de HOY en Nueva cita. Mismo valor que
 * MIN_LEAD_MIN del panel web y de la reserva pública: sin él se podía agendar
 * a las 3:00 estando a las 2:58.
 */
export const MIN_LEAD_MIN = 30;

export function cuposLibres(slots: string[], ocupados: Ocupado[], duracion: number): string[] {
  return slots.filter(s => !choqueCon(timeToMins(s), duracion, ocupados));
}

/** Texto para el usuario: con qué choca. */
export function describirOcupado(o: Ocupado): string {
  const rango = `${fmt12(minsToTime(o.inicio))} a ${fmt12(minsToTime(o.fin))}`;
  if (o.tipo === "cita") return `Ese horario choca con otra cita del profesional (${rango}).`;
  const motivo = o.motivo ? ` (${o.motivo})` : "";
  return o.professionalId
    ? `El profesional tiene una ausencia programada de ${rango}${motivo}.`
    : `El negocio tiene cerrado de ${rango}${motivo}.`;
}

export type VerificacionCupo = { ok: true } | { ok: false; motivo: string };

/**
 * Re-verifica contra la base, justo antes de guardar, que la hora siga libre:
 * los cupos se calcularon al abrir el paso y otro dispositivo pudo ocuparlos.
 * Mira citas Y bloqueos, y rechaza una cita que cruce la medianoche (la
 * validación por día no la vería). Lanza ErrorDB si no se pudo consultar: la
 * versión anterior asumía "libre" y guardaba encima de otra cita.
 *
 * Aun así, dos teléfonos que guardan en el mismo segundo pueden pasar los
 * dos: la protección completa necesita una restricción en la base (AGE-11).
 */
export async function verificarCupo(o: {
  tenantId: string;
  professionalId: string;
  dia: string;
  hora: string;
  duracion: number;
  excluirCitaId?: string | null;
}): Promise<VerificacionCupo> {
  const inicio = timeToMins(o.hora);
  if (inicio + o.duracion > 24 * 60) {
    return { ok: false, motivo: "La cita terminaría después de la medianoche. Elige una hora más temprana." };
  }
  const ocupados = await ocupacionDelDia(o);
  const c = choqueCon(inicio, o.duracion, ocupados);
  return c ? { ok: false, motivo: describirOcupado(c) } : { ok: true };
}

/** true si el error es el índice único de "misma hora, mismo profesional" (23505). */
export function esHorarioOcupado(err: unknown): boolean {
  const e = err as { code?: string } | null;
  return !!e && e.code === "23505";
}

/**
 * Mensaje al guardar una cita. El 23505 del índice idx_appts_no_double_booking
 * significa "ya hay otra cita a esa hora": antes se mostraba "Revisa tu
 * conexión".
 */
export function mensajeErrorCita(err: unknown, contexto = "No se pudo guardar la cita"): string {
  if (esHorarioOcupado(err)) return "Ese horario ya está ocupado para ese profesional. Elige otra hora.";
  return mensajeError(err, contexto);
}

// ─── Línea de tiempo ─────────────────────────────────────────────────────────

/**
 * Franja que debe dibujar la línea de tiempo: desde la apertura más temprana
 * hasta el cierre más tardío de los horarios del día, estirada para que
 * quepan TODAS las citas. Antes era 8:00–21:00 fijo y una cita a las 7:00 o a
 * las 21:30 contaba en el encabezado pero no se veía ni se podía cobrar
 * (CAL-09 / AGE-06). Se redondea a horas completas.
 */
export function rangoLineaDeTiempo(
  horarios: (DayHours | null | undefined)[],
  citas: { inicio: number; fin: number }[],
  porDefecto: { inicio: number; fin: number } = { inicio: 8 * 60, fin: 21 * 60 },
): { inicio: number; fin: number } {
  const abiertos = horarios.filter((h): h is DayHours => !!h && h.open);
  let inicio = abiertos.length ? Math.min(...abiertos.map(h => timeToMins(h.start))) : porDefecto.inicio;
  let fin = abiertos.length ? Math.max(...abiertos.map(h => timeToMins(h.end))) : porDefecto.fin;
  for (const c of citas) {
    inicio = Math.min(inicio, c.inicio);
    fin = Math.max(fin, c.fin);
  }
  inicio = Math.max(0, Math.floor(inicio / 60) * 60);
  fin = Math.min(24 * 60, Math.ceil(fin / 60) * 60);
  if (fin - inicio < 60) fin = Math.min(24 * 60, inicio + 60);
  return { inicio, fin };
}

/**
 * Ids de las citas que se cruzan con otra DEL MISMO profesional. Antes se
 * contaba "conflicto" cualquier par de citas a la misma hora (dos barberos a
 * las 10:00 es un día normal) y no se veía un 9:00 de 60 min contra un 9:30
 * (AGE-12). Canceladas y no-show no cuentan.
 */
export function citasQueSeCruzan(citas: { id: string; professionalId: string | null; inicio: number; fin: number; status?: string | null }[]): Set<string> {
  const vigentes = citas.filter(c => c.professionalId && c.status !== "cancelled" && c.status !== "no_show");
  const porPro = new Map<string, typeof vigentes>();
  for (const c of vigentes) {
    const l = porPro.get(c.professionalId!) ?? [];
    l.push(c);
    porPro.set(c.professionalId!, l);
  }
  const out = new Set<string>();
  for (const lista of porPro.values()) {
    lista.sort((a, b) => a.inicio - b.inicio);
    for (let i = 0; i < lista.length; i++) {
      for (let j = i + 1; j < lista.length && lista[j].inicio < lista[i].fin; j++) {
        out.add(lista[i].id);
        out.add(lista[j].id);
      }
    }
  }
  return out;
}
