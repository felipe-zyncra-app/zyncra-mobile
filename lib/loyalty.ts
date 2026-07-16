/**
 * Fidelización — port de App (web) src/lib/loyalty.ts. Mantener en sync.
 * "Visitas" = citas no canceladas con fecha ya pasada (misma definición
 * que el CRM del panel web).
 */

export interface LoyaltyReward {
  id: string;
  tenant_id: string;
  label: string;
  visits_required: number;
  repeats: boolean;
  reward_type: "free_service" | "discount_percent" | "discount_fixed" | "other";
  reward_value: number | null;
  service_id: string | null;
  active: boolean;
  created_at: string;
}

export interface LoyaltyRedemption {
  id: string;
  tenant_id: string;
  client_id: string;
  reward_id: string;
  visits_at_redemption: number;
  note: string | null;
  redeemed_at: string;
}

export interface RewardStatus {
  reward: LoyaltyReward;
  earnedCount: number;
  redeemedCount: number;
  /** Instancias ganadas y aún no entregadas — 0 si no hay ninguna disponible. */
  available: number;
  progressCurrent: number;
  progressTarget: number;
  /** Visitas que faltan para el próximo hito (0 si ya está disponible). */
  remaining: number;
}

export function describeReward(r: Pick<LoyaltyReward, "reward_type" | "reward_value">, serviceName?: string | null): string {
  switch (r.reward_type) {
    case "free_service":     return serviceName ? `${serviceName} gratis` : "Servicio gratis";
    case "discount_percent": return `${r.reward_value ?? 0}% de descuento`;
    case "discount_fixed":   return `$${Number(r.reward_value ?? 0).toLocaleString("es-CO")} de descuento`;
    default:                 return "Beneficio especial";
  }
}

export function getRewardStatus(reward: LoyaltyReward, totalVisits: number, redemptions: LoyaltyRedemption[]): RewardStatus {
  const redeemedCount = redemptions.filter(r => r.reward_id === reward.id).length;

  if (reward.repeats) {
    const earnedCount = Math.floor(totalVisits / reward.visits_required);
    const available = Math.max(0, earnedCount - redeemedCount);
    const progressCurrent = totalVisits % reward.visits_required;
    return {
      reward, earnedCount, redeemedCount, available,
      progressCurrent, progressTarget: reward.visits_required,
      remaining: available > 0 ? 0 : reward.visits_required - progressCurrent,
    };
  }

  const earnedCount = totalVisits >= reward.visits_required ? 1 : 0;
  const available = Math.max(0, earnedCount - redeemedCount);
  return {
    reward, earnedCount, redeemedCount, available,
    progressCurrent: Math.min(totalVisits, reward.visits_required),
    progressTarget: reward.visits_required,
    remaining: available > 0 ? 0 : Math.max(0, reward.visits_required - totalVisits),
  };
}

/** Todas las recompensas activas de un cliente, evaluadas contra sus visitas. */
export function getClientRewardStatuses(rewards: LoyaltyReward[], totalVisits: number, redemptions: LoyaltyRedemption[]): RewardStatus[] {
  return rewards.filter(r => r.active).map(r => getRewardStatus(r, totalVisits, redemptions.filter(rd => rd.reward_id === r.id)));
}
