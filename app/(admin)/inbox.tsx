import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, TextInput,
  Modal, ActivityIndicator, RefreshControl, KeyboardAvoidingView,
  Platform, Alert, ScrollView,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { Config, authedFetch } from "@/lib/config";
import { Colors, Gradients, Radius, Shadow } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import Avatar from "@/components/Avatar";

/**
 * Bandeja de chats de WhatsApp — espejo de /admin/inbox del panel web.
 * El número conectado a la API deja de funcionar en WhatsApp Business,
 * así que el negocio ve y contesta desde aquí. Hanna responde sola y el
 * humano puede pausarla por chat para tomar la conversación.
 */

type Chat = {
  tenant_id: string;
  phone: string;
  client_name: string | null;
  bot_paused: boolean;
  unread: number;
  last_message_at: string;
  last_message_preview: string | null;
};

type Msg = {
  id: string;
  phone: string;
  direction: "in" | "out";
  sender: "client" | "hanna" | "human";
  body: string;
  created_at: string;
};

const HANNA = "#a855f7";
const WA_GREEN = "#25D366";
const WA_BG = "#efeae2";
const WINDOW_MS = 24 * 60 * 60 * 1000;

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase();
}

function dayLabel(iso: string) {
  const d = new Date(iso); const day = new Date(d); day.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - day.getTime()) / 86400000);
  if (diff === 0) return "Hoy";
  if (diff === 1) return "Ayer";
  return d.toLocaleDateString("es-CO", { day: "numeric", month: "short" });
}

function listTime(iso: string) {
  const d = new Date(iso); const day = new Date(d); day.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - day.getTime()) / 86400000);
  if (diff === 0) return fmtTime(iso);
  if (diff === 1) return "Ayer";
  return d.toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit" });
}

/* ─── Conversación (full screen) ─────────────────────────────────────── */

function ChatModal({ chat, tenantId, onClose, onChanged }: {
  chat: Chat; tenantId: string; onClose: () => void; onChanged: () => void;
}) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [botPaused, setBotPaused] = useState(chat.bot_paused);
  const listRef = useRef<FlatList<Msg>>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("wa_chat_messages")
      .select("id,phone,direction,sender,body,created_at")
      .eq("tenant_id", tenantId)
      .eq("phone", chat.phone)
      .order("created_at", { ascending: true })
      .limit(500);
    setMessages((data ?? []) as Msg[]);
    setLoading(false);
  }, [tenantId, chat.phone]);

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  // Marcar como leído al abrir
  useEffect(() => {
    if (chat.unread > 0) {
      supabase.from("wa_chats").update({ unread: 0 })
        .eq("tenant_id", tenantId).eq("phone", chat.phone)
        .then(() => onChanged());
    }
  }, []);

  // Ventana de 24h de Meta: solo se puede responder texto libre si el
  // último mensaje DEL CLIENTE tiene menos de 24 horas.
  const windowOpen = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].direction === "in") {
        return Date.now() - new Date(messages[i].created_at).getTime() < WINDOW_MS;
      }
    }
    return false;
  }, [messages]);

  const toggleBot = async () => {
    const next = !botPaused;
    setBotPaused(next);
    await supabase.from("wa_chats").update({ bot_paused: next })
      .eq("tenant_id", tenantId).eq("phone", chat.phone);
    onChanged();
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || sending || !windowOpen) return;
    setSending(true);
    try {
      const res = await authedFetch(Config.api.whatsappSend, {
        method: "POST",
        body: JSON.stringify({ tenant_id: tenantId, phone: chat.phone, text }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        Alert.alert("No se pudo enviar", json.error ?? "Inténtalo de nuevo.");
        return;
      }
      setDraft("");
      await load();
      onChanged();
    } catch {
      Alert.alert("Sin conexión", "Revisa tu internet e inténtalo de nuevo.");
    } finally {
      setSending(false);
    }
  };

  const title = chat.client_name || `+${chat.phone}`;

  const renderMsg = ({ item, index }: { item: Msg; index: number }) => {
    const isOut = item.direction === "out";
    const prevDay = index > 0 ? dayLabel(messages[index - 1].created_at) : null;
    const day = dayLabel(item.created_at);
    return (
      <View>
        {day !== prevDay && (
          <View style={{ alignItems: "center", marginVertical: 10 }}>
            <View style={c.dayPill}>
              <Text style={c.dayText}>{day}</Text>
            </View>
          </View>
        )}
        <View style={{ flexDirection: "row", justifyContent: isOut ? "flex-end" : "flex-start", marginBottom: 6 }}>
          <View style={[
            c.bubble,
            isOut
              ? { backgroundColor: item.sender === "hanna" ? "#f3e8ff" : "#d9fdd3", borderTopRightRadius: 3 }
              : { backgroundColor: "white", borderTopLeftRadius: 3 },
          ]}>
            {isOut && (
              <Text style={[c.author, { color: item.sender === "hanna" ? HANNA : "#1da851" }]}>
                {item.sender === "hanna" ? "✨ Hanna" : "Tú"}
              </Text>
            )}
            <Text style={c.body}>{item.body}</Text>
            <Text style={c.time}>{fmtTime(item.created_at)}</Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: WA_BG }}>
        {/* Header */}
        <LinearGradient colors={Gradients.ink} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={[c.header, { paddingTop: insets.top + 10 }]}>
          <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3 }} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <TouchableOpacity onPress={onClose} style={c.iconBtn}>
              <Ionicons name="arrow-back" size={20} color="white" />
            </TouchableOpacity>
            <Avatar name={chat.client_name || "?"} size={38} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={c.title} numberOfLines={1}>{title}</Text>
              <Text style={c.subtitle}>+{chat.phone}</Text>
            </View>
          </View>

          {/* Toggle Hanna */}
          <TouchableOpacity onPress={toggleBot} activeOpacity={0.8}
            style={[c.botToggle, {
              backgroundColor: botPaused ? "rgba(245,158,11,0.18)" : "rgba(168,85,247,0.20)",
              borderColor: botPaused ? "rgba(245,158,11,0.45)" : "rgba(168,85,247,0.5)",
            }]}>
            <View style={[c.dot, { backgroundColor: botPaused ? "#f59e0b" : HANNA }]} />
            <Text style={[c.botText, { color: botPaused ? "#fbbf24" : "#d8b4fe" }]}>
              {botPaused ? "Atendiendo tú · toca para reactivar a Hanna" : "Hanna responde · toca para atender tú"}
            </Text>
          </TouchableOpacity>
        </LinearGradient>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}>
          {loading ? (
            <ActivityIndicator color={Colors.red} style={{ marginTop: 40 }} />
          ) : (
            <FlatList
              ref={listRef}
              data={messages}
              keyExtractor={m => m.id}
              renderItem={renderMsg}
              contentContainerStyle={{ padding: 14, paddingBottom: 20 }}
              onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
              ListEmptyComponent={
                <Text style={{ textAlign: "center", color: Colors.muted, marginTop: 40, fontFamily: "SpaceGrotesk_400Regular" }}>
                  Sin mensajes todavía.
                </Text>
              }
            />
          )}

          {/* Caja de envío */}
          <View style={[c.inputBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
            {!windowOpen && (
              <Text style={c.windowWarn}>
                Fuera de la ventana de 24h de WhatsApp: podrás responder cuando el cliente vuelva a escribir.
              </Text>
            )}
            <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
              <TextInput
                style={[c.input, !windowOpen && { opacity: 0.55 }]}
                value={draft}
                onChangeText={setDraft}
                placeholder={windowOpen ? "Escribe un mensaje…" : "Ventana de 24h cerrada"}
                placeholderTextColor={Colors.subtle}
                editable={windowOpen && !sending}
                multiline
              />
              <TouchableOpacity
                onPress={send}
                disabled={!windowOpen || sending || !draft.trim()}
                style={[c.sendBtn, (!windowOpen || !draft.trim()) && { opacity: 0.5 }]}
                activeOpacity={0.8}
              >
                {sending
                  ? <ActivityIndicator size="small" color="white" />
                  : <Ionicons name="send" size={18} color="white" />}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

/* ─── Lista de chats ─────────────────────────────────────────────────── */

export default function InboxScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const { tenantId } = useAuth();
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Chat | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) return;
    const { data } = await supabase
      .from("wa_chats")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("last_message_at", { ascending: false })
      .limit(200);
    setChats((data ?? []) as Chat[]);
    setLoading(false);
  }, [tenantId]);

  useEffect(() => {
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, [load]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const filtered = chats.filter(ch =>
    (ch.client_name ?? "").toLowerCase().includes(query.toLowerCase()) || ch.phone.includes(query)
  );

  const totalUnread = chats.reduce((s, ch) => s + (ch.unread || 0), 0);

  const renderChat = ({ item, index }: { item: Chat; index: number }) => (
    <Animated.View entering={index < 10 ? FadeInDown.delay(index * 40).duration(300) : undefined}>
      <TouchableOpacity style={[s.row, Shadow.sm, { backgroundColor: t.bgAlt }]}
        onPress={() => setSelected(item)} activeOpacity={0.75}>
        <Avatar name={item.client_name || "?"} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <Text style={[s.name, { color: t.text }]} numberOfLines={1}>
              {item.client_name || `+${item.phone}`}
            </Text>
            <Text style={[s.time, { color: item.unread > 0 ? "#1da851" : t.subtle }]}>
              {listTime(item.last_message_at)}
            </Text>
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 2 }}>
            <Text style={[s.preview, { color: t.muted }]} numberOfLines={1}>
              {item.last_message_preview ?? ""}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              {item.bot_paused && (
                <View style={s.manualPill}><Text style={s.manualText}>MANUAL</Text></View>
              )}
              {item.unread > 0 && (
                <View style={s.unread}><Text style={s.unreadText}>{item.unread}</Text></View>
              )}
            </View>
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <LinearGradient colors={Gradients.ink} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.header}>
        <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3 }} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="arrow-back" size={20} color="white" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.headerTitle}>Chats de WhatsApp</Text>
            <Text style={s.headerSub}>
              {chats.length} chat{chats.length !== 1 ? "s" : ""}{totalUnread > 0 ? ` · ${totalUnread} sin leer` : ""}
            </Text>
          </View>
        </View>
      </LinearGradient>

      <View style={s.searchWrap}>
        <View style={[s.searchBox, Shadow.sm, { backgroundColor: t.bgAlt }]}>
          <Ionicons name="search-outline" size={16} color={t.subtle} />
          <TextInput
            style={[s.searchInput, { color: t.text }]}
            value={query} onChangeText={setQuery}
            placeholder="Buscar por nombre o número…"
            placeholderTextColor={t.subtle}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery("")}>
              <Ionicons name="close-circle" size={16} color={t.subtle} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color={Colors.red} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={ch => ch.phone}
          renderItem={renderChat}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 110 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.red} />}
          ListEmptyComponent={
            <Animated.View entering={FadeInDown.duration(350)} style={[s.empty, Shadow.sm, { backgroundColor: t.bgAlt }]}>
              <Ionicons name="chatbubbles-outline" size={42} color={t.subtle} style={{ marginBottom: 12 }} />
              <Text style={[s.emptyTitle, { color: t.text }]}>
                {query ? "Sin resultados" : "Aún no hay chats"}
              </Text>
              <Text style={[s.emptySub, { color: t.muted }]}>
                {query
                  ? "Prueba otro nombre o número."
                  : "Cuando tus clientes escriban a tu número de WhatsApp conectado, sus chats aparecerán aquí."}
              </Text>
            </Animated.View>
          }
        />
      )}

      {selected && tenantId && (
        <ChatModal
          chat={selected}
          tenantId={tenantId}
          onClose={() => { setSelected(null); load(); }}
          onChanged={load}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header:      { paddingTop: 16, paddingHorizontal: 20, paddingBottom: 20 },
  backBtn:     { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,.18)", alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 22, fontFamily: "SpaceGrotesk_700Bold", color: "white", letterSpacing: -0.4 },
  headerSub:   { fontSize: 12, color: "rgba(255,255,255,.75)", fontFamily: "SpaceGrotesk_400Regular", marginTop: 2 },
  searchWrap:  { padding: 16, paddingBottom: 8 },
  searchBox:   { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: Radius.full, paddingHorizontal: 16, paddingVertical: 12 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "SpaceGrotesk_400Regular" },
  row:         { borderRadius: Radius.lg, flexDirection: "row", alignItems: "center", gap: 12, padding: 14, marginBottom: 10 },
  name:        { fontSize: 14.5, fontFamily: "SpaceGrotesk_600SemiBold", flexShrink: 1 },
  time:        { fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold", flexShrink: 0 },
  preview:     { flex: 1, fontSize: 12.5, fontFamily: "SpaceGrotesk_400Regular" },
  manualPill:  { backgroundColor: "rgba(245,158,11,0.14)", borderRadius: Radius.full, paddingHorizontal: 7, paddingVertical: 2 },
  manualText:  { fontSize: 8.5, fontFamily: "JetBrainsMono_700Bold", color: "#d97706", letterSpacing: 0.4 },
  unread:      { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: WA_GREEN, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  unreadText:  { fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
  empty:       { borderRadius: Radius.xl, padding: 44, alignItems: "center", marginTop: 8 },
  emptyTitle:  { fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", marginBottom: 6 },
  emptySub:    { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", textAlign: "center", lineHeight: 19 },
});

const c = StyleSheet.create({
  header:    { paddingHorizontal: 16, paddingBottom: 14 },
  iconBtn:   { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,.18)", alignItems: "center", justifyContent: "center" },
  title:     { fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
  subtitle:  { fontSize: 11.5, fontFamily: "SpaceGrotesk_400Regular", color: "rgba(255,255,255,.7)", marginTop: 1 },
  botToggle: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: Radius.full, paddingHorizontal: 12, paddingVertical: 8, marginTop: 12 },
  dot:       { width: 8, height: 8, borderRadius: 4 },
  botText:   { fontSize: 11.5, fontFamily: "SpaceGrotesk_600SemiBold", flex: 1 },
  dayPill:   { backgroundColor: "rgba(255,255,255,0.9)", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 4 },
  dayText:   { fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", color: "#564E66" },
  bubble:    { maxWidth: "80%", borderRadius: 12, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6, ...Shadow.sm },
  author:    { fontSize: 10, fontFamily: "SpaceGrotesk_700Bold", marginBottom: 2 },
  body:      { fontSize: 14, fontFamily: "SpaceGrotesk_400Regular", color: "#111b21", lineHeight: 20 },
  time:      { fontSize: 10, fontFamily: "SpaceGrotesk_400Regular", color: "#8696a0", textAlign: "right", marginTop: 3 },
  inputBar:  { backgroundColor: "#f0f2f5", paddingHorizontal: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: "rgba(20,15,30,0.07)" },
  windowWarn:{ fontSize: 11.5, fontFamily: "SpaceGrotesk_400Regular", color: "#b45309", backgroundColor: "rgba(245,158,11,0.12)", borderRadius: 9, padding: 9, marginBottom: 8, lineHeight: 16 },
  input:     { flex: 1, backgroundColor: "white", borderRadius: 22, paddingHorizontal: 16, paddingVertical: 11, fontSize: 14.5, fontFamily: "SpaceGrotesk_400Regular", color: "#14111C", maxHeight: 110 },
  sendBtn:   { width: 44, height: 44, borderRadius: 22, backgroundColor: WA_GREEN, alignItems: "center", justifyContent: "center" },
});
