import { useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, KeyboardAvoidingView, ActivityIndicator, Alert, Switch,
} from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { Colors, Fonts, Radius, Shadow } from "@/constants/theme";
import { useTheme, type ThemeColors } from "@/lib/theme";
import { mensajeError, revisar } from "@/lib/db";
import { useGuardRespuestas, useRecarga } from "@/lib/useRecarga";
import { activarAvisosDeCita, avisosDeCitaActivos, refreshAllReminders } from "@/lib/notifications";
import { textoRecordatorioCita } from "@/lib/avisos";
import { hoyNegocio, instanteDe, sumarDias } from "@/lib/tz";
import { ScreenHeader } from "@/components/ui";
import ErrorState from "@/components/ErrorState";

const HOUR_OPTIONS = [
  { value: 1,  label: "1 h" },
  { value: 2,  label: "2 h" },
  { value: 6,  label: "6 h" },
  { value: 12, label: "12 h" },
  { value: 24, label: "1 día" },
  { value: 48, label: "2 días" },
];

const VARIABLES = [
  { key: "{{nombre}}",   label: "Nombre",   icon: "person-outline" as const },
  { key: "{{servicio}}", label: "Servicio",  icon: "pricetags-outline" as const },
  // La plantilla por defecto de la base la trae y el web la reemplaza al enviar.
  { key: "{{profesional}}", label: "Profesional", icon: "cut-outline" as const },
  { key: "{{fecha}}",    label: "Fecha",     icon: "calendar-outline" as const },
  { key: "{{hora}}",     label: "Hora",      icon: "time-outline" as const },
];

const DEFAULT_TEMPLATE =
  "¡Hola {{nombre}}! Te recordamos tu cita de {{servicio}} el {{fecha}} a las {{hora}}. ¡Te esperamos!";

/**
 * Ejemplo del aviso que suena en este teléfono con la anticipación elegida:
 * una cita a las 3:00 PM del día que corresponde, con el mismo texto que
 * programa lib/notifications.
 */
function ejemploAviso(horas: number, timeZone: string): string {
  const dias = horas >= 24 ? Math.round(horas / 24) : 0;
  const dia = sumarDias(hoyNegocio(timeZone), dias);
  const disparo = new Date(instanteDe(dia, "15:00", timeZone).getTime() - horas * 60 * 60 * 1000);
  return textoRecordatorioCita({ date: dia, time: "15:00", clientName: "Juan", serviceName: "Corte" }, disparo, timeZone).body;
}

function previewText(tmpl: string) {
  return tmpl
    .replace(/\{\{nombre\}\}/g, "Juan García")
    .replace(/\{\{servicio\}\}/g, "Corte de cabello")
    .replace(/\{\{profesional\}\}/g, "Laura")
    .replace(/\{\{fecha\}\}/g, "lunes 2 jun")
    .replace(/\{\{hora\}\}/g, "10:00 AM");
}

/**
 * Recordatorios: dice la verdad sobre a quién le llega cada aviso (AGE-19).
 *
 *  · El aviso por cita es una notificación LOCAL para el negocio en este
 *    teléfono ("Recuerda: mañana a las 3:00 PM tienes una cita con Juan para
 *    Corte."). Se enciende o apaga POR DISPOSITIVO con el interruptor (se
 *    aplica al instante, sin Guardar).
 *  · hours_before solo mueve ese aviso local, en todos los teléfonos del
 *    dueño. No cambia nada de lo que recibe el cliente.
 *  · Al cliente le escribe el servidor (cron del web) con horarios fijos:
 *    correo 24 h y 2 h antes (si el cliente tiene correo) y WhatsApp 2 h
 *    antes solo si el negocio conectó WhatsApp y eligió una plantilla
 *    aprobada en el panel web. No se configura desde aquí.
 *  · message_template es el texto que arma el panel web cuando el dueño
 *    envía un recordatorio A MANO por WhatsApp (wa.me). No sale solo.
 */
export default function RemindersScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const s = useMemo(() => crearEstilos(t), [t]);
  const { tenantId } = useAuth();
  const { timezone } = useTenant();
  const guard = useGuardRespuestas();
  const inputRef = useRef<TextInput>(null);
  const [hours, setHours]           = useState(24);
  const [template, setTemplate]     = useState(DEFAULT_TEMPLATE);
  const [cursorPos, setCursorPos]   = useState(DEFAULT_TEMPLATE.length);
  const [cargado, setCargado]       = useState(false);
  const [error, setError]           = useState<unknown>(null);
  const [editado, setEditado]       = useState(false);
  const [saving, setSaving]         = useState(false);
  const [savedOk, setSavedOk]       = useState(false);
  // Interruptor de ESTE teléfono (AsyncStorage). Encendido por defecto.
  const [avisosTelefono, setAvisosTelefono] = useState(true);

  useEffect(() => {
    let vigente = true;
    avisosDeCitaActivos().then(v => { if (vigente) setAvisosTelefono(v); }).catch(() => {});
    return () => { vigente = false; };
  }, []);

  const cambiarAvisosTelefono = (activo: boolean) => {
    setAvisosTelefono(activo);
    // Apagado cancela los avisos ya programados; encendido los vuelve a programar.
    activarAvisosDeCita(activo, tenantId, timezone).catch(() => {});
  };

  const { recargar } = useRecarga(async () => {
    if (!tenantId || editado) return;
    const turno = guard.nuevo();
    try {
      // maybeSingle: un negocio sin fila todavía no es un error.
      const rs = revisar(
        await supabase.from("reminder_settings")
          .select("id, hours_before, message_template")
          .eq("tenant_id", tenantId).maybeSingle(),
        "No se pudo cargar la configuración de recordatorios",
      ) as { id: string; hours_before: number | null; message_template: string | null } | null;
      if (!turno.vigente()) return;
      if (rs) {
        setHours(rs.hours_before ?? 24);
        const tpl = rs.message_template || DEFAULT_TEMPLATE;
        setTemplate(tpl);
        setCursorPos(tpl.length);
      }
      setError(null);
      setCargado(true);
    } catch (e) {
      if (turno.vigente()) setError(e);
    }
  }, [tenantId], { habilitado: !!tenantId, alCambiarDia: false, alCambiarSede: false });

  const handleSave = async () => {
    if (!tenantId || !cargado || saving) return;
    if (template.trim().length === 0) {
      Alert.alert("Mensaje vacío", "Escribe el texto del recordatorio.");
      return;
    }
    setSaving(true);
    try {
      // upsert por tenant_id (UNIQUE): sirve igual si la fila no existía.
      revisar(
        await supabase.from("reminder_settings")
          .upsert({ tenant_id: tenantId, hours_before: hours, message_template: template }, { onConflict: "tenant_id" })
          .select("id"),
        "No se pudo guardar la configuración",
      );
      setEditado(false);
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 2000);
      // Los avisos ya programados en este teléfono pasan a la nueva anticipación.
      // Si están apagados en este teléfono, no programa nada.
      refreshAllReminders(tenantId, timezone).catch(() => {});
    } catch (e) {
      Alert.alert("No se guardó", mensajeError(e));
    } finally {
      setSaving(false);
    }
  };

  const insertVar = (v: string) => {
    const before = template.slice(0, cursorPos);
    const after  = template.slice(cursorPos);
    setEditado(true);
    setTemplate(before + v + after);
    setCursorPos(cursorPos + v.length);
  };

  const charCount = template.length;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader
        crumb="Clientes"
        title="Recordatorios"
        subtitle="Avisos de tus citas: a ti y a tus clientes"
        onBack={() => router.back()}
      />

      {!cargado && error ? (
        <ErrorState error={error} onRetry={recargar} />
      ) : !cargado ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={Colors.red} size="large" />
        </View>
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }}>
          <ScrollView automaticallyAdjustKeyboardInsets
            contentContainerStyle={{ padding: 20, paddingBottom: 120 }}
            keyboardShouldPersistTaps="handled"
          >
            {/* ── Aviso en el teléfono del dueño ── */}
            <Animated.View entering={FadeInDown.delay(0).duration(340)}>
              <Text style={s.sectionLabel}>Avisos para ti en este teléfono</Text>
              <View style={[s.card, Shadow.sm]}>
                <View style={s.switchRow}>
                  <View style={[s.cardIcon, { backgroundColor: "#f59e0b18" }]}>
                    <Ionicons name="alarm-outline" size={16} color="#f59e0b" />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.cardTitle}>Avisarme en este teléfono antes de cada cita</Text>
                    <Text style={s.switchSub}>
                      {avisosTelefono ? "Encendido en este teléfono" : "Apagado: este teléfono no te avisará de tus citas"}
                    </Text>
                  </View>
                  <Switch
                    value={avisosTelefono}
                    onValueChange={cambiarAvisosTelefono}
                    trackColor={{ false: t.lineStrong, true: Colors.red + "aa" }}
                    thumbColor={avisosTelefono ? Colors.red : t.subtle}
                    accessibilityLabel="Avisarme en este teléfono antes de cada cita"
                  />
                </View>

                <View style={[s.divider, { backgroundColor: t.line }]} />

                <Text style={[s.subTitle, !avisosTelefono && { color: t.subtle }]}>¿Cuánto tiempo antes?</Text>
                <View style={s.hoursRow}>
                  {HOUR_OPTIONS.map(opt => {
                    const active = hours === opt.value;
                    return (
                      <TouchableOpacity
                        key={opt.value}
                        style={[s.hourPill, active && s.hourPillActive]}
                        onPress={() => { setEditado(true); setHours(opt.value); }}
                        activeOpacity={0.75}
                        accessibilityRole="button"
                        accessibilityLabel={`${opt.label} antes`}
                        accessibilityState={{ selected: active }}
                      >
                        <Text style={active ? s.hourLabelActive : s.hourLabel}>{opt.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {avisosTelefono ? (
                  <View style={[s.ejemplo, { backgroundColor: t.chipBg, borderColor: t.line }]}>
                    <Text style={s.ejemploTitulo}>Recordatorio de cita</Text>
                    <Text style={s.ejemploTexto}>{ejemploAviso(hours, timezone)}</Text>
                  </View>
                ) : null}

                <Text style={s.help}>
                  Estos avisos le llegan al negocio, en este teléfono: tus clientes no los ven. El recordatorio a tu cliente lo envía Zyncra por WhatsApp y correo (abajo) y no cambia con nada de esta sección.
                </Text>
                <Text style={[s.help, { marginTop: 6 }]}>
                  El interruptor cambia solo este teléfono y se aplica al instante. La anticipación se guarda con Guardar configuración y vale para todos los teléfonos donde entras como dueño.
                </Text>
              </View>
            </Animated.View>

            {/* ── Recordatorio automático al cliente ── */}
            <Animated.View entering={FadeInDown.delay(40).duration(340)}>
              <Text style={[s.sectionLabel, { marginTop: 24 }]}>Recordatorio automático a tus clientes</Text>
              <View style={[s.card, Shadow.sm]}>
                <View style={s.cardTitleRow}>
                  <View style={[s.cardIcon, { backgroundColor: Colors.success + "18" }]}>
                    <Ionicons name="paper-plane-outline" size={16} color={Colors.success} />
                  </View>
                  <Text style={s.cardTitle}>Lo envía Zyncra, sin que hagas nada</Text>
                </View>
                <View style={{ gap: 8 }}>
                  <InfoLinea s={s} icono="mail-outline" texto="Correo 24 horas y 2 horas antes de la cita, si el cliente tiene correo." />
                  <InfoLinea s={s} icono="logo-whatsapp" texto="WhatsApp 2 horas antes, solo si conectaste tu WhatsApp y elegiste una plantilla aprobada en el panel web." />
                </View>
                <Text style={s.help}>
                  Los horarios y el texto de estos avisos son fijos: no cambian con lo que configures en esta pantalla.
                </Text>
              </View>
            </Animated.View>

            {/* ── Mensaje para enviar a mano ── */}
            <Animated.View entering={FadeInDown.delay(80).duration(340)}>
              <Text style={[s.sectionLabel, { marginTop: 24 }]}>Mensaje para enviar a mano</Text>
              <View style={[s.card, Shadow.sm]}>
                <View style={s.cardTitleRow}>
                  <View style={[s.cardIcon, { backgroundColor: Colors.purple + "15" }]}>
                    <Ionicons name="chatbubble-outline" size={16} color={Colors.purple} />
                  </View>
                  <Text style={s.cardTitle}>Plantilla del recordatorio por WhatsApp</Text>
                </View>
                <Text style={[s.help, { marginTop: 0, marginBottom: 12 }]}>
                  Es el texto que se arma cuando envías un recordatorio a mano por WhatsApp desde el panel web (Recordatorios). No se envía solo.
                </Text>

                {/* Variables */}
                <Text style={s.varHint}>Toca para insertar en el mensaje</Text>
                <View style={s.varRow}>
                  {VARIABLES.map(v => (
                    <TouchableOpacity
                      key={v.key}
                      style={s.varChip}
                      onPress={() => insertVar(v.key)}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`Insertar ${v.label}`}
                    >
                      <Ionicons name={v.icon} size={11} color={Colors.purple} />
                      <Text style={s.varChipText}>{v.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Text area */}
                <View style={s.textAreaWrap}>
                  <TextInput
                    ref={inputRef}
                    style={s.textArea}
                    value={template}
                    onChangeText={v => { setEditado(true); setTemplate(v); }}
                    multiline
                    placeholder={DEFAULT_TEMPLATE}
                    placeholderTextColor={t.subtle}
                    textAlignVertical="top"
                    onSelectionChange={e => setCursorPos(e.nativeEvent.selection.end)}
                  />
                  <Text style={[s.charCount, charCount > 300 && { color: Colors.red }]}>
                    {charCount} / 300
                  </Text>
                </View>
              </View>
            </Animated.View>

            {/* ── Vista previa ── */}
            <Animated.View entering={FadeInDown.delay(120).duration(340)}>
              <Text style={[s.sectionLabel, { marginTop: 24 }]}>Vista previa</Text>
              <View style={[s.previewCard, Shadow.sm]}>
                <View style={s.chatHeader}>
                  <View style={s.chatAvatar}>
                    <Ionicons name="logo-whatsapp" size={16} color="white" />
                  </View>
                  <View>
                    <Text style={s.chatName}>Tu negocio</Text>
                    <Text style={s.chatStatus}>WhatsApp · envío manual</Text>
                  </View>
                </View>
                <View style={s.chatBg}>
                  <View style={s.bubble}>
                    <Text style={s.bubbleText}>{previewText(template)}</Text>
                    <Text style={s.bubbleTime}>10:00 AM</Text>
                  </View>
                </View>
                <Text style={s.previewNote}>
                  Así lo verá tu cliente cuando se lo envíes desde el panel web.
                </Text>
              </View>
            </Animated.View>
          </ScrollView>

          {/* ── Bottom bar ── */}
          <View style={s.bottomBar}>
            <TouchableOpacity
              style={s.btn}
              onPress={handleSave}
              disabled={saving}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              <View style={[s.btnGrad, { backgroundColor: savedOk ? Colors.success : Colors.red }]}>
                {saving ? (
                  <ActivityIndicator color="white" />
                ) : savedOk ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Ionicons name="checkmark-circle" size={18} color="white" />
                    <Text style={s.btnText}>Guardado</Text>
                  </View>
                ) : (
                  <Text style={s.btnText}>Guardar configuración</Text>
                )}
              </View>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

function InfoLinea({ s, icono, texto }: { s: Estilos; icono: React.ComponentProps<typeof Ionicons>["name"]; texto: string }) {
  return (
    <View style={s.infoLine}>
      <Ionicons name={icono} size={14} color={Colors.success} style={{ marginTop: 2 }} />
      <Text style={s.infoText}>{texto}</Text>
    </View>
  );
}

type Estilos = ReturnType<typeof crearEstilos>;

function crearEstilos(t: ThemeColors) {
  return StyleSheet.create({
    sectionLabel: { fontSize: 11, fontFamily: Fonts.bold, color: t.subtle, textTransform: "uppercase", letterSpacing: 0.9, marginBottom: 10 },

    card:         { backgroundColor: t.cardSolid, borderRadius: Radius.lg, padding: 16, borderWidth: 1, borderColor: t.line },
    cardTitleRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 16 },
    cardIcon:     { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
    cardTitle:    { flex: 1, fontSize: 14, fontFamily: Fonts.semibold, color: t.text },
    switchRow:    { flexDirection: "row", alignItems: "center", gap: 10 },
    switchSub:    { fontSize: 11.5, fontFamily: Fonts.regular, color: t.muted, marginTop: 2 },
    divider:      { height: 1, marginVertical: 14 },
    subTitle:     { fontSize: 13, fontFamily: Fonts.semibold, color: t.text, marginBottom: 10 },
    ejemplo:      { borderWidth: 1, borderRadius: Radius.md, padding: 12, marginTop: 14 },
    ejemploTitulo:{ fontSize: 12, fontFamily: Fonts.bold, color: t.text },
    ejemploTexto: { fontSize: 12.5, fontFamily: Fonts.regular, color: t.muted, marginTop: 3, lineHeight: 18 },
    help:         { fontSize: 11.5, fontFamily: Fonts.regular, color: t.muted, marginTop: 12, lineHeight: 17 },
    infoLine:     { flexDirection: "row", gap: 8 },
    infoText:     { flex: 1, fontSize: 13, fontFamily: Fonts.regular, color: t.text, lineHeight: 19 },

    hoursRow:     { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    hourPill:     { borderRadius: Radius.full, borderWidth: 1.5, borderColor: t.lineStrong, overflow: "hidden", paddingVertical: 9, paddingHorizontal: 16, minHeight: 40, justifyContent: "center" },
    hourPillActive:{ borderColor: Colors.red, backgroundColor: Colors.red },
    hourLabel:    { fontSize: 13, fontFamily: Fonts.semibold, color: t.muted },
    hourLabelActive:{ fontSize: 13, fontFamily: Fonts.bold, color: "white" },

    varHint:      { fontSize: 11, fontFamily: Fonts.regular, color: t.subtle, marginBottom: 10 },
    varRow:       { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
    varChip:      { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: Colors.purple + "14", borderRadius: Radius.full, paddingHorizontal: 12, paddingVertical: 8 },
    varChipText:  { fontSize: 12, fontFamily: Fonts.semibold, color: Colors.purple },
    textAreaWrap: { backgroundColor: t.inputBg, borderWidth: 1.5, borderColor: t.inputBorder, borderRadius: Radius.md },
    textArea:     { padding: 14, fontSize: 14, fontFamily: Fonts.regular, color: t.text, minHeight: 110 },
    charCount:    { fontSize: 11, fontFamily: Fonts.regular, color: t.subtle, textAlign: "right", paddingHorizontal: 14, paddingBottom: 10 },

    previewCard:  { backgroundColor: t.cardSolid, borderRadius: Radius.lg, overflow: "hidden", borderWidth: 1, borderColor: t.line },
    chatHeader:   { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, backgroundColor: "#075e54" },
    chatAvatar:   { width: 36, height: 36, borderRadius: 18, backgroundColor: "#25d366", alignItems: "center", justifyContent: "center" },
    chatName:     { fontSize: 14, fontFamily: Fonts.bold, color: "white" },
    chatStatus:   { fontSize: 11, fontFamily: Fonts.regular, color: "rgba(255,255,255,.7)" },
    // El fondo del chat imita a WhatsApp: se deja igual en claro y en oscuro.
    chatBg:       { backgroundColor: "#ece5dd", padding: 14, paddingBottom: 10 },
    bubble:       { backgroundColor: "white", borderRadius: Radius.md, borderTopLeftRadius: 4, padding: 12, maxWidth: "85%", alignSelf: "flex-start" },
    bubbleText:   { fontSize: 14, fontFamily: Fonts.regular, color: "#111", lineHeight: 20 },
    bubbleTime:   { fontSize: 10, color: "#667781", textAlign: "right", marginTop: 4 },
    previewNote:  { fontSize: 11, fontFamily: Fonts.regular, color: t.subtle, textAlign: "center", padding: 12 },

    bottomBar:    { padding: 20, paddingBottom: 34, borderTopWidth: 1, borderTopColor: t.bottomBorder, backgroundColor: t.bottomBar },
    btn:          { borderRadius: Radius.full, overflow: "hidden" },
    btnGrad:      { paddingVertical: 16, alignItems: "center", backgroundColor: Colors.red },
    btnText:      { fontSize: 15, fontFamily: Fonts.bold, color: "white" },
  });
}
