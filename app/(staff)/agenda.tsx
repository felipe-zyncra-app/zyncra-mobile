import { useEffect, useState, useCallback } from "react";
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl, Modal, Alert } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown, FadeInRight } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { Colors, Gradients, Radius, Shadow } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { MonoTag } from "@/components/ui";
import { STATUS_OPTIONS, STATUS_META } from "@/constants/status";
import { buildWeek } from "@/lib/scheduling";
import { localDateStr } from "@/lib/format";
import ErrorState from "@/components/ErrorState";
import { useStaffPermissions } from "@/lib/permissions";

const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

type Appt = {
  id: string;
  appointment_date: string;
  appointment_time: string;
  status: string;
  clients: { name: string; phone?: string } | null;
  services: { name: string; price?: number } | null;
};

function ApptDetailModal({ appt, onClose, onStatusChange }: {
  appt: Appt | null; onClose: () => void;
  onStatusChange: (id: string, status: string) => void;
}) {
  // Hooks antes del return condicional (regla de hooks: el orden no puede variar entre renders)
  const { t } = useTheme();
  const perms = useStaffPermissions();
  if (!appt) return null;
  const time = appt.appointment_time.substring(0, 5);
  const current = STATUS_OPTIONS.find(o => o.status === appt.status);
  return (
    <Modal visible={!!appt} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <View style={[dm.header, { backgroundColor: "#0C0C14" }]}>
          <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3 }} />
          <View style={dm.headerRow}>
            <TouchableOpacity onPress={onClose} style={dm.closeBtn}>
              <Ionicons name="close" size={20} color="white" />
            </TouchableOpacity>
            <Text style={dm.headerTitle}>Detalle de cita</Text>
            <View style={{ width: 40 }} />
          </View>
          <View style={{ alignItems: "center", marginTop: 8 }}>
            <Text style={dm.clientName}>{appt.clients?.name ?? "Sin cliente"}</Text>
            <Text style={dm.serviceName}>{appt.services?.name ?? "Sin servicio"}</Text>
            <View style={[dm.timeBadge]}>
              <Ionicons name="time-outline" size={14} color="rgba(255,255,255,.9)" />
              <Text style={dm.timeText}>{time}</Text>
            </View>
          </View>
        </View>

        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
          <Text style={dm.sectionLabel}>Estado de la cita</Text>
          <View style={dm.statusGrid}>
            {STATUS_OPTIONS.map(opt => {
              const active = appt.status === opt.status;
              return (
                <TouchableOpacity
                  key={opt.status}
                  style={[dm.statusBtn, active && { borderColor: opt.color, backgroundColor: opt.color + "14" }]}
                  onPress={() => { onStatusChange(appt.id, opt.status); onClose(); }}
                  activeOpacity={0.75}
                >
                  <Ionicons name={opt.icon} size={18} color={active ? opt.color : Colors.muted} />
                  <Text style={[dm.statusLabel, active && { color: opt.color }]}>{opt.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {perms.contact && appt.clients?.phone && (
            <View style={[dm.infoCard, Shadow.sm]}>
              <Ionicons name="call-outline" size={16} color={Colors.muted} />
              <Text style={dm.infoText}>{appt.clients.phone}</Text>
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const dm = StyleSheet.create({
  header:      { paddingTop: 16, paddingHorizontal: 20, paddingBottom: 24 },
  headerRow:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  closeBtn:    { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,.18)", alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
  clientName:  { fontSize: 22, fontFamily: "SpaceGrotesk_700Bold", color: "white", letterSpacing: -0.5, marginBottom: 4 },
  serviceName: { fontSize: 14, fontFamily: "SpaceGrotesk_400Regular", color: "rgba(255,255,255,.8)" },
  timeBadge:   { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,.18)", borderRadius: Radius.full, paddingHorizontal: 14, paddingVertical: 6, marginTop: 10 },
  timeText:    { fontSize: 14, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
  sectionLabel:{ fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", color: Colors.muted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 12 },
  statusGrid:  { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 20 },
  statusBtn:   { flex: 1, minWidth: "45%", flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: Colors.white, borderRadius: Radius.md, padding: 14, borderWidth: 1.5, borderColor: Colors.border },
  statusLabel: { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted },
  infoCard:    { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: Colors.white, borderRadius: Radius.md, padding: 14 },
  infoText:    { fontSize: 14, fontFamily: "SpaceGrotesk_400Regular", color: Colors.text },
});

export default function StaffAgendaScreen() {
  const { user } = useAuth();
  const { t } = useTheme();
  const [professionalId, setProfessionalId] = useState<string | null>(null);
  const [weekBase, setWeekBase]             = useState(new Date());
  const [selectedDate, setSelectedDate]     = useState(new Date());
  const [appts, setAppts]                   = useState<Appt[]>([]);
  const [selectedAppt, setSelectedAppt]     = useState<Appt | null>(null);
  const [refreshing, setRefreshing]         = useState(false);
  const [error, setError]                   = useState(false);

  const week = buildWeek(weekBase);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    supabase.from("professionals").select("id").eq("user_id", user.id).single()
      .then(({ data }) => { if (!cancelled && data) setProfessionalId(data.id); });
    return () => { cancelled = true; };
  }, [user]);

  const load = useCallback(async () => {
    if (!professionalId) return;
    try {
      setError(false);
      const dateStr = localDateStr(selectedDate);
      const { data, error: err } = await supabase
        .from("appointments")
        .select("id, appointment_date, appointment_time, status, clients(name, phone), services(name, price)")
        .eq("professional_id", professionalId)
        .eq("appointment_date", dateStr)
        .order("appointment_time");
      if (err) throw err;
      setAppts((data as unknown as Appt[]) ?? []);
    } catch {
      setError(true);
    }
  }, [professionalId, selectedDate]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const handleStatusChange = async (id: string, status: string) => {
    await supabase.from("appointments").update({ status }).eq("id", id);
    load();
  };

  const dateStr = selectedDate.toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={s.header}>
        <Animated.View entering={FadeInDown.duration(400)}>
          <MonoTag>Mi Agenda</MonoTag>
          <Text style={[s.headerTitle, { color: t.ink }]} numberOfLines={1}>{dateStr}</Text>
        </Animated.View>
      </View>

      {/* Week strip */}
      <View style={[s.weekStrip, Shadow.sm, { backgroundColor: t.bgAlt }]}>
        <TouchableOpacity style={s.weekArrow} onPress={() => { const d = new Date(weekBase); d.setDate(d.getDate() - 7); setWeekBase(d); }}>
          <Ionicons name="chevron-back" size={18} color={t.subtle} />
        </TouchableOpacity>
        {week.map((d) => {
          const isSelected = d.toDateString() === selectedDate.toDateString();
          const isToday    = d.toDateString() === new Date().toDateString();
          return (
            <TouchableOpacity key={d.toISOString()} style={s.dayBtn} onPress={() => setSelectedDate(d)} activeOpacity={0.7}>
              <Text style={[s.dayLabel, { color: t.muted }, isSelected && s.dayLabelSel, isToday && !isSelected && { color: Colors.red }]}>
                {DAYS[d.getDay()]}
              </Text>
              <View style={[s.dayNum, isSelected && s.dayNumSel]}>
                <Text style={[s.dayNumText, { color: t.text }, isSelected && s.dayNumTextSel]}>{d.getDate()}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity style={s.weekArrow} onPress={() => { const d = new Date(weekBase); d.setDate(d.getDate() + 7); setWeekBase(d); }}>
          <Ionicons name="chevron-forward" size={18} color={t.subtle} />
        </TouchableOpacity>
      </View>

      {error ? (
        <ErrorState onRetry={load} />
      ) : (
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.red} />}
      >
        {appts.length === 0 ? (
          <Animated.View entering={FadeInDown.delay(100).duration(400)} style={[s.empty, Shadow.sm, { backgroundColor: t.bgAlt }]}>
            <Ionicons name="calendar-outline" size={40} color={t.subtle} style={{ marginBottom: 12 }} />
            <Text style={[s.emptyTitle, { color: t.text }]}>Sin citas este día</Text>
            <Text style={[s.emptySub, { color: t.muted }]}>No tienes citas programadas para hoy</Text>
          </Animated.View>
        ) : (
          appts.map((a, i) => {
            const time = a.appointment_time.substring(0, 5);
            return (
              <Animated.View key={a.id} entering={i < 10 ? FadeInRight.delay(i * 70).duration(320) : undefined}>
                <TouchableOpacity style={[s.row, Shadow.sm, { backgroundColor: t.bgAlt }]} onPress={() => setSelectedAppt(a)} activeOpacity={0.8}>
                  <View style={[s.timePill, { backgroundColor: Colors.red + "12" }]}>
                    <Text style={[s.timeText, { color: Colors.red }]}>{time}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.clientName, { color: t.text }]} numberOfLines={1}>{a.clients?.name ?? "Sin cliente"}</Text>
                    <Text style={[s.serviceName, { color: t.muted }]} numberOfLines={1}>{a.services?.name ?? "Sin servicio"}</Text>
                  </View>
                  <View style={[s.badge, { backgroundColor: (STATUS_META[a.status]?.color ?? t.subtle) + "18" }]}>
                    <Text style={[s.badgeText, { color: STATUS_META[a.status]?.color ?? t.subtle }]}>
                      {STATUS_META[a.status]?.label ?? a.status}
                    </Text>
                  </View>
                </TouchableOpacity>
              </Animated.View>
            );
          })
        )}
      </ScrollView>
      )}

      <ApptDetailModal
        appt={selectedAppt}
        onClose={() => setSelectedAppt(null)}
        onStatusChange={handleStatusChange}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header:       { paddingTop: 14, paddingHorizontal: 20, paddingBottom: 14 },
  headerTitle:  { fontSize: 21, fontFamily: "SpaceGrotesk_700Bold", letterSpacing: -0.5, marginTop: 3, textTransform: "capitalize" },
  weekStrip:    { flexDirection: "row", alignItems: "center", backgroundColor: Colors.white, paddingHorizontal: 4, paddingVertical: 10 },
  weekArrow:    { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  dayBtn:       { flex: 1, alignItems: "center", gap: 4 },
  dayLabel:     { fontSize: 10, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted },
  dayLabelSel:  { color: Colors.red, fontFamily: "SpaceGrotesk_700Bold" },
  dayNum:       { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  dayNumSel:    { backgroundColor: Colors.red },
  dayNumText:   { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  dayNumTextSel:{ color: "white" },
  row:          { backgroundColor: Colors.white, borderRadius: Radius.md, padding: 14, flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  timePill:     { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  timeText:     { fontSize: 13, fontFamily: "SpaceGrotesk_700Bold" },
  clientName:   { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  serviceName:  { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, marginTop: 2 },
  badge:        { borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 5 },
  badgeText:    { fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold" },
  empty:        { backgroundColor: Colors.white, borderRadius: Radius.xl, padding: 40, alignItems: "center", marginTop: 20 },
  emptyTitle:   { fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text, marginBottom: 6 },
  emptySub:     { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, textAlign: "center" },
});
