import { supabase } from "./supabase";

const SUPABASE_URL = "https://bwmwuzwhinnzkjicdzot.supabase.co";

export const Config = {
  supabaseUrl: SUPABASE_URL,
  edgeFunctions: {
    createStaffUser: `${SUPABASE_URL}/functions/v1/create-staff-user`,
    sendPush: `${SUPABASE_URL}/functions/v1/send-push`,
    deleteAccount: `${SUPABASE_URL}/functions/v1/delete-account`,
  },
  api: {
    factus: "https://zyncra.app/api/factus",
    hannaCampaigns: "https://zyncra.app/api/admin/hanna-campaigns",
    hannaChat: "https://zyncra.app/api/admin/hanna-chat",
  },
  urls: {
    booking: "https://zyncra.app/book/",
    review: "https://zyncra.app/review/",
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
