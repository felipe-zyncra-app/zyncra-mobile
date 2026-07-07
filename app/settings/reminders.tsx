import { useEffect, useRef, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { Colors, Radius, Shadow } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import GradientHeader from "@/components/GradientHeader";

const HOUR_OPTIONS = [
  { value: 1,  label: "1h" },
  { value: 2,  label: "2h" },
  { value: 6,  label: "6h" },
  { value: 12, label: "12h" },
  { value: 24, label: "1 día" },
  { value: 48, label: "2 días" },
];

const VARIABLES = [
  { key: "{{nombre}}",   label: "Nombre",   icon: "person-outline" as const },
  { key: "{{servicio}}", label: "Servicio",  icon: "pricetags-outline" as const },
  { key: "{{fecha}}",    label: "Fecha",     icon: "calendar-outline" as const },
  { key: "{{hora}}",     label: "Hora",      icon: "time-outline" as const },
];

const DEFAULT_TEMPLATE =
  "¡Hola {{nombre}}! Te recordamos tu cita de {{servicio}} el {{fecha}} a las {{hora}}. ¡Te esperamos!";

function previewText(tmpl: string) {
  return tmpl
    .replace(/\{\{nombre\}\}/g, "Juan García")
    .replace(/\{\{servicio\}\}/g, "Corte de cabello")
    .replace(/\{\{fecha\}\}/g, "lunes 2 jun")
    .replace(/\{\{hora\}\}/g, "10:00 AM");
}

export default function RemindersScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const { tenantId } = useAuth();
  const inputRef = useRef<TextInput>(null);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [hours, setHours]           = useState(24);
  const [template, setTemplate]     = useState(DEFAULT_TEMPLATE);
  const [cursorPos, setCursorPos]   = useState(DEFAULT_TEMPLATE.length);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [savedOk, setSavedOk]       = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    supabase.from("reminder_settings")
      .select("id, hours_before, message_template")
      .eq("tenant_id", tenantId).single()
      .then(({ data: rs }) => {
        if (cancelled) return;
        if (rs) {
          setSettingsId(rs.id);
          setHours(rs.hours_before ?? 24);
          const t = rs.message_template ?? DEFAULT_TEMPLATE;
          setTemplate(t);
          setCursorPos(t.length);
        }
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [tenantId]);

  const handleSave = async () => {
    if (!tenantId) return;
    setSaving(true);
    const payload = { hours_before: hours, message_template: template };
    if (settingsId) {
      await supabase.from("reminder_settings").update(payload).eq("id", settingsId);
    } else {
      const { data } = await supabase.from("reminder_settings")
        .insert({ ...payload, tenant_id: tenantId }).select("id").single();
      if (data) setSettingsId(data.id);
    }
    setSaving(false);
    setSavedOk(true);
    setTimeout(() => setSavedOk(false), 2000);
  };

  const insertVar = (v: string) => {
    const before = template.slice(0, cursorPos);
    const after  = template.slice(cursorPos);
    const next   = before + v + after;
    setTemplate(next);
    setCursorPos(cursorPos + v.length);
  };

  const charCount = template.length;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <GradientHeader
        title="Recordatorios"
        subtitle="Avisos automáticos para tus clientes"
        onBack={() => router.back()}
        rightAction={{ icon: "notifications-outline", onPress: () => {} }}
      />

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={Colors.red} size="large" />
        </View>
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView
            contentContainerStyle={{ padding: 20, paddingBottom: 120 }}
            keyboardShouldPersistTaps="handled"
          >
            {/* ── Tiempo ── */}
            <Animated.View entering={FadeInDown.delay(0).duration(340)}>
              <Text style={s.sectionLabel}>Enviar recordatorio</Text>
              <View style={[s.card, Shadow.sm]}>
                <View style={s.cardTitleRow}>
                  <View style={[s.cardIcon, { backgroundColor: "#f59e0b18" }]}>
                    <Ionicons name="alarm-outline" size={16} color="#f59e0b" />
                  </View>
                  <Text style={s.cardTitle}>¿Cuánto tiempo antes?</Text>
                </View>
                <View style={s.hoursRow}>
                  {HOUR_OPTIONS.map(opt => {
                    const active = hours === opt.value;
                    return (
                      <TouchableOpacity
                        key={opt.value}
                        style={[s.hourPill, active && s.hourPillActive]}
                        onPress={() => setHours(opt.value)}
                        activeOpacity={0.75}
                      >
                        {active ? (
                          <View style={s.hourPillGrad}>
                            <Text style={s.hourLabelActive}>{opt.label}</Text>
                          </View>
                        ) : (
                          <Text style={s.hourLabel}>{opt.label}</Text>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </Animated.View>

            {/* ── Mensaje ── */}
            <Animated.View entering={FadeInDown.delay(60).duration(340)}>
              <Text style={[s.sectionLabel, { marginTop: 24 }]}>Mensaje</Text>
              <View style={[s.card, Shadow.sm]}>
                <View style={s.cardTitleRow}>
                  <View style={[s.cardIcon, { backgroundColor: Colors.purple + "15" }]}>
                    <Ionicons name="chatbubble-outline" size={16} color={Colors.purple} />
                  </View>
                  <Text style={s.cardTitle}>Plantilla del mensaje</Text>
                </View>

                {/* Variables */}
                <Text style={s.varHint}>Toca para insertar en el mensaje</Text>
                <View style={s.varRow}>
                  {VARIABLES.map(v => (
                    <TouchableOpacity
                      key={v.key}
                      style={s.varChip}
                      onPress={() => insertVar(v.key)}
                      activeOpacity={0.7}
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
                    onChangeText={setTemplate}
                    multiline
                    placeholder={DEFAULT_TEMPLATE}
                    placeholderTextColor={Colors.subtle}
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
                {/* Chat header */}
                <View style={s.chatHeader}>
                  <View style={s.chatAvatar}>
                    <Ionicons name="mail-outline" size={16} color="white" />
                  </View>
                  <View>
                    <Text style={s.chatName}>Zyncra · Tu negocio</Text>
                    <Text style={s.chatStatus}>correo al cliente</Text>
                  </View>
                </View>

                {/* Bubble */}
                <View style={s.chatBg}>
                  <View style={s.bubble}>
                    <Text style={s.bubbleText}>{previewText(template)}</Text>
                    <Text style={s.bubbleTime}>10:00 AM</Text>
                  </View>
                </View>

                <Text style={s.previewNote}>
                  <Ionicons name="information-circle-outline" size={12} color={Colors.subtle} />
                  {" "}Así verá el mensaje tu cliente
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

const s = StyleSheet.create({
  sectionLabel: { fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", color: Colors.subtle, textTransform: "uppercase", letterSpacing: 0.9, marginBottom: 10 },

  card:         { backgroundColor: Colors.white, borderRadius: Radius.lg, padding: 16 },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 16 },
  cardIcon:     { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  cardTitle:    { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },

  hoursRow:     { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  hourPill:     { borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.border, overflow: "hidden" },
  hourPillActive:{ borderColor: "transparent" },
  hourPillGrad: { paddingVertical: 9, paddingHorizontal: 16, alignItems: "center", backgroundColor: Colors.red },
  hourLabel:    { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted, paddingVertical: 9, paddingHorizontal: 16 },
  hourLabelActive:{ fontSize: 13, fontFamily: "SpaceGrotesk_700Bold", color: "white" },

  varHint:      { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", color: Colors.subtle, marginBottom: 10 },
  varRow:       { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  varChip:      { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: Colors.purple + "12", borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 6 },
  varChipText:  { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.purple },
  textAreaWrap: { backgroundColor: Colors.cream2, borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md },
  textArea:     { padding: 14, fontSize: 14, fontFamily: "SpaceGrotesk_400Regular", color: Colors.text, minHeight: 110 },
  charCount:    { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", color: Colors.subtle, textAlign: "right", paddingHorizontal: 14, paddingBottom: 10 },

  previewCard:  { backgroundColor: Colors.white, borderRadius: Radius.lg, overflow: "hidden" },
  chatHeader:   { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, backgroundColor: "#075e54", borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg },
  chatAvatar:   { width: 36, height: 36, borderRadius: 18, backgroundColor: "#25d366", alignItems: "center", justifyContent: "center" },
  chatName:     { fontSize: 14, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
  chatStatus:   { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", color: "rgba(255,255,255,.7)" },
  chatBg:       { backgroundColor: "#ece5dd", padding: 14, paddingBottom: 10 },
  bubble:       { backgroundColor: "white", borderRadius: Radius.md, borderTopLeftRadius: 4, padding: 12, maxWidth: "85%", alignSelf: "flex-start" },
  bubbleText:   { fontSize: 14, fontFamily: "SpaceGrotesk_400Regular", color: "#111", lineHeight: 20 },
  bubbleTime:   { fontSize: 10, color: Colors.subtle, textAlign: "right", marginTop: 4 },
  previewNote:  { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", color: Colors.subtle, textAlign: "center", padding: 12 },

  bottomBar:    { padding: 20, paddingBottom: 34, borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.cream2 },
  btn:          { borderRadius: Radius.full, overflow: "hidden" },
  btnGrad: { paddingVertical: 16, alignItems: "center", backgroundColor: Colors.red },
  btnText:      { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
});
