import { useEffect, useState, useCallback } from "react";
import {
  View, Text, ScrollView, StyleSheet,
  ActivityIndicator, RefreshControl,
} from "react-native";
import Animated, { FadeInDown, FadeInRight } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { Colors, Fonts, CardStyle } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { fmtMoney, pct } from "@/lib/format";
import { ScreenHeader, SegmentedControl, Card, CardHead, MonoTag, TrendChip, useCountUp } from "@/components/ui";
import { AreaChart, Bars, RankBars, ChartEmpty } from "@/components/charts";

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
    return ["L", "M", "X", "J", "V", "S", "D"];
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

// ─── KPI card (patrón MetricCard del web) ─────────────────────────────────────
function KpiCard({ label, raw, fmt, sub, icon, trend, trendVal, alert, delay }: {
  label: string; raw: number; fmt: (n: number) => string;
  sub?: string; icon: IoniconName;
  trend?: "up" | "down" | "neutral"; trendVal?: string;
  alert?: boolean; delay: number;
}) {
  const { t } = useTheme();
  const v = useCountUp(raw);
  return (
    <Animated.View
      entering={FadeInDown.delay(delay).duration(350)}
      style={[CardStyle.base, kpi.card, { backgroundColor: t.cardSolid, borderColor: alert ? "rgba(251,15,5,0.32)" : t.line }]}
    >
      <View style={kpi.rowTop}>
        <MonoTag>{label}</MonoTag>
        <Ionicons name={icon} size={14} color={alert ? Colors.red : t.subtle} />
      </View>
      <Text style={[kpi.value, { color: alert ? "#dc2626" : t.ink }]} numberOfLines={1} adjustsFontSizeToFit>
        {fmt(v)}
      </Text>
      {(trendVal || sub) ? (
        <View style={kpi.rowSub}>
          {trendVal && trend ? <TrendChip trend={trend} label={trendVal} /> : null}
          {sub ? <Text style={[kpi.sub, { color: t.subtle }]} numberOfLines={1}>{sub}</Text> : null}
        </View>
      ) : null}
    </Animated.View>
  );
}

const kpi = StyleSheet.create({
  card:   { flex: 1, padding: 13 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 6 },
  rowSub: { flexDirection: "row", gap: 6, alignItems: "center", marginTop: 8, flexWrap: "wrap" },
  value:  { fontSize: 19, fontFamily: Fonts.bold, letterSpacing: -0.6, marginTop: 9 },
  sub:    { fontSize: 10.5, fontFamily: Fonts.regular },
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

  const peakHour  = hourly.reduce((a, b) => b.count > a.count ? b : a, { hour: 0, count: 0 });
  const hourlyBars = Array.from({ length: 13 }, (_, i) => {
    const h = i + 7;
    return { label: `${h}h`, value: hourly.find(x => x.hour === h)?.count ?? 0 };
  });

  const periodLabel = period === "week" ? "esta semana" : period === "month" ? "este mes" : "este año";
  const periodTag   = period === "week" ? "Semana" : period === "month" ? "Mes" : "Año";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.canvas }}>
      <ScreenHeader crumb="Panel" title="Reportes" subtitle="Análisis de rendimiento" onBack={() => router.back()} />

      <View style={{ paddingHorizontal: 20, paddingVertical: 12 }}>
        <SegmentedControl<Period>
          options={[
            { value: "week", label: "Semana" },
            { value: "month", label: "Mes" },
            { value: "year", label: "Año" },
          ]}
          value={period}
          onChange={setPeriod}
        />
      </View>

      {loading && !refreshing ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={Colors.red} size="large" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 20, paddingTop: 4, paddingBottom: 110, gap: 14 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.red} />}
        >
          {/* KPIs */}
          <View style={s.kpiRow}>
            <KpiCard
              label="Ingresos" raw={revenue} fmt={fmtMoney} icon="cash-outline"
              trend={revTrend > 0 ? "up" : revTrend < 0 ? "down" : "neutral"}
              trendVal={prevRevenue > 0 ? `${revTrend > 0 ? "+" : ""}${pct(revTrend)}` : undefined}
              sub={prevRevenue > 0 ? "vs anterior" : undefined}
              delay={0}
            />
            <KpiCard
              label="Citas" raw={apptCount} fmt={v => String(Math.round(v))} icon="calendar-outline"
              trend={countTrend > 0 ? "up" : countTrend < 0 ? "down" : "neutral"}
              trendVal={prevCount > 0 ? `${countTrend > 0 ? "+" : ""}${pct(countTrend)}` : undefined}
              sub={prevCount > 0 ? "vs anterior" : undefined}
              delay={60}
            />
          </View>
          <View style={s.kpiRow}>
            <KpiCard label="Ticket promedio" raw={avgTicket} fmt={fmtMoney} icon="pricetag-outline" delay={120} />
            <KpiCard label="No asistió" raw={noShowRate} fmt={v => pct(v)} icon="person-remove-outline" alert={noShowRate > 15} delay={180} />
            <KpiCard label="Nuevos" raw={newClients} fmt={v => String(Math.round(v))} icon="person-add-outline" delay={240} />
          </View>

          {/* Evolución de ingresos */}
          <Card delay={280}>
            <CardHead
              title={period === "year" ? "Ingresos por mes" : "Ingresos por día"}
              sub={`Resumen ${periodLabel}`}
              aside={periodTag}
            />
            <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 }}>
              <AreaChart
                data={revenueSlots.map((v, i) => ({ label: slotLabels[i], value: v }))}
                fmt={fmtMoney}
                height={180}
              />
            </View>
          </Card>

          {/* Top servicios */}
          <Card delay={330}>
            <CardHead title="Top 5 servicios" sub="Los más solicitados del período" />
            <View style={{ padding: 18 }}>
              <RankBars
                items={topServices.map(svc => ({
                  label: svc.name, value: svc.count,
                  sub: apptCount > 0 ? `${((svc.count / apptCount) * 100).toFixed(0)}%` : undefined,
                }))}
                fmt={v => String(Math.round(v))}
              />
            </View>
          </Card>

          {/* Rendimiento del equipo */}
          <Card delay={380}>
            <CardHead title="Rendimiento del equipo" sub="Por ingresos del período" />
            <View style={{ padding: 18 }}>
              <RankBars
                items={staffPerf.map(p => ({
                  label: p.name, value: p.revenue,
                  sub: `${p.count} cita${p.count !== 1 ? "s" : ""}`,
                }))}
                fmt={fmtMoney}
              />
            </View>
          </Card>

          {/* Horarios más activos */}
          <Card delay={430}>
            <CardHead
              title="Horarios más activos"
              sub={peakHour.count > 0 ? `Pico: ${peakHour.hour}:00 – ${peakHour.hour + 1}:00` : "Distribución de la agenda"}
            />
            <View style={{ paddingHorizontal: 18, paddingTop: 16, paddingBottom: 14 }}>
              {hourlyBars.some(h => h.value > 0)
                ? <Bars data={hourlyBars} accent="green" height={120} />
                : <ChartEmpty msg={`Sin citas ${periodLabel}.`} />}
            </View>
          </Card>

          {/* Empty state */}
          {!loading && revenue === 0 && apptCount === 0 && (
            <Card delay={0}>
              <ChartEmpty msg={`Sin datos ${periodLabel}. Los reportes aparecerán cuando haya citas registradas.`} />
            </Card>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  kpiRow: { flexDirection: "row", gap: 10 },
});
