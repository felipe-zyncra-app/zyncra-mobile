import { useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, KeyboardAvoidingView, ActivityIndicator,
  Linking, Alert, Clipboard,
} from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { Colors, Radius, Shadow } from "@/constants/theme";
import ErrorState from "@/components/ErrorState";
import { useTheme, type ThemeColors } from "@/lib/theme";
import { IconButton, ScreenHeader } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { enlaceWhatsApp, fmtTelefono } from "@/lib/format";
import { exigirFilas, mensajeError, revisar, traerPorIds, traerTodo } from "@/lib/db";
import { useRecarga, useGuardRespuestas } from "@/lib/useRecarga";
import { diaLocalDe, diasEntre, fmtDia, hoyNegocio, sumarDias } from "@/lib/tz";
import { filtroNombreTelefono, reemplazarVariables } from "@/lib/mensajeria";

type Tab = "config" | "solicitar" | "historial";
type Client = { id: string; name: string; phone: string | null; phone_country_code: string | null };
type Request = { id: string; client_name: string; client_phone: string | null; sent_via: string; created_at: string; reviewed?: boolean | null };
type HistFilter = "todas" | "pendientes" | "resenaron";

/** Cada cuánto tiene sentido volver a pedirle reseña a la misma persona. */
const REASK_DAYS = 90;
/** Cuántos sugeridos se muestran y cuántos se precargan (para reponer los que se piden). */
const SUGERIDOS_VISIBLES = 8;
const SUGERIDOS_PRECARGA = 30;
const PAGINA_HISTORIAL = 50;

const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

/** Días desde una visita ('YYYY-MM-DD') hasta hoy, ambos en la zona del negocio. */
const diasDesdeVisita = (dia: string, hoy: string) => Math.max(0, diasEntre(dia, hoy) - 1);

function visitAgo(dia: string, hoy: string): string {
  const d = diasDesdeVisita(dia, hoy);
  if (d <= 0) return "Atendido hoy";
  if (d === 1) return "Atendido ayer";
  if (d < 7)   return `Atendido hace ${d} días`;
  if (d < 30)  return `Atendido hace ${Math.floor(d / 7)} sem.`;
  const m = Math.floor(d / 30);
  return `Atendido hace ${m} mes${m > 1 ? "es" : ""}`;
}

/** "hoy", "ayer"…, por día del negocio: con horas transcurridas, una solicitud
 *  de anoche a las 11 PM salía "hoy" a la mañana siguiente. */
function sentAgo(iso: string, hoy: string, tz: string): string {
  const d = diasDesdeVisita(diaLocalDe(iso, tz), hoy);
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
  const s = useMemo(() => crearEstilos(t), [t]);
  const { tenantId } = useAuth();
  const { timezone, ready } = useTenant();
  const guardCfg = useGuardRespuestas();
  const guardSol = useGuardRespuestas();
  const guardHist = useGuardRespuestas();
  const guardBusq = useGuardRespuestas();
  const [tab, setTab]                 = useState<Tab>("config");
  const tabInicial = useRef(false);

  // Config
  const [settingsId, setSettingsId]   = useState<string | null>(null);
  const [cfgCargada, setCfgCargada]   = useState(false);
  const [cfgError, setCfgError]       = useState<unknown>(null);
  const [googleUrl, setGoogleUrl]     = useState("");
  const [template, setTemplate]       = useState(DEFAULT_TEMPLATE);
  const [saving, setSaving]           = useState(false);
  const [savedOk, setSavedOk]         = useState(false);
  const [copied, setCopied]           = useState(false);
  // Lo que el dueño está escribiendo no se pisa al recargar la pantalla.
  const editado = useRef(false);

  // Solicitar
  const [search, setSearch]           = useState("");
  const [resultados, setResultados]   = useState<Client[] | null>(null);
  const [buscando, setBuscando]       = useState(false);
  const [candidatos, setCandidatos]   = useState<Client[]>([]);
  const [selected, setSelected]       = useState<Client | null>(null);
  const [sentOk, setSentOk]           = useState(false);
  const [msgCopied, setMsgCopied]     = useState(false);
  const [enviando, setEnviando]       = useState(false);
  const [loadingClients, setLoadingClients] = useState(false);
  const [solError, setSolError]       = useState<unknown>(null);
  const [lastSent, setLastSent]       = useState<Record<string, string>>({});
  const [lastVisit, setLastVisit]     = useState<Record<string, string>>({});

  // Historial
  const [requests, setRequests]       = useState<Request[]>([]);
  const [totalReq, setTotalReq]       = useState<number | null>(null);
  const [reviewedCount, setReviewedCount] = useState<number | null>(null);
  const [loadingHist, setLoadingHist] = useState(false);
  const [histError, setHistError]     = useState<unknown>(null);
  const [histFilter, setHistFilter]   = useState<HistFilter>("todas");
  const filtroHistRef = useRef(histFilter);
  filtroHistRef.current = histFilter;
  const [hayMasHist, setHayMasHist]   = useState(false);
  const [cargandoMasHist, setCargandoMasHist] = useState(false);

  const cargarConfig = async () => {
    if (!tenantId) return;
    const turno = guardCfg.nuevo();
    try {
      const cfg = revisar(
        await supabase.from("google_review_settings")
          .select("id, google_maps_url, message_template").eq("tenant_id", tenantId).maybeSingle(),
        "No se pudo cargar la configuración de reseñas",
      ) as { id: string; google_maps_url: string | null; message_template: string | null } | null;
      if (!turno.vigente()) return;
      setSettingsId(cfg?.id ?? null);
      if (!editado.current) {
        setGoogleUrl(cfg?.google_maps_url ?? "");
        setTemplate(cfg?.message_template || DEFAULT_TEMPLATE);
      }
      setCfgCargada(true);
      setCfgError(null);
      // Poner el link es de una sola vez; pedir reseñas es lo de todos los
      // días. Quien ya lo tiene entra directo a pedir.
      if (!tabInicial.current) {
        tabInicial.current = true;
        setTab(cfg?.google_maps_url ? "solicitar" : "config");
      }
    } catch (e) {
      if (turno.vigente()) setCfgError(e);
    }
  };

  /**
   * Visitas atendidas del último año y solicitudes ya enviadas, paginadas
   * (antes la lista de clientes se cortaba en 1000 por orden alfabético y la
   * búsqueda era local: nadie después de la "M" aparecía, COM-15).
   */
  const cargarSolicitar = async () => {
    if (!tenantId) return;
    const turno = guardSol.nuevo();
    setLoadingClients(true);
    try {
      const hoy = hoyNegocio(timezone);
      const [visitas, pedidos] = await Promise.all([
        traerTodo<{ client_id: string | null; appointment_date: string }>((d, h) =>
          supabase.from("appointments").select("client_id, appointment_date")
            .eq("tenant_id", tenantId).eq("status", "completed")
            .gte("appointment_date", sumarDias(hoy, -365)).lte("appointment_date", hoy)
            .not("client_id", "is", null)
            .order("appointment_date", { ascending: false }).order("id").range(d, h),
        { contexto: "No se pudieron cargar las visitas" }),
        traerTodo<{ client_id: string | null; created_at: string }>((d, h) =>
          supabase.from("review_requests").select("client_id, created_at")
            .eq("tenant_id", tenantId).not("client_id", "is", null)
            .order("created_at", { ascending: false }).order("id").range(d, h),
        { contexto: "No se pudieron cargar las solicitudes enviadas" }),
      ]);
      const sent: Record<string, string> = {};
      for (const r of pedidos) if (r.client_id && !sent[r.client_id]) sent[r.client_id] = r.created_at;
      const visits: Record<string, string> = {};
      for (const a of visitas) if (a.client_id && !visits[a.client_id]) visits[a.client_id] = a.appointment_date;

      const ids = Object.keys(visits)
        .filter(id => pedirDeNuevo(sent[id], visits[id]))
        .sort((a, b) => (visits[a] < visits[b] ? 1 : visits[a] > visits[b] ? -1 : 0))
        .slice(0, SUGERIDOS_PRECARGA);
      const detalles = await traerPorIds<Client>(ids, (lote, d, h) =>
        supabase.from("clients").select("id, name, phone, phone_country_code")
          .eq("tenant_id", tenantId).in("id", lote).order("id").range(d, h),
      { contexto: "No se pudieron cargar los clientes" });
      if (!turno.vigente()) return;
      const porId = new Map(detalles.map(c => [c.id, c]));
      setCandidatos(ids.map(id => porId.get(id)).filter((c): c is Client => !!c));
      setLastSent(sent);
      setLastVisit(visits);
      setSolError(null);
    } catch (e) {
      if (turno.vigente()) setSolError(e);
    } finally {
      if (turno.vigente()) setLoadingClients(false);
    }
  };

  const consultaHistorial = (tid: string, filtro: HistFilter) => {
    const q = supabase.from("review_requests")
      .select("id, client_name, client_phone, sent_via, created_at, reviewed").eq("tenant_id", tid);
    if (filtro === "resenaron") return q.eq("reviewed", true);
    if (filtro === "pendientes") return q.or("reviewed.is.null,reviewed.eq.false");
    return q;
  };

  const cargarHistorial = async () => {
    if (!tenantId) return;
    const turno = guardHist.nuevo();
    setLoadingHist(true);
    try {
      // Totales reales con count: antes "Total" era el largo de una lista
      // limitada a 100 (COM-15).
      const [totalRes, resenaronRes, pagina] = await Promise.all([
        supabase.from("review_requests").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
        supabase.from("review_requests").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("reviewed", true),
        consultaHistorial(tenantId, histFilter).order("created_at", { ascending: false }).order("id").range(0, PAGINA_HISTORIAL - 1),
      ]);
      revisar(totalRes, "No se pudo cargar el historial");
      revisar(resenaronRes, "No se pudo cargar el historial");
      const filas = (revisar(pagina, "No se pudo cargar el historial") ?? []) as Request[];
      if (!turno.vigente()) return;
      setTotalReq(totalRes.count ?? 0);
      setReviewedCount(resenaronRes.count ?? 0);
      setRequests(filas);
      setHayMasHist(filas.length === PAGINA_HISTORIAL);
      setHistError(null);
    } catch (e) {
      if (turno.vigente()) setHistError(e);
    } finally {
      if (turno.vigente()) setLoadingHist(false);
    }
  };

  const cargarMasHistorial = async () => {
    if (!tenantId || cargandoMasHist || !hayMasHist) return;
    setCargandoMasHist(true);
    const filtro = histFilter;
    try {
      const desde = requests.length;
      const filas = (revisar(
        await consultaHistorial(tenantId, filtro).order("created_at", { ascending: false }).order("id")
          .range(desde, desde + PAGINA_HISTORIAL - 1),
        "No se pudieron cargar más solicitudes",
      ) ?? []) as Request[];
      // Si mientras tanto cambió el filtro, esta página es de otra lista.
      if (filtroHistRef.current !== filtro) return;
      setRequests(prev => [...prev, ...filas.filter(f => !prev.some(p => p.id === f.id))]);
      setHayMasHist(filas.length === PAGINA_HISTORIAL);
    } catch (e) {
      Alert.alert("No se pudo cargar", mensajeError(e));
    } finally {
      setCargandoMasHist(false);
    }
  };

  const { hoy, recargar } = useRecarga(async () => {
    const tareas: Promise<void>[] = [cargarConfig()];
    if (tab === "solicitar") tareas.push(cargarSolicitar());
    if (tab === "historial") tareas.push(cargarHistorial());
    await Promise.all(tareas);
  }, [tenantId, timezone, tab, histFilter], { timeZone: timezone, habilitado: !!tenantId && ready, alCambiarSede: false, frescuraMs: 20_000 });

  // Búsqueda en el servidor, por nombre o teléfono.
  useEffect(() => {
    const filtro = filtroNombreTelefono(search, "name", "phone");
    if (!tenantId || !filtro) {
      guardBusq.invalidar();
      setResultados(null);
      setBuscando(false);
      return;
    }
    const turno = guardBusq.nuevo();
    setBuscando(true);
    const tm = setTimeout(async () => {
      try {
        const filas = (revisar(
          await supabase.from("clients").select("id, name, phone, phone_country_code")
            .eq("tenant_id", tenantId).or(filtro).order("name").order("id").limit(20),
          "No se pudo buscar",
        ) ?? []) as Client[];
        if (turno.vigente()) setResultados(filas);
      } catch (e) {
        if (turno.vigente()) { setResultados([]); Alert.alert("No se pudo buscar", mensajeError(e)); }
      } finally {
        if (turno.vigente()) setBuscando(false);
      }
    }, 300);
    return () => clearTimeout(tm);
  }, [search, tenantId, guardBusq]);

  /**
   * Toca pedir si nunca se le pidió, si volvió DESPUÉS de la última solicitud
   * o si ya pasaron REASK_DAYS. La solicitud es un timestamp UTC y la visita
   * un día local: se compara el día del negocio de la solicitud, no el texto
   * UTC ('2026-09-20T01…' < '2026-09-20' daba false, COM-22).
   */
  function pedirDeNuevo(sent: string | undefined, visit: string | undefined): boolean {
    if (!sent) return true;
    if (visit && diaLocalDe(sent, timezone) < visit) return true;
    return daysSince(sent) > REASK_DAYS;
  }

  const handleSave = async () => {
    if (!tenantId || saving) return;
    if (!cfgCargada) {
      // Guardar antes de que llegue la configuración pisaba el mensaje real
      // con el de ejemplo.
      Alert.alert("Un momento", "Todavía no se carga tu configuración actual. Inténtalo de nuevo en unos segundos.");
      return;
    }
    const url = googleUrl.trim();
    if (url && !/^https?:\/\/\S+$/i.test(url)) {
      Alert.alert("Link inválido", "Pega el link completo, que empiece por https://");
      return;
    }
    setSaving(true);
    try {
      const fila = revisar(
        await supabase.from("google_review_settings")
          .upsert({ tenant_id: tenantId, google_maps_url: url || null, message_template: template }, { onConflict: "tenant_id" })
          .select("id").single(),
        "No se pudo guardar la configuración",
      ) as { id: string };
      setSettingsId(fila.id);
      editado.current = false;
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 2000);
    } catch (e) {
      Alert.alert("No se guardó", mensajeError(e));
    } finally {
      setSaving(false);
    }
  };

  const buildMessage = (client: Client) =>
    reemplazarVariables(template, { nombre: client.name, link: googleUrl.trim() });

  /** Registra la solicitud. Devuelve false (y avisa) si no se pudo guardar. */
  const logRequest = async (client: Client, via: string): Promise<boolean> => {
    if (!tenantId) return false;
    const { error } = await supabase.from("review_requests").insert({
      tenant_id: tenantId, client_id: client.id,
      client_name: client.name, client_phone: client.phone,
      sent_via: via,
    });
    if (error) {
      Alert.alert("No se registró la solicitud", mensajeError(error));
      return false;
    }
    setLastSent(prev => ({ ...prev, [client.id]: new Date().toISOString() }));
    setSentOk(true);
    setTimeout(() => setSentOk(false), 2500);
    return true;
  };

  const faltaLink = () => {
    if (googleUrl.trim()) return false;
    Alert.alert("Falta el link", "Configura primero el link de Google en la pestaña Configuración.");
    return true;
  };

  const handleCopyMsg = async (client: Client) => {
    if (faltaLink() || enviando) return;
    setEnviando(true);
    Clipboard.setString(buildMessage(client));
    setMsgCopied(true);
    setTimeout(() => setMsgCopied(false), 2000);
    await logRequest(client, "manual");
    setEnviando(false);
  };

  const handleWhatsApp = async (client: Client) => {
    if (faltaLink() || enviando) return;
    if (!client.phone) { Alert.alert("Sin teléfono", "Este cliente no tiene número registrado."); return; }
    const url = enlaceWhatsApp(client.phone, { texto: buildMessage(client), indicativo: client.phone_country_code });
    if (!url) {
      Alert.alert("Número inválido", `El teléfono de ${client.name} (${client.phone}) no es un número válido. Corrígelo en Clientes.`);
      return;
    }
    setEnviando(true);
    try {
      await Linking.openURL(url);
    } catch {
      setEnviando(false);
      Alert.alert("No se pudo abrir WhatsApp", "Revisa que WhatsApp esté instalado en este teléfono.");
      return;
    }
    await logRequest(client, "whatsapp");
    setEnviando(false);
  };

  const toggleReviewed = async (r: Request) => {
    const next = !r.reviewed;
    setRequests(prev => prev.map(x => (x.id === r.id ? { ...x, reviewed: next } : x)));
    setReviewedCount(c => (c === null ? c : Math.max(0, c + (next ? 1 : -1))));
    try {
      exigirFilas(
        await supabase.from("review_requests").update({ reviewed: next }).eq("id", r.id).select("id"),
        "No se pudo marcar la solicitud",
      );
    } catch (e) {
      setRequests(prev => prev.map(x => (x.id === r.id ? { ...x, reviewed: r.reviewed } : x)));
      setReviewedCount(c => (c === null ? c : Math.max(0, c + (next ? -1 : 1))));
      Alert.alert("No se guardó", mensajeError(e));
    }
  };

  const searching = search.trim().length > 0;

  /**
   * Con el buscador vacío la lista propone a quién pedirle en vez de mostrar
   * los primeros por orden alfabético: clientes con una visita ATENDIDA a los
   * que toca pedirles (ver pedirDeNuevo), del más reciente al más antiguo.
   * Pedir la reseña recién salido del local es cuando más gente la deja.
   */
  const filtered = searching
    ? (resultados ?? [])
    : candidatos.filter(c => pedirDeNuevo(lastSent[c.id], lastVisit[c.id])).slice(0, SUGERIDOS_VISIBLES);

  const TABS: { key: Tab; label: string }[] = [
    { key: "solicitar", label: "Pedir reseña" },
    { key: "historial", label: "Historial" },
    { key: "config",    label: "Configuración" },
  ];

  const total = totalReq ?? 0;
  const resenaron = reviewedCount ?? 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader crumb="Marketing" title="Reseñas Google" subtitle="Solicita reseñas a tus clientes" onBack={() => router.back()} />

      {/* Tabs */}
      <View style={[s.tabBar, { backgroundColor: t.bgAlt, borderBottomColor: t.border }]}>
        {TABS.map(tb => (
          <TouchableOpacity key={tb.key} style={[s.tabBtn, tab === tb.key && s.tabBtnActive]} onPress={() => setTab(tb.key)} activeOpacity={0.75}
            accessibilityRole="tab" accessibilityState={{ selected: tab === tb.key }}>
            <Text style={[s.tabLabel, tab === tb.key && s.tabLabelActive]}>{tb.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── CONFIGURACIÓN ── */}
      {tab === "config" && (
        cfgError && !cfgCargada ? <ErrorState error={cfgError} onRetry={recargar} /> : (
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
                <TextInput style={[s.input, { flex: 1 }]} value={googleUrl}
                  onChangeText={v => { editado.current = true; setGoogleUrl(v); }}
                  placeholder="https://g.page/r/..." placeholderTextColor={t.subtle}
                  autoCapitalize="none" autoCorrect={false} keyboardType="url" />
                <TouchableOpacity style={s.copyBtn} disabled={!googleUrl.trim()}
                  onPress={() => { Clipboard.setString(googleUrl.trim()); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                  accessibilityRole="button" accessibilityLabel="Copiar link">
                  <Ionicons name={copied ? "checkmark" : "copy-outline"} size={16} color={copied ? Colors.success : t.muted} />
                </TouchableOpacity>
              </View>

              {/* Template */}
              <Text style={s.label}>Mensaje de WhatsApp</Text>
              <View style={s.varRow}>
                {["{{nombre}}", "{{link}}"].map(v => (
                  <TouchableOpacity key={v} style={s.varChip} onPress={() => { editado.current = true; setTemplate(x => x + v); }} activeOpacity={0.7}
                    accessibilityRole="button" accessibilityLabel={`Insertar ${v}`}>
                    <Text style={s.varChipText}>{v}</Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity style={[s.varChip, { backgroundColor: t.chipBg }]}
                  onPress={() => { editado.current = true; setTemplate(DEFAULT_TEMPLATE); }} activeOpacity={0.7}>
                  <Text style={[s.varChipText, { color: t.muted }]}>Restaurar</Text>
                </TouchableOpacity>
              </View>
              <View style={[s.textAreaWrap, Shadow.sm]}>
                <TextInput style={s.textArea} value={template}
                  onChangeText={v => { editado.current = true; setTemplate(v); }}
                  multiline textAlignVertical="top" placeholderTextColor={t.subtle} />
              </View>

              <TouchableOpacity style={s.btn} onPress={handleSave} disabled={saving || !cfgCargada} activeOpacity={0.85}
                accessibilityRole="button" accessibilityState={{ disabled: saving || !cfgCargada, busy: saving }}>
                <View style={[s.btnInner, { backgroundColor: savedOk ? Colors.success : Colors.red }, !cfgCargada && { opacity: 0.5 }]}>
                  {saving ? <ActivityIndicator color="white" /> : savedOk
                    ? <><Ionicons name="checkmark-circle" size={16} color="white" /><Text style={s.btnText}>Guardado</Text></>
                    : <Text style={s.btnText}>Guardar configuración</Text>
                  }
                </View>
              </TouchableOpacity>
              {settingsId === null && cfgCargada && (
                <Text style={s.listHint}>Aún no has guardado tu link de Google.</Text>
              )}
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
        )
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
            <View style={s.inputRow}>
              <TextInput style={[s.input, { flex: 1 }]} value={search}
                onChangeText={v => { setSearch(v); setSelected(null); setSentOk(false); }}
                placeholder="Buscar por nombre o teléfono..." placeholderTextColor={t.subtle} autoCorrect={false} />
              {buscando && <ActivityIndicator color={t.muted} />}
            </View>
            {!searching && (
              <Text style={s.listHint}>
                Clientes que ya atendiste y a los que aún no les has pedido reseña, del más reciente al más antiguo.
              </Text>
            )}

            {solError && !searching ? (
              <TouchableOpacity onPress={recargar} style={s.inlineError} activeOpacity={0.8}>
                <Ionicons name="alert-circle-outline" size={14} color={Colors.red} />
                <Text style={s.inlineErrorText}>{mensajeError(solError)} Toca para reintentar.</Text>
              </TouchableOpacity>
            ) : null}

            {loadingClients && !searching && candidatos.length === 0 && <ActivityIndicator color={Colors.red} style={{ marginTop: 20 }} />}

            {!loadingClients && !buscando && !solError && filtered.length === 0 && (searching ? resultados !== null : true) && (
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
              const yaPedido = !!sent && !pedirDeNuevo(sent, visit);
              return (
                <TouchableOpacity key={c.id}
                  style={[s.clientCard, selected?.id === c.id && s.clientCardActive]}
                  onPress={() => setSelected(c)} activeOpacity={0.75}
                  accessibilityRole="radio" accessibilityState={{ selected: selected?.id === c.id }}>
                  <View style={s.clientAvatar}>
                    <Text style={s.clientAvatarText}>{(c.name?.[0] ?? "?").toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.clientName}>{c.name}</Text>
                    {visit
                      ? <Text style={s.clientVisit}>{visitAgo(visit, hoy)}</Text>
                      : c.phone ? <Text style={s.clientPhone}>{fmtTelefono(c.phone, { indicativo: c.phone_country_code })}</Text> : null}
                    {yaPedido && (
                      <View style={s.askedChip}>
                        <Text style={s.askedChipText}>ya se le pidió {sentAgo(sent!, hoy, timezone)}</Text>
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
                  <ScrollView style={{ maxHeight: 180 }} nestedScrollEnabled>
                    <Text style={s.previewText}>{buildMessage(selected)}</Text>
                  </ScrollView>
                </View>

                <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
                  <TouchableOpacity style={[s.actionBtn, s.actionBtnOutline, { flex: 1 }]} disabled={enviando}
                    onPress={() => handleCopyMsg(selected)} activeOpacity={0.8}>
                    <Ionicons name={msgCopied ? "checkmark" : "copy-outline"} size={16} color={t.text} />
                    <Text style={[s.actionBtnText, { color: t.text }]}>{msgCopied ? "Copiado" : "Copiar"}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.actionBtn, { flex: 1, backgroundColor: "#25D366" }, enviando && { opacity: 0.6 }]} disabled={enviando}
                    onPress={() => handleWhatsApp(selected)} activeOpacity={0.8}>
                    {enviando ? <ActivityIndicator color="white" size="small" /> : <Ionicons name="logo-whatsapp" size={16} color="white" />}
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
        histError && requests.length === 0 && totalReq === null ? <ErrorState error={histError} onRetry={recargar} /> : (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          {loadingHist && totalReq === null ? (
            <ActivityIndicator color={Colors.red} style={{ marginTop: 40 }} />
          ) : total === 0 ? (
            <Animated.View entering={FadeInDown.duration(350)} style={[s.emptyCard, Shadow.sm]}>
              <Text style={{ fontSize: 32, marginBottom: 10 }}>⭐</Text>
              <Text style={s.emptyTitle}>Sin solicitudes aún</Text>
              <Text style={s.emptySub}>Las solicitudes enviadas aparecerán aquí</Text>
            </Animated.View>
          ) : (
            <>
              <View style={[s.summaryCard, Shadow.sm]}>
                <Text style={s.summaryCount}>{total}</Text>
                <Text style={s.summaryLabel}>Total solicitudes enviadas</Text>
                {/* Google no avisa quién reseñó: el conteo sale de lo que el
                    negocio marca a mano (la estrella de cada fila). Decirlo
                    evita que un 0 se lea como que la herramienta no funciona. */}
                <Text style={s.summaryHint}>
                  {resenaron} marcada{resenaron === 1 ? "" : "s"} como reseñada{resenaron === 1 ? "" : "s"} a mano · toca ☆ para marcar
                </Text>
              </View>

              <View style={s.filterRow}>
                {([
                  ["todas",      "Todas",      total],
                  ["pendientes", "Pendientes", Math.max(0, total - resenaron)],
                  ["resenaron",  "Reseñaron",  resenaron],
                ] as [HistFilter, string, number][]).map(([key, label, n]) => (
                  <TouchableOpacity key={key} onPress={() => setHistFilter(key)} activeOpacity={0.75}
                    style={[s.filterChip, histFilter === key && s.filterChipActive]}
                    accessibilityRole="button" accessibilityState={{ selected: histFilter === key }}>
                    <Text style={[s.filterChipText, histFilter === key && s.filterChipTextActive]}>{label} {n}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {loadingHist && <ActivityIndicator color={t.muted} style={{ marginVertical: 10 }} />}

              {!loadingHist && requests.length === 0 && (
                <View style={s.listEmpty}>
                  <Text style={s.listEmptyText}>
                    {histFilter === "resenaron"
                      ? "Todavía no has marcado ninguna como reseñada."
                      : "No queda ninguna pendiente."}
                  </Text>
                </View>
              )}

              {requests.map((r, i) => (
                <Animated.View key={r.id} entering={i < 10 ? FadeInDown.delay(i * 40).duration(280) : undefined}>
                  <View style={[s.histRow, Shadow.sm]}>
                    <IconButton
                      icon={r.reviewed ? "star" : "star-outline"}
                      label={r.reviewed ? `Quitar la marca de reseña de ${r.client_name}` : `Marcar que ${r.client_name} dejó reseña`}
                      onPress={() => toggleReviewed(r)}
                      tone="plain"
                      color={r.reviewed ? "#f59e0b" : t.subtle}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={s.histName}>{r.client_name}</Text>
                      <Text style={s.histPhone}>{r.client_phone ? fmtTelefono(r.client_phone) : "—"}</Text>
                    </View>
                    <View style={{ alignItems: "flex-end", gap: 6 }}>
                      <Text style={s.histDate}>{fmtDia(diaLocalDe(r.created_at, timezone), "corto")}</Text>
                      <View style={[s.viaBadge, { backgroundColor: r.sent_via === "whatsapp" ? "#25d36618" : t.chipBg }]}>
                        <Ionicons name={r.sent_via === "whatsapp" ? "logo-whatsapp" : "copy-outline"} size={10} color={r.sent_via === "whatsapp" ? "#25d366" : t.muted} />
                        <Text style={[s.viaBadgeText, { color: r.sent_via === "whatsapp" ? "#25d366" : t.muted }]}>
                          {r.sent_via === "whatsapp" ? "WhatsApp" : "Manual"}
                        </Text>
                      </View>
                    </View>
                  </View>
                </Animated.View>
              ))}

              {hayMasHist && (
                <TouchableOpacity style={s.moreBtn} onPress={cargarMasHistorial} disabled={cargandoMasHist} activeOpacity={0.8}>
                  {cargandoMasHist ? <ActivityIndicator color={t.muted} /> : <Text style={s.moreText}>Cargar más</Text>}
                </TouchableOpacity>
              )}
            </>
          )}
        </ScrollView>
        )
      )}
    </SafeAreaView>
  );
}

// Tokens del tema: con Colors.white/text fijos, en modo oscuro las tarjetas
// quedaban blancas con texto oscuro.
function crearEstilos(t: ThemeColors) {
  const accent = "#7c5cff";
  return StyleSheet.create({
    tabBar:       { flexDirection: "row", borderBottomWidth: 1 },
    tabBtn:       { flex: 1, paddingVertical: 13, alignItems: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
    tabBtnActive: { borderBottomColor: Colors.red },
    tabLabel:     { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: t.muted },
    tabLabelActive:{ fontSize: 12, fontFamily: "SpaceGrotesk_700Bold", color: Colors.red },

    label:        { fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", color: t.muted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8, marginTop: 18 },
    input:        { backgroundColor: t.inputBg, borderWidth: 1.5, borderColor: t.inputBorder, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, fontFamily: "SpaceGrotesk_400Regular", color: t.text },
    inputRow:     { flexDirection: "row", alignItems: "center", gap: 8 },
    copyBtn:      { width: 48, height: 48, borderRadius: Radius.md, backgroundColor: t.inputBg, borderWidth: 1.5, borderColor: t.inputBorder, alignItems: "center", justifyContent: "center" },

    infoBox:      { backgroundColor: "rgba(245,158,11,0.10)", borderRadius: Radius.md, padding: 16, borderWidth: 1, borderColor: "rgba(245,158,11,0.35)" },
    infoTitle:    { fontSize: 13, fontFamily: "SpaceGrotesk_700Bold", color: t.text, marginBottom: 10 },
    infoStep:     { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: t.muted, marginBottom: 4 },
    infoBold:     { fontFamily: "SpaceGrotesk_700Bold", color: t.text },

    varRow:       { flexDirection: "row", gap: 8, marginBottom: 10, flexWrap: "wrap" },
    varChip:      { backgroundColor: accent + "1f", borderRadius: Radius.full, paddingHorizontal: 12, paddingVertical: 6 },
    varChipText:  { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: accent },

    textAreaWrap: { backgroundColor: t.inputBg, borderWidth: 1.5, borderColor: t.inputBorder, borderRadius: Radius.md },
    textArea:     { padding: 14, fontSize: 14, fontFamily: "SpaceGrotesk_400Regular", color: t.text, minHeight: 160 },

    btn:          { borderRadius: Radius.full, overflow: "hidden", marginTop: 24 },
    btnInner:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 16, backgroundColor: Colors.red },
    btnText:      { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: "white" },

    successBanner:{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: Colors.success + "18", borderRadius: Radius.md, padding: 14, marginBottom: 4 },
    successText:  { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.success },
    inlineError:  { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: Colors.red + "12", borderRadius: Radius.md, padding: 10, marginTop: 10 },
    inlineErrorText: { flex: 1, fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: t.text },

    clientCard:   { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: t.cardSolid, borderRadius: Radius.md, padding: 12, marginTop: 8, borderWidth: 1.5, borderColor: t.line },
    clientCardActive:{ borderColor: Colors.red, backgroundColor: Colors.red + "0a" },
    clientAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: Colors.red + "18", alignItems: "center", justifyContent: "center" },
    clientAvatarText:{ fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: Colors.red },
    clientName:   { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: t.text },
    clientPhone:  { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: t.muted, marginTop: 2 },
    clientVisit:  { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: t.muted, marginTop: 2 },
    askedChip:    { alignSelf: "flex-start", marginTop: 5, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99, backgroundColor: "rgba(217,119,6,0.14)" },
    askedChipText:{ fontSize: 10.5, fontFamily: "SpaceGrotesk_700Bold", color: "#d97706" },

    listHint:     { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: t.muted, marginTop: 8, lineHeight: 18 },
    listEmpty:    { marginTop: 14, padding: 18, borderRadius: Radius.md, backgroundColor: t.chipBg },
    listEmptyText:{ fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: t.muted, lineHeight: 20, textAlign: "center" },

    filterRow:    { flexDirection: "row", gap: 8, marginTop: 14, marginBottom: 4 },
    filterChip:   { flex: 1, paddingVertical: 9, borderRadius: 99, borderWidth: 1.5, borderColor: t.line, backgroundColor: t.cardSolid, alignItems: "center" },
    filterChipActive: { backgroundColor: t.ink, borderColor: t.ink },
    filterChipText:   { fontSize: 12, fontFamily: "SpaceGrotesk_700Bold", color: t.muted },
    filterChipTextActive: { color: t.cardSolid },

    preview:      { backgroundColor: "rgba(37,211,102,0.08)", borderRadius: Radius.md, padding: 16, borderWidth: 1, borderColor: "rgba(37,211,102,0.35)" },
    previewText:  { fontSize: 14, fontFamily: "SpaceGrotesk_400Regular", color: t.text, lineHeight: 22 },

    actionBtn:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: Radius.md, paddingVertical: 14 },
    actionBtnOutline: { backgroundColor: t.cardSolid, borderWidth: 1.5, borderColor: t.lineStrong },
    actionBtnText:{ fontSize: 14, fontFamily: "SpaceGrotesk_700Bold", color: "white" },

    emptyCard:    { backgroundColor: t.cardSolid, borderRadius: Radius.xl, padding: 48, alignItems: "center", marginTop: 20, borderWidth: 1, borderColor: t.line },
    emptyTitle:   { fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", color: t.text, marginBottom: 6 },
    emptySub:     { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: t.muted, textAlign: "center" },

    summaryCard:  { backgroundColor: t.cardSolid, borderRadius: Radius.lg, padding: 20, alignItems: "center", marginBottom: 16, borderWidth: 1, borderColor: t.line },
    summaryCount: { fontSize: 36, fontFamily: "SpaceGrotesk_700Bold", color: t.text },
    summaryLabel: { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: t.muted, marginTop: 4 },
    summaryHint:  { fontSize: 11.5, fontFamily: "SpaceGrotesk_400Regular", color: t.muted, marginTop: 6, opacity: 0.85, textAlign: "center" },

    histRow:      { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: t.cardSolid, borderRadius: Radius.md, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: t.line },
    histName:     { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: t.text },
    histPhone:    { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: t.muted, marginTop: 2 },
    histDate:     { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", color: t.subtle },
    viaBadge:     { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
    viaBadgeText: { fontSize: 10, fontFamily: "SpaceGrotesk_600SemiBold" },
    moreBtn:      { alignItems: "center", paddingVertical: 14, marginTop: 4, borderRadius: Radius.md, backgroundColor: t.chipBg },
    moreText:     { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: t.ink },
  });
}
