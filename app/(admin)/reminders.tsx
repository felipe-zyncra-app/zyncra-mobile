import { useEffect, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { Colors, Gradients, Radius, Shadow } from "@/constants/theme";
import ErrorState from "@/components/ErrorState";
import { ScreenHeader } from "@/components/ui";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";

const HOUR_OPTIONS = [1, 2, 6, 12, 24, 48];

const DEFAULT_TEMPLATE =
  "¡Hola {{nombre}}! Te recordamos tu cita de {{servicio}} el {{fecha}} a las {{hora}}. ¡Te esperamos!";

const VARIABLES = ["{{nombre}}", "{{servicio}}", "{{fecha}}", "{{hora}}"];

export default function RemindersScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const { tenantId } = useAuth();
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [hours, setHours]         = useState(24);
  const [template, setTemplate]   = useState(DEFAULT_TEMPLATE);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [saved, setSaved]         = useState(false);

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
          setTemplate(rs.message_template ?? DEFAULT_TEMPLATE);
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
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const insertVariable = (v: string) => {
    setTemplate(prev => prev + v);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader crumb="Panel" title="Recordatorios" subtitle="Alertas automáticas para tus clientes" onBack={() => router.back()} />

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={Colors.red} size="large" />
        </View>
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }}>
          <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 20, paddingBottom: 120 }}>
            <Animated.View entering={FadeInDown.duration(350)}>

              {/* Hours before */}
              <Text style={s.sectionTitle}>Enviar recordatorio</Text>
              <View style={[s.card, Shadow.sm]}>
                <Text style={s.cardLabel}>¿Cuántas horas antes?</Text>
                <View style={s.hoursGrid}>
                  {HOUR_OPTIONS.map(h => (
                    <TouchableOpacity
                      key={h}
                      style={[s.hourBtn, hours === h && { borderColor: "transparent" }]}
                      onPress={() => setHours(h)}
                      activeOpacity={0.75}
                    >
                      {hours === h ? (
                        <View style={s.hourGrad}>
                          <Text style={[s.hourLabel, { color: "white" }]}>{h}h</Text>
                        </View>
                      ) : (
                        <Text style={s.hourLabel}>{h}h</Text>
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Message template */}
              <Text style={[s.sectionTitle, { marginTop: 24 }]}>Mensaje</Text>
              <View style={[s.card, Shadow.sm]}>
                <Text style={s.cardSub}>Usa variables para personalizar el mensaje</Text>
                <View style={s.variablesRow}>
                  {VARIABLES.map(v => (
                    <TouchableOpacity key={v} style={s.varChip} onPress={() => insertVariable(v)} activeOpacity={0.7}>
                      <Text style={s.varChipText}>{v}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput
                  style={s.templateInput}
                  value={template}
                  onChangeText={setTemplate}
                  multiline
                  numberOfLines={5}
                  placeholderTextColor={Colors.subtle}
                  placeholder={DEFAULT_TEMPLATE}
                  textAlignVertical="top"
                />
              </View>

              {/* Preview */}
              <Text style={[s.sectionTitle, { marginTop: 24 }]}>Vista previa</Text>
              <View style={[s.previewCard, Shadow.sm]}>
                <View style={s.previewBubble}>
                  <Text style={s.previewText}>
                    {template
                      .replace("{{nombre}}", "Juan García")
                      .replace("{{servicio}}", "Corte de cabello")
                      .replace("{{fecha}}", "lunes 2 de junio")
                      .replace("{{hora}}", "10:00 AM")}
                  </Text>
                </View>
                <Text style={s.previewCaption}>Así verá el mensaje tu cliente</Text>
              </View>

              {saved && (
                <Animated.View entering={FadeInDown.duration(300)} style={[s.savedBanner, Shadow.sm]}>
                  <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
                  <Text style={s.savedText}>Configuración guardada</Text>
                </Animated.View>
              )}
            </Animated.View>
          </ScrollView>

          <View style={[s.bottomBar, { backgroundColor: t.bg, borderTopColor: t.border }]}>
            <TouchableOpacity style={s.btn} onPress={handleSave} disabled={saving} activeOpacity={0.85}>
              <View style={s.btnGrad}>
                {saving ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>Guardar configuración</Text>}
              </View>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header:        { paddingTop: 16, paddingHorizontal: 24, paddingBottom: 20 },
  headerRow:     { flexDirection: "row", alignItems: "center", gap: 12 },
  backBtn:       { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,.18)", alignItems: "center", justifyContent: "center" },
  headerTitle:   { fontSize: 22, fontFamily: "SpaceGrotesk_700Bold", color: "white", letterSpacing: -0.4 },
  headerSub:     { fontSize: 12, color: "rgba(255,255,255,.75)", fontFamily: "SpaceGrotesk_400Regular", marginTop: 2 },
  sectionTitle:  { fontSize: 12, fontFamily: "SpaceGrotesk_700Bold", color: Colors.subtle, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 },
  card:          { backgroundColor: Colors.white, borderRadius: Radius.lg, padding: 16 },
  cardLabel:     { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text, marginBottom: 14 },
  cardSub:       { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, marginBottom: 12 },
  hoursGrid:     { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  hourBtn:       { borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.border, overflow: "hidden", minWidth: 52 },
  hourGrad:      { paddingVertical: 10, paddingHorizontal: 16, alignItems: "center", backgroundColor: Colors.red },
  hourLabel:     { fontSize: 14, fontFamily: "SpaceGrotesk_700Bold", color: Colors.muted, paddingVertical: 10, paddingHorizontal: 16 },
  variablesRow:  { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  varChip:       { backgroundColor: Colors.purple + "12", borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 5 },
  varChipText:   { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.purple },
  templateInput: { backgroundColor: Colors.cream2, borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md, padding: 14, fontSize: 14, fontFamily: "SpaceGrotesk_400Regular", color: Colors.text, minHeight: 110 },
  previewCard:   { backgroundColor: Colors.white, borderRadius: Radius.lg, padding: 16 },
  previewBubble: { backgroundColor: Colors.success + "12", borderRadius: Radius.md, borderBottomLeftRadius: 4, padding: 14 },
  previewText:   { fontSize: 14, fontFamily: "SpaceGrotesk_400Regular", color: Colors.text, lineHeight: 20 },
  previewCaption:{ fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", color: Colors.subtle, marginTop: 8, textAlign: "center" },
  savedBanner:   { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: Colors.success + "12", borderRadius: Radius.md, padding: 14, marginTop: 16 },
  savedText:     { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.success },
  bottomBar:     { padding: 20, paddingBottom: 34, borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.cream2 },
  btn:           { borderRadius: Radius.full, overflow: "hidden" },
  btnGrad: { paddingVertical: 16, alignItems: "center", backgroundColor: Colors.red },
  btnText:       { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
});
