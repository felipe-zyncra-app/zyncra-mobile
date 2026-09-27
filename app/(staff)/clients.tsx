import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, Linking, RefreshControl, Modal,
  ScrollView, Alert,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { Colors, Gradients, Radius, Shadow } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { MonoTag } from "@/components/ui";
import { STATUS_META } from "@/constants/status";
import { enlaceTel, enlaceWhatsApp, fmtMoneyFull, fmtTelefono } from "@/lib/format";
import { fmtDia, hoyNegocio, sumarDias } from "@/lib/tz";
import { useStaffPermissionsEstado, type StaffPermissions } from "@/lib/permissions";
import {
  type LoyaltyReward,
  describeReward, entregarRecompensa, getClientRewardStatuses, visitasDelCliente,
} from "@/lib/loyalty";
import { mensajeError, revisar, traerTodo } from "@/lib/db";
import { useGuardRespuestas, useRecarga } from "@/lib/useRecarga";
import Avatar from "@/components/Avatar";
import ErrorState from "@/components/ErrorState";

type ClientEntry = {
  id: string;
  name: string;
  phone?: string;
  phone_country_code?: string | null;
  email?: string;
  lastDate: string;
  lastService: string;
  apptCount: number;
  completedCount: number;
};

type ApptHistoryItem = {
  id: string;
  date: string;
  time: string;
  status: string;
  serviceName: string;
  price: number;
};

type Respuesta<T> = PromiseLike<{ data: T[] | null; error: unknown }>;

// Área táctil extra para los botones de solo ícono (CAL-24).
const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

// Ventana de datos de esta pantalla: últimos 12 meses del NEGOCIO (lista y
// estadísticas usan el mismo corte). Antes salía del reloj del teléfono.
function haceUnAnio(timeZone: string): string {
  return sumarDias(hoyNegocio(timeZone), -365);
}

/** Dígitos de un texto, para comparar teléfonos escritos de cualquier forma. */
const soloDigitos = (v: string) => v.replace(/\D/g, "");

// ─── Client detail modal ──────────────────────────────────────────────────────

function ClientModal({ client, proId, perms, onClose }: {
  client: ClientEntry | null; proId: string | null; perms: StaffPermissions; onClose: () => void;
}) {
  const { tenantId } = useAuth();
  const { timezone } = useTenant();
  const { t } = useTheme();
  const guardHist = useGuardRespuestas();
  const guardFid = useGuardRespuestas();
  const [history, setHistory] = useState<ApptHistoryItem[]>([]);
  const [totalAtendido, setTotalAtendido] = useState(0);
  const [loading, setLoading] = useState(true);
  const [errorHist, setErrorHist] = useState<unknown>(null);

  // Fidelización — visitas del cliente en TODO el negocio (RPC del servidor).
  const [rewards, setRewards] = useState<LoyaltyReward[]>([]);
  const [redemptions, setRedemptions] = useState<{ id: string; reward_id: string }[]>([]);
  const [totalVisits, setTotalVisits] = useState(0);
  const [visitasParciales, setVisitasParciales] = useState(false);
  const [serviceNames, setServiceNames] = useState<Record<string, string>>({});
  const [errorFid, setErrorFid] = useState<unknown>(null);
  const [cargandoFid, setCargandoFid] = useState(false);
  const [redeeming, setRedeeming] = useState<string | null>(null);
  const redeemingRef = useRef(false);

  const loadLoyalty = useCallback(async () => {
    if (!client || !tenantId) return;
    const turno = guardFid.nuevo();
    setCargandoFid(true);
    try {
      const [rw, rd, vis] = await Promise.all([
        supabase.from("loyalty_rewards").select("*").eq("tenant_id", tenantId).eq("active", true).order("visits_required"),
        supabase.from("loyalty_redemptions").select("id,reward_id").eq("client_id", client.id),
        visitasDelCliente(client.id),
      ]);
      const recompensas = (revisar(rw, "No se pudo cargar la fidelización") ?? []) as LoyaltyReward[];
      const entregas = (revisar(rd, "No se pudo cargar la fidelización") ?? []) as { id: string; reward_id: string }[];
      const svcIds = [...new Set(recompensas.map(r => r.service_id).filter((x): x is string => !!x))];
      let nombres: Record<string, string> = {};
      if (svcIds.length > 0) {
        const sv = revisar(await supabase.from("services").select("id,name").in("id", svcIds), "No se pudo cargar la fidelización") ?? [];
        nombres = Object.fromEntries((sv as { id: string; name: string }[]).map(s => [s.id, s.name]));
      }
      if (!turno.vigente()) return;
      setRewards(recompensas);
      setRedemptions(entregas);
      setTotalVisits(vis.visitas);
      // Sin la RPC del servidor el staff solo ve sus propias citas.
      setVisitasParciales(vis.viaRespaldo);
      setServiceNames(nombres);
      setErrorFid(null);
    } catch (e) {
      if (turno.vigente()) setErrorFid(e);
    } finally {
      if (turno.vigente()) setCargandoFid(false);
    }
  }, [client, tenantId, guardFid]);

  useEffect(() => { loadLoyalty(); }, [loadLoyalty]);

  const loyaltyStatuses = getClientRewardStatuses(rewards, totalVisits, redemptions);
  const loyaltyAvailable = loyaltyStatuses.filter(st => st.available > 0);
  const loyaltyNext = loyaltyStatuses.filter(st => st.available === 0).sort((a, b) => a.remaining - b.remaining)[0] ?? null;

  const handleRedeem = async (reward: LoyaltyReward) => {
    if (!client || !tenantId || redeemingRef.current) return;
    redeemingRef.current = true;
    setRedeeming(reward.id);
    try {
      const r = await entregarRecompensa({ tenantId, clientId: client.id, reward });
      if (!r.ok) Alert.alert("No se registró la entrega", r.mensaje);
      await loadLoyalty();
    } catch (e) {
      // Antes el error se ignoraba y el staff creía que había quedado registrado.
      Alert.alert("No se pudo registrar la entrega", mensajeError(e));
    } finally {
      redeemingRef.current = false;
      setRedeeming(null);
    }
  };

  const loadHistory = useCallback(async () => {
    if (!client || !proId) return;
    const turno = guardHist.nuevo();
    setLoading(true);
    try {
      const campos = `id, appointment_date, appointment_time, status, services(name${perms.amounts ? ", price" : ""})`;
      const [hist, completadas] = await Promise.all([
        supabase.from("appointments")
          .select(campos)
          .eq("client_id", client.id)
          .eq("professional_id", proId)
          .order("appointment_date", { ascending: false })
          .order("appointment_time", { ascending: false })
          .limit(20),
        // El total va aparte: el historial visible se corta en 20 citas.
        perms.amounts
          ? traerTodo<{ id: string; services: { price: number } | null }>((d, h) => supabase.from("appointments")
              .select("id, services(price)")
              .eq("client_id", client.id)
              .eq("professional_id", proId)
              .eq("status", "completed")
              .gte("appointment_date", haceUnAnio(timezone))
              .order("appointment_date").order("id")
              .range(d, h) as unknown as Respuesta<{ id: string; services: { price: number } | null }>,
              { contexto: "No se pudo calcular el total" })
          : Promise.resolve([]),
      ]);
      const filas = (revisar(hist, "No se pudo cargar el historial") ?? []) as unknown as {
        id: string; appointment_date: string; appointment_time: string | null; status: string | null;
        services: { name: string; price?: number } | null;
      }[];
      if (!turno.vigente()) return;
      setHistory(filas.map(a => ({
        id: a.id,
        date: a.appointment_date,
        time: a.appointment_time?.slice(0, 5) ?? "—",
        status: a.status ?? "pending",
        serviceName: a.services?.name ?? "—",
        price: Number(a.services?.price ?? 0),
      })));
      setTotalAtendido(completadas.reduce((s, a) => s + Number(a.services?.price ?? 0), 0));
      setErrorHist(null);
    } catch (e) {
      if (turno.vigente()) setErrorHist(e);
    } finally {
      if (turno.vigente()) setLoading(false);
    }
  }, [client, proId, perms.amounts, timezone, guardHist]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  if (!client) return null;

  const llamar = () => {
    const url = enlaceTel(client.phone, { indicativo: client.phone_country_code });
    if (url) Linking.openURL(url).catch(() => Alert.alert("No se pudo abrir el marcador"));
  };
  const abrirWhatsApp = () => {
    const url = enlaceWhatsApp(client.phone, { indicativo: client.phone_country_code });
    if (!url) { Alert.alert("Número inválido", "El teléfono de este cliente no parece un número de WhatsApp válido."); return; }
    Linking.openURL(url).catch(() => Alert.alert("No se pudo abrir WhatsApp"));
  };

  const card = { backgroundColor: t.cardSolid, borderColor: t.line };

  return (
    <Modal visible={!!client} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <View style={[cm.header, { backgroundColor: "#0C0C14" }]}>
          <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3 }} />
          <View style={cm.headerRow}>
            <TouchableOpacity onPress={onClose} style={cm.iconBtn} hitSlop={HIT_SLOP} accessibilityRole="button" accessibilityLabel="Cerrar">
              <Ionicons name="close" size={20} color="white" />
            </TouchableOpacity>
            <View style={{ flex: 1 }} />
          </View>
          <View style={{ alignItems: "center" }}>
            <Avatar name={client.name} size={68} />
            <Text style={cm.clientName}>{client.name}</Text>
            {perms.contact && client.phone ? (
              <Text style={cm.clientPhone}>{fmtTelefono(client.phone, { indicativo: client.phone_country_code })}</Text>
            ) : null}
          </View>
          <View style={cm.quickActions}>
            {perms.contact && client.phone ? (
              <>
                <TouchableOpacity style={cm.actionBtn} onPress={llamar} accessibilityRole="button">
                  <Ionicons name="call-outline" size={17} color="white" />
                  <Text style={cm.actionLabel}>Llamar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={cm.actionBtn} onPress={abrirWhatsApp} accessibilityRole="button">
                  <Ionicons name="logo-whatsapp" size={17} color="white" />
                  <Text style={cm.actionLabel}>WhatsApp</Text>
                </TouchableOpacity>
              </>
            ) : null}
            {perms.contact && client.email ? (
              <TouchableOpacity style={cm.actionBtn} onPress={() => Linking.openURL(`mailto:${client.email}`).catch(() => Alert.alert("No se pudo abrir el correo"))} accessibilityRole="button">
                <Ionicons name="mail-outline" size={17} color="white" />
                <Text style={cm.actionLabel}>Correo</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
          {/* Stats */}
          <View style={[cm.statsRow, Shadow.sm, card]}>
            <View style={cm.statBox}>
              <Text style={[cm.statVal, { color: t.ink }]}>{client.apptCount}</Text>
              <Text style={[cm.statLabel, { color: t.subtle }]}>Citas contigo</Text>
            </View>
            <View style={[cm.statDivider, { backgroundColor: t.line }]} />
            <View style={cm.statBox}>
              <Text style={[cm.statVal, { color: Colors.success }]}>{client.completedCount}</Text>
              <Text style={[cm.statLabel, { color: t.subtle }]}>Completadas</Text>
            </View>
            {perms.amounts && (
              <>
                <View style={[cm.statDivider, { backgroundColor: t.line }]} />
                <View style={cm.statBox}>
                  <Text style={[cm.statVal, { color: Colors.purple }]} numberOfLines={1} adjustsFontSizeToFit>{fmtMoneyFull(totalAtendido)}</Text>
                  {/* Precio de lista de lo atendido en 12 meses; no es lo cobrado (D10). */}
                  <Text style={[cm.statLabel, { color: t.subtle }]}>Valor atendido</Text>
                </View>
              </>
            )}
          </View>

          {/* Fidelización */}
          {errorFid ? (
            <TouchableOpacity onPress={loadLoyalty} style={[cm.errorBanner]} accessibilityRole="button">
              <Text style={[cm.errorText, { color: t.ink }]}>{mensajeError(errorFid)} Toca para reintentar.</Text>
            </TouchableOpacity>
          ) : rewards.length > 0 && (
            <>
              <Text style={[cm.sectionLabel, { color: t.subtle }]}>Fidelización · {totalVisits} visita{totalVisits !== 1 ? "s" : ""}</Text>
              {visitasParciales && (
                <Text style={[cm.note, { color: t.muted }]}>Por ahora solo se cuentan tus citas con este cliente.</Text>
              )}
              {loyaltyAvailable.length > 0 ? (
                loyaltyAvailable.map(st => (
                  <View key={st.reward.id} style={[cm.apptRow, Shadow.sm, card, { borderColor: "#a855f7" + "45" }]}>
                    <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: "#a855f7" + "18", alignItems: "center", justifyContent: "center" }}>
                      <Ionicons name="gift-outline" size={16} color="#a855f7" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[cm.apptService, { color: t.ink }]} numberOfLines={1}>{st.reward.label}</Text>
                      <Text style={{ fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold", color: "#a855f7", marginTop: 2 }}>
                        {describeReward(st.reward, serviceNames[st.reward.service_id ?? ""] ?? null)}{st.available > 1 ? ` · ×${st.available}` : ""}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => handleRedeem(st.reward)}
                      disabled={!!redeeming || cargandoFid}
                      style={{ backgroundColor: "#a855f7", borderRadius: Radius.full, paddingVertical: 8, paddingHorizontal: 13, opacity: redeeming || cargandoFid ? 0.6 : 1 }}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                      accessibilityLabel={`Entregar ${st.reward.label}`}
                    >
                      {redeeming === st.reward.id ? <ActivityIndicator size="small" color="white" /> : (
                        <Text style={{ fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", color: "white" }}>Entregar</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                ))
              ) : loyaltyNext ? (
                <View style={[cm.apptRow, Shadow.sm, card, { flexDirection: "column", alignItems: "stretch", gap: 8 }]}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={[cm.apptService, { color: t.ink, flexShrink: 1 }]} numberOfLines={1}>{loyaltyNext.reward.label}</Text>
                    <Text style={{ fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", color: t.muted }}>
                      Falta{loyaltyNext.remaining !== 1 ? "n" : ""} <Text style={{ color: Colors.blue, fontFamily: "SpaceGrotesk_700Bold" }}>{loyaltyNext.remaining}</Text> visita{loyaltyNext.remaining !== 1 ? "s" : ""}
                    </Text>
                  </View>
                  <View style={{ height: 6, borderRadius: 4, backgroundColor: t.trackBg, overflow: "hidden" }}>
                    <View style={{ height: "100%", width: `${Math.min(100, (loyaltyNext.progressCurrent / loyaltyNext.progressTarget) * 100)}%`, backgroundColor: Colors.blue, borderRadius: 4 }} />
                  </View>
                </View>
              ) : null}
            </>
          )}

          {/* Appointment history */}
          <Text style={[cm.sectionLabel, { color: t.subtle }]}>Historial de citas</Text>
          {loading && history.length === 0 ? (
            <ActivityIndicator color={Colors.red} style={{ paddingVertical: 24 }} />
          ) : errorHist ? (
            <ErrorState error={errorHist} onRetry={loadHistory} />
          ) : history.length === 0 ? (
            <View style={[cm.emptyCard, Shadow.sm, card]}>
              <Text style={[cm.emptyTitle, { color: t.muted }]}>Sin historial</Text>
            </View>
          ) : (
            history.map(a => {
              const meta = STATUS_META[a.status] ?? STATUS_META.pending;
              const [diaTxt, mesTxt] = fmtDia(a.date, "dia-mes").split(" ");
              return (
                <View key={a.id} style={[cm.apptRow, Shadow.sm, card]}>
                  <View style={[cm.dateBlock, { backgroundColor: t.chipBg }]}>
                    <Text style={[cm.dateDay, { color: t.ink }]}>{diaTxt}</Text>
                    <Text style={[cm.dateMon, { color: t.subtle }]}>{mesTxt}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[cm.apptService, { color: t.ink }]} numberOfLines={1}>{a.serviceName}</Text>
                    <Text style={[cm.apptTime, { color: t.muted }]}>{a.time}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 4 }}>
                    {perms.amounts && a.price > 0 && <Text style={[cm.apptPrice, { color: t.ink }]}>{fmtMoneyFull(a.price)}</Text>}
                    <View style={[cm.statusPill, { backgroundColor: meta.bg }]}>
                      <Text style={[cm.statusText, { color: meta.color }]}>{meta.label}</Text>
                    </View>
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const cm = StyleSheet.create({
  header:      { paddingTop: 16, paddingHorizontal: 20, paddingBottom: 24 },
  headerRow:   { flexDirection: "row", marginBottom: 12 },
  iconBtn:     { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,.18)", alignItems: "center", justifyContent: "center" },
  clientName:  { fontSize: 20, fontFamily: "SpaceGrotesk_700Bold", color: "white", marginTop: 10, letterSpacing: -0.3 },
  clientPhone: { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: "rgba(255,255,255,.75)", marginTop: 4 },
  quickActions:{ flexDirection: "row", justifyContent: "center", gap: 10, marginTop: 16 },
  actionBtn:   { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,.2)", borderRadius: Radius.full, paddingHorizontal: 16, paddingVertical: 9 },
  actionLabel: { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: "white" },
  statsRow:    { borderWidth: 1, borderRadius: Radius.lg, flexDirection: "row", padding: 16, marginBottom: 0 },
  statBox:     { flex: 1, alignItems: "center", gap: 4, paddingHorizontal: 2 },
  statVal:     { fontSize: 18, fontFamily: "SpaceGrotesk_700Bold" },
  statLabel:   { fontSize: 10, fontFamily: "SpaceGrotesk_600SemiBold", textAlign: "center" },
  statDivider: { width: 1 },
  sectionLabel:{ fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", textTransform: "uppercase", letterSpacing: 0.8, marginTop: 20, marginBottom: 10 },
  note:        { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", marginTop: -4, marginBottom: 10 },
  errorBanner: { marginTop: 16, borderWidth: 1, borderColor: Colors.red + "40", backgroundColor: Colors.red + "10", borderRadius: Radius.md, padding: 12 },
  errorText:   { fontSize: 12.5, fontFamily: "SpaceGrotesk_600SemiBold" },
  emptyCard:   { borderWidth: 1, borderRadius: Radius.lg, padding: 24, alignItems: "center" },
  emptyTitle:  { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold" },
  apptRow:     { borderWidth: 1, borderRadius: Radius.md, flexDirection: "row", alignItems: "center", gap: 12, padding: 12, marginBottom: 8 },
  dateBlock:   { width: 38, alignItems: "center", borderRadius: 8, paddingVertical: 6 },
  dateDay:     { fontSize: 17, fontFamily: "SpaceGrotesk_700Bold", lineHeight: 19 },
  dateMon:     { fontSize: 9, fontFamily: "SpaceGrotesk_600SemiBold", textTransform: "uppercase" },
  apptService: { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold" },
  apptTime:    { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", marginTop: 2 },
  apptPrice:   { fontSize: 12, fontFamily: "SpaceGrotesk_700Bold" },
  statusPill:  { borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  statusText:  { fontSize: 10, fontFamily: "SpaceGrotesk_600SemiBold" },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

type FilaCita = {
  id: string;
  appointment_date: string;
  client_id: string;
  status: string | null;
  clients: { id: string; name: string; phone?: string | null; phone_country_code?: string | null; email?: string | null } | null;
  services: { name: string; price?: number } | null;
};

export default function StaffClientsScreen() {
  const { professionalId: proId, tenantId } = useAuth();
  const { timezone, ready } = useTenant();
  const { t } = useTheme();
  // Restrictivo mientras carga o si falla (antes arrancaba con todo visible).
  const { perms, cargando: cargandoPerms, error: errorPerms } = useStaffPermissionsEstado();
  const [clients, setClients]       = useState<ClientEntry[]>([]);
  const [query, setQuery]           = useState("");
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected]     = useState<ClientEntry | null>(null);
  const [error, setError]           = useState<unknown>(null);
  const guard = useGuardRespuestas();

  const { recargar } = useRecarga(async () => {
    if (!proId) return;
    const turno = guard.nuevo();
    setLoading(true);
    try {
      // Teléfono y correo solo se DESCARGAN si el dueño dio el permiso de
      // contacto; antes se bajaban siempre y solo se ocultaban en pantalla.
      // Lo mismo con los precios y el permiso de montos.
      const contacto = perms.contact ? ", phone, phone_country_code, email" : "";
      const precio = perms.amounts ? ", price" : "";
      const desde = haceUnAnio(timezone);
      const appts = await traerTodo<FilaCita>((d, h) => supabase
        .from("appointments")
        .select(`id, appointment_date, client_id, status, clients(id, name${contacto}), services(name${precio})`)
        .eq("professional_id", proId)
        .not("client_id", "is", null)
        .gte("appointment_date", desde)
        .order("appointment_date", { ascending: false })
        .order("id")
        .range(d, h) as unknown as Respuesta<FilaCita>,
        { tope: 10000, contexto: "No se pudieron cargar tus clientes" });

      const map = new Map<string, ClientEntry>();
      appts.forEach(a => {
        const c = a.clients;
        if (!c) return;
        const entry = map.get(c.id);
        if (!entry) {
          map.set(c.id, {
            id: c.id, name: c.name,
            phone: c.phone ?? undefined, phone_country_code: c.phone_country_code ?? null, email: c.email ?? undefined,
            lastDate:       a.appointment_date,
            lastService:    a.services?.name ?? "—",
            apptCount:      1,
            completedCount: a.status === "completed" ? 1 : 0,
          });
        } else {
          entry.apptCount++;
          if (a.status === "completed") entry.completedCount++;
        }
      });

      const list = Array.from(map.values()).sort((a, b) => b.lastDate.localeCompare(a.lastDate));
      if (!turno.vigente()) return;
      setClients(list);
      setError(null);
    } catch (e) {
      if (turno.vigente()) setError(e);
    } finally {
      if (turno.vigente()) setLoading(false);
    }
  }, [proId, tenantId, timezone, perms.contact, perms.amounts], {
    timeZone: timezone,
    habilitado: !!proId && ready && !cargandoPerms,
  });

  // Derivado de (clientes, búsqueda): antes era un estado aparte y al hacer
  // pull-to-refresh se perdía el filtro aunque el buscador seguía escrito.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients;
    const qDig = soloDigitos(q);
    return clients.filter(c =>
      c.name.toLowerCase().includes(q)
      || (qDig.length >= 3 && !!c.phone && (soloDigitos(c.phone).includes(qDig) || (qDig.length > 10 && soloDigitos(c.phone).includes(qDig.slice(-10))))),
    );
  }, [clients, query]);

  const onRefresh = async () => { setRefreshing(true); await recargar(); setRefreshing(false); };

  const renderItem = ({ item, index }: { item: ClientEntry; index: number }) => (
    <Animated.View entering={FadeInDown.delay(Math.min(index * 40, 400)).duration(300)}>
      <TouchableOpacity style={[s.card, Shadow.sm, { backgroundColor: t.cardSolid, borderColor: t.line }]} onPress={() => setSelected(item)} activeOpacity={0.8} accessibilityRole="button">
        <Avatar name={item.name} />
        <View style={{ flex: 1 }}>
          <Text style={[s.name, { color: t.ink }]} numberOfLines={1}>{item.name}</Text>
          <Text style={[s.sub, { color: t.muted }]} numberOfLines={1}>
            {item.apptCount} cita{item.apptCount !== 1 ? "s" : ""} · último {fmtDia(item.lastDate, "corto")}
          </Text>
          {item.lastService !== "—" && (
            <Text style={[s.service, { color: t.subtle }]} numberOfLines={1}>{item.lastService}</Text>
          )}
        </View>
        <View style={s.actionBtns}>
          {perms.contact && item.phone ? (
            <TouchableOpacity
              style={s.iconBtn}
              onPress={() => {
                const url = enlaceWhatsApp(item.phone, { indicativo: item.phone_country_code });
                if (!url) { Alert.alert("Número inválido", "El teléfono de este cliente no parece un número de WhatsApp válido."); return; }
                Linking.openURL(url).catch(() => Alert.alert("No se pudo abrir WhatsApp"));
              }}
              hitSlop={HIT_SLOP}
              accessibilityRole="button"
              accessibilityLabel={`WhatsApp de ${item.name}`}
            >
              <Ionicons name="logo-whatsapp" size={17} color="#25D366" />
            </TouchableOpacity>
          ) : null}
          <Ionicons name="chevron-forward" size={16} color={t.subtle} />
        </View>
      </TouchableOpacity>
    </Animated.View>
  );

  if (cargandoPerms) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={Colors.red} size="large" />
      </SafeAreaView>
    );
  }

  if (!perms.clients_tab) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <ErrorState
          title={errorPerms ? "No pudimos revisar tus permisos" : "Sin acceso a Clientes"}
          message={errorPerms ? "Revisa tu conexión e inténtalo de nuevo." : "El dueño del negocio no te dio acceso a esta sección."}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      {/* Header */}
      <View style={s.header}>
        <MonoTag>Clientes</MonoTag>
        <Text style={[s.headerTitle, { color: t.ink }]}>Mis Clientes</Text>
        <Text style={[s.headerSub, { color: t.muted }]}>
          {clients.length} cliente{clients.length !== 1 ? "s" : ""} atendido{clients.length !== 1 ? "s" : ""} en el último año
        </Text>
      </View>

      {/* Search */}
      <View style={s.searchWrap}>
        <View style={[s.searchBox, Shadow.sm, { backgroundColor: t.bgAlt }]}>
          <Ionicons name="search-outline" size={16} color={t.subtle} />
          <TextInput
            style={[s.searchInput, { color: t.text }]}
            value={query}
            onChangeText={setQuery}
            placeholder={perms.contact ? "Buscar por nombre o teléfono..." : "Buscar por nombre..."}
            placeholderTextColor={t.subtle}
            autoCorrect={false}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery("")} hitSlop={HIT_SLOP} accessibilityRole="button" accessibilityLabel="Borrar búsqueda">
              <Ionicons name="close-circle" size={16} color={t.subtle} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {error && clients.length === 0 ? (
        <ErrorState error={error} onRetry={recargar} />
      ) : loading && clients.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={Colors.red} size="large" />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.red} />}
          ListHeaderComponent={error ? (
            <TouchableOpacity onPress={recargar} style={s.errorBanner} accessibilityRole="button">
              <Text style={[s.errorText, { color: t.ink }]}>{mensajeError(error)} Toca para reintentar.</Text>
            </TouchableOpacity>
          ) : null}
          ListEmptyComponent={
            <Animated.View entering={FadeInDown.duration(350)} style={[s.empty, Shadow.sm, { backgroundColor: t.cardSolid, borderColor: t.line }]}>
              <Ionicons name="people-outline" size={40} color={t.subtle} style={{ marginBottom: 12 }} />
              <Text style={[s.emptyTitle, { color: t.ink }]}>{query ? "Sin resultados" : "Sin clientes aún"}</Text>
              <Text style={[s.emptySub, { color: t.muted }]}>
                {query ? "Intenta otra búsqueda" : "Los clientes de tus citas aparecerán aquí"}
              </Text>
            </Animated.View>
          }
        />
      )}

      <ClientModal client={selected} proId={proId} perms={perms} onClose={() => setSelected(null)} />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header:      { paddingTop: 14, paddingHorizontal: 20, paddingBottom: 10 },
  headerTitle: { fontSize: 21, fontFamily: "SpaceGrotesk_700Bold", letterSpacing: -0.5, marginTop: 3 },
  headerSub:   { fontSize: 12.5, fontFamily: "SpaceGrotesk_400Regular", marginTop: 3 },

  searchWrap:  { padding: 16, paddingBottom: 8 },
  searchBox:   { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: Radius.full, paddingHorizontal: 16, paddingVertical: 12 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "SpaceGrotesk_400Regular" },

  card:        { borderWidth: 1, borderRadius: Radius.lg, flexDirection: "row", alignItems: "center", gap: 12, padding: 14, marginBottom: 10 },
  name:        { fontSize: 15, fontFamily: "SpaceGrotesk_600SemiBold" },
  sub:         { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", marginTop: 2 },
  service:     { fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold", marginTop: 2 },
  actionBtns:  { flexDirection: "row", alignItems: "center", gap: 10 },
  iconBtn:     { width: 34, height: 34, borderRadius: 17, backgroundColor: "#25D36615", alignItems: "center", justifyContent: "center" },

  errorBanner: { borderWidth: 1, borderColor: Colors.red + "40", backgroundColor: Colors.red + "10", borderRadius: Radius.md, padding: 12, marginBottom: 10 },
  errorText:   { fontSize: 12.5, fontFamily: "SpaceGrotesk_600SemiBold" },

  empty:       { borderWidth: 1, borderRadius: Radius.xl, padding: 44, alignItems: "center", marginTop: 8 },
  emptyTitle:  { fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", marginBottom: 6 },
  emptySub:    { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", textAlign: "center" },
});
