import { supabase } from "./supabase";

const SUPABASE_URL = "https://bwmwuzwhinnzkjicdzot.supabase.co";
const WEB_URL = "https://www.zyncra.app";

export const Config = {
  supabaseUrl: SUPABASE_URL,
  edgeFunctions: {
    createStaffUser: `${SUPABASE_URL}/functions/v1/create-staff-user`,
    deleteAccount: `${SUPABASE_URL}/functions/v1/delete-account`,
  },
  // Host canónico CON www: zyncra.app responde 308 hacia www y un redirect
  // cross-host hace que varios clientes HTTP (OkHttp/Android) descarten el
  // header Authorization — rompería authedFetch. Además evita un salto extra.
  api: {
    factus: `${WEB_URL}/api/factus`,
    hannaCampaigns: `${WEB_URL}/api/admin/hanna-campaigns`,
    hannaChat: `${WEB_URL}/api/admin/hanna-chat`,
    /** Envío humano desde la bandeja de chats. Corre server-side porque
     *  usa el access_token de WhatsApp (nunca debe vivir en el dispositivo). */
    whatsappSend: `${WEB_URL}/api/whatsapp/send`,
    /** Crea la fila de saas_subscriptions con el trial. Es el MISMO endpoint
     *  que usa el registro del portal, así que los días de prueba y el plan
     *  salen de una sola fuente. No pide auth: va con rate-limit por IP. */
    activateTrial: `${WEB_URL}/api/auth/activate-trial`,
  },
  urls: {
    booking: `${WEB_URL}/book/`,
    review: `${WEB_URL}/review/`,
    /** Mi suscripción en el portal (checkout Wompi). Solo se enlaza desde
     *  Android: en iOS la 3.1.1 prohíbe llevar a un pago externo. */
    billing: `${WEB_URL}/admin/billing`,
  },
} as const;

export async function authedFetch(url: string, options: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("No active session");

  return fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      ...options.headers,
    },
  });
}
