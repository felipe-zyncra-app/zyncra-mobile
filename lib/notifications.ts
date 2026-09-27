import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { supabase } from "./supabase";
import { fmt12 } from "./format";
import { fmtDia, hoyNegocio, instanteDe, zonaActiva } from "./tz";

/**
 * Notificaciones del dispositivo.
 *
 * DOS COSAS DISTINTAS
 *  · Push remoto: el portal (reserva pública, Hanna, /manage) manda "Nueva
 *    cita" al token guardado en tenants.push_token. Se registra DESPUÉS del
 *    login y al cambiar de cuenta (registrarPushDelDispositivo) y se borra del
 *    servidor al cerrar sesión (borrarPushTokenDelServidor), para que el
 *    teléfono no siga recibiendo nombres de clientes de otro negocio.
 *  · Recordatorios locales: avisos AL DUEÑO de sus próximas citas. No son el
 *    recordatorio al cliente (ese lo manda el servidor por WhatsApp con la
 *    plantilla de Ajustes → Recordatorios). Se programan en la hora del
 *    NEGOCIO, se cancelan si la cita ya no está vigente y al cerrar sesión.
 *
 * ANDROID: sin FCM configurado en Firebase (google-services.json en el build)
 * getExpoPushTokenAsync falla y no llega ningún push remoto. Es una acción
 * del dueño de la cuenta de Firebase/EAS, no se arregla desde el código.
 */

// Cómo se muestran con la app abierta.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const CLAVE_TOKEN = "zyncra_push_token";
/** Negocio al que se registró el token guardado (para liberarlo al cambiar de cuenta). */
const CLAVE_TOKEN_NEGOCIO = "zyncra_push_token_negocio";
const PREFIJO_CITA = "appt-";
const ID_RESUMEN = "daily-briefing";
/** iOS guarda como máximo 64 notificaciones locales pendientes y descarta el resto en silencio. */
const MAX_RECORDATORIOS = 40;

let tokenEnMemoria: string | null = null;

async function haySesion(): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    return !!data.session;
  } catch {
    return false;
  }
}

async function asegurarCanalAndroid() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("reminders", {
    name: "Recordatorios de citas",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#fb0f05",
  }).catch(() => {});
}

// ─── Push remoto ──────────────────────────────────────────────────────────────

/** Pide permiso (si hace falta) y devuelve el token Expo del dispositivo, o null. */
async function obtenerTokenDelDispositivo(pedirPermiso: boolean): Promise<string | null> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== "granted" && pedirPermiso) {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== "granted") return null;

  await asegurarCanalAndroid();

  try {
    const projectId =
      (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
      (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig?.projectId;
    const res = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId })
      : await Notifications.getExpoPushTokenAsync();
    return res.data ?? null;
  } catch (e) {
    // Android sin FCM, simulador o sin red: no hay token. Se deja rastro en el
    // log (COM-08): en Android sin google-services.json el error es "Default
    // FirebaseApp is not initialized" y, en silencio, nadie sabía por qué no
    // llegaban los push de "Nueva cita".
    const mensaje = e instanceof Error ? e.message : String(e);
    console.warn(`[push] No se obtuvo el token Expo del dispositivo: ${mensaje}`);
    return null;
  }
}

/**
 * Registra este dispositivo como destino de los push del negocio. Llamarla
 * cuando el rol ya se resolvió como dueño (el portal envía a
 * tenants.push_token, que solo el dueño puede escribir) y cada vez que cambie
 * la cuenta. El permiso se pide aquí, en contexto, y no sobre la intro.
 */
export async function registrarPushDelDispositivo(
  tenantId: string,
  opciones: { pedirPermiso?: boolean } = {},
): Promise<string | null> {
  if (!tenantId || !(await haySesion())) return null;
  const token = await obtenerTokenDelDispositivo(opciones.pedirPermiso !== false);
  if (!token) return null;

  // Si este teléfono quedó registrado en OTRO negocio (esa cuenta salió sin
  // red o se le venció la sesión), se libera antes: si no, seguía recibiendo
  // aquí los "Nueva cita" de la cuenta anterior.
  const previoDe = await AsyncStorage.getItem(CLAVE_TOKEN_NEGOCIO).catch(() => null);
  const guardado = tokenEnMemoria ?? await AsyncStorage.getItem(CLAVE_TOKEN).catch(() => null);
  if (guardado && previoDe !== tenantId) await liberarTokenEnServidor(guardado);

  const { error } = await supabase
    .from("tenants")
    .update({ push_token: token })
    .eq("id", tenantId);
  if (error) return null;

  tokenEnMemoria = token;
  await AsyncStorage.setItem(CLAVE_TOKEN, token).catch(() => {});
  await AsyncStorage.setItem(CLAVE_TOKEN_NEGOCIO, tenantId).catch(() => {});
  return token;
}

/**
 * Quita el token de este teléfono de TODOS los negocios donde quedó, con la
 * RPC liberar_push_token de la migración 20260927 (COM-02 / SEG-14). Cubre lo
 * que el update directo no alcanza: el negocio de otra cuenta que usó este
 * teléfono. true = liberado; false = la RPC aún no existe o no respondió.
 */
async function liberarTokenEnServidor(token: string): Promise<boolean> {
  try {
    const { error } = await supabase.rpc("liberar_push_token", { p_token: token });
    return !error;
  } catch {
    return false;
  }
}

async function olvidarTokenLocal() {
  tokenEnMemoria = null;
  await AsyncStorage.multiRemove([CLAVE_TOKEN, CLAVE_TOKEN_NEGOCIO]).catch(() => {});
}

/**
 * Para una sesión que no registra push (el staff): si el teléfono sigue
 * anotado en el negocio de una cuenta anterior que no pudo liberarlo al salir,
 * se libera ahora. Sin la RPC (migración pendiente) no hace nada.
 */
export async function liberarPushPendiente(): Promise<void> {
  const token = tokenEnMemoria ?? await AsyncStorage.getItem(CLAVE_TOKEN).catch(() => null);
  if (!token || !(await haySesion())) return;
  if (await liberarTokenEnServidor(token)) await olvidarTokenLocal();
}

/**
 * Compatibilidad con el registro anterior (sin tenantId): resuelve el negocio
 * del dueño con sesión. Preferir registrarPushDelDispositivo(tenantId).
 */
export async function registerForPushNotifications(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;
  const { data } = await supabase
    .from("tenants").select("id").eq("owner_id", session.user.id)
    .order("created_at", { ascending: true }).limit(1);
  const tenantId = data?.[0]?.id as string | undefined;
  return tenantId ? registrarPushDelDispositivo(tenantId) : null;
}

/**
 * Quita el token de ESTE dispositivo del negocio (antes de cerrar sesión o
 * eliminar la cuenta). Solo lo borra si sigue siendo el de este teléfono:
 * si otro dispositivo del dueño ya lo reemplazó, no se toca.
 */
export async function borrarPushTokenDelServidor(tenantId: string): Promise<void> {
  if (!tenantId) return;
  const token = tokenEnMemoria ?? await AsyncStorage.getItem(CLAVE_TOKEN).catch(() => null);
  if (!token) return;
  // Con la migración: de todos los negocios donde haya quedado este teléfono.
  if (await liberarTokenEnServidor(token)) {
    await olvidarTokenLocal();
    return;
  }
  const { error } = await supabase
    .from("tenants")
    .update({ push_token: null })
    .eq("id", tenantId)
    .eq("push_token", token);
  // Si falla (sin red), el token queda guardado: el próximo registro o la
  // próxima sesión del staff lo liberan (liberarPushPendiente).
  if (!error) await olvidarTokenLocal();
}

/**
 * Cancela todo lo programado y limpia las notificaciones ya mostradas (tienen
 * nombres de clientes). Para cerrar sesión y eliminar la cuenta.
 */
export async function cancelarTodasLasNotificaciones(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync().catch(() => {});
  await Notifications.dismissAllNotificationsAsync().catch(() => {});
  await Notifications.setBadgeCountAsync(0).catch(() => {});
}

// ─── Recordatorio de una cita ─────────────────────────────────────────────────

export type AppointmentForNotif = {
  id: string;
  date: string;       // "YYYY-MM-DD" (día del negocio)
  time: string;       // "HH:MM" o "HH:MM:SS" (hora del negocio)
  clientName: string;
  serviceName: string;
};

const ESTADOS_VIGENTES = new Set(["pending", "confirmed"]);

/**
 * Programa (o reprograma) el aviso al dueño `hoursBefore` horas antes de la
 * cita. La hora se interpreta en la zona del NEGOCIO (`timeZone`, por defecto
 * la zona activa): antes era la del teléfono y con el negocio en Madrid y el
 * dueño en Bogotá el aviso llegaba 7 horas corrido.
 *
 * `messageTemplate` se ignora a propósito: es el texto PARA EL CLIENTE
 * ("¡Hola María! Te recordamos…") y mostrárselo al dueño en su pantalla de
 * bloqueo confundía (COM-26). Se deja el parámetro para no romper llamadores.
 */
export async function scheduleAppointmentReminder(
  appt: AppointmentForNotif,
  hoursBefore: number,
  _messageTemplate?: string,
  timeZone: string = zonaActiva(),
): Promise<void> {
  await cancelAppointmentReminder(appt.id);
  if (!(await haySesion())) return;

  const hhmm = (appt.time ?? "").slice(0, 5);
  const inicio = instanteDe(appt.date, hhmm, timeZone);
  if (Number.isNaN(inicio.getTime())) return;
  const horas = Number.isFinite(hoursBefore) && hoursBefore > 0 ? hoursBefore : 24;
  const disparo = new Date(inicio.getTime() - horas * 60 * 60 * 1000);
  if (disparo <= new Date()) return;

  const cuando = `${fmtDia(appt.date, "largo")} a las ${fmt12(hhmm)}`;
  await asegurarCanalAndroid();
  await Notifications.scheduleNotificationAsync({
    identifier: `${PREFIJO_CITA}${appt.id}`,
    content: {
      title: "Cita próxima",
      body: `${appt.clientName || "Cliente"} · ${appt.serviceName || "Servicio"} — ${cuando}`,
      data: { appointmentId: appt.id },
      ...(Platform.OS === "android" && { channelId: "reminders" }),
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: disparo },
  }).catch(() => {});
}

export async function cancelAppointmentReminder(appointmentId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(`${PREFIJO_CITA}${appointmentId}`).catch(() => {});
}

/** Alias en español de cancelAppointmentReminder: al cancelar, marcar no-show o completar. */
export const cancelarRecordatorioCita = cancelAppointmentReminder;

async function horasAntesDelNegocio(tenantId: string): Promise<number> {
  const { data } = await supabase
    .from("reminder_settings")
    .select("hours_before")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const h = Number(data?.hours_before);
  return Number.isFinite(h) && h > 0 ? h : 24;
}

/**
 * Deja el recordatorio de una cita al día con su estado actual: lo cancela si
 * ya no está pendiente/confirmada y lo reprograma si cambió fecha u hora. Para
 * la agenda al reagendar, cancelar, marcar no-show o completar.
 *
 *   await reprogramarRecordatorioCita(tenantId, {
 *     id, date: "2026-09-30", time: "15:30", clientName, serviceName, status: "confirmed",
 *   }, timezone);
 */
export async function reprogramarRecordatorioCita(
  tenantId: string,
  appt: AppointmentForNotif & { status?: string | null },
  timeZone: string = zonaActiva(),
): Promise<void> {
  if (appt.status && !ESTADOS_VIGENTES.has(appt.status)) {
    await cancelAppointmentReminder(appt.id);
    return;
  }
  const horas = await horasAntesDelNegocio(tenantId);
  await scheduleAppointmentReminder(appt, horas, undefined, timeZone);
}

// ─── Resumen diario ───────────────────────────────────────────────────────────

/** "Buenos días" a las 8:00 del teléfono. Solo con sesión. */
export async function scheduleDailyBriefing(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(ID_RESUMEN).catch(() => {});
  if (!(await haySesion())) return;
  await asegurarCanalAndroid();
  await Notifications.scheduleNotificationAsync({
    identifier: ID_RESUMEN,
    content: {
      title: "Buenos días 👋",
      body: "Abre Zyncra para ver tus citas de hoy.",
      ...(Platform.OS === "android" && { channelId: "reminders" }),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
      hour: 8,
      minute: 0,
      repeats: true,
    },
  }).catch(() => {});
}

export async function cancelarResumenDiario(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(ID_RESUMEN).catch(() => {});
}

// ─── Sincronizar todos los recordatorios ──────────────────────────────────────

/**
 * Programa los recordatorios de las próximas citas vigentes y CANCELA los de
 * citas que ya no lo están (canceladas o movidas desde el web, Hanna o
 * /manage). Si la consulta falla no se toca nada: mejor un aviso de más que
 * borrar todos por un corte de red.
 *
 * `tenantId` opcional por compatibilidad (el Panel la llama sin argumentos):
 * sin él se resuelve el negocio del dueño con sesión.
 */
export async function refreshAllReminders(tenantId?: string | null, timeZone: string = zonaActiva()): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return;

  let tid = tenantId ?? null;
  if (!tid) {
    const { data, error } = await supabase
      .from("tenants").select("id").eq("owner_id", session.user.id)
      .order("created_at", { ascending: true }).limit(1);
    if (error) return;
    tid = (data?.[0]?.id as string | undefined) ?? null;
  }
  if (!tid) return;

  const horas = await horasAntesDelNegocio(tid);

  const { data: appts, error } = await supabase
    .from("appointments")
    .select("id, appointment_date, appointment_time, status, clients(name), services(name)")
    .eq("tenant_id", tid)
    .in("status", ["pending", "confirmed"])
    .gte("appointment_date", hoyNegocio(timeZone))
    .order("appointment_date", { ascending: true })
    .order("appointment_time", { ascending: true })
    .limit(MAX_RECORDATORIOS);
  if (error || !appts) return;

  const vigentes = new Set(appts.map(a => `${PREFIJO_CITA}${a.id}`));
  const programadas = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  for (const n of programadas) {
    const id = n.identifier;
    if (id.startsWith(PREFIJO_CITA) && !vigentes.has(id)) {
      await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
    }
  }

  for (const a of appts) {
    const clientName = (a.clients as { name?: string } | null)?.name ?? "Cliente";
    const serviceName = (a.services as { name?: string } | null)?.name ?? "Servicio";
    await scheduleAppointmentReminder(
      { id: a.id, date: a.appointment_date, time: a.appointment_time, clientName, serviceName },
      horas,
      undefined,
      timeZone,
    );
  }
}
