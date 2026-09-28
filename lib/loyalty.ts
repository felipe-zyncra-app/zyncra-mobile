/**
 * Fidelización — port de App (web) src/lib/loyalty.ts. Mantener en sync.
 *
 * "Visita" = cita COMPLETADA (esVisita). Antes contaba toda cita no cancelada
 * con fecha de hoy o anterior: un cliente con 5 inasistencias (no_show) ganaba
 * el corte gratis, y una cita pendiente de hoy a las 6 PM ya sumaba a las
 * 9 AM. Es el mismo criterio que la RPC client_visit_count de la migración.
 * (El CRM web sigue con el criterio viejo: hay que cambiarlo allá también.)
 */

import { supabase } from "./supabase";
import { ErrorDB, esFuncionInexistente } from "./db";

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

/** ¿Esta cita cuenta como visita? Solo las completadas. */
export function esVisita(a: { status?: string | null }): boolean {
  return a.status === "completed";
}

export function contarVisitas(citas: { status?: string | null }[]): number {
  return citas.reduce((n, a) => n + (esVisita(a) ? 1 : 0), 0);
}

export function describeReward(r: Pick<LoyaltyReward, "reward_type" | "reward_value">, serviceName?: string | null): string {
  switch (r.reward_type) {
    case "free_service":     return serviceName ? `${serviceName} gratis` : "Servicio gratis";
    case "discount_percent": return `${r.reward_value ?? 0}% de descuento`;
    case "discount_fixed":   return `$${Number(r.reward_value ?? 0).toLocaleString("es-CO")} de descuento`;
    default:                 return "Beneficio especial";
  }
}

export function getRewardStatus(reward: LoyaltyReward, totalVisits: number, redemptions: Pick<LoyaltyRedemption, "reward_id">[]): RewardStatus {
  const redeemedCount = redemptions.filter(r => r.reward_id === reward.id).length;
  const req = Math.max(1, Math.floor(reward.visits_required) || 1);

  if (reward.repeats) {
    const earnedCount = Math.floor(totalVisits / req);
    const available = Math.max(0, earnedCount - redeemedCount);
    const progressCurrent = totalVisits % req;
    return {
      reward, earnedCount, redeemedCount, available,
      progressCurrent, progressTarget: req,
      remaining: available > 0 ? 0 : req - progressCurrent,
    };
  }

  const earnedCount = totalVisits >= req ? 1 : 0;
  const available = Math.max(0, earnedCount - redeemedCount);
  return {
    reward, earnedCount, redeemedCount, available,
    progressCurrent: Math.min(totalVisits, req),
    progressTarget: req,
    remaining: available > 0 ? 0 : Math.max(0, req - totalVisits),
  };
}

/** Todas las recompensas activas de un cliente, evaluadas contra sus visitas. */
export function getClientRewardStatuses(rewards: LoyaltyReward[], totalVisits: number, redemptions: Pick<LoyaltyRedemption, "reward_id">[]): RewardStatus[] {
  return rewards.filter(r => r.active).map(r => getRewardStatus(r, totalVisits, redemptions.filter(rd => rd.reward_id === r.id)));
}

// ─── Conteo de visitas en el servidor ────────────────────────────────────────

/**
 * Visitas (citas completadas) del cliente en TODO el negocio.
 *
 * El staff solo puede leer sus propias citas (RLS), así que contando en el
 * teléfono un cliente con 4 visitas con Ana y 2 con Luis tenía 2 para Luis.
 * La migración agrega client_visit_count(p_client_id), que cuenta todas sin
 * exponer la agenda de los demás. Mientras no exista se cuenta lo que la RLS
 * deja ver: para el dueño es todo; para el staff solo sus citas, y
 * `viaRespaldo` lo avisa para que la pantalla lo diga. Contar de menos nunca
 * regala un premio de más (las entregas sí se ven todas).
 */
export async function visitasDelCliente(clientId: string): Promise<{ visitas: number; viaRespaldo: boolean }> {
  const rpc = await supabase.rpc("client_visit_count", { p_client_id: clientId });
  if (!rpc.error) return { visitas: Number(rpc.data) || 0, viaRespaldo: false };
  if (!esFuncionInexistente(rpc.error)) throw new ErrorDB(rpc.error, "No se pudieron contar las visitas");

  const res = await supabase
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("status", "completed");
  if (res.error) throw new ErrorDB(res.error, "No se pudieron contar las visitas");
  return { visitas: res.count ?? 0, viaRespaldo: true };
}

// ─── Entregas idempotentes ───────────────────────────────────────────────────

/** Hash de 128 bits (cyrb128). No es criptográfico: solo reparte bien. */
function hash128(texto: string): [number, number, number, number] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < texto.length; i++) {
    const k = texto.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4; h2 ^= h1; h3 ^= h1; h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/**
 * Id FIJO de la n-ésima entrega de una recompensa a un cliente. Dos toques
 * seguidos, o el admin y el staff a la vez, calculan el MISMO id para la
 * misma entrega: el segundo insert choca con la clave primaria (23505) en vez
 * de registrar un premio de más. No necesita migración.
 */
export function idDeEntrega(clientId: string, rewardId: string, numero: number): string {
  const h = hash128(`zyncra-fidelizacion:${clientId}:${rewardId}:${numero}`)
    .map(x => x.toString(16).padStart(8, "0"))
    .join("");
  // Formato uuid (versión 8 = "a medida", variante RFC 4122).
  const v = `8${h.slice(13, 16)}`;
  const variante = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${v}-${variante}-${h.slice(20, 32)}`;
}

export type ResultadoEntrega =
  | { ok: true; visitas: number }
  | { ok: false; motivo: "SIN_PREMIO" | "YA_ENTREGADA"; mensaje: string };

/**
 * Registra la entrega de una recompensa SOLO si el cliente la tiene
 * disponible con datos frescos del servidor (visitas y entregas leídas en el
 * momento, no las de la pantalla), con un id fijo por entrega (idDeEntrega).
 * Lanza ErrorDB si falla la red o la base.
 */
export async function entregarRecompensa(p: {
  tenantId: string;
  clientId: string;
  reward: LoyaltyReward;
}): Promise<ResultadoEntrega> {
  let desfase = 0;
  let conteoPrevio: number | null = null;
  for (let intento = 0; intento < 4; intento++) {
    const [{ visitas }, entregas] = await Promise.all([
      visitasDelCliente(p.clientId),
      supabase.from("loyalty_redemptions").select("id", { count: "exact", head: true })
        .eq("client_id", p.clientId).eq("reward_id", p.reward.id),
    ]);
    if (entregas.error) throw new ErrorDB(entregas.error, "No se pudo revisar la recompensa");
    const entregadas = entregas.count ?? 0;
    if (conteoPrevio !== null) {
      // El id chocó (23505). Si el conteo SUBIÓ, otro toque u otro dispositivo
      // registró justo ESTA entrega: no se registra otra (antes seguía con la
      // siguiente y, con dos premios ganados, un doble toque entregaba dos).
      if (entregadas > conteoPrevio) {
        return { ok: false, motivo: "YA_ENTREGADA", mensaje: "Esta recompensa se acaba de registrar desde otro dispositivo." };
      }
      // Si no subió, hay una entrega vieja con ese número (se borró otra del
      // medio): prueba el siguiente.
      desfase++;
    }
    const st = getRewardStatus(p.reward, visitas, Array.from({ length: entregadas }, () => ({ reward_id: p.reward.id })));
    if (st.available <= 0) {
      return intento === 0
        ? { ok: false, motivo: "SIN_PREMIO", mensaje: "El cliente no tiene esta recompensa disponible (ya se entregó o le faltan visitas)." }
        : { ok: false, motivo: "YA_ENTREGADA", mensaje: "Esta recompensa se acaba de registrar desde otro dispositivo." };
    }
    conteoPrevio = entregadas;

    const { error } = await supabase.from("loyalty_redemptions").insert({
      id: idDeEntrega(p.clientId, p.reward.id, entregadas + 1 + desfase),
      tenant_id: p.tenantId,
      client_id: p.clientId,
      reward_id: p.reward.id,
      visits_at_redemption: visitas,
    });
    if (!error) return { ok: true, visitas };
    if ((error as { code?: string }).code !== "23505") throw new ErrorDB(error, "No se pudo registrar la entrega");
  }
  return { ok: false, motivo: "YA_ENTREGADA", mensaje: "Esta recompensa ya quedó registrada." };
}
