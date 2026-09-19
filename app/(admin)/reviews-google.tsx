import { useCallback, useEffect, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform, ActivityIndicator,
  Linking, Alert, Clipboard,
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
import { ScreenHeader } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { fmtPhone, fmtDateFull } from "@/lib/format";

type Tab = "config" | "solicitar" | "historial";
type Client = { id: string; name: string; phone: string | null };
type Request = { id: string; client_name: string; client_phone: string | null; sent_via: string; created_at: string; reviewed?: boolean };
type HistFilter = "todas" | "pendientes" | "resenaron";

/** Cada cuánto tiene sentido volver a pedirle reseña a la misma persona. */
const REASK_DAYS = 90;

const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

/** appointment_date es "YYYY-MM-DD": sin la hora se leería como medianoche UTC
 *  y en Colombia (UTC-5) eso corre el día uno atrás. */
const daysSinceDay = (day: string) => Math.floor((Date.now() - new Date(day + "T00:00:00").getTime()) / 86_400_000);

function visitAgo(day: string): string {
  const d = daysSinceDay(day);
  if (d <= 0) return "Atendido hoy";
  if (d === 1) return "Atendido ayer";
  if (d < 7)   return `Atendido hace ${d} días`;
  if (d < 30)  return `Atendido hace ${Math.floor(d / 7)} sem.`;
  const m = Math.floor(d / 30);
  return `Atendido hace ${m} mes${m > 1 ? "es" : ""}`;
}

function sentAgo(iso: string): string {
  const d = daysSince(iso);
  if (d === 0) return "hoy";
  if (d === 1) return "ayer";
  if (d < 7)   return `hace ${d} días`;
  if (d < 30)  return `hace ${Math.floor(d / 7)} sem.`;
  return `hace ${Math.floor(d / 30)} mes${Math.floor(d / 30) > 1 ? "es" : ""}`;
}

const DEFAULT_TEMPLATE =
  "Hola {{nombre}} 👋\n\nGracias por visitarnos. Tu opinión nos ayuda a mejorar y a que más personas nos encuentren.\n\n⭐ ¿Nos dejas una reseña en Google? Solo toma 1 minuto:\n{{link}}\n\n¡Gracias de corazón!";

export default function GoogleReviewsScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const { tenantId } = useAuth();
  const [settingsId, setSettingsId]   = useState<string | null>(null);
  const [tab, setTab]                 = useState<Tab>("config");

  // Config
  const [googleUrl, setGoogleUrl]     = useState("");
  const [template, setTemplate]       = useState(DEFAULT_TEMPLATE);
  const [saving, setSaving]           = useState(false);
  const [savedOk, setSavedOk]         = useState(false);
  const [copied, setCopied]           = useState(false);

  // Solicitar
  const [clients, setClients]         = useState<Client[]>([]);
  const [search, setSearch]           = useState("");
  const [selected, setSelected]       = useState<Client | null>(null);
  const [sentOk, setSentOk]           = useState(false);
  const [msgCopied, setMsgCopied]     = useState(false);
  const [loadingClients, setLoadingClients] = useState(false);
  const [lastSent, setLastSent]       = useState<Record<string, string>>({});
  const [lastVisit, setLastVisit]     = useState<Record<string, string>>({});

  // Historial
  const [requests, setRequests]       = useState<Request[]>([]);
  const [loadingHist, setLoadingHist] = useState(false);
  const [histFilter, setHistFilter]   = useState<HistFilter>("todas");

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    supabase.from("google_review_settings")
      .select("id, google_maps_url, message_template").eq("tenant_id", tenantId).single()
      .then(({ data: cfg }) => {
        if (cancelled) return;
        if (cfg) {
          setSettingsId(cfg.id);
          setGoogleUrl(cfg.google_maps_url ?? "");
          setTemplate(cfg.message_template ?? DEFAULT_TEMPLATE);
        }
        // Poner el link es de una sola vez; pedir reseñas es lo de todos los
        // días. Quien ya lo tiene entra directo a pedir.
        setTab(cfg?.google_maps_url ? "solicitar" : "config");
      });
    return () => { cancelled = true; };
  }, [tenantId]);

  const loadClients = useCallback(async () => {
    if (!tenantId) return;
    setLoadingClients(true);
    // Las citas atendidas son lo que convierte esta pantalla en útil: sin
    // ellas la lista mostraba los primeros 8 clientes por orden alfabético,
    // que parecen una recomendación y no lo son.
    const [{ data }, { data: reqs }, { data: appts }] = await Promise.all([
      supabase.from("clients").select("id, name, phone").eq("tenant_id", tenantId).order("name"),
      supabase.from("review_requests").select("client_id, created_at")
        .eq("tenant_id", tenantId).order("created_at", { ascending: false }),
      supabase.from("appointments").select("client_id, appointment_date")
        .eq("tenant_id", tenantId).eq("status", "completed")
        .order("appointment_date", { ascending: false }).limit(1000),
    ]);
    setClients((data ?? []) as Client[]);
    const sent: Record<string, string> = {};
    for (const r of reqs ?? []) if (r.client_id && !sent[r.client_id]) sent[r.client_id] = r.created_at;
    setLastSent(sent);
    const visits: Record<string, string> = {};
    for (const a of appts ?? []) if (a.client_id && !visits[a.client_id]) visits[a.client_id] = a.appointment_date;
    setLastVisit(visits);
    setLoadingClients(false);
  }, [tenantId]);

  const loadHistory = useCallback(async () => {
    if (!tenantId) return;
    setLoadingHist(true);
    const { data } = await supabase.from("review_requests")
      .select("id, client_name, client_phone, sent_via, created_at, reviewed")
      .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(100);
    setRequests((data ?? []) as Request[]);
    setLoadingHist(false);
  }, [tenantId]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (tab === "solicitar") await loadClients();
      if (tab === "historial") await loadHistory();
    };
    run().then(() => { if (cancelled) return; });
    return () => { cancelled = true; };
  }, [tab, loadClients, loadHistory]);

  const handleSave = async () => {
    if (!tenantId) return;
    setSaving(true);
    const payload = { google_maps_url: googleUrl.trim(), message_template: template, tenant_id: tenantId };
    if (settingsId) {
      await supabase.from("google_review_settings").update(payload).eq("id", settingsId);
    } else {
      const { data } = await supabase.from("google_review_settings").insert(payload).select("id").single();
      if (data) setSettingsId(data.id);
    }
    setSaving(false);
    setSavedOk(true);
    setTimeout(() => setSavedOk(false), 2000);
  };

  const buildMessage = (client: Client) =>
    template
      .replace(/\{\{nombre\}\}/g, client.name)
      .replace(/\{\{link\}\}/g, googleUrl);

  const logRequest = async (client: Client, via: string) => {
    await supabase.from("review_requests").insert({
      tenant_id: tenantId, client_id: client.id,
      client_name: client.name, client_phone: client.phone,
      sent_via: via,
    });
    setSentOk(true);
    setTimeout(() => setSentOk(false), 2500);
  };

  const handleCopyMsg = async (client: Client) => {
    if (!googleUrl) { Alert.alert("Falta el link", "Configura primero el link de Google en la pestaña Configuración."); return; }
    Clipboard.setString(buildMessage(client));
    setMsgCopied(true);
    setTimeout(() => setMsgCopied(false), 2000);
    await logRequest(client, "manual");
  };

  const handleWhatsApp = async (client: Client) => {
    if (!googleUrl) { Alert.alert("Falta el link", "Configura primero el link de Google en la pestaña Configuración."); return; }
    if (!client.phone) { Alert.alert("Sin teléfono", "Este cliente no tiene número registrado."); return; }
    const url = `https://wa.me/${fmtPhone(client.phone)}?text=${encodeURIComponent(buildMessage(client))}`;
    Linking.openURL(url);
    await logRequest(client, "whatsapp");
  };

  const searching = search.trim().length > 0;

  /**
   * Con el buscador vacío la lista propone a quién pedirle en vez de mostrar
   * los primeros 8 por orden alfabético. Entra quien tiene una cita ATENDIDA
   * y además (a) nunca se le ha pedido, (b) volvió después de la última vez
   * que se le pidió, o (c) ya pasaron REASK_DAYS. Del más reciente al más
   * antiguo: pedir la reseña recién salido del local es cuando más gente la
   * deja.
   */
  const filtered = searching
    ? clients.filter(c =>
        c.name.toLowerCase().includes(search.trim().toLowerCase()) ||
        (c.phone ?? "").includes(search.trim())
      ).slice(0, 8)
    : clients
        .filter(c => !!lastVisit[c.id])
        .filter(c => {
          const sent = lastSent[c.id];
          return !sent || sent < lastVisit[c.id] || daysSince(sent) > REASK_DAYS;
        })
        .sort((a, b) => (lastVisit[a.id] < lastVisit[b.id] ? 1 : -1))
        .slice(0, 8);

  const visibleRequests = requests.filter(r =>
    histFilter === "todas" ? true : histFilter === "resenaron" ? !!r.reviewed : !r.reviewed);
  const reviewedCount = requests.filter(r => r.reviewed).length;

  const TABS: { key: Tab; label: string }[] = [
    { key: "solicitar", label: "Pedir reseña" },
    { key: "historial", label: "Historial" },
    { key: "config",    label: "Configuración" },
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader crumb="Marketing" title="Reseñas Google" subtitle="Solicita reseñas a tus clientes" onBack={() => router.back()} />

      {/* Tabs */}
      <View style={[s.tabBar, { backgroundColor: t.bgAlt, borderBottomColor: t.border }]}>
        {TABS.map(tb => (
          <TouchableOpacity key={tb.key} style={[s.tabBtn, tab === tb.key && s.tabBtnActive]} onPress={() => setTab(tb.key)} activeOpacity={0.75}>
            <Text style={[s.tabLabel, tab === tb.key && s.tabLabelActive]}>{tb.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── CONFIGURACIÓN ── */}
      {tab === "config" && (
        <KeyboardAvoidingView style={{ flex: 1 }}>
          <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            <Animated.View entering={FadeInDown.duration(350)}>

              {/* How-to */}
              <View style={s.infoBox}>
                <Text style={s.infoTitle}>¿Cómo obtener tu link?</Text>
                <Text style={s.infoStep}>1. Ve a <Text style={s.infoBold}>business.google.com</Text></Text>
                <Text style={s.infoStep}>2. Selecciona tu negocio → "Obtener más reseñas"</Text>
                <Text style={s.infoStep}>3. Copia el link corto y pégalo abajo</Text>
              </View>

              {/* URL */}
              <Text style={s.label}>Link directo de Google</Text>
              <View style={s.inputRow}>
                <TextInput style={[s.input, { flex: 1 }]} value={googleUrl} onChangeText={setGoogleUrl}
                  placeholder="https://g.page/r/..." placeholderTextColor={t.subtle}
                  autoCapitalize="none" autoCorrect={false} keyboardType="url" />
                <TouchableOpacity style={s.copyBtn} onPress={() => { Clipboard.setString(googleUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                  <Ionicons name={copied ? "checkmark" : "copy-outline"} size={16} color={copied ? Colors.success : Colors.muted} />
                </TouchableOpacity>
              </View>

              {/* Template */}
              <Text style={s.label}>Mensaje de WhatsApp</Text>
              <View style={s.varRow}>
                {["{{nombre}}", "{{link}}"].map(v => (
                  <TouchableOpacity key={v} style={s.varChip} onPress={() => setTemplate(t => t + v)} activeOpacity={0.7}>
                    <Text style={s.varChipText}>{v}</Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity style={[s.varChip, { backgroundColor: Colors.border }]}
                  onPress={() => setTemplate(DEFAULT_TEMPLATE)} activeOpacity={0.7}>
                  <Text style={[s.varChipText, { color: Colors.muted }]}>Restaurar</Text>
                </TouchableOpacity>
              </View>
              <View style={[s.textAreaWrap, Shadow.sm]}>
                <TextInput style={s.textArea} value={template} onChangeText={setTemplate}
                  multiline textAlignVertical="top" placeholderTextColor={t.subtle} />
              </View>

              <TouchableOpacity style={s.btn} onPress={handleSave} disabled={saving} activeOpacity={0.85}>
                <View style={[s.btnInner, { backgroundColor: savedOk ? Colors.success : Colors.red }]}>
                  {saving ? <ActivityIndicator color="white" /> : savedOk
                    ? <><Ionicons name="checkmark-circle" size={16} color="white" /><Text style={s.btnText}>Guardado</Text></>
                    : <Text style={s.btnText}>Guardar configuración</Text>
                  }
                </View>
              </TouchableOpacity>
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {/* ── SOLICITAR RESEÑA ── */}
      {tab === "solicitar" && (
        <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <Animated.View entering={FadeInDown.duration(350)}>

            {sentOk && (
              <View style={s.successBanner}>
                <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
                <Text style={s.successText}>Solicitud registrada</Text>
              </View>
            )}

            <Text style={s.label}>{searching ? "Resultados" : "A quién pedirle"}</Text>
            <TextInput style={s.input} value={search} onChangeText={t => { setSearch(t); setSelected(null); setSentOk(false); }}
              placeholder="Buscar por nombre o teléfono..." placeholderTextColor={t.subtle} />
            {!searching && (
              <Text style={s.listHint}>
                Clientes que ya atendiste y a los que aún no les has pedido reseña, del más reciente al más antiguo.
              </Text>
            )}

            {loadingClients && <ActivityIndicator color={Colors.red} style={{ marginTop: 20 }} />}

            {!loadingClients && filtered.length === 0 && (
              <View style={s.listEmpty}>
                <Text style={s.listEmptyText}>
                  {searching
                    ? "Sin resultados. Puedes buscar a cualquier cliente por nombre o teléfono."
                    : "Nadie pendiente por ahora: ya les pediste reseña a todos los que atendiste. Busca arriba si quieres pedirle a alguien más."}
                </Text>
              </View>
            )}

            {filtered.map(c => {
              const visit = lastVisit[c.id];
              const sent  = lastSent[c.id];
              // "Ya se le pidió" solo avisa si sigue vigente: si volvió
              // después, pedirle de nuevo es justamente lo que toca.
              const yaPedido = !!sent && daysSince(sent) <= REASK_DAYS && !(visit && sent < visit);
              return (
                <TouchableOpacity key={c.id}
                  style={[s.clientCard, selected?.id === c.id && s.clientCardActive]}
                  onPress={() => setSelected(c)} activeOpacity={0.75}>
                  <View style={s.clientAvatar}>
                    <Text style={s.clientAvatarText}>{c.name[0].toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.clientName}>{c.name}</Text>
                    {visit
                      ? <Text style={s.clientVisit}>{visitAgo(visit)}</Text>
                      : c.phone ? <Text style={s.clientPhone}>{c.phone}</Text> : null}
                    {yaPedido && (
                      <View style={s.askedChip}>
                        <Text style={s.askedChipText}>ya se le pidió {sentAgo(sent!)}</Text>
                      </View>
                    )}
                  </View>
                  {selected?.id === c.id && <Ionicons name="checkmark-circle" size={18} color={Colors.red} />}
                </TouchableOpacity>
              );
            })}

            {selected && (
              <Animated.View entering={FadeInDown.duration(300)}>
                <Text style={[s.label, { marginTop: 24 }]}>Vista previa del mensaje</Text>
                <View style={[s.preview, Shadow.sm]}>
                  <ScrollView automaticallyAdjustKeyboardInsets style={{ maxHeight: 180 }} scrollEnabled>
                    <Text style={s.previewText}>{buildMessage(selected)}</Text>
                  </ScrollView>
                </View>

                <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
                  <TouchableOpacity style={[s.actionBtn, { flex: 1, backgroundColor: Colors.white, borderWidth: 1.5, borderColor: Colors.border }]}
                    onPress={() => handleCopyMsg(selected)} activeOpacity={0.8}>
                    <Ionicons name={msgCopied ? "checkmark" : "copy-outline"} size={16} color={Colors.text} />
                    <Text style={[s.actionBtnText, { color: Colors.text }]}>{msgCopied ? "Copiado" : "Copiar"}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.actionBtn, { flex: 1, backgroundColor: "#25D366" }]}
                    onPress={() => handleWhatsApp(selected)} activeOpacity={0.8}>
                    <Ionicons name="logo-whatsapp" size={16} color="white" />
                    <Text style={s.actionBtnText}>WhatsApp</Text>
                  </TouchableOpacity>
                </View>
              </Animated.View>
            )}
          </Animated.View>
        </ScrollView>
      )}

      {/* ── HISTORIAL ── */}
      {tab === "historial" && (
        <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          {loadingHist ? (
            <ActivityIndicator color={Colors.red} style={{ marginTop: 40 }} />
          ) : requests.length === 0 ? (
            <Animated.View entering={FadeInDown.duration(350)} style={[s.emptyCard, Shadow.sm]}>
              <Text style={{ fontSize: 32, marginBottom: 10 }}>⭐</Text>
              <Text style={s.emptyTitle}>Sin solicitudes aún</Text>
              <Text style={s.emptySub}>Las solicitudes enviadas aparecerán aquí</Text>
            </Animated.View>
          ) : (
            <>
              <View style={[s.summaryCard, Shadow.sm]}>
                <Text style={s.summaryCount}>{requests.length}</Text>
                <Text style={s.summaryLabel}>Total solicitudes enviadas</Text>
                {/* Google no avisa quién reseñó: el conteo sale de lo que el
                    negocio marca a mano. Decirlo evita que un 0 se lea como
                    que la herramienta no funciona. */}
                <Text style={s.summaryHint}>
                  {reviewedCount} marcada{reviewedCount === 1 ? "" : "s"} como reseñada{reviewedCount === 1 ? "" : "s"} a mano
                </Text>
              </View>

              <View style={s.filterRow}>
                {([
                  ["todas",      "Todas",      requests.length],
                  ["pendientes", "Pendientes", requests.length - reviewedCount],
                  ["resenaron",  "Reseñaron",  reviewedCount],
                ] as [HistFilter, string, number][]).map(([key, label, n]) => (
                  <TouchableOpacity key={key} onPress={() => setHistFilter(key)} activeOpacity={0.75}
                    style={[s.filterChip, histFilter === key && s.filterChipActive]}>
                    <Text style={[s.filterChipText, histFilter === key && s.filterChipTextActive]}>{label} {n}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {visibleRequests.length === 0 && (
                <View style={s.listEmpty}>
                  <Text style={s.listEmptyText}>
                    {histFilter === "resenaron"
                      ? "Todavía no has marcado ninguna como reseñada."
                      : "No queda ninguna pendiente."}
                  </Text>
                </View>
              )}

              {visibleRequests.map((r, i) => (
                <Animated.View key={r.id} entering={i < 10 ? FadeInDown.delay(i * 40).duration(280) : undefined}>
                  <View style={[s.histRow, Shadow.sm]}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.histName}>{r.client_name}</Text>
                      <Text style={s.histPhone}>{r.client_phone ?? "—"}</Text>
                    </View>
                    <View style={{ alignItems: "flex-end", gap: 6 }}>
                      <Text style={s.histDate}>{fmtDateFull(r.created_at)}</Text>
                      <View style={[s.viaBadge, { backgroundColor: r.sent_via === "whatsapp" ? "#25d36615" : Colors.border }]}>
                        <Ionicons name={r.sent_via === "whatsapp" ? "logo-whatsapp" : "copy-outline"} size={10} color={r.sent_via === "whatsapp" ? "#25d366" : Colors.muted} />
                        <Text style={[s.viaBadgeText, { color: r.sent_via === "whatsapp" ? "#25d366" : Colors.muted }]}>
                          {r.sent_via === "whatsapp" ? "WhatsApp" : "Manual"}
                        </Text>
                      </View>
                    </View>
                  </View>
                </Animated.View>
              ))}
            </>
          )}
        </ScrollView>
      )}
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
  inputRow:     { flexDirection: "row", alignItems: "center", gap: 8 },
  copyBtn:      { width: 48, height: 48, borderRadius: Radius.md, backgroundColor: Colors.white, borderWidth: 1.5, borderColor: Colors.border, alignItems: "center", justifyContent: "center" },

  infoBox:      { backgroundColor: "#fffbeb", borderRadius: Radius.md, padding: 16, borderWidth: 1, borderColor: "#fde68a" },
  infoTitle:    { fontSize: 13, fontFamily: "SpaceGrotesk_700Bold", color: "#92400e", marginBottom: 10 },
  infoStep:     { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: "#92400e", marginBottom: 4 },
  infoBold:     { fontFamily: "SpaceGrotesk_700Bold" },

  varRow:       { flexDirection: "row", gap: 8, marginBottom: 10, flexWrap: "wrap" },
  varChip:      { backgroundColor: Colors.purple + "14", borderRadius: Radius.full, paddingHorizontal: 12, paddingVertical: 6 },
  varChipText:  { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.purple },

  textAreaWrap: { backgroundColor: Colors.white, borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md },
  textArea:     { padding: 14, fontSize: 14, fontFamily: "SpaceGrotesk_400Regular", color: Colors.text, minHeight: 160 },

  btn:          { borderRadius: Radius.full, overflow: "hidden", marginTop: 24 },
  btnInner:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 16, backgroundColor: Colors.red },
  btnText:      { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: "white" },

  successBanner:{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: Colors.success + "14", borderRadius: Radius.md, padding: 14, marginBottom: 4 },
  successText:  { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.success },

  clientCard:   { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: Colors.white, borderRadius: Radius.md, padding: 12, marginTop: 8, borderWidth: 1.5, borderColor: Colors.border },
  clientCardActive:{ borderColor: Colors.red, backgroundColor: Colors.red + "05" },
  clientAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: Colors.red + "18", alignItems: "center", justifyContent: "center" },
  clientAvatarText:{ fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: Colors.red },
  clientName:   { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  clientPhone:  { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, marginTop: 2 },
  clientVisit:  { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted, marginTop: 2 },
  askedChip:    { alignSelf: "flex-start", marginTop: 5, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99, backgroundColor: "#d977061a" },
  askedChipText:{ fontSize: 10.5, fontFamily: "SpaceGrotesk_700Bold", color: "#b45309" },

  listHint:     { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, marginTop: 8, lineHeight: 18 },
  listEmpty:    { marginTop: 14, padding: 18, borderRadius: Radius.md, backgroundColor: Colors.border + "40" },
  listEmptyText:{ fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, lineHeight: 20, textAlign: "center" },

  filterRow:    { flexDirection: "row", gap: 8, marginTop: 14, marginBottom: 4 },
  filterChip:   { flex: 1, paddingVertical: 9, borderRadius: 99, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.white, alignItems: "center" },
  filterChipActive: { backgroundColor: Colors.text, borderColor: Colors.text },
  filterChipText:   { fontSize: 12, fontFamily: "SpaceGrotesk_700Bold", color: Colors.muted },
  filterChipTextActive: { color: "white" },

  preview:      { backgroundColor: "#f0fdf4", borderRadius: Radius.md, padding: 16, borderWidth: 1, borderColor: "#bbf7d0" },
  previewText:  { fontSize: 14, fontFamily: "SpaceGrotesk_400Regular", color: Colors.text, lineHeight: 22 },

  actionBtn:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: Radius.md, paddingVertical: 14 },
  actionBtnText:{ fontSize: 14, fontFamily: "SpaceGrotesk_700Bold", color: "white" },

  emptyCard:    { backgroundColor: Colors.white, borderRadius: Radius.xl, padding: 48, alignItems: "center", marginTop: 20 },
  emptyTitle:   { fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text, marginBottom: 6 },
  emptySub:     { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, textAlign: "center" },

  summaryCard:  { backgroundColor: Colors.white, borderRadius: Radius.lg, padding: 20, alignItems: "center", marginBottom: 16 },
  summaryCount: { fontSize: 36, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text },
  summaryLabel: { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, marginTop: 4 },
  summaryHint:  { fontSize: 11.5, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, marginTop: 6, opacity: 0.85 },

  histRow:      { flexDirection: "row", alignItems: "center", backgroundColor: Colors.white, borderRadius: Radius.md, padding: 14, marginBottom: 8 },
  histName:     { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  histPhone:    { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, marginTop: 2 },
  histDate:     { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", color: Colors.subtle },
  viaBadge:     { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  viaBadgeText: { fontSize: 10, fontFamily: "SpaceGrotesk_600SemiBold" },
});
