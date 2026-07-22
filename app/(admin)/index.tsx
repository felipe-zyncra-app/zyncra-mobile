import { useEffect, useState } from "react";
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl, Image, Modal, ActivityIndicator } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown, FadeInRight, FadeInUp, FadeIn } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { Colors, Gradients, Radius, Shadow } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { fmtMoney, localDateStr } from "@/lib/format";
import { STATUS_META } from "@/constants/status";
import { refreshAllReminders } from "@/lib/notifications";
import NewApptModal from "@/components/NewApptModal";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Buenos días";
  if (h < 18) return "Buenas tardes";
  return "Buenas noches";
}

type Appt = {
  id: string;
  appointment_date: string;
  appointment_time: string;
  status: string;
  clients: { name: string } | null;
  services: { name: string } | null;
};

// ─── Stat chip ────────────────────────────────────────────────────────────────

function StatChip({ icon, value, label, color, delay }: {
  icon: IoniconName; value: string; label: string; color: string; delay: number;
}) {
  const { t } = useTheme();
  return (
    <Animated.View entering={FadeInUp.delay(delay).duration(350).springify()} style={[sc.chip, Shadow.sm, { backgroundColor: t.card, borderColor: t.cardBorder }]}>
      <View style={[sc.iconBox, { backgroundColor: color + "15" }]}>
        <Ionicons name={icon} size={15} color={color} />
      </View>
      <Text style={[sc.value, { color }]}>{value}</Text>
      <Text style={[sc.label, { color: t.muted }]}>{label}</Text>
    </Animated.View>
  );
}

const sc = StyleSheet.create({
  chip:    { flex: 1, borderWidth: 1, borderRadius: Radius.lg, padding: 14, alignItems: "center", gap: 6 },
  iconBox: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  value:   { fontSize: 20, fontFamily: "SpaceGrotesk_700Bold", letterSpacing: -0.5 },
  label:   { fontSize: 10, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted, textAlign: "center" },
});

// ─── Appointment row ──────────────────────────────────────────────────────────

function ApptRow({ a, i, onPress }: { a: Appt; i: number; onPress: () => void }) {
  const { t, mode } = useTheme();
  const time  = a.appointment_time.substring(0, 5);
  const color = STATUS_META[a.status]?.color ?? Colors.subtle;
  const label = STATUS_META[a.status]?.label ?? a.status;
  const nowD  = new Date();
  const apptDt = new Date(`${a.appointment_date}T${a.appointment_time}`);
  const isNext = apptDt > nowD && (a.status === "confirmed" || a.status === "pending");

  return (
    <Animated.View entering={i < 10 ? FadeInRight.delay(i * 60).duration(320) : undefined}>
      <TouchableOpacity style={[ar.row, Shadow.sm, { backgroundColor: t.card, borderColor: t.cardBorder }]} onPress={onPress} activeOpacity={0.8}>
        <View style={[ar.accent, { backgroundColor: color }]} />

        <View style={[ar.timePill, { backgroundColor: color + "12" }]}>
          <Text style={[ar.time, { color }]}>{time}</Text>
        </View>

        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[ar.client, { color: t.text }]} numberOfLines={1}>{a.clients?.name ?? "Sin cliente"}</Text>
          <Text style={[ar.service, { color: t.muted }]} numberOfLines={1}>{a.services?.name ?? "Sin servicio"}</Text>
        </View>

        <View style={{ alignItems: "flex-end", gap: 4 }}>
          {isNext && (
            <View style={[ar.nextBadge, { backgroundColor: mode === "dark" ? "rgba(251,146,60,0.15)" : "#fff7ed" }]}>
              <Text style={[ar.nextText, { color: mode === "dark" ? "#fb923c" : "#c2410c" }]}>Próxima</Text>
            </View>
          )}
          <View style={[ar.badge, { backgroundColor: color + "15" }]}>
            <Text style={[ar.badgeText, { color }]}>{label}</Text>
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const ar = StyleSheet.create({
  row:       { borderWidth: 1, borderRadius: Radius.md, flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10, overflow: "hidden" },
  accent:    { width: 4, alignSelf: "stretch" },
  timePill:  { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, minWidth: 48, alignItems: "center" },
  time:      { fontSize: 13, fontFamily: "SpaceGrotesk_700Bold" },
  client:    { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  service:   { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted },
  badge:     { borderRadius: Radius.full, paddingHorizontal: 9, paddingVertical: 4 },
  badgeText: { fontSize: 10, fontFamily: "SpaceGrotesk_600SemiBold" },
  nextBadge: { backgroundColor: "#fff7ed", borderRadius: Radius.full, paddingHorizontal: 7, paddingVertical: 3 },
  nextText:  { fontSize: 9, fontFamily: "SpaceGrotesk_700Bold", color: "#c2410c" },
});

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const { tenantId } = useAuth();
  const [tenantName, setTenantName] = useState("Tu negocio");
  const [appts, setAppts]           = useState<Appt[]>([]);
  const [metrics, setMetrics]       = useState({ total: 0, confirmed: 0, clients: 0, revenueDay: 0, revenueMonth: 0 });
  const [refreshing, setRefreshing] = useState(false);
  const [showNew, setShowNew]       = useState(false);
  const [showNotif, setShowNotif]   = useState(false);
  const [notifItems, setNotifItems] = useState<any[]>([]);
  const [loadingNotif, setLoadingNotif] = useState(false);
  const [waUnread, setWaUnread]     = useState(0);

  const load = async () => {
    if (!tenantId) return;

    const { data: tenant } = await supabase
      .from("tenants").select("name").eq("id", tenantId).single();
    if (tenant) setTenantName(tenant.name);

    const now        = new Date();
    const dateStr    = localDateStr(now);
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const nextMonthStart = localDateStr(new Date(now.getFullYear(), now.getMonth() + 1, 1));
    // created_at es UTC: los límites del día/mes local se calculan como instantes, no como fecha recortada
    const monthStartIso  = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const dayStartMs     = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const dayEndMs       = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();

    const [{ data: todayAppts }, { count: clientCount }, { data: sales }, { data: monthAppts }] = await Promise.all([
      supabase.from("appointments")
        .select("id, appointment_date, appointment_time, status, clients(name), services(name, price)")
        .eq("tenant_id", tenantId)
        .eq("appointment_date", dateStr)
        .order("appointment_time"),
      supabase.from("clients").select("*", { count: "exact", head: true }).eq("tenant_id", tenantId),
      supabase.from("pos_sales").select("total, created_at, appointment_id").eq("tenant_id", tenantId).gte("created_at", monthStartIso),
      supabase.from("appointments")
        .select("id, status, services(price)")
        .eq("tenant_id", tenantId)
        .gte("appointment_date", monthStart.slice(0, 10))
        .lt("appointment_date", nextMonthStart)
        .eq("status", "completed")
        .limit(2000),
    ]);

    const all      = (todayAppts as unknown as Appt[]) ?? [];
    const allSales = sales ?? [];
    // Citas cobradas por POS ya están en pos_sales — se excluyen para no contarlas doble
    const saleApptIds = new Set(allSales.map((s: any) => s.appointment_id).filter(Boolean));
    const getApptPrice = (a: any) => Number((Array.isArray(a.services) ? a.services[0] : a.services)?.price ?? 0);
    const posDay   = allSales.filter(s => { const t = new Date(s.created_at).getTime(); return t >= dayStartMs && t < dayEndMs; }).reduce((acc, s) => acc + Number(s.total ?? 0), 0);
    const posMonth = allSales.reduce((acc, s) => acc + Number(s.total ?? 0), 0);
    const apptDay  = all.filter(a => a.status === "completed" && !saleApptIds.has(a.id)).reduce((acc, a) => acc + getApptPrice(a), 0);
    const apptMonth = (monthAppts ?? []).filter((a: any) => !saleApptIds.has(a.id)).reduce((acc: number, a: any) => acc + getApptPrice(a), 0);
    const revenueDay   = posDay + apptDay;
    const revenueMonth = posMonth + apptMonth;

    setAppts(all);
    setMetrics({ total: all.length, confirmed: all.filter(a => a.status === "confirmed").length, clients: clientCount ?? 0, revenueDay, revenueMonth });
  };

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      await load();
      if (!cancelled) refreshAllReminders();
    };
    run();
    return () => { cancelled = true; };
  }, [tenantId]);

  // Chats de WhatsApp sin leer — badge del acceso rápido en la barra superior
  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    const loadUnread = async () => {
      const { data } = await supabase
        .from("wa_chats").select("unread").eq("tenant_id", tenantId).gt("unread", 0);
      if (!cancelled) setWaUnread((data ?? []).reduce((s: number, r: any) => s + (r.unread || 0), 0));
    };
    loadUnread();
    const id = setInterval(loadUnread, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, [tenantId]);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const openNotifications = async () => {
    if (!tenantId) return;
    setShowNotif(true);
    setLoadingNotif(true);
    const { data } = await supabase
      .from("appointments")
      .select("id, status, updated_at, appointment_date, appointment_time, clients(name), services(name)")
      .eq("tenant_id", tenantId)
      .order("updated_at", { ascending: false })
      .limit(30);
    setNotifItems(data ?? []);
    setLoadingNotif(false);
  };

  function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "ahora mismo";
    if (mins < 60) return `hace ${mins} min`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `hace ${hrs}h`;
    const days = Math.floor(hrs / 24);
    return `hace ${days}d`;
  }

  const now = new Date();
  const todayLabel = now.toLocaleDateString("es-CO", { weekday: "short", day: "numeric", month: "short" });
  const pendingCount = appts.filter(a => a.status === "pending" || a.status === "confirmed").length;

  const nextAppt = appts.find(a => {
    const dt = new Date(`${a.appointment_date}T${a.appointment_time}`);
    return dt > now && (a.status === "confirmed" || a.status === "pending");
  });
  const nextTime = nextAppt ? nextAppt.appointment_time.substring(0, 5) : null;
  const nextHour = nextTime ? (() => { const h = parseInt(nextTime.slice(0, 2), 10); return `${h % 12 || 12}:${nextTime.slice(3)} ${h >= 12 ? "PM" : "AM"}`; })() : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.red} />}
      >
        {/* ── Header ── */}
        <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.headerGrad}>
          <View style={s.headerBlob1} />
          <View style={s.headerBlob2} />
          <View style={s.headerBlob3} />

          {/* Top bar: logo + chats + bell */}
          <Animated.View entering={FadeIn.duration(350)} style={s.topBar}>
            <View style={s.logoRow}>
              <Image source={require("@/assets/zyncra-logo.png")} style={s.logoImg} />
              <Text style={s.logoText}>Zyncra</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              {/* Chats de WhatsApp: acceso de un toque — es uso diario */}
              <TouchableOpacity style={s.bellBtn} activeOpacity={0.7}
                onPress={() => router.navigate("/(admin)/inbox" as any)}>
                <Ionicons name="chatbubble-ellipses-outline" size={18} color="white" />
                {waUnread > 0 && (
                  <View style={s.waBadge}>
                    <Text style={s.waBadgeText}>{waUnread > 9 ? "9+" : waUnread}</Text>
                  </View>
                )}
              </TouchableOpacity>
              <TouchableOpacity style={s.bellBtn} activeOpacity={0.7} onPress={openNotifications}>
                <Ionicons name="notifications-outline" size={18} color="white" />
              </TouchableOpacity>
            </View>
          </Animated.View>

          {/* Hero content */}
          <Animated.View entering={FadeInDown.duration(400)} style={s.heroContent}>
            <View style={s.heroLeft}>
              <Text style={s.greeting}>{greeting()} 👋</Text>
              <Text style={s.bizName} numberOfLines={2}>{tenantName}</Text>
              <Text style={s.date}>{todayLabel}</Text>
            </View>

            {nextAppt && (
              <Animated.View entering={FadeIn.delay(300).duration(400)} style={s.nextCard}>
                <Ionicons name="time-outline" size={14} color="white" />
                <Text style={s.nextTime}>{nextHour}</Text>
                <Text style={s.nextLabel}>próxima</Text>
              </Animated.View>
            )}
          </Animated.View>

          {/* Glass summary strip */}
          <Animated.View entering={FadeInDown.delay(150).duration(400)} style={s.summaryStrip}>
            <View style={s.summaryItem}>
              <Ionicons name="calendar" size={13} color="rgba(255,255,255,.9)" />
              <Text style={s.summaryText}>
                {metrics.total} cita{metrics.total !== 1 ? "s" : ""} hoy
              </Text>
            </View>
            {metrics.revenueDay > 0 && (
              <>
                <View style={s.summaryDivider} />
                <View style={s.summaryItem}>
                  <Ionicons name="cash" size={13} color="rgba(255,255,255,.9)" />
                  <Text style={s.summaryText}>{fmtMoney(metrics.revenueDay)} cobrado</Text>
                </View>
              </>
            )}
            {metrics.confirmed > 0 && (
              <>
                <View style={s.summaryDivider} />
                <View style={s.summaryItem}>
                  <Ionicons name="checkmark-circle" size={13} color="rgba(255,255,255,.9)" />
                  <Text style={s.summaryText}>{metrics.confirmed} confirm.</Text>
                </View>
              </>
            )}
          </Animated.View>
        </LinearGradient>

        <View style={{ paddingHorizontal: 20, paddingTop: 20, gap: 12 }}>

          {/* ── Revenue hero card ── */}
          <Animated.View entering={FadeInDown.delay(120).duration(400)}>
            <View style={[s.revenueCard, Shadow.md]}>
              <LinearGradient colors={Gradients.ink} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.revenueGrad}>
                <View style={s.revenueBlob} />
                <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}>
                  <View>
                    <Text style={s.revenueLabel}>Ingresos del mes</Text>
                    <Text style={s.revenueValue}>{fmtMoney(metrics.revenueMonth)}</Text>
                    <View style={s.revenueSub}>
                      <View style={[s.revenueDot, { backgroundColor: metrics.revenueDay > 0 ? Colors.success : Colors.subtle }]} />
                      <Text style={s.revenueSubText}>
                        {metrics.revenueDay > 0 ? `${fmtMoney(metrics.revenueDay)} hoy` : "Sin cobros hoy"}
                      </Text>
                    </View>
                  </View>
                  <View style={s.revenueBadge}>
                    <Ionicons name="trending-up-outline" size={18} color="white" />
                  </View>
                </View>

                {/* mini breakdown bar */}
                {pendingCount > 0 && (
                  <View style={s.projectedRow}>
                    <Ionicons name="time-outline" size={12} color="rgba(255,255,255,.5)" />
                    <Text style={s.projectedText}>{pendingCount} cita{pendingCount !== 1 ? "s" : ""} pendiente{pendingCount !== 1 ? "s" : ""} por cobrar</Text>
                  </View>
                )}
              </LinearGradient>
            </View>
          </Animated.View>

          {/* ── Stat chips ── */}
          <View style={{ flexDirection: "row", gap: 10 }}>
            <StatChip icon="calendar-outline"        value={String(metrics.total)}     label="Citas hoy"    color={Colors.red}     delay={160} />
            <StatChip icon="checkmark-circle-outline" value={String(metrics.confirmed)} label="Confirmadas"  color={Colors.success} delay={220} />
            <StatChip icon="people-outline"           value={String(metrics.clients)}   label="Clientes"     color={Colors.purple}  delay={280} />
          </View>

          {/* ── Quick access ── */}
          <Animated.View entering={FadeInDown.delay(300).duration(380)}>
            <TouchableOpacity
              style={[s.reportsBtn, { backgroundColor: t.card, borderColor: t.cardBorder }]}
              onPress={() => router.navigate("/(admin)/reports" as any)}
              activeOpacity={0.85}
            >
              <View style={s.reportsBtnIcon}>
                <Ionicons name="bar-chart-outline" size={16} color={Colors.red} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.reportsBtnTitle, { color: t.text }]}>Ver Reportes</Text>
                <Text style={[s.reportsBtnSub, { color: t.muted }]}>Ingresos, servicios, equipo</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={t.subtle} />
            </TouchableOpacity>
          </Animated.View>

          {/* ── Today's agenda ── */}
          <Animated.View entering={FadeInDown.delay(360).duration(380)} style={{ marginTop: 8 }}>
            <View style={s.sectionHeader}>
              <Text style={[s.sectionTitle, { color: t.text }]}>Agenda de hoy</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <TouchableOpacity style={s.newCitaBtn} onPress={() => setShowNew(true)} activeOpacity={0.8}>
                  <Ionicons name="add" size={14} color="white" />
                  <Text style={s.newCitaBtnText}>Nueva cita</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => router.navigate("/agenda" as any)} activeOpacity={0.7}>
                  <Text style={s.sectionLink}>Ver todo →</Text>
                </TouchableOpacity>
              </View>
            </View>

            {appts.length === 0 ? (
              <View style={[s.empty, Shadow.sm]}>
                <LinearGradient colors={[t.bgAlt, t.bg]} style={s.emptyInner}>
                  <View style={[s.emptyIcon, { backgroundColor: t.card }]}>
                    <Ionicons name="calendar-outline" size={28} color={t.subtle} />
                  </View>
                  <Text style={[s.emptyTitle, { color: t.text }]}>Sin citas para hoy</Text>
                  <Text style={[s.emptySub, { color: t.muted }]}>Agenda la primera cita del día</Text>
                  <TouchableOpacity style={s.emptyBtn} onPress={() => setShowNew(true)} activeOpacity={0.8}>
                    <Ionicons name="add" size={15} color="white" />
                    <Text style={s.emptyBtnText}>Agendar cita</Text>
                  </TouchableOpacity>
                </LinearGradient>
              </View>
            ) : (
              appts.map((a, i) => (
                <ApptRow
                  key={a.id}
                  a={a}
                  i={i}
                  onPress={() => router.navigate("/agenda" as any)}
                />
              ))
            )}
          </Animated.View>
        </View>

        <View style={{ height: 110 }} />
      </ScrollView>

      {tenantId && (
        <NewApptModal
          visible={showNew}
          onClose={() => setShowNew(false)}
          tenantId={tenantId}
          initialDate={new Date()}
          onSuccess={load}
        />
      )}

      {/* ── Notifications sheet ── */}
      <Modal visible={showNotif} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowNotif(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
          {/* Header */}
          <View style={ns.header}>
            <View>
              <Text style={[ns.title, { color: t.text }]}>Notificaciones</Text>
              <Text style={[ns.sub, { color: t.muted }]}>Actividad reciente</Text>
            </View>
            <TouchableOpacity style={[ns.closeBtn, { backgroundColor: t.card, borderColor: t.cardBorder }]} onPress={() => setShowNotif(false)} activeOpacity={0.7}>
              <Ionicons name="close" size={18} color={t.subtle} />
            </TouchableOpacity>
          </View>

          {loadingNotif ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <ActivityIndicator color={Colors.red} size="large" />
            </View>
          ) : notifItems.length === 0 ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 10 }}>
              <Ionicons name="notifications-off-outline" size={40} color={t.subtle} />
              <Text style={{ fontFamily: "SpaceGrotesk_600SemiBold", fontSize: 15, color: t.text }}>Sin actividad reciente</Text>
              <Text style={{ fontFamily: "SpaceGrotesk_400Regular", fontSize: 13, color: t.muted }}>Las citas y cambios aparecerán aquí</Text>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              {notifItems.map((item, idx) => {
                const NOTIF_META: Record<string, { icon: IoniconName; color: string; label: string }> = {
                  pending:   { icon: "time-outline",            color: "#f59e0b", label: "Nueva reserva"       },
                  confirmed: { icon: "checkmark-circle-outline", color: "#10b981", label: "Cita confirmada"    },
                  cancelled: { icon: "close-circle-outline",    color: "#ef4444", label: "Cita cancelada"      },
                  completed: { icon: "trophy-outline",          color: Colors.purple ?? "#7c3aed", label: "Cita completada" },
                  rescheduled:{ icon: "repeat-outline",         color: "#6366f1", label: "Cita reagendada"     },
                };
                const meta = NOTIF_META[item.status] ?? { icon: "calendar-outline" as IoniconName, color: t.subtle, label: item.status };
                const clientName = (item.clients as any)?.name ?? "Cliente";
                const serviceName = (item.services as any)?.name ?? "Servicio";
                const apptDate = new Date(item.appointment_date + "T" + item.appointment_time);
                const dateLabel = apptDate.toLocaleDateString("es-CO", { day: "numeric", month: "short" });
                const timeLabel = apptDate.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });

                return (
                  <View key={item.id} style={[ns.item, { borderBottomColor: t.divider }, idx === 0 && { borderTopWidth: 1, borderTopColor: t.divider }]}>
                    <View style={[ns.iconBox, { backgroundColor: meta.color + "18" }]}>
                      <Ionicons name={meta.icon as IoniconName} size={18} color={meta.color} />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={[ns.itemTitle, { color: t.text }]}>{meta.label}</Text>
                      <Text style={[ns.itemSub, { color: t.muted }]} numberOfLines={1}>{clientName} · {serviceName}</Text>
                      <Text style={[ns.itemDate, { color: t.subtle }]}>{dateLabel} {timeLabel} · {timeAgo(item.updated_at)}</Text>
                    </View>
                  </View>
                );
              })}
              <View style={{ height: 40 }} />
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const ns = StyleSheet.create({
  header:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 18 },
  title:     { fontSize: 22, fontFamily: "SpaceGrotesk_700Bold", letterSpacing: -0.5 },
  sub:       { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", marginTop: 2 },
  closeBtn:  { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  item:      { flexDirection: "row", alignItems: "flex-start", gap: 14, paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1 },
  iconBox:   { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center", marginTop: 1 },
  itemTitle: { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold" },
  itemSub:   { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular" },
  itemDate:  { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", marginTop: 1 },
});

const s = StyleSheet.create({
  headerGrad:    { paddingTop: 14, paddingBottom: 20, overflow: "hidden" },
  headerBlob1:   { position: "absolute", width: 260, height: 260, borderRadius: 130, backgroundColor: "rgba(255,255,255,.07)", top: -90, right: -70 },
  headerBlob2:   { position: "absolute", width: 140, height: 140, borderRadius: 70, backgroundColor: "rgba(0,0,0,.06)", bottom: -40, left: -30 },
  headerBlob3:   { position: "absolute", width: 80, height: 80, borderRadius: 40, backgroundColor: "rgba(255,255,255,.05)", top: 60, left: "40%" as any },

  topBar:        { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, marginBottom: 20, position: "relative", zIndex: 1 },
  logoRow:       { flexDirection: "row", alignItems: "center", gap: 8 },
  logoImg:       { width: 28, height: 28, borderRadius: 8 },
  logoText:      { fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", color: "white", letterSpacing: -0.3 },
  bellBtn:       { width: 38, height: 38, borderRadius: 19, backgroundColor: "rgba(255,255,255,.15)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.25)" },
  waBadge:       { position: "absolute", top: -3, right: -3, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: "#25D366", alignItems: "center", justifyContent: "center", paddingHorizontal: 4, borderWidth: 1.5, borderColor: "#14111C" },
  waBadgeText:   { fontSize: 9.5, fontFamily: "SpaceGrotesk_700Bold", color: "white" },

  heroContent:   { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", paddingHorizontal: 24, marginBottom: 18, position: "relative", zIndex: 1 },
  heroLeft:      { flex: 1, marginRight: 16 },
  greeting:      { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: "rgba(255,255,255,.75)", marginBottom: 6 },
  bizName:       { fontSize: 30, fontFamily: "SpaceGrotesk_700Bold", color: "white", letterSpacing: -1, lineHeight: 34 },
  date:          { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: "rgba(255,255,255,.6)", marginTop: 6, textTransform: "capitalize" },

  nextCard:      { backgroundColor: "rgba(255,255,255,.18)", borderRadius: Radius.lg, paddingVertical: 12, paddingHorizontal: 14, alignItems: "center", gap: 4, borderWidth: 1, borderColor: "rgba(255,255,255,0.25)", minWidth: 76 },
  nextTime:      { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
  nextLabel:     { fontSize: 10, fontFamily: "SpaceGrotesk_600SemiBold", color: "rgba(255,255,255,.7)", textTransform: "uppercase", letterSpacing: 0.5 },

  summaryStrip:  { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 0, marginHorizontal: 20, backgroundColor: "rgba(255,255,255,.14)", borderRadius: Radius.full, paddingVertical: 10, paddingHorizontal: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.2)", position: "relative", zIndex: 1 },
  summaryItem:   { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 6 },
  summaryDivider:{ width: 1, height: 14, backgroundColor: "rgba(255,255,255,.25)", marginHorizontal: 4 },
  summaryText:   { fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold", color: "rgba(255,255,255,.9)" },

  revenueCard:   { borderRadius: Radius.xl, overflow: "hidden" },
  revenueGrad:   { padding: 20, overflow: "hidden" },
  revenueBlob:   { position: "absolute", width: 180, height: 180, borderRadius: 90, backgroundColor: "rgba(255,255,255,.04)", top: -50, right: -40 },
  revenueLabel:  { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: "rgba(255,255,255,.55)", marginBottom: 6 },
  revenueValue:  { fontSize: 36, fontFamily: "SpaceGrotesk_700Bold", color: "white", letterSpacing: -1.5 },
  revenueSub:    { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  revenueDot:    { width: 7, height: 7, borderRadius: 4 },
  revenueSubText:{ fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: "rgba(255,255,255,.6)" },
  revenueBadge:  { width: 44, height: 44, borderRadius: 14, backgroundColor: "rgba(255,255,255,.12)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.18)" },
  projectedRow:  { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,.08)" },
  projectedText: { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: "rgba(255,255,255,.45)" },

  sectionHeader:    { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  sectionTitle:     { fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text, letterSpacing: -0.3 },
  sectionLink:      { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.red },
  newCitaBtn:       { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: Radius.full, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: Colors.red },
  newCitaBtnText:   { fontSize: 12, fontFamily: "SpaceGrotesk_700Bold", color: "white" },

  reportsBtn:       { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: Radius.lg, padding: 14, ...Shadow.sm },
  reportsBtnIcon:   { width: 36, height: 36, borderRadius: 11, backgroundColor: Colors.red + "14", alignItems: "center", justifyContent: "center" },
  reportsBtnTitle:  { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  reportsBtnSub:    { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, marginTop: 1 },

  empty:         { borderRadius: Radius.xl, overflow: "hidden" },
  emptyInner:    { padding: 36, alignItems: "center" },
  emptyIcon:     { width: 60, height: 60, borderRadius: 20, backgroundColor: Colors.white, alignItems: "center", justifyContent: "center", marginBottom: 14, ...Shadow.sm },
  emptyTitle:    { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text, marginBottom: 6 },
  emptySub:      { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, textAlign: "center", lineHeight: 19, marginBottom: 20 },
  emptyBtn:      { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: Radius.full, paddingVertical: 11, paddingHorizontal: 20, backgroundColor: Colors.red },
  emptyBtnText:  { fontSize: 13, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
});
