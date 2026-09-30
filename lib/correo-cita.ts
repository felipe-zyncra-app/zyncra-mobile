import { supabase } from "./supabase";
import { Config, authedFetch } from "./config";

/**
 * Correo al cliente cuando se crea, se cambia o se cancela una cita.
 *
 * Hasta 2026-09-30 la app no mandaba ninguno: el panel web llama
 * /api/send-confirmation después de guardar (NewAppointmentModal y el
 * calendario) y la app no, así que a los clientes de las citas agendadas
 * desde el teléfono nunca les llegaba la confirmación (lo notó Imperio
 * Capilar). Es el MISMO endpoint del panel: el servidor busca la cita por
 * manage_token con la sesión de quien llama, exige que pertenezca al negocio
 * y saca de la base el correo, los nombres, la fecha y la marca. Aquí solo
 * se dice qué pasó y con qué cita.
 *
 * Nunca bloquea ni avisa al usuario: la cita ya quedó guardada y un correo
 * que no sale no la deshace (igual que el panel web). Los fallos solo se
 * registran en el log.
 */
export type TipoCorreoCita = "confirmation" | "modification" | "cancellation";

export type ResultadoCorreoCita =
  | "enviado"
  /** El cliente no tiene correo: normal donde el correo es opcional (Imperio). */
  | "sin-correo"
  | "sin-token"
  | "error";

/** Traduce la respuesta del endpoint. Separada para poder probarla. */
export function leerRespuestaCorreo(status: number, cuerpo: unknown): ResultadoCorreoCita {
  if (status >= 200 && status < 300) return "enviado";
  const code = (cuerpo as { code?: unknown } | null)?.code;
  if (status === 400 && code === "no_email") return "sin-correo";
  return "error";
}

export async function enviarCorreoCita(tipo: TipoCorreoCita, citaId: string): Promise<ResultadoCorreoCita> {
  try {
    const { data, error } = await supabase
      .from("appointments").select("manage_token").eq("id", citaId).maybeSingle();
    const token = (data as { manage_token?: string | null } | null)?.manage_token;
    if (error || !token) {
      console.warn(`[correo-cita] Sin manage_token para la cita ${citaId}: ${error?.message ?? "vacío"}`);
      return "sin-token";
    }
    const res = await authedFetch(Config.api.sendConfirmation, {
      method: "POST",
      body: JSON.stringify({ type: tipo, manageToken: token }),
    });
    const cuerpo = await res.json().catch(() => null);
    const resultado = leerRespuestaCorreo(res.status, cuerpo);
    if (resultado === "error") {
      console.warn(`[correo-cita] ${tipo} de la cita ${citaId} respondió ${res.status}`);
    }
    return resultado;
  } catch (e) {
    console.warn(`[correo-cita] ${tipo} de la cita ${citaId} falló: ${e instanceof Error ? e.message : String(e)}`);
    return "error";
  }
}

/** ¿Cambió algo que el cliente tiene que saber? Mismo criterio que el calendario web. */
export function cambioAvisable(
  antes: { appointment_date: string; appointment_time: string; service_id: string | null; professional_id: string | null },
  despues: { appointment_date: string; appointment_time: string; service_id: string | null; professional_id: string | null },
): boolean {
  return antes.appointment_date !== despues.appointment_date
    || antes.appointment_time.slice(0, 5) !== despues.appointment_time.slice(0, 5)
    || antes.service_id !== despues.service_id
    || antes.professional_id !== despues.professional_id;
}
