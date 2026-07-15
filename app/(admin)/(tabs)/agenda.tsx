import { useEffect, useState, useCallback } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, Modal, ActivityIndicator,
  KeyboardAvoidingView, Platform, TextInput,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown, FadeInRight } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { Colors, Gradients, Radius, Shadow, Glass } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { fmt12Hour } from "@/lib/format";
import { timeToMins, chunk, generateSlotsForDay, buildWeek } from "@/lib/scheduling";
import { STATUS_META, STATUS_OPTIONS } from "@/constants/status";
import NewApptModal from "@/components/NewApptModal";
import { MonoTag } from "@/components/ui";
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
        <View style={[dm.header, { backgroundColor: "#0C0C14" }]}>
          <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3 }} />
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
        </View>

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
    const dateStr = selectedDate.toISOString().split("T")[0];
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
      const dateStr = selectedDate.toISOString().split("T")[0];
      await supabase.from("appointments").update({
        professional_id:  selectedPro.id,
        service_id:       selectedService.id,
        appointment_date: dateStr,
        appointment_time: `${selectedTime}:00`,
        ...(selectedClient ? { client_id: selectedClient.id } : {}),
      }).eq("id", appt.id);
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  if (!appt) return null;

  const filteredClients = clients.filter(c =>
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
        <View style={[em.header, { backgroundColor: "#0C0C14" }]}>
          <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3 }} />
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
        </View>

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

function TimelineSlot({ time, slotAppts, professionals, showPro, onPressAppt, index }: {
  time: string; slotAppts: Appt[]; professionals: Professional[];
  showPro: boolean; onPressAppt: (a: Appt) => void; index: number;
}) {
  const hasConflict = slotAppts.length > 1;
  return (
    <Animated.View entering={FadeInRight.delay(index * 55).duration(320)} style={tl.slot}>
      {/* Time column */}
      <View style={tl.timeCol}>
        <Text style={[tl.timeText, hasConflict && { color: Colors.red }]}>{time}</Text>
        {hasConflict && (
          <View style={tl.conflictBadge}>
            <Text style={tl.conflictText}>{slotAppts.length}</Text>
          </View>
        )}
        <View style={[tl.line, hasConflict && { backgroundColor: Colors.red + "30" }]} />
      </View>

      {/* Cards column */}
      <View style={tl.cardsCol}>
        {slotAppts.map((a, i) => {
          const color    = STATUS_META[a.status]?.color ?? Colors.subtle;
          const label    = STATUS_META[a.status]?.label ?? a.status;
          const pColor   = a.professionals ? proColor(a.professionals.id, professionals) : Colors.subtle;

          return (
            <TouchableOpacity
              key={a.id}
              style={[tl.card, Shadow.sm, i > 0 && { marginTop: 6 }]}
              onPress={() => onPressAppt(a)}
              activeOpacity={0.8}
            >
              <View style={[tl.accent, { backgroundColor: color }]} />
              <View style={{ flex: 1, paddingVertical: 12, paddingRight: 12 }}>
                <Text style={tl.clientName} numberOfLines={1}>{a.clients?.name ?? "Sin cliente"}</Text>
                <Text style={tl.serviceName} numberOfLines={1}>{a.services?.name ?? "Sin servicio"}</Text>
                {showPro && a.professionals && (
                  <View style={tl.proRow}>
                    <View style={[tl.proDot, { backgroundColor: pColor }]} />
                    <Text style={[tl.proName, { color: pColor }]}>{a.professionals.name}</Text>
                  </View>
                )}
              </View>
              <View style={[tl.badge, { backgroundColor: color + "15" }]}>
                <Text style={[tl.badgeText, { color }]}>{label}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </Animated.View>
  );
}

const tl = StyleSheet.create({
  slot:        { flexDirection: "row", gap: 12, marginBottom: 8 },
  timeCol:     { width: 48, alignItems: "center", paddingTop: 14 },
  timeText:    { fontSize: 12, fontFamily: "SpaceGrotesk_700Bold", color: Colors.muted },
  conflictBadge:{ width: 18, height: 18, borderRadius: 9, backgroundColor: Colors.red, alignItems: "center", justifyContent: "center", marginTop: 4 },
  conflictText:{ fontSize: 9, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
  line:        { flex: 1, width: 1.5, backgroundColor: Colors.border, marginTop: 6, minHeight: 20 },
  cardsCol:    { flex: 1 },
  card:        { ...Glass.cardStrong, borderRadius: Radius.md, flexDirection: "row", alignItems: "stretch", overflow: "hidden" },
  accent:      { width: 4 },
  clientName:  { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text, paddingLeft: 10 },
  serviceName: { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, marginTop: 2, paddingLeft: 10 },
  proRow:      { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 5, paddingLeft: 10 },
  proDot:      { width: 6, height: 6, borderRadius: 3 },
  proName:     { fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold" },
  badge:       { borderRadius: Radius.full, paddingHorizontal: 9, paddingVertical: 4, alignSelf: "center", marginRight: 10 },
  badgeText:   { fontSize: 10, fontFamily: "SpaceGrotesk_600SemiBold" },
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
    const dateStr = date.toISOString().split("T")[0];
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

  const timeSlots = Object.entries(
    visible.reduce((acc, a) => {
      const t = a.appointment_time.slice(0, 5);
      acc[t] = [...(acc[t] ?? []), a];
      return acc;
    }, {} as Record<string, Appt[]>)
  ).sort(([a], [b]) => a.localeCompare(b));

  const conflictCount = timeSlots.filter(([, s]) => s.length > 1).length;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      {/* ── Header compacto ── */}
      <View style={s.header}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <MonoTag>Agenda</MonoTag>
          <Text style={[s.headerTitle, { color: t.ink }]}>
            {selected.toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" })}
          </Text>
          <Text style={[s.headerSub, { color: t.muted }]}>
            {appts.length} cita{appts.length !== 1 ? "s" : ""} · {appts.filter(a => a.status === "confirmed").length} confirmadas
            {conflictCount > 0 ? <Text style={{ color: "#d97706" }}> · {conflictCount} conflicto{conflictCount !== 1 ? "s" : ""}</Text> : null}
          </Text>
        </View>
        <TouchableOpacity onPress={() => setShowNew(true)} activeOpacity={0.85} style={s.addBtnWrap}>
          <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.addBtn}>
            <Ionicons name="add" size={20} color="white" />
          </LinearGradient>
        </TouchableOpacity>
      </View>

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

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 110 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.red} />}
      >
        {timeSlots.length === 0 ? (
          <Animated.View entering={FadeInDown.duration(400)} style={[s.empty, Shadow.sm]}>
            <Ionicons name="calendar-outline" size={40} color={Colors.subtle} style={{ marginBottom: 12 }} />
            <Text style={s.emptyTitle}>
              {filterProId
                ? `${professionals.find(p => p.id === filterProId)?.name.split(" ")[0]} no tiene citas`
                : "Sin citas este día"}
            </Text>
            <Text style={s.emptySub}>Toca + para agendar una nueva cita</Text>
          </Animated.View>
        ) : (
          timeSlots.map(([time, slotAppts], index) => (
            <TimelineSlot
              key={time}
              time={time}
              slotAppts={slotAppts}
              professionals={professionals}
              showPro={filterProId === null}
              onPressAppt={setDetailAppt}
              index={index}
            />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  header:      { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, paddingTop: 14, paddingHorizontal: 20, paddingBottom: 14 },
  headerTitle: { fontSize: 21, fontFamily: "SpaceGrotesk_700Bold", letterSpacing: -0.5, textTransform: "capitalize", marginTop: 3 },
  headerSub:   { fontSize: 12.5, fontFamily: "SpaceGrotesk_400Regular", marginTop: 3 },
  addBtnWrap:  { borderRadius: 19, overflow: "hidden" },
  addBtn:      { width: 38, height: 38, alignItems: "center", justifyContent: "center" },

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
