import { useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, Image,
  Modal, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Fonts } from "@/constants/theme";
import { Config, authedFetch } from "@/lib/config";

// Identidad de Hanna: violeta → rosa
const HGRAD = ["#a855f7", "#ec4899"] as const;
const HANNA = require("@/assets/hanna.png");

const SUGGESTIONS = [
  "¿Cómo va mi día hoy?",
  "¿Cuántas citas tengo mañana?",
  "¿Qué servicios se venden más?",
  "¿Cuánto he vendido este mes?",
];

type Msg = { role: "user" | "assistant"; content: string };

// Botón flotante de Hanna — el "copiloto" del negocio. Se monta en el
// layout admin, así aparece sobre todas las pantallas con tab bar.
export default function HannaFab() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (open) setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
  }, [msgs, busy, open]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    setInput("");
    const next: Msg[] = [...msgs, { role: "user", content }];
    setMsgs(next);
    setBusy(true);
    try {
      const res = await authedFetch(Config.api.hannaChat, {
        method: "POST",
        body: JSON.stringify({ messages: next.slice(-12) }),
      });
      const json = await res.json().catch(() => ({}));
      setMsgs(m => [...m, {
        role: "assistant",
        content: res.ok && json.reply ? json.reply : (json.error ?? "No pude procesar tu pregunta, intenta de nuevo."),
      }]);
    } catch {
      setMsgs(m => [...m, { role: "assistant", content: "Error de conexión, intenta de nuevo." }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* FAB */}
      <TouchableOpacity style={s.fab} onPress={() => setOpen(true)} activeOpacity={0.85}>
        <LinearGradient colors={HGRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.fabRing}>
          <Image source={HANNA} style={s.fabImg} />
        </LinearGradient>
      </TouchableOpacity>

      {/* Chat */}
      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={s.backdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setOpen(false)} />
          <SafeAreaView style={s.sheet} edges={["bottom"]}>
            <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
              {/* Header */}
              <LinearGradient colors={["rgba(168,85,247,0.18)", "rgba(236,72,153,0.08)"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.header}>
                <View style={s.hAvatarRing}>
                  <Image source={HANNA} style={s.hAvatar} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.hName}>Hanna IA</Text>
                  <Text style={s.hRole}>Copiloto de tu negocio</Text>
                </View>
                <TouchableOpacity onPress={() => setOpen(false)} style={s.closeBtn}>
                  <Ionicons name="close" size={20} color="rgba(245,240,255,0.5)" />
                </TouchableOpacity>
              </LinearGradient>

              {/* Messages */}
              <ScrollView ref={scrollRef} style={s.body} contentContainerStyle={{ padding: 14, gap: 8 }} keyboardShouldPersistTaps="handled">
                <View style={[s.bub, s.bubBot]}>
                  <Text style={s.bubBotText}>Hola 👋 Soy tu copiloto. Pregúntame por tus citas, ventas, clientes o servicios.</Text>
                </View>

                {msgs.map((m, i) => (
                  <View key={i} style={[s.bub, m.role === "assistant" ? s.bubBot : s.bubMeWrap]}>
                    {m.role === "user" ? (
                      <LinearGradient colors={HGRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.bubMe}>
                        <Text style={s.bubMeText}>{m.content}</Text>
                      </LinearGradient>
                    ) : (
                      <Text style={s.bubBotText}>{m.content}</Text>
                    )}
                  </View>
                ))}

                {busy && (
                  <View style={[s.bub, s.bubBot]}>
                    <Text style={[s.bubBotText, { color: "rgba(245,240,255,0.4)" }]}>consultando tus datos…</Text>
                  </View>
                )}

                {!busy && msgs.length === 0 && (
                  <View style={{ gap: 6, marginTop: 2 }}>
                    {SUGGESTIONS.map((q, i) => (
                      <TouchableOpacity key={i} style={s.sugg} onPress={() => send(q)} activeOpacity={0.7}>
                        <Text style={s.suggText}>{q}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </ScrollView>

              {/* Input */}
              <View style={s.inputRow}>
                <TextInput
                  style={s.input}
                  value={input}
                  onChangeText={setInput}
                  placeholder="Pregunta por tu negocio…"
                  placeholderTextColor="rgba(245,240,255,0.35)"
                  maxLength={600}
                  onSubmitEditing={() => send(input)}
                  returnKeyType="send"
                />
                <TouchableOpacity
                  style={[s.sendBtn, (busy || !input.trim()) && { opacity: 0.45 }]}
                  onPress={() => send(input)}
                  disabled={busy || !input.trim()}
                  activeOpacity={0.85}
                >
                  <LinearGradient colors={HGRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.sendGrad}>
                    {busy ? <ActivityIndicator color="white" size="small" /> : <Ionicons name="arrow-up" size={18} color="white" />}
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </KeyboardAvoidingView>
          </SafeAreaView>
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  fab:      { position: "absolute", right: 18, bottom: 96, width: 56, height: 56, borderRadius: 28, zIndex: 40, shadowColor: "#a855f7", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 14, elevation: 8 },
  fabRing:  { width: 56, height: 56, borderRadius: 28, padding: 2.5, alignItems: "center", justifyContent: "center" },
  fabImg:   { width: "100%", height: "100%", borderRadius: 26 },

  backdrop: { flex: 1, backgroundColor: "rgba(7,5,15,0.55)", justifyContent: "flex-end" },
  sheet:    { backgroundColor: "#100D1F", borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, borderColor: "rgba(168,85,247,0.25)", overflow: "hidden", maxHeight: "82%" },

  header:   { flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: "rgba(168,85,247,0.16)" },
  hAvatarRing: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: "rgba(168,85,247,0.5)", overflow: "hidden" },
  hAvatar:  { width: "100%", height: "100%" },
  hName:    { fontSize: 15, fontFamily: Fonts.bold, color: "#F5F0FF" },
  hRole:    { fontSize: 11.5, fontFamily: Fonts.regular, color: "#c084fc", marginTop: 1 },
  closeBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },

  body:     { flexGrow: 0 },
  bub:      { maxWidth: "88%" },
  bubBot:   { alignSelf: "flex-start", backgroundColor: "rgba(168,85,247,0.10)", borderWidth: 1, borderColor: "rgba(168,85,247,0.18)", borderRadius: 13, borderBottomLeftRadius: 4, paddingHorizontal: 12, paddingVertical: 9 },
  bubBotText: { fontSize: 13.5, fontFamily: Fonts.regular, color: "rgba(245,240,255,0.88)", lineHeight: 20 },
  bubMeWrap: { alignSelf: "flex-end" },
  bubMe:    { borderRadius: 13, borderBottomRightRadius: 4, paddingHorizontal: 12, paddingVertical: 9 },
  bubMeText: { fontSize: 13.5, fontFamily: Fonts.regular, color: "white", lineHeight: 20 },

  sugg:     { borderWidth: 1, borderColor: "rgba(168,85,247,0.2)", backgroundColor: "rgba(168,85,247,0.07)", borderRadius: 11, paddingHorizontal: 12, paddingVertical: 10 },
  suggText: { fontSize: 13, fontFamily: Fonts.semibold, color: "#F5F0FF" },

  inputRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 11, borderTopWidth: 1, borderTopColor: "rgba(168,85,247,0.16)" },
  input:    { flex: 1, borderWidth: 1, borderColor: "rgba(168,85,247,0.25)", backgroundColor: "rgba(168,85,247,0.06)", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 14, fontFamily: Fonts.regular, color: "#F5F0FF" },
  sendBtn:  { width: 42, height: 42, borderRadius: 12, overflow: "hidden" },
  sendGrad: { flex: 1, alignItems: "center", justifyContent: "center" },
});
