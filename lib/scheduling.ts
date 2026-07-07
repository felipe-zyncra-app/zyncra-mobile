import { supabase } from "./supabase";

export function timeToMins(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function minsToTime(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

export function generateSlotsForDay(start: string, end: string, duration: number): string[] {
  const startMins = timeToMins(start);
  const endMins = timeToMins(end);
  const slots: string[] = [];
  for (let m = startMins; m + duration <= endMins; m += 60)
    slots.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:00`);
  return slots;
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

export type DayHours = { open: boolean; start: string; end: string };

// Horario efectivo de un día: el propio del profesional (si tiene) tiene prioridad sobre el
// del negocio — mismo criterio que la reserva online del web (getEffectiveHours).
// Formato canónico: claves "0".."6" de Date.getDay() con {open,start,end}. Se acepta el
// formato legado del editor móvil ({mon..sun} con {enabled}) por si quedó guardado así.
const LEGACY_DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function effectiveDayHours(date: Date, businessSchedule: any, proSchedule: any): DayHours | null {
  const dow = date.getDay();
  const pd = proSchedule?.[String(dow)] ?? proSchedule?.[LEGACY_DAY_KEYS[dow]];
  if (pd != null) {
    return { open: !!(pd.open ?? pd.enabled), start: pd.start ?? "09:00", end: pd.end ?? "18:00" };
  }
  const bd = businessSchedule?.[String(dow)];
  return bd ? { open: !!bd.open, start: bd.start ?? "09:00", end: bd.end ?? "18:00" } : null;
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
