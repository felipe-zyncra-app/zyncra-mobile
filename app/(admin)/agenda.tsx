import { useEffect, useState, useCallback, useRef } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, Modal, ActivityIndicator,
  KeyboardAvoidingView, Platform, TextInput, Alert,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { Colors, Gradients, Radius, Shadow, Glass } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { fmt12Hour, localDateStr } from "@/lib/format";
import { timeToMins, chunk, generateSlotsForDay, buildWeek } from "@/lib/scheduling";
import { useClientSearch } from "@/lib/useClientSearch";
import { STATUS_META, STATUS_OPTIONS } from "@/constants/status";
import NewApptModal from "@/components/NewApptModal";
import { scheduleAppointmentReminder, cancelAppointmentReminder } from "@/lib/notifications";

// ─── Scheduling helpers ─────────────────────────────────────────────────────

type ExistingBlock = { appointment_time: string; duration: number };
type DaySchedule   = { open: boolean; start: string; end: string };

function computeAvailable(slots: string[], existing: ExistingBlock[], duration: number): string[] {
  return slots.filter(slot => {
    const s = timeToMins(slot), e = s + duration;
    return existing.every(b => {
      const bs = timeToMins(b.appointment_time.slice(0, 5)), be = bs + b.duration;
      return e <= bs || s >= be;
    });
  });
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

const PRO_PALETTE = [
  "#e11d48", "#7c3aed", "#0284c7", "#059669", "#d97706", "#db2777",
];

// ─── Types ────────────────────────────────────────────────────────────────────

type Professional = { id: string; name: string; role?: string };

type EditClient  = { id: string; name: string; phone: string };
type EditService = { id: string; name: string; duration_minutes: number; price: number };

type Appt = {
  id: string;
  appointment_date: string;
  appointment_time: string;
  status: string;
  service_id: string;
  client_id: string | null;
  clients: { name: string } | null;
  services: { name: string; price?: number; duration_minutes?: number } | null;
  professionals: { id: string; name: string } | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function proColor(id: string, list: Professional[]) {
  const idx = list.findIndex(p => p.id === id);
  return PRO_PALETTE[idx % PRO_PALETTE.length] ?? Colors.muted;
}

function proInitials(name: string) {
  return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

// ─── Appointment detail modal ─────────────────────────────────────────────────

function ApptDetailModal({ appt, onClose, onStatusChange, onEdit }: {
  appt: Appt | null; onClose: () => void;
  onStatusChange: (id: string, status: string) => void;
  onEdit: () => void;
}) {
  const { t } = useTheme();
  if (!appt) return null;
  const time = appt.appointment_time.substring(0, 5);

  return (
    <Modal visible={!!appt} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: Colors.cream2 }}>
        <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={dm.header}>
          <View style={dm.headerRow}>
            <TouchableOpacity onPress={onClose} style={dm.closeBtn}>
              <Ionicons name="close" size={20} color="white" />
            </TouchableOpacity>
            <Text style={dm.headerTitle}>Detalle de cita</Text>
            <TouchableOpacity onPress={onEdit} style={dm.closeBtn}>
              <Ionicons name="create-outline" size={20} color="white" />
            </TouchableOpacity>
          </View>
          <View style={dm.summaryBox}>
            <Text style={dm.clientName}>{appt.clients?.name ?? "Sin cliente"}</Text>
            <Text style={dm.meta}>{appt.services?.name ?? "Sin servicio"}</Text>
            <Text style={dm.meta}>{time} — {appt.appointment_date}</Text>
            {appt.professionals?.name && (
              <Text style={dm.proMeta}>por {appt.professionals.name}</Text>
            )}
            {appt.services?.price != null && appt.services.price > 0 && (
              <Text style={dm.price}>${Math.round(appt.services.price).toLocaleString("es-CO")}</Text>
            )}
          </View>
        </LinearGradient>

        <ScrollView contentContainerStyle={{ padding: 20 }}>
          <Text style={dm.sectionLabel}>Estado de la cita</Text>
          <View style={{ gap: 10 }}>
            {STATUS_OPTIONS.map(opt => {
              const isActive = appt.status === opt.status;
              return (
                <TouchableOpacity
                  key={opt.status}
                  style={[dm.statusBtn, isActive && { borderColor: opt.color }]}
                  onPress={() => { onStatusChange(appt.id, opt.status); onClose(); }}
                  activeOpacity={0.75}
                >
                  {isActive && (
                    <View style={[StyleSheet.absoluteFill, { borderRadius: Radius.md, backgroundColor: opt.color + "10" }]} />
                  )}
                  <View style={[dm.statusIcon, { backgroundColor: opt.color + "15" }]}>
                    <Ionicons name={opt.icon} size={18} color={opt.color} />
                  </View>
                  <Text style={[dm.statusLabel, isActive && { color: opt.color }]}>{opt.label}</Text>
                  {isActive && <Ionicons name="checkmark-circle" size={18} color={opt.color} />}
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const dm = StyleSheet.create({
  header:      { paddingTop: 16, paddingHorizontal: 20, paddingBottom: 24 },
  headerRow:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 },
  closeBtn:    { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,.2)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.3)" },
  headerTitle: { fontSize: 18, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
  summaryBox:  { backgroundColor: "rgba(255,255,255,.18)", borderRadius: Radius.lg, padding: 16, alignItems: "center", gap: 4, borderWidth: 1, borderColor: "rgba(255,255,255,0.25)" },
  clientName:  { fontSize: 18, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
  meta:        { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: "rgba(255,255,255,.8)" },
  proMeta:     { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: "rgba(255,255,255,.65)", fontStyle: "italic" },
  price:       { fontSize: 22, fontFamily: "SpaceGrotesk_700Bold", color: "white", marginTop: 4 },
  sectionLabel:{ fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", color: Colors.muted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 14 },
  statusBtn:   { flexDirection: "row", alignItems: "center", gap: 12, ...Glass.cardStrong, borderRadius: Radius.md, padding: 14, overflow: "hidden" },
  statusIcon:  { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  statusLabel: { flex: 1, fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
});

// ─── Edit appointment modal ───────────────────────────────────────────────────

function EditApptModal({ appt, tenantId, professionals, onClose, onSaved }: {
  appt: Appt | null; tenantId: string; professionals: Professional[];
  onClose: () => void; onSaved: () => void;
}) {
  const { t } = useTheme();
  const [step, setStep]                       = useState(0);
  const [loading, setLoading]                 = useState(false);
  const [saving, setSaving]                   = useState(false);
  const [loadingSlots, setLoadingSlots]       = useState(false);

  const [clients, setClients]                 = useState<EditClient[]>([]);
  const [services, setServices]               = useState<EditService[]>([]);
  const [schedule, setSchedule]               = useState<Record<string, DaySchedule> | null>(null);

  const [selectedPro, setSelectedPro]         = useState<Professional | null>(null);
  const [selectedClient, setSelectedClient]   = useState<EditClient | null>(null);
  const [clientSearch, setClientSearch]       = useState("");
  // Con búsqueda activa se consulta el servidor: la lista local solo tiene 150 clientes
  const serverClients = useClientSearch(tenantId, clientSearch);
  const [selectedService, setSelectedService] = useState<EditService | null>(null);
  const [selectedDate, setSelectedDate]       = useState(new Date());
  const [weekBase, setWeekBase]               = useState(new Date());
  const [selectedTime, setSelectedTime]       = useState<string | null>(null);
  const [availableSlots, setAvailableSlots]   = useState<string[]>([]);
  const [dayClosed, setDayClosed]             = useState(false);

  // Init from existing appointment data
  useEffect(() => {
    if (!appt) return;
    setStep(0);
    setClientSearch("");
    setSelectedPro(appt.professionals ?? null);
    const date = new Date(appt.appointment_date + "T12:00:00");
    setSelectedDate(date);
    setWeekBase(date);
    setSelectedTime(null);
    setAvailableSlots([]);
    setSchedule(null);
    setLoading(true);

    Promise.all([
      supabase.from("clients").select("id, name, phone").eq("tenant_id", tenantId).order("name").limit(150),
      supabase.from("services").select("id, name, duration_minutes, price").eq("tenant_id", tenantId).order("name"),
      supabase.from("tenants").select("settings").eq("id", tenantId).single(),
    ]).then(([{ data: clis }, { data: svcs }, { data: tenant }]) => {
      const clientList  = (clis ?? []) as EditClient[];
      const serviceList = (svcs ?? []) as EditService[];
      setClients(clientList);
      setServices(serviceList);
      setSchedule((tenant?.settings as any)?.schedule ?? {});
      // Pre-select current client and service
      setSelectedClient(clientList.find(c => c.id === appt.client_id) ?? null);
      const svc = serviceList.find(s => s.id === appt.service_id);
      setSelectedService(svc ?? null);
      setLoading(false);
    });
  }, [appt?.id]);

  // Reload slots when entering step 3 or changing date
  useEffect(() => {
    if (step === 3 && selectedPro && selectedService && schedule !== null) {
      reloadSlots();
    }
  }, [step, selectedDate, schedule]);

  const reloadSlots = async () => {
    const duration = selectedService?.duration_minutes ?? 60;
    setLoadingSlots(true);
    setSelectedTime(null);
    setDayClosed(false);

    const dayKey   = String(selectedDate.getDay());
    const dayConfig = schedule?.[dayKey];
    if (!dayConfig?.open) {
      setDayClosed(true); setAvailableSlots([]); setLoadingSlots(false); return;
    }

    const slots   = generateSlotsForDay(dayConfig.start, dayConfig.end, duration);
    const dateStr = localDateStr(selectedDate);
    const proId   = selectedPro!.id;

    const { data: existing } = await supabase
      .from("appointments")
      .select("appointment_time, service_id")
      .eq("professional_id", proId)
      .eq("appointment_date", dateStr)
      .neq("status", "cancelled")
      .neq("id", appt!.id);

    if (!existing || existing.length === 0) {
      const avail = computeAvailable(slots, [], duration);
      setAvailableSlots(avail);
      const cur = appt!.appointment_time.slice(0, 5);
      if (avail.includes(cur)) setSelectedTime(cur);
      setLoadingSlots(false);
      return;
    }

    const svcIds = [...new Set(existing.map((a: any) => a.service_id).filter(Boolean))];
    const { data: svcs } = await supabase.from("services").select("id, duration_minutes").in("id", svcIds);
    const durMap = new Map((svcs ?? []).map((s: any) => [s.id, s.duration_minutes]));
    const blocks: ExistingBlock[] = existing.map((a: any) => ({
      appointment_time: a.appointment_time as string,
      duration: durMap.get(a.service_id) ?? 60,
    }));

    const avail = computeAvailable(slots, blocks, duration);
    setAvailableSlots(avail);
    const cur = appt!.appointment_time.slice(0, 5);
    if (avail.includes(cur)) setSelectedTime(cur);
    setLoadingSlots(false);
  };

  const handleSave = async () => {
    if (!appt || !selectedTime || !selectedService || !selectedPro) return;
    setSaving(true);
    try {
      const dateStr = localDateStr(selectedDate);
      const { error: saveError } = await supabase.from("appointments").update({
        professional_id:  selectedPro.id,
        service_id:       selectedService.id,
        appointment_date: dateStr,
        appointment_time: `${selectedTime}:00`,
        ...(selectedClient ? { client_id: selectedClient.id } : {}),
      }).eq("id", appt.id);
      if (saveError) {
        Alert.alert("No se pudo guardar la cita", "Revisa tu conexión e inténtalo de nuevo.");
        return;
      }
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  if (!appt) return null;

  const filteredClients = serverClients ?? clients.filter(c =>
    c.name.toLowerCase().includes(clientSearch.toLowerCase()) || c.phone.includes(clientSearch)
  );

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const week  = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekBase);
    d.setDate(weekBase.getDate() - weekBase.getDay() + i);
    return d;
  });

  const canStep0 = selectedPro !== null;
  const canStep1 = selectedClient !== null;
  const canStep2 = selectedService !== null;
  const canSave  = selectedTime !== null;
  const stepCanProceed = [canStep0, canStep1, canStep2, canSave];

  const STEP_LABELS = ["Paso 1 · Profesional", "Paso 2 · Cliente", "Paso 3 · Servicio", "Paso 4 · Fecha y hora"];

  return (
    <Modal visible={!!appt} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        {/* Header */}
        <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={em.header}>
          <View style={em.headerRow}>
            <TouchableOpacity onPress={step === 0 ? onClose : () => setStep(p => p - 1)} style={em.headerBtn}>
              <Text style={em.backText}>{step === 0 ? "✕" : "←"}</Text>
            </TouchableOpacity>
            <View style={{ alignItems: "center" }}>
              <Text style={em.headerTitle}>Modificar cita</Text>
              <Text style={em.headerSub}>{STEP_LABELS[step]}</Text>
            </View>
            <View style={{ width: 40 }} />
          </View>
          <View style={em.progressRow}>
            {STEP_LABELS.map((_, i) => (
              <View key={i} style={[em.progressDot, step >= i && em.progressActive]} />
            ))}
          </View>
        </LinearGradient>

        {loading ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator color={Colors.red} size="large" />
          </View>
        ) : (
          <>
            {/* ── STEP 0: PROFESSIONAL ── */}
            {step === 0 && (
              <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 120 }}>
                {professionals.map((p, i) => {
                  const idx    = professionals.findIndex(x => x.id === p.id);
                  const color  = PRO_PALETTE[idx % PRO_PALETTE.length];
                  const active = selectedPro?.id === p.id;
                  return (
                    <Animated.View key={p.id} entering={i < 10 ? FadeInDown.delay(i * 55).duration(300) : undefined}>
                      <TouchableOpacity
                        style={[em.selectCard, Shadow.sm, active && em.selectCardActive]}
                        onPress={() => setSelectedPro(p)}
                        activeOpacity={0.75}
                      >
                        <View style={[em.avatar, { backgroundColor: color + "20" }]}>
                          <Text style={[em.avatarText, { color }]}>
                            {p.name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase()}
                          </Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[em.cardTitle, active && { color: Colors.red }]}>{p.name}</Text>
                          <Text style={em.cardSub}>{p.role}</Text>
                        </View>
                        {active && <View style={em.check}><Text style={{ color: "white", fontSize: 11 }}>✓</Text></View>}
                      </TouchableOpacity>
                    </Animated.View>
                  );
                })}
              </ScrollView>
            )}

            {/* ── STEP 1: CLIENT ── */}
            {step === 1 && (
              <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
                <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
                  <View style={[em.searchBar, Shadow.sm]}>
                    <Text style={{ fontSize: 15, color: Colors.subtle }}>🔍</Text>
                    <TextInput
                      style={em.searchInput}
                      value={clientSearch}
                      onChangeText={setClientSearch}
                      placeholder="Buscar por nombre o teléfono..."
                      placeholderTextColor={Colors.subtle}
                    />
                    {clientSearch.length > 0 && (
                      <TouchableOpacity onPress={() => setClientSearch("")}>
                        <Text style={{ color: Colors.subtle, fontSize: 16 }}>✕</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  {filteredClients.map(c => (
                    <TouchableOpacity
                      key={c.id}
                      style={[em.selectCard, Shadow.sm, selectedClient?.id === c.id && em.selectCardActive]}
                      onPress={() => setSelectedClient(c)}
                      activeOpacity={0.75}
                    >
                      <View style={[em.avatar, { backgroundColor: Colors.red }]}>
                        <Text style={em.avatarWhite}>{c.name[0].toUpperCase()}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[em.cardTitle, selectedClient?.id === c.id && { color: Colors.red }]}>{c.name}</Text>
                        <Text style={em.cardSub}>{c.phone}</Text>
                      </View>
                      {selectedClient?.id === c.id && <View style={em.check}><Text style={{ color: "white", fontSize: 11 }}>✓</Text></View>}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </KeyboardAvoidingView>
            )}

            {/* ── STEP 2: SERVICE ── */}
            {step === 2 && (
              <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 120 }}>
                {services.map((svc, i) => (
                  <Animated.View key={svc.id} entering={i < 10 ? FadeInDown.delay(i * 55).duration(300) : undefined}>
                    <TouchableOpacity
                      style={[em.svcCard, Shadow.sm, selectedService?.id === svc.id && em.selectCardActive]}
                      onPress={() => setSelectedService(svc)}
                      activeOpacity={0.75}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[em.cardTitle, selectedService?.id === svc.id && { color: Colors.red }]}>{svc.name}</Text>
                        <Text style={em.cardSub}>⏱ {svc.duration_minutes} min</Text>
                      </View>
                      <View style={{ alignItems: "flex-end", gap: 6 }}>
                        <Text style={em.svcPrice}>${Number(svc.price).toLocaleString("es-CO")}</Text>
                        {selectedService?.id === svc.id && <View style={em.check}><Text style={{ color: "white", fontSize: 11 }}>✓</Text></View>}
                      </View>
                    </TouchableOpacity>
                  </Animated.View>
                ))}
              </ScrollView>
            )}

            {/* ── STEP 3: DATE + TIME ── */}
            {step === 3 && (
              <ScrollView contentContainerStyle={{ paddingBottom: 130 }}>
                {/* Service reminder */}
                {selectedService && (
                  <View style={em.durationNote}>
                    <Text style={em.durationNoteText}>{selectedService.name}  ·  ⏱ {selectedService.duration_minutes} min</Text>
                  </View>
                )}

                {/* Week strip */}
                <View style={[em.weekStrip, Shadow.sm]}>
                  <TouchableOpacity style={em.arrow} onPress={() => setWeekBase(d => { const n = new Date(d); n.setDate(n.getDate() - 7); return n; })}>
                    <Text style={em.arrowText}>‹</Text>
                  </TouchableOpacity>
                  {week.map((d, i) => {
                    const isPast   = d < today;
                    const isClosed = schedule ? schedule[String(d.getDay())]?.open === false : false;
                    const blocked  = isPast || isClosed;
                    const isSel    = d.toDateString() === selectedDate.toDateString();
                    const isToday  = d.toDateString() === new Date().toDateString();
                    return (
                      <TouchableOpacity
                        key={i}
                        style={[em.dayCol, blocked && { opacity: 0.3 }]}
                        onPress={() => { if (!blocked) setSelectedDate(new Date(d)); }}
                        disabled={blocked}
                        activeOpacity={0.7}
                      >
                        <Text style={[em.dayName, isSel && !blocked && { color: Colors.red }]}>{DAYS[d.getDay()]}</Text>
                        {isSel && !blocked ? (
                          <View style={[em.dayCircle, { backgroundColor: Colors.red }]}>
                            <Text style={[em.dayNum, { color: "white" }]}>{d.getDate()}</Text>
                          </View>
                        ) : (
                          <View style={[em.dayCircle, isToday && !blocked && { backgroundColor: Colors.red + "15" }]}>
                            <Text style={[em.dayNum, isToday && !blocked && { color: Colors.red }]}>{d.getDate()}</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                  <TouchableOpacity style={em.arrow} onPress={() => setWeekBase(d => { const n = new Date(d); n.setDate(n.getDate() + 7); return n; })}>
                    <Text style={em.arrowText}>›</Text>
                  </TouchableOpacity>
                </View>

                <View style={{ paddingHorizontal: 20, marginTop: 16 }}>
                  <Text style={em.sectionLabel}>Horas disponibles</Text>
                  {loadingSlots ? (
                    <View style={{ alignItems: "center", paddingVertical: 32 }}>
                      <ActivityIndicator color={Colors.red} />
                    </View>
                  ) : dayClosed ? (
                    <View style={[em.emptyBox, Shadow.sm]}>
                      <Text style={{ fontSize: 28, marginBottom: 8 }}>🚫</Text>
                      <Text style={em.emptyTitle}>Día no laborable</Text>
                    </View>
                  ) : availableSlots.length === 0 ? (
                    <View style={[em.emptyBox, Shadow.sm]}>
                      <Text style={{ fontSize: 28, marginBottom: 8 }}>😔</Text>
                      <Text style={em.emptyTitle}>Sin disponibilidad</Text>
                      <Text style={em.emptySub}>Prueba con otro día</Text>
                    </View>
                  ) : (
                    <View style={{ gap: 8 }}>
                      {chunk(availableSlots, 3).map((row, ri) => (
                        <View key={ri} style={{ flexDirection: "row", gap: 8 }}>
                          {row.map(t => (
                            <TouchableOpacity
                              key={t}
                              style={[em.timeSlot, { flex: 1 }, selectedTime === t && em.timeSlotActive]}
                              onPress={() => setSelectedTime(t)}
                              activeOpacity={0.75}
                            >
                              {selectedTime === t && (
                                <View style={[StyleSheet.absoluteFill, { backgroundColor: Colors.red }]} />
                              )}
                              <Text style={[em.timeSlotText, selectedTime === t && { color: "white" }]}>{fmt12Hour(t)}</Text>
                            </TouchableOpacity>
                          ))}
                          {row.length < 3 && Array.from({ length: 3 - row.length }).map((_, i) => (
                            <View key={`pad-${i}`} style={{ flex: 1 }} />
                          ))}
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              </ScrollView>
            )}

            {/* Bottom bar */}
            <View style={em.bottomBar}>
              {step < 3 ? (
                <TouchableOpacity
                  style={[em.btn, !stepCanProceed[step] && { opacity: 0.4 }]}
                  onPress={() => setStep(p => p + 1)}
                  disabled={!stepCanProceed[step]}
                  activeOpacity={0.85}
                >
                  <View style={em.btnGrad}>
                    <Text style={em.btnText}>Siguiente →</Text>
                  </View>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[em.btn, (!canSave || saving) && { opacity: 0.4 }]}
                  onPress={handleSave}
                  disabled={!canSave || saving}
                  activeOpacity={0.85}
                >
                  <View style={em.btnGrad}>
                    {saving ? <ActivityIndicator color="white" /> : <Text style={em.btnText}>Guardar cambios</Text>}
                  </View>
                </TouchableOpacity>
              )}
            </View>
          </>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const em = StyleSheet.create({
  header:         { paddingTop: 16, paddingHorizontal: 20, paddingBottom: 18 },
  headerRow:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  headerBtn:      { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,.2)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.3)" },
  backText:       { color: "white", fontSize: 18, fontFamily: "SpaceGrotesk_600SemiBold" },
  headerTitle:    { fontSize: 18, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
  headerSub:      { fontSize: 12, color: "rgba(255,255,255,.75)", fontFamily: "SpaceGrotesk_400Regular", marginTop: 2 },
  progressRow:    { flexDirection: "row", gap: 6 },
  progressDot:    { height: 4, flex: 1, borderRadius: 2, backgroundColor: "rgba(255,255,255,.3)" },
  progressActive: { backgroundColor: "rgba(255,255,255,.95)" },
  sectionLabel:   { fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", color: Colors.muted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 },
  selectCard:     { flexDirection: "row", alignItems: "center", ...Glass.cardStrong, borderRadius: Radius.lg, padding: 14, marginBottom: 10, gap: 14 },
  selectCardActive:{ borderColor: Colors.red, backgroundColor: "rgba(251,15,5,0.08)" },
  svcCard:        { flexDirection: "row", alignItems: "center", ...Glass.cardStrong, borderRadius: Radius.lg, padding: 16, marginBottom: 10 },
  svcPrice:       { fontSize: 14, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text },
  avatar:         { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  avatarText:     { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold" },
  avatarWhite:    { color: "white", fontSize: 15, fontFamily: "SpaceGrotesk_700Bold" },
  cardTitle:      { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text, marginBottom: 2 },
  cardSub:        { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted },
  check:          { width: 22, height: 22, borderRadius: 11, backgroundColor: Colors.red, alignItems: "center", justifyContent: "center" },
  searchBar:      { flexDirection: "row", alignItems: "center", ...Glass.card, borderRadius: Radius.lg, paddingHorizontal: 14, paddingVertical: 11, marginBottom: 12, gap: 8 },
  searchInput:    { flex: 1, fontSize: 14, fontFamily: "SpaceGrotesk_400Regular", color: Colors.text },
  durationNote:   { backgroundColor: Colors.red + "10", paddingHorizontal: 20, paddingVertical: 12 },
  durationNoteText:{ fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.red },
  weekStrip:      { ...Glass.cardStrong, flexDirection: "row", alignItems: "center", paddingVertical: 12, paddingHorizontal: 2 },
  arrow:          { width: 32, alignItems: "center" },
  arrowText:      { fontSize: 24, color: Colors.muted, lineHeight: 28 },
  dayCol:         { flex: 1, alignItems: "center", gap: 5 },
  dayName:        { fontSize: 10, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.subtle, textTransform: "uppercase" },
  dayCircle:      { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  dayNum:         { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  timeSlot:       { paddingVertical: 13, borderRadius: Radius.md, overflow: "hidden", ...Glass.card, alignItems: "center" },
  timeSlotActive: { borderWidth: 0 },
  timeSlotText:   { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  emptyBox:       { ...Glass.cardStrong, borderRadius: Radius.lg, padding: 32, alignItems: "center" },
  emptyTitle:     { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text, marginBottom: 4 },
  emptySub:       { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted },
  bottomBar:      { position: "absolute", bottom: 0, left: 0, right: 0, padding: 20, paddingBottom: 34, backgroundColor: "rgba(244,244,249,0.85)", borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.6)" },
  btn:            { borderRadius: Radius.full, overflow: "hidden" },
  btnGrad: { paddingVertical: 16, alignItems: "center", backgroundColor: Colors.red },
  btnText:        { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: "white", letterSpacing: 0.3 },
});

// ─── Professional filter chip ─────────────────────────────────────────────────

function ProChip({ label, initials, color, active, onPress }: {
  label: string; initials?: string; color?: string; active: boolean; onPress: () => void;
}) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.75} style={[pc.chip, active && pc.chipActive]}>
      {active && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: color ?? Colors.red, borderRadius: Radius.full }]} />
      )}
      {initials ? (
        <View style={[pc.avatar, { backgroundColor: active ? "rgba(255,255,255,.25)" : (color ?? Colors.red) + "18" }]}>
          <Text style={[pc.avatarText, { color: active ? "white" : (color ?? Colors.red) }]}>{initials}</Text>
        </View>
      ) : (
        <Ionicons name="people-outline" size={13} color={active ? "white" : Colors.muted} />
      )}
      <Text style={[pc.label, active && { color: "white" }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const pc = StyleSheet.create({
  chip:       { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: Radius.full, paddingVertical: 7, paddingHorizontal: 12, ...Glass.card, overflow: "hidden" },
  chipActive: { borderWidth: 0 },
  avatar:     { width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 9, fontFamily: "SpaceGrotesk_700Bold" },
  label:      { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted },
});

// ─── Timeline slot ────────────────────────────────────────────────────────────

const START_MINS = 8 * 60;   // 8:00 AM
const END_MINS   = 21 * 60;  // 9:00 PM
const SLOT_MINS  = 30;
const ROW_H      = 60;
const TIME_COL_W = 56;

// ─── Day Calendar ─────────────────────────────────────────────────────────────

function DayCalendar({ appts, professionals, onPressAppt, showPro, refreshing, onRefresh }: {
  appts: Appt[]; professionals: Professional[]; onPressAppt: (a: Appt) => void;
  showPro: boolean; refreshing: boolean; onRefresh: () => void;
}) {
  const { t } = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const now       = new Date();
  const nowMins   = now.getHours() * 60 + now.getMinutes();
  const nowY      = ((nowMins - START_MINS) / SLOT_MINS) * ROW_H;

  const slots: string[] = [];
  for (let m = START_MINS; m < END_MINS; m += SLOT_MINS) {
    const h = Math.floor(m / 60), mm = m % 60;
    slots.push(`${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`);
  }
  const totalH = slots.length * ROW_H;

  useEffect(() => {
    const offset = Math.max(0, nowY - 120);
    const timer = setTimeout(() => scrollRef.current?.scrollTo({ y: offset, animated: false }), 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <ScrollView
      ref={scrollRef}
      style={{ flex: 1 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.red} />}
      contentContainerStyle={{ paddingBottom: 110 }}
    >
      <View style={{ height: totalH, position: "relative" }}>

        {/* Grid lines */}
        {slots.map((time, i) => {
          const isHour   = time.endsWith(":00");
          const h        = parseInt(time.slice(0, 2), 10);
          const hLabel   = `${h % 12 || 12} ${h >= 12 ? "PM" : "AM"}`;
          const slotMins = START_MINS + i * SLOT_MINS;
          const isNow    = nowMins >= slotMins && nowMins < slotMins + SLOT_MINS;
          return (
            <View key={time} style={{ position: "absolute", top: i * ROW_H, left: 0, right: 0, height: ROW_H, flexDirection: "row" }}>
              <View style={{ width: TIME_COL_W, paddingTop: 8, paddingRight: 12, alignItems: "flex-end" }}>
                {isHour && (
                  <Text style={{ fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold", color: isNow ? Colors.red : t.subtle }}>
                    {hLabel}
                  </Text>
                )}
              </View>
              <View style={{ flex: 1, borderTopWidth: isHour ? 1 : StyleSheet.hairlineWidth, borderTopColor: isHour ? t.border : t.divider }} />
            </View>
          );
        })}

        {/* Current time indicator */}
        {nowMins >= START_MINS && nowMins < END_MINS && (
          <View style={{ position: "absolute", top: nowY, left: 0, right: 0, zIndex: 10, flexDirection: "row", alignItems: "center" }}>
            <View style={{ width: TIME_COL_W, alignItems: "flex-end", paddingRight: 6 }}>
              <View style={dg.nowDot} />
            </View>
            <View style={dg.nowLine} />
          </View>
        )}

        {/* Appointment blocks */}
        {appts.map(appt => {
          const startMins = timeToMins(appt.appointment_time.slice(0, 5));
          if (startMins < START_MINS || startMins >= END_MINS) return null;
          const duration = appt.services?.duration_minutes ?? 60;
          const top      = ((startMins - START_MINS) / SLOT_MINS) * ROW_H + 2;
          const height   = Math.max((duration / SLOT_MINS) * ROW_H - 4, ROW_H - 6);
          const color    = STATUS_META[appt.status]?.color ?? Colors.subtle;
          const label    = STATUS_META[appt.status]?.label ?? appt.status;
          const pColor   = appt.professionals ? proColor(appt.professionals.id, professionals) : Colors.subtle;
          return (
            <TouchableOpacity
              key={appt.id}
              style={[dg.block, Shadow.sm, { top, left: TIME_COL_W + 4, right: 8, height, backgroundColor: t.card, borderColor: color + "50" }]}
              onPress={() => onPressAppt(appt)}
              activeOpacity={0.85}
            >
              <View style={[dg.blockAccent, { backgroundColor: color }]} />
              <View style={{ flex: 1, paddingHorizontal: 8, paddingVertical: 5, gap: 1 }}>
                <Text style={[dg.blockClient, { color: t.text }]} numberOfLines={1}>{appt.clients?.name ?? "Sin cliente"}</Text>
                {height >= 40 && <Text style={[dg.blockService, { color: t.muted }]} numberOfLines={1}>{appt.services?.name ?? ""}</Text>}
                {height >= 60 && showPro && appt.professionals && (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 1 }}>
                    <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: pColor }} />
                    <Text style={[dg.blockPro, { color: pColor }]}>{appt.professionals.name.split(" ")[0]}</Text>
                  </View>
                )}
              </View>
              <View style={[dg.blockBadge, { backgroundColor: color + "20" }]}>
                <Text style={[dg.blockBadgeText, { color }]}>{label}</Text>
              </View>
            </TouchableOpacity>
          );
        })}

        {/* Empty state */}
        {appts.length === 0 && (
          <Animated.View
            entering={FadeInDown.duration(400)}
            style={[dg.emptyCard, { top: Math.max(8, nowY - 50), left: TIME_COL_W + 8, right: 8, backgroundColor: t.card, borderColor: t.cardBorder }]}
          >
            <Ionicons name="calendar-outline" size={30} color={t.subtle} />
            <Text style={[dg.emptyTitle, { color: t.text }]}>Sin citas este día</Text>
            <Text style={[dg.emptySub, { color: t.muted }]}>Toca + para agendar</Text>
          </Animated.View>
        )}
      </View>
    </ScrollView>
  );
}

const dg = StyleSheet.create({
  nowDot:        { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.red },
  nowLine:       { flex: 1, height: 2, backgroundColor: Colors.red, opacity: 0.75 },
  block:         { position: "absolute", borderRadius: 10, flexDirection: "row", overflow: "hidden", borderWidth: 1 },
  blockAccent:   { width: 4 },
  blockClient:   { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold" },
  blockService:  { fontSize: 10, fontFamily: "SpaceGrotesk_400Regular" },
  blockPro:      { fontSize: 9,  fontFamily: "SpaceGrotesk_600SemiBold" },
  blockBadge:    { paddingHorizontal: 6, paddingVertical: 4, alignSelf: "center", marginRight: 6, borderRadius: 6 },
  blockBadgeText:{ fontSize: 9, fontFamily: "SpaceGrotesk_700Bold" },
  emptyCard:     { position: "absolute", borderRadius: Radius.xl, borderWidth: 1, padding: 28, alignItems: "center", gap: 8 },
  emptyTitle:    { fontSize: 14, fontFamily: "SpaceGrotesk_700Bold" },
  emptySub:      { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", textAlign: "center" },
});

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function AgendaScreen() {
  const { t } = useTheme();
  const [selected, setSelected]       = useState(new Date());
  const [week, setWeek]               = useState(() => buildWeek(new Date()));
  const [appts, setAppts]             = useState<Appt[]>([]);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [filterProId, setFilterProId] = useState<string | null>(null);
  const { tenantId } = useAuth();
  const [refreshing, setRefreshing]   = useState(false);
  const [showNew, setShowNew]         = useState(false);
  const [refreshKey, setRefreshKey]   = useState(0);
  const [detailAppt, setDetailAppt]   = useState<Appt | null>(null);
  const [editAppt, setEditAppt]       = useState<Appt | null>(null);

  const loadAppts = useCallback(async (date: Date) => {
    if (!tenantId) return;
    const dateStr = localDateStr(date);
    const [{ data: apptData }, { data: proData }] = await Promise.all([
      supabase.from("appointments")
        .select("id, appointment_date, appointment_time, status, service_id, client_id, clients(name), services(name, price, duration_minutes), professionals(id, name)")
        .eq("tenant_id", tenantId)
        .eq("appointment_date", dateStr)
        .order("appointment_time"),
      supabase.from("professionals")
        .select("id, name")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .order("name"),
    ]);
    setAppts((apptData as unknown as Appt[]) ?? []);
    setProfessionals((proData as Professional[]) ?? []);
  }, [tenantId]);

  const handleStatusChange = async (id: string, status: string) => {
    await supabase.from("appointments").update({ status }).eq("id", id);
    if (status === "cancelled" || status === "completed") {
      await cancelAppointmentReminder(id);
    } else {
      const { data: a } = await supabase
        .from("appointments")
        .select("id, appointment_date, appointment_time, clients(name), services(name)")
        .eq("id", id).single();
      if (a) {
        const { data: settings } = await supabase
          .from("reminder_settings").select("hours_before, message_template")
          .eq("tenant_id", tenantId!).single();
        await scheduleAppointmentReminder(
          { id: a.id, date: (a as any).appointment_date, time: (a as any).appointment_time,
            clientName: (a.clients as any)?.name ?? "Cliente",
            serviceName: (a.services as any)?.name ?? "Servicio" },
          settings?.hours_before ?? 24,
          settings?.message_template ?? "Recordatorio: {{nombre}} – {{servicio}} el {{fecha}} a las {{hora}}"
        );
      }
    }
    await loadAppts(selected);
  };


  useEffect(() => {
    let cancelled = false;
    loadAppts(selected).then(() => { if (cancelled) return; });
    return () => { cancelled = true; };
  }, [selected, tenantId, refreshKey]);
  const onRefresh = async () => { setRefreshing(true); await loadAppts(selected); setRefreshing(false); };

  // Filter + group by time
  const visible = filterProId
    ? appts.filter(a => (a.professionals as any)?.id === filterProId)
    : appts;

  const conflictCount = (() => {
    const byTime: Record<string, number> = {};
    visible.forEach(a => { const k = a.appointment_time.slice(0, 5); byTime[k] = (byTime[k] ?? 0) + 1; });
    return Object.values(byTime).filter(n => n > 1).length;
  })();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      {/* ── Header ── */}
      <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.header}>
        <View style={s.headerBlob1} />
        <View style={s.headerBlob2} />

        <View style={s.headerTopRow}>
          <View style={s.headerIconBox}>
            <Ionicons name="calendar" size={16} color="white" />
          </View>
          <Text style={s.headerLabel}>Agenda</Text>
          <View style={{ flex: 1 }} />
          <TouchableOpacity style={s.addBtn} onPress={() => setShowNew(true)} activeOpacity={0.8}>
            <Ionicons name="add" size={22} color="white" />
          </TouchableOpacity>
        </View>

        <Text style={s.headerTitle}>
          {selected.toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" })}
        </Text>

        <View style={s.headerStatsRow}>
          <View style={s.headerStatPill}>
            <Text style={s.headerStatValue}>{appts.length}</Text>
            <Text style={s.headerStatLabel}>citas</Text>
          </View>
          <View style={s.headerStatDivider} />
          <View style={s.headerStatPill}>
            <Text style={s.headerStatValue}>{appts.filter(a => a.status === "confirmed").length}</Text>
            <Text style={s.headerStatLabel}>confirm.</Text>
          </View>
          {conflictCount > 0 && (
            <>
              <View style={s.headerStatDivider} />
              <View style={s.headerStatPill}>
                <Ionicons name="warning" size={11} color="#fbbf24" />
                <Text style={[s.headerStatLabel, { color: "#fbbf24" }]}>{conflictCount} conflicto{conflictCount !== 1 ? "s" : ""}</Text>
              </View>
            </>
          )}
        </View>
      </LinearGradient>

      {/* ── Week strip ── */}
      <View style={[s.weekStrip, Shadow.sm]}>
        <TouchableOpacity style={s.weekArrow} onPress={() => setWeek(buildWeek(new Date(week[0].getTime() - 86400000 * 7)))}>
          <Ionicons name="chevron-back" size={18} color={Colors.subtle} />
        </TouchableOpacity>
        {week.map((d, i) => {
          const isToday = d.toDateString() === new Date().toDateString();
          const isSel   = d.toDateString() === selected.toDateString();
          return (
            <TouchableOpacity key={i} style={s.dayCol} onPress={() => setSelected(d)} activeOpacity={0.7}>
              <Text style={[s.dayName, isSel && { color: Colors.red, fontFamily: "SpaceGrotesk_700Bold" }]}>
                {DAYS[d.getDay()]}
              </Text>
              <View style={[s.dayNum, isSel && s.dayNumSel, isToday && !isSel && { backgroundColor: Colors.red + "15" }]}>
                {isSel && <View style={[StyleSheet.absoluteFill, { backgroundColor: Colors.red, borderRadius: 12 }]} />}
                <Text style={[s.dayNumText, isSel && { color: "white" }, isToday && !isSel && { color: Colors.red }]}>
                  {d.getDate()}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity style={s.weekArrow} onPress={() => setWeek(buildWeek(new Date(week[0].getTime() + 86400000 * 7)))}>
          <Ionicons name="chevron-forward" size={18} color={Colors.subtle} />
        </TouchableOpacity>
      </View>

      {/* ── Professional filter ── */}
      {professionals.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.filterRow}
          style={s.filterStrip}
        >
          <ProChip
            label="Todos"
            active={filterProId === null}
            onPress={() => setFilterProId(null)}
          />
          {professionals.map(p => (
            <ProChip
              key={p.id}
              label={p.name.split(" ")[0]}
              initials={proInitials(p.name)}
              color={proColor(p.id, professionals)}
              active={filterProId === p.id}
              onPress={() => setFilterProId(prev => prev === p.id ? null : p.id)}
            />
          ))}
        </ScrollView>
      )}

      {/* ── Timeline ── */}
      {tenantId && (
        <NewApptModal
          visible={showNew}
          onClose={() => setShowNew(false)}
          tenantId={tenantId}
          initialDate={selected}
          onSuccess={() => setRefreshKey(k => k + 1)}
        />
      )}

      <ApptDetailModal
        appt={detailAppt}
        onClose={() => setDetailAppt(null)}
        onStatusChange={handleStatusChange}
        onEdit={() => { setEditAppt(detailAppt); setDetailAppt(null); }}
      />

      {tenantId && (
        <EditApptModal
          appt={editAppt}
          tenantId={tenantId}
          professionals={professionals}
          onClose={() => setEditAppt(null)}
          onSaved={() => { setEditAppt(null); setRefreshKey(k => k + 1); }}
        />
      )}

      <DayCalendar
        appts={visible}
        professionals={professionals}
        onPressAppt={setDetailAppt}
        showPro={filterProId === null}
        refreshing={refreshing}
        onRefresh={onRefresh}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  header:          { paddingTop: 14, paddingHorizontal: 20, paddingBottom: 16, overflow: "hidden" },
  headerBlob1:     { position: "absolute", width: 200, height: 200, borderRadius: 100, backgroundColor: "rgba(255,255,255,.06)", top: -80, right: -40 },
  headerBlob2:     { position: "absolute", width: 100, height: 100, borderRadius: 50, backgroundColor: "rgba(0,0,0,.05)", bottom: -30, left: -20 },
  headerTopRow:    { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14, position: "relative", zIndex: 1 },
  headerIconBox:   { width: 32, height: 32, borderRadius: 10, backgroundColor: "rgba(255,255,255,.15)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.2)" },
  headerLabel:     { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: "rgba(255,255,255,.8)" },
  headerTitle:     { fontSize: 22, fontFamily: "SpaceGrotesk_700Bold", color: "white", letterSpacing: -0.5, textTransform: "capitalize", marginBottom: 12, position: "relative", zIndex: 1 },
  headerStatsRow:  { flexDirection: "row", alignItems: "center", backgroundColor: "rgba(255,255,255,.14)", borderRadius: Radius.full, paddingVertical: 8, paddingHorizontal: 14, alignSelf: "flex-start", borderWidth: 1, borderColor: "rgba(255,255,255,0.2)", gap: 0, position: "relative", zIndex: 1 },
  headerStatPill:  { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 4 },
  headerStatValue: { fontSize: 14, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
  headerStatLabel: { fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold", color: "rgba(255,255,255,.75)" },
  headerStatDivider:{ width: 1, height: 14, backgroundColor: "rgba(255,255,255,.25)", marginHorizontal: 6 },
  addBtn:          { width: 38, height: 38, borderRadius: 19, backgroundColor: "rgba(255,255,255,.15)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.25)" },

  weekStrip:    { ...Glass.cardStrong, flexDirection: "row", paddingVertical: 12, paddingHorizontal: 4, alignItems: "center" },
  weekArrow:    { width: 32, alignItems: "center", justifyContent: "center" },
  dayCol:       { flex: 1, alignItems: "center", gap: 6 },
  dayName:      { fontSize: 10, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.subtle, textTransform: "uppercase" },
  dayNum:       { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  dayNumSel:    { borderRadius: 10 },
  dayNumText:   { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },

  filterStrip:  { backgroundColor: "rgba(255,255,255,0.65)", borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.5)", maxHeight: 56 },
  filterRow:    { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 10 },

  empty:        { ...Glass.cardStrong, borderRadius: Radius.xl, padding: 44, alignItems: "center", marginTop: 8 },
  emptyTitle:   { fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text, marginBottom: 6 },
  emptySub:     { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, textAlign: "center" },
});
