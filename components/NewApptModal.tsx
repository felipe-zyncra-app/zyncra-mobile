import { useState, useEffect } from "react";
import {
  Modal, View, Text, TouchableOpacity, StyleSheet,
  ScrollView, TextInput, ActivityIndicator,
  KeyboardAvoidingView, Platform, Alert,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";
import { supabase } from "@/lib/supabase";
import { Colors, Gradients, Radius, Shadow, Glass } from "@/constants/theme";
import { scheduleAppointmentReminder } from "@/lib/notifications";
import { timeToMins, generateSlotsForDay, buildWeek, chunk, hasSlotConflict } from "@/lib/scheduling";
import { useClientSearch } from "@/lib/useClientSearch";
import { fmt12Hour, localDateStr } from "@/lib/format";

type Service      = { id: string; name: string; duration_minutes: number; price: number };
type Client       = { id: string; name: string; phone: string };
type Professional = { id: string; name: string; role: string };
type ExistingBlock = { appointment_time: string; duration: number };

const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function computeAvailable(slots: string[], existing: ExistingBlock[], newDuration: number): string[] {
  return slots.filter(slot => {
    const slotStart = timeToMins(slot);
    const slotEnd   = slotStart + newDuration;
    return existing.every(block => {
      const blockStart = timeToMins(block.appointment_time.slice(0, 5));
      const blockEnd   = blockStart + block.duration;
      return slotEnd <= blockStart || slotStart >= blockEnd;
    });
  });
}


interface Props {
  visible: boolean;
  onClose: () => void;
  tenantId: string;
  initialDate?: Date;
  onSuccess: () => void;
}

export default function NewApptModal({ visible, onClose, tenantId, initialDate, onSuccess }: Props) {
  const [step, setStep]               = useState(0);
  const [loading, setLoading]         = useState(false);
  const [saving, setSaving]           = useState(false);
  const [loadingSlots, setLoadingSlots] = useState(false);

  const [clients, setClients]         = useState<Client[]>([]);
  const [services, setServices]       = useState<Service[]>([]);
  const [professionals, setPros]      = useState<Professional[]>([]);

  const [selectedPro, setSelectedPro]         = useState<Professional | null>(null);
  const [clientSearch, setClientSearch]       = useState("");
  const [isNewClient, setIsNewClient]         = useState(false);
  const [newClientName, setNewClientName]     = useState("");
  const [newClientPhone, setNewClientPhone]   = useState("");
  const [selectedClient, setSelectedClient]   = useState<Client | null>(null);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [selectedDate, setSelectedDate]       = useState(initialDate ?? new Date());
  const [weekBase, setWeekBase]               = useState(initialDate ?? new Date());
  const [selectedTime, setSelectedTime]       = useState<string | null>(null);
  const [availableSlots, setAvailableSlots]   = useState<string[]>([]);
  const [dayClosed, setDayClosed]             = useState(false);
  const [schedule, setSchedule]               = useState<Record<string, { open: boolean; start: string; end: string }> | null>(null);

  useEffect(() => {
    if (!visible) return;
    setStep(0);
    setSelectedPro(null);
    setSelectedClient(null);
    setSelectedService(null);
    setSelectedTime(null);
    setAvailableSlots([]);
    setDayClosed(false);
    setClientSearch("");
    setNewClientName("");
    setNewClientPhone("");
    setIsNewClient(false);
    const base = initialDate ?? new Date();
    setSelectedDate(base);
    setWeekBase(base);
    fetchData();
  }, [visible]);

  // Reload slots when date changes while on step 3
  useEffect(() => {
    if (step === 3 && selectedPro && selectedService) {
      loadSlots(selectedPro.id, selectedDate, selectedService.duration_minutes, schedule);
    }
  }, [step, selectedDate]);

  const fetchData = async () => {
    setLoading(true);
    const [{ data: svcs }, { data: pros }, { data: clis }, { data: tenant }] = await Promise.all([
      supabase.from("services").select("id, name, duration_minutes, price").eq("tenant_id", tenantId).order("name"),
      supabase.from("professionals").select("id, name, role").eq("tenant_id", tenantId).eq("is_active", true).order("name"),
      supabase.from("clients").select("id, name, phone").eq("tenant_id", tenantId).order("name").limit(150),
      supabase.from("tenants").select("settings").eq("id", tenantId).single(),
    ]);
    setServices(svcs ?? []);
    setPros(pros ?? []);
    setClients((clis ?? []).map(c => ({ ...c, phone: c.phone ?? "" })));
    setSchedule((tenant?.settings as any)?.schedule ?? null);
    setLoading(false);
  };

  const loadSlots = async (
    proId: string,
    date: Date,
    newDuration: number,
    tenantSchedule: typeof schedule,
  ) => {
    setLoadingSlots(true);
    setSelectedTime(null);
    setDayClosed(false);

    // Check if business is open on this day (JS day: 0=Sun … 6=Sat)
    const dayKey = String(date.getDay());
    const dayConfig = tenantSchedule?.[dayKey];

    if (!dayConfig?.open) {
      setDayClosed(true);
      setAvailableSlots([]);
      setLoadingSlots(false);
      return;
    }

    // Generate hourly slots that fit within business hours
    const slots = generateSlotsForDay(dayConfig.start, dayConfig.end, newDuration);

    const dateStr = localDateStr(date);
    const { data: appts } = await supabase
      .from("appointments")
      .select("appointment_time, service_id")
      .eq("professional_id", proId)
      .eq("appointment_date", dateStr)
      .neq("status", "cancelled");

    if (!appts || appts.length === 0) {
      setAvailableSlots(slots);
      setLoadingSlots(false);
      return;
    }

    const serviceIds = [...new Set(appts.map(a => a.service_id).filter(Boolean))];
    const { data: svcs } = await supabase
      .from("services")
      .select("id, duration_minutes")
      .in("id", serviceIds);

    const durMap = new Map((svcs ?? []).map(s => [s.id, s.duration_minutes]));

    const blocks: ExistingBlock[] = appts.map(a => ({
      appointment_time: a.appointment_time as string,
      duration: durMap.get(a.service_id) ?? 60,
    }));

    setAvailableSlots(computeAvailable(slots, blocks, newDuration));
    setLoadingSlots(false);
  };

  // Con búsqueda activa se consulta el servidor: la lista local solo tiene 150 clientes
  const serverClients = useClientSearch(tenantId, clientSearch);
  const filteredClients = serverClients ?? clients.filter(c =>
    c.name.toLowerCase().includes(clientSearch.toLowerCase()) ||
    c.phone.includes(clientSearch)
  );

  const clientName = isNewClient ? newClientName : (selectedClient?.name ?? "");
  const canStep0   = selectedPro !== null;
  const canStep1   = isNewClient ? newClientName.trim().length >= 2 : selectedClient !== null;
  const canStep2   = selectedService !== null;
  const canSave    = selectedTime !== null;

  const stepCanProceed = [canStep0, canStep1, canStep2, canSave];

  const handleSave = async () => {
    if (!canSave || !selectedService || !selectedPro || !selectedTime) return;
    setSaving(true);
    try {
      const dateStr = localDateStr(selectedDate);

      // El slot pudo ocuparse desde otro dispositivo mientras se completaba el formulario
      if (await hasSlotConflict(selectedPro.id, dateStr, timeToMins(selectedTime), selectedService.duration_minutes)) {
        Alert.alert("Horario ya ocupado", "Ese horario acaba de reservarse. Elige otro.");
        loadSlots(selectedPro.id, selectedDate, selectedService.duration_minutes, schedule);
        return;
      }

      let clientId = selectedClient?.id ?? null;

      if (isNewClient && newClientName.trim()) {
        const { data: newCli, error: cliError } = await supabase
          .from("clients")
          .insert({ tenant_id: tenantId, name: newClientName.trim(), phone: newClientPhone.trim() || null })
          .select("id")
          .single();
        if (cliError || !newCli) {
          Alert.alert("No se pudo crear el cliente", "Revisa tu conexión e inténtalo de nuevo.");
          return;
        }
        clientId = newCli.id;
      }

      const payload: Record<string, unknown> = {
        tenant_id:        tenantId,
        service_id:       selectedService.id,
        professional_id:  selectedPro.id,
        appointment_date: dateStr,
        appointment_time: `${selectedTime}:00`,
        status:           "pending",
      };
      if (clientId) payload.client_id = clientId;

      const { data: inserted, error: apptError } = await supabase
        .from("appointments").insert(payload).select("id").single();

      if (apptError || !inserted) {
        Alert.alert("No se pudo guardar la cita", "Revisa tu conexión e inténtalo de nuevo.");
        return;
      }

      const { data: settings } = await supabase
        .from("reminder_settings").select("hours_before, message_template")
        .eq("tenant_id", tenantId).single();
      await scheduleAppointmentReminder(
        {
          id: inserted.id,
          date: dateStr,
          time: `${selectedTime}:00`,
          clientName: isNewClient ? newClientName.trim() : (selectedClient?.name ?? "Cliente"),
          serviceName: selectedService.name,
        },
        settings?.hours_before ?? 24,
        settings?.message_template ?? "Recordatorio: {{nombre}} – {{servicio}} el {{fecha}} a las {{hora}}"
      ).catch(() => {});

      onSuccess();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const week  = buildWeek(weekBase);
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const STEP_LABELS = [
    "Paso 1 · Profesional",
    "Paso 2 · Cliente",
    "Paso 3 · Servicio",
    "Paso 4 · Fecha y hora",
  ];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: Colors.cream2 }}>

        {/* Header */}
        <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.header}>
          <View style={s.headerRow}>
            <TouchableOpacity onPress={step === 0 ? onClose : () => setStep(p => p - 1)} style={s.backBtn}>
              <Text style={s.backBtnText}>{step === 0 ? "✕" : "←"}</Text>
            </TouchableOpacity>
            <View style={{ alignItems: "center" }}>
              <Text style={s.headerTitle}>Nueva cita</Text>
              <Text style={s.headerSub}>{STEP_LABELS[step]}</Text>
            </View>
            <View style={{ width: 40 }} />
          </View>
          <View style={s.progressRow}>
            {STEP_LABELS.map((_, i) => (
              <View key={i} style={[s.progressDot, step >= i && s.progressActive]} />
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
                {professionals.length === 0 ? (
                  <View style={[s.card, { alignItems: "center", paddingVertical: 40 }, Shadow.sm]}>
                    <Text style={{ fontSize: 36, marginBottom: 12 }}>👷</Text>
                    <Text style={s.emptyTitle}>Sin profesionales</Text>
                    <Text style={s.emptySub}>Agrega el equipo en Ajustes → Equipo de trabajo</Text>
                  </View>
                ) : (
                  professionals.map((pro, i) => (
                    <Animated.View key={pro.id} entering={FadeInDown.delay(i * 55).duration(300)}>
                      <TouchableOpacity
                        style={[s.proCard, Shadow.sm, selectedPro?.id === pro.id && s.proCardActive]}
                        onPress={() => setSelectedPro(pro)}
                        activeOpacity={0.75}
                      >
                        <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.proAvatar}>
                          <Text style={s.proAvatarText}>{pro.name[0].toUpperCase()}</Text>
                        </LinearGradient>
                        <View style={{ flex: 1 }}>
                          <Text style={[s.proName, selectedPro?.id === pro.id && { color: Colors.red }]}>{pro.name}</Text>
                          <Text style={s.proRole}>{pro.role}</Text>
                        </View>
                        {selectedPro?.id === pro.id && (
                          <View style={s.check}><Text style={{ color: "white", fontSize: 11 }}>✓</Text></View>
                        )}
                      </TouchableOpacity>
                    </Animated.View>
                  ))
                )}
              </ScrollView>
            )}

            {/* ── STEP 1: CLIENT ── */}
            {step === 1 && (
              <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
                <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
                  <View style={[s.toggleRow, Shadow.sm]}>
                    <TouchableOpacity style={[s.toggleBtn, !isNewClient && s.toggleActive]} onPress={() => setIsNewClient(false)} activeOpacity={0.8}>
                      <Text style={[s.toggleText, !isNewClient && s.toggleTextActive]}>Existente</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[s.toggleBtn, isNewClient && s.toggleActive]} onPress={() => setIsNewClient(true)} activeOpacity={0.8}>
                      <Text style={[s.toggleText, isNewClient && s.toggleTextActive]}>Nuevo cliente</Text>
                    </TouchableOpacity>
                  </View>

                  {isNewClient ? (
                    <View style={[s.card, Shadow.sm]}>
                      <Text style={s.fieldLabel}>Nombre</Text>
                      <TextInput
                        style={s.input}
                        value={newClientName}
                        onChangeText={setNewClientName}
                        placeholder="Ej: Juan García"
                        placeholderTextColor={Colors.subtle}
                        autoFocus
                      />
                      <Text style={[s.fieldLabel, { marginTop: 14 }]}>Teléfono (opcional)</Text>
                      <TextInput
                        style={s.input}
                        value={newClientPhone}
                        onChangeText={setNewClientPhone}
                        placeholder="Ej: 300 123 4567"
                        placeholderTextColor={Colors.subtle}
                        keyboardType="phone-pad"
                      />
                    </View>
                  ) : (
                    <>
                      <View style={[s.searchBar, Shadow.sm]}>
                        <Text style={{ fontSize: 15, color: Colors.subtle }}>🔍</Text>
                        <TextInput
                          style={s.searchInput}
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
                      {filteredClients.length === 0 ? (
                        <View style={[s.card, { alignItems: "center", paddingVertical: 36 }, Shadow.sm]}>
                          <Text style={{ fontSize: 36, marginBottom: 10 }}>👤</Text>
                          <Text style={s.emptyTitle}>Sin clientes</Text>
                          <Text style={s.emptySub}>Cambia a "Nuevo cliente" para continuar</Text>
                        </View>
                      ) : (
                        filteredClients.map(c => (
                          <TouchableOpacity
                            key={c.id}
                            style={[s.clientRow, Shadow.sm, selectedClient?.id === c.id && s.clientRowActive]}
                            onPress={() => setSelectedClient(c)}
                            activeOpacity={0.75}
                          >
                            <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.avatarGrad}>
                              <Text style={s.avatarText}>{c.name[0].toUpperCase()}</Text>
                            </LinearGradient>
                            <View style={{ flex: 1 }}>
                              <Text style={s.clientName}>{c.name}</Text>
                              <Text style={s.clientPhone}>{c.phone}</Text>
                            </View>
                            {selectedClient?.id === c.id && (
                              <View style={s.check}><Text style={{ color: "white", fontSize: 11 }}>✓</Text></View>
                            )}
                          </TouchableOpacity>
                        ))
                      )}
                    </>
                  )}
                </ScrollView>
              </KeyboardAvoidingView>
            )}

            {/* ── STEP 2: SERVICE ── */}
            {step === 2 && (
              <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 120 }}>
                {services.length === 0 ? (
                  <View style={[s.card, { alignItems: "center", paddingVertical: 40 }, Shadow.sm]}>
                    <Text style={{ fontSize: 40, marginBottom: 12 }}>✂️</Text>
                    <Text style={s.emptyTitle}>Sin servicios</Text>
                    <Text style={s.emptySub}>Agrega servicios desde Ajustes para poder agendar</Text>
                  </View>
                ) : (
                  services.map((svc, i) => (
                    <Animated.View key={svc.id} entering={FadeInDown.delay(i * 55).duration(300)}>
                      <TouchableOpacity
                        style={[s.svcCard, Shadow.sm, selectedService?.id === svc.id && s.svcCardActive]}
                        onPress={() => setSelectedService(svc)}
                        activeOpacity={0.75}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={[s.svcName, selectedService?.id === svc.id && { color: Colors.red }]}>{svc.name}</Text>
                          <Text style={s.svcMeta}>⏱ {svc.duration_minutes} min</Text>
                        </View>
                        <View style={{ alignItems: "flex-end", gap: 6 }}>
                          <Text style={s.svcPrice}>${Number(svc.price).toLocaleString("es-CO")}</Text>
                          {selectedService?.id === svc.id && (
                            <View style={s.check}><Text style={{ color: "white", fontSize: 11 }}>✓</Text></View>
                          )}
                        </View>
                      </TouchableOpacity>
                    </Animated.View>
                  ))
                )}
              </ScrollView>
            )}

            {/* ── STEP 3: DATE + AVAILABLE SLOTS ── */}
            {step === 3 && (
              <ScrollView contentContainerStyle={{ paddingBottom: 130 }}>
                {/* Week strip */}
                <View style={[s.weekStrip, Shadow.sm]}>
                  <TouchableOpacity style={s.arrow} onPress={() => setWeekBase(d => { const n = new Date(d); n.setDate(n.getDate() - 7); return n; })}>
                    <Text style={s.arrowText}>‹</Text>
                  </TouchableOpacity>
                  {week.map((d, i) => {
                    const isPast   = d < today;
                    const isClosed = schedule ? schedule[String(d.getDay())]?.open === false : false;
                    const isBlocked = isPast || isClosed;
                    const isSel   = d.toDateString() === selectedDate.toDateString();
                    const isToday = d.toDateString() === new Date().toDateString();
                    return (
                      <TouchableOpacity
                        key={i}
                        style={[s.dayCol, isBlocked && { opacity: 0.3 }]}
                        onPress={() => { if (!isBlocked) setSelectedDate(new Date(d)); }}
                        disabled={isBlocked}
                        activeOpacity={0.7}
                      >
                        <Text style={[s.dayName, isSel && !isBlocked && { color: Colors.red }]}>{DAYS[d.getDay()]}</Text>
                        {isSel && !isBlocked ? (
                          <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.dayCircle}>
                            <Text style={[s.dayNum, { color: "white" }]}>{d.getDate()}</Text>
                          </LinearGradient>
                        ) : (
                          <View style={[s.dayCircle, isToday && !isBlocked && { backgroundColor: Colors.red + "15" }]}>
                            <Text style={[s.dayNum, isToday && !isBlocked && { color: Colors.red }]}>{d.getDate()}</Text>
                          </View>
                        )}
                        {isClosed && !isPast && <View style={s.closedBar} />}
                      </TouchableOpacity>
                    );
                  })}
                  <TouchableOpacity style={s.arrow} onPress={() => setWeekBase(d => { const n = new Date(d); n.setDate(n.getDate() + 7); return n; })}>
                    <Text style={s.arrowText}>›</Text>
                  </TouchableOpacity>
                </View>

                <View style={{ paddingHorizontal: 20, marginTop: 16 }}>
                  {/* Service duration reminder */}
                  {selectedService && (
                    <View style={s.durationNote}>
                      <Text style={s.durationNoteText}>
                        {selectedService.name}  ·  ⏱ {selectedService.duration_minutes} min
                      </Text>
                    </View>
                  )}

                  <Text style={[s.sectionLabel, { marginTop: 18 }]}>Horas disponibles</Text>

                  {loadingSlots ? (
                    <View style={{ alignItems: "center", paddingVertical: 40 }}>
                      <ActivityIndicator color={Colors.red} />
                      <Text style={[s.svcMeta, { marginTop: 10 }]}>Verificando agenda...</Text>
                    </View>
                  ) : dayClosed ? (
                    <View style={[s.card, { alignItems: "center", paddingVertical: 32 }, Shadow.sm]}>
                      <Text style={{ fontSize: 32, marginBottom: 10 }}>🚫</Text>
                      <Text style={s.emptyTitle}>Día no laborable</Text>
                      <Text style={s.emptySub}>El negocio no atiende este día</Text>
                    </View>
                  ) : availableSlots.length === 0 ? (
                    <View style={[s.card, { alignItems: "center", paddingVertical: 32 }, Shadow.sm]}>
                      <Text style={{ fontSize: 32, marginBottom: 10 }}>😔</Text>
                      <Text style={s.emptyTitle}>Sin disponibilidad</Text>
                      <Text style={s.emptySub}>La agenda está llena para este día</Text>
                    </View>
                  ) : (
                    <View style={{ gap: 8 }}>
                      {chunk(availableSlots, 3).map((row, ri) => (
                        <View key={ri} style={{ flexDirection: "row", gap: 8 }}>
                          {row.map(t => (
                            <TouchableOpacity
                              key={t}
                              style={[s.timeSlot, { flex: 1 }, selectedTime === t && s.timeSlotActive]}
                              onPress={() => setSelectedTime(t)}
                              activeOpacity={0.75}
                            >
                              {selectedTime === t && (
                                <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
                              )}
                              <Text style={[s.timeSlotText, selectedTime === t && { color: "white" }]}>{fmt12Hour(t)}</Text>
                            </TouchableOpacity>
                          ))}
                          {/* Fill empty cells in last row so flex alignment holds */}
                          {row.length < 3 && Array.from({ length: 3 - row.length }).map((_, i) => (
                            <View key={`pad-${i}`} style={{ flex: 1 }} />
                          ))}
                        </View>
                      ))}
                    </View>
                  )}

                  {canSave && selectedService && selectedPro && (
                    <Animated.View entering={FadeInDown.duration(300)} style={[s.summary, Shadow.md]}>
                      <Text style={s.summaryTitle}>Resumen de la cita</Text>
                      <SummaryRow label="Profesional" value={selectedPro.name} />
                      <SummaryRow label="Cliente"     value={clientName} />
                      <SummaryRow label="Servicio"    value={selectedService.name} />
                      <SummaryRow label="Duración"    value={`${selectedService.duration_minutes} min`} />
                      <SummaryRow label="Fecha"       value={selectedDate.toLocaleDateString("es-CO", { weekday: "short", day: "numeric", month: "short" })} />
                      <SummaryRow label="Hora"        value={fmt12Hour(selectedTime!)} />
                      <SummaryRow label="Valor"       value={`$${Number(selectedService.price).toLocaleString("es-CO")}`} highlight />
                    </Animated.View>
                  )}
                </View>
              </ScrollView>
            )}

            {/* Bottom bar */}
            <View style={s.bottomBar}>
              {step < 3 ? (
                <TouchableOpacity
                  style={[s.btn, !stepCanProceed[step] && { opacity: 0.4 }]}
                  onPress={() => setStep(p => p + 1)}
                  disabled={!stepCanProceed[step]}
                  activeOpacity={0.85}
                >
                  <View style={s.btnGrad}>
                    <Text style={s.btnText}>Siguiente →</Text>
                  </View>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[s.btn, (!canSave || saving) && { opacity: 0.4 }]}
                  onPress={handleSave}
                  disabled={!canSave || saving}
                  activeOpacity={0.85}
                >
                  <View style={s.btnGrad}>
                    {saving
                      ? <ActivityIndicator color="white" />
                      : <Text style={s.btnText}>✓  Confirmar cita</Text>
                    }
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

function SummaryRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={s.summaryRow}>
      <Text style={s.summaryLabel}>{label}</Text>
      <Text style={[s.summaryValue, highlight && { color: Colors.red, fontFamily: "SpaceGrotesk_700Bold" }]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  header:        { paddingTop: 16, paddingHorizontal: 20, paddingBottom: 18 },
  headerRow:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  backBtn:       { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,.2)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.3)" },
  backBtnText:   { color: "white", fontSize: 18, fontFamily: "SpaceGrotesk_600SemiBold" },
  headerTitle:   { fontSize: 18, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
  headerSub:     { fontSize: 12, color: "rgba(255,255,255,.75)", fontFamily: "SpaceGrotesk_400Regular", marginTop: 2 },
  progressRow:   { flexDirection: "row", gap: 6 },
  progressDot:   { height: 4, flex: 1, borderRadius: 2, backgroundColor: "rgba(255,255,255,.25)" },
  progressActive:{ backgroundColor: "rgba(255,255,255,.95)" },

  // Professional picker
  proCard:       { flexDirection: "row", alignItems: "center", ...Glass.cardStrong, borderRadius: Radius.lg, padding: 14, marginBottom: 10, gap: 14 },
  proCardActive: { borderColor: Colors.red, backgroundColor: "rgba(251,15,5,0.08)" },
  proAvatar:     { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  proAvatarText: { color: "white", fontSize: 16, fontFamily: "SpaceGrotesk_700Bold" },
  proName:       { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text, marginBottom: 2 },
  proRole:       { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted },

  // Client picker
  toggleRow:       { flexDirection: "row", ...Glass.card, borderRadius: Radius.lg, padding: 4, marginBottom: 16 },
  toggleBtn:       { flex: 1, paddingVertical: 10, borderRadius: Radius.md, alignItems: "center" },
  toggleActive:    { backgroundColor: Colors.red },
  toggleText:      { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted },
  toggleTextActive:{ color: "white" },

  card:       { ...Glass.cardStrong, borderRadius: Radius.lg, padding: 16, marginBottom: 12 },
  fieldLabel: { fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", color: Colors.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.6 },
  input:      { fontSize: 15, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text, borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md, padding: 12 },

  searchBar:   { flexDirection: "row", alignItems: "center", ...Glass.card, borderRadius: Radius.lg, paddingHorizontal: 14, paddingVertical: 11, marginBottom: 12, gap: 8 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "SpaceGrotesk_400Regular", color: Colors.text },

  clientRow:       { flexDirection: "row", alignItems: "center", ...Glass.cardStrong, borderRadius: Radius.lg, padding: 12, marginBottom: 8, gap: 12 },
  clientRowActive: { borderColor: Colors.red, backgroundColor: "rgba(251,15,5,0.08)" },
  avatarGrad:      { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  avatarText:      { color: "white", fontSize: 15, fontFamily: "SpaceGrotesk_700Bold" },
  clientName:      { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  clientPhone:     { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, marginTop: 2 },
  check:           { width: 22, height: 22, borderRadius: 11, backgroundColor: Colors.red, alignItems: "center", justifyContent: "center" },

  // Service picker
  svcCard:       { flexDirection: "row", alignItems: "center", ...Glass.cardStrong, borderRadius: Radius.lg, padding: 16, marginBottom: 10 },
  svcCardActive: { borderColor: Colors.red, backgroundColor: "rgba(251,15,5,0.08)" },
  svcName:       { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text, marginBottom: 4 },
  svcMeta:       { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted },
  svcPrice:      { fontSize: 14, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text },

  // Date + time
  durationNote:     { backgroundColor: Colors.red + "10", borderRadius: Radius.md, padding: 12 },
  durationNoteText: { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.red },

  weekStrip: { ...Glass.cardStrong, flexDirection: "row", alignItems: "center", paddingVertical: 13, paddingHorizontal: 2 },
  arrow:     { width: 34, alignItems: "center" },
  arrowText: { fontSize: 26, color: Colors.muted, lineHeight: 30 },
  dayCol:    { flex: 1, alignItems: "center", gap: 6 },
  dayName:   { fontSize: 10, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.subtle, textTransform: "uppercase" },
  dayCircle: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  dayNum:    { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  closedBar: { width: 16, height: 2, borderRadius: 1, backgroundColor: Colors.muted },

  sectionLabel: { fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", color: Colors.muted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 },
  timeGrid:     { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  timeSlot:     { paddingVertical: 13, borderRadius: Radius.md, overflow: "hidden", ...Glass.card, alignItems: "center" },
  timeSlotActive:{ borderWidth: 0 },
  timeSlotText: { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },

  // Summary
  summary:      { ...Glass.cardStrong, borderRadius: Radius.xl, padding: 20, marginTop: 22 },
  summaryTitle: { fontSize: 14, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text, marginBottom: 14 },
  summaryRow:   { flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  summaryLabel: { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted },
  summaryValue: { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },

  // Bottom
  bottomBar: { position: "absolute", bottom: 0, left: 0, right: 0, padding: 20, paddingBottom: 34, backgroundColor: "rgba(244,244,249,0.85)", borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.6)" },
  btn:       { borderRadius: Radius.full, overflow: "hidden" },
  btnGrad: { paddingVertical: 16, alignItems: "center", backgroundColor: Colors.red },
  btnText:   { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: "white", letterSpacing: 0.3 },

  emptyTitle: { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text, marginBottom: 6 },
  emptySub:   { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, textAlign: "center" },
});
