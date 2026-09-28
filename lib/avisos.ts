import { fmt12 } from "./format";
import { diaLocalDe, fmtDia, minutosDelDia, sumarDias } from "./tz";

/**
 * Avisos PARA EL NEGOCIO. Lógica pura: sin red, sin almacenamiento, sin
 * expo-notifications (lib/notifications y lib/useAvisos la usan).
 *
 * DOS PIEZAS
 *  · textoRecordatorioCita: el aviso local que suena en el teléfono del dueño
 *    antes de cada cita. Las versiones publicadas le mostraban la plantilla
 *    PARA EL CLIENTE ("¡Hola Juan! Te recordamos tu cita…") y el dueño leía en
 *    la pantalla de bloqueo un mensaje como si él fuera el cliente. Ahora es
 *    un recordatorio para el negocio: "Recuerda: mañana a las 3:00 PM tienes
 *    una cita con Juan para Corte." El "cuándo" se calcula desde el momento en
 *    que SUENA el aviso y en la zona del negocio, nunca con la del teléfono.
 *  · armarAvisos: la lista de la campana del Panel. Mismos tipos, ids y reglas
 *    que la campana del portal (ZyncraSas_v1/src/app/admin/NotificationsBell.tsx),
 *    pero "hoy" y los minutos que faltan salen de la zona del NEGOCIO: el
 *    portal usa el reloj del navegador y después de las 7 PM en Colombia el
 *    día ya es otro en UTC.
 */

// ─── Recordatorio en el teléfono del negocio ─────────────────────────────────

export const TITULO_RECORDATORIO = "Recordatorio de cita";

export type CitaRecordatorio = {
  /** "YYYY-MM-DD" (día del negocio). */
  date: string;
  /** "HH:MM" o "HH:MM:SS" (hora del negocio). */
  time: string;
  clientName?: string | null;
  serviceName?: string | null;
};

function limpio(v: string | null | undefined): string {
  return typeof v === "string" ? v.trim() : "";
}

/** "a las 3:00 PM"; "a la 1:30 PM" (en español la una va en singular). */
function aLaHora(hhmm: string): string {
  const hora = fmt12(hhmm.slice(0, 5));
  return hora.startsWith("1:") ? `a la ${hora}` : `a las ${hora}`;
}

/**
 * Cuándo es la cita visto desde `referencia` (el instante en que suena el
 * aviso), en la zona del negocio:
 *   "hoy a las 3:00 PM" · "mañana a las 3:00 PM" · "el sábado 3 de octubre a las 3:00 PM"
 */
export function cuandoEsLaCita(dia: string, hhmm: string, referencia: Date, timeZone: string): string {
  const hora = aLaHora(hhmm ?? "");
  const diaRef = diaLocalDe(referencia, timeZone);
  if (dia === diaRef) return `hoy ${hora}`;
  if (dia === sumarDias(diaRef, 1)) return `mañana ${hora}`;
  return `el ${fmtDia(dia, "largo")} ${hora}`;
}

/**
 * Título y cuerpo del aviso al negocio. `disparo` es cuándo sonará.
 *   { title: "Recordatorio de cita",
 *     body: "Recuerda: hoy a las 3:00 PM tienes una cita con Juan para Corte." }
 * Sin cliente dice "con un cliente"; sin servicio se omite " para …".
 */
export function textoRecordatorioCita(
  cita: CitaRecordatorio,
  disparo: Date,
  timeZone: string,
): { title: string; body: string } {
  const cliente = limpio(cita.clientName) || "un cliente";
  const servicio = limpio(cita.serviceName);
  const cuando = cuandoEsLaCita(cita.date, cita.time, disparo, timeZone);
  return {
    title: TITULO_RECORDATORIO,
    body: `Recuerda: ${cuando} tienes una cita con ${cliente}${servicio ? ` para ${servicio}` : ""}.`,
  };
}

// ─── Campana del Panel ───────────────────────────────────────────────────────

export type TipoAviso = "inasistencia" | "sin_confirmar" | "sin_profesional" | "nueva_cita" | "cancelacion";
export type GrupoAviso = "urgente" | "accion" | "actividad";

export type Aviso = {
  /** Mismo esquema que el portal (D_, Dcancel_, B_, A_, C_ + id de la cita). */
  id: string;
  citaId: string;
  tipo: TipoAviso;
  grupo: GrupoAviso;
  cliente: string;
  servicio: string;
  /** Día de la cita ('YYYY-MM-DD' del negocio): a dónde lleva el toque. */
  fecha: string;
  /** "Hoy · 3:00 PM", "Mañana · 3:00 PM", "sáb 3 oct · 3:00 PM"; "" en cancelaciones (como el portal). */
  cuando: string;
  /** "Hace 5 min", "En 45 min", "Hoy", "Próxima". */
  etiqueta: string;
};

/** Fila de appointments con lo que usa la campana (embeds clients/services). */
export type CitaAviso = {
  id: string;
  appointment_date: string;
  appointment_time: string;
  status: string | null;
  professional_id?: string | null;
  created_at?: string | null;
  clients?: { name?: string | null } | null;
  services?: { name?: string | null } | null;
};

/** "Reciente" = creada en las últimas 2 h (nueva cita / cancelación). */
export const VENTANA_RECIENTES_MS = 2 * 60 * 60 * 1000;
/** Tope de citas recientes, como el portal (limit 10). */
export const MAX_RECIENTES = 10;
/** Próximas: de hoy a hoy + 7 días del negocio. */
export const DIAS_PROXIMOS = 7;
/** Sin profesional: solo las 4 más próximas, como el portal. */
export const MAX_SIN_PROFESIONAL = 4;
/** Sin confirmar: pendiente y faltan 2 h o menos. */
export const MIN_SIN_CONFIRMAR = 120;
/** Por presentarse: confirmada y faltan 3 h o menos. */
export const MIN_POR_PRESENTARSE = 180;

export const ORDEN_GRUPOS: GrupoAviso[] = ["urgente", "accion", "actividad"];

export const NOMBRE_GRUPO: Record<GrupoAviso, string> = {
  urgente:   "Urgente",
  accion:    "Requiere acción",
  actividad: "Actividad reciente",
};

export const NOMBRE_TIPO: Record<TipoAviso, string> = {
  inasistencia:    "Por presentarse",
  sin_confirmar:   "Sin confirmar",
  sin_profesional: "Sin profesional",
  nueva_cita:      "Nueva cita",
  cancelacion:     "Cancelada",
};

const VIGENTES = new Set(["pending", "confirmed"]);

function nombreDe(rel: { name?: string | null } | null | undefined, respaldo: string): string {
  return limpio(rel?.name) || respaldo;
}

function minutosDeHora(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

/** "Hoy · 3:00 PM", "Mañana · 3:00 PM" o "sáb 3 oct · 3:00 PM". */
export function cuandoCorto(dia: string, hhmm: string, hoy: string): string {
  const hora = fmt12((hhmm ?? "").slice(0, 5));
  if (dia === hoy) return `Hoy · ${hora}`;
  if (dia === sumarDias(hoy, 1)) return `Mañana · ${hora}`;
  return `${fmtDia(dia, "semana-dia-mes")} · ${hora}`;
}

/** Hace cuánto: "Ahora", "Hace 5 min", "Hace 2 h", "Hace 3 d". */
export function haceCuanto(instante: string | null | undefined, ahora: Date): string {
  const t = Date.parse(instante ?? "");
  if (!Number.isFinite(t)) return "";
  const m = Math.floor((ahora.getTime() - t) / 60000);
  if (m < 2) return "Ahora";
  if (m < 60) return `Hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `Hace ${h} h`;
  return `Hace ${Math.floor(h / 24)} d`;
}

/** Cuánto falta: "Ahora", "En 45 min", "En 2 h", "En 1 h 30 min". */
export function enCuanto(minutos: number): string {
  if (minutos <= 0) return "Ahora";
  if (minutos < 60) return `En ${minutos} min`;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m > 0 ? `En ${h} h ${m} min` : `En ${h} h`;
}

function porFechaYHora(a: CitaAviso, b: CitaAviso): number {
  const fa = `${a.appointment_date} ${(a.appointment_time ?? "").slice(0, 5)}`;
  const fb = `${b.appointment_date} ${(b.appointment_time ?? "").slice(0, 5)}`;
  return fa < fb ? -1 : fa > fb ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Arma la lista de la campana con las reglas del portal, en este orden (cada
 * cita genera un solo aviso: la primera regla que la toma se la queda):
 *  1. Nueva cita: creada en las últimas 2 h y no cancelada (va primero para
 *     que no se la robe "sin confirmar").
 *  2. Cancelada: creada en las últimas 2 h y ya cancelada.
 *  3. Sin confirmar: pendiente, HOY, y faltan entre 0 y 120 minutos.
 *  4. Por presentarse: confirmada, HOY, y faltan entre 0 y 180 minutos.
 *  5. Sin profesional: pendiente o confirmada de hoy a 7 días sin
 *     profesional (las 4 más próximas).
 *
 * `proximas`: citas pendientes/confirmadas de hoy a hoy + 7 (del negocio).
 * `recientes`: citas creadas hace poco (se vuelven a filtrar por la ventana
 * de 2 h con `ahora`, así la lista se puede recalcular sin volver a consultar).
 */
export function armarAvisos({ proximas, recientes, ahora, timeZone }: {
  proximas: CitaAviso[];
  recientes: CitaAviso[];
  ahora: Date;
  timeZone: string;
}): Aviso[] {
  const hoy = diaLocalDe(ahora, timeZone);
  const limite = sumarDias(hoy, DIAS_PROXIMOS);
  const ahoraMin = minutosDelDia(ahora, timeZone);
  const desde = ahora.getTime() - VENTANA_RECIENTES_MS;

  const lista: Aviso[] = [];
  const vistas = new Set<string>();   // cada cita genera solo un aviso
  const base = (a: CitaAviso) => ({
    citaId: a.id,
    cliente: nombreDe(a.clients, "Cliente"),
    servicio: nombreDe(a.services, "Servicio"),
    fecha: a.appointment_date,
  });
  const agregar = (a: CitaAviso, aviso: Omit<Aviso, "citaId" | "cliente" | "servicio" | "fecha">) => {
    if (vistas.has(a.id)) return;
    vistas.add(a.id);
    lista.push({ ...base(a), ...aviso });
  };

  // Recientes: creadas en la ventana, las más nuevas primero, tope de 10.
  const nuevas = recientes
    .filter(a => {
      const t = Date.parse(a.created_at ?? "");
      return Number.isFinite(t) && t >= desde;
    })
    .sort((a, b) => Date.parse(b.created_at ?? "") - Date.parse(a.created_at ?? ""))
    .slice(0, MAX_RECIENTES);

  // 1. Nueva cita
  for (const a of nuevas) {
    if (a.status === "cancelled") continue;
    agregar(a, {
      id: `D_${a.id}`, tipo: "nueva_cita", grupo: "actividad",
      cuando: cuandoCorto(a.appointment_date, a.appointment_time, hoy),
      etiqueta: haceCuanto(a.created_at, ahora),
    });
  }

  // 2. Cancelaciones recientes
  for (const a of nuevas) {
    if (a.status !== "cancelled") continue;
    agregar(a, {
      id: `Dcancel_${a.id}`, tipo: "cancelacion", grupo: "actividad",
      cuando: "",
      etiqueta: haceCuanto(a.created_at, ahora),
    });
  }

  const vigentes = proximas
    .filter(a => VIGENTES.has(a.status ?? "") && a.appointment_date >= hoy && a.appointment_date <= limite)
    .sort(porFechaYHora);
  const faltan = (a: CitaAviso) => minutosDeHora(a.appointment_time) - ahoraMin;

  // 3. Sin confirmar: sale 2 h antes, no para todas las del día.
  for (const a of vigentes) {
    if (a.status !== "pending" || a.appointment_date !== hoy) continue;
    const m = faltan(a);
    if (!(m >= 0 && m <= MIN_SIN_CONFIRMAR)) continue;
    agregar(a, {
      id: `B_${a.id}`, tipo: "sin_confirmar", grupo: "urgente",
      cuando: cuandoCorto(a.appointment_date, a.appointment_time, hoy),
      etiqueta: enCuanto(m),
    });
  }

  // 4. Por presentarse: confirmada y a 3 h o menos.
  for (const a of vigentes) {
    if (a.status !== "confirmed" || a.appointment_date !== hoy) continue;
    const m = faltan(a);
    if (!(m >= 0 && m <= MIN_POR_PRESENTARSE)) continue;
    agregar(a, {
      id: `A_${a.id}`, tipo: "inasistencia", grupo: "urgente",
      cuando: cuandoCorto(a.appointment_date, a.appointment_time, hoy),
      etiqueta: enCuanto(m),
    });
  }

  // 5. Sin profesional: las 4 más próximas (el tope se aplica antes de
  //    descartar las que ya generaron otro aviso, como en el portal).
  for (const a of vigentes.filter(x => !x.professional_id).slice(0, MAX_SIN_PROFESIONAL)) {
    agregar(a, {
      id: `C_${a.id}`, tipo: "sin_profesional", grupo: "accion",
      cuando: cuandoCorto(a.appointment_date, a.appointment_time, hoy),
      etiqueta: a.appointment_date === hoy ? "Hoy" : "Próxima",
    });
  }

  return lista;
}

/** Avisos por grupo, en el orden Urgente → Requiere acción → Actividad reciente (sin grupos vacíos). */
export function agruparAvisos<T extends Pick<Aviso, "grupo">>(avisos: T[]): { grupo: GrupoAviso; titulo: string; avisos: T[] }[] {
  return ORDEN_GRUPOS
    .map(grupo => ({ grupo, titulo: NOMBRE_GRUPO[grupo], avisos: avisos.filter(a => a.grupo === grupo) }))
    .filter(g => g.avisos.length > 0);
}

// ─── Leídas y descartadas (por dispositivo y por negocio) ────────────────────
// El portal guarda los descartados en localStorage y los poda a los que siguen
// en la lista. Aquí no se poda por la lista actual: al cambiar de sede los
// avisos de la otra desaparecen un rato y volverían como no leídos. Se poda
// por antigüedad y con tope de cantidad, para que no crezca sin fin.

/** id del aviso → cuándo se marcó (ms). */
export type Marcas = Record<string, number>;
export type EstadoAvisos = { leidas: Marcas; descartadas: Marcas };

export const ESTADO_AVISOS_VACIO: EstadoAvisos = { leidas: {}, descartadas: {} };
/** Un aviso vive como mucho 8 días (sin profesional de hoy a hoy + 7): 10 días sobra. */
export const DIAS_MARCAS = 10;
export const MAX_MARCAS = 300;

/** Quita las marcas de hace más de `dias` y deja las `max` más recientes. */
export function podarMarcas(marcas: Marcas, ahoraMs: number, max = MAX_MARCAS, dias = DIAS_MARCAS): Marcas {
  const corte = ahoraMs - dias * 24 * 60 * 60 * 1000;
  const vivas = Object.entries(marcas ?? {})
    .filter(([id, t]) => typeof id === "string" && id.length > 0 && Number.isFinite(t) && t >= corte)
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(0, max));
  return Object.fromEntries(vivas);
}

export function podarEstado(e: EstadoAvisos, ahoraMs: number): EstadoAvisos {
  return { leidas: podarMarcas(e.leidas, ahoraMs), descartadas: podarMarcas(e.descartadas, ahoraMs) };
}

function marcasDe(v: unknown): Marcas {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Marcas = {};
  for (const [id, t] of Object.entries(v as Record<string, unknown>)) {
    if (typeof t === "number" && Number.isFinite(t)) out[id] = t;
  }
  return out;
}

/** Lee lo guardado en AsyncStorage. Cualquier cosa rara (o nada) es un estado vacío. */
export function leerEstadoAvisos(texto: string | null | undefined): EstadoAvisos {
  if (!texto) return { leidas: {}, descartadas: {} };
  try {
    const v = JSON.parse(texto) as { leidas?: unknown; descartadas?: unknown } | null;
    return { leidas: marcasDe(v?.leidas), descartadas: marcasDe(v?.descartadas) };
  } catch {
    return { leidas: {}, descartadas: {} };
  }
}

export function marcar(e: EstadoAvisos, cual: keyof EstadoAvisos, ids: string[], ahoraMs: number): EstadoAvisos {
  if (ids.length === 0) return e;
  const nuevas = { ...e[cual] };
  for (const id of ids) nuevas[id] = ahoraMs;
  return podarEstado({ ...e, [cual]: nuevas }, ahoraMs);
}

export type AvisoVisible = Aviso & { leido: boolean };

function tiene(m: Marcas, id: string): boolean {
  return Object.prototype.hasOwnProperty.call(m, id);
}

/** Lo que muestra la campana: sin los descartados, con su marca de leído, y cuántos faltan por leer. */
export function avisosVisibles(avisos: Aviso[], estado: EstadoAvisos): { visibles: AvisoVisible[]; noLeidos: number } {
  const visibles = avisos
    .filter(a => !tiene(estado.descartadas, a.id))
    .map(a => ({ ...a, leido: tiene(estado.leidas, a.id) }));
  return { visibles, noLeidos: visibles.filter(a => !a.leido).length };
}
