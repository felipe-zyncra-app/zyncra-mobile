import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { AppState } from "react-native";
import { supabase } from "./supabase";
import { useAuth } from "./auth";

/**
 * Estado de la suscripción del negocio.
 *
 * La verdad vive en `saas_subscriptions`, la MISMA tabla que usan el panel web
 * y el cron de facturación (ZyncraSas_v1: api/cron/billing). Las columnas
 * `tenants.plan` / `tenants.plan_expires_at` están muertas — nadie las escribe.
 *
 * Se lee por RPC (`my_subscription_state`) y no con un select directo: la RLS
 * de la tabla solo deja leer al dueño, y el staff también tiene que enterarse.
 * La función es SECURITY DEFINER y devuelve únicamente estado y fechas — nunca
 * `wompi_card_token` ni el monto, que un colaborador no debe ver.
 *
 * Ciclo de vida (lo maneja el cron, no la app):
 *   trial ──(llega trial_ends_at)──▶ overdue ──(+5 días)──▶ suspended
 * En `overdue` la cuenta SIGUE funcionando: son los días de gracia. El bloqueo
 * real es `suspended`.
 */
export type SubStatus = "trial" | "active" | "overdue" | "suspended" | "cancelled";

/** Espejo de BILLING_WARNING_DAYS / BILLING_GRACE_DAYS en ZyncraSas_v1/src/lib/plans.ts. */
export const WARNING_DAYS = 5;
export const GRACE_DAYS = 5;

/** Aviso a mostrar antes del bloqueo, o null si no hay nada que advertir. */
export type SubscriptionNotice =
  | { kind: "trial-ending"; days: number }
  | { kind: "due-soon"; days: number }
  | { kind: "past-due"; days: number }
  | null;

type SubscriptionCtx = {
  status: SubStatus;
  /** true si la suscripción tiene cobro. Las de cortesía nunca se bloquean. */
  isPaid: boolean;
  trialEndsAt: string | null;
  /** Días para que termine la prueba (null si no está en trial). */
  trialDaysLeft: number | null;
  /** Días para el vencimiento del plan pago. Negativo = días de mora. */
  daysToDue: number | null;
  notice: SubscriptionNotice;
  /** Cuenta bloqueada por falta de pago. Misma regla que el panel web. */
  blocked: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
};

const DEFAULTS: SubscriptionCtx = {
  status: "trial",
  isPaid: false,
  trialEndsAt: null,
  trialDaysLeft: null,
  daysToDue: null,
  notice: null,
  blocked: false,
  loading: true,
  refresh: async () => {},
};

const SubscriptionContext = createContext<SubscriptionCtx>(DEFAULTS);

const daysFromNow = (iso: string) =>
  Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const { session, tenantId } = useAuth();
  // Se depende del id y no del objeto de sesión: Supabase crea una sesión
  // nueva en cada TOKEN_REFRESHED (cada hora) y eso dispararía una relectura
  // que no aporta nada.
  const userId = session?.user?.id ?? null;
  const [status, setStatus] = useState<SubStatus>("trial");
  const [isPaid, setIsPaid] = useState(false);
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);
  const [periodEnd, setPeriodEnd] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase.rpc("my_subscription_state");
    const row = Array.isArray(data) ? data[0] : data;

    // Sin fila no se bloquea a nadie: es lo mismo que hace el panel web
    // (subData null ⇒ "trial"). Cubre los negocios anteriores al cobro.
    setStatus((row?.status as SubStatus) ?? "trial");
    setIsPaid(!!row?.is_paid);
    setTrialEndsAt(row?.trial_ends_at ?? null);
    setPeriodEnd(row?.current_period_end ?? null);
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    refresh().finally(() => setLoading(false));
    // tenantId entra en las dependencias porque al registrarse el negocio se
    // crea DESPUÉS de la sesión: sin esto la primera lectura se quedaría con
    // el estado de un usuario que todavía no tenía suscripción.
  }, [userId, tenantId, refresh]);

  // Al volver a primer plano se relee el estado. Es lo que cierra el círculo
  // del pago: el dueño toca "Pagar mi plan", paga en el navegador y al regresar
  // a la app la cuenta ya está activa sin tener que reiniciarla. También
  // recoge la suspensión que hizo el cron mientras la app estaba en segundo
  // plano, sin esperar a un arranque en frío.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const trialDaysLeft =
    status === "trial" && trialEndsAt ? daysFromNow(trialEndsAt) : null;

  // Ancla del plan pago. Se cae a trial_ends_at porque una suscripción que pasó
  // de trial a overdue sin haber pagado nunca tiene current_period_end en null.
  const paidAnchor = periodEnd ? `${periodEnd}T00:00:00` : trialEndsAt;
  const isPaidStatus = status === "active" || status === "overdue" || status === "suspended";
  const daysToDue = isPaid && isPaidStatus && paidAnchor ? daysFromNow(paidAnchor) : null;

  // Espejo exacto de `showBlocked` en ZyncraSas_v1/src/app/admin/layout.tsx.
  // El guard de isPaid evita bloquear cuentas de cortesía o manuales.
  // Mientras carga nunca bloquea: no queremos un parpadeo de "cuenta
  // bloqueada" en cada arranque, y ante un fallo de red se falla abierto.
  const blocked = !loading && isPaid && (status === "suspended" || status === "cancelled");

  let notice: SubscriptionNotice = null;
  if (!loading && !blocked) {
    if (status === "trial" && trialDaysLeft !== null && trialDaysLeft <= WARNING_DAYS) {
      notice = { kind: "trial-ending", days: Math.max(0, trialDaysLeft) };
    } else if (isPaid && status === "overdue") {
      // En mora: lo que importa no es cuánto lleva vencido sino cuánto le
      // queda antes de que el cron lo suspenda.
      const overdue = daysToDue !== null ? Math.max(0, -daysToDue) : 0;
      notice = { kind: "past-due", days: Math.max(0, GRACE_DAYS - overdue) };
    } else if (isPaid && status === "active" && daysToDue !== null && daysToDue >= 0 && daysToDue <= WARNING_DAYS) {
      notice = { kind: "due-soon", days: daysToDue };
    }
  }

  return (
    <SubscriptionContext.Provider
      value={{ status, isPaid, trialEndsAt, trialDaysLeft, daysToDue, notice, blocked, loading, refresh }}
    >
      {children}
    </SubscriptionContext.Provider>
  );
}

export const useSubscription = () => useContext(SubscriptionContext);
