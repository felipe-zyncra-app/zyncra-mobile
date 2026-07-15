import { useEffect, useState, useCallback, useMemo } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl, Modal, Alert, TextInput,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown, FadeInRight } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { Colors, Gradients, Radius, Shadow } from "@/constants/theme";
import ErrorState from "@/components/ErrorState";
import { ScreenHeader } from "@/components/ui";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { fmtMoneyFull, fmt12 } from "@/lib/format";
import { STATUS_META } from "@/constants/status";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

type Appt = {
  id: string;
  appointment_date: string;
  appointment_time: string;
  status: string;
  notes: string | null;
  clients: { name: string; phone?: string } | null;
  services: { name: string; price: number } | null;
  professionals: { name: string; color?: string } | null;
};

type Professional = { id: string; name: string; color?: string };

const DAYS_ES = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MONTHS  = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];

function addDays(d: Date, n: number) {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}

function toDateStr(d: Date) {
  return d.toISOString().slice(0, 10);
}

function buildDayRange(n: number): { date: Date; label: string; iso: string }[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: n }, (_, i) => {
    const d = addDays(today, i);
    const iso = toDateStr(d);
    const dayLabel = i === 0 ? "Hoy" : i === 1 ? "Mañana" : `${DAYS_ES[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
    return { date: d, label: dayLabel, iso };
  });
}

// ─── Reschedule modal ─────────────────────────────────────────────────────────

function RescheduleModal({ appt, tenantId, onClose, onSaved }: {
  appt: Appt | null; tenantId: string; onClose: () => void; onSaved: () => void;
}) {
  const { t } = useTheme();
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("");
  const [saving, setSaving]   = useState(false);

  useEffect(() => {
    if (appt) {
      setNewDate(appt.appointment_date);
      setNewTime(appt.appointment_time.slice(0, 5));
    }
  }, [appt]);

  if (!appt) return null;

  const handleSave = async () => {
    if (!newDate || !newTime) return;
    const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(newDate);
    const timeOk = /^\d{2}:\d{2}$/.test(newTime);
    if (!dateOk || !timeOk) {
      Alert.alert("Formato inválido", "Usa YYYY-MM-DD para fecha y HH:MM para hora.");
      return;
    }
    setSaving(true);
    await supabase.from("appointments")
      .update({ appointment_date: newDate, appointment_time: `${newTime}:00` })
      .eq("id", appt.id);
    setSaving(false);
    onSaved();
    onClose();
  };

  return (
    <Modal visible={!!appt} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <View style={[rm.header, { backgroundColor: "#0C0C14" }]}>
          <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3 }} />
          <View style={rm.headerRow}>
            <TouchableOpacity onPress={onClose} style={rm.closeBtn}>
              <Ionicons name="close" size={20} color="white" />
            </TouchableOpacity>
            <Text style={rm.title}>Reagendar cita</Text>
            <View style={{ width: 40 }} />
          </View>
          <View style={rm.summary}>
            <Text style={rm.summaryClient}>{appt.clients?.name ?? "Sin cliente"}</Text>
            <Text style={rm.summaryService}>{appt.services?.name ?? "Sin servicio"}</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={{ padding: 24, gap: 20 }}>
          <View>
            <Text style={[rm.fieldLabel, { color: t.muted }]}>Nueva fecha (YYYY-MM-DD)</Text>
            <TextInput
              style={[rm.input, { backgroundColor: t.bgAlt, borderColor: t.border, color: t.text }]}
              value={newDate}
              onChangeText={setNewDate}
              placeholder="2026-06-15"
              placeholderTextColor={t.subtle}
              keyboardType="numeric"
              maxLength={10}
            />
          </View>
          <View>
            <Text style={[rm.fieldLabel, { color: t.muted }]}>Nueva hora (HH:MM, 24h)</Text>
            <TextInput
              style={[rm.input, { backgroundColor: t.bgAlt, borderColor: t.border, color: t.text }]}
              value={newTime}
              onChangeText={setNewTime}
              placeholder="14:00"
              placeholderTextColor={t.subtle}
              keyboardType="numeric"
              maxLength={5}
            />
          </View>

          {/* Quick hour presets */}
          <View>
            <Text style={[rm.fieldLabel, { marginBottom: 10, color: t.muted }]}>Horas rápidas</Text>
            <View style={rm.presets}>
              {["08:00","09:00","10:00","11:00","12:00","14:00","15:00","16:00","17:00","18:00"].map(h => (
                <TouchableOpacity
                  key={h}
                  style={[rm.preset, { backgroundColor: t.bgAlt, borderColor: t.border }, newTime === h && rm.presetActive]}
                  onPress={() => setNewTime(h)}
                >
                  <Text style={[rm.presetText, { color: t.text }, newTime === h && { color: "white" }]}>{h}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </ScrollView>

        <View style={[rm.bottomBar, { backgroundColor: t.bg, borderTopColor: t.border }]}>
          <TouchableOpacity
            style={[rm.btn, saving && { opacity: 0.6 }]}
            onPress={handleSave}
            disabled={saving}
            activeOpacity={0.85}
          >
            <View style={rm.btnGrad}>
              {saving
                ? <ActivityIndicator color="white" />
                : <>
                    <Ionicons name="calendar-outline" size={17} color="white" />
                    <Text style={rm.btnText}>Confirmar reagendo</Text>
                  </>
              }
            </View>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const rm = StyleSheet.create({
  header:        { paddingTop: 16, paddingHorizontal: 20, paddingBottom: 20 },
  headerRow:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  closeBtn:      { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,.18)", alignItems: "center", justifyContent: "center" },
  title:         { fontSize: 18, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
  summary:       { backgroundColor: "rgba(255,255,255,.14)", borderRadius: Radius.lg, padding: 14 },
  summaryClient: { fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
  summaryService:{ fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: "rgba(255,255,255,.8)", marginTop: 4 },
  fieldLabel:    { fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", color: Colors.muted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 },
  input:         { backgroundColor: Colors.white, borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 14, fontSize: 16, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text, letterSpacing: 1 },
  presets:       { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  preset:        { borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.full, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: Colors.white },
  presetActive:  { backgroundColor: Colors.red, borderColor: Colors.red },
  presetText:    { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  bottomBar:     { padding: 20, paddingBottom: 34, borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.cream2 },
  btn:           { borderRadius: Radius.full, overflow: "hidden" },
  btnGrad:       { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 16, backgroundColor: Colors.red },
  btnText:       { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function UpcomingScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const { tenantId } = useAuth();
  const [appts, setAppts]             = useState<Appt[]>([]);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [selectedPro, setSelectedPro] = useState<string>("all");
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [reschedule, setReschedule]   = useState<Appt | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) return;
    const today = toDateStr(new Date());
    const end   = toDateStr(addDays(new Date(), 13));

    const [{ data: apptData }, { data: proData }] = await Promise.all([
      supabase.from("appointments")
        .select("id,appointment_date,appointment_time,status,notes,clients(name,phone),services(name,price),professionals(name,color)")
        .eq("tenant_id", tenantId)
        .gte("appointment_date", today)
        .lte("appointment_date", end)
        .not("status", "eq", "cancelled")
        .order("appointment_date")
        .order("appointment_time"),
      supabase.from("professionals")
        .select("id,name,color")
        .eq("tenant_id", tenantId)
        .eq("is_active", true),
    ]);

    setAppts((apptData ?? []) as unknown as Appt[]);
    setProfessionals((proData ?? []) as Professional[]);
    setLoading(false);
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    load().then(() => { if (cancelled) return; });
    return () => { cancelled = true; };
  }, [tenantId]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const changeStatus = async (appt: Appt, status: string) => {
    await supabase.from("appointments").update({ status }).eq("id", appt.id);
    setAppts(prev => prev.map(a => a.id === appt.id ? { ...a, status } : a));
  };

  const days = useMemo(() => buildDayRange(14), []);

  const visibleAppts = useMemo(() =>
    selectedPro === "all"
      ? appts
      : appts.filter(a => (a.professionals as any)?.name === professionals.find(p => p.id === selectedPro)?.name),
    [appts, selectedPro, professionals]
  );

  const groupedByDay = useMemo(() => {
    const map = new Map<string, Appt[]>();
    visibleAppts.forEach(a => {
      const key = a.appointment_date;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    });
    return map;
  }, [visibleAppts]);

  const totalPending = appts.filter(a => a.status === "pending" || a.status === "confirmed").length;
  const pendingRevenue = appts
    .filter(a => a.status === "pending" || a.status === "confirmed")
    .reduce((s, a) => s + Number(a.services?.price ?? 0), 0);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader
        crumb="Agenda"
        title="Próximas Citas"
        subtitle={`Próximos 14 días · ${totalPending} pendientes${pendingRevenue > 0 ? ` · ${fmtMoneyFull(pendingRevenue)} proyectados` : ""}`}
        onBack={() => router.back()}
      />

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={Colors.red} size="large" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.red} />}
        >
          {/* Professional filter */}
          {professionals.length > 1 && (
            <Animated.View entering={FadeInDown.duration(300)}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.proFilter}>
                <TouchableOpacity
                  style={[s.proChip, { backgroundColor: t.bgAlt, borderColor: t.border }, selectedPro === "all" && s.proChipActive]}
                  onPress={() => setSelectedPro("all")}
                >
                  <Text style={[s.proChipText, { color: t.text }, selectedPro === "all" && { color: "white" }]}>Todos</Text>
                </TouchableOpacity>
                {professionals.map(pro => (
                  <TouchableOpacity
                    key={pro.id}
                    style={[s.proChip, { backgroundColor: t.bgAlt, borderColor: t.border }, selectedPro === pro.id && s.proChipActive]}
                    onPress={() => setSelectedPro(pro.id)}
                  >
                    {pro.color && (
                      <View style={[s.proColorDot, { backgroundColor: pro.color }]} />
                    )}
                    <Text style={[s.proChipText, { color: t.text }, selectedPro === pro.id && { color: "white" }]}>{pro.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </Animated.View>
          )}

          {/* Day groups */}
          {days.map((day, di) => {
            const dayAppts = groupedByDay.get(day.iso) ?? [];
            if (dayAppts.length === 0) return null;

            const dayRevenue = dayAppts.reduce((s, a) => s + Number(a.services?.price ?? 0), 0);

            return (
              <Animated.View key={day.iso} entering={FadeInDown.delay(di * 40).duration(350)}>
                {/* Day header */}
                <View style={s.dayHeader}>
                  <Text style={[s.dayLabel, { color: t.text }]}>{day.label}</Text>
                  <View style={s.dayMeta}>
                    <Text style={[s.dayCount, { color: t.muted }]}>{dayAppts.length} cita{dayAppts.length !== 1 ? "s" : ""}</Text>
                    {dayRevenue > 0 && <Text style={s.dayRevenue}>{fmtMoneyFull(dayRevenue)}</Text>}
                  </View>
                </View>

                {dayAppts.map((appt, ai) => {
                  const meta = STATUS_META[appt.status] ?? STATUS_META.pending;
                  const pro  = appt.professionals as any;
                  const proColor = pro?.color ?? Colors.muted;

                  return (
                    <Animated.View key={appt.id} entering={FadeInRight.delay(ai * 50).duration(300)}>
                      <View style={[s.apptCard, Shadow.sm, { backgroundColor: t.bgAlt }]}>
                        <View style={[s.apptAccent, { backgroundColor: proColor }]} />
                        <View style={{ flex: 1, padding: 12 }}>
                          {/* Top row */}
                          <View style={s.apptTopRow}>
                            <View style={[s.timePill, { backgroundColor: meta.color + "12" }]}>
                              <Text style={[s.timeText, { color: meta.color }]}>
                                {fmt12(appt.appointment_time.slice(0, 5))}
                              </Text>
                            </View>
                            {appt.services?.price ? (
                              <Text style={[s.apptPrice, { color: t.text }]}>{fmtMoneyFull(appt.services.price)}</Text>
                            ) : null}
                          </View>

                          {/* Client & service */}
                          <Text style={[s.apptClient, { color: t.text }]} numberOfLines={1}>
                            {appt.clients?.name ?? "Sin cliente"}
                          </Text>
                          <Text style={[s.apptService, { color: t.muted }]} numberOfLines={1}>
                            {appt.services?.name ?? "Sin servicio"}
                          </Text>

                          {pro?.name && (
                            <View style={s.proRow}>
                              <View style={[s.proDot, { backgroundColor: proColor }]} />
                              <Text style={[s.proName, { color: t.muted }]}>{pro.name}</Text>
                            </View>
                          )}

                          {/* Actions */}
                          <View style={s.apptActions}>
                            {/* Status badge */}
                            <View style={[s.statusBadge, { backgroundColor: meta.color + "14" }]}>
                              <Ionicons name={meta.icon} size={12} color={meta.color} />
                              <Text style={[s.statusText, { color: meta.color }]}>{meta.label}</Text>
                            </View>

                            <View style={s.actionBtns}>
                              {/* Reschedule */}
                              <TouchableOpacity
                                style={s.actionBtn}
                                onPress={() => setReschedule(appt)}
                                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                              >
                                <Ionicons name="calendar-outline" size={15} color={Colors.blue} />
                              </TouchableOpacity>

                              {/* Mark no-show */}
                              {(appt.status === "pending" || appt.status === "confirmed") && (
                                <TouchableOpacity
                                  style={[s.actionBtn, { backgroundColor: Colors.red + "12" }]}
                                  onPress={() => Alert.alert(
                                    "No asistió",
                                    `¿Marcar a ${appt.clients?.name ?? "este cliente"} como no asistió?`,
                                    [
                                      { text: "Cancelar", style: "cancel" },
                                      { text: "Confirmar", style: "destructive", onPress: () => changeStatus(appt, "no_show") },
                                    ]
                                  )}
                                >
                                  <Ionicons name="person-remove-outline" size={15} color={Colors.red} />
                                </TouchableOpacity>
                              )}

                              {/* Confirm if pending */}
                              {appt.status === "pending" && (
                                <TouchableOpacity
                                  style={[s.actionBtn, { backgroundColor: Colors.success + "12" }]}
                                  onPress={() => changeStatus(appt, "confirmed")}
                                >
                                  <Ionicons name="checkmark-outline" size={15} color={Colors.success} />
                                </TouchableOpacity>
                              )}
                            </View>
                          </View>
                        </View>
                      </View>
                    </Animated.View>
                  );
                })}
              </Animated.View>
            );
          })}

          {/* Empty state */}
          {visibleAppts.length === 0 && (
            <Animated.View entering={FadeInDown.delay(100).duration(350)} style={[s.empty, Shadow.sm, { margin: 16, backgroundColor: t.bgAlt }]}>
              <Ionicons name="calendar-outline" size={40} color={t.subtle} style={{ marginBottom: 12 }} />
              <Text style={[s.emptyTitle, { color: t.text }]}>Sin citas próximas</Text>
              <Text style={[s.emptySub, { color: t.muted }]}>No hay citas agendadas para los próximos 14 días</Text>
            </Animated.View>
          )}
        </ScrollView>
      )}

      {tenantId && (
        <RescheduleModal
          appt={reschedule}
          tenantId={tenantId}
          onClose={() => setReschedule(null)}
          onSaved={load}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header:       { paddingTop: 16, paddingHorizontal: 24, paddingBottom: 20 },
  headerRow:    { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
  headerTitle:  { fontSize: 22, fontFamily: "SpaceGrotesk_700Bold", color: "white", letterSpacing: -0.4 },
  headerSub:    { fontSize: 12, color: "rgba(255,255,255,.75)", fontFamily: "SpaceGrotesk_400Regular", marginTop: 2 },
  iconBtn:      { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,.18)", alignItems: "center", justifyContent: "center" },
  statsPills:   { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statPill:     { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,.14)", borderRadius: Radius.full, paddingHorizontal: 12, paddingVertical: 6 },
  statPillText: { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: "white" },

  proFilter:  { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  proChip:    { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: Colors.white },
  proChipActive: { backgroundColor: Colors.red, borderColor: Colors.red },
  proChipText:{ fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  proColorDot:{ width: 8, height: 8, borderRadius: 4 },

  dayHeader:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  dayLabel:   { fontSize: 14, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text, textTransform: "capitalize" },
  dayMeta:    { flexDirection: "row", alignItems: "center", gap: 10 },
  dayCount:   { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted },
  dayRevenue: { fontSize: 12, fontFamily: "SpaceGrotesk_700Bold", color: Colors.success },

  apptCard:    { backgroundColor: Colors.white, borderRadius: Radius.lg, flexDirection: "row", marginHorizontal: 16, marginBottom: 10, overflow: "hidden" },
  apptAccent:  { width: 4 },
  apptTopRow:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  timePill:    { borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 4 },
  timeText:    { fontSize: 12, fontFamily: "SpaceGrotesk_700Bold" },
  apptPrice:   { fontSize: 14, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text },
  apptClient:  { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text, marginBottom: 2 },
  apptService: { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted },
  proRow:      { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  proDot:      { width: 7, height: 7, borderRadius: 3.5 },
  proName:     { fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted },
  apptActions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10 },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 5 },
  statusText:  { fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold" },
  actionBtns:  { flexDirection: "row", gap: 8 },
  actionBtn:   { width: 32, height: 32, borderRadius: 16, backgroundColor: Colors.blue + "12", alignItems: "center", justifyContent: "center" },

  empty:       { backgroundColor: Colors.white, borderRadius: Radius.xl, padding: 44, alignItems: "center" },
  emptyTitle:  { fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text, marginBottom: 6 },
  emptySub:    { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, textAlign: "center" },
});
