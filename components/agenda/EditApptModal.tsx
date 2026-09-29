import { useEffect, useMemo, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Modal, ActivityIndicator,
  KeyboardAvoidingView, Platform, TextInput, Alert,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { supabase } from "@/lib/supabase";
import { Colors, Fonts, Gradients, Radius, Shadow } from "@/constants/theme";
import { useTheme, type ThemeColors } from "@/lib/theme";
import { useTenant } from "@/lib/tenant";
import { useClientSearch } from "@/lib/useClientSearch";
import { reprogramarRecordatorioCita } from "@/lib/notifications";
import { exigirFilas, mensajeError, revisar } from "@/lib/db";
import { fmtDia, inicioDeSemana, minutosDelDia } from "@/lib/tz";
import { fmtMoneyFull, fmtTelefono } from "@/lib/format";
import { useGuardRespuestas, useHoyNegocio } from "@/lib/useRecarga";
import {
  avisosDeHorario, cargarCatalogoAgenda, duracionServicio, effectiveDayHours, mensajeErrorCita,
  timeToMins, verificarCupo,
  type CatalogoAgenda, type ProfesionalAgenda, type ServicioAgenda,
} from "@/lib/scheduling";
import ErrorState from "@/components/ErrorState";
import { IconButton } from "@/components/ui";
import SemanaStrip from "./SemanaStrip";
import SelectorHora from "./SelectorHora";
import { useCuposDelDia } from "./useCupos";
import { confirmar, PRO_PALETTE, proInitials, type ApptAgenda } from "./tipos";

type EditClient = { id: string; name: string; phone: string };

/** Área táctil extra de los botones pequeños (CAL-24). */
const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

const STEP_LABELS = ["Paso 1 · Profesional", "Paso 2 · Cliente", "Paso 3 · Servicio", "Paso 4 · Fecha y hora"];

/**
 * Modificar una cita (profesional, cliente, servicio, fecha y hora).
 *
 * Comparte con Nueva cita las reglas de lib/scheduling y el paso de hora
 * (SelectorHora + useCuposDelDia): respeta blocked_slots, no toma un error de
 * red como "día libre", revalida contra la base justo antes de guardar y
 * reprograma el recordatorio local (antes llegaba a la hora vieja, AGE-09).
 * El cliente de la cita queda preseleccionado aunque no esté entre los 150
 * primeros, y una cita sin cliente se puede reagendar sin asignarle uno (AGE-22).
 */
export default function EditApptModal({ appt, tenantId, professionals, onClose, onSaved }: {
  appt: ApptAgenda | null;
  tenantId: string;
  /** Profesionales activos (ya filtrados por sede). */
  professionals: ProfesionalAgenda[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const router = useRouter();
  const { t } = useTheme();
  const s = useMemo(() => crearEstilos(t), [t]);
  const { timezone } = useTenant();
  const hoy = useHoyNegocio(timezone);
  const guard = useGuardRespuestas();

  const [step, setStep]                       = useState(0);
  const [loading, setLoading]                 = useState(false);
  const [loadError, setLoadError]             = useState<unknown>(null);
  const [saving, setSaving]                   = useState(false);

  const [catalogo, setCatalogo]               = useState<CatalogoAgenda | null>(null);
  const [clients, setClients]                 = useState<EditClient[]>([]);
  const [selectedPro, setSelectedPro]         = useState<ProfesionalAgenda | null>(null);
  const [selectedClient, setSelectedClient]   = useState<EditClient | null>(null);
  const [clientSearch, setClientSearch]       = useState("");
  // Con búsqueda activa se consulta el servidor: la lista local solo tiene 150 clientes
  const serverClients = useClientSearch(tenantId, clientSearch);
  const [selectedService, setSelectedService] = useState<ServicioAgenda | null>(null);
  const [selectedDay, setSelectedDay]         = useState("");
  const [semana, setSemana]                   = useState("");
  const [selectedTime, setSelectedTime]       = useState<string | null>(null);

  const apptId = appt?.id ?? null;

  const cargar = async () => {
    if (!appt) return;
    const turno = guard.nuevo();
    setLoading(true);
    setLoadError(null);
    try {
      const [cat, clis] = await Promise.all([
        cargarCatalogoAgenda(tenantId),
        supabase.from("clients").select("id, name, phone").eq("tenant_id", tenantId).order("name").order("id").limit(150),
      ]);
      const lista = (revisar(clis, "No se pudieron cargar los clientes") ?? [])
        .map((c: { id: string; name: string; phone: string | null }) => ({ ...c, phone: c.phone ?? "" }));
      if (!turno.vigente()) return;
      setCatalogo(cat);
      setClients(lista);
      // El servicio actual aunque esté archivado: modificar la hora no debe
      // obligar a cambiar de servicio.
      const svc = cat.servicios.find(x => x.id === appt.service_id)
        ?? (appt.service_id && appt.services
          ? { id: appt.service_id, name: appt.services.name, price: Number(appt.services.price ?? 0), duracion: duracionServicio(appt.services), activo: false }
          : null);
      setSelectedService(svc);
    } catch (e) {
      if (turno.vigente()) setLoadError(e);
    } finally {
      if (turno.vigente()) setLoading(false);
    }
  };

  // Estado inicial desde la cita.
  useEffect(() => {
    if (!appt) return;
    setStep(0);
    setClientSearch("");
    setSelectedPro(professionals.find(p => p.id === appt.professional_id)
      ?? (appt.professionals ? { id: appt.professionals.id, name: appt.professionals.name } : null));
    setSelectedClient(appt.client_id
      ? { id: appt.client_id, name: appt.clients?.name ?? "Cliente", phone: appt.clients?.phone ?? "" }
      : null);
    setSelectedDay(appt.appointment_date);
    setSemana(inicioDeSemana(appt.appointment_date));
    setSelectedTime(appt.appointment_time.slice(0, 5));
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apptId]);

  // Profesionales para elegir: los de la sede y, si no está, el de la cita.
  const listaPros = useMemo(() => {
    if (!appt?.professionals || professionals.some(p => p.id === appt.professionals!.id)) return professionals;
    return [...professionals, { id: appt.professionals.id, name: appt.professionals.name }];
  }, [professionals, appt?.professionals]);

  const servicios = useMemo(() => {
    const activos = (catalogo?.servicios ?? []).filter(x => x.activo);
    if (selectedService && !activos.some(x => x.id === selectedService.id)) return [selectedService, ...activos];
    return activos;
  }, [catalogo, selectedService]);

  const cupos = useCuposDelDia({
    tenantId,
    profesional: selectedPro,
    duracion: selectedService?.duracion ?? null,
    dia: selectedDay,
    horario: catalogo?.horario ?? null,
    intervalo: catalogo?.intervalo ?? 30,
    habilitado: !!appt && step === 3,
    excluirCitaId: appt?.id ?? null,
    hoy,
    timezone,
  });

  if (!appt) return null;

  const esDiaOriginal = selectedDay === appt.appointment_date;
  const filteredClients = serverClients ?? clients.filter(c =>
    c.name.toLowerCase().includes(clientSearch.toLowerCase()) || c.phone.includes(clientSearch)
  );
  // El cliente de la cita arriba aunque no esté en la lista cargada.
  const clientesMostrados = selectedClient && !clientSearch && !filteredClients.some(c => c.id === selectedClient.id)
    ? [selectedClient, ...filteredClients]
    : filteredClients;

  const horaFueraDeGrilla = selectedTime !== null && !cupos.cupos.includes(selectedTime);
  const avisosHora = (() => {
    if (!selectedTime || !selectedService || !horaFueraDeGrilla || cupos.estado === "cargando") return [];
    // La hora que ya tenía la cita no se cuestiona si no se movió.
    if (esDiaOriginal && selectedTime === appt.appointment_time.slice(0, 5) && selectedPro?.id === appt.professional_id) return [];
    const avisos = avisosDeHorario(cupos.horarioDia, selectedTime, selectedService.duracion);
    if (selectedDay === hoy && timeToMins(selectedTime) < minutosDelDia(new Date(), timezone)) avisos.push("Esa hora de hoy ya pasó.");
    return avisos;
  })();

  const canStep0 = selectedPro !== null;
  // Una cita sin cliente se puede reagendar sin asignarle uno.
  const canStep1 = selectedClient !== null || !appt.client_id;
  const canStep2 = selectedService !== null;
  const canSave  = selectedTime !== null && (selectedDay >= hoy || esDiaOriginal);
  const stepCanProceed = [canStep0, canStep1, canStep2, canSave];

  const handleSave = async () => {
    if (!selectedTime || !selectedService || !selectedPro || saving) return;
    if (selectedDay < hoy && !esDiaOriginal) {
      Alert.alert("Fecha pasada", "No se puede mover una cita a un día que ya pasó.");
      return;
    }
    if (avisosHora.length > 0) {
      const seguir = await confirmar("¿Guardar a esta hora?", avisosHora.join("\n"), "Guardar igual");
      if (!seguir) return;
    }
    setSaving(true);
    try {
      // El cupo pudo ocuparse desde otro dispositivo (o con una ausencia
      // cargada en el web) mientras se editaba.
      let v;
      try {
        v = await verificarCupo({
          tenantId, professionalId: selectedPro.id, dia: selectedDay, hora: selectedTime,
          duracion: selectedService.duracion, excluirCitaId: appt.id,
        });
      } catch (e) {
        Alert.alert("No se pudo verificar el horario", mensajeError(e));
        return;
      }
      if (!v.ok) {
        Alert.alert("Horario no disponible", v.motivo);
        cupos.recargar();
        return;
      }

      const payload: {
        professional_id: string; service_id: string; appointment_date: string; appointment_time: string;
        client_id?: string; location_id?: string;
      } = {
        professional_id:  selectedPro.id,
        service_id:       selectedService.id,
        appointment_date: selectedDay,
        appointment_time: `${selectedTime}:00`,
      };
      if (selectedClient) payload.client_id = selectedClient.id;
      // Si se cambia a un profesional de otra sede, la cita se va con él.
      if (selectedPro.location_id) payload.location_id = selectedPro.location_id;

      try {
        exigirFilas(
          await supabase.from("appointments").update(payload).eq("id", appt.id).select("id"),
          "No se pudo guardar la cita",
        );
      } catch (e) {
        Alert.alert("No se pudo guardar la cita", mensajeErrorCita(e));
        return;
      }

      // El aviso del teléfono pasa a la nueva fecha y hora (o se cancela si
      // la cita ya no está vigente).
      reprogramarRecordatorioCita(tenantId, {
        id: appt.id,
        date: selectedDay,
        time: `${selectedTime}:00`,
        clientName: selectedClient?.name ?? appt.clients?.name ?? "Cliente",
        serviceName: selectedService.name,
        status: appt.status,
      }, timezone).catch(() => {});

      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const diaCerrado = (d: string) =>
    !!selectedPro && !!catalogo && !effectiveDayHours(d, catalogo.horario, selectedPro.schedule).open;

  return (
    <Modal visible={!!appt} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        {/* Header */}
        <View style={[s.header, { backgroundColor: "#0C0C14" }]}>
          <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3 }} />
          <View style={s.headerRow}>
            <IconButton
              icon={step === 0 ? "close" : "arrow-back"}
              label={step === 0 ? "Cerrar" : "Paso anterior"}
              onPress={step === 0 ? onClose : () => setStep(p => p - 1)}
              tone="plain"
              size={20}
              color="white"
              style={s.headerBtn}
            />
            <View style={{ alignItems: "center" }}>
              <Text style={s.headerTitle}>Modificar cita</Text>
              <Text style={s.headerSub}>{STEP_LABELS[step]}</Text>
            </View>
            <View style={{ width: 40 }} />
          </View>
          <View style={s.progressRow}>
            {STEP_LABELS.map((_, i) => (
              <View key={i} style={[s.progressDot, step >= i && s.progressActive]} />
            ))}
          </View>
        </View>

        {loading ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator color={Colors.red} size="large" />
          </View>
        ) : loadError ? (
          <ErrorState error={loadError} onRetry={cargar} />
        ) : (
          <>
            {/* ── STEP 0: PROFESSIONAL ── */}
            {step === 0 && (
              <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 120 }}>
                {listaPros.map((p, i) => {
                  const color  = PRO_PALETTE[i % PRO_PALETTE.length];
                  const active = selectedPro?.id === p.id;
                  return (
                    <Animated.View key={p.id} entering={i < 10 ? FadeInDown.delay(i * 55).duration(300) : undefined}>
                      <TouchableOpacity
                        style={[s.selectCard, Shadow.sm, active && s.selectCardActive]}
                        onPress={() => setSelectedPro(p)}
                        activeOpacity={0.75}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                      >
                        <View style={[s.avatar, { backgroundColor: color + "20" }]}>
                          <Text style={[s.avatarText, { color }]}>{proInitials(p.name)}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[s.cardTitle, active && { color: Colors.red }]}>{p.name}</Text>
                          {!!p.role && <Text style={s.cardSub}>{p.role}</Text>}
                        </View>
                        {active && <View style={s.check}><Text style={{ color: "white", fontSize: 11 }}>✓</Text></View>}
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
                  <View style={[s.searchBar, Shadow.sm]}>
                    <Text style={{ fontSize: 15, color: t.subtle }}>🔍</Text>
                    <TextInput
                      style={s.searchInput}
                      value={clientSearch}
                      onChangeText={setClientSearch}
                      placeholder="Buscar por nombre o teléfono..."
                      placeholderTextColor={t.subtle}
                    />
                    {clientSearch.length > 0 && (
                      <TouchableOpacity onPress={() => setClientSearch("")} accessibilityRole="button" accessibilityLabel="Borrar búsqueda" hitSlop={HIT_SLOP}>
                        <Text style={{ color: t.subtle, fontSize: 16 }}>✕</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  {!appt.client_id && (
                    <Text style={[s.cardSub, { marginBottom: 12 }]}>
                      Esta cita no tiene cliente. Puedes asignarle uno o seguir sin cliente.
                    </Text>
                  )}
                  {clientesMostrados.map(c => (
                    <TouchableOpacity
                      key={c.id}
                      style={[s.selectCard, Shadow.sm, selectedClient?.id === c.id && s.selectCardActive]}
                      onPress={() => setSelectedClient(c)}
                      activeOpacity={0.75}
                      accessibilityRole="button"
                      accessibilityState={{ selected: selectedClient?.id === c.id }}
                    >
                      <View style={[s.avatar, { backgroundColor: Colors.red }]}>
                        <Text style={s.avatarWhite}>{(c.name[0] ?? "?").toUpperCase()}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.cardTitle, selectedClient?.id === c.id && { color: Colors.red }]}>{c.name}</Text>
                        {!!c.phone && <Text style={s.cardSub}>{fmtTelefono(c.phone)}</Text>}
                      </View>
                      {selectedClient?.id === c.id && <View style={s.check}><Text style={{ color: "white", fontSize: 11 }}>✓</Text></View>}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </KeyboardAvoidingView>
            )}

            {/* ── STEP 2: SERVICE ── */}
            {step === 2 && (
              <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 120 }}>
                {servicios.map((svc, i) => (
                  <Animated.View key={svc.id} entering={i < 10 ? FadeInDown.delay(i * 55).duration(300) : undefined}>
                    <TouchableOpacity
                      style={[s.svcCard, Shadow.sm, selectedService?.id === svc.id && s.selectCardActive]}
                      onPress={() => setSelectedService(svc)}
                      activeOpacity={0.75}
                      accessibilityRole="button"
                      accessibilityState={{ selected: selectedService?.id === svc.id }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[s.cardTitle, selectedService?.id === svc.id && { color: Colors.red }]}>{svc.name}</Text>
                        <Text style={s.cardSub}>⏱ {svc.duracion} min{svc.activo ? "" : " · archivado"}</Text>
                      </View>
                      <View style={{ alignItems: "flex-end", gap: 6 }}>
                        <Text style={s.svcPrice}>{fmtMoneyFull(svc.price)}</Text>
                        {selectedService?.id === svc.id && <View style={s.check}><Text style={{ color: "white", fontSize: 11 }}>✓</Text></View>}
                      </View>
                    </TouchableOpacity>
                  </Animated.View>
                ))}
              </ScrollView>
            )}

            {/* ── STEP 3: DATE + TIME ── */}
            {step === 3 && (
              <ScrollView contentContainerStyle={{ paddingBottom: 130 }} keyboardShouldPersistTaps="handled">
                {selectedService && (
                  <View style={s.durationNote}>
                    <Text style={s.durationNoteText}>{fmtDia(selectedDay, "largo")}  ·  {selectedService.name}  ·  ⏱ {selectedService.duracion} min</Text>
                  </View>
                )}

                <SemanaStrip
                  semana={semana}
                  seleccionado={selectedDay}
                  hoy={hoy}
                  onSeleccionar={d => { setSelectedDay(d); setSelectedTime(null); }}
                  onCambiarSemana={setSemana}
                  // El día original de la cita se puede mantener aunque ya haya pasado.
                  deshabilitado={d => (d < hoy && d !== appt.appointment_date) || (diaCerrado(d) && d !== appt.appointment_date)}
                  cerrado={d => d >= hoy && diaCerrado(d)}
                />

                <View style={{ paddingHorizontal: 20 }}>
                  <SelectorHora
                    estado={cupos.estado}
                    error={cupos.error}
                    onReintentar={cupos.recargar}
                    cupos={cupos.cupos}
                    ocupados={cupos.ocupados}
                    seleccionada={selectedTime}
                    onSeleccionar={setSelectedTime}
                    bloqueos={cupos.bloqueos}
                    avisoHora={avisosHora.length ? avisosHora.join(" ") : null}
                    mensajeCerrado={selectedPro?.schedule ? `${selectedPro.name} no atiende este día.` : "El negocio no atiende este día."}
                    horarioPorDefecto={catalogo?.horario.porDefecto}
                    onConfigurarHorario={() => { onClose(); router.push("/settings/schedule"); }}
                  />
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
                  accessibilityRole="button"
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
                  accessibilityRole="button"
                >
                  <View style={s.btnGrad}>
                    {saving ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>Guardar cambios</Text>}
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

function crearEstilos(t: ThemeColors) {
  const card = { backgroundColor: t.cardSolid, borderWidth: 1, borderColor: t.line };
  return StyleSheet.create({
    header:         { paddingTop: 16, paddingHorizontal: 20, paddingBottom: 18 },
    headerRow:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
    headerBtn:      { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,.2)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.3)" },
    headerTitle:    { fontSize: 18, fontFamily: Fonts.bold, color: "white" },
    headerSub:      { fontSize: 12, color: "rgba(255,255,255,.75)", fontFamily: Fonts.regular, marginTop: 2 },
    progressRow:    { flexDirection: "row", gap: 6 },
    progressDot:    { height: 4, flex: 1, borderRadius: 2, backgroundColor: "rgba(255,255,255,.3)" },
    progressActive: { backgroundColor: "rgba(255,255,255,.95)" },
    selectCard:     { flexDirection: "row", alignItems: "center", ...card, borderRadius: Radius.lg, padding: 14, marginBottom: 10, gap: 14 },
    selectCardActive:{ borderColor: Colors.red, backgroundColor: "rgba(251,15,5,0.08)" },
    svcCard:        { flexDirection: "row", alignItems: "center", ...card, borderRadius: Radius.lg, padding: 16, marginBottom: 10 },
    svcPrice:       { fontSize: 14, fontFamily: Fonts.bold, color: t.text },
    avatar:         { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
    avatarText:     { fontSize: 15, fontFamily: Fonts.bold },
    avatarWhite:    { color: "white", fontSize: 15, fontFamily: Fonts.bold },
    cardTitle:      { fontSize: 14, fontFamily: Fonts.semibold, color: t.text, marginBottom: 2 },
    cardSub:        { fontSize: 12, fontFamily: Fonts.regular, color: t.muted },
    check:          { width: 22, height: 22, borderRadius: 11, backgroundColor: Colors.red, alignItems: "center", justifyContent: "center" },
    searchBar:      { flexDirection: "row", alignItems: "center", ...card, borderRadius: Radius.lg, paddingHorizontal: 14, paddingVertical: 11, marginBottom: 12, gap: 8 },
    searchInput:    { flex: 1, fontSize: 14, fontFamily: Fonts.regular, color: t.text },
    durationNote:   { backgroundColor: Colors.red + "10", paddingHorizontal: 20, paddingVertical: 12 },
    durationNoteText:{ fontSize: 13, fontFamily: Fonts.semibold, color: Colors.red },
    bottomBar:      { position: "absolute", bottom: 0, left: 0, right: 0, padding: 20, paddingBottom: 34, backgroundColor: t.bottomBar, borderTopWidth: 1, borderTopColor: t.bottomBorder },
    btn:            { borderRadius: Radius.full, overflow: "hidden" },
    btnGrad:        { paddingVertical: 16, alignItems: "center", backgroundColor: Colors.red },
    btnText:        { fontSize: 15, fontFamily: Fonts.bold, color: "white", letterSpacing: 0.3 },
  });
}
