import { useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, KeyboardAvoidingView, ActivityIndicator,
  Modal, FlatList, Alert, Linking, Platform, Switch,
} from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { Config } from "@/lib/config";
import { Colors, Radius, Shadow } from "@/constants/theme";
import ErrorState from "@/components/ErrorState";
import { useTheme, type ThemeColors } from "@/lib/theme";
import { IconButton, ScreenHeader } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { enlaceWhatsApp, fmtTelefono, telefonoE164 } from "@/lib/format";
import { ErrorDB, exigirFilas, mensajeError, nuevoId, revisar, traerTodo } from "@/lib/db";
import { useRecarga, useGuardRespuestas } from "@/lib/useRecarga";
import { diaLocalDe, fmtDia, hoyNegocio, sumarDias } from "@/lib/tz";
import { filtrarSegmento, reemplazarVariables, sinTelefonosRepetidos } from "@/lib/mensajeria";

type Tab = "nueva" | "plantillas" | "historial" | "bot";
type Segment = "all" | "active" | "inactive";

type Template     = { id: string; name: string; message: string; created_at: string };
type Campaign     = { id: string; name: string; segment: Segment; message: string; status: string; recipients_count: number; sent_at: string | null; created_at: string };
type Client       = { id: string; name: string; phone: string; phone_country_code: string | null; e164: string | null };
/** Solo columnas NO secretas: el access_token nunca baja al teléfono (COM-11). */
type Conexion     = { phone_number_id: string | null; bot_enabled: boolean; waba_id: string | null };
type DatosSegmento = { clientes: Client[]; activos: Set<string> };

const SEGMENT_OPTS: { key: Segment; label: string; sub: string; icon: React.ComponentProps<typeof Ionicons>["name"] }[] = [
  { key: "all",      label: "Todos los clientes",   sub: "Todos con número registrado",          icon: "people-outline" },
  { key: "active",   label: "Clientes activos",      sub: "Con cita en los últimos 90 días",      icon: "checkmark-circle-outline" },
  { key: "inactive", label: "Clientes inactivos",    sub: "Sin cita en los últimos 90 días",      icon: "time-outline" },
];
const SEGMENTOS: Segment[] = ["all", "active", "inactive"];

const VARIABLES = ["{{nombre}}", "{{negocio}}"];

const DEFAULT_MSG =
  "Hola {{nombre}} 👋\n\nTe escribimos desde {{negocio}} con una novedad especial para ti...\n\n¿Agendamos tu próxima visita? 📅\n\n¡Te esperamos!";

/**
 * Clientes con teléfono y los que tienen cita reciente, paginando: PostgREST
 * corta en 1000 filas y con más de 1000 citas en 90 días el segmento
 * "inactivos" incluía a gente que vino la semana pasada (COM-05).
 */
async function cargarSegmentos(tenantId: string, timezone: string): Promise<DatosSegmento> {
  const desde = sumarDias(hoyNegocio(timezone), -90);
  const [clientes, citas] = await Promise.all([
    traerTodo<Omit<Client, "e164">>((d, h) =>
      supabase.from("clients").select("id, name, phone, phone_country_code")
        .eq("tenant_id", tenantId).not("phone", "is", null).neq("phone", "")
        .order("name").order("id").range(d, h),
    { contexto: "No se pudieron cargar los clientes" }),
    traerTodo<{ client_id: string | null }>((d, h) =>
      supabase.from("appointments").select("client_id")
        .eq("tenant_id", tenantId).gte("appointment_date", desde)
        // Una cita cancelada o a la que no vino no lo vuelve "activo".
        .not("status", "in", "(cancelled,no_show)")
        .not("client_id", "is", null)
        .order("id").range(d, h),
    { contexto: "No se pudieron cargar las citas recientes" }),
  ]);
  const conE164: Client[] = clientes.map(c => ({ ...c, e164: telefonoE164(c.phone, { indicativo: c.phone_country_code }) }));
  return {
    // Dos fichas con el mismo número recibirían el mensaje dos veces.
    clientes: sinTelefonosRepetidos(conE164, c => c.e164),
    activos: new Set(citas.map(a => a.client_id).filter((id): id is string => !!id)),
  };
}

export default function WhatsappScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const s = useMemo(() => crearEstilos(t), [t]);
  const { tenantId } = useAuth();
  const { tenant: tenantData, timezone, ready } = useTenant();
  const bizName = tenantData?.name ?? "";
  const params = useLocalSearchParams<{ mensaje?: string; segmento?: string; nombre?: string }>();
  const [tab, setTab]                 = useState<Tab>("nueva");
  const guard = useGuardRespuestas();
  const guardSeg = useGuardRespuestas();
  const guardBot = useGuardRespuestas();

  // Nueva campaña
  const [campName, setCampName]       = useState("");
  const [segment, setSegment]         = useState<Segment>("all");
  const [message, setMessage]         = useState(DEFAULT_MSG);
  const [saving, setSaving]           = useState(false);
  const [datosSeg, setDatosSeg]       = useState<DatosSegmento | null>(null);
  const [segError, setSegError]       = useState<unknown>(null);
  const [countLoading, setCountLoading] = useState(false);

  // Template save inline
  const [tmplMode, setTmplMode]       = useState(false);
  const [tmplName, setTmplName]       = useState("");
  const [tmplSaving, setTmplSaving]   = useState(false);

  // Data
  const [templates, setTemplates]     = useState<Template[]>([]);
  const [campaigns, setCampaigns]     = useState<Campaign[]>([]);
  const [listError, setListError]     = useState<unknown>(null);

  // Send modal. La fila de la campaña se crea recién al finalizar: antes se
  // insertaba "sending" al abrir y cerrar el modal dejaba campañas fantasma
  // "En proceso" (COM-21). El id se genera aquí para que reintentar no duplique.
  const [sendModal, setSendModal]     = useState(false);
  const [sendClients, setSendClients] = useState<Client[]>([]);
  const [sentIds, setSentIds]         = useState<Set<string>>(new Set());
  const [finishing, setFinishing]     = useState(false);
  const campRef = useRef<{ id: string; name: string; message: string; segment: Segment } | null>(null);

  // Conexión
  const [conexion, setConexion]       = useState<Conexion | null>(null);
  const [conexionError, setConexionError] = useState<unknown>(null);
  const [cargandoConexion, setCargandoConexion] = useState(false);
  const [guardandoBot, setGuardandoBot] = useState(false);

  // Borrador que manda Hanna ("Usar en campaña").
  const aplicado = useRef<string | null>(null);
  useEffect(() => {
    const m = typeof params.mensaje === "string" ? params.mensaje : "";
    if (!m || aplicado.current === m) return;
    aplicado.current = m;
    setMessage(m);
    if (typeof params.nombre === "string" && params.nombre) setCampName(params.nombre.slice(0, 80));
    if (SEGMENTOS.includes(params.segmento as Segment)) setSegment(params.segmento as Segment);
    setTab("nueva");
  }, [params.mensaje, params.nombre, params.segmento]);

  const cargarListas = async () => {
    if (!tenantId) return;
    const turno = guard.nuevo();
    try {
      const [tmpl, camps] = await Promise.all([
        traerTodo<Template>((d, h) =>
          supabase.from("wa_templates").select("id, name, message, created_at")
            .eq("tenant_id", tenantId).order("created_at", { ascending: false }).order("id").range(d, h),
        { contexto: "No se pudieron cargar las plantillas", tope: 1000 }),
        traerTodo<Campaign>((d, h) =>
          supabase.from("wa_campaigns").select("id, name, segment, message, status, recipients_count, sent_at, created_at")
            .eq("tenant_id", tenantId).order("created_at", { ascending: false }).order("id").range(d, h),
        { contexto: "No se pudo cargar el historial de campañas", tope: 1000 }),
      ]);
      if (!turno.vigente()) return;
      setTemplates(tmpl);
      setCampaigns(camps);
      setListError(null);
    } catch (e) {
      if (turno.vigente()) setListError(e);
    }
  };

  const cargarConteos = async () => {
    if (!tenantId) return;
    const turno = guardSeg.nuevo();
    setCountLoading(true);
    try {
      const datos = await cargarSegmentos(tenantId, timezone);
      if (!turno.vigente()) return;
      setDatosSeg(datos);
      setSegError(null);
    } catch (e) {
      if (turno.vigente()) setSegError(e);
    } finally {
      if (turno.vigente()) setCountLoading(false);
    }
  };

  const cargarConexion = async () => {
    if (!tenantId) return;
    const turno = guardBot.nuevo();
    setCargandoConexion(true);
    try {
      const fila = revisar(
        await supabase.from("whatsapp_config").select("phone_number_id, bot_enabled, waba_id")
          .eq("tenant_id", tenantId).maybeSingle(),
        "No se pudo cargar la conexión de WhatsApp",
      ) as Conexion | null;
      if (!turno.vigente()) return;
      setConexion(fila ?? { phone_number_id: null, bot_enabled: false, waba_id: null });
      setConexionError(null);
    } catch (e) {
      if (turno.vigente()) setConexionError(e);
    } finally {
      if (turno.vigente()) setCargandoConexion(false);
    }
  };

  const { recargar } = useRecarga(async () => {
    const tareas: Promise<void>[] = [cargarListas(), cargarConteos()];
    if (tab === "bot") tareas.push(cargarConexion());
    await Promise.all(tareas);
    // `tab` no va en las dependencias: cambiar de pestaña no debe volver a
    // paginar clientes y citas; la conexión se carga al abrir su pestaña.
    // alVolver apagado con el modal de envío abierto: cada "Enviar" abre
    // WhatsApp y al volver se repaginaban todos los clientes y las citas,
    // una vez por destinatario.
  }, [tenantId, timezone], { timeZone: timezone, habilitado: !!tenantId && ready, alCambiarSede: false, frescuraMs: 20_000, alVolver: !sendModal });

  const conteos = useMemo(() => {
    if (!datosSeg) return null;
    return {
      all: datosSeg.clientes.length,
      active: filtrarSegmento(datosSeg.clientes, datosSeg.activos, "active").length,
      inactive: filtrarSegmento(datosSeg.clientes, datosSeg.activos, "inactive").length,
    } as Record<Segment, number>;
  }, [datosSeg]);

  const buildMsg = (plantilla: string, clientName: string) =>
    reemplazarVariables(plantilla, { nombre: clientName, negocio: bizName });

  const handleLaunch = async () => {
    if (!tenantId) return;
    if (!campName.trim() || !message.trim()) {
      Alert.alert("Completa los campos", "Nombre y mensaje son obligatorios.");
      return;
    }
    setSaving(true);
    try {
      // Lista fresca al lanzar: el conteo en pantalla puede tener unos minutos.
      const datos = await cargarSegmentos(tenantId, timezone);
      setDatosSeg(datos);
      const lista = filtrarSegmento(datos.clientes, datos.activos, segment);
      if (lista.length === 0) {
        Alert.alert("Sin destinatarios", "No hay clientes con teléfono para este segmento.");
        return;
      }
      campRef.current = { id: nuevoId(), name: campName.trim(), message: message.trim(), segment };
      setSendClients(lista);
      setSentIds(new Set());
      setSendModal(true);
    } catch (e) {
      Alert.alert("No se pudo preparar la campaña", mensajeError(e));
    } finally {
      setSaving(false);
    }
  };

  const handleSend = async (c: Client) => {
    const camp = campRef.current;
    if (!camp) return;
    // Sin anteponer 57 a ciegas: un número de otro país abría un chat con un
    // desconocido y se marcaba "Enviado" igual (COM-06).
    const url = enlaceWhatsApp(c.phone, { texto: buildMsg(camp.message, c.name), indicativo: c.phone_country_code });
    if (!url) {
      Alert.alert("Número inválido", `El teléfono de ${c.name} (${c.phone}) no es un número válido. Corrígelo en Clientes.`);
      return;
    }
    try {
      await Linking.openURL(url);
      setSentIds(prev => new Set([...prev, c.id]));
    } catch {
      Alert.alert("No se pudo abrir WhatsApp", "Revisa que WhatsApp esté instalado en este teléfono.");
    }
  };

  const reiniciarFormulario = () => {
    setSendModal(false);
    campRef.current = null;
    setCampName(""); setMessage(DEFAULT_MSG); setSegment("all");
  };

  /** Guarda la campaña con los envíos marcados. Idempotente: mismo id en los reintentos. */
  const guardarCampana = async (): Promise<boolean> => {
    const camp = campRef.current;
    if (!camp || !tenantId) return false;
    setFinishing(true);
    try {
      const { error } = await supabase.from("wa_campaigns").insert({
        id: camp.id, tenant_id: tenantId, name: camp.name, message: camp.message,
        segment: camp.segment, status: "sent", sent_at: new Date().toISOString(),
        recipients_count: sentIds.size,
      });
      // 23505: ya se guardó en un intento anterior cuya respuesta se perdió.
      if (error && (error as { code?: string }).code !== "23505") throw new ErrorDB(error, "No se pudo guardar la campaña");
      reiniciarFormulario();
      setTab("historial");
      await recargar();
      return true;
    } catch (e) {
      Alert.alert("No se guardó la campaña", `${mensajeError(e)}\n\nTus envíos siguen marcados: toca Finalizar de nuevo.`);
      return false;
    } finally {
      setFinishing(false);
    }
  };

  const handleFinish = () => {
    if (finishing) return;
    if (sentIds.size === 0) {
      Alert.alert("Sin envíos", "No abriste ningún chat. ¿Cerrar sin guardar la campaña?", [
        { text: "Seguir enviando", style: "cancel" },
        { text: "Cerrar sin guardar", style: "destructive", onPress: () => setSendModal(false) },
      ]);
      return;
    }
    guardarCampana();
  };

  /** Cerrar el modal deslizando o con "atrás" ya no deja la campaña a medias. */
  const cerrarModal = () => {
    if (finishing) return;
    if (sentIds.size === 0) { setSendModal(false); return; }
    Alert.alert(
      "¿Salir sin finalizar?",
      `Ya abriste ${sentIds.size} chat${sentIds.size !== 1 ? "s" : ""}. ¿Guardar la campaña en el historial con esos envíos?`,
      [
        { text: "Seguir enviando", style: "cancel" },
        { text: "Descartar", style: "destructive", onPress: () => setSendModal(false) },
        { text: "Guardar", onPress: () => { guardarCampana(); } },
      ],
    );
  };

  const saveTemplate = async () => {
    if (!tmplName.trim() || !message.trim() || !tenantId || tmplSaving) return;
    setTmplSaving(true);
    const { error } = await supabase.from("wa_templates").insert({ tenant_id: tenantId, name: tmplName.trim(), message: message.trim() });
    setTmplSaving(false);
    if (error) {
      Alert.alert("No se guardó", mensajeError(error, "No se pudo guardar la plantilla"));
      return;
    }
    setTmplMode(false); setTmplName("");
    cargarListas();
  };

  const deleteTemplate = (id: string) => {
    Alert.alert("Eliminar plantilla", "¿Seguro?", [
      { text: "Cancelar", style: "cancel" },
      { text: "Eliminar", style: "destructive", onPress: async () => {
        try {
          exigirFilas(await supabase.from("wa_templates").delete().eq("id", id).select("id"), "No se pudo eliminar la plantilla");
          setTemplates(prev => prev.filter(x => x.id !== id));
        } catch (e) {
          Alert.alert("No se eliminó", mensajeError(e));
        }
      }},
    ]);
  };

  /** Solo para campañas que quedaron "En proceso" con la versión anterior. */
  const deleteCampaign = (c: Campaign) => {
    Alert.alert("Quitar del historial", `"${c.name}" no se finalizó. ¿Quitarla del historial?`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Quitar", style: "destructive", onPress: async () => {
        try {
          exigirFilas(await supabase.from("wa_campaigns").delete().eq("id", c.id).select("id"), "No se pudo quitar la campaña");
          setCampaigns(prev => prev.filter(x => x.id !== c.id));
        } catch (e) {
          Alert.alert("No se quitó", mensajeError(e));
        }
      }},
    ]);
  };

  const conectado = !!conexion?.phone_number_id?.trim();

  /** Solo cambia bot_enabled: antes se reescribía toda la fila (con token en
   *  blanco si la carga no había llegado) y se desconectaba el número (COM-04). */
  const toggleBot = async (valor: boolean) => {
    if (!tenantId || !conexion || !conectado || guardandoBot) return;
    setGuardandoBot(true);
    try {
      exigirFilas(
        await supabase.from("whatsapp_config").update({ bot_enabled: valor }).eq("tenant_id", tenantId).select("tenant_id"),
        valor ? "No se pudo activar el bot" : "No se pudo pausar el bot",
      );
      setConexion(prev => (prev ? { ...prev, bot_enabled: valor } : prev));
    } catch (e) {
      Alert.alert("No se cambió", mensajeError(e));
    } finally {
      setGuardandoBot(false);
    }
  };

  const abrirPortal = async () => {
    try {
      // Donde se conecta el número (Embedded Signup de Meta).
      await Linking.openURL(Config.urls.portalWhatsapp);
    } catch {
      Alert.alert("No se pudo abrir el navegador", "Entra a zyncra.app desde un computador.");
    }
  };

  const cambiarTab = (k: Tab) => {
    setTab(k);
    if (k === "bot" && !conexion && !cargandoConexion) cargarConexion();
  };

  const TABS: { key: Tab; label: string }[] = [
    { key: "nueva",          label: "Campaña" },
    { key: "plantillas",     label: "Plantillas" },
    { key: "historial",      label: "Historial" },
    { key: "bot",            label: "Conexión" },
  ];

  const segmentLabel: Record<string, string> = { all: "Todos", active: "Activos", inactive: "Inactivos" };
  const fecha = (iso: string) => fmtDia(diaLocalDe(iso, timezone), "corto");
  const enviables = sendClients.filter(c => !!c.e164);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader
        crumb="Marketing"
        title="Campañas WhatsApp"
        subtitle="Las conversaciones están en Chats →"
        onBack={() => router.back()}
        rightAction={{ icon: "chatbubbles-outline", label: "Ir a los chats de WhatsApp", onPress: () => router.navigate("/(admin)/inbox") }}
      />

      {/* Tabs */}
      <View style={[s.tabBar, { backgroundColor: t.bgAlt, borderBottomColor: t.border }]}>
        {TABS.map(tb => (
          <TouchableOpacity key={tb.key} style={[s.tabBtn, tab === tb.key && s.tabBtnActive]} onPress={() => cambiarTab(tb.key)} activeOpacity={0.75}
            accessibilityRole="tab" accessibilityState={{ selected: tab === tb.key }}>
            <Text style={[s.tabLabel, tab === tb.key && s.tabLabelActive]}>{tb.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── NUEVA CAMPAÑA ── */}
      {tab === "nueva" && (
        <KeyboardAvoidingView style={{ flex: 1 }}>
          <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            <Animated.View entering={FadeInDown.duration(350)}>

              {/* Name */}
              <Text style={s.label}>Nombre de la campaña *</Text>
              <TextInput style={s.input} value={campName} onChangeText={setCampName}
                placeholder="Ej: Promo julio, Clientes inactivos..." placeholderTextColor={t.subtle} maxLength={80} />

              {/* Segment */}
              <Text style={s.label}>Segmento de clientes</Text>
              {segError ? (
                <TouchableOpacity onPress={cargarConteos} style={s.inlineError} activeOpacity={0.8}>
                  <Ionicons name="alert-circle-outline" size={14} color={Colors.red} />
                  <Text style={s.inlineErrorText}>{mensajeError(segError)} Toca para reintentar.</Text>
                </TouchableOpacity>
              ) : null}
              {SEGMENT_OPTS.map(opt => {
                const activo = segment === opt.key;
                const n = conteos?.[opt.key];
                return (
                  <TouchableOpacity key={opt.key} style={[s.segCard, activo && s.segCardActive]}
                    onPress={() => setSegment(opt.key)} activeOpacity={0.75}
                    accessibilityRole="radio" accessibilityState={{ selected: activo }}>
                    <View style={[s.segIcon, { backgroundColor: activo ? Colors.red + "20" : t.chipBg }]}>
                      <Ionicons name={opt.icon} size={16} color={activo ? Colors.red : t.muted} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.segLabel, activo && { color: Colors.red }]}>{opt.label}</Text>
                      <Text style={s.segSub}>{opt.sub}</Text>
                    </View>
                    <View style={{ alignItems: "flex-end", gap: 4 }}>
                      {activo && <Ionicons name="checkmark-circle" size={18} color={Colors.red} />}
                      {countLoading && n === undefined
                        ? <ActivityIndicator size="small" color={t.muted} style={{ transform: [{ scale: 0.7 }] }} />
                        : n !== undefined && (
                          <Text style={[s.segCount, activo && { color: Colors.red }]}>
                            {n} cliente{n !== 1 ? "s" : ""}
                          </Text>
                        )}
                    </View>
                  </TouchableOpacity>
                );
              })}

              {/* Variables */}
              <Text style={s.label}>Mensaje *</Text>
              <View style={s.varRow}>
                {VARIABLES.map(v => (
                  <TouchableOpacity key={v} style={s.varChip}
                    onPress={() => setMessage(m => m + v)} activeOpacity={0.7}
                    accessibilityRole="button" accessibilityLabel={`Insertar ${v}`}>
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
                <TouchableOpacity style={s.tmplLink} onPress={() => setTmplMode(true)} accessibilityRole="button">
                  <Ionicons name="bookmark-outline" size={13} color={s.accent.color} />
                  <Text style={s.tmplLinkText}>Guardar como plantilla</Text>
                </TouchableOpacity>
              )}
              {tmplMode && (
                <View style={[s.tmplForm, Shadow.sm]}>
                  <TextInput style={[s.input, { marginBottom: 10 }]} value={tmplName} onChangeText={setTmplName}
                    placeholder="Nombre de la plantilla" placeholderTextColor={t.subtle} maxLength={80} />
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <TouchableOpacity style={[s.tmplBtn, { flex: 1, backgroundColor: t.chipBg }]} onPress={() => setTmplMode(false)}>
                      <Text style={[s.tmplBtnText, { color: t.muted }]}>Cancelar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[s.tmplBtn, { flex: 1, backgroundColor: s.accent.color }, (!tmplName.trim() || tmplSaving) && { opacity: 0.5 }]}
                      onPress={saveTemplate} disabled={!tmplName.trim() || tmplSaving}>
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
                      {buildMsg(message, "María García")}
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
                accessibilityRole="button"
                accessibilityState={{ disabled: !campName.trim() || !message.trim() || saving, busy: saving }}
              >
                <View style={s.btnInner}>
                  {saving
                    ? <ActivityIndicator color="white" />
                    : <>
                        <Ionicons name="send" size={16} color="white" />
                        <Text style={s.btnText}>Iniciar campaña</Text>
                      </>
                  }
                </View>
              </TouchableOpacity>
              <Text style={s.hint}>
                Se abre WhatsApp con el mensaje listo para cada cliente; tú lo envías desde tu teléfono.
              </Text>
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {/* ── PLANTILLAS ── */}
      {tab === "plantillas" && (
        listError && templates.length === 0 ? <ErrorState error={listError} onRetry={recargar} /> : (
        <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          {templates.length === 0 ? (
            <Animated.View entering={FadeInDown.duration(350)} style={[s.emptyCard, Shadow.sm]}>
              <Text style={{ fontSize: 32, marginBottom: 10 }}>📝</Text>
              <Text style={s.emptyTitle}>Sin plantillas</Text>
              <Text style={s.emptySub}>Guarda mensajes para reutilizarlos fácilmente</Text>
            </Animated.View>
          ) : (
            templates.map((tp, i) => (
              <Animated.View key={tp.id} entering={i < 10 ? FadeInDown.delay(i * 50).duration(300) : undefined}>
                <View style={[s.tmplCard, Shadow.sm]}>
                  <View style={s.tmplCardTop}>
                    <Text style={s.tmplCardName}>{tp.name}</Text>
                    <Text style={s.tmplCardDate}>{fecha(tp.created_at)}</Text>
                  </View>
                  <Text style={s.tmplCardMsg} numberOfLines={4}>{tp.message}</Text>
                  <View style={s.tmplCardActions}>
                    <TouchableOpacity style={s.tmplUseBtn} onPress={() => { setMessage(tp.message); setTab("nueva"); }} activeOpacity={0.75}>
                      <Ionicons name="arrow-redo-outline" size={13} color={s.accent.color} />
                      <Text style={s.tmplUseBtnText}>Usar</Text>
                    </TouchableOpacity>
                    <IconButton icon="trash-outline" label={`Eliminar plantilla ${tp.name}`} onPress={() => deleteTemplate(tp.id)} tone="plain" color={Colors.red} size={16} />
                  </View>
                </View>
              </Animated.View>
            ))
          )}
        </ScrollView>
        )
      )}

      {/* ── HISTORIAL ── */}
      {tab === "historial" && (
        listError && campaigns.length === 0 ? <ErrorState error={listError} onRetry={recargar} /> : (
        <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          {campaigns.length === 0 ? (
            <Animated.View entering={FadeInDown.duration(350)} style={[s.emptyCard, Shadow.sm]}>
              <Text style={{ fontSize: 32, marginBottom: 10 }}>📣</Text>
              <Text style={s.emptyTitle}>Sin campañas aún</Text>
              <Text style={s.emptySub}>Las campañas enviadas aparecerán aquí</Text>
            </Animated.View>
          ) : (
            campaigns.map((c, i) => {
              const finalizada = c.status === "sent";
              return (
                <Animated.View key={c.id} entering={i < 10 ? FadeInDown.delay(i * 50).duration(300) : undefined}>
                  <View style={[s.campCard, Shadow.sm]}>
                    <View style={s.campCardTop}>
                      <Text style={s.campCardName}>{c.name}</Text>
                      <View style={[s.statusBadge, { backgroundColor: finalizada ? Colors.success + "18" : "#f59e0b1c" }]}>
                        <Text style={[s.statusBadgeText, { color: finalizada ? Colors.success : "#d97706" }]}>
                          {finalizada ? "Completada" : "Sin finalizar"}
                        </Text>
                      </View>
                    </View>
                    <Text style={s.campCardMeta}>
                      {segmentLabel[c.segment] ?? c.segment} · {fecha(c.sent_at ?? c.created_at)}
                    </Text>
                    <Text style={s.campCardMsg} numberOfLines={3}>{c.message}</Text>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 10, gap: 8 }}>
                      {finalizada && c.recipients_count > 0 ? (
                        <View style={s.campRecipients}>
                          <Ionicons name="logo-whatsapp" size={12} color="#25D366" />
                          <Text style={s.campRecipientsText}>{c.recipients_count} enviados</Text>
                        </View>
                      ) : !finalizada ? (
                        <IconButton icon="trash-outline" label={`Quitar ${c.name} del historial`} onPress={() => deleteCampaign(c)} tone="plain" color={t.subtle} size={16} />
                      ) : <View />}
                      <TouchableOpacity
                        style={s.reuseBtn}
                        onPress={() => {
                          setCampName(c.name);
                          setMessage(c.message);
                          if (SEGMENTOS.includes(c.segment)) setSegment(c.segment);
                          setTab("nueva");
                        }}
                        activeOpacity={0.75}
                      >
                        <Ionicons name="refresh-outline" size={13} color={Colors.red} />
                        <Text style={s.reuseText}>Re-usar</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </Animated.View>
              );
            })
          )}
        </ScrollView>
        )
      )}

      {/* ── CONEXIÓN ── */}
      {tab === "bot" && (
        conexionError && !conexion ? <ErrorState error={conexionError} onRetry={cargarConexion} /> : (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
          <Animated.View entering={FadeInDown.duration(350)}>
            {!conexion ? (
              <ActivityIndicator color={Colors.red} style={{ marginTop: 30 }} />
            ) : (
              <>
                <View style={[s.botRow, Shadow.sm]}>
                  <View style={[s.segIcon, { backgroundColor: conectado ? "#25D36620" : t.chipBg }]}>
                    <Ionicons name={conectado ? "logo-whatsapp" : "link-outline"} size={18} color={conectado ? "#25D366" : t.muted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.botRowTitle}>{conectado ? "Número conectado" : "Sin número conectado"}</Text>
                    <Text style={s.botRowSub}>
                      {conectado
                        ? `ID del número ···${(conexion.phone_number_id ?? "").slice(-4)}`
                        : "Conéctalo para que Hanna responda y para usar los Chats."}
                    </Text>
                  </View>
                </View>

                <View style={[s.botRow, Shadow.sm, !conectado && { opacity: 0.55 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.botRowTitle}>Hanna responde en WhatsApp</Text>
                    <Text style={s.botRowSub}>
                      Agenda y contesta sola. Para atender tú un chat puntual, páusala desde Chats.
                    </Text>
                  </View>
                  {guardandoBot
                    ? <ActivityIndicator color={t.muted} />
                    : (
                      <Switch
                        value={conectado && conexion.bot_enabled}
                        onValueChange={toggleBot}
                        disabled={!conectado || guardandoBot}
                        trackColor={{ false: t.trackBg, true: Colors.success }}
                        thumbColor="white"
                        accessibilityLabel="Hanna responde en WhatsApp"
                      />
                    )}
                </View>

                <View style={s.infoBox}>
                  <Ionicons name="shield-checkmark-outline" size={16} color={t.muted} />
                  <Text style={s.infoText}>
                    La conexión del número con Meta se hace desde el portal web de Zyncra (zyncra.app), en Marketing → WhatsApp.
                    Por seguridad, las credenciales del número no se muestran ni se editan en la app.
                  </Text>
                </View>
                {/* iOS: sin enlaces al portal (3.1.1); allí también está la
                    suscripción. En Android se puede abrir directo. */}
                {Platform.OS === "android" && (
                  <TouchableOpacity style={s.portalBtn} onPress={abrirPortal} activeOpacity={0.8}>
                    <Ionicons name="open-outline" size={15} color={t.ink} />
                    <Text style={s.portalBtnText}>{conectado ? "Administrar en el portal" : "Conectar en el portal"}</Text>
                  </TouchableOpacity>
                )}
                {cargandoConexion && <ActivityIndicator color={t.muted} style={{ marginTop: 16 }} />}
              </>
            )}
          </Animated.View>
        </ScrollView>
        )
      )}

      {/* ── SEND MODAL ── */}
      <Modal visible={sendModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={cerrarModal}>
        <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
          <View style={s.modalHeader}>
            <View style={{ flex: 1 }}>
              <Text style={s.modalTitle}>Enviar mensajes</Text>
              <Text style={s.modalSub}>{sentIds.size} / {sendClients.length} enviados</Text>
            </View>
            <IconButton icon="close" label="Cerrar" onPress={cerrarModal} />
          </View>

          {/* Progress bar */}
          <View style={s.progressWrap}>
            <View style={[s.progressBar, { width: `${sendClients.length > 0 ? (sentIds.size / sendClients.length) * 100 : 0}%` }]} />
          </View>

          <FlatList
            data={sendClients}
            keyExtractor={c => c.id}
            contentContainerStyle={{ padding: 16, gap: 10 }}
            renderItem={({ item: c }) => {
              const sent = sentIds.has(c.id);
              const valido = !!c.e164;
              return (
                <View style={[s.clientRow, Shadow.sm]}>
                  <View style={s.clientAvatar}>
                    <Text style={s.clientAvatarText}>{(c.name?.[0] ?? "?").toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.clientName}>{c.name}</Text>
                    <Text style={[s.clientPhone, !valido && { color: Colors.red }]}>
                      {valido ? fmtTelefono(c.phone, { indicativo: c.phone_country_code }) : `${c.phone} · número inválido`}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[s.sendBtn, sent && { backgroundColor: Colors.success }, !valido && { backgroundColor: t.chipBg }]}
                    onPress={() => handleSend(c)}
                    activeOpacity={0.75}
                    accessibilityRole="button"
                    accessibilityLabel={sent ? `Enviado a ${c.name}` : `Enviar a ${c.name}`}
                  >
                    <Ionicons name={sent ? "checkmark" : valido ? "logo-whatsapp" : "alert-circle-outline"} size={14} color={valido ? "white" : t.muted} />
                    <Text style={[s.sendBtnText, !valido && { color: t.muted }]}>{sent ? "Enviado" : valido ? "Enviar" : "Revisar"}</Text>
                  </TouchableOpacity>
                </View>
              );
            }}
          />

          <View style={s.modalFooter}>
            {sentIds.size < enviables.length && (
              <TouchableOpacity
                style={[s.finishBtn, { backgroundColor: t.chipBg, marginBottom: 10 }]}
                onPress={() => setSentIds(new Set(enviables.map(c => c.id)))}
                activeOpacity={0.8}
              >
                <Text style={[s.finishBtnText, { color: t.ink }]}>
                  Marcar todos como enviados
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[s.finishBtn, finishing && { opacity: 0.6 }]} onPress={handleFinish} disabled={finishing} activeOpacity={0.85}>
              {finishing ? <ActivityIndicator color="white" /> : (
                <Text style={s.finishBtnText}>
                  {sentIds.size === sendClients.length ? "Finalizar campaña" : `Finalizar (${sentIds.size} enviados)`}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

// Estilos con los tokens del tema: con Colors.white/text fijos, las tarjetas
// quedaban blancas con texto oscuro sobre el fondo del modo oscuro.
function crearEstilos(t: ThemeColors) {
  // El morado de Colors.purple es el mismo azul de marca (#0027fe), que casi
  // desaparece sobre la card oscura: se usa un violeta legible en ambos temas.
  const accent = "#7c5cff";
  return StyleSheet.create({
    accent:       { color: accent },
    tabBar:       { flexDirection: "row", borderBottomWidth: 1 },
    tabBtn:       { flex: 1, paddingVertical: 13, alignItems: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
    tabBtnActive: { borderBottomColor: Colors.red },
    tabLabel:     { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: t.muted },
    tabLabelActive:{ fontSize: 12, fontFamily: "SpaceGrotesk_700Bold", color: Colors.red },

    label:        { fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", color: t.muted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8, marginTop: 18 },
    input:        { backgroundColor: t.inputBg, borderWidth: 1.5, borderColor: t.inputBorder, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, fontFamily: "SpaceGrotesk_400Regular", color: t.text },
    hint:         { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: t.subtle, textAlign: "center", marginTop: 12, lineHeight: 17 },
    inlineError:  { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: Colors.red + "12", borderRadius: Radius.md, padding: 10, marginBottom: 8 },
    inlineErrorText: { flex: 1, fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: t.text },

    segCard:      { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: t.cardSolid, borderRadius: Radius.md, padding: 14, marginBottom: 8, borderWidth: 1.5, borderColor: t.line },
    segCardActive:{ borderColor: Colors.red },
    segIcon:      { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
    segLabel:     { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: t.text },
    segSub:       { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", color: t.muted, marginTop: 2 },
    segCount:     { fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", color: t.muted },

    varRow:       { flexDirection: "row", gap: 8, marginBottom: 10 },
    varChip:      { backgroundColor: accent + "1f", borderRadius: Radius.full, paddingHorizontal: 12, paddingVertical: 6 },
    varChipText:  { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: accent },

    textAreaWrap: { backgroundColor: t.inputBg, borderWidth: 1.5, borderColor: t.inputBorder, borderRadius: Radius.md },
    textArea:     { padding: 14, fontSize: 14, fontFamily: "SpaceGrotesk_400Regular", color: t.text, minHeight: 140 },
    charCount:    { fontSize: 11, color: t.subtle, fontFamily: "SpaceGrotesk_400Regular", textAlign: "right", paddingHorizontal: 14, paddingBottom: 10 },

    tmplLink:     { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10, alignSelf: "flex-start" },
    tmplLinkText: { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: accent },
    tmplForm:     { backgroundColor: t.cardSolid, borderRadius: Radius.md, padding: 14, marginTop: 10, borderWidth: 1, borderColor: t.line },
    tmplBtn:      { borderRadius: Radius.md, paddingVertical: 11, alignItems: "center" },
    tmplBtnText:  { fontSize: 13, fontFamily: "SpaceGrotesk_700Bold", color: "white" },

    // La vista previa imita a WhatsApp (claro) a propósito, en ambos temas.
    preview:      { backgroundColor: t.cardSolid, borderRadius: Radius.lg, overflow: "hidden", marginTop: 4 },
    previewHeader:{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, backgroundColor: "#075e54" },
    waBubbleAva:  { width: 32, height: 32, borderRadius: 16, backgroundColor: "#25d366", alignItems: "center", justifyContent: "center" },
    waBubbleName: { fontSize: 13, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
    waBubbleStatus:{ fontSize: 11, color: "rgba(255,255,255,.7)", fontFamily: "SpaceGrotesk_400Regular" },
    waBg:         { backgroundColor: "#ece5dd", padding: 14 },
    waBubble:     { backgroundColor: "white", borderRadius: Radius.md, borderTopLeftRadius: 4, padding: 12, maxWidth: "88%", alignSelf: "flex-start" },
    waBubbleText: { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: "#111", lineHeight: 19 },
    waBubbleTime: { fontSize: 10, color: "#667781", textAlign: "right", marginTop: 4 },

    btn:          { borderRadius: Radius.full, overflow: "hidden", marginTop: 24 },
    btnInner:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 16, backgroundColor: Colors.red },
    btnText:      { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: "white" },

    emptyCard:    { backgroundColor: t.cardSolid, borderRadius: Radius.xl, padding: 48, alignItems: "center", marginTop: 20, borderWidth: 1, borderColor: t.line },
    emptyTitle:   { fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", color: t.text, marginBottom: 6 },
    emptySub:     { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: t.muted, textAlign: "center" },

    tmplCard:     { backgroundColor: t.cardSolid, borderRadius: Radius.lg, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: t.line },
    tmplCardTop:  { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8 },
    tmplCardName: { flex: 1, fontSize: 14, fontFamily: "SpaceGrotesk_700Bold", color: t.text },
    tmplCardDate: { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", color: t.subtle },
    tmplCardMsg:  { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: t.muted, lineHeight: 18, marginBottom: 12 },
    tmplCardActions:{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    tmplUseBtn:   { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: accent + "1f", borderRadius: Radius.full, paddingHorizontal: 12, paddingVertical: 7 },
    tmplUseBtnText:{ fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: accent },

    campCard:     { backgroundColor: t.cardSolid, borderRadius: Radius.lg, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: t.line },
    campCardTop:  { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
    campCardName: { fontSize: 14, fontFamily: "SpaceGrotesk_700Bold", color: t.text, flex: 1, marginRight: 8 },
    campCardMeta: { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", color: t.subtle, marginBottom: 8 },
    campCardMsg:  { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: t.muted, lineHeight: 18 },
    campRecipients:{ flexDirection: "row", alignItems: "center", gap: 5 },
    campRecipientsText:{ fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: "#25D366" },
    statusBadge:  { borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 4 },
    statusBadgeText:{ fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold" },
    reuseBtn:     { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: Colors.red + "14", borderRadius: Radius.full, paddingHorizontal: 12, paddingVertical: 6 },
    reuseText:    { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.red },

    // Conexión
    botRow:       { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: t.cardSolid, borderRadius: Radius.md, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: t.line },
    botRowTitle:  { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: t.text },
    botRowSub:    { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: t.muted, marginTop: 2, lineHeight: 17 },
    infoBox:      { flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: t.chipBg, borderRadius: Radius.md, padding: 14, marginTop: 6 },
    infoText:     { flex: 1, fontSize: 12.5, fontFamily: "SpaceGrotesk_400Regular", color: t.muted, lineHeight: 18 },
    portalBtn:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1.5, borderColor: t.lineStrong, borderRadius: Radius.full, paddingVertical: 13, marginTop: 14 },
    portalBtnText:{ fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: t.ink },

    // Send modal
    modalHeader:  { flexDirection: "row", alignItems: "center", gap: 12, padding: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: t.line },
    modalTitle:   { fontSize: 18, fontFamily: "SpaceGrotesk_700Bold", color: t.text },
    modalSub:     { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: t.muted, marginTop: 4 },
    progressWrap: { height: 4, backgroundColor: t.trackBg },
    progressBar:  { height: 4, backgroundColor: Colors.success },
    clientRow:    { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: t.cardSolid, borderRadius: Radius.md, padding: 12, borderWidth: 1, borderColor: t.line },
    clientAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.red + "18", alignItems: "center", justifyContent: "center" },
    clientAvatarText:{ fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", color: Colors.red },
    clientName:   { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: t.text },
    clientPhone:  { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: t.muted, marginTop: 2 },
    sendBtn:      { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#25D366", borderRadius: Radius.md, paddingHorizontal: 12, paddingVertical: 8 },
    sendBtnText:  { fontSize: 12, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
    modalFooter:  { padding: 20, paddingBottom: 34, borderTopWidth: 1, borderTopColor: t.line },
    finishBtn:    { backgroundColor: Colors.red, borderRadius: Radius.full, paddingVertical: 16, alignItems: "center" },
    finishBtnText:{ fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
  });
}
