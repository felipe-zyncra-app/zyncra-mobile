/**
 * Política de mora: cuándo un negocio está en gracia y cuándo se bloquea.
 *
 * Gemelo de la sección "Política de mora" de src/lib/plans.ts en el repo web
 * (Zapp). El panel web, Hanna, la reserva pública y el cron de facturación
 * usan esas funciones; esta app tiene que cortar el mismo día que ellos. Si
 * cambias las reglas aquí, cámbialas allá.
 */

/** Días ANTES del vencimiento en que empieza a mostrarse la cuenta regresiva. */
export const BILLING_WARNING_DAYS = 5;
/** Días DESPUÉS del vencimiento antes de bloquear la cuenta por falta de pago. */
export const BILLING_GRACE_DAYS = 5;

/**
 * Hasta el 2026-09-29 una prueba vencida pasaba a "overdue" y ahí se quedaba
 * para siempre: el cron anclaba la mora en current_period_end, que una prueba
 * nunca pagada no tiene. A esos negocios no se les bloquea de golpe: su gracia
 * corre desde esta fecha y no desde el fin de la prueba.
 */
export const TRIAL_LAPSE_GRACE_FROM = "2026-09-29";

/** Lo mínimo de saas_subscriptions que decide el vencimiento y el bloqueo. */
export interface SubscriptionTiming {
  status: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  /** amount > 0. Una suscripción de cortesía (amount 0) nunca entra en mora. */
  is_paid: boolean;
}

function utcDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Día (YYYY-MM-DD, UTC como el cron) en que vence lo que el negocio debe: el
 * fin de la prueba mientras está en prueba y el fin del período pagado
 * después. Una prueba que venció sin pagarse no tiene current_period_end, así
 * que en overdue / suspended su vencimiento sigue siendo el fin de la prueba.
 */
export function billingAnchorDay(sub: Omit<SubscriptionTiming, "is_paid">): string | null {
  if (sub.status === "trial") return utcDay(sub.trial_ends_at);
  if (sub.current_period_end) return utcDay(sub.current_period_end);
  return sub.status === "active" ? null : utcDay(sub.trial_ends_at);
}

/** Día desde el que corren los días de gracia (ver TRIAL_LAPSE_GRACE_FROM). */
export function graceStartDay(sub: Omit<SubscriptionTiming, "is_paid">): string | null {
  const anchor = billingAnchorDay(sub);
  if (!anchor) return null;
  if (!sub.current_period_end && anchor < TRIAL_LAPSE_GRACE_FROM) return TRIAL_LAPSE_GRACE_FROM;
  return anchor;
}

/** Días calendario (UTC) desde `day` hasta hoy: 0 = hoy, negativo = falta. */
export function daysSinceDay(day: string, now: Date = new Date()): number {
  return Math.floor((Date.parse(now.toISOString().slice(0, 10)) - Date.parse(day)) / 86_400_000);
}

/** Días de gracia que le quedan (puede ser ≤ 0), o null si no está en mora. */
export function graceDaysLeft(sub: SubscriptionTiming, now: Date = new Date()): number | null {
  if (!sub.is_paid) return null;
  const start = graceStartDay(sub);
  if (!start) return null;
  const since = daysSinceDay(start, now);
  return since < 0 ? null : BILLING_GRACE_DAYS - since;
}

/**
 * true si el negocio tiene que estar bloqueado por falta de pago.
 *
 * Manda el estado que deja el cron ("suspended" / "cancelled"). Las fechas son
 * respaldo por si el cron no corrió: bloquean cuando ya pasó un día ENTERO
 * desde que debió suspender (left < 0), igual que el panel web.
 */
export function isSubscriptionBlocked(sub: SubscriptionTiming | null | undefined, now: Date = new Date()): boolean {
  if (!sub || !sub.is_paid) return false;
  if (sub.status === "suspended" || sub.status === "cancelled") return true;
  const left = graceDaysLeft(sub, now);
  return left !== null && left < 0;
}
