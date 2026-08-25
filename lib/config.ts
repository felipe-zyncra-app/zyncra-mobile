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
    /** Envío humano desde la bandeja de chats. Corre server-side porque
     *  usa el access_token de WhatsApp (nunca debe vivir en el dispositivo). */
    whatsappSend: `${WEB_URL}/api/whatsapp/send`,
  },
  urls: {
    booking: `${WEB_URL}/book/`,
    review: `${WEB_URL}/review/`,
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
