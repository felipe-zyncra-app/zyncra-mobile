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
import { Colors, Gradients, Radius, Shadow } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { sendPushNow, sendPushSequence } from "@/lib/notifications";

const FAKE_CLIENTS = ["Andrés Gómez", "Camila Ríos", "Santiago Pérez", "Valentina Cruz"];
const FAKE_TIMES   = ["hoy 3:00 pm", "mañana 10:00 am", "hoy 5:30 pm", "el sábado 11:00 am"];

// Fires 1.5s after tapping, then ~2s apart — arrivals at ~1.5s, 3.5s, 5.5s, 8s.
// Runs server-side so it keeps delivering with the screen off. Kept above ~1.5s
// per gap so each one still renders as its own banner instead of the OS
// swallowing an in-flight animation when a second one lands too soon after.
const SEQUENCE_DELAYS = [1500, 2000, 2000, 2500];

export default function PushNowScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const { tenantId } = useAuth();
  const [services, setServices]     = useState<string[]>([]);
  const [sendingKey, setSendingKey] = useState<string | null>(null);
  const [successKey, setSuccessKey] = useState<string | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const [customText, setCustomText] = useState("");

  useEffect(() => {
    if (!tenantId) return;
    supabase.from("services").select("name").eq("tenant_id", tenantId)
      .then(({ data }) => setServices((data ?? []).map((s) => s.name).filter(Boolean)));
  }, [tenantId]);

  const buildSequence = () => {
    if (!services.length) return [];
    return SEQUENCE_DELAYS.map((delayMs, i) => ({
      title: "Nueva cita agendada 📅",
      body: `${FAKE_CLIENTS[i % FAKE_CLIENTS.length]} reservó ${services[i % services.length]} para ${FAKE_TIMES[i % FAKE_TIMES.length]}`,
      delayMs,
    }));
  };

  const send = async (key: string, body: string) => {
    if (sendingKey || !body.trim()) return;
    setError(null);
    setSendingKey(key);
    try {
      await sendPushNow(body.trim(), "Zyncra 🪂");
      setSuccessKey(key);
      setTimeout(() => setSuccessKey(null), 2500);
      if (key === "custom") setCustomText("");
    } catch (e: any) {
      setError(e?.message || "No se pudo enviar. Revisa tu conexión.");
    } finally {
      setSendingKey(null);
    }
  };

  const sendSequence = async () => {
    const messages = buildSequence();
    if (sendingKey || !messages.length) return;
    setError(null);
    setSendingKey("sequence");
    try {
      await sendPushSequence(messages);
      setSuccessKey("sequence");
      setTimeout(() => setSuccessKey(null), 2500);
    } catch (e: any) {
      setError(e?.message || "No se pudo programar la secuencia.");
    } finally {
      setSendingKey(null);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.header}>
        <View style={s.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="arrow-back" size={20} color="white" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.headerTitle}>Notificación al vuelo</Text>
            <Text style={s.headerSub}>Para el día del salto 🪂</Text>
          </View>
        </View>
      </LinearGradient>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
          <Animated.View entering={FadeInDown.duration(350)}>
            <Text style={[s.sectionTitle, { color: t.subtle }]}>Simular reservas</Text>
            <TouchableOpacity
              style={[s.heroBtn, (!!sendingKey || !services.length) && sendingKey !== "sequence" && { opacity: 0.5 }]}
              onPress={sendSequence}
              disabled={!!sendingKey || !services.length}
              activeOpacity={0.85}
            >
              <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.heroBtnGrad}>
                <View style={s.heroBtnIcon}>
                  {sendingKey === "sequence" ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Ionicons name={successKey === "sequence" ? "checkmark-circle" : "calendar"} size={22} color="white" />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.heroBtnLabel}>
                    {successKey === "sequence" ? "¡Secuencia programada!" : "Simular 4 reservas en vivo"}
                  </Text>
                  <Text style={s.heroBtnSub}>
                    {services.length
                      ? "Llegan seguidas en ~8s con tus servicios reales, aunque apagues la pantalla"
                      : "Cargando tus servicios…"}
                  </Text>
                </View>
              </LinearGradient>
            </TouchableOpacity>
            {services.length > 0 && (
              <Text style={[s.servicesHint, { color: t.subtle }]}>
                Usando: {services.join(", ")}
              </Text>
            )}
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(80).duration(350)}>
            <Text style={[s.sectionTitle, { color: t.subtle, marginTop: 24 }]}>Mensaje personalizado</Text>
            <TextInput
              style={[s.input, { backgroundColor: t.bgAlt, borderColor: t.border, color: t.text }]}
              value={customText}
              onChangeText={setCustomText}
              placeholder="Escribe el mensaje a enviar..."
              placeholderTextColor={t.subtle}
              multiline
            />
            <TouchableOpacity
              style={[s.sendCustomBtn, (!customText.trim() || !!sendingKey) && { opacity: 0.4 }]}
              onPress={() => send("custom", customText)}
              disabled={!customText.trim() || !!sendingKey}
              activeOpacity={0.85}
            >
              {sendingKey === "custom" ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={s.sendCustomText}>{successKey === "custom" ? "¡Enviado! ✓" : "Enviar"}</Text>
              )}
            </TouchableOpacity>
          </Animated.View>

          {error && (
            <Animated.View entering={FadeInDown.duration(300)} style={[s.errorBanner, Shadow.sm]}>
              <Ionicons name="alert-circle" size={18} color={Colors.red} />
              <Text style={s.errorText}>{error}</Text>
            </Animated.View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header:      { paddingTop: 16, paddingHorizontal: 24, paddingBottom: 20 },
  headerRow:   { flexDirection: "row", alignItems: "center", gap: 12 },
  backBtn:     { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,.18)", alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 22, fontFamily: "SpaceGrotesk_700Bold", color: "white", letterSpacing: -0.4 },
  headerSub:   { fontSize: 12, color: "rgba(255,255,255,.75)", fontFamily: "SpaceGrotesk_400Regular", marginTop: 2 },
  sectionTitle: { fontSize: 12, fontFamily: "SpaceGrotesk_700Bold", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 },
  heroBtn:     { borderRadius: Radius.lg, overflow: "hidden", marginBottom: 8 },
  heroBtnGrad: { flexDirection: "row", alignItems: "center", gap: 14, padding: 18 },
  heroBtnIcon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,.18)" },
  heroBtnLabel: { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
  heroBtnSub:  { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: "rgba(255,255,255,.8)", marginTop: 2 },
  servicesHint: { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", marginTop: 4, marginLeft: 4 },
  input:       { minHeight: 90, borderWidth: 1.5, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, fontFamily: "SpaceGrotesk_400Regular", textAlignVertical: "top", marginBottom: 12 },
  sendCustomBtn: { borderRadius: Radius.full, paddingVertical: 16, alignItems: "center", backgroundColor: Colors.red },
  sendCustomText: { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
  errorBanner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: Colors.red + "12", borderRadius: Radius.md, padding: 14, marginTop: 16 },
  errorText:   { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.red, flex: 1 },
});
