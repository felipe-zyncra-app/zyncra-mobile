import { useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, Image,
  Modal, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator, Dimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Fonts } from "@/constants/theme";
import { Config, authedFetch } from "@/lib/config";
import { useAuth } from "@/lib/auth";
import { getActiveLocationId } from "@/lib/active-location";
import { leerAccionPendiente, type AccionPendiente } from "@/lib/hanna-contrato";

// Identidad de Hanna: violeta → rosa
const HGRAD = ["#a855f7", "#ec4899"] as const;
const HANNA = require("@/assets/hanna.png");
const SCREEN_H = Dimensions.get("window").height;
// El copiloto puede dar hasta 3 vueltas de herramientas y el servidor corta a
// los 30 s (maxDuration): con el tope de chat (25 s) se cortaban respuestas
// válidas. Config.timeouts.copiloto (40 s) cubre ese caso y sigue evitando el
// "consultando…" eterno.
const TOPE_COPILOTO = Config.timeouts.copiloto;

const SUGGESTIONS = [
  "¿Cómo va mi día hoy?",
  "¿Cuántas citas tengo mañana?",
  "¿Qué servicios se venden más?",
  "¿Cuánto he vendido este mes?",
];

type Msg = { role: "user" | "assistant"; content: string };

function esTimeout(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as { name?: string }).name === "TimeoutError";
}

// Botón flotante de Hanna — el "copiloto" del negocio. Se monta en el
// layout admin, así aparece sobre todas las pantallas con tab bar.
export default function HannaFab() {
  const { tenantId } = useAuth();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // Acción destructiva (cancelar cita, editar/borrar servicio) que el
  // servidor dejó en espera: sin este paso el dueño decía "sí" y el modelo
  // volvía a proponerla en un ciclo sin salida (COM-10).
  const [pending, setPending] = useState<AccionPendiente | null>(null);
  // Si la cuenta no tiene Hanna, el botón simplemente no se muestra: nunca se
  // le ofrece al usuario algo que no puede usar.
  const [available, setAvailable] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // Sonda de disponibilidad por negocio: al cambiar de cuenta se limpia la
  // conversación, que tenía datos del negocio anterior.
  useEffect(() => {
    setMsgs([]);
    setPending(null);
    setOpen(false);
    if (!tenantId) { setAvailable(false); return; }
    let vigente = true;
    (async () => {
      try {
        const res = await authedFetch(Config.api.hannaChat, { method: "GET", timeoutMs: Config.timeouts.chat });
        const json = await res.json().catch(() => ({}));
        if (vigente) setAvailable(res.ok && json.available === true);
      } catch {
        if (vigente) setAvailable(false);
      }
    })();
    return () => { vigente = false; };
  }, [tenantId]);

  useEffect(() => {
    if (open) setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
  }, [msgs, busy, open, pending]);

  const decir = (content: string) => setMsgs(m => [...m, { role: "assistant", content }]);

  const retirar = () => {
    // La cuenta perdió el acceso: se cierra el chat y se retira el botón,
    // sin mostrar mensajes de suscripción.
    setOpen(false);
    setAvailable(false);
    setPending(null);
  };

  /** POST al copiloto con la sede activa: sin ella, un servicio creado desde
   *  el móvil caía en la sede más antigua y no en la que el dueño tiene abierta. */
  const post = async (payload: Record<string, unknown>) => {
    const locationId = await getActiveLocationId(tenantId).catch(() => null);
    const res = await authedFetch(Config.api.hannaChat, {
      method: "POST",
      body: JSON.stringify({ ...payload, locationId }),
      timeoutMs: TOPE_COPILOTO,
    });
    const json = await res.json().catch(() => ({}));
    return { res, json };
  };

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    setInput("");
    setPending(null); // escribir algo nuevo descarta la acción sin aprobar
    const next: Msg[] = [...msgs, { role: "user", content }];
    setMsgs(next);
    setBusy(true);
    try {
      const { res, json } = await post({ messages: next.slice(-12) });
      if (res.ok && json.reply) {
        decir(String(json.reply));
        const accion = leerAccionPendiente(json);
        if (accion) setPending(accion);
      } else if (json.unavailable) {
        retirar();
      } else if (res.status === 429) {
        decir("Vas muy rápido. Espera un minuto e intenta de nuevo.");
      } else {
        decir("No pude procesar tu pregunta, intenta de nuevo.");
      }
    } catch (e) {
      decir(esTimeout(e) ? "Tardé demasiado en responder. Intenta de nuevo." : "Error de conexión, intenta de nuevo.");
    } finally {
      setBusy(false);
    }
  };

  const confirmPending = async () => {
    if (!pending || busy) return;
    const accion = pending;
    setPending(null);
    setBusy(true);
    try {
      const { res, json } = await post({ confirm: { tool: accion.tool, args: accion.args } });
      if (res.ok && json.reply) decir(String(json.reply));
      else if (json.unavailable) retirar();
      else decir("No pude hacer el cambio. No se modificó nada.");
    } catch {
      // Sin respuesta no se sabe si el servidor alcanzó a ejecutarla.
      decir("No pude confirmar si el cambio se hizo. Revísalo en la app antes de repetirlo.");
    } finally {
      setBusy(false);
    }
  };

  const cancelPending = () => {
    setPending(null);
    decir("Listo, no hice ningún cambio.");
  };

  if (!available) return null;

  return (
    <>
      {/* FAB */}
      <TouchableOpacity style={s.fab} onPress={() => setOpen(true)} activeOpacity={0.85}
        accessibilityRole="button" accessibilityLabel="Abrir Hanna, el copiloto de tu negocio">
        <LinearGradient colors={HGRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.fabRing}>
          <Image source={HANNA} style={s.fabImg} />
        </LinearGradient>
      </TouchableOpacity>

      {/* Chat */}
      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView style={s.backdrop} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setOpen(false)}
            accessibilityLabel="Cerrar Hanna" accessibilityRole="button" />
          <SafeAreaView style={s.sheet} edges={["bottom"]}>
            <View>
              {/* Header */}
              <LinearGradient colors={["rgba(168,85,247,0.18)", "rgba(236,72,153,0.08)"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.header}>
                <View style={s.hAvatarRing}>
                  <Image source={HANNA} style={s.hAvatar} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.hName}>Hanna IA</Text>
                  <Text style={s.hRole}>Copiloto de tu negocio</Text>
                </View>
                <TouchableOpacity onPress={() => setOpen(false)} style={s.closeBtn} hitSlop={8}
                  accessibilityRole="button" accessibilityLabel="Cerrar">
                  <Ionicons name="close" size={20} color="rgba(245,240,255,0.5)" />
                </TouchableOpacity>
              </LinearGradient>

              {/* Messages */}
              <ScrollView ref={scrollRef} style={s.body} contentContainerStyle={{ padding: 14, gap: 8 }} keyboardShouldPersistTaps="handled">
                <View style={[s.bub, s.bubBot]}>
                  <Text style={s.bubBotText}>Hola 👋 Soy tu copiloto. Pregúntame por tus citas, ventas, clientes o servicios. También puedo cancelar citas o cambiar servicios: antes de hacerlo te pido confirmación.</Text>
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

                {pending && !busy && (
                  <View style={s.pending} accessibilityLiveRegion="polite">
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
                      <Ionicons name="shield-checkmark-outline" size={15} color="#f0abfc" />
                      <Text style={s.pendingTitle}>Confirma antes de que lo haga</Text>
                    </View>
                    <Text style={s.pendingText}>{pending.summary}</Text>
                    <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                      <TouchableOpacity style={[s.pendingBtn, s.pendingCancel]} onPress={cancelPending} activeOpacity={0.8}
                        accessibilityRole="button" accessibilityLabel="Cancelar la acción">
                        <Text style={s.pendingCancelText}>Cancelar</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[s.pendingBtn, { overflow: "hidden" }]} onPress={confirmPending} activeOpacity={0.85}
                        accessibilityRole="button" accessibilityLabel="Confirmar la acción">
                        <LinearGradient colors={HGRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.pendingConfirm}>
                          <Text style={s.pendingConfirmText}>Confirmar</Text>
                        </LinearGradient>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                {busy && (
                  <View style={[s.bub, s.bubBot]}>
                    <Text style={[s.bubBotText, { color: "rgba(245,240,255,0.4)" }]}>consultando tus datos…</Text>
                  </View>
                )}

                {!busy && !pending && msgs.length === 0 && (
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
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel="Enviar pregunta"
                  accessibilityState={{ disabled: busy || !input.trim(), busy }}
                >
                  <LinearGradient colors={HGRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.sendGrad}>
                    {busy ? <ActivityIndicator color="white" size="small" /> : <Ionicons name="arrow-up" size={18} color="white" />}
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </View>
          </SafeAreaView>
        </KeyboardAvoidingView>
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

  body:     { maxHeight: SCREEN_H * 0.42 },
  bub:      { maxWidth: "88%" },
  bubBot:   { alignSelf: "flex-start", backgroundColor: "rgba(168,85,247,0.10)", borderWidth: 1, borderColor: "rgba(168,85,247,0.18)", borderRadius: 13, borderBottomLeftRadius: 4, paddingHorizontal: 12, paddingVertical: 9 },
  bubBotText: { fontSize: 13.5, fontFamily: Fonts.regular, color: "rgba(245,240,255,0.88)", lineHeight: 20 },
  bubMeWrap: { alignSelf: "flex-end" },
  bubMe:    { borderRadius: 13, borderBottomRightRadius: 4, paddingHorizontal: 12, paddingVertical: 9 },
  bubMeText: { fontSize: 13.5, fontFamily: Fonts.regular, color: "white", lineHeight: 20 },

  pending:      { borderWidth: 1, borderColor: "rgba(236,72,153,0.35)", backgroundColor: "rgba(236,72,153,0.08)", borderRadius: 13, padding: 12 },
  pendingTitle: { fontSize: 12.5, fontFamily: Fonts.bold, color: "#f0abfc" },
  pendingText:  { fontSize: 13.5, fontFamily: Fonts.regular, color: "rgba(245,240,255,0.92)", lineHeight: 20 },
  pendingBtn:   { flex: 1, height: 40, borderRadius: 10 },
  pendingCancel:{ borderWidth: 1, borderColor: "rgba(245,240,255,0.25)", alignItems: "center", justifyContent: "center" },
  pendingCancelText: { fontSize: 13.5, fontFamily: Fonts.semibold, color: "rgba(245,240,255,0.85)" },
  pendingConfirm:    { flex: 1, alignItems: "center", justifyContent: "center" },
  pendingConfirmText:{ fontSize: 13.5, fontFamily: Fonts.bold, color: "white" },

  sugg:     { borderWidth: 1, borderColor: "rgba(168,85,247,0.2)", backgroundColor: "rgba(168,85,247,0.07)", borderRadius: 11, paddingHorizontal: 12, paddingVertical: 10 },
  suggText: { fontSize: 13, fontFamily: Fonts.semibold, color: "#F5F0FF" },

  inputRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 11, borderTopWidth: 1, borderTopColor: "rgba(168,85,247,0.16)" },
  input:    { flex: 1, borderWidth: 1, borderColor: "rgba(168,85,247,0.25)", backgroundColor: "rgba(168,85,247,0.06)", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 14, fontFamily: Fonts.regular, color: "#F5F0FF" },
  sendBtn:  { width: 42, height: 42, borderRadius: 12, overflow: "hidden" },
  sendGrad: { flex: 1, alignItems: "center", justifyContent: "center" },
});
