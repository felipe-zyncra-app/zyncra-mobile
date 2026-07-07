import { useEffect, useState, useCallback } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown, FadeInRight } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { Colors, Gradients, Radius, Shadow } from "@/constants/theme";
import ErrorState from "@/components/ErrorState";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { fmtMoney, pct } from "@/lib/format";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];
type Period = "week" | "month" | "year";

function getRange(period: Period): { start: string; end: string } {
  const now = new Date();
  if (period === "week") {
    const day = now.getDay();
    const diff = (day === 0 ? -6 : 1) - day;
    const mon = new Date(now); mon.setDate(now.getDate() + diff);
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    return { start: mon.toISOString().slice(0, 10), end: sun.toISOString().slice(0, 10) };
  }
  if (period === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    return { start, end };
  }
  return {
    start: new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10),
    end:   new Date(now.getFullYear(), 11, 31).toISOString().slice(0, 10),
  };
}

function getPrevRange(period: Period): { start: string; end: string } {
  const now = new Date();
  if (period === "week") {
    const day  = now.getDay();
    const diff = (day === 0 ? -6 : 1) - day;
    const mon  = new Date(now); mon.setDate(now.getDate() + diff - 7);
    const sun  = new Date(mon); sun.setDate(mon.getDate() + 6);
    return { start: mon.toISOString().slice(0, 10), end: sun.toISOString().slice(0, 10) };
  }
  if (period === "month") {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
    const end   = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10);
    return { start, end };
  }
  return {
    start: new Date(now.getFullYear() - 1, 0, 1).toISOString().slice(0, 10),
    end:   new Date(now.getFullYear() - 1, 11, 31).toISOString().slice(0, 10),
  };
}

// Generates day-by-day or month-by-month labels + slots depending on period
function buildSlots(period: Period): string[] {
  const now = new Date();
  if (period === "week") {
    const { start } = getRange("week");
    const base = new Date(start);
    const days = ["L", "M", "X", "J", "V", "S", "D"];
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base); d.setDate(base.getDate() + i);
      return days[i];
    });
  }
  if (period === "month") {
    const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return Array.from({ length: days }, (_, i) => String(i + 1));
  }
  return ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
}

function buildSlotDates(period: Period): string[] {
  const { start } = getRange(period);
  const now = new Date();
  if (period === "week") {
    const base = new Date(start);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base); d.setDate(base.getDate() + i);
      return d.toISOString().slice(0, 10);
    });
  }
  if (period === "month") {
    const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const base = new Date(now.getFullYear(), now.getMonth(), 1);
    return Array.from({ length: days }, (_, i) => {
      const d = new Date(base); d.setDate(base.getDate() + i);
      return d.toISOString().slice(0, 10);
    });
  }
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), i, 1);
    return d.toISOString().slice(0, 7);
  });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, icon, color, trend, delay }: {
  label: string; value: string; sub?: string; icon: IoniconName;
  color: string; trend?: "up" | "down" | "neutral"; delay: number;
}) {
  const { t } = useTheme();
  return (
    <Animated.View entering={FadeInDown.delay(delay).duration(350)} style={[kpi.card, Shadow.sm, { backgroundColor: t.bgAlt }]}>
      <View style={[kpi.iconBox, { backgroundColor: color + "18" }]}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <Text style={[kpi.value, { color }]}>{value}</Text>
      <Text style={[kpi.label, { color: t.muted }]}>{label}</Text>
      {(sub || trend) && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
          {trend && trend !== "neutral" && (
            <Ionicons
              name={trend === "up" ? "trending-up-outline" : "trending-down-outline"}
              size={12}
              color={trend === "up" ? Colors.success : Colors.red}
            />
          )}
          {sub && <Text style={[kpi.sub, trend === "up" && { color: Colors.success }, trend === "down" && { color: Colors.red }]}>{sub}</Text>}
        </View>
      )}
    </Animated.View>
  );
}

const kpi = StyleSheet.create({
  card:    { flex: 1, backgroundColor: Colors.white, borderRadius: Radius.lg, padding: 14, alignItems: "center", gap: 4 },
  iconBox: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  value:   { fontSize: 20, fontFamily: "SpaceGrotesk_700Bold", letterSpacing: -0.5 },
  label:   { fontSize: 10, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted, textAlign: "center" },
  sub:     { fontSize: 10, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.subtle },
});

// Native bar chart
function BarChart({ data, labels, color = Colors.red }: {
  data: number[]; labels: string[]; color?: string;
}) {
  const max = Math.max(...data, 1);
  const showEvery = data.length > 14 ? Math.ceil(data.length / 7) : 1;
  return (
    <View style={bc.wrap}>
      <View style={bc.barsRow}>
        {data.map((v, i) => (
          <View key={i} style={bc.barCol}>
            <View style={bc.barTrack}>
              <View style={[bc.bar, {
                height: `${Math.max((v / max) * 100, v > 0 ? 4 : 0)}%`,
                backgroundColor: v === 0 ? Colors.border : color,
              }]} />
            </View>
            {i % showEvery === 0 && (
              <Text style={bc.barLabel}>{labels[i]}</Text>
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

const bc = StyleSheet.create({
  wrap:     { paddingTop: 8, paddingBottom: 4 },
  barsRow:  { flexDirection: "row", alignItems: "flex-end", height: 80, gap: 3 },
  barCol:   { flex: 1, alignItems: "center", justifyContent: "flex-end" },
  barTrack: { width: "100%", height: "100%", justifyContent: "flex-end" },
  bar:      { width: "100%", borderRadius: 3, minHeight: 0 },
  barLabel: { fontSize: 8, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.subtle, marginTop: 4, textAlign: "center" },
});

// Horizontal bar row for rankings
function RankRow({ label, value, total, color, rank, delay }: {
  label: string; value: number; total: number; color: string; rank: number; delay: number;
}) {
  const pctW = total > 0 ? (value / total) * 100 : 0;
  return (
    <Animated.View entering={FadeInRight.delay(delay).duration(320)} style={rk.row}>
      <View style={[rk.rankBadge, { backgroundColor: color + "14" }]}>
        <Text style={[rk.rankNum, { color }]}>#{rank}</Text>
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={rk.label} numberOfLines={1}>{label}</Text>
          <Text style={[rk.value, { color }]}>{value}</Text>
        </View>
        <View style={rk.track}>
          <View style={[rk.fill, { width: `${pctW}%`, backgroundColor: color }]} />
        </View>
      </View>
    </Animated.View>
  );
}

const rk = StyleSheet.create({
  row:       { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 },
  rankBadge: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rankNum:   { fontSize: 11, fontFamily: "SpaceGrotesk_700Bold" },
  label:     { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text, flex: 1 },
  value:     { fontSize: 13, fontFamily: "SpaceGrotesk_700Bold" },
  track:     { height: 4, backgroundColor: Colors.border, borderRadius: 2, overflow: "hidden" },
  fill:      { height: "100%", borderRadius: 2 },
});

// ─── Main ──────────────────────────────────────────────────────────────────────

export default function ReportsScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const [period, setPeriod] = useState<Period>("month");
  const { tenantId } = useAuth();
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // KPIs
  const [revenue, setRevenue]         = useState(0);
  const [prevRevenue, setPrevRevenue] = useState(0);
  const [apptCount, setApptCount]     = useState(0);
  const [prevCount, setPrevCount]     = useState(0);
  const [avgTicket, setAvgTicket]     = useState(0);
  const [noShowRate, setNoShowRate]   = useState(0);
  const [newClients, setNewClients]   = useState(0);

  // Charts
  const [revenueSlots, setRevenueSlots] = useState<number[]>([]);
  const [slotLabels, setSlotLabels]     = useState<string[]>([]);

  // Rankings
  const [topServices, setTopServices] = useState<{ name: string; count: number }[]>([]);
  const [staffPerf, setStaffPerf]     = useState<{ name: string; count: number; revenue: number }[]>([]);
  const [hourly, setHourly]           = useState<{ hour: number; count: number }[]>([]);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    load().then(() => { if (cancelled) return; });
    return () => { cancelled = true; };
  }, [tenantId, period]);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    const { start, end }         = getRange(period);
    const { start: ps, end: pe } = getPrevRange(period);

    const [curRes, prevRes, posRes, prevPosRes] = await Promise.all([
      supabase.from("appointments")
        .select("id, appointment_date, appointment_time, status, services(name, price), professionals(name), clients(id, created_at)")
        .eq("tenant_id", tenantId)
        .gte("appointment_date", start)
        .lte("appointment_date", end),
      supabase.from("appointments")
        .select("id, status, services(price)")
        .eq("tenant_id", tenantId)
        .gte("appointment_date", ps)
        .lte("appointment_date", pe),
      supabase.from("pos_sales").select("total, created_at").eq("tenant_id", tenantId)
        .gte("created_at", start).lte("created_at", end + "T23:59:59").limit(5000),
      supabase.from("pos_sales").select("total").eq("tenant_id", tenantId)
        .gte("created_at", ps).lte("created_at", pe + "T23:59:59").limit(5000),
    ]);

    const cur: any[]  = curRes.data  ?? [];
    const prev: any[] = prevRes.data ?? [];
    const posData: any[] = posRes.data ?? [];
    const prevPosData: any[] = prevPosRes.data ?? [];

    // KPIs
    const done  = cur.filter(a => a.status === "completed" || a.status === "confirmed");
    const apptRev  = done.reduce((s: number, a: any) => s + (a.services?.price ?? 0), 0);
    const posRev   = posData.reduce((s: number, p: any) => s + Number(p.total ?? 0), 0);
    const rev      = apptRev + posRev;
    const prevDone = prev.filter(a => a.status === "completed" || a.status === "confirmed");
    const prevApptRev = prevDone.reduce((s: number, a: any) => s + (a.services?.price ?? 0), 0);
    const prevPosRev  = prevPosData.reduce((s: number, p: any) => s + Number(p.total ?? 0), 0);
    const prevRev  = prevApptRev + prevPosRev;
    const noShows  = cur.filter(a => a.status === "no_show").length;
    const totalFinished = done.length + noShows;

    setRevenue(rev);
    setPrevRevenue(prevRev);
    setApptCount(cur.filter(a => a.status !== "cancelled").length);
    setPrevCount(prev.filter(a => a.status !== "cancelled").length);
    setAvgTicket(done.length > 0 ? rev / done.length : 0);
    setNoShowRate(totalFinished > 0 ? (noShows / totalFinished) * 100 : 0);

    // New clients (created within the range)
    const uniqueClients = new Map<string, string>();
    cur.forEach((a: any) => { if (a.clients?.id) uniqueClients.set(a.clients.id, a.clients.created_at); });
    const newC = Array.from(uniqueClients.values()).filter(d => d >= start && d <= end).length;
    setNewClients(newC);

    // Revenue by slot
    const dates = buildSlotDates(period);
    const labels = buildSlots(period);
    const slotRev = dates.map(slotKey => {
      const apptMatches = done.filter((a: any) => {
        if (period === "year") return a.appointment_date?.startsWith(slotKey);
        return a.appointment_date === slotKey;
      });
      const posMatches = posData.filter((p: any) => {
        const d = (p.created_at ?? "").slice(0, period === "year" ? 7 : 10);
        return d === slotKey;
      });
      return apptMatches.reduce((s: number, a: any) => s + (a.services?.price ?? 0), 0)
           + posMatches.reduce((s: number, p: any) => s + Number(p.total ?? 0), 0);
    });
    setRevenueSlots(slotRev);
    setSlotLabels(labels);

    // Top services
    const svcMap = new Map<string, number>();
    cur.filter(a => a.status !== "cancelled").forEach((a: any) => {
      const sn = a.services?.name ?? "Sin servicio";
      svcMap.set(sn, (svcMap.get(sn) ?? 0) + 1);
    });
    const top5 = Array.from(svcMap.entries())
      .sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([name, count]) => ({ name, count }));
    setTopServices(top5);

    // Staff performance
    const staffMap = new Map<string, { count: number; revenue: number }>();
    done.forEach((a: any) => {
      const sn = (a.professionals as any)?.name ?? "Sin profesional";
      const prev2 = staffMap.get(sn) ?? { count: 0, revenue: 0 };
      staffMap.set(sn, { count: prev2.count + 1, revenue: prev2.revenue + (a.services?.price ?? 0) });
    });
    const sp = Array.from(staffMap.entries())
      .sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 5)
      .map(([name, v]) => ({ name, ...v }));
    setStaffPerf(sp);

    // Hourly distribution
    const hourMap = new Map<number, number>();
    cur.filter(a => a.status !== "cancelled").forEach((a: any) => {
      const h = parseInt((a.appointment_time ?? "00:00").slice(0, 2));
      hourMap.set(h, (hourMap.get(h) ?? 0) + 1);
    });
    const hrs = Array.from(hourMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([hour, count]) => ({ hour, count }));
    setHourly(hrs);

    setLoading(false);
    setRefreshing(false);
  }, [tenantId, period]);

  const onRefresh = () => { setRefreshing(true); load(); };

  const revTrend   = prevRevenue > 0 ? ((revenue - prevRevenue) / prevRevenue) * 100 : 0;
  const countTrend = prevCount   > 0 ? ((apptCount - prevCount) / prevCount) * 100   : 0;

  const topSvcTotal = topServices.reduce((s, x) => s + x.count, 0);
  const topStaffRev = staffPerf[0]?.revenue ?? 1;

  const hourlyMax = Math.max(...hourly.map(h => h.count), 1);
  const peakHour  = hourly.reduce((a, b) => b.count > a.count ? b : a, { hour: 0, count: 0 });

  const periodLabel = period === "week" ? "esta semana" : period === "month" ? "este mes" : "este año";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      {/* Header */}
      <LinearGradient colors={Gradients.ink} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.header}>
        <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3 }} />
        <View style={s.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="arrow-back" size={22} color="white" />
          </TouchableOpacity>
          <View>
            <Text style={s.headerTitle}>Reportes</Text>
            <Text style={s.headerSub}>Análisis de rendimiento</Text>
          </View>
        </View>

        {/* Period selector */}
        <View style={s.periodRow}>
          {(["week", "month", "year"] as Period[]).map(p => (
            <TouchableOpacity
              key={p}
              style={[s.periodBtn, period === p && s.periodBtnActive]}
              onPress={() => setPeriod(p)}
            >
              <Text style={[s.periodBtnTxt, period === p && s.periodBtnTxtActive]}>
                {p === "week" ? "Semana" : p === "month" ? "Mes" : "Año"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </LinearGradient>

      {loading && !refreshing ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={Colors.red} size="large" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: 110 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.red} />}
        >
          {/* KPI row 1 */}
          <Text style={[s.sectionTitle, { color: t.subtle }]}>Resumen {periodLabel}</Text>
          <View style={s.kpiRow}>
            <KpiCard
              label="Ingresos" value={fmtMoney(revenue)} icon="cash-outline" color={Colors.red}
              trend={revTrend > 0 ? "up" : revTrend < 0 ? "down" : "neutral"}
              sub={prevRevenue > 0 ? `${revTrend > 0 ? "+" : ""}${pct(revTrend)} vs anterior` : undefined}
              delay={0}
            />
            <KpiCard
              label="Citas" value={String(apptCount)} icon="calendar-outline" color={Colors.blue}
              trend={countTrend > 0 ? "up" : countTrend < 0 ? "down" : "neutral"}
              sub={prevCount > 0 ? `${countTrend > 0 ? "+" : ""}${pct(countTrend)} vs anterior` : undefined}
              delay={60}
            />
          </View>

          <View style={s.kpiRow}>
            <KpiCard label="Ticket promedio" value={fmtMoney(avgTicket)} icon="pricetag-outline" color="#f59e0b" delay={120} />
            <KpiCard label="No asistió" value={pct(noShowRate)} icon="person-remove-outline" color={noShowRate > 15 ? Colors.red : Colors.muted} delay={180} />
            <KpiCard label="Clientes nuevos" value={String(newClients)} icon="person-add-outline" color={Colors.success} delay={240} />
          </View>

          {/* Revenue chart */}
          {revenueSlots.some(v => v > 0) && (
            <Animated.View entering={FadeInDown.delay(300).duration(400)} style={[s.card, Shadow.sm, { backgroundColor: t.bgAlt }]}>
              <View style={s.cardHeader}>
                <View style={[s.cardIconBox, { backgroundColor: Colors.red + "14" }]}>
                  <Ionicons name="bar-chart-outline" size={16} color={Colors.red} />
                </View>
                <Text style={[s.cardTitle, { color: t.text }]}>Ingresos por {period === "week" ? "día" : period === "month" ? "día" : "mes"}</Text>
              </View>
              <BarChart data={revenueSlots} labels={slotLabels} color={Colors.red} />
              <View style={[s.chartFooter, { borderTopColor: t.border }]}>
                <Text style={[s.chartFooterTxt, { color: t.muted }]}>Total: {fmtMoney(revenue)}</Text>
                <Text style={[s.chartFooterTxt, { color: t.muted }]}>Prom/día: {fmtMoney(revenueSlots.filter(v => v > 0).reduce((a, b) => a + b, 0) / Math.max(revenueSlots.filter(v => v > 0).length, 1))}</Text>
              </View>
            </Animated.View>
          )}

          {/* Top services */}
          {topServices.length > 0 && (
            <Animated.View entering={FadeInDown.delay(360).duration(400)} style={[s.card, Shadow.sm, { backgroundColor: t.bgAlt }]}>
              <View style={s.cardHeader}>
                <View style={[s.cardIconBox, { backgroundColor: "#8b5cf614" }]}>
                  <Ionicons name="cut-outline" size={16} color="#8b5cf6" />
                </View>
                <Text style={[s.cardTitle, { color: t.text }]}>Top servicios</Text>
              </View>
              {topServices.map((svc, i) => (
                <RankRow
                  key={svc.name} rank={i + 1} label={svc.name} value={svc.count}
                  total={topSvcTotal} color={["#8b5cf6", Colors.blue, Colors.success, "#f59e0b", Colors.red][i]}
                  delay={i * 60}
                />
              ))}
            </Animated.View>
          )}

          {/* Staff performance */}
          {staffPerf.length > 0 && (
            <Animated.View entering={FadeInDown.delay(420).duration(400)} style={[s.card, Shadow.sm, { backgroundColor: t.bgAlt }]}>
              <View style={s.cardHeader}>
                <View style={[s.cardIconBox, { backgroundColor: Colors.blue + "14" }]}>
                  <Ionicons name="people-outline" size={16} color={Colors.blue} />
                </View>
                <Text style={[s.cardTitle, { color: t.text }]}>Rendimiento del equipo</Text>
              </View>
              {staffPerf.map((p, i) => (
                <Animated.View key={p.name} entering={i < 10 ? FadeInRight.delay(i * 60).duration(320) : undefined} style={s.staffRow}>
                  <View style={[s.staffAvatar, { backgroundColor: [Colors.red, Colors.blue, Colors.success, "#f59e0b", "#8b5cf6"][i] }]}>
                    <Text style={s.staffAvatarTxt}>{p.name[0]}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.staffName, { color: t.text }]}>{p.name}</Text>
                    <Text style={[s.staffSub, { color: t.muted }]}>{p.count} citas</Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={[s.staffRevenue, { color: t.text }]}>{fmtMoney(p.revenue)}</Text>
                    <View style={[s.staffTrack, { backgroundColor: t.border }]}>
                      <View style={[s.staffFill, { width: `${(p.revenue / topStaffRev) * 100}%`, backgroundColor: [Colors.red, Colors.blue, Colors.success, "#f59e0b", "#8b5cf6"][i] }]} />
                    </View>
                  </View>
                </Animated.View>
              ))}
            </Animated.View>
          )}

          {/* Hourly distribution */}
          {hourly.length > 0 && (
            <Animated.View entering={FadeInDown.delay(480).duration(400)} style={[s.card, Shadow.sm, { backgroundColor: t.bgAlt }]}>
              <View style={s.cardHeader}>
                <View style={[s.cardIconBox, { backgroundColor: Colors.success + "14" }]}>
                  <Ionicons name="time-outline" size={16} color={Colors.success} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.cardTitle, { color: t.text }]}>Horarios más activos</Text>
                  {peakHour.count > 0 && (
                    <Text style={s.cardSub}>Pico: {peakHour.hour}:00 – {peakHour.hour + 1}:00</Text>
                  )}
                </View>
              </View>
              <View style={s.hourGrid}>
                {Array.from({ length: 13 }, (_, i) => i + 7).map(h => {
                  const slot = hourly.find(x => x.hour === h);
                  const cnt  = slot?.count ?? 0;
                  const height = cnt > 0 ? Math.max((cnt / hourlyMax) * 60, 6) : 2;
                  const active = h === peakHour.hour && cnt > 0;
                  return (
                    <View key={h} style={s.hourCol}>
                      <View style={[s.hourBar, { height, backgroundColor: active ? Colors.success : cnt > 0 ? Colors.success + "60" : Colors.border }]} />
                      <Text style={[s.hourLabel, active && { color: Colors.success, fontFamily: "SpaceGrotesk_700Bold" }]}>{h}</Text>
                    </View>
                  );
                })}
              </View>
            </Animated.View>
          )}

          {/* Empty state */}
          {!loading && revenue === 0 && apptCount === 0 && (
            <View style={s.emptyBox}>
              <Ionicons name="bar-chart-outline" size={40} color={Colors.subtle} />
              <Text style={[s.emptyTitle, { color: t.text }]}>Sin datos {periodLabel}</Text>
              <Text style={[s.emptyTxt, { color: t.muted }]}>Los reportes aparecerán cuando haya citas registradas.</Text>
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  header:      { paddingTop: 16, paddingHorizontal: 24, paddingBottom: 16 },
  headerRow:   { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 14 },
  backBtn:     { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 22, fontFamily: "SpaceGrotesk_700Bold", color: "white", letterSpacing: -0.5 },
  headerSub:   { fontSize: 13, color: "rgba(255,255,255,.75)", fontFamily: "SpaceGrotesk_400Regular", marginTop: 2 },

  periodRow:       { flexDirection: "row", gap: 8, paddingBottom: 4 },
  periodBtn:       { flex: 1, paddingVertical: 8, borderRadius: Radius.md, alignItems: "center", backgroundColor: "rgba(255,255,255,.15)" },
  periodBtnActive: { backgroundColor: "white" },
  periodBtnTxt:    { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: "rgba(255,255,255,.8)" },
  periodBtnTxtActive: { color: Colors.red, fontFamily: "SpaceGrotesk_700Bold" },

  sectionTitle: { fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", color: Colors.subtle, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12 },
  kpiRow:       { flexDirection: "row", gap: 10, marginBottom: 10 },

  card:       { backgroundColor: Colors.white, borderRadius: Radius.lg, padding: 16, marginBottom: 14 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 16 },
  cardIconBox:{ width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  cardTitle:  { fontSize: 14, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text },
  cardSub:    { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, marginTop: 1 },

  chartFooter:    { flexDirection: "row", justifyContent: "space-between", marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: Colors.border },
  chartFooterTxt: { fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted },

  staffRow:       { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
  staffAvatar:    { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  staffAvatarTxt: { fontSize: 14, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
  staffName:      { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  staffSub:       { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted },
  staffRevenue:   { fontSize: 13, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text, marginBottom: 4 },
  staffTrack:     { width: 80, height: 3, backgroundColor: Colors.border, borderRadius: 2, overflow: "hidden" },
  staffFill:      { height: "100%", borderRadius: 2 },

  hourGrid:  { flexDirection: "row", alignItems: "flex-end", gap: 2, height: 80 },
  hourCol:   { flex: 1, alignItems: "center", justifyContent: "flex-end", gap: 4 },
  hourBar:   { width: "100%", borderRadius: 2, minHeight: 2 },
  hourLabel: { fontSize: 7, fontFamily: "SpaceGrotesk_400Regular", color: Colors.subtle },

  emptyBox:  { alignItems: "center", justifyContent: "center", paddingVertical: 60, gap: 12 },
  emptyTitle:{ fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text },
  emptyTxt:  { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, textAlign: "center" },
});
