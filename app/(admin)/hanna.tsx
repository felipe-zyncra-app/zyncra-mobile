import { useRef, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput,
  KeyboardAvoidingView, ActivityIndicator, Alert,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { Config, authedFetch } from "@/lib/config";
import { Colors, Fonts, Gradients, Radius } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { ScreenHeader, Card, CardHead, MonoTag } from "@/components/ui";
import ErrorState from "@/components/ErrorState";
import { revisar, mensajeError } from "@/lib/db";
import { useRecarga, useGuardRespuestas } from "@/lib/useRecarga";
import { hoyNegocio, inicioDeMes, fmtDia } from "@/lib/tz";
import { cuerpoGenerarCampanas, normalizarCampanas, type BorradorCampana } from "@/lib/hanna-contrato";

// Firma de esta vista: identidad Hanna (violeta → rosa)
const HGRAD = ["#a855f7", "#ec4899"] as const;
const HANNA = "#a855f7";

type Digest = {
  resumen?: string;
  servicios_top?: { nombre: string; menciones: number }[];
  horas_pico?: string[];
  preguntas_frecuentes?: string[];
  oportunidades?: string[];
  recomendaciones?: string[];
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
  reactivacion: "Reactivación", frecuentes: "Fidelización", agenda: "Llenar agenda", personalizada: "A tu medida",
};

export default function HannaScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const { tenantId } = useAuth();
  const { timezone, ready } = useTenant();
  const guard = useGuardRespuestas();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [cargado, setCargado] = useState(false);
  const [usedMonth, setUsedMonth] = useState(0);
  const [greeting, setGreeting] = useState("");
  const [tone, setTone] = useState("");
  const [extra, setExtra] = useState("");
  const [digest, setDigest] = useState<Digest | null>(null);
  const [digestWeek, setDigestWeek] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  // Si el dueño está editando la personalidad, una recarga al volver a la
  // pantalla no debe pisarle lo que escribió.
  const editado = useRef(false);

  const [brief, setBrief] = useState("");
  const [drafts, setDrafts] = useState<BorradorCampana[]>([]);
  const [generating, setGenerating] = useState(false);
  const [savedTemplates, setSavedTemplates] = useState<Set<number>>(new Set());
  const [savingIdx, setSavingIdx] = useState<number | null>(null);

  const { recargar } = useRecarga(async () => {
    if (!tenantId) return;
    const turno = guard.nuevo();
    try {
      // Primer día del mes EN LA ZONA DEL NEGOCIO: con setDate(1) +
      // toISOString, en Bogotá después de las 7 PM salía el día 2 (COM-20).
      const desde = inicioDeMes(hoyNegocio(timezone));
      const [usageRes, cfgRes, insightRes] = await Promise.all([
        supabase.from("ai_usage").select("messages").eq("tenant_id", tenantId).gte("day", desde),
        supabase.from("hanna_config").select("greeting, tone, extra_instructions").eq("tenant_id", tenantId).maybeSingle(),
        supabase.from("hanna_insights").select("week_start, digest").eq("tenant_id", tenantId).order("week_start", { ascending: false }).limit(1).maybeSingle(),
      ]);
      const usage = revisar(usageRes, "No se pudo cargar el uso de Hanna") as { messages: number | null }[] | null;
      const cfg = revisar(cfgRes, "No se pudo cargar la configuración de Hanna") as
        { greeting: string | null; tone: string | null; extra_instructions: string | null } | null;
      const insight = revisar(insightRes, "No se pudo cargar el resumen semanal") as { week_start: string; digest: Digest } | null;
      if (!turno.vigente()) return;

      setUsedMonth((usage ?? []).reduce((s, r) => s + (r.messages ?? 0), 0));
      if (!editado.current) {
        setGreeting(cfg?.greeting ?? "");
        setTone(cfg?.tone ?? "");
        setExtra(cfg?.extra_instructions ?? "");
      }
      setDigest(insight?.digest ?? null);
      setDigestWeek(insight?.week_start ?? null);
      setError(null);
      setCargado(true);
    } catch (e) {
      if (turno.vigente()) setError(e);
    } finally {
      if (turno.vigente()) setLoading(false);
    }
  }, [tenantId, timezone], { timeZone: timezone, habilitado: !!tenantId && ready, frescuraMs: 30_000 });

  const editar = (fn: (v: string) => void) => (v: string) => { editado.current = true; fn(v); };

  const saveConfig = async () => {
    if (!tenantId || saving) return;
    setSaving(true); setSavedOk(false);
    const { error: err } = await supabase.from("hanna_config").upsert({
      tenant_id: tenantId,
      greeting: greeting.trim() || null,
      tone: tone || null,
      extra_instructions: extra.trim() || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "tenant_id" });
    setSaving(false);
    if (err) {
      Alert.alert("No se guardó", mensajeError(err, "No se pudo guardar la personalidad de Hanna"));
      return;
    }
    editado.current = false;
    setSavedOk(true);
    setTimeout(() => setSavedOk(false), 2500);
  };

  const generateCampaigns = async () => {
    if (generating) return;
    setGenerating(true); setDrafts([]); setSavedTemplates(new Set());
    try {
      // Solo WhatsApp: pedir los 4 canales tarda más y gasta más cuota.
      const res = await authedFetch(Config.api.hannaCampaigns, {
        method: "POST",
        body: JSON.stringify(cuerpoGenerarCampanas(brief)),
        timeoutMs: Config.timeouts.campanas,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Nunca se expone el motivo del servidor: podría mencionar planes.
        if (json.unavailable) {
          Alert.alert("No disponible", "Esta función no está disponible en esta cuenta.");
        } else if (res.status === 429) {
          Alert.alert("Espera un momento", "Ya pediste varias campañas en la última hora. Inténtalo más tarde.");
        } else {
          Alert.alert("No se pudieron generar", "Hanna no pudo generar las campañas. Inténtalo de nuevo.");
        }
        return;
      }
      const borradores = normalizarCampanas(json);
      if (borradores.length === 0) {
        Alert.alert("Sin ideas por ahora", "Hanna no devolvió campañas con texto. Inténtalo de nuevo.");
        return;
      }
      setDrafts(borradores);
    } catch (e) {
      Alert.alert("No se pudieron generar", mensajeError(e));
    } finally {
      setGenerating(false);
    }
  };

  const saveAsTemplate = async (draft: BorradorCampana, idx: number) => {
    if (!tenantId || savingIdx !== null) return;
    const message = draft.mensaje.trim();
    if (!message) {
      Alert.alert("Sin texto", "Esta campaña no trae mensaje para guardar.");
      return;
    }
    setSavingIdx(idx);
    const { error: err } = await supabase.from("wa_templates").insert({
      tenant_id: tenantId,
      name: `Hanna — ${draft.nombre}`.slice(0, 80),
      message,
    });
    setSavingIdx(null);
    if (err) Alert.alert("No se guardó", mensajeError(err, "No se pudo guardar la plantilla"));
    else setSavedTemplates(prev => new Set(prev).add(idx));
  };

  const usarEnCampana = (draft: BorradorCampana) => {
    router.push({
      pathname: "/(admin)/whatsapp",
      params: { mensaje: draft.mensaje, segmento: draft.segmento, nombre: draft.nombre },
    });
  };

  if (error && !cargado) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.canvas }}>
        <ScreenHeader crumb="Marketing" title="Hanna IA" subtitle="Tu asistente de reservas por WhatsApp" onBack={() => router.back()} />
        <ErrorState error={error} onRetry={recargar} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.canvas }}>
      <ScreenHeader crumb="Marketing" title="Hanna IA" subtitle="Tu asistente de reservas por WhatsApp" onBack={() => router.back()} />

      {loading && !cargado ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={Colors.red} size="large" />
        </View>
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }}>
          <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 20, paddingBottom: 60, gap: 16 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

            {error ? (
              <TouchableOpacity onPress={recargar} activeOpacity={0.8} style={[h.banner, { backgroundColor: t.chipBg, borderColor: t.line }]}>
                <Ionicons name="cloud-offline-outline" size={15} color={t.muted} />
                <Text style={[h.bannerText, { color: t.muted }]}>{mensajeError(error)} Toca para reintentar.</Text>
              </TouchableOpacity>
            ) : null}

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
                  // week_start es 'YYYY-MM-DD': new Date() lo leía como
                  // medianoche UTC y en LatAm mostraba el día anterior.
                  sub={digestWeek ? `Semana del ${fmtDia(digestWeek, "largo")}` : undefined}
                  aside="IA"
                />
                <View style={{ padding: 16, gap: 14 }}>
                  {digest.resumen ? <Text style={[h.digestText, { color: t.muted }]}>{digest.resumen}</Text> : null}

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
                          <View style={[h.bullet, { backgroundColor: HANNA }]} />
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
              <CardHead title="Campañas sugeridas" sub="Hanna propone mensajes de WhatsApp según tus clientes" />
              <View style={{ padding: 16 }}>
                <Text style={[h.fieldLabel, { color: t.subtle }]}>¿Qué campaña quieres? (opcional)</Text>
                <TextInput
                  style={[h.input, { backgroundColor: t.inputBg, borderColor: t.inputBorder, color: t.ink, marginBottom: 12 }]}
                  value={brief}
                  onChangeText={setBrief}
                  placeholder="Ej: promo de martes para clientes que no vienen hace rato"
                  placeholderTextColor={t.subtle}
                  maxLength={300}
                />
                <TouchableOpacity onPress={generateCampaigns} disabled={generating} activeOpacity={0.85} style={{ borderRadius: Radius.md, overflow: "hidden" }}
                  accessibilityRole="button" accessibilityState={{ disabled: generating, busy: generating }}>
                  <LinearGradient colors={HGRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={h.genBtn}>
                    {generating ? (
                      <>
                        <ActivityIndicator color="white" />
                        <Text style={h.genBtnText}>Generando… puede tardar un minuto</Text>
                      </>
                    ) : (
                      <>
                        <Ionicons name="sparkles" size={16} color="white" />
                        <Text style={h.genBtnText}>{brief.trim() ? "Generar esta campaña" : "Generar campañas"}</Text>
                      </>
                    )}
                  </LinearGradient>
                </TouchableOpacity>

                {drafts.map((d, i) => {
                  const guardada = savedTemplates.has(i);
                  return (
                    <View key={i} style={[h.draft, { borderColor: t.line, backgroundColor: t.canvas }]}>
                      <View style={h.draftTop}>
                        <View style={[h.draftTag, { backgroundColor: HANNA + "18" }]}>
                          <Text style={[h.draftTagText, { color: HANNA }]}>{TIPO_LABEL[d.tipo] ?? d.tipo}</Text>
                        </View>
                        <Text style={[h.draftSegment, { color: t.subtle }]}>{SEGMENT_LABEL[d.segmento] ?? d.segmento}</Text>
                      </View>
                      <Text style={[h.draftName, { color: t.ink }]}>{d.nombre}</Text>
                      <Text style={[h.draftMsg, { color: t.muted }]}>{d.mensaje}</Text>
                      {d.razon ? <Text style={[h.draftReason, { color: t.subtle }]}>💡 {d.razon}</Text> : null}
                      <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                        <TouchableOpacity
                          onPress={() => saveAsTemplate(d, i)}
                          disabled={guardada || savingIdx !== null}
                          style={[h.draftSaveBtn, { borderColor: t.lineStrong, flex: 1 }, (guardada || savingIdx !== null) && { opacity: 0.5 }]}
                          accessibilityRole="button"
                        >
                          {savingIdx === i
                            ? <ActivityIndicator size="small" color={t.ink} />
                            : <Ionicons name={guardada ? "checkmark" : "bookmark-outline"} size={14} color={t.ink} />}
                          <Text style={[h.draftSaveText, { color: t.ink }]}>
                            {guardada ? "En plantillas" : "Guardar plantilla"}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => usarEnCampana(d)}
                          style={[h.draftSaveBtn, { borderColor: HANNA, backgroundColor: HANNA + "14", flex: 1 }]}
                          accessibilityRole="button"
                        >
                          <Ionicons name="send-outline" size={14} color={HANNA} />
                          <Text style={[h.draftSaveText, { color: HANNA }]}>Usar en campaña</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
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
                    onChangeText={editar(setGreeting)}
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
                        onPress={() => editar(setTone)(o.value)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: tone === o.value }}
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
                    onChangeText={editar(setExtra)}
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
  banner:     { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: Radius.md, padding: 12 },
  bannerText: { flex: 1, fontSize: 12.5, fontFamily: Fonts.regular, lineHeight: 18 },

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
  draftSaveBtn:{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1.5, borderRadius: Radius.sm, paddingVertical: 10 },
  draftSaveText:{ fontSize: 12.5, fontFamily: Fonts.semibold },

  fieldLabel: { fontSize: 11, fontFamily: Fonts.mono, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 },
  input:      { borderWidth: 1.5, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontFamily: Fonts.regular },
  toneRow:    { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  toneChip:   { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5 },
  toneText:   { fontSize: 12.5, fontFamily: Fonts.semibold },
  saveBtn:    { paddingVertical: 15, alignItems: "center" },
  saveBtnText:{ fontSize: 14, fontFamily: Fonts.bold, color: "white" },
});
