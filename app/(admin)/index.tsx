import { useEffect, useState } from "react";
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown, FadeInRight } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { Colors, Fonts, Gradients, CardStyle } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { fmtMoney } from "@/lib/format";
import { STATUS_META } from "@/constants/status";
import { refreshAllReminders } from "@/lib/notifications";
import NewApptModal from "@/components/NewApptModal";
import { Card, CardHead, MonoTag, TrendChip, TenantBadge, SegmentedControl, useCountUp } from "@/components/ui";
import { Spark, AreaChart, Bars, Donut, RankBars, ChartEmpty } from "@/components/charts";

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
  services: { name: string; price?: number | string } | null;
};

type Period = "hoy" | "semana" | "mes";

// ─── Date helpers (fechas locales, igual que el portal web) ──────────────────
const toISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
const getPrice = (a: Appt): number => {
  const n = parseFloat(String(a.services?.price ?? 0));
  return Number.isFinite(n) ? n : 0;
};

const HOURS = ["08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19"];
const DAY_NAMES = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MONTHS_S = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

// Medios de pago — mismos colores que el portal web (PM_META de admin/page.tsx)
const PM_META: Record<string, { label: string; color: string }> = {
  efectivo:  { label: "Efectivo",  color: "#10b981" },
  tarjeta:   { label: "Tarjeta",   color: "#6366f1" },
  nequi:     { label: "Nequi",     color: "#0027fe" },
  daviplata: { label: "Daviplata", color: "#f59e0b" },
};

// ─── Hero Card (ingresos) — única firma de gradiente de la vista ─────────────
function HeroCard({ label, raw, tag, trend, trendVal, sub, spark }: {
  label: string; raw: number; tag: string;
  trend?: "up" | "down" | "neutral"; trendVal?: string; sub?: string;
  spark: number[];
}) {
  const v = useCountUp(raw, 800);
  return (
    <Animated.View entering={FadeInDown.duration(400)} style={hs.card}>
      <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={hs.topBar} />
      <View style={hs.glowBlue} />
      <View style={hs.glowRed} />

      <View style={hs.rowTop}>
        <Text style={hs.label}>{label}</Text>
        <View style={hs.tag}><Text style={hs.tagText}>{tag}</Text></View>
      </View>

      <View style={hs.rowBottom}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={hs.value} numberOfLines={1} adjustsFontSizeToFit>{fmtMoney(v)}</Text>
          <View style={hs.subRow}>
            {trend && trendVal ? <TrendChip trend={trend} label={trendVal} onDark /> : null}
            {sub ? <Text style={hs.sub}>{sub}</Text> : null}
          </View>
        </View>
        <Spark data={spark} w={104} h={34} light />
      </View>
    </Animated.View>
  );
}

const hs = StyleSheet.create({
  card:    { backgroundColor: "#0C0C14", borderRadius: 16, padding: 18, overflow: "hidden", minHeight: 128, justifyContent: "space-between", borderWidth: 1, borderColor: "rgba(255,255,255,0.06)" },
  topBar:  { position: "absolute", top: 0, left: 0, right: 0, height: 3 },
  glowBlue:{ position: "absolute", right: -70, top: -70, width: 230, height: 230, borderRadius: 115, backgroundColor: "rgba(0,39,254,0.22)" },
  glowRed: { position: "absolute", left: -50, bottom: -80, width: 190, height: 190, borderRadius: 95, backgroundColor: "rgba(251,15,5,0.12)" },
  rowTop:  { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  label:   { fontSize: 9.5, fontFamily: Fonts.mono, color: "rgba(255,255,255,0.55)", textTransform: "uppercase", letterSpacing: 1.2 },
  tag:     { borderWidth: 1, borderColor: "rgba(255,255,255,0.14)", borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2 },
  tagText: { fontSize: 9, fontFamily: Fonts.mono, color: "rgba(255,255,255,0.38)", textTransform: "uppercase", letterSpacing: 1 },
  rowBottom: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: 12, marginTop: 14 },
  value:   { fontSize: 30, fontFamily: Fonts.bold, color: "white", letterSpacing: -1.2, lineHeight: 32 },
  subRow:  { flexDirection: "row", gap: 8, alignItems: "center", marginTop: 9, flexWrap: "wrap" },
  sub:     { fontSize: 11.5, fontFamily: Fonts.regular, color: "rgba(255,255,255,0.45)" },
});

// ─── Metric Card ──────────────────────────────────────────────────────────────
function MetricCard({ label, raw, fmt, sub, icon, trend, trendVal, alert, spark, delay = 0 }: {
  label: string; raw: number; fmt: (n: number) => string;
  sub?: string; icon: IoniconName;
  trend?: "up" | "down" | "neutral"; trendVal?: string;
  alert?: boolean; spark?: number[]; delay?: number;
}) {
  const { t } = useTheme();
  const v = useCountUp(raw);
  return (
    <Animated.View
      entering={FadeInDown.delay(delay).duration(400)}
      style={[CardStyle.base, ms.card, {
        backgroundColor: t.cardSolid,
        borderColor: alert ? "rgba(251,15,5,0.32)" : t.line,
      }]}
    >
      {alert && (
        <LinearGradient colors={["#fb0f05", "#f97316"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={ms.alertBar} />
      )}
      <View style={ms.rowTop}>
        <MonoTag>{label}</MonoTag>
        <Ionicons name={icon} size={15} color={alert ? Colors.red : t.subtle} />
      </View>
      <View style={ms.rowValue}>
        <Text style={[ms.value, { color: alert ? "#dc2626" : t.ink }]} numberOfLines={1} adjustsFontSizeToFit>
          {fmt(v)}
        </Text>
        {spark && spark.some(x => x > 0) ? <Spark data={spark} w={58} h={22} /> : null}
      </View>
      {(trendVal || sub) ? (
        <View style={ms.rowSub}>
          {trendVal && trend ? <TrendChip trend={trend} label={trendVal} /> : null}
          {sub ? <Text style={[ms.sub, { color: t.subtle }]} numberOfLines={1}>{sub}</Text> : null}
        </View>
      ) : null}
    </Animated.View>
  );
}

const ms = StyleSheet.create({
  card:     { padding: 15, overflow: "hidden", width: "48.5%" as any, flexGrow: 1 },
  alertBar: { position: "absolute", top: 0, left: 0, right: 0, height: 2.5 },
  rowTop:   { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  rowValue: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: 8, marginTop: 10 },
  value:    { fontSize: 22, fontFamily: Fonts.bold, letterSpacing: -0.8, lineHeight: 24, flexShrink: 1 },
  rowSub:   { flexDirection: "row", gap: 7, alignItems: "center", marginTop: 9, flexWrap: "wrap" },
  sub:      { fontSize: 11, fontFamily: Fonts.regular, flexShrink: 1 },
});

// ─── Fila de cita (listItem del web) ─────────────────────────────────────────
function ApptRow({ a, i, last, onPress }: { a: Appt; i: number; last: boolean; onPress: () => void }) {
  const { t } = useTheme();
  const time  = a.appointment_time.substring(0, 5);
  const color = STATUS_META[a.status]?.color ?? Colors.subtle;
  const label = STATUS_META[a.status]?.label ?? a.status;

  return (
    <Animated.View entering={i < 10 ? FadeInRight.delay(i * 50).duration(300) : undefined}>
      <TouchableOpacity
        style={[apt.row, !last && { borderBottomWidth: 1, borderBottomColor: t.divider }]}
        onPress={onPress}
        activeOpacity={0.6}
      >
        <Text style={[apt.time, { color: t.ink }]}>{time}</Text>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[apt.client, { color: t.ink }]} numberOfLines={1}>{a.clients?.name ?? "Sin cliente"}</Text>
          <Text style={[apt.service, { color: t.subtle }]} numberOfLines={1}>{a.services?.name ?? "Sin servicio"}</Text>
        </View>
        <View style={[apt.pill, { backgroundColor: color + "14" }]}>
          <View style={[apt.pillDot, { backgroundColor: color }]} />
          <Text style={[apt.pillText, { color }]}>{label}</Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const apt = StyleSheet.create({
  row:      { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 11 },
  time:     { fontSize: 12, fontFamily: Fonts.mono, minWidth: 42 },
  client:   { fontSize: 13.5, fontFamily: Fonts.semibold },
  service:  { fontSize: 11.5, fontFamily: Fonts.regular, marginTop: 1 },
  pill:     { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 20, paddingHorizontal: 9, paddingVertical: 3 },
  pillDot:  { width: 5, height: 5, borderRadius: 2.5 },
  pillText: { fontSize: 10.5, fontFamily: Fonts.semibold },
});

// ─── Dashboard ────────────────────────────────────────────────────────────────

type DashData = {
  revenue: number;
  prevRevenue: number;
  apptCount: number;
  confirmed: number;
  pending: number;
  avgTicket: number;
  clients: number;
  revenueSeries: { label: string; value: number }[];
  hourly: { label: string; value: number }[];
  topServices: { label: string; value: number; sub?: string }[];
  payments: { label: string; value: number; color: string }[];
  todayAppts: Appt[];
};

const EMPTY_DATA: DashData = {
  revenue: 0, prevRevenue: 0, apptCount: 0, confirmed: 0, pending: 0,
  avgTicket: 0, clients: 0, revenueSeries: [], hourly: [], topServices: [],
  payments: [], todayAppts: [],
};

export default function DashboardScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const { tenantId } = useAuth();
  const { tenant: tenantData } = useTenant();
  const tenantName = tenantData?.name ?? "Tu negocio";

  const [period, setPeriod]         = useState<Period>("hoy");
  const [data, setData]             = useState<DashData>(EMPTY_DATA);
  const [refreshing, setRefreshing] = useState(false);
  const [showNew, setShowNew]       = useState(false);

  const load = async (p: Period = period) => {
    if (!tenantId) return;

    const now      = new Date();
    const todayISO = toISO(now);
    const startD   = p === "hoy" ? now : addDays(now, p === "semana" ? -6 : -29);
    const startISO = toISO(startD);
    // Para "hoy" se trae también ayer, para la tendencia vs ayer
    const fetchStartISO = p === "hoy" ? toISO(addDays(now, -1)) : startISO;

    const [{ data: apptsRaw }, { data: posRaw }, { count: clientCount }] = await Promise.all([
      supabase.from("appointments")
        .select("id, appointment_date, appointment_time, status, clients(name), services(name, price)")
        .eq("tenant_id", tenantId)
        .gte("appointment_date", fetchStartISO)
        .lte("appointment_date", todayISO)
        .order("appointment_date").order("appointment_time")
        .limit(2000),
      supabase.from("pos_sales")
        .select("total, created_at, payment_method")
        .eq("tenant_id", tenantId)
        .gte("created_at", `${fetchStartISO}T00:00:00`)
        .lte("created_at", `${todayISO}T23:59:59`),
      supabase.from("clients").select("*", { count: "exact", head: true }).eq("tenant_id", tenantId),
    ]);

    const allAppts = (apptsRaw as unknown as Appt[]) ?? [];
    const allPos   = posRaw ?? [];
    const inPeriod = (dateISO: string) => dateISO >= startISO && dateISO <= todayISO;

    const appts = allAppts.filter(a => inPeriod(a.appointment_date));
    const pos   = allPos.filter(sale => inPeriod((sale.created_at ?? "").slice(0, 10)));

    const isPaidStatus = (st: string) => st === "completed" || st === "confirmed";
    const apptRevenue = (list: Appt[]) => list.filter(a => isPaidStatus(a.status)).reduce((sum, a) => sum + getPrice(a), 0);
    const posRevenue  = (list: typeof allPos) => list.reduce((sum, sale) => sum + Number(sale.total ?? 0), 0);

    const revenue = apptRevenue(appts) + posRevenue(pos);

    // Tendencia vs ayer (solo período "hoy")
    let prevRevenue = 0;
    if (p === "hoy") {
      const yISO = toISO(addDays(now, -1));
      prevRevenue = apptRevenue(allAppts.filter(a => a.appointment_date === yISO))
        + posRevenue(allPos.filter(sale => (sale.created_at ?? "").slice(0, 10) === yISO));
    }

    const active    = appts.filter(a => a.status !== "cancelled");
    const confirmed = appts.filter(a => a.status === "confirmed").length;
    const pending   = appts.filter(a => a.status === "pending").length;
    const paidCount = appts.filter(a => isPaidStatus(a.status)).length + pos.length;
    const avgTicket = paidCount > 0 ? revenue / paidCount : 0;

    // ── Serie de ingresos alineada al período (patrón del web) ──
    let revenueSeries: { label: string; value: number }[];
    if (p === "hoy") {
      revenueSeries = HOURS.map(h => ({
        label: `${h}h`,
        value: active.filter(a => a.appointment_time?.startsWith(h)).reduce((sum, a) => sum + getPrice(a), 0),
      }));
    } else if (p === "semana") {
      revenueSeries = Array.from({ length: 7 }, (_, i) => {
        const d = addDays(startD, i);
        const dISO = toISO(d);
        const rev = allAppts.filter(a => a.appointment_date === dISO && a.status !== "cancelled")
          .reduce((sum, a) => sum + getPrice(a), 0);
        return { label: `${DAY_NAMES[d.getDay() === 0 ? 6 : d.getDay() - 1]} ${d.getDate()}`, value: rev };
      });
    } else {
      revenueSeries = Array.from({ length: 5 }, (_, wi) => {
        const wS = addDays(startD, wi * 7);
        const wE = addDays(wS, 6);
        const wsISO = toISO(wS), weISO = toISO(wE);
        const rev = allAppts.filter(a => a.appointment_date >= wsISO && a.appointment_date <= weISO && a.status !== "cancelled")
          .reduce((sum, a) => sum + getPrice(a), 0);
        return { label: `${String(wS.getDate()).padStart(2, "0")} ${MONTHS_S[wS.getMonth()]}`, value: rev };
      });
    }

    const hourly = HOURS.map(h => ({
      label: `${h}h`,
      value: active.filter(a => a.appointment_time?.startsWith(h)).length,
    }));

    const svcMap: Record<string, number> = {};
    active.forEach(a => {
      const name = a.services?.name;
      if (name) svcMap[name] = (svcMap[name] ?? 0) + 1;
    });
    const topServices = Object.entries(svcMap)
      .sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([label, value]) => ({
        label, value,
        sub: active.length > 0 ? `${((value / active.length) * 100).toFixed(0)}%` : undefined,
      }));

    const pmMap: Record<string, number> = {};
    pos.forEach(sale => {
      const pm = sale.payment_method || "otro";
      pmMap[pm] = (pmMap[pm] ?? 0) + Number(sale.total ?? 0);
    });
    const payments = Object.entries(pmMap)
      .map(([method, value]) => ({
        label: PM_META[method]?.label ?? method,
        color: PM_META[method]?.color ?? "#8E879B",
        value,
      }))
      .sort((a, b) => b.value - a.value);

    const todayAppts = allAppts.filter(a => a.appointment_date === todayISO);

    setData({
      revenue, prevRevenue, apptCount: active.length, confirmed, pending,
      avgTicket, clients: clientCount ?? 0, revenueSeries, hourly, topServices,
      payments, todayAppts,
    });
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
  const changePeriod = (p: Period) => { setPeriod(p); load(p); };

  const now = new Date();
  const todayLong = now.toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" });

  const periodTag   = period === "hoy" ? "Hoy" : period === "semana" ? "7 días" : "30 días";
  const periodLabel = period === "hoy" ? "hoy" : period === "semana" ? "últimos 7 días" : "últimos 30 días";

  const revDiff  = data.revenue - data.prevRevenue;
  const revTrend: "up" | "down" | "neutral" = revDiff > 0 ? "up" : revDiff < 0 ? "down" : "neutral";
  const posTotal = data.payments.reduce((sum, p) => sum + p.value, 0);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.canvas }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.red} />}
        contentContainerStyle={{ padding: 20, paddingBottom: 120, gap: 14 }}
      >
        {/* ── Header compacto (patrón del web: título + fecha serif) ── */}
        <Animated.View entering={FadeInDown.duration(350)}>
          <View style={s.headerRow}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <MonoTag>Panel</MonoTag>
              <Text style={[s.greeting, { color: t.ink }]}>{greeting()}</Text>
              <Text style={[s.date, { color: t.muted }]}>{todayLong}</Text>
            </View>
            <TenantBadge name={tenantName} />
          </View>

          <View style={s.controlsRow}>
            <SegmentedControl<Period>
              options={[
                { value: "hoy", label: "Hoy" },
                { value: "semana", label: "7 días" },
                { value: "mes", label: "30 días" },
              ]}
              value={period}
              onChange={changePeriod}
            />
            <TouchableOpacity onPress={() => setShowNew(true)} activeOpacity={0.85} style={s.newBtnWrap}>
              <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.newBtn}>
                <Ionicons name="add" size={14} color="white" />
                <Text style={s.newBtnText}>Nueva cita</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </Animated.View>

        {/* ── Hero de ingresos ── */}
        <HeroCard
          label={period === "hoy" ? "Ingresos de hoy" : "Ingresos del período"}
          raw={data.revenue}
          tag={periodTag}
          trend={period === "hoy" ? revTrend : undefined}
          trendVal={period === "hoy" ? (Math.abs(revDiff) > 0 ? `${fmtMoney(Math.abs(revDiff))} vs ayer` : "igual vs ayer") : undefined}
          sub={period !== "hoy" ? periodLabel : undefined}
          spark={data.revenueSeries.map(d => d.value)}
        />

        {/* ── Métricas ── */}
        <View style={s.metricsGrid}>
          <MetricCard
            icon="calendar-outline"
            label={period === "hoy" ? "Citas hoy" : "Citas"}
            raw={data.apptCount} fmt={v => String(Math.round(v))}
            sub={`${data.confirmed} confirmadas`}
            spark={data.hourly.map(h => h.value)}
            delay={60}
          />
          <MetricCard
            icon="notifications-outline"
            label="Pendientes"
            raw={data.pending} fmt={v => String(Math.round(v))}
            sub="requieren acción"
            alert={data.pending > 3}
            trend={data.pending > 3 ? "down" : "neutral"}
            trendVal={data.pending > 3 ? "atención" : undefined}
            delay={110}
          />
          <MetricCard
            icon="card-outline"
            label="Ticket promedio"
            raw={data.avgTicket} fmt={v => fmtMoney(v)}
            sub="por servicio"
            delay={160}
          />
          <MetricCard
            icon="people-outline"
            label="Clientes"
            raw={data.clients} fmt={v => String(Math.round(v))}
            sub="en tu base"
            delay={210}
          />
        </View>

        {/* ── Evolución de ingresos ── */}
        <Card delay={240}>
          <CardHead
            title={period === "hoy" ? "Ingresos por hora" : "Evolución de ingresos"}
            sub={period === "hoy" ? "Hoy, por franja horaria" : periodLabel}
            aside={periodTag}
          />
          <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 }}>
            <AreaChart data={data.revenueSeries} fmt={fmtMoney} height={180} />
          </View>
        </Card>

        {/* ── Citas por hora ── */}
        <Card delay={280}>
          <CardHead title="Citas por hora" sub="Distribución de la agenda" />
          <View style={{ paddingHorizontal: 18, paddingTop: 16, paddingBottom: 14 }}>
            <Bars data={data.hourly} accent="green" height={130} />
          </View>
        </Card>

        {/* ── Top servicios ── */}
        <Card delay={320}>
          <CardHead title="Top 5 servicios" sub="Los más solicitados del período" />
          <View style={{ padding: 18 }}>
            <RankBars items={data.topServices} fmt={v => String(Math.round(v))} />
          </View>
        </Card>

        {/* ── Medios de pago ── */}
        <Card delay={360}>
          <CardHead
            title="Medios de pago"
            sub="Ventas POS del período"
            aside={posTotal > 0 ? fmtMoney(posTotal) : undefined}
          />
          <View style={{ padding: 18 }}>
            <Donut data={data.payments} fmt={fmtMoney} centerLabel="total POS" />
          </View>
        </Card>

        {/* ── Agenda de hoy ── */}
        <Card delay={400}>
          <CardHead
            title="Agenda de hoy"
            sub={`${data.todayAppts.length} agendada${data.todayAppts.length !== 1 ? "s" : ""}`}
            aside={(
              <TouchableOpacity onPress={() => router.navigate("/agenda" as any)} activeOpacity={0.7}>
                <Text style={s.seeAll}>Ver todo →</Text>
              </TouchableOpacity>
            )}
          />
          {data.todayAppts.length === 0 ? (
            <ChartEmpty
              msg="Sin citas para hoy."
              action={(
                <TouchableOpacity onPress={() => setShowNew(true)} activeOpacity={0.85}>
                  <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.emptyBtn}>
                    <Ionicons name="add" size={14} color="white" />
                    <Text style={s.emptyBtnText}>Agendar cita</Text>
                  </LinearGradient>
                </TouchableOpacity>
              )}
            />
          ) : (
            data.todayAppts.map((a, i) => (
              <ApptRow
                key={a.id}
                a={a}
                i={i}
                last={i === data.todayAppts.length - 1}
                onPress={() => router.navigate("/agenda" as any)}
              />
            ))
          )}
        </Card>

        {/* ── Acceso a reportes ── */}
        <Card delay={440}>
          <TouchableOpacity style={s.reportsRow} onPress={() => router.navigate("/(admin)/reports" as any)} activeOpacity={0.6}>
            <View style={[s.reportsIcon, { backgroundColor: Colors.red + "12" }]}>
              <Ionicons name="bar-chart-outline" size={16} color={Colors.red} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.reportsTitle, { color: t.ink }]}>Ver reportes</Text>
              <Text style={[s.reportsSub, { color: t.subtle }]}>Ingresos, servicios, equipo</Text>
            </View>
            <Ionicons name="chevron-forward" size={15} color={t.subtle} />
          </TouchableOpacity>
        </Card>
      </ScrollView>

      {tenantId && (
        <NewApptModal
          visible={showNew}
          onClose={() => setShowNew(false)}
          tenantId={tenantId}
          initialDate={new Date()}
          onSuccess={() => load()}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  headerRow:   { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  greeting:    { fontSize: 23, fontFamily: Fonts.bold, letterSpacing: -0.6, marginTop: 3 },
  date:        { fontSize: 15.5, fontFamily: Fonts.serifItalic, marginTop: 2, textTransform: "capitalize" },

  controlsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 14, flexWrap: "wrap" },
  newBtnWrap:  { borderRadius: 9, overflow: "hidden" },
  newBtn:      { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 14, paddingVertical: 9 },
  newBtnText:  { fontSize: 12.5, fontFamily: Fonts.bold, color: "white" },

  metricsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },

  seeAll:      { fontSize: 12, fontFamily: Fonts.semibold, color: Colors.red },

  emptyBtn:     { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 9, paddingHorizontal: 16, paddingVertical: 9 },
  emptyBtnText: { fontSize: 12.5, fontFamily: Fonts.bold, color: "white" },

  reportsRow:   { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  reportsIcon:  { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  reportsTitle: { fontSize: 13.5, fontFamily: Fonts.semibold },
  reportsSub:   { fontSize: 11.5, fontFamily: Fonts.regular, marginTop: 1 },
});
