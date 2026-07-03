import { useCallback, useEffect, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform, ActivityIndicator,
  Modal, FlatList, Alert, Linking,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { Colors, Gradients, Radius, Shadow } from "@/constants/theme";
import ErrorState from "@/components/ErrorState";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { fmtPhone, fmtDateCompact, localDateStr } from "@/lib/format";

type Tab = "nueva" | "plantillas" | "historial" | "bot" | "conversaciones";
type Segment = "all" | "active" | "inactive";

type Template     = { id: string; name: string; message: string; created_at: string };
type Campaign     = { id: string; name: string; segment: Segment; message: string; status: string; recipients_count: number; sent_at: string | null; created_at: string };
type Client       = { id: string; name: string; phone: string };
type BotConfig    = { phone_number_id: string; access_token: string; verify_token: string; bot_enabled: boolean };
type Conversation  = { id: string; phone: string; messages: { role: string; content: string }[]; last_message_at: string };

const SEGMENT_OPTS: { key: Segment; label: string; sub: string; icon: string }[] = [
  { key: "all",      label: "Todos los clientes",   sub: "Todos con número registrado",          icon: "people-outline" },
  { key: "active",   label: "Clientes activos",      sub: "Con cita en los últimos 90 días",      icon: "checkmark-circle-outline" },
  { key: "inactive", label: "Clientes inactivos",    sub: "Sin cita en más de 90 días",           icon: "time-outline" },
];

const VARIABLES = ["{{nombre}}", "{{negocio}}"];

const DEFAULT_MSG =
  "Hola {{nombre}} 👋\n\nTe escribimos desde {{negocio}} con una novedad especial para ti...\n\n¿Agendamos tu próxima visita? 📅\n\n¡Te esperamos!";

export default function WhatsappScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const { tenantId } = useAuth();
  const [bizName, setBizName]         = useState("");
  const [tab, setTab]                 = useState<Tab>("nueva");

  // Nueva campaña
  const [campName, setCampName]       = useState("");
  const [segment, setSegment]         = useState<Segment>("all");
  const [message, setMessage]         = useState(DEFAULT_MSG);
  const [saving, setSaving]           = useState(false);
  const [segCount, setSegCount]       = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(false);

  // Template save inline
  const [tmplMode, setTmplMode]       = useState(false);
  const [tmplName, setTmplName]       = useState("");
  const [tmplSaving, setTmplSaving]   = useState(false);

  // Data
  const [templates, setTemplates]     = useState<Template[]>([]);
  const [campaigns, setCampaigns]     = useState<Campaign[]>([]);

  // Send modal
  const [sendModal, setSendModal]     = useState(false);
  const [sendClients, setSendClients] = useState<Client[]>([]);
  const [sentIds, setSentIds]         = useState<Set<string>>(new Set());
  const [pendingCamp, setPendingCamp] = useState<Campaign | null>(null);
  const [loadingClients, setLoadingClients] = useState(false);

  // Bot IA
  const [botConfig, setBotConfig]     = useState<BotConfig>({ phone_number_id: "", access_token: "", verify_token: "", bot_enabled: false });
  const [botSaving, setBotSaving]     = useState(false);
  const [botSaved, setBotSaved]       = useState(false);

  // Conversaciones
  const [conversations, setConversations]   = useState<Conversation[]>([]);
  const [convoLoading, setConvoLoading]     = useState(false);
  const [expandedConvo, setExpandedConvo]   = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    supabase.from("tenants").select("name").eq("id", tenantId).single()
      .then(({ data }) => { if (data) setBizName(data.name ?? ""); });
  }, [tenantId]);

  const loadTemplates = useCallback(async () => {
    if (!tenantId) return;
    const { data } = await supabase.from("wa_templates")
      .select("id, name, message, created_at")
      .eq("tenant_id", tenantId).order("created_at", { ascending: false });
    setTemplates(data ?? []);
  }, [tenantId]);

  const loadCampaigns = useCallback(async () => {
    if (!tenantId) return;
    const { data } = await supabase.from("wa_campaigns")
      .select("id, name, segment, message, status, recipients_count, sent_at, created_at")
      .eq("tenant_id", tenantId).order("created_at", { ascending: false });
    setCampaigns((data ?? []) as Campaign[]);
  }, [tenantId]);

  const loadBotConfig = useCallback(async () => {
    if (!tenantId) return;
    const { data } = await supabase.from("whatsapp_config")
      .select("phone_number_id, access_token, verify_token, bot_enabled")
      .eq("tenant_id", tenantId).maybeSingle();
    if (data) setBotConfig(data as BotConfig);
  }, [tenantId]);

  const loadConversations = useCallback(async () => {
    if (!tenantId) return;
    setConvoLoading(true);
    const { data } = await supabase.from("ai_conversations")
      .select("id, phone, messages, last_message_at")
      .eq("tenant_id", tenantId)
      .order("last_message_at", { ascending: false })
      .limit(50);
    setConversations((data ?? []) as Conversation[]);
    setConvoLoading(false);
  }, [tenantId]);

  const saveBotConfig = async () => {
    if (!tenantId) return;
    setBotSaving(true);
    await supabase.from("whatsapp_config").upsert(
      { tenant_id: tenantId, ...botConfig },
      { onConflict: "tenant_id" }
    );
    setBotSaving(false);
    setBotSaved(true);
    setTimeout(() => setBotSaved(false), 2000);
  };

  useEffect(() => {
    loadTemplates();
    loadCampaigns();
  }, [loadTemplates, loadCampaigns]);

  useEffect(() => {
    if (tab === "bot") loadBotConfig();
    if (tab === "conversaciones") loadConversations();
  }, [tab]);

  // Refresh segment count whenever segment or tenantId changes
  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    setCountLoading(true);
    setSegCount(null);
    resolveClientsFn(tenantId, segment).then(clients => {
      if (!cancelled) { setSegCount(clients.length); setCountLoading(false); }
    });
    return () => { cancelled = true; };
  }, [tenantId, segment]);

  const resolveClientsFn = async (tid: string, seg: Segment): Promise<Client[]> => {
    const { data: all } = await supabase.from("clients")
      .select("id, name, phone").eq("tenant_id", tid)
      .not("phone", "is", null).neq("phone", "");
    const allC = (all ?? []) as Client[];
    if (seg === "all") return allC;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const { data: appts } = await supabase.from("appointments")
      .select("client_id").eq("tenant_id", tid)
      .gte("appointment_date", localDateStr(cutoff));
    const activeIds = new Set((appts ?? []).map((a: any) => a.client_id));
    if (seg === "active") return allC.filter(c => activeIds.has(c.id));
    return allC.filter(c => !activeIds.has(c.id));
  };

  const resolveClients = async (): Promise<Client[]> => {
    if (!tenantId) return [];
    return resolveClientsFn(tenantId, segment);
  };

  const handleLaunch = async () => {
    if (!campName.trim() || !message.trim()) {
      Alert.alert("Completa los campos", "Nombre y mensaje son obligatorios.");
      return;
    }
    setSaving(true);
    setLoadingClients(true);
    try {
      const clients = await resolveClients();
      if (clients.length === 0) {
        Alert.alert("Sin destinatarios", "No hay clientes con teléfono para este segmento.");
        return;
      }
      const { data: camp } = await supabase.from("wa_campaigns").insert({
        tenant_id: tenantId, name: campName.trim(), message: message.trim(),
        segment, status: "sending", recipients_count: clients.length,
      }).select().single();
      if (camp) {
        setPendingCamp(camp as Campaign);
        setSendClients(clients);
        setSentIds(new Set());
        setSendModal(true);
      }
    } finally {
      setSaving(false);
      setLoadingClients(false);
    }
  };

  const buildMsg = (clientName: string) =>
    message.replace(/\{\{nombre\}\}/g, clientName).replace(/\{\{negocio\}\}/g, bizName);

  const handleSend = (c: Client) => {
    const url = `https://wa.me/${fmtPhone(c.phone)}?text=${encodeURIComponent(buildMsg(c.name))}`;
    Linking.openURL(url);
    setSentIds(prev => new Set([...prev, c.id]));
  };

  const handleFinish = async () => {
    if (!pendingCamp) return;
    await supabase.from("wa_campaigns").update({
      status: "sent", sent_at: new Date().toISOString(),
      recipients_count: sentIds.size,
    }).eq("id", pendingCamp.id);
    setSendModal(false);
    setCampName(""); setMessage(DEFAULT_MSG); setSegment("all");
    await loadCampaigns();
    setTab("historial");
  };

  const saveTemplate = async () => {
    if (!tmplName.trim() || !message.trim() || !tenantId) return;
    setTmplSaving(true);
    await supabase.from("wa_templates").insert({ tenant_id: tenantId, name: tmplName.trim(), message: message.trim() });
    setTmplSaving(false);
    setTmplMode(false); setTmplName("");
    loadTemplates();
  };

  const deleteTemplate = (id: string) => {
    Alert.alert("Eliminar plantilla", "¿Seguro?", [
      { text: "Cancelar", style: "cancel" },
      { text: "Eliminar", style: "destructive", onPress: async () => {
        await supabase.from("wa_templates").delete().eq("id", id);
        loadTemplates();
      }},
    ]);
  };

  const TABS: { key: Tab; label: string }[] = [
    { key: "nueva",          label: "Campaña" },
    { key: "plantillas",     label: "Plantillas" },
    { key: "historial",      label: "Historial" },
    { key: "bot",            label: "Bot IA" },
    { key: "conversaciones", label: "Chats" },
  ];

  const segmentLabel = { all: "Todos", active: "Activos", inactive: "Inactivos" };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.header}>
        <View style={s.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="arrow-back" size={20} color="white" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.headerTitle}>Campañas WhatsApp</Text>
            <Text style={s.headerSub}>Mensajes masivos personalizados</Text>
          </View>
          <View style={[s.backBtn, { backgroundColor: "rgba(255,255,255,.18)" }]}>
            <Ionicons name="logo-whatsapp" size={20} color="white" />
          </View>
        </View>
      </LinearGradient>

      {/* Tabs */}
      <View style={[s.tabBar, { backgroundColor: t.bgAlt, borderBottomColor: t.border }]}>
        {TABS.map(t => (
          <TouchableOpacity key={t.key} style={[s.tabBtn, tab === t.key && s.tabBtnActive]} onPress={() => setTab(t.key)} activeOpacity={0.75}>
            <Text style={[s.tabLabel, tab === t.key && s.tabLabelActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── NUEVA CAMPAÑA ── */}
      {tab === "nueva" && (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            <Animated.View entering={FadeInDown.duration(350)}>

              {/* Name */}
              <Text style={s.label}>Nombre de la campaña *</Text>
              <TextInput style={[s.input, { backgroundColor: t.bgAlt, borderColor: t.border, color: t.text }]} value={campName} onChangeText={setCampName}
                placeholder="Ej: Promo julio, Clientes inactivos..." placeholderTextColor={t.subtle} />

              {/* Segment */}
              <Text style={s.label}>Segmento de clientes</Text>
              {SEGMENT_OPTS.map(opt => (
                <TouchableOpacity key={opt.key} style={[s.segCard, segment === opt.key && s.segCardActive]}
                  onPress={() => setSegment(opt.key)} activeOpacity={0.75}>
                  <View style={[s.segIcon, { backgroundColor: segment === opt.key ? Colors.red + "20" : Colors.cream2 }]}>
                    <Ionicons name={opt.icon as any} size={16} color={segment === opt.key ? Colors.red : Colors.muted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.segLabel, segment === opt.key && { color: Colors.red }]}>{opt.label}</Text>
                    <Text style={s.segSub}>{opt.sub}</Text>
                  </View>
                  {segment === opt.key && (
                    <View style={{ alignItems: "flex-end", gap: 4 }}>
                      <Ionicons name="checkmark-circle" size={18} color={Colors.red} />
                      {countLoading
                        ? <ActivityIndicator size="small" color={Colors.muted} style={{ transform: [{ scale: 0.7 }] }} />
                        : segCount !== null && (
                          <Text style={{ fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", color: Colors.red }}>
                            {segCount} cliente{segCount !== 1 ? "s" : ""}
                          </Text>
                        )
                      }
                    </View>
                  )}
                </TouchableOpacity>
              ))}

              {/* Variables */}
              <Text style={s.label}>Mensaje *</Text>
              <View style={s.varRow}>
                {VARIABLES.map(v => (
                  <TouchableOpacity key={v} style={s.varChip}
                    onPress={() => setMessage(m => m + v)} activeOpacity={0.7}>
                    <Text style={s.varChipText}>{v}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={[s.textAreaWrap, Shadow.sm]}>
                <TextInput style={s.textArea} value={message} onChangeText={setMessage}
                  multiline textAlignVertical="top" placeholderTextColor={t.subtle} />
                <Text style={[s.charCount, message.length > 1000 && { color: Colors.red }]}>
                  {message.length} / 1000
                </Text>
              </View>

              {/* Save as template */}
              {message.trim().length > 0 && !tmplMode && (
                <TouchableOpacity style={s.tmplLink} onPress={() => setTmplMode(true)}>
                  <Ionicons name="bookmark-outline" size={13} color={Colors.purple} />
                  <Text style={s.tmplLinkText}>Guardar como plantilla</Text>
                </TouchableOpacity>
              )}
              {tmplMode && (
                <View style={[s.tmplForm, Shadow.sm]}>
                  <TextInput style={[s.input, { marginBottom: 10 }]} value={tmplName} onChangeText={setTmplName}
                    placeholder="Nombre de la plantilla" placeholderTextColor={t.subtle} />
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <TouchableOpacity style={[s.tmplBtn, { flex: 1, backgroundColor: Colors.border }]} onPress={() => setTmplMode(false)}>
                      <Text style={[s.tmplBtnText, { color: Colors.muted }]}>Cancelar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[s.tmplBtn, { flex: 1, backgroundColor: Colors.purple }]} onPress={saveTemplate} disabled={tmplSaving}>
                      {tmplSaving ? <ActivityIndicator color="white" size="small" /> : <Text style={s.tmplBtnText}>Guardar</Text>}
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {/* Preview */}
              <Text style={s.label}>Vista previa</Text>
              <View style={[s.preview, Shadow.sm]}>
                <View style={s.previewHeader}>
                  <View style={s.waBubbleAva}>
                    <Ionicons name="logo-whatsapp" size={14} color="white" />
                  </View>
                  <View>
                    <Text style={s.waBubbleName}>{bizName || "Tu negocio"}</Text>
                    <Text style={s.waBubbleStatus}>en línea</Text>
                  </View>
                </View>
                <View style={s.waBg}>
                  <View style={s.waBubble}>
                    <Text style={s.waBubbleText}>
                      {buildMsg("María García")}
                    </Text>
                    <Text style={s.waBubbleTime}>Ahora ✓✓</Text>
                  </View>
                </View>
              </View>

              {/* Launch */}
              <TouchableOpacity
                style={[s.btn, (!campName.trim() || !message.trim() || saving) && { opacity: 0.4 }]}
                onPress={handleLaunch}
                disabled={!campName.trim() || !message.trim() || saving}
                activeOpacity={0.85}
              >
                <View style={s.btnInner}>
                  {saving || loadingClients
                    ? <ActivityIndicator color="white" />
                    : <>
                        <Ionicons name="send" size={16} color="white" />
                        <Text style={s.btnText}>Iniciar campaña</Text>
                      </>
                  }
                </View>
              </TouchableOpacity>
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {/* ── PLANTILLAS ── */}
      {tab === "plantillas" && (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          {templates.length === 0 ? (
            <Animated.View entering={FadeInDown.duration(350)} style={[s.emptyCard, Shadow.sm, { backgroundColor: t.bgAlt }]}>
              <Text style={{ fontSize: 32, marginBottom: 10 }}>📝</Text>
              <Text style={s.emptyTitle}>Sin plantillas</Text>
              <Text style={s.emptySub}>Guarda mensajes para reutilizarlos fácilmente</Text>
            </Animated.View>
          ) : (
            templates.map((t, i) => (
              <Animated.View key={t.id} entering={i < 10 ? FadeInDown.delay(i * 50).duration(300) : undefined}>
                <View style={[s.tmplCard, Shadow.sm]}>
                  <View style={s.tmplCardTop}>
                    <Text style={s.tmplCardName}>{t.name}</Text>
                    <Text style={s.tmplCardDate}>{fmtDateCompact(t.created_at)}</Text>
                  </View>
                  <Text style={s.tmplCardMsg} numberOfLines={4}>{t.message}</Text>
                  <View style={s.tmplCardActions}>
                    <TouchableOpacity style={s.tmplUseBtn} onPress={() => { setMessage(t.message); setTab("nueva"); }} activeOpacity={0.75}>
                      <Ionicons name="arrow-redo-outline" size={13} color={Colors.purple} />
                      <Text style={s.tmplUseBtnText}>Usar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => deleteTemplate(t.id)} activeOpacity={0.75}>
                      <Ionicons name="trash-outline" size={16} color={Colors.red} />
                    </TouchableOpacity>
                  </View>
                </View>
              </Animated.View>
            ))
          )}
        </ScrollView>
      )}

      {/* ── HISTORIAL ── */}
      {tab === "historial" && (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          {campaigns.length === 0 ? (
            <Animated.View entering={FadeInDown.duration(350)} style={[s.emptyCard, Shadow.sm, { backgroundColor: t.bgAlt }]}>
              <Text style={{ fontSize: 32, marginBottom: 10 }}>📣</Text>
              <Text style={s.emptyTitle}>Sin campañas aún</Text>
              <Text style={s.emptySub}>Las campañas enviadas aparecerán aquí</Text>
            </Animated.View>
          ) : (
            campaigns.map((c, i) => (
              <Animated.View key={c.id} entering={i < 10 ? FadeInDown.delay(i * 50).duration(300) : undefined}>
                <View style={[s.campCard, Shadow.sm]}>
                  <View style={s.campCardTop}>
                    <Text style={s.campCardName}>{c.name}</Text>
                    <View style={[s.statusBadge, { backgroundColor: c.status === "sent" ? Colors.success + "15" : "#f59e0b15" }]}>
                      <Text style={[s.statusBadgeText, { color: c.status === "sent" ? Colors.success : "#f59e0b" }]}>
                        {c.status === "sent" ? "Completada" : "En proceso"}
                      </Text>
                    </View>
                  </View>
                  <Text style={s.campCardMeta}>
                    {segmentLabel[c.segment]} · {fmtDateCompact(c.created_at)}
                  </Text>
                  <Text style={s.campCardMsg} numberOfLines={3}>{c.message}</Text>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                    {c.recipients_count > 0 ? (
                      <View style={s.campRecipients}>
                        <Ionicons name="logo-whatsapp" size={12} color="#25D366" />
                        <Text style={s.campRecipientsText}>{c.recipients_count} enviados</Text>
                      </View>
                    ) : <View />}
                    <TouchableOpacity
                      style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: Colors.red + "12", borderRadius: Radius.full, paddingHorizontal: 12, paddingVertical: 6 }}
                      onPress={() => {
                        setCampName(c.name);
                        setMessage(c.message);
                        setSegment(c.segment as Segment);
                        setTab("nueva");
                      }}
                      activeOpacity={0.75}
                    >
                      <Ionicons name="refresh-outline" size={13} color={Colors.red} />
                      <Text style={{ fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.red }}>Re-usar</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </Animated.View>
            ))
          )}
        </ScrollView>
      )}

      {/* ── BOT IA ── */}
      {tab === "bot" && (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
          <Animated.View entering={FadeInDown.duration(350)}>
            <View style={[s.botRow, Shadow.sm, { backgroundColor: t.bgAlt }]}>
              <View style={{ flex: 1 }}>
                <Text style={[s.botRowTitle, { color: t.text }]}>Bot activo</Text>
                <Text style={[s.botRowSub, { color: t.muted }]}>Responde citas automáticamente</Text>
              </View>
              <TouchableOpacity
                style={[s.toggleTrack, { backgroundColor: botConfig.bot_enabled ? Colors.success : Colors.border }]}
                onPress={() => setBotConfig(p => ({ ...p, bot_enabled: !p.bot_enabled }))}
                activeOpacity={0.8}
              >
                <View style={[s.toggleThumb, { transform: [{ translateX: botConfig.bot_enabled ? 20 : 2 }] }]} />
              </TouchableOpacity>
            </View>

            <Text style={s.label}>Phone Number ID</Text>
            <TextInput style={[s.input, { backgroundColor: t.bgAlt, borderColor: t.border, color: t.text }]}
              value={botConfig.phone_number_id} onChangeText={v => setBotConfig(p => ({ ...p, phone_number_id: v }))}
              placeholder="Número de la API de WhatsApp" placeholderTextColor={t.subtle} autoCapitalize="none" />

            <Text style={s.label}>Access Token</Text>
            <TextInput style={[s.input, { backgroundColor: t.bgAlt, borderColor: t.border, color: t.text }]}
              value={botConfig.access_token} onChangeText={v => setBotConfig(p => ({ ...p, access_token: v }))}
              placeholder="Token de acceso" placeholderTextColor={t.subtle} autoCapitalize="none" secureTextEntry />

            <Text style={s.label}>Verify Token</Text>
            <TextInput style={[s.input, { backgroundColor: t.bgAlt, borderColor: t.border, color: t.text }]}
              value={botConfig.verify_token} onChangeText={v => setBotConfig(p => ({ ...p, verify_token: v }))}
              placeholder="Token de verificación del webhook" placeholderTextColor={t.subtle} autoCapitalize="none" />

            <TouchableOpacity style={[s.btn, { marginTop: 24 }, botSaving && { opacity: 0.6 }]}
              onPress={saveBotConfig} disabled={botSaving} activeOpacity={0.85}>
              <View style={s.btnInner}>
                {botSaving ? <ActivityIndicator color="white" /> : (
                  <><Ionicons name={botSaved ? "checkmark" : "save-outline"} size={16} color="white" />
                  <Text style={s.btnText}>{botSaved ? "Guardado" : "Guardar configuración"}</Text></>
                )}
              </View>
            </TouchableOpacity>
          </Animated.View>
        </ScrollView>
      )}

      {/* ── CONVERSACIONES ── */}
      {tab === "conversaciones" && (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
          {convoLoading ? (
            <ActivityIndicator color={Colors.red} style={{ marginTop: 40 }} />
          ) : conversations.length === 0 ? (
            <Animated.View entering={FadeInDown.duration(350)} style={[s.emptyCard, Shadow.sm, { backgroundColor: t.bgAlt }]}>
              <Text style={{ fontSize: 32, marginBottom: 10 }}>💬</Text>
              <Text style={s.emptyTitle}>Sin conversaciones aún</Text>
              <Text style={s.emptySub}>Los chats del bot aparecerán aquí</Text>
            </Animated.View>
          ) : (
            conversations.map((c, i) => {
              const last = c.messages?.[c.messages.length - 1];
              const isOpen = expandedConvo === c.id;
              return (
                <Animated.View key={c.id} entering={i < 10 ? FadeInDown.delay(i * 40).duration(280) : undefined}>
                  <TouchableOpacity style={[s.convoCard, Shadow.sm, { backgroundColor: t.bgAlt }]}
                    onPress={() => setExpandedConvo(isOpen ? null : c.id)} activeOpacity={0.8}>
                    <View style={s.convoCardTop}>
                      <View style={s.convoAvatar}>
                        <Ionicons name="person-outline" size={16} color={Colors.red} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.convoPhone, { color: t.text }]}>{c.phone}</Text>
                        <Text style={[s.convoPreview, { color: t.muted }]} numberOfLines={1}>
                          {last?.content ?? "Sin mensajes"}
                        </Text>
                      </View>
                      <Ionicons name={isOpen ? "chevron-up" : "chevron-down"} size={14} color={t.subtle} />
                    </View>
                    {isOpen && (
                      <View style={{ marginTop: 12, gap: 8 }}>
                        {c.messages.map((m, mi) => (
                          <View key={mi} style={[
                            m.role === "assistant" ? s.msgBubbleBot : s.msgBubbleUser,
                          ]}>
                            <Text style={[s.msgText, { color: m.role === "assistant" ? "white" : Colors.text }]}>
                              {m.content}
                            </Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </TouchableOpacity>
                </Animated.View>
              );
            })
          )}
        </ScrollView>
      )}

      {/* ── SEND MODAL ── */}
      <Modal visible={sendModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSendModal(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Enviar mensajes</Text>
            <Text style={s.modalSub}>{sentIds.size} / {sendClients.length} enviados</Text>
          </View>

          {/* Progress bar */}
          <View style={s.progressWrap}>
            <View style={[s.progressBar, { width: `${sendClients.length > 0 ? (sentIds.size / sendClients.length) * 100 : 0}%` as any }]} />
          </View>

          <FlatList
            data={sendClients}
            keyExtractor={c => c.id}
            contentContainerStyle={{ padding: 16, gap: 10 }}
            renderItem={({ item: c }) => {
              const sent = sentIds.has(c.id);
              return (
                <View style={[s.clientRow, Shadow.sm]}>
                  <View style={s.clientAvatar}>
                    <Text style={s.clientAvatarText}>{c.name[0].toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.clientName}>{c.name}</Text>
                    <Text style={s.clientPhone}>{c.phone}</Text>
                  </View>
                  <TouchableOpacity
                    style={[s.sendBtn, sent && { backgroundColor: Colors.success }]}
                    onPress={() => handleSend(c)}
                    activeOpacity={0.75}
                  >
                    <Ionicons name={sent ? "checkmark" : "logo-whatsapp"} size={14} color="white" />
                    <Text style={s.sendBtnText}>{sent ? "Enviado" : "Enviar"}</Text>
                  </TouchableOpacity>
                </View>
              );
            }}
          />

          <View style={s.modalFooter}>
            {sentIds.size < sendClients.length && (
              <TouchableOpacity
                style={[s.finishBtn, { backgroundColor: Colors.blue + "14", marginBottom: 10 }]}
                onPress={() => setSentIds(new Set(sendClients.map(c => c.id)))}
                activeOpacity={0.8}
              >
                <Text style={[s.finishBtnText, { color: Colors.blue }]}>
                  Marcar todos como enviados
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={s.finishBtn} onPress={handleFinish} activeOpacity={0.85}>
              <Text style={s.finishBtnText}>
                {sentIds.size === sendClients.length ? "Finalizar campaña" : `Finalizar (${sentIds.size} enviados)`}
              </Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header:       { paddingTop: 16, paddingHorizontal: 24, paddingBottom: 20 },
  headerRow:    { flexDirection: "row", alignItems: "center", gap: 12 },
  backBtn:      { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,.18)", alignItems: "center", justifyContent: "center" },
  headerTitle:  { fontSize: 20, fontFamily: "SpaceGrotesk_700Bold", color: "white", letterSpacing: -0.3 },
  headerSub:    { fontSize: 12, color: "rgba(255,255,255,.75)", fontFamily: "SpaceGrotesk_400Regular", marginTop: 2 },

  tabBar:       { flexDirection: "row", backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border },
  tabBtn:       { flex: 1, paddingVertical: 13, alignItems: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabBtnActive: { borderBottomColor: Colors.red },
  tabLabel:     { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted },
  tabLabelActive:{ fontSize: 12, fontFamily: "SpaceGrotesk_700Bold", color: Colors.red },

  label:        { fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", color: Colors.muted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8, marginTop: 18 },
  input:        { backgroundColor: Colors.white, borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, fontFamily: "SpaceGrotesk_400Regular", color: Colors.text },

  segCard:      { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: Colors.white, borderRadius: Radius.md, padding: 14, marginBottom: 8, borderWidth: 1.5, borderColor: Colors.border },
  segCardActive:{ borderColor: Colors.red },
  segIcon:      { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  segLabel:     { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  segSub:       { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, marginTop: 2 },

  varRow:       { flexDirection: "row", gap: 8, marginBottom: 10 },
  varChip:      { backgroundColor: Colors.purple + "14", borderRadius: Radius.full, paddingHorizontal: 12, paddingVertical: 6 },
  varChipText:  { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.purple },

  textAreaWrap: { backgroundColor: Colors.white, borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md },
  textArea:     { padding: 14, fontSize: 14, fontFamily: "SpaceGrotesk_400Regular", color: Colors.text, minHeight: 140 },
  charCount:    { fontSize: 11, color: Colors.subtle, fontFamily: "SpaceGrotesk_400Regular", textAlign: "right", paddingHorizontal: 14, paddingBottom: 10 },

  tmplLink:     { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10, alignSelf: "flex-start" },
  tmplLinkText: { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.purple },
  tmplForm:     { backgroundColor: Colors.white, borderRadius: Radius.md, padding: 14, marginTop: 10 },
  tmplBtn:      { borderRadius: Radius.md, paddingVertical: 11, alignItems: "center" },
  tmplBtnText:  { fontSize: 13, fontFamily: "SpaceGrotesk_700Bold", color: "white" },

  preview:      { backgroundColor: Colors.white, borderRadius: Radius.lg, overflow: "hidden", marginTop: 4 },
  previewHeader:{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, backgroundColor: "#075e54" },
  waBubbleAva:  { width: 32, height: 32, borderRadius: 16, backgroundColor: "#25d366", alignItems: "center", justifyContent: "center" },
  waBubbleName: { fontSize: 13, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
  waBubbleStatus:{ fontSize: 11, color: "rgba(255,255,255,.7)", fontFamily: "SpaceGrotesk_400Regular" },
  waBg:         { backgroundColor: "#ece5dd", padding: 14 },
  waBubble:     { backgroundColor: "white", borderRadius: Radius.md, borderTopLeftRadius: 4, padding: 12, maxWidth: "88%", alignSelf: "flex-start" },
  waBubbleText: { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: "#111", lineHeight: 19 },
  waBubbleTime: { fontSize: 10, color: Colors.subtle, textAlign: "right", marginTop: 4 },

  btn:          { borderRadius: Radius.full, overflow: "hidden", marginTop: 24 },
  btnInner:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 16, backgroundColor: Colors.red },
  btnText:      { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: "white" },

  emptyCard:    { backgroundColor: Colors.white, borderRadius: Radius.xl, padding: 48, alignItems: "center", marginTop: 20 },
  emptyTitle:   { fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text, marginBottom: 6 },
  emptySub:     { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, textAlign: "center" },

  tmplCard:     { backgroundColor: Colors.white, borderRadius: Radius.lg, padding: 16, marginBottom: 10 },
  tmplCardTop:  { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  tmplCardName: { fontSize: 14, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text },
  tmplCardDate: { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", color: Colors.subtle },
  tmplCardMsg:  { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, lineHeight: 18, marginBottom: 12 },
  tmplCardActions:{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  tmplUseBtn:   { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: Colors.purple + "14", borderRadius: Radius.full, paddingHorizontal: 12, paddingVertical: 7 },
  tmplUseBtnText:{ fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.purple },

  campCard:     { backgroundColor: Colors.white, borderRadius: Radius.lg, padding: 16, marginBottom: 10 },
  campCardTop:  { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  campCardName: { fontSize: 14, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text, flex: 1, marginRight: 8 },
  campCardMeta: { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", color: Colors.subtle, marginBottom: 8 },
  campCardMsg:  { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, lineHeight: 18 },
  campRecipients:{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 10 },
  campRecipientsText:{ fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: "#25D366" },
  statusBadge:  { borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 4 },
  statusBadgeText:{ fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold" },

  // Bot
  botRow:       { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: Colors.white, borderRadius: Radius.md, padding: 14, marginBottom: 8 },
  botRowTitle:  { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  botRowSub:    { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, marginTop: 2 },
  toggleTrack:  { width: 44, height: 24, borderRadius: 12, padding: 2, justifyContent: "center" },
  toggleThumb:  { width: 20, height: 20, borderRadius: 10, backgroundColor: "white" },

  // Conversaciones
  convoCard:    { backgroundColor: Colors.white, borderRadius: Radius.md, padding: 14, marginBottom: 10 },
  convoCardTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  convoAvatar:  { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.red + "14", alignItems: "center", justifyContent: "center" },
  convoPhone:   { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  convoPreview: { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, marginTop: 2 },
  msgBubbleBot: { backgroundColor: "#1a1a2e", borderRadius: 12, borderTopLeftRadius: 4, padding: 10, maxWidth: "80%", alignSelf: "flex-start" },
  msgBubbleUser:{ backgroundColor: Colors.cream2, borderRadius: 12, borderTopRightRadius: 4, padding: 10, maxWidth: "80%", alignSelf: "flex-end", borderWidth: 1, borderColor: Colors.border },
  msgText:      { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", lineHeight: 18 },

  // Send modal
  modalHeader:  { padding: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  modalTitle:   { fontSize: 18, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text },
  modalSub:     { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, marginTop: 4 },
  progressWrap: { height: 4, backgroundColor: Colors.border },
  progressBar:  { height: 4, backgroundColor: Colors.success },
  clientRow:    { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: Colors.white, borderRadius: Radius.md, padding: 12 },
  clientAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.red + "18", alignItems: "center", justifyContent: "center" },
  clientAvatarText:{ fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", color: Colors.red },
  clientName:   { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  clientPhone:  { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, marginTop: 2 },
  sendBtn:      { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#25D366", borderRadius: Radius.md, paddingHorizontal: 12, paddingVertical: 8 },
  sendBtnText:  { fontSize: 12, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
  modalFooter:  { padding: 20, paddingBottom: 34, borderTopWidth: 1, borderTopColor: Colors.border },
  finishBtn:    { backgroundColor: Colors.red, borderRadius: Radius.full, paddingVertical: 16, alignItems: "center" },
  finishBtnText:{ fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
});
