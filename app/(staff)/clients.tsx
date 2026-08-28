import { useEffect, useState, useCallback } from "react";
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, Linking, RefreshControl, Modal,
  ScrollView,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { Colors, Gradients, Radius, Shadow } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { MonoTag } from "@/components/ui";
import { STATUS_META } from "@/constants/status";
import { fmtDateShort, fmtMoneyFull, localDateStr } from "@/lib/format";
import { DEFAULT_PERMISSIONS, parsePermissions, type StaffPermissions } from "@/lib/permissions";
import {
  type LoyaltyReward, type LoyaltyRedemption,
  describeReward, getClientRewardStatuses,
} from "@/lib/loyalty";
import Avatar from "@/components/Avatar";
import ErrorState from "@/components/ErrorState";

type ClientEntry = {
  id: string;
  name: string;
  phone?: string;
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

// Ventana de datos de esta pantalla: últimos 12 meses (lista y estadísticas usan el mismo corte)
function twelveMonthsAgo(): string {
  const d = new Date();
  return localDateStr(new Date(d.getFullYear() - 1, d.getMonth(), d.getDate()));
}

// ─── Client detail modal ──────────────────────────────────────────────────────

function ClientModal({ client, proId, perms, onClose }: {
  client: ClientEntry | null; proId: string | null; perms: StaffPermissions; onClose: () => void;
}) {
  const { tenantId } = useAuth();
  const [history, setHistory] = useState<ApptHistoryItem[]>([]);
  const [totalSpent, setTotalSpent] = useState(0);
  const [loading, setLoading] = useState(true);

  // Fidelización — visitas totales del cliente en el negocio (no solo con este profesional)
  const [rewards, setRewards] = useState<LoyaltyReward[]>([]);
  const [redemptions, setRedemptions] = useState<LoyaltyRedemption[]>([]);
  const [totalVisits, setTotalVisits] = useState(0);
  const [serviceNames, setServiceNames] = useState<Record<string, string>>({});
  const [redeeming, setRedeeming] = useState(false);

  const loadLoyalty = useCallback(async () => {
    if (!client || !tenantId) return;
    const [{ data: rw }, { data: rd }, { data: visitRows }, { data: svcs }] = await Promise.all([
      supabase.from("loyalty_rewards").select("*").eq("tenant_id", tenantId).eq("active", true).order("visits_required"),
      supabase.from("loyalty_redemptions").select("*").eq("client_id", client.id),
      supabase.from("appointments").select("id,status,appointment_date").eq("client_id", client.id).limit(1000),
      supabase.from("services").select("id,name").eq("tenant_id", tenantId),
    ]);
    setRewards((rw ?? []) as LoyaltyReward[]);
    setRedemptions((rd ?? []) as LoyaltyRedemption[]);
    const today = localDateStr();
    setTotalVisits((visitRows ?? []).filter((a: any) => a.status !== "cancelled" && a.appointment_date <= today).length);
    setServiceNames(Object.fromEntries(((svcs ?? []) as { id: string; name: string }[]).map(sv => [sv.id, sv.name])));
  }, [client, tenantId]);

  useEffect(() => { loadLoyalty(); }, [loadLoyalty]);

  const loyaltyStatuses = getClientRewardStatuses(rewards, totalVisits, redemptions);
  const loyaltyAvailable = loyaltyStatuses.filter(st => st.available > 0);
  const loyaltyNext = loyaltyStatuses.filter(st => st.available === 0).sort((a, b) => a.remaining - b.remaining)[0] ?? null;

  const handleRedeem = async (rewardId: string) => {
    if (!client || !tenantId) return;
    setRedeeming(true);
    const { error } = await supabase.from("loyalty_redemptions").insert({
      tenant_id: tenantId, client_id: client.id, reward_id: rewardId, visits_at_redemption: totalVisits,
    });
    setRedeeming(false);
    if (!error) loadLoyalty();
  };

  useEffect(() => {
    if (!client || !proId) return;
    let cancelled = false;
    setLoading(true);
    supabase.from("appointments")
      .select("id, appointment_date, appointment_time, status, services(name, price)")
      .eq("client_id", client.id)
      .eq("professional_id", proId)
      .order("appointment_date", { ascending: false })
      .limit(20)
      .then(({ data }) => {
        if (cancelled) return;
        setHistory((data ?? []).map((a: any) => ({
          id: a.id,
          date: a.appointment_date,
          time: a.appointment_time?.slice(0, 5) ?? "—",
          status: a.status,
          serviceName: a.services?.name ?? "—",
          price: a.services?.price ?? 0,
        })));
        setLoading(false);
      });
    // El total se calcula aparte: el historial visible se corta en 20 citas
    supabase.from("appointments")
      .select("services(price)")
      .eq("client_id", client.id)
      .eq("professional_id", proId)
      .eq("status", "completed")
      .gte("appointment_date", twelveMonthsAgo())
      .then(({ data }) => {
        if (cancelled) return;
        setTotalSpent((data ?? []).reduce((s: number, a: any) => s + Number(a.services?.price ?? 0), 0));
      });
    return () => { cancelled = true; };
  }, [client, proId]);

  const { t } = useTheme();
  if (!client) return null;

  return (
    <Modal visible={!!client} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <View style={[cm.header, { backgroundColor: "#0C0C14" }]}>
          <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3 }} />
          <View style={cm.headerRow}>
            <TouchableOpacity onPress={onClose} style={cm.iconBtn}>
              <Ionicons name="close" size={20} color="white" />
            </TouchableOpacity>
            <View style={{ flex: 1 }} />
          </View>
          <View style={{ alignItems: "center" }}>
            <Avatar name={client.name} size={68} />
            <Text style={cm.clientName}>{client.name}</Text>
            {perms.contact && client.phone && <Text style={cm.clientPhone}>{client.phone}</Text>}
          </View>
          <View style={cm.quickActions}>
            {perms.contact && client.phone && (
              <>
                <TouchableOpacity style={cm.actionBtn} onPress={() => Linking.openURL(`tel:${client.phone}`)}>
                  <Ionicons name="call-outline" size={17} color="white" />
                  <Text style={cm.actionLabel}>Llamar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={cm.actionBtn} onPress={() => Linking.openURL(`https://wa.me/${client.phone?.replace(/\D/g, "")}`)}>
                  <Ionicons name="logo-whatsapp" size={17} color="white" />
                  <Text style={cm.actionLabel}>WhatsApp</Text>
                </TouchableOpacity>
              </>
            )}
            {perms.contact && client.email && (
              <TouchableOpacity style={cm.actionBtn} onPress={() => Linking.openURL(`mailto:${client.email}`)}>
                <Ionicons name="mail-outline" size={17} color="white" />
                <Text style={cm.actionLabel}>Correo</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
          {/* Stats */}
          <View style={[cm.statsRow, Shadow.sm]}>
            <View style={cm.statBox}>
              <Text style={cm.statVal}>{client.apptCount}</Text>
              <Text style={cm.statLabel}>Citas contigo</Text>
            </View>
            <View style={cm.statDivider} />
            <View style={cm.statBox}>
              <Text style={[cm.statVal, { color: Colors.success }]}>{client.completedCount}</Text>
              <Text style={cm.statLabel}>Completadas</Text>
            </View>
            {perms.amounts && (
              <>
                <View style={cm.statDivider} />
                <View style={cm.statBox}>
                  <Text style={[cm.statVal, { color: Colors.purple }]}>{fmtMoneyFull(totalSpent)}</Text>
                  <Text style={cm.statLabel}>Total gastado</Text>
                </View>
              </>
            )}
          </View>

          {/* Fidelización */}
          {rewards.length > 0 && (
            <>
              <Text style={cm.sectionLabel}>Fidelización</Text>
              {loyaltyAvailable.length > 0 ? (
                loyaltyAvailable.map(st => (
                  <View key={st.reward.id} style={[cm.apptRow, Shadow.sm, { borderWidth: 1, borderColor: "#a855f7" + "45" }]}>
                    <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: "#a855f7" + "18", alignItems: "center", justifyContent: "center" }}>
                      <Ionicons name="gift-outline" size={16} color="#a855f7" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={cm.apptService} numberOfLines={1}>{st.reward.label}</Text>
                      <Text style={{ fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold", color: "#a855f7", marginTop: 2 }}>
                        {describeReward(st.reward, serviceNames[st.reward.service_id ?? ""] ?? null)}{st.available > 1 ? ` · ×${st.available}` : ""}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => handleRedeem(st.reward.id)}
                      disabled={redeeming}
                      style={{ backgroundColor: "#a855f7", borderRadius: Radius.full, paddingVertical: 8, paddingHorizontal: 13, opacity: redeeming ? 0.6 : 1 }}
                      activeOpacity={0.8}
                    >
                      {redeeming ? <ActivityIndicator size="small" color="white" /> : (
                        <Text style={{ fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", color: "white" }}>Entregar</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                ))
              ) : loyaltyNext ? (
                <View style={[cm.apptRow, Shadow.sm, { flexDirection: "column", alignItems: "stretch", gap: 8 }]}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={cm.apptService} numberOfLines={1}>{loyaltyNext.reward.label}</Text>
                    <Text style={{ fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted }}>
                      Falta{loyaltyNext.remaining !== 1 ? "n" : ""} <Text style={{ color: Colors.blue, fontFamily: "SpaceGrotesk_700Bold" }}>{loyaltyNext.remaining}</Text> visita{loyaltyNext.remaining !== 1 ? "s" : ""}
                    </Text>
                  </View>
                  <View style={{ height: 6, borderRadius: 4, backgroundColor: Colors.border, overflow: "hidden" }}>
                    <View style={{ height: "100%", width: `${Math.min(100, (loyaltyNext.progressCurrent / loyaltyNext.progressTarget) * 100)}%`, backgroundColor: Colors.blue, borderRadius: 4 }} />
                  </View>
                </View>
              ) : null}
            </>
          )}

          {/* Appointment history */}
          <Text style={cm.sectionLabel}>Historial de citas</Text>
          {loading ? (
            <ActivityIndicator color={Colors.red} style={{ paddingVertical: 24 }} />
          ) : history.length === 0 ? (
            <View style={[cm.emptyCard, Shadow.sm]}>
              <Text style={cm.emptyTitle}>Sin historial</Text>
            </View>
          ) : (
            history.map((a, i) => {
              const meta = STATUS_META[a.status] ?? STATUS_META.pending;
              return (
                <View key={a.id} style={[cm.apptRow, Shadow.sm]}>
                  <View style={cm.dateBlock}>
                    <Text style={cm.dateDay}>{new Date(a.date + "T00:00:00").getDate()}</Text>
                    <Text style={cm.dateMon}>{new Date(a.date + "T00:00:00").toLocaleDateString("es-CO", { month: "short" })}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={cm.apptService} numberOfLines={1}>{a.serviceName}</Text>
                    <Text style={cm.apptTime}>{a.time}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 4 }}>
                    {perms.amounts && a.price > 0 && <Text style={cm.apptPrice}>{fmtMoneyFull(a.price)}</Text>}
                    <View style={[cm.statusPill, { backgroundColor: meta.color + "15" }]}>
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
  statsRow:    { backgroundColor: Colors.white, borderRadius: Radius.lg, flexDirection: "row", padding: 16, marginBottom: 0 },
  statBox:     { flex: 1, alignItems: "center", gap: 4 },
  statVal:     { fontSize: 18, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text },
  statLabel:   { fontSize: 10, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.subtle, textAlign: "center" },
  statDivider: { width: 1, backgroundColor: Colors.border },
  sectionLabel:{ fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", color: Colors.subtle, textTransform: "uppercase", letterSpacing: 0.8, marginTop: 20, marginBottom: 10 },
  emptyCard:   { backgroundColor: Colors.white, borderRadius: Radius.lg, padding: 24, alignItems: "center" },
  emptyTitle:  { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted },
  apptRow:     { backgroundColor: Colors.white, borderRadius: Radius.md, flexDirection: "row", alignItems: "center", gap: 12, padding: 12, marginBottom: 8 },
  dateBlock:   { width: 38, alignItems: "center", backgroundColor: Colors.cream2, borderRadius: 8, paddingVertical: 6 },
  dateDay:     { fontSize: 17, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text, lineHeight: 19 },
  dateMon:     { fontSize: 9, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.subtle, textTransform: "uppercase" },
  apptService: { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  apptTime:    { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, marginTop: 2 },
  apptPrice:   { fontSize: 12, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text },
  statusPill:  { borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  statusText:  { fontSize: 10, fontFamily: "SpaceGrotesk_600SemiBold" },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function StaffClientsScreen() {
  const { user } = useAuth();
  const { t } = useTheme();
  const [proId, setProId]           = useState<string | null>(null);
  const [perms, setPerms]           = useState<StaffPermissions>(DEFAULT_PERMISSIONS);
  const [clients, setClients]       = useState<ClientEntry[]>([]);
  const [filtered, setFiltered]     = useState<ClientEntry[]>([]);
  const [query, setQuery]           = useState("");
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected]     = useState<ClientEntry | null>(null);
  const [error, setError]           = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    supabase.from("professionals").select("id, permissions").eq("user_id", user.id).single()
      .then(({ data }) => {
        if (cancelled || !data) return;
        setProId(data.id);
        setPerms(parsePermissions(data.permissions));
      });
    return () => { cancelled = true; };
  }, [user]);

  const load = useCallback(async () => {
    if (!proId) return;
    setLoading(true);
    setError(false);
    try {
    // Últimos 12 meses, paginado: sin rango ni paginación Supabase corta en 1000 filas
    // en silencio y desaparecen clientes de la lista
    const PAGE = 1000;
    const appts: any[] = [];
    for (let from = 0; from < 5000; from += PAGE) {
      const { data: page, error: err } = await supabase
        .from("appointments")
        .select("appointment_date, client_id, status, clients(id,name,phone,email), services(name,price)")
        .eq("professional_id", proId)
        .not("client_id", "is", null)
        .gte("appointment_date", twelveMonthsAgo())
        .order("appointment_date", { ascending: false })
        .range(from, from + PAGE - 1);
      if (err) throw err;
      appts.push(...(page ?? []));
      if (!page || page.length < PAGE) break;
    }

    const map = new Map<string, ClientEntry>();
    (appts ?? []).forEach((a: any) => {
      const c = a.clients;
      if (!c) return;
      if (!map.has(c.id)) {
        map.set(c.id, {
          id: c.id, name: c.name, phone: c.phone ?? undefined, email: c.email ?? undefined,
          lastDate:       a.appointment_date,
          lastService:    a.services?.name ?? "—",
          apptCount:      1,
          completedCount: a.status === "completed" ? 1 : 0,
        });
      } else {
        const entry = map.get(c.id)!;
        entry.apptCount++;
        if (a.status === "completed") entry.completedCount++;
      }
    });

    const list = Array.from(map.values()).sort((a, b) => b.lastDate.localeCompare(a.lastDate));
    setClients(list);
    setFiltered(list);
    setLoading(false);
    } catch {
      setError(true);
      setLoading(false);
    }
  }, [proId]);

  useEffect(() => { if (proId) load(); }, [proId]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const handleSearch = (q: string) => {
    setQuery(q);
    const lq = q.toLowerCase();
    setFiltered(q
      ? clients.filter(c => c.name.toLowerCase().includes(lq) || (c.phone ?? "").includes(lq))
      : clients
    );
  };

  const renderItem = ({ item, index }: { item: ClientEntry; index: number }) => (
    <Animated.View entering={FadeInDown.delay(Math.min(index * 40, 400)).duration(300)}>
      <TouchableOpacity style={[s.card, Shadow.sm]} onPress={() => setSelected(item)} activeOpacity={0.8}>
        <Avatar name={item.name} />
        <View style={{ flex: 1 }}>
          <Text style={s.name} numberOfLines={1}>{item.name}</Text>
          <Text style={s.sub} numberOfLines={1}>
            {item.apptCount} cita{item.apptCount !== 1 ? "s" : ""} · último {fmtDateShort(item.lastDate)}
          </Text>
          {item.lastService !== "—" && (
            <Text style={s.service} numberOfLines={1}>{item.lastService}</Text>
          )}
        </View>
        <View style={s.actionBtns}>
          {perms.contact && item.phone && (
            <TouchableOpacity
              style={s.iconBtn}
              onPress={() => Linking.openURL(`https://wa.me/${item.phone!.replace(/\D/g, "")}`)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="logo-whatsapp" size={17} color="#25D366" />
            </TouchableOpacity>
          )}
          <Ionicons name="chevron-forward" size={16} color={Colors.subtle} />
        </View>
      </TouchableOpacity>
    </Animated.View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      {/* Header */}
      <View style={s.header}>
        <MonoTag>Clientes</MonoTag>
        <Text style={[s.headerTitle, { color: t.ink }]}>Mis Clientes</Text>
        <Text style={[s.headerSub, { color: t.muted }]}>
          {clients.length} cliente{clients.length !== 1 ? "s" : ""} atendido{clients.length !== 1 ? "s" : ""}
        </Text>
      </View>

      {/* Search */}
      <View style={s.searchWrap}>
        <View style={[s.searchBox, Shadow.sm, { backgroundColor: t.bgAlt }]}>
          <Ionicons name="search-outline" size={16} color={t.subtle} />
          <TextInput
            style={[s.searchInput, { color: t.text }]}
            value={query}
            onChangeText={handleSearch}
            placeholder="Buscar por nombre o teléfono..."
            placeholderTextColor={t.subtle}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => handleSearch("")}>
              <Ionicons name="close-circle" size={16} color={t.subtle} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {error ? (
        <ErrorState onRetry={load} />
      ) : loading ? (
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
          ListEmptyComponent={
            <Animated.View entering={FadeInDown.duration(350)} style={[s.empty, Shadow.sm]}>
              <Ionicons name="people-outline" size={40} color={Colors.subtle} style={{ marginBottom: 12 }} />
              <Text style={s.emptyTitle}>{query ? "Sin resultados" : "Sin clientes aún"}</Text>
              <Text style={s.emptySub}>
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
  searchBox:   { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: Colors.white, borderRadius: Radius.full, paddingHorizontal: 16, paddingVertical: 12 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "SpaceGrotesk_400Regular", color: Colors.text },

  card:        { backgroundColor: Colors.white, borderRadius: Radius.lg, flexDirection: "row", alignItems: "center", gap: 12, padding: 14, marginBottom: 10 },
  name:        { fontSize: 15, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  sub:         { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, marginTop: 2 },
  service:     { fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.subtle, marginTop: 2 },
  actionBtns:  { flexDirection: "row", alignItems: "center", gap: 10 },
  iconBtn:     { width: 34, height: 34, borderRadius: 17, backgroundColor: "#25D36615", alignItems: "center", justifyContent: "center" },

  empty:       { backgroundColor: Colors.white, borderRadius: Radius.xl, padding: 44, alignItems: "center", marginTop: 8 },
  emptyTitle:  { fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text, marginBottom: 6 },
  emptySub:    { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, textAlign: "center" },
});
