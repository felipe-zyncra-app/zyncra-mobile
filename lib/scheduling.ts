import { supabase } from "./supabase";

export function timeToMins(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function minsToTime(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

export const DEFAULT_SLOT_INTERVAL = 30;

/** Igual que el web (src/lib/datetime.ts): fuera de 5–480 min se usa el default. */
export function normalizeSlotInterval(v: any): number {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) && n >= 5 && n <= 480 ? n : DEFAULT_SLOT_INTERVAL;
}

/**
 * Horas de inicio válidas de un día.
 *
 * Antes avanzaba de 60 en 60 min fijos e ignoraba el descanso: un negocio que
 * atiende cada 90 min veía cupos cada hora, y uno que almuerza de 12:30 a 1:00
 * veía ofrecidas las 12:00 y la 1:00 con el servicio encima del almuerzo. El
 * paso ahora sale de `tenants.settings.slot_interval_min` y el descanso corta
 * la grilla, igual que en la web y que en la reserva pública.
 *
 * La grilla VUELVE A ANCLAR al terminar el descanso: con 90 min desde las
 * 09:00 y almuerzo 12:30–13:00 da 09:00, 10:30, 12:00 · 13:00, 14:30, 16:00,
 * 17:30. Sin re-anclar saldría 13:30 y el negocio perdería la primera hora de
 * la tarde.
 */
export function generateSlotsForDay(
  day: DayHours,
  duration: number,
  intervalMin: number = DEFAULT_SLOT_INTERVAL,
): string[] {
  const step     = normalizeSlotInterval(intervalMin);
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
      // …y no puede quedar montado sobre el descanso.
      if (hasBreak && m < be! && bs! < m + duration) continue;
      slots.push(minsToTime(m));
    }
  }
  return slots;
}

/** ¿El servicio [m, m+dur) pisa el descanso del día? */
export function overlapsDayBreak(m: number, duration: number, day: DayHours | null | undefined): boolean {
  if (!day?.break_start || !day?.break_end) return false;
  const bs = timeToMins(day.break_start), be = timeToMins(day.break_end);
  return m < be && bs < m + duration;
}

export function buildWeek(base: Date): Date[] {
  const start = new Date(base);
  start.setDate(start.getDate() - start.getDay() + 1);
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

export type DayHours = {
  open: boolean;
  start: string;
  end: string;
  /** Descanso del día (almuerzo). Null o ausente = sin descanso. */
  break_start?: string | null;
  break_end?: string | null;
};

// Horario efectivo de un día: el propio del profesional (si tiene) tiene prioridad sobre el
// del negocio — mismo criterio que la reserva online del web (getEffectiveHours).
// Formato canónico: claves "0".."6" de Date.getDay() con {open,start,end}. Se acepta el
// formato legado del editor móvil ({mon..sun} con {enabled}) por si quedó guardado así.
const LEGACY_DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function effectiveDayHours(date: Date, businessSchedule: any, proSchedule: any): DayHours | null {
  const dow = date.getDay();
  const bd = businessSchedule?.[String(dow)];
  const pd = proSchedule?.[String(dow)] ?? proSchedule?.[LEGACY_DAY_KEYS[dow]];
  if (pd != null) {
    return {
      open:  !!(pd.open ?? pd.enabled),
      start: pd.start ?? "09:00",
      end:   pd.end ?? "18:00",
      // El descanso propio del profesional manda; si no tiene, hereda el del
      // negocio — mismo criterio que /api/ai/availability en la web. Sin este
      // respaldo, un profesional con horario propio se quedaba sin almuerzo.
      break_start: pd.break_start ?? bd?.break_start ?? null,
      break_end:   pd.break_end   ?? bd?.break_end   ?? null,
    };
  }
  return bd
    ? {
        open:  !!bd.open,
        start: bd.start ?? "09:00",
        end:   bd.end ?? "18:00",
        break_start: bd.break_start ?? null,
        break_end:   bd.break_end ?? null,
      }
    : null;
}

// Re-verifica en el servidor que el horario siga libre justo antes de guardar:
// los slots se calcularon al abrir el paso y otro dispositivo pudo ocuparlo mientras tanto.
// Si la consulta falla se asume libre — el insert tiene su propio manejo de error.
export async function hasSlotConflict(
  professionalId: string,
  dateStr: string,
  startMins: number,
  durationMins: number,
  excludeApptId?: string,
): Promise<boolean> {
  let q = supabase
    .from("appointments")
    .select("appointment_time, services(duration_minutes)")
    .eq("professional_id", professionalId)
    .eq("appointment_date", dateStr)
    .neq("status", "cancelled");
  if (excludeApptId) q = q.neq("id", excludeApptId);
  const { data } = await q;
  const newEnd = startMins + durationMins;
  return (data ?? []).some((a: any) => {
    const start = timeToMins(String(a.appointment_time).slice(0, 5));
    const end = start + Number((Array.isArray(a.services) ? a.services[0] : a.services)?.duration_minutes ?? 60);
    return startMins < end && start < newEnd;
  });
}
