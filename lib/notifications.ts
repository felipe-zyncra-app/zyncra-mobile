import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { supabase } from "./supabase";
import { textoRecordatorioCita } from "./avisos";
import { hoyNegocio, instanteDe, zonaActiva } from "./tz";

/**
 * Notificaciones del dispositivo.
 *
 * DOS COSAS DISTINTAS
 *  · Push remoto: el portal (reserva pública, Hanna, /manage) manda "Nueva
 *    cita" al token guardado en tenants.push_token. Se registra DESPUÉS del
 *    login y al cambiar de cuenta (registrarPushDelDispositivo) y se borra del
 *    servidor al cerrar sesión (borrarPushTokenDelServidor), para que el
 *    teléfono no siga recibiendo nombres de clientes de otro negocio.
 *  · Recordatorios locales: avisos AL DUEÑO de sus próximas citas ("Recuerda:
 *    mañana a las 3:00 PM tienes una cita con Juan para Corte."). No son el
 *    recordatorio al cliente (ese lo manda el servidor por WhatsApp y correo).
 *    Se programan en la hora del NEGOCIO, se cancelan si la cita ya no está
 *    vigente y al cerrar sesión, y se pueden apagar en ESTE teléfono desde
 *    Ajustes → Recordatorios (avisosDeCitaActivos / activarAvisosDeCita).
 *
 * TOCAR UNA NOTIFICACIÓN (push o local) abre la campana del Panel: lo hace
 * useAbrirAvisosAlTocar (lib/useAvisos) con alTocarNotificacion, solo al dueño.
 *
 * ANDROID: sin FCM configurado en Firebase (google-services.json en el build)
 * getExpoPushTokenAsync falla y no llega ningún push remoto. Es una acción
 * del dueño de la cuenta de Firebase/EAS, no se arregla desde el código.
 */

// Cómo se muestran con la app abierta: el push del portal ("Nueva cita 📅",
// "Cita cancelada ⚠️", "Cita reagendada 🔄") y los avisos locales salen como
// banner, quedan en el centro de notificaciones y suenan. Se fija al importar
// este módulo, que carga app/_layout.tsx al arrancar.
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
/** "0" = este teléfono NO avisa antes de cada cita. Sin valor (o "1") = sí, que es lo normal. */
const CLAVE_AVISOS_CITA = "zyncra_avisos_cita_telefono";

let tokenEnMemoria: string | null = null;
let avisosCitaEnMemoria: boolean | null = null;
/**
 * Sube al cerrar sesión (cancelarTodasLasNotificaciones). Lo que se esté
 * programando de esa cuenta (p. ej. el Panel con 40 citas) se detiene y no
 * deja avisos con nombres de clientes en un teléfono sin sesión.
 */
let generacionAvisos = 0;

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
  generacionAvisos++;
  await Notifications.cancelAllScheduledNotificationsAsync().catch(() => {});
  await Notifications.dismissAllNotificationsAsync().catch(() => {});
  await Notifications.setBadgeCountAsync(0).catch(() => {});
}

// ─── Avisos por cita en ESTE teléfono (se pueden apagar) ──────────────────────

/**
 * ¿Este teléfono le avisa al negocio antes de cada cita? Encendido por
 * defecto. Se guarda POR DISPOSITIVO: otro teléfono del dueño decide aparte.
 * Si AsyncStorage no responde se asume encendido (lo de siempre).
 */
export async function avisosDeCitaActivos(): Promise<boolean> {
  if (avisosCitaEnMemoria !== null) return avisosCitaEnMemoria;
  try {
    const v = await AsyncStorage.getItem(CLAVE_AVISOS_CITA);
    // Si mientras se leía el dueño tocó el interruptor, gana lo que eligió:
    // si no, la lectura vieja lo volvía a encender en memoria.
    if (avisosCitaEnMemoria !== null) return avisosCitaEnMemoria;
    avisosCitaEnMemoria = v !== "0";
    return avisosCitaEnMemoria;
  } catch {
    return true;
  }
}

/** Cancela todos los avisos "appt-" programados en este teléfono. */
async function cancelarAvisosDeCitas(): Promise<void> {
  const programadas = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  for (const n of programadas) {
    if (n.identifier.startsWith(PREFIJO_CITA)) {
      await Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {});
    }
  }
}

/** Los cambios del interruptor se aplican en orden (apagar y encender rápido no se pisan). */
let cambioDeAvisos: Promise<void> = Promise.resolve();

/**
 * Enciende o apaga los avisos por cita en este teléfono (Ajustes →
 * Recordatorios). Apagado: cancela los programados y ya no se programan
 * nuevos. Encendido: los vuelve a programar con refreshAllReminders.
 */
export function activarAvisosDeCita(
  activo: boolean,
  tenantId?: string | null,
  timeZone: string = zonaActiva(),
): Promise<void> {
  // En memoria al instante: lo que se esté programando en este momento
  // (p. ej. el Panel) lo ve y se detiene.
  avisosCitaEnMemoria = activo;
  const paso = cambioDeAvisos.then(async () => {
    try {
      await AsyncStorage.setItem(CLAVE_AVISOS_CITA, activo ? "1" : "0");
    } catch {
      // Sin almacenamiento vale para esta sesión (queda en memoria).
    }
    if (activo) await refreshAllReminders(tenantId, timeZone);
    else await cancelarAvisosDeCitas();
  });
  cambioDeAvisos = paso.catch(() => {});
  return paso;
}

// ─── Recordatorio de una cita ─────────────────────────────────────────────────

export type AppointmentForNotif = {
  id: string;
  date: string;       // "YYYY-MM-DD" (día del negocio)
  time: string;       // "HH:MM" o "HH:MM:SS" (hora del negocio)
  /** Vacío o null = "con un cliente". */
  clientName?: string | null;
  /** Vacío o null = el aviso no nombra el servicio. */
  serviceName?: string | null;
};

const ESTADOS_VIGENTES = new Set(["pending", "confirmed"]);

/**
 * Programa el aviso sin revisar sesión ni el interruptor (quien llama ya lo
 * hizo). `generacion` es la de cuando empezó quien llama: si entretanto se
 * cerró sesión, no programa (o cancela el que acaba de programar).
 */
async function programarAviso(appt: AppointmentForNotif, hoursBefore: number, timeZone: string, generacion: number): Promise<void> {
  const hhmm = (appt.time ?? "").slice(0, 5);
  const inicio = instanteDe(appt.date, hhmm, timeZone);
  if (Number.isNaN(inicio.getTime())) return;
  const horas = Number.isFinite(hoursBefore) && hoursBefore > 0 ? hoursBefore : 24;
  const disparo = new Date(inicio.getTime() - horas * 60 * 60 * 1000);
  if (disparo <= new Date()) return;

  // "hoy / mañana / el sábado 3 de octubre" se calcula desde que SUENA.
  const { title, body } = textoRecordatorioCita(appt, disparo, timeZone);
  await asegurarCanalAndroid();
  if (generacion !== generacionAvisos) return;
  await Notifications.scheduleNotificationAsync({
    identifier: `${PREFIJO_CITA}${appt.id}`,
    content: {
      title,
      body,
      data: { appointmentId: appt.id },
      ...(Platform.OS === "android" && { channelId: "reminders" }),
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: disparo },
  }).catch(() => {});
  // Si lo apagaron o se cerró sesión mientras se programaba, no queda este suelto.
  if (avisosCitaEnMemoria === false || generacion !== generacionAvisos) await cancelAppointmentReminder(appt.id);
}

/**
 * Programa (o reprograma) el aviso al dueño `hoursBefore` horas antes de la
 * cita. La hora se interpreta en la zona del NEGOCIO (`timeZone`, por defecto
 * la zona activa): antes era la del teléfono y con el negocio en Madrid y el
 * dueño en Bogotá el aviso llegaba 7 horas corrido. Con los avisos apagados
 * en este teléfono solo cancela el que hubiera.
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
  const generacion = generacionAvisos;
  await cancelAppointmentReminder(appt.id);
  if (!(await haySesion())) return;
  if (!(await avisosDeCitaActivos())) return;
  await programarAviso(appt, hoursBefore, timeZone, generacion);
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
 * la agenda al reagendar, cancelar, marcar no-show o completar. Con los
 * avisos apagados en este teléfono solo cancela.
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
  if (!(await avisosDeCitaActivos())) {
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
  const generacion = generacionAvisos;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return;

  // Apagados en este teléfono: no queda ninguno programado.
  if (!(await avisosDeCitaActivos())) {
    await cancelarAvisosDeCitas();
    return;
  }

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

  // El interruptor se revisó arriba; la sesión también. Cada aviso reemplaza
  // al de la misma cita (mismo identificador), así los de versiones
  // anteriores, con el texto para el cliente, se cambian por el nuevo.
  for (const a of appts) {
    // Lo apagaron, o se cerró sesión, a mitad de camino.
    if (avisosCitaEnMemoria === false || generacion !== generacionAvisos) break;
    await cancelAppointmentReminder(a.id);
    await programarAviso(
      {
        id: a.id,
        date: a.appointment_date,
        time: a.appointment_time,
        clientName: (a.clients as { name?: string | null } | null)?.name ?? null,
        serviceName: (a.services as { name?: string | null } | null)?.name ?? null,
      },
      horas,
      timeZone,
      generacion,
    );
  }
}

// ─── Escuchar notificaciones ──────────────────────────────────────────────────

/** Respuestas ya atendidas: el listener y la del arranque en frío pueden traer la misma. */
const respuestasAtendidas = new Set<string>();

/**
 * Llama a `alTocar` cuando el usuario toca una notificación (push del portal o
 * aviso local) y, una sola vez, con la que abrió la app estando cerrada
 * (arranque en frío). Devuelve la función para dejar de escuchar.
 *
 * Para el arranque en frío usa getLastNotificationResponse: en
 * expo-notifications 0.32 getLastNotificationResponseAsync está deprecada y
 * solo envuelve a esta. Después de atenderla se borra, para que no vuelva a
 * abrir la campana si el área del dueño se monta otra vez.
 */
export function alTocarNotificacion(alTocar: (datos: Record<string, unknown>) => void): () => void {
  const atender = (r: Notifications.NotificationResponse | null | undefined) => {
    if (!r || r.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const clave = `${r.notification.request.identifier}|${r.notification.date}`;
    if (respuestasAtendidas.has(clave)) return;
    respuestasAtendidas.add(clave);
    try {
      Notifications.clearLastNotificationResponse();
    } catch {
      // Plataforma sin esa función (web): no hay nada que borrar.
    }
    alTocar((r.notification.request.content.data ?? {}) as Record<string, unknown>);
  };

  let sub: { remove: () => void } | null = null;
  try {
    sub = Notifications.addNotificationResponseReceivedListener(atender);
  } catch {
    sub = null;
  }
  try {
    atender(Notifications.getLastNotificationResponse());
  } catch {
    // Sin módulo nativo (web, tests): no hubo arranque desde una notificación.
  }
  return () => sub?.remove();
}

/** Llama a `alRecibir` cuando llega una notificación con la app abierta (p. ej. para recargar la campana). */
export function alRecibirNotificacion(alRecibir: () => void): () => void {
  try {
    const sub = Notifications.addNotificationReceivedListener(() => alRecibir());
    return () => sub.remove();
  } catch {
    return () => {};
  }
}
