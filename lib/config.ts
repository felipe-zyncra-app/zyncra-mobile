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
    /** Guarda la aceptación de los términos en legal_acceptances. Mismo
     *  endpoint que el registro del portal (src/app/api/auth/accept-terms).
     *  Body { tenantId, userId, document, version }. No pide auth: va con
     *  rate-limit por IP y comprueba que el negocio sea de ese usuario. */
    acceptTerms: `${WEB_URL}/api/auth/accept-terms`,
    /** Verificación del correo en el registro. Mismos endpoints que el portal,
     *  así el diseño del correo y la duración del código salen de un solo sitio.
     *  Públicos: no piden auth, van con rate-limit por IP. */
    sendOtp: `${WEB_URL}/api/auth/send-otp`,
    verifyOtp: `${WEB_URL}/api/auth/verify-otp`,
    /** Correo al cliente al crear, cambiar o cancelar una cita. Mismo endpoint
     *  que el panel (src/app/api/send-confirmation): con sesión, body
     *  { type, manageToken }; el servidor saca de la base todo lo demás. */
    sendConfirmation: `${WEB_URL}/api/send-confirmation`,
    /** Nómina del equipo: resumen, liquidar, liquidaciones, anular. El cálculo
     *  vive solo en el servidor (src/app/api/nomina) para que web y app
     *  muestren lo mismo. Ver lib/nomina.ts. */
    nomina: `${WEB_URL}/api/nomina`,
  },
  urls: {
    booking: `${WEB_URL}/book/`,
    review: `${WEB_URL}/review/`,
    /** Mi suscripción en el portal (checkout Wompi). Solo se enlaza desde
     *  Android: en iOS la 3.1.1 prohíbe llevar a un pago externo. */
    billing: `${WEB_URL}/admin/billing`,
    /** Páginas legales del portal (src/app/(zyncra)/privacidad y /terminos).
     *  Apple 5.1.1(i) exige el enlace a la política dentro de la app. */
    privacidad: `${WEB_URL}/privacidad`,
    terminos: `${WEB_URL}/terminos`,
    /** Marketing WhatsApp del portal: conectar el número y crear o aprobar
     *  plantillas se hace allá (Meta no deja hacerlo desde la app). */
    portalWhatsapp: `${WEB_URL}/admin/whatsapp`,
    soporte: `${WEB_URL}/soporte`,
    /** Instrucciones públicas para eliminar la cuenta (la ficha de Play la pide). */
    eliminarCuenta: `${WEB_URL}/eliminar-cuenta`,
    /** Destino del correo de recuperación: supabase.auth.resetPasswordForEmail(email,
     *  { redirectTo: Config.urls.restablecerContrasena }). Es la misma página que
     *  usa el "¿Olvidaste tu contraseña?" del portal (src/app/(auth)/reset-password). */
    restablecerContrasena: `${WEB_URL}/reset-password`,
  },
  /** Topes de authedFetch por tipo de llamada (ms). */
  timeouts: {
    /** Por defecto: envíos, edge functions, facturación. */
    normal: 45_000,
    /** Chat de Hanna y envío de WhatsApp: si no responde en esto, algo se cayó. */
    chat: 25_000,
    /** Copiloto de Hanna (POST a hanna-chat con herramientas). El servidor
     *  corta a los 30 s (maxDuration); con `chat` (25 s) se abortaban
     *  respuestas válidas que llegaban entre los 25 y los 30 s. */
    copiloto: 40_000,
    /** Generación de campañas de Hanna (el servidor corta a los 120 s). */
    campanas: 130_000,
  },
} as const;

export type AuthedFetchOptions = RequestInit & {
  /** Tope en ms (default Config.timeouts.normal). Al vencer lanza un Error con name "TimeoutError". */
  timeoutMs?: number;
};

/**
 * fetch con el token de la sesión y con tope de tiempo. Sin tope, en Android
 * (OkHttp sin timeouts) un corte a mitad de la petición dejaba "Enviando…" o
 * "consultando tus datos…" colgados para siempre (COM-12).
 */
export async function authedFetch(url: string, options: AuthedFetchOptions = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("No active session");

  const { timeoutMs = Config.timeouts.normal, signal, headers, ...rest } = options;
  const ctrl = new AbortController();
  let vencido = false;
  const timer = setTimeout(() => { vencido = true; ctrl.abort(); }, timeoutMs);
  // Respetar también la cancelación del llamador.
  const alCancelar = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", alCancelar);
  }

  try {
    return await fetch(url, {
      ...rest,
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        ...(headers as Record<string, string> | undefined),
      },
    });
  } catch (e) {
    if (vencido) {
      const err = new Error("El servidor tardó demasiado en responder. Inténtalo de nuevo.");
      err.name = "TimeoutError";
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", alCancelar);
  }
}
