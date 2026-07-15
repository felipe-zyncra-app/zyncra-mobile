import { useEffect, useState, useCallback } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { Config, authedFetch } from "@/lib/config";
import { Colors, Fonts, Gradients, Radius } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { ScreenHeader, Card, CardHead, SectionLabel, MonoTag } from "@/components/ui";

// Firma de esta vista: identidad Hanna (violeta → rosa)
const HGRAD = ["#a855f7", "#ec4899"] as const;

type Digest = {
  resumen?: string;
  servicios_top?: { nombre: string; menciones: number }[];
  horas_pico?: string[];
  preguntas_frecuentes?: string[];
  oportunidades?: string[];
  recomendaciones?: string[];
};

type CampaignDraft = {
  tipo: string; nombre: string; mensaje: string;
  segmento: "all" | "inactive" | "active"; razon: string;
};

const TONE_OPTIONS = [
  { value: "", label: "Neutral" },
  { value: "profesional y directo", label: "Profesional" },
  { value: "cercano y cálido", label: "Cercano" },
  { value: "juvenil y fresco", label: "Juvenil" },
  { value: "elegante y sobrio", label: "Elegante" },
];

const SEGMENT_LABEL: Record<string, string> = {
  all: "Todos", active: "Activos", inactive: "Inactivos (+90 días)",
};
const TIPO_LABEL: Record<string, string> = {
  reactivacion: "Reactivación", frecuentes: "Fidelización", agenda: "Llenar agenda",
};

export default function HannaScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const { tenantId } = useAuth();

  const [loading, setLoading] = useState(true);
  const [usedMonth, setUsedMonth] = useState(0);
  const [greeting, setGreeting] = useState("");
  const [tone, setTone] = useState("");
  const [extra, setExtra] = useState("");
  const [digest, setDigest] = useState<Digest | null>(null);
  const [digestWeek, setDigestWeek] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);

  const [drafts, setDrafts] = useState<CampaignDraft[]>([]);
  const [generating, setGenerating] = useState(false);
  const [savedTemplates, setSavedTemplates] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    const monthStart = new Date(); monthStart.setDate(1);
    const monthStartISO = monthStart.toISOString().slice(0, 10);

    const [usageRes, cfgRes, insightRes] = await Promise.all([
      supabase.from("ai_usage").select("messages").eq("tenant_id", tenantId).gte("day", monthStartISO),
      supabase.from("hanna_config").select("greeting, tone, extra_instructions").eq("tenant_id", tenantId).maybeSingle(),
      supabase.from("hanna_insights").select("week_start, digest").eq("tenant_id", tenantId).order("week_start", { ascending: false }).limit(1).maybeSingle(),
    ]);

    setUsedMonth((usageRes.data ?? []).reduce((s: number, r: any) => s + (r.messages ?? 0), 0));
    if (cfgRes.data) {
      setGreeting((cfgRes.data as any).greeting ?? "");
      setTone((cfgRes.data as any).tone ?? "");
      setExtra((cfgRes.data as any).extra_instructions ?? "");
    }
    if (insightRes.data) {
      setDigest((insightRes.data as any).digest as Digest);
      setDigestWeek((insightRes.data as any).week_start);
    }
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const saveConfig = async () => {
    if (!tenantId) return;
    setSaving(true); setSavedOk(false);
    const { error } = await supabase.from("hanna_config").upsert({
      tenant_id: tenantId,
      greeting: greeting.trim() || null,
      tone: tone || null,
      extra_instructions: extra.trim() || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "tenant_id" });
    setSaving(false);
    if (!error) { setSavedOk(true); setTimeout(() => setSavedOk(false), 2500); }
    else Alert.alert("Error", error.message);
  };

  const generateCampaigns = async () => {
    setGenerating(true); setDrafts([]); setSavedTemplates(new Set());
    try {
      const res = await authedFetch(Config.api.hannaCampaigns, { method: "POST", body: "{}" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { Alert.alert("Error", json.error ?? "No se pudieron generar campañas"); return; }
      setDrafts(json.campanas ?? []);
    } catch {
      Alert.alert("Error de red", "Revisa tu conexión e intenta de nuevo.");
    } finally {
      setGenerating(false);
    }
  };

  const saveAsTemplate = async (draft: CampaignDraft, idx: number) => {
    if (!tenantId) return;
    const { error } = await supabase.from("wa_templates").insert({
      tenant_id: tenantId,
      name: `Hanna — ${draft.nombre}`.slice(0, 80),
      message: draft.mensaje,
    });
    if (!error) setSavedTemplates(prev => new Set(prev).add(idx));
    else Alert.alert("Error", error.message);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.canvas }}>
      <ScreenHeader crumb="Marketing" title="Hanna IA" subtitle="Tu asistente de reservas por WhatsApp" onBack={() => router.back()} />

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={Colors.red} size="large" />
        </View>
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60, gap: 16 }} showsVerticalScrollIndicator={false}>

            {/* Identidad + uso */}
            <Animated.View entering={FadeInDown.duration(350)}>
              <View style={h.hero}>
                <LinearGradient colors={HGRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={h.avatar}>
                  <Ionicons name="sparkles" size={22} color="white" />
                </LinearGradient>
                <View style={{ flex: 1 }}>
                  <Text style={[h.heroTitle, { color: t.ink }]}>Hanna</Text>
                  <Text style={[h.heroSub, { color: t.muted }]}>{usedMonth} mensaje{usedMonth !== 1 ? "s" : ""} este mes</Text>
                </View>
              </View>
            </Animated.View>

            {/* Insights de la semana */}
            {digest && (
              <Card delay={80}>
                <CardHead
                  title="Resumen de la semana"
                  sub={digestWeek ? `Semana del ${new Date(digestWeek).toLocaleDateString("es-CO", { day: "2-digit", month: "long" })}` : undefined}
                  aside="IA"
                />
                <View style={{ padding: 16, gap: 14 }}>
                  {digest.resumen && <Text style={[h.digestText, { color: t.muted }]}>{digest.resumen}</Text>}

                  {digest.servicios_top && digest.servicios_top.length > 0 && (
                    <View>
                      <MonoTag>Servicios más mencionados</MonoTag>
                      <View style={{ gap: 6, marginTop: 8 }}>
                        {digest.servicios_top.slice(0, 5).map((sv, i) => (
                          <View key={i} style={h.svcRow}>
                            <Text style={[h.svcName, { color: t.ink }]} numberOfLines={1}>{sv.nombre}</Text>
                            <Text style={[h.svcCount, { color: t.subtle }]}>{sv.menciones}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  )}

                  {digest.oportunidades && digest.oportunidades.length > 0 && (
                    <View>
                      <MonoTag>Oportunidades</MonoTag>
                      {digest.oportunidades.slice(0, 4).map((op, i) => (
                        <View key={i} style={h.bulletRow}>
                          <View style={[h.bullet, { backgroundColor: "#a855f7" }]} />
                          <Text style={[h.bulletText, { color: t.muted }]}>{op}</Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {digest.recomendaciones && digest.recomendaciones.length > 0 && (
                    <View>
                      <MonoTag>Recomendaciones</MonoTag>
                      {digest.recomendaciones.slice(0, 4).map((rec, i) => (
                        <View key={i} style={h.bulletRow}>
                          <View style={[h.bullet, { backgroundColor: Colors.success }]} />
                          <Text style={[h.bulletText, { color: t.muted }]}>{rec}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              </Card>
            )}

            {/* Generador de campañas */}
            <Card delay={120}>
              <CardHead title="Campañas sugeridas" sub="Hanna genera ideas según tus clientes" />
              <View style={{ padding: 16 }}>
                <TouchableOpacity onPress={generateCampaigns} disabled={generating} activeOpacity={0.85} style={{ borderRadius: Radius.md, overflow: "hidden" }}>
                  <LinearGradient colors={HGRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={h.genBtn}>
                    {generating ? <ActivityIndicator color="white" /> : (
                      <>
                        <Ionicons name="sparkles" size={16} color="white" />
                        <Text style={h.genBtnText}>Generar campañas</Text>
                      </>
                    )}
                  </LinearGradient>
                </TouchableOpacity>

                {drafts.map((d, i) => (
                  <View key={i} style={[h.draft, { borderColor: t.line, backgroundColor: t.canvas }]}>
                    <View style={h.draftTop}>
                      <View style={[h.draftTag, { backgroundColor: "#a855f7" + "18" }]}>
                        <Text style={[h.draftTagText, { color: "#a855f7" }]}>{TIPO_LABEL[d.tipo] ?? d.tipo}</Text>
                      </View>
                      <Text style={[h.draftSegment, { color: t.subtle }]}>{SEGMENT_LABEL[d.segmento] ?? d.segmento}</Text>
                    </View>
                    <Text style={[h.draftName, { color: t.ink }]}>{d.nombre}</Text>
                    <Text style={[h.draftMsg, { color: t.muted }]}>{d.mensaje}</Text>
                    {d.razon && <Text style={[h.draftReason, { color: t.subtle }]}>💡 {d.razon}</Text>}
                    <TouchableOpacity
                      onPress={() => saveAsTemplate(d, i)}
                      disabled={savedTemplates.has(i)}
                      style={[h.draftSaveBtn, { borderColor: t.lineStrong }, savedTemplates.has(i) && { opacity: 0.5 }]}
                    >
                      <Ionicons name={savedTemplates.has(i) ? "checkmark" : "bookmark-outline"} size={14} color={t.ink} />
                      <Text style={[h.draftSaveText, { color: t.ink }]}>
                        {savedTemplates.has(i) ? "Guardada en plantillas" : "Guardar como plantilla"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            </Card>

            {/* Configuración */}
            <Card delay={160}>
              <CardHead title="Personalidad de Hanna" sub="Cómo atiende a tus clientes" />
              <View style={{ padding: 16, gap: 16 }}>
                <View>
                  <Text style={[h.fieldLabel, { color: t.subtle }]}>Saludo inicial</Text>
                  <TextInput
                    style={[h.input, { backgroundColor: t.inputBg, borderColor: t.inputBorder, color: t.ink }]}
                    value={greeting}
                    onChangeText={setGreeting}
                    placeholder="Ej: ¡Hola! Soy Hanna 👋 ¿En qué te ayudo?"
                    placeholderTextColor={t.subtle}
                  />
                </View>

                <View>
                  <Text style={[h.fieldLabel, { color: t.subtle }]}>Tono de comunicación</Text>
                  <View style={h.toneRow}>
                    {TONE_OPTIONS.map(o => (
                      <TouchableOpacity
                        key={o.value}
                        style={[h.toneChip, { borderColor: t.line }, tone === o.value && { backgroundColor: t.ink, borderColor: t.ink }]}
                        onPress={() => setTone(o.value)}
                      >
                        <Text style={[h.toneText, { color: tone === o.value ? t.cardSolid : t.muted }]}>{o.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                <View>
                  <Text style={[h.fieldLabel, { color: t.subtle }]}>Instrucciones adicionales</Text>
                  <TextInput
                    style={[h.input, { backgroundColor: t.inputBg, borderColor: t.inputBorder, color: t.ink, minHeight: 72, textAlignVertical: "top" }]}
                    value={extra}
                    onChangeText={setExtra}
                    placeholder="Ej: Menciona siempre nuestra promo de martes..."
                    placeholderTextColor={t.subtle}
                    multiline
                  />
                </View>

                <TouchableOpacity onPress={saveConfig} disabled={saving} activeOpacity={0.85} style={{ borderRadius: Radius.md, overflow: "hidden" }}>
                  <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={h.saveBtn}>
                    {saving ? <ActivityIndicator color="white" /> : (
                      <Text style={h.saveBtnText}>{savedOk ? "¡Guardado! ✓" : "Guardar configuración"}</Text>
                    )}
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </Card>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const h = StyleSheet.create({
  hero:      { flexDirection: "row", alignItems: "center", gap: 14 },
  avatar:    { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
  heroTitle: { fontSize: 20, fontFamily: Fonts.serifItalic, letterSpacing: -0.3 },
  heroSub:   { fontSize: 12.5, fontFamily: Fonts.regular, marginTop: 2 },

  digestText: { fontSize: 13.5, fontFamily: Fonts.regular, lineHeight: 20 },
  svcRow:     { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  svcName:    { fontSize: 13, fontFamily: Fonts.semibold, flex: 1 },
  svcCount:   { fontSize: 12, fontFamily: Fonts.mono },
  bulletRow:  { flexDirection: "row", gap: 8, alignItems: "flex-start", marginTop: 8 },
  bullet:     { width: 6, height: 6, borderRadius: 3, marginTop: 6 },
  bulletText: { fontSize: 13, fontFamily: Fonts.regular, flex: 1, lineHeight: 19 },

  genBtn:      { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14 },
  genBtnText:  { fontSize: 14, fontFamily: Fonts.bold, color: "white" },
  draft:       { borderWidth: 1, borderRadius: Radius.md, padding: 14, marginTop: 12 },
  draftTop:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  draftTag:    { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 20 },
  draftTagText:{ fontSize: 11, fontFamily: Fonts.semibold },
  draftSegment:{ fontSize: 11, fontFamily: Fonts.mono },
  draftName:   { fontSize: 14, fontFamily: Fonts.bold, marginBottom: 6 },
  draftMsg:    { fontSize: 13, fontFamily: Fonts.regular, lineHeight: 19 },
  draftReason: { fontSize: 12, fontFamily: Fonts.regular, marginTop: 8, fontStyle: "italic" },
  draftSaveBtn:{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1.5, borderRadius: Radius.sm, paddingVertical: 10, marginTop: 12 },
  draftSaveText:{ fontSize: 12.5, fontFamily: Fonts.semibold },

  fieldLabel: { fontSize: 11, fontFamily: Fonts.mono, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 },
  input:      { borderWidth: 1.5, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontFamily: Fonts.regular },
  toneRow:    { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  toneChip:   { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5 },
  toneText:   { fontSize: 12.5, fontFamily: Fonts.semibold },
  saveBtn:    { paddingVertical: 15, alignItems: "center" },
  saveBtnText:{ fontSize: 14, fontFamily: Fonts.bold, color: "white" },
});
