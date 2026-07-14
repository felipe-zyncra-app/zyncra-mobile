import { useEffect, useState } from "react";
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl, Image } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown, FadeInRight, FadeInUp, FadeIn } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { Colors, Gradients, Radius, Shadow, Glass } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { fmtMoney } from "@/lib/format";
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
  chip:    { flex: 1, ...Glass.card, borderRadius: Radius.lg, padding: 14, alignItems: "center", gap: 6 },
  iconBox: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  value:   { fontSize: 20, fontFamily: "SpaceGrotesk_700Bold", letterSpacing: -0.5 },
  label:   { fontSize: 10, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted, textAlign: "center" },
});

// ─── Appointment row ──────────────────────────────────────────────────────────

function ApptRow({ a, i, onPress }: { a: Appt; i: number; onPress: () => void }) {
  const { t } = useTheme();
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
            <View style={ar.nextBadge}>
              <Text style={ar.nextText}>Próxima</Text>
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
  row:       { ...Glass.cardStrong, borderRadius: Radius.md, flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10, overflow: "hidden" },
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
  const { tenant: tenantData } = useTenant();
  const tenantName = tenantData?.name ?? "Tu negocio";
  const [appts, setAppts]           = useState<Appt[]>([]);
  const [metrics, setMetrics]       = useState({ total: 0, confirmed: 0, clients: 0, revenueDay: 0, revenueMonth: 0 });
  const [refreshing, setRefreshing] = useState(false);
  const [showNew, setShowNew]       = useState(false);

  const load = async () => {
    if (!tenantId) return;

    const now        = new Date();
    const dateStr    = now.toISOString().split("T")[0];
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

    const [{ data: todayAppts }, { count: clientCount }, { data: sales }, { data: monthAppts }] = await Promise.all([
      supabase.from("appointments")
        .select("id, appointment_date, appointment_time, status, clients(name), services(name, price)")
        .eq("tenant_id", tenantId)
        .eq("appointment_date", dateStr)
        .order("appointment_time"),
      supabase.from("clients").select("*", { count: "exact", head: true }).eq("tenant_id", tenantId),
      supabase.from("pos_sales").select("total, created_at").eq("tenant_id", tenantId).gte("created_at", monthStart),
      supabase.from("appointments")
        .select("status, services(price)")
        .eq("tenant_id", tenantId)
        .gte("appointment_date", monthStart.slice(0, 10))
        .in("status", ["completed", "confirmed"])
        .limit(2000),
    ]);

    const all      = (todayAppts as unknown as Appt[]) ?? [];
    const allSales = sales ?? [];
    const getApptPrice = (a: any) => Number((Array.isArray(a.services) ? a.services[0] : a.services)?.price ?? 0);
    const posDay   = allSales.filter(s => s.created_at?.slice(0, 10) === dateStr).reduce((acc, s) => acc + Number(s.total ?? 0), 0);
    const posMonth = allSales.reduce((acc, s) => acc + Number(s.total ?? 0), 0);
    const apptDay  = all.filter(a => a.status === "completed" || a.status === "confirmed").reduce((acc, a) => acc + getApptPrice(a), 0);
    const apptMonth = (monthAppts ?? []).reduce((acc: number, a: any) => acc + getApptPrice(a), 0);
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
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

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

          {/* Top bar: logo + bell */}
          <Animated.View entering={FadeIn.duration(350)} style={s.topBar}>
            <View style={s.logoRow}>
              <Image source={require("@/assets/zyncra-logo.png")} style={s.logoImg} />
              <Text style={s.logoText}>Zyncra</Text>
            </View>
            <TouchableOpacity style={s.bellBtn} activeOpacity={0.7}>
              <Ionicons name="notifications-outline" size={18} color="white" />
            </TouchableOpacity>
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
              <LinearGradient colors={["#1a1a2e", "#16213e"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.revenueGrad}>
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
                <LinearGradient colors={["#f8f7f5", Colors.cream2]} style={s.emptyInner}>
                  <View style={s.emptyIcon}>
                    <Ionicons name="calendar-outline" size={28} color={Colors.subtle} />
                  </View>
                  <Text style={s.emptyTitle}>Sin citas para hoy</Text>
                  <Text style={s.emptySub}>Agenda la primera cita del día</Text>
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
    </SafeAreaView>
  );
}

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

  reportsBtn:       { flexDirection: "row", alignItems: "center", gap: 12, ...Glass.cardStrong, borderRadius: Radius.lg, padding: 14, ...Shadow.sm },
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
