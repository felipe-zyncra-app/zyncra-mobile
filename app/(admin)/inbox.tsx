import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, TextInput,
  Modal, ActivityIndicator, RefreshControl, KeyboardAvoidingView,
  Platform, Alert, AppState,
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
import { useTenant } from "@/lib/tenant";
import Avatar from "@/components/Avatar";
import ErrorState from "@/components/ErrorState";
import { ScreenHeader } from "@/components/ui";
import { exigirFilas, mensajeError, nuevoId, revisar, traerTodo } from "@/lib/db";
import { useRecarga, useGuardRespuestas } from "@/lib/useRecarga";
import { diaLocalDe, horaLocalDe, hoyNegocio, sumarDias, fmtDia } from "@/lib/tz";
import { fmt12, fmtTelefono } from "@/lib/format";
import {
  COLUMNAS_CHAT, COLUMNAS_MENSAJE, filtroNombreTelefono, fusionarChats, fusionarMensajes,
  masReciente, ultimoConfirmado, ventanaAbierta,
  type ChatResumen, type EstadoMensaje, type MensajeChat,
} from "@/lib/mensajeria";

/**
 * Bandeja de chats de WhatsApp — espejo de /admin/inbox del panel web.
 * El número conectado a la API deja de funcionar en WhatsApp Business,
 * así que el negocio ve y contesta desde aquí. Hanna responde sola y el
 * humano puede pausarla por chat para tomar la conversación.
 *
 * Datos: Realtime (las tablas ya están en la publicación) y, de respaldo, un
 * sondeo INCREMENTAL por fecha que se pausa en segundo plano. Antes se bajaban
 * los 500 mensajes más VIEJOS cada 5 s y la lista completa cada 10 s, así que
 * en un chat largo lo nuevo nunca aparecía (ARQ-15, COM-09, CAL-15, COM-13).
 */

const HANNA = "#a855f7";
const WA_GREEN = "#25D366";
const MENSAJES_INICIALES = 200;
const MENSAJES_POR_PAGINA = 100;
const CHATS_POR_PAGINA = 50;
const SONDEO_CHAT_MS = 30_000;
const SONDEO_LISTA_MS = 60_000;

// La conversación imita a WhatsApp, en claro y en oscuro.
const WA = {
  light: {
    bg: "#efeae2", inBubble: "#ffffff", outHuman: "#d9fdd3", outHanna: "#f3e8ff", text: "#111b21", time: "#667781",
    bar: "#f0f2f5", input: "#ffffff", inputText: "#14111C", pill: "rgba(255,255,255,0.92)", pillText: "#54656f",
    authorHuman: "#1da851", warnBg: "rgba(245,158,11,0.14)", warnText: "#b45309", line: "rgba(20,15,30,0.07)",
  },
  dark: {
    bg: "#0b141a", inBubble: "#202c33", outHuman: "#005c4b", outHanna: "#3b2a55", text: "#e9edef", time: "#8696a0",
    bar: "#1f2c34", input: "#2a3942", inputText: "#e9edef", pill: "#182229", pillText: "#8696a0",
    authorHuman: "#25D366", warnBg: "rgba(245,158,11,0.16)", warnText: "#fbbf24", line: "rgba(255,255,255,0.07)",
  },
} as const;

/** Hora del negocio ("9:30 AM"). */
function hora(iso: string, tz: string) {
  return fmt12(horaLocalDe(iso, tz));
}

/** "Hoy", "Ayer" o "26 sep", con el día del negocio (no el del teléfono). */
function etiquetaDia(iso: string, tz: string) {
  const dia = diaLocalDe(iso, tz);
  const hoy = hoyNegocio(tz);
  if (dia === hoy) return "Hoy";
  if (dia === sumarDias(hoy, -1)) return "Ayer";
  return dia.slice(0, 4) === hoy.slice(0, 4) ? fmtDia(dia, "dia-mes") : fmtDia(dia, "corto");
}

function horaLista(iso: string, tz: string) {
  const dia = diaLocalDe(iso, tz);
  const hoy = hoyNegocio(tz);
  if (dia === hoy) return hora(iso, tz);
  if (dia === sumarDias(hoy, -1)) return "Ayer";
  return fmtDia(dia, "dia-mes");
}

function esTimeout(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as { name?: string }).name === "TimeoutError";
}

/**
 * setInterval que se pausa con la app en segundo plano (en Android los
 * timers seguían corriendo y gastando datos). Si `alVolver`, corre una vez al
 * volver a primer plano para ponerse al día.
 */
function useIntervaloActivo(fn: () => void, ms: number, activo: boolean, alVolver: boolean) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!activo) return;
    let id: ReturnType<typeof setInterval> | null = null;
    const iniciar = () => { if (!id) id = setInterval(() => ref.current(), ms); };
    const parar = () => { if (id) { clearInterval(id); id = null; } };
    if (AppState.currentState === "active") iniciar();
    const sub = AppState.addEventListener("change", st => {
      if (st === "active") {
        if (alVolver) ref.current();
        iniciar();
      } else {
        parar();
      }
    });
    return () => { parar(); sub.remove(); };
  }, [ms, activo, alVolver]);
}

type SuscribirMensajes = (fn: (m: MensajeChat) => void) => () => void;

/** "Chulitos" del mensaje saliente, como en WhatsApp y en el panel web. */
function Ticks({ status, color }: { status?: EstadoMensaje | null; color: string }) {
  if (status === "sending") return <Ionicons name="time-outline" size={12} color={color} accessibilityLabel="Enviando" />;
  if (status === "failed") return <Ionicons name="alert-circle" size={13} color="#ef4444" accessibilityLabel="No se entregó" />;
  if (status === "read") return <Ionicons name="checkmark-done" size={14} color="#53bdeb" accessibilityLabel="Leído" />;
  if (status === "delivered") return <Ionicons name="checkmark-done" size={14} color={color} accessibilityLabel="Entregado" />;
  if (status === "sent") return <Ionicons name="checkmark" size={14} color={color} accessibilityLabel="Enviado" />;
  return null; // mensajes viejos, de antes de que se guardara el estado
}

/* ─── Conversación (full screen) ─────────────────────────────────────── */

function ChatModal({ chat, tenantId, timezone, onClose, onChanged, suscribirMensajes }: {
  chat: ChatResumen;
  tenantId: string;
  timezone: string;
  onClose: () => void;
  onChanged: () => void;
  suscribirMensajes: SuscribirMensajes;
}) {
  const { mode } = useTheme();
  const wa = WA[mode];
  const insets = useSafeAreaInsets();
  const guardCarga = useGuardRespuestas();
  const guardSondeo = useGuardRespuestas();
  const phone = chat.phone;

  const [messages, setMessages] = useState<MensajeChat[]>([]);
  const mensajesRef = useRef<MensajeChat[]>([]);
  mensajesRef.current = messages;
  const [cargando, setCargando] = useState(true);
  const [errorInicial, setErrorInicial] = useState<unknown>(null);
  const [sinConexion, setSinConexion] = useState(false);
  const [hayMasViejos, setHayMasViejos] = useState(false);
  const [cargandoViejos, setCargandoViejos] = useState(false);
  const [ultimoIn, setUltimoIn] = useState<string | null>(null);
  const [ahora, setAhora] = useState(() => Date.now());
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [botPaused, setBotPaused] = useState(chat.bot_paused);
  const [guardandoBot, setGuardandoBot] = useState(false);
  const cambiandoBot = useRef(false);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  // El padre pasa el chat vigente (Realtime o sondeo): si otro teléfono o el
  // web pausó a Hanna, se refleja aquí en vez de fiarse del valor al abrir.
  useEffect(() => {
    if (!cambiandoBot.current) setBotPaused(chat.bot_paused);
  }, [chat.bot_paused]);

  const marcarLeido = useCallback(async () => {
    const { error } = await supabase.from("wa_chats").update({ unread: 0 })
      .eq("tenant_id", tenantId).eq("phone", phone).gt("unread", 0);
    // Si falla, el contador solo queda alto hasta la próxima apertura: no
    // vale la pena interrumpir la conversación con un aviso.
    if (!error) onChangedRef.current();
  }, [tenantId, phone]);

  // El servidor guarda el mensaje y DESPUÉS sube el contador (wa_chat_touch):
  // si se marcaba leído al recibir el mensaje, el +1 llegaba luego y el chat
  // abierto quedaba con "1 sin leer". Con el chat en pantalla, lo que sume ya
  // está leído (igual que el panel web).
  useEffect(() => {
    if (chat.unread > 0) marcarLeido();
  }, [chat.unread, marcarLeido]);

  const recibir = useCallback((nuevos: MensajeChat[]) => {
    if (nuevos.length === 0) return;
    const conocidos = new Set(mensajesRef.current.map(m => m.id));
    setMessages(prev => fusionarMensajes(prev, nuevos));
    const entrantes = nuevos.filter(m => m.direction === "in");
    if (entrantes.length > 0) {
      setUltimoIn(prev => entrantes.reduce<string | null>((acc, m) => masReciente(acc, m.created_at), prev));
      // El sondeo siempre repite el último mensaje confirmado (gte): marcar
      // leído solo si entró algo NUEVO, o cada 30 s se disparaban un update y
      // el recuento de no leídos sin que nada hubiera cambiado.
      if (entrantes.some(m => !conocidos.has(m.id))) marcarLeido();
    }
  }, [marcarLeido]);

  const cargarInicial = useCallback(async () => {
    const turno = guardCarga.nuevo();
    try {
      const [msgsRes, inRes] = await Promise.all([
        // Los MÁS RECIENTES primero y luego se invierten en memoria.
        supabase.from("wa_chat_messages").select(COLUMNAS_MENSAJE)
          .eq("tenant_id", tenantId).eq("phone", phone)
          .order("created_at", { ascending: false }).order("id", { ascending: false })
          .limit(MENSAJES_INICIALES),
        // La ventana de 24 h depende del último mensaje DEL CLIENTE, que puede
        // no estar entre los últimos 200 si Hanna respondió mucho.
        supabase.from("wa_chat_messages").select("created_at")
          .eq("tenant_id", tenantId).eq("phone", phone).eq("direction", "in")
          .order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      const filas = (revisar(msgsRes, "No se pudo cargar la conversación") ?? []) as MensajeChat[];
      const ultimo = revisar(inRes, "No se pudo cargar la conversación") as { created_at: string } | null;
      if (!turno.vigente()) return;
      setMessages(prev => fusionarMensajes(prev, filas.slice().reverse()));
      setHayMasViejos(filas.length === MENSAJES_INICIALES);
      setUltimoIn(prev => masReciente(prev, ultimo?.created_at));
      setErrorInicial(null);
      setSinConexion(false);
    } catch (e) {
      if (!turno.vigente()) return;
      // Con mensajes en pantalla se conservan: vaciar el chat por un corte de
      // red mostraba "Sin mensajes" y bloqueaba el input (COM-19).
      if (mensajesRef.current.length === 0) setErrorInicial(e);
      else setSinConexion(true);
    } finally {
      if (turno.vigente()) setCargando(false);
    }
  }, [tenantId, phone, guardCarga]);

  /** Respaldo de Realtime: solo lo que llegó desde el último mensaje confirmado. */
  const sondear = useCallback(async () => {
    const desde = ultimoConfirmado(mensajesRef.current);
    if (!desde) { await cargarInicial(); return; }
    const turno = guardSondeo.nuevo();
    try {
      const [nuevosRes, chatRes] = await Promise.all([
        supabase.from("wa_chat_messages").select(COLUMNAS_MENSAJE)
          .eq("tenant_id", tenantId).eq("phone", phone)
          .gte("created_at", desde)
          .order("created_at", { ascending: true }).order("id")
          .limit(MENSAJES_POR_PAGINA),
        // bot_paused se relee del servidor en cada sondeo (COM-17).
        supabase.from("wa_chats").select("bot_paused").eq("tenant_id", tenantId).eq("phone", phone).maybeSingle(),
      ]);
      const nuevos = (revisar(nuevosRes, "No se pudo actualizar la conversación") ?? []) as MensajeChat[];
      const estado = revisar(chatRes, "No se pudo actualizar la conversación") as { bot_paused: boolean } | null;
      if (!turno.vigente()) return;
      recibir(nuevos);
      if (estado && !cambiandoBot.current) setBotPaused(estado.bot_paused);
      setSinConexion(false);
    } catch {
      if (turno.vigente()) setSinConexion(true);
    }
  }, [tenantId, phone, guardSondeo, cargarInicial, recibir]);

  // Al abrir: carga y marca como leído.
  useEffect(() => {
    cargarInicial();
    marcarLeido();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime (lo reparte la pantalla de la lista, que tiene el canal).
  useEffect(() => suscribirMensajes(m => { if (m.phone === phone) recibir([m]); }), [suscribirMensajes, phone, recibir]);

  useIntervaloActivo(sondear, SONDEO_CHAT_MS, true, true);

  // La ventana de 24 h se vence sola: se revisa cada minuto.
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const abierta = ventanaAbierta(ultimoIn, ahora);

  const cargarViejos = async () => {
    const primero = mensajesRef.current[0];
    if (cargandoViejos || !hayMasViejos || !primero) return;
    setCargandoViejos(true);
    try {
      const filas = (revisar(
        await supabase.from("wa_chat_messages").select(COLUMNAS_MENSAJE)
          .eq("tenant_id", tenantId).eq("phone", phone)
          .lte("created_at", primero.created_at)
          .order("created_at", { ascending: false }).order("id", { ascending: false })
          .limit(MENSAJES_POR_PAGINA),
        "No se pudieron cargar los mensajes anteriores",
      ) ?? []) as MensajeChat[];
      setMessages(prev => fusionarMensajes(prev, filas));
      setHayMasViejos(filas.length === MENSAJES_POR_PAGINA);
    } catch {
      setSinConexion(true);
    } finally {
      setCargandoViejos(false);
    }
  };

  const toggleBot = async () => {
    if (guardandoBot) return;
    const next = !botPaused;
    cambiandoBot.current = true;
    setGuardandoBot(true);
    setBotPaused(next);
    try {
      // Sin revisar el error, la UI decía "Atendiendo tú" mientras Hanna
      // seguía respondiendo al cliente (COM-17).
      exigirFilas(
        await supabase.from("wa_chats").update({ bot_paused: next })
          .eq("tenant_id", tenantId).eq("phone", phone).select("phone"),
        next ? "No se pudo pausar a Hanna" : "No se pudo reactivar a Hanna",
      );
      onChangedRef.current();
    } catch (e) {
      setBotPaused(!next);
      Alert.alert("No se cambió", mensajeError(e));
    } finally {
      cambiandoBot.current = false;
      setGuardandoBot(false);
    }
  };

  // Envío que quedó en duda (tope vencido o corte de red): pudo llegar a
  // WhatsApp aunque la app no supo. Si se reenvía el mismo texto se reusa su
  // id y el servidor lo reconoce en vez de mandarlo dos veces.
  const enDuda = useRef<{ text: string; id: string } | null>(null);

  const enviar = async (text: string, idReintento?: string): Promise<boolean> => {
    const id = idReintento ?? (enDuda.current?.text === text ? enDuda.current.id : nuevoId());
    setSending(true);
    try {
      const res = await authedFetch(Config.api.whatsappSend, {
        method: "POST",
        timeoutMs: Config.timeouts.chat,
        body: JSON.stringify({ tenant_id: tenantId, phone, text, client_msg_id: id }),
      });
      const json = await res.json().catch(() => ({}));
      // El servidor respondió: el resultado ya no está en duda.
      enDuda.current = null;
      if (!res.ok) {
        Alert.alert("No se pudo enviar", typeof json.error === "string" ? json.error : "Inténtalo de nuevo.");
        return false;
      }
      const guardado = json?.message as MensajeChat | undefined;
      if (guardado && typeof guardado.id === "string") recibir([guardado]);
      else await sondear();
      onChangedRef.current();
      return true;
    } catch (e) {
      if (!idReintento) enDuda.current = { text, id };
      if (esTimeout(e)) {
        Alert.alert("Sin respuesta del servidor", "Puede que el mensaje sí se haya enviado. Si lo envías otra vez, no le llegará repetido.");
        sondear();
      } else {
        Alert.alert("No se pudo enviar", mensajeError(e));
      }
      return false;
    } finally {
      setSending(false);
    }
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || sending || !abierta) return;
    if (await enviar(text)) setDraft("");
  };

  // Mensaje que WhatsApp no entregó: se reenvía con su id como client_msg_id,
  // igual que "Reintentar" en el panel web.
  const reintentar = (m: MensajeChat) => {
    if (sending || !abierta) return;
    enviar(m.body, m.id);
  };

  // "Hanna también está respondiendo" (como en el panel): al escribir con
  // Hanna activa, el cliente recibe las dos respuestas.
  const pausarYResponder = () => { if (!botPaused) toggleBot(); };

  const title = chat.client_name || fmtTelefono(`+${phone}`);
  // Lista invertida: el más nuevo abajo sin tener que desplazar a mano, y
  // sin saltar al final cada vez que llega algo mientras se lee el historial.
  // Un fallido ya reenviado se oculta: el reenvío trae su id como client_msg_id.
  const invertidos = useMemo(() => {
    const reenviados = new Set(messages.map(m => m.client_msg_id).filter((x): x is string => !!x));
    return messages.filter(m => !(m.status === "failed" && reenviados.has(m.id))).reverse();
  }, [messages]);

  const renderMsg = ({ item, index }: { item: MensajeChat; index: number }) => {
    const isOut = item.direction === "out";
    const fallo = item.status === "failed";
    const anterior = invertidos[index + 1];
    const dia = etiquetaDia(item.created_at, timezone);
    const diaAnterior = anterior ? etiquetaDia(anterior.created_at, timezone) : null;
    return (
      <View>
        {dia !== diaAnterior && (
          <View style={{ alignItems: "center", marginVertical: 10 }}>
            <View style={[c.dayPill, { backgroundColor: wa.pill }]}>
              <Text style={[c.dayText, { color: wa.pillText }]}>{dia}</Text>
            </View>
          </View>
        )}
        <View style={{ flexDirection: "row", justifyContent: isOut ? "flex-end" : "flex-start", marginBottom: 6 }}>
          <View style={[
            c.bubble,
            isOut
              ? { backgroundColor: item.sender === "hanna" ? wa.outHanna : wa.outHuman, borderTopRightRadius: 3 }
              : { backgroundColor: wa.inBubble, borderTopLeftRadius: 3 },
            fallo && { borderWidth: 1, borderColor: "#ef4444" },
          ]}>
            {isOut && (
              <Text style={[c.author, { color: item.sender === "hanna" ? HANNA : wa.authorHuman }]}>
                {item.sender === "hanna" ? "✨ Hanna" : (item.sender_name || "Tú")}
              </Text>
            )}
            <Text style={[c.body, { color: wa.text }]} selectable>{item.body}</Text>
            <View style={c.metaRow}>
              <Text style={[c.time, { color: wa.time }]}>{hora(item.created_at, timezone)}</Text>
              {isOut && <Ticks status={item.status} color={wa.time} />}
            </View>
            {/* WhatsApp no entregó (p. ej. el cliente bloqueó el número): sin
                esto la burbuja parecía enviada (COM-23). */}
            {fallo && (
              <Text style={c.failText}>{item.error || "WhatsApp no entregó este mensaje."}</Text>
            )}
            {fallo && item.sender === "human" && abierta && (
              <TouchableOpacity onPress={() => reintentar(item)} disabled={sending} style={c.retryBtn}
                accessibilityRole="button" accessibilityLabel="Reintentar el envío">
                <Text style={c.retryText}>Reintentar</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    );
  };

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: wa.bg }}>
        {/* Header */}
        <LinearGradient colors={Gradients.ink} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={[c.header, { paddingTop: insets.top + 10 }]}>
          <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3 }} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <TouchableOpacity onPress={onClose} style={c.iconBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel="Volver">
              <Ionicons name="arrow-back" size={20} color="white" />
            </TouchableOpacity>
            <Avatar name={chat.client_name || "?"} size={38} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={c.title} numberOfLines={1}>{title}</Text>
              <Text style={c.subtitle}>{fmtTelefono(`+${phone}`)}</Text>
            </View>
          </View>

          {/* Toggle Hanna */}
          <TouchableOpacity onPress={toggleBot} activeOpacity={0.8} disabled={guardandoBot}
            accessibilityRole="button" accessibilityState={{ busy: guardandoBot }}
            style={[c.botToggle, {
              backgroundColor: botPaused ? "rgba(245,158,11,0.18)" : "rgba(168,85,247,0.20)",
              borderColor: botPaused ? "rgba(245,158,11,0.45)" : "rgba(168,85,247,0.5)",
            }]}>
            {guardandoBot
              ? <ActivityIndicator size="small" color={botPaused ? "#fbbf24" : "#d8b4fe"} />
              : <View style={[c.dot, { backgroundColor: botPaused ? "#f59e0b" : HANNA }]} />}
            <Text style={[c.botText, { color: botPaused ? "#fbbf24" : "#d8b4fe" }]}>
              {botPaused ? "Atendiendo tú · toca para reactivar a Hanna" : "Hanna responde · toca para atender tú"}
            </Text>
          </TouchableOpacity>
        </LinearGradient>

        {sinConexion && (
          <TouchableOpacity onPress={sondear} activeOpacity={0.8} style={[c.offline, { backgroundColor: wa.warnBg }]}>
            <Ionicons name="cloud-offline-outline" size={13} color={wa.warnText} />
            <Text style={[c.offlineText, { color: wa.warnText }]}>Sin conexión: lo que ves puede no estar al día. Toca para reintentar.</Text>
          </TouchableOpacity>
        )}

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          {cargando && messages.length === 0 ? (
            <ActivityIndicator color={Colors.red} style={{ marginTop: 40 }} />
          ) : errorInicial && messages.length === 0 ? (
            <ErrorState error={errorInicial} onRetry={cargarInicial} />
          ) : (
            <FlatList
              inverted
              data={invertidos}
              keyExtractor={m => m.id}
              renderItem={renderMsg}
              contentContainerStyle={{ padding: 14, paddingTop: 20 }}
              onEndReached={cargarViejos}
              onEndReachedThreshold={0.3}
              ListFooterComponent={cargandoViejos ? <ActivityIndicator color={wa.time} style={{ marginVertical: 12 }} /> : null}
              ListEmptyComponent={
                <Text style={[c.empty, { color: wa.time }]}>Sin mensajes todavía.</Text>
              }
            />
          )}

          {/* Caja de envío */}
          <View style={[c.inputBar, { paddingBottom: Math.max(insets.bottom, 10), backgroundColor: wa.bar, borderTopColor: wa.line }]}>
            {!abierta && !cargando && (
              <Text style={[c.windowWarn, { backgroundColor: wa.warnBg, color: wa.warnText }]}>
                Fuera de la ventana de 24h de WhatsApp: podrás responder cuando el cliente vuelva a escribir.
              </Text>
            )}
            <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
              <TextInput
                style={[c.input, { backgroundColor: wa.input, color: wa.inputText }, !abierta && { opacity: 0.55 }]}
                value={draft}
                onChangeText={setDraft}
                placeholder={abierta ? "Escribe un mensaje…" : "Ventana de 24h cerrada"}
                placeholderTextColor={wa.time}
                editable={abierta && !sending}
                multiline
                maxLength={4000}
              />
              <TouchableOpacity
                onPress={send}
                disabled={!abierta || sending || !draft.trim()}
                style={[c.sendBtn, (!abierta || !draft.trim()) && { opacity: 0.5 }]}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Enviar mensaje"
                accessibilityState={{ disabled: !abierta || sending || !draft.trim(), busy: sending }}
              >
                {sending
                  ? <ActivityIndicator size="small" color="white" />
                  : <Ionicons name="send" size={18} color="white" />}
              </TouchableOpacity>
            </View>
            {!botPaused && abierta && draft.trim().length > 0 && (
              <View style={c.hannaWarn}>
                <View style={[c.dot, { backgroundColor: HANNA }]} />
                <Text style={[c.hannaWarnText, { color: mode === "dark" ? "#d8b4fe" : "#7c3aed" }]}>
                  Hanna también está respondiendo este chat.
                </Text>
                <TouchableOpacity onPress={pausarYResponder} disabled={guardandoBot} hitSlop={6}
                  style={c.hannaWarnBtn} accessibilityRole="button" accessibilityLabel="Pausar a Hanna y responder yo">
                  <Text style={[c.hannaWarnBtnText, { color: mode === "dark" ? "#d8b4fe" : "#7c3aed" }]}>Pausar y responder yo</Text>
                </TouchableOpacity>
              </View>
            )}
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
  const { timezone, ready } = useTenant();
  const guard = useGuardRespuestas();
  const guardBusqueda = useGuardRespuestas();

  const [chats, setChats] = useState<ChatResumen[]>([]);
  const chatsRef = useRef<ChatResumen[]>([]);
  chatsRef.current = chats;
  const [total, setTotal] = useState<number | null>(null);
  const [totalUnread, setTotalUnread] = useState(0);
  const [hayMas, setHayMas] = useState(false);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [sinConexion, setSinConexion] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [resultados, setResultados] = useState<ChatResumen[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [abierto, setAbierto] = useState<ChatResumen | null>(null);
  const oyentes = useRef(new Set<(m: MensajeChat) => void>());

  /** Total sin leer de TODOS los chats, no solo de los cargados (COM-16). */
  const contarNoLeidos = useCallback(async () => {
    if (!tenantId) return;
    try {
      const filas = await traerTodo<{ unread: number | null }>((d, h) =>
        supabase.from("wa_chats").select("unread").eq("tenant_id", tenantId).gt("unread", 0)
          .order("phone").range(d, h),
      { contexto: "No se pudo contar los chats sin leer", tope: 5000 });
      setTotalUnread(filas.reduce((s, r) => s + (r.unread || 0), 0));
    } catch {
      setSinConexion(true);
    }
  }, [tenantId]);

  const { recargar } = useRecarga(async () => {
    if (!tenantId) return;
    const turno = guard.nuevo();
    try {
      const res = await supabase.from("wa_chats").select(COLUMNAS_CHAT, { count: "exact" })
        .eq("tenant_id", tenantId)
        .order("last_message_at", { ascending: false }).order("phone")
        .range(0, CHATS_POR_PAGINA - 1);
      const filas = (revisar(res, "No se pudieron cargar los chats") ?? []) as ChatResumen[];
      if (!turno.vigente()) return;
      // Si ya se paginó más abajo, eso se conserva; la primera página se renueva.
      const lista = chatsRef.current.length > CHATS_POR_PAGINA ? fusionarChats(chatsRef.current, filas) : filas;
      setChats(lista);
      setTotal(typeof res.count === "number" ? res.count : null);
      setHayMas((res.count ?? 0) > lista.length);
      setError(null);
      setSinConexion(false);
      contarNoLeidos();
    } catch (e) {
      if (!turno.vigente()) return;
      if (chatsRef.current.length === 0) setError(e);
      else setSinConexion(true);
    } finally {
      if (turno.vigente()) setLoading(false);
    }
  }, [tenantId], { timeZone: timezone, habilitado: !!tenantId && ready, alCambiarSede: false });

  const cargarMas = async () => {
    if (!tenantId || cargandoMas || !hayMas || resultados) return;
    setCargandoMas(true);
    try {
      const desde = chatsRef.current.length;
      const filas = (revisar(
        await supabase.from("wa_chats").select(COLUMNAS_CHAT).eq("tenant_id", tenantId)
          .order("last_message_at", { ascending: false }).order("phone")
          .range(desde, desde + CHATS_POR_PAGINA - 1),
        "No se pudieron cargar más chats",
      ) ?? []) as ChatResumen[];
      setChats(prev => fusionarChats(prev, filas));
      setHayMas(filas.length === CHATS_POR_PAGINA);
    } catch {
      setSinConexion(true);
    } finally {
      setCargandoMas(false);
    }
  };

  /** Respaldo de Realtime: solo los chats que se movieron desde el más reciente. */
  const sondearLista = useCallback(async () => {
    if (!tenantId) return;
    const masNuevo = chatsRef.current[0]?.last_message_at;
    if (!masNuevo) { await recargar(); return; }
    try {
      const filas = (revisar(
        await supabase.from("wa_chats").select(COLUMNAS_CHAT).eq("tenant_id", tenantId)
          .gte("last_message_at", masNuevo)
          .order("last_message_at", { ascending: false }).order("phone")
          .limit(CHATS_POR_PAGINA),
        "No se pudo actualizar la bandeja",
      ) ?? []) as ChatResumen[];
      setChats(prev => fusionarChats(prev, filas));
      setSinConexion(false);
      contarNoLeidos();
    } catch {
      setSinConexion(true);
    }
  }, [tenantId, recargar, contarNoLeidos]);

  const refrescarChat = useCallback(async (phone: string) => {
    if (!tenantId) return;
    const { data, error: err } = await supabase.from("wa_chats").select(COLUMNAS_CHAT)
      .eq("tenant_id", tenantId).eq("phone", phone).maybeSingle();
    if (err) { setSinConexion(true); return; }
    if (data) setChats(prev => fusionarChats(prev, [data as ChatResumen]));
    contarNoLeidos();
  }, [tenantId, contarNoLeidos]);

  // Con un chat abierto, la lista no se sondea (Realtime la sigue al día).
  useIntervaloActivo(sondearLista, SONDEO_LISTA_MS, !!tenantId && !abierto, false);

  // Realtime: un canal para la lista y la conversación abierta.
  useEffect(() => {
    if (!tenantId) return;
    const filtro = `tenant_id=eq.${tenantId}`;
    const avisar = (m: MensajeChat) => {
      oyentes.current.forEach(fn => {
        try { fn(m); } catch { /* un oyente roto no debe tumbar a los demás */ }
      });
    };
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const canal = supabase
      .channel(`wa-inbox-movil-${tenantId}-${nuevoId().slice(0, 8)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "wa_chat_messages", filter: filtro },
        p => avisar(p.new as unknown as MensajeChat))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "wa_chat_messages", filter: filtro },
        p => avisar(p.new as unknown as MensajeChat))
      .on("postgres_changes", { event: "*", schema: "public", table: "wa_chats", filter: filtro },
        p => {
          if (p.eventType === "DELETE") {
            // Realtime no filtra los DELETE (ni les aplica RLS): llegan los de
            // cualquier negocio con solo la llave (tenant_id, phone). Sin esta
            // comparación, un cliente que escribe a dos negocios desaparecía
            // de esta lista cuando el otro negocio borraba su chat.
            const viejo = p.old as Partial<ChatResumen>;
            if (viejo.phone && viejo.tenant_id === tenantId) setChats(prev => prev.filter(ch => ch.phone !== viejo.phone));
          } else {
            setChats(prev => fusionarChats(prev, [p.new as unknown as ChatResumen]));
            setAbierto(prev => (prev && prev.phone === (p.new as { phone?: string }).phone ? { ...prev, ...(p.new as unknown as ChatResumen) } : prev));
          }
          if (debounce) clearTimeout(debounce);
          debounce = setTimeout(() => { contarNoLeidos(); }, 800);
        })
      .subscribe();
    return () => {
      if (debounce) clearTimeout(debounce);
      supabase.removeChannel(canal);
    };
  }, [tenantId, contarNoLeidos]);

  const suscribirMensajes = useCallback<SuscribirMensajes>(fn => {
    oyentes.current.add(fn);
    return () => { oyentes.current.delete(fn); };
  }, []);

  // Búsqueda en el servidor: antes solo recorría los 200 chats cargados.
  useEffect(() => {
    const filtro = filtroNombreTelefono(query, "client_name", "phone");
    if (!tenantId || !filtro) {
      guardBusqueda.invalidar();
      setResultados(null);
      setBuscando(false);
      return;
    }
    const turno = guardBusqueda.nuevo();
    setBuscando(true);
    const tm = setTimeout(async () => {
      try {
        const filas = (revisar(
          await supabase.from("wa_chats").select(COLUMNAS_CHAT).eq("tenant_id", tenantId)
            .or(filtro).order("last_message_at", { ascending: false }).limit(50),
          "No se pudo buscar",
        ) ?? []) as ChatResumen[];
        if (turno.vigente()) setResultados(filas);
      } catch {
        if (turno.vigente()) { setResultados([]); setSinConexion(true); }
      } finally {
        if (turno.vigente()) setBuscando(false);
      }
    }, 350);
    return () => clearTimeout(tm);
  }, [query, tenantId, guardBusqueda]);

  const onRefresh = async () => { setRefreshing(true); await recargar(); setRefreshing(false); };

  const q = query.trim().toLowerCase();
  const lista = resultados ?? (q
    ? chats.filter(ch => (ch.client_name ?? "").toLowerCase().includes(q) || ch.phone.includes(q))
    : chats);

  // El chat abierto se mantiene al día con la lista (bot_paused, nombre…).
  const chatAbierto = abierto ? (chats.find(ch => ch.phone === abierto.phone) ?? abierto) : null;

  const renderChat = ({ item, index }: { item: ChatResumen; index: number }) => (
    <Animated.View entering={index < 10 ? FadeInDown.delay(index * 40).duration(300) : undefined}>
      <TouchableOpacity style={[s.row, Shadow.sm, { backgroundColor: t.cardSolid, borderColor: t.line }]}
        onPress={() => setAbierto(item)} activeOpacity={0.75} accessibilityRole="button"
        accessibilityLabel={`${item.client_name || fmtTelefono(`+${item.phone}`)}${item.unread > 0 ? `, ${item.unread} sin leer` : ""}`}>
        <Avatar name={item.client_name || "?"} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <Text style={[s.name, { color: t.text }]} numberOfLines={1}>
              {item.client_name || fmtTelefono(`+${item.phone}`)}
            </Text>
            <Text style={[s.time, { color: item.unread > 0 ? "#1da851" : t.subtle }]}>
              {horaLista(item.last_message_at, timezone)}
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

  const totalChats = total ?? chats.length;
  const subtitulo = `${totalChats} chat${totalChats !== 1 ? "s" : ""}${totalUnread > 0 ? ` · ${totalUnread} sin leer` : ""}`;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader
        crumb="Marketing"
        title="Chats de WhatsApp"
        subtitle={subtitulo}
        onBack={() => router.back()}
        rightAction={{ icon: "megaphone-outline", label: "Ir a campañas de WhatsApp", onPress: () => router.navigate("/(admin)/whatsapp") }}
      />

      <View style={s.searchWrap}>
        <View style={[s.searchBox, { backgroundColor: t.cardSolid, borderColor: t.line }]}>
          <Ionicons name="search-outline" size={16} color={t.subtle} />
          <TextInput
            style={[s.searchInput, { color: t.text }]}
            value={query} onChangeText={setQuery}
            placeholder="Buscar por nombre o número…"
            placeholderTextColor={t.subtle}
            autoCorrect={false}
          />
          {buscando
            ? <ActivityIndicator size="small" color={t.subtle} />
            : query.length > 0 && (
              <TouchableOpacity onPress={() => setQuery("")} hitSlop={8} accessibilityRole="button" accessibilityLabel="Borrar búsqueda">
                <Ionicons name="close-circle" size={16} color={t.subtle} />
              </TouchableOpacity>
            )}
        </View>
        {sinConexion && !error && (
          <TouchableOpacity onPress={recargar} activeOpacity={0.8} style={[s.offline, { backgroundColor: t.chipBg }]}>
            <Ionicons name="cloud-offline-outline" size={13} color={t.muted} />
            <Text style={[s.offlineText, { color: t.muted }]}>Sin conexión: la lista puede no estar al día. Toca para reintentar.</Text>
          </TouchableOpacity>
        )}
      </View>

      {error && chats.length === 0 ? (
        <ErrorState error={error} onRetry={recargar} />
      ) : loading && chats.length === 0 ? (
        <ActivityIndicator color={Colors.red} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={lista}
          keyExtractor={ch => ch.phone}
          renderItem={renderChat}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 110 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.red} />}
          onEndReached={cargarMas}
          onEndReachedThreshold={0.4}
          ListFooterComponent={cargandoMas ? <ActivityIndicator color={t.subtle} style={{ marginVertical: 16 }} /> : null}
          ListEmptyComponent={
            buscando ? null : (
              <Animated.View entering={FadeInDown.duration(350)} style={[s.empty, { backgroundColor: t.cardSolid, borderColor: t.line }]}>
                <Ionicons name="chatbubbles-outline" size={42} color={t.subtle} style={{ marginBottom: 12 }} />
                <Text style={[s.emptyTitle, { color: t.text }]}>
                  {q ? "Sin resultados" : "Aún no hay chats"}
                </Text>
                <Text style={[s.emptySub, { color: t.muted }]}>
                  {q
                    ? "Prueba otro nombre o número."
                    : "Cuando tus clientes escriban a tu número de WhatsApp conectado, sus chats aparecerán aquí."}
                </Text>
              </Animated.View>
            )
          }
        />
      )}

      {chatAbierto && tenantId && (
        <ChatModal
          key={chatAbierto.phone}
          chat={chatAbierto}
          tenantId={tenantId}
          timezone={timezone}
          onClose={() => { const phone = chatAbierto.phone; setAbierto(null); refrescarChat(phone); }}
          onChanged={() => refrescarChat(chatAbierto.phone)}
          suscribirMensajes={suscribirMensajes}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  searchWrap:  { padding: 16, paddingBottom: 8, gap: 8 },
  searchBox:   { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: Radius.full, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 12 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "SpaceGrotesk_400Regular" },
  offline:     { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: Radius.md, paddingHorizontal: 12, paddingVertical: 8 },
  offlineText: { flex: 1, fontSize: 11.5, fontFamily: "SpaceGrotesk_400Regular" },
  row:         { borderRadius: Radius.lg, borderWidth: 1, flexDirection: "row", alignItems: "center", gap: 12, padding: 14, marginBottom: 10 },
  name:        { fontSize: 14.5, fontFamily: "SpaceGrotesk_600SemiBold", flexShrink: 1 },
  time:        { fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold", flexShrink: 0 },
  preview:     { flex: 1, fontSize: 12.5, fontFamily: "SpaceGrotesk_400Regular" },
  manualPill:  { backgroundColor: "rgba(245,158,11,0.14)", borderRadius: Radius.full, paddingHorizontal: 7, paddingVertical: 2 },
  manualText:  { fontSize: 8.5, fontFamily: "JetBrainsMono_700Bold", color: "#d97706", letterSpacing: 0.4 },
  unread:      { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: WA_GREEN, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  unreadText:  { fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
  empty:       { borderRadius: Radius.xl, borderWidth: 1, padding: 44, alignItems: "center", marginTop: 8 },
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
  offline:   { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8 },
  offlineText: { flex: 1, fontSize: 11.5, fontFamily: "SpaceGrotesk_400Regular" },
  dayPill:   { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 4 },
  dayText:   { fontSize: 11, fontFamily: "SpaceGrotesk_700Bold" },
  bubble:    { maxWidth: "80%", borderRadius: 12, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6, ...Shadow.sm },
  author:    { fontSize: 10, fontFamily: "SpaceGrotesk_700Bold", marginBottom: 2 },
  body:      { fontSize: 14, fontFamily: "SpaceGrotesk_400Regular", lineHeight: 20 },
  metaRow:   { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4, marginTop: 3 },
  time:      { fontSize: 10, fontFamily: "SpaceGrotesk_400Regular" },
  failText:  { fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold", color: "#ef4444", marginTop: 4 },
  retryBtn:  { alignSelf: "flex-start", backgroundColor: "#ef4444", borderRadius: 6, paddingHorizontal: 9, paddingVertical: 3, marginTop: 6 },
  retryText: { fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
  hannaWarn: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8, marginHorizontal: 4 },
  hannaWarnText: { flex: 1, fontSize: 11.5, fontFamily: "SpaceGrotesk_400Regular" },
  hannaWarnBtn: { backgroundColor: "rgba(168,85,247,0.12)", borderRadius: 100, paddingHorizontal: 10, paddingVertical: 4 },
  hannaWarnBtnText: { fontSize: 11, fontFamily: "SpaceGrotesk_700Bold" },
  // En una lista invertida, VirtualizedList ya le aplica la inversión al vacío.
  empty:     { textAlign: "center", marginTop: 40, fontFamily: "SpaceGrotesk_400Regular" },
  inputBar:  { paddingHorizontal: 12, paddingTop: 10, borderTopWidth: 1 },
  windowWarn:{ fontSize: 11.5, fontFamily: "SpaceGrotesk_400Regular", borderRadius: 9, padding: 9, marginBottom: 8, lineHeight: 16 },
  input:     { flex: 1, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 11, fontSize: 14.5, fontFamily: "SpaceGrotesk_400Regular", maxHeight: 110 },
  sendBtn:   { width: 44, height: 44, borderRadius: 22, backgroundColor: WA_GREEN, alignItems: "center", justifyContent: "center" },
});
