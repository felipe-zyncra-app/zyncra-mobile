import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { supabase } from "./supabase";
import { localDateStr } from "./format";

// How notifications appear when the app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// ─── Permissions + token ──────────────────────────────────────────────────────

export async function registerForPushNotifications(): Promise<string | null> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") return null;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("reminders", {
      name: "Recordatorios de citas",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#fb0f05",
    });
  }

  try {
    const token = (await Notifications.getExpoPushTokenAsync()).data;
    await savePushToken(token);
    return token;
  } catch {
    return null;
  }
}

async function savePushToken(token: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { data: tenant } = await supabase
    .from("tenants").select("id").eq("owner_id", user.id).single();
  if (!tenant) return;
  await supabase.from("tenants").update({ push_token: token }).eq("id", tenant.id);
}

// ─── Schedule a reminder for an appointment ───────────────────────────────────

export type AppointmentForNotif = {
  id: string;
  date: string;       // "YYYY-MM-DD"
  time: string;       // "HH:MM:SS"
  clientName: string;
  serviceName: string;
};

export async function scheduleAppointmentReminder(
  appt: AppointmentForNotif,
  hoursBefore: number,
  messageTemplate: string
) {
  // Cancel any existing notification for this appointment
  await cancelAppointmentReminder(appt.id);

  const [h, m] = appt.time.split(":").map(Number);
  const apptDate = new Date(`${appt.date}T${appt.time.slice(0, 5)}`);
  const fireDate = new Date(apptDate.getTime() - hoursBefore * 60 * 60 * 1000);

  // Don't schedule if the fire time is in the past
  if (fireDate <= new Date()) return;

  const body = messageTemplate
    .replace(/\{\{nombre\}\}/g, appt.clientName)
    .replace(/\{\{servicio\}\}/g, appt.serviceName)
    .replace(/\{\{fecha\}\}/g, apptDate.toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" }))
    .replace(/\{\{hora\}\}/g, apptDate.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }));

  await Notifications.scheduleNotificationAsync({
    identifier: `appt-${appt.id}`,
    content: {
      title: "Recordatorio de cita",
      body,
      data: { appointmentId: appt.id },
      ...(Platform.OS === "android" && { channelId: "reminders" }),
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireDate },
  });
}

export async function cancelAppointmentReminder(appointmentId: string) {
  await Notifications.cancelScheduledNotificationAsync(`appt-${appointmentId}`).catch(() => {});
}

// ─── Daily briefing at 8 AM ───────────────────────────────────────────────────

export async function scheduleDailyBriefing() {
  await Notifications.cancelScheduledNotificationAsync("daily-briefing").catch(() => {});

  await Notifications.scheduleNotificationAsync({
    identifier: "daily-briefing",
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
  });
}

// ─── Schedule reminders for all upcoming appointments ─────────────────────────

export async function refreshAllReminders() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const { data: tenant } = await supabase
    .from("tenants").select("id").eq("owner_id", user.id).single();
  if (!tenant) return;

  const { data: settings } = await supabase
    .from("reminder_settings")
    .select("hours_before, message_template")
    .eq("tenant_id", tenant.id).single();

  const hoursBefore = settings?.hours_before ?? 24;
  const template = settings?.message_template ??
    "¡Hola {{nombre}}! Te recordamos tu cita de {{servicio}} el {{fecha}} a las {{hora}}.";

  // Fetch upcoming confirmed appointments
  const today = localDateStr();
  const { data: appts } = await supabase
    .from("appointments")
    .select("id, appointment_date, appointment_time, status, clients(name), services(name)")
    .eq("tenant_id", tenant.id)
    .in("status", ["pending", "confirmed"])
    .gte("appointment_date", today)
    .order("appointment_date", { ascending: true })
    .limit(50);

  if (!appts) return;

  for (const a of appts) {
    const clientName = (a.clients as any)?.name ?? "Cliente";
    const serviceName = (a.services as any)?.name ?? "Servicio";
    await scheduleAppointmentReminder(
      { id: a.id, date: a.appointment_date, time: a.appointment_time, clientName, serviceName },
      hoursBefore,
      template
    );
  }
}
