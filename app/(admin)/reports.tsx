import { useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { useTenant } from "@/lib/tenant";
import { getActiveLocationId } from "@/lib/active-location";
import {
  diaLocalDe, hoyNegocio, listaDeDias, mesDe, rangoDePeriodo, rangoAnterior,
  rangoIncluyeHoy, moverReferencia, etiquetaRango,
  type Periodo, type RangoNegocio,
} from "@/lib/tz";
import { mensajeError, revisar, traerTodo } from "@/lib/db";
import { useGuardRespuestas, useRecarga } from "@/lib/useRecarga";
import { cobradoDe, estaCobrada, montoDe, precioDeLista, rangoDeHoras, horaDe, type VentaResumen } from "@/lib/ingresos";
import { Colors, Fonts, CardStyle } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { fmtMoney, pct } from "@/lib/format";
import ErrorState from "@/components/ErrorState";
import { ScreenHeader, SegmentedControl, Card, CardHead, MonoTag, TrendChip, IconButton, useCountUp } from "@/components/ui";
import { AreaChart, Bars, RankBars, ChartEmpty } from "@/components/charts";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];
type Period = Extract<Periodo, "semana" | "mes" | "anio">;

const LETRAS_SEMANA = ["L", "M", "X", "J", "V", "S", "D"];
const MESES_CORTOS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

type CitaReporte = {
  id: string;
  appointment_date: string;
  appointment_time: string | null;
  status: string;
  services: { name: string; price?: number | string | null } | null;
  appointment_services: { price: number | string | null }[] | null;
  professionals: { name: string } | null;
  clients: { id: string; created_at: string | null } | null;
  pos_sales: VentaResumen[] | null;
  /** Historial migrado de otro sistema: se cobró allá, no está por cobrar. */
  imported?: boolean | null;
};
type CitaPrevia = { id: string; status: string; pos_sales: VentaResumen[] | null };
type VentaSuelta = VentaResumen & { id: string; created_at: string };

type Reporte = {
  /** Rango para el que se calculó (para no mostrar datos de otro periodo). */
  clave: string;
  sede: string | null;
  revenue: number;
  prevRevenue: number;
  apptCount: number;
  prevCount: number;
  avgTicket: number;
  noShowRate: number;
  newClients: number;
  /** Completadas sin venta del periodo: por cobrar, no ingreso (D10 / DIN-05). */
  sinCobroCount: number;
  /** Su precio de lista (servicio + adicionales): lo que falta cobrar. */
  sinCobroMonto: number;
  slots: { label: string; value: number }[];
  topServices: { name: string; count: number }[];
  staffPerf: { name: string; count: number; revenue: number }[];
  hourly: { label: string; value: number; hour: number }[];
};

const claveDe = (r: RangoNegocio) => `${r.periodo}|${r.desde}|${r.hasta}|${r.timeZone}`;

async function cargarReporte(tenantId: string, r: RangoNegocio): Promise<Reporte> {
  const prev = rangoAnterior(r);
  const tz = r.timeZone;
  // Misma sede que el Panel y que el web (DIN-12): antes Reportes sumaba todas
  // las sedes y el mismo mes daba otra cifra que el Panel.
  const loc = await getActiveLocationId(tenantId);

  const [cur, prv, sueltas, sueltasPrev, sedes] = await Promise.all([
    // Paginado: el servidor corta en 1000 filas y "Año" las pasaba (CAL-05).
    traerTodo<CitaReporte>((d, h) => {
      let q = supabase.from("appointments")
        .select("id, appointment_date, appointment_time, status, imported, services(name, price), appointment_services(price), professionals(name), clients(id, created_at), pos_sales(total)")
        .eq("tenant_id", tenantId)
        .gte("appointment_date", r.desde)
        .lte("appointment_date", r.hasta);
      if (loc) q = q.eq("location_id", loc);
      return q.order("appointment_date").order("id").range(d, h)
        .overrideTypes<CitaReporte[], { merge: false }>();
    }, { contexto: "No se pudieron cargar las citas del periodo" }),
    traerTodo<CitaPrevia>((d, h) => {
      let q = supabase.from("appointments")
        .select("id, status, pos_sales(total)")
        .eq("tenant_id", tenantId)
        .gte("appointment_date", prev.desde)
        .lte("appointment_date", prev.hasta);
      if (loc) q = q.eq("location_id", loc);
      return q.order("appointment_date").order("id").range(d, h)
        .overrideTypes<CitaPrevia[], { merge: false }>();
    }, { contexto: "No se pudieron cargar las citas del periodo anterior" }),
    // Ventas de mostrador. Fronteras en la zona del negocio (lib/tz.ts).
    traerTodo<VentaSuelta>((d, h) => {
      let q = supabase.from("pos_sales").select("id, total, created_at")
        .eq("tenant_id", tenantId).is("appointment_id", null)
        .gte("created_at", r.desdeUTC).lte("created_at", r.hastaUTC);
      if (loc) q = q.eq("location_id", loc);
      return q.order("created_at").order("id").range(d, h);
    }, { contexto: "No se pudieron cargar las ventas del periodo" }),
    traerTodo<VentaSuelta>((d, h) => {
      let q = supabase.from("pos_sales").select("id, total, created_at")
        .eq("tenant_id", tenantId).is("appointment_id", null)
        .gte("created_at", prev.desdeUTC).lte("created_at", prev.hastaUTC);
      if (loc) q = q.eq("location_id", loc);
      return q.order("created_at").order("id").range(d, h);
    }, { contexto: "No se pudieron cargar las ventas del periodo anterior" }),
    loc
      ? supabase.from("locations").select("id, name").eq("tenant_id", tenantId).eq("is_active", true)
      : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
  ]);
  const listaSedes = revisar(sedes, "No se pudieron cargar las sedes") ?? [];
  // Solo se nombra la sede si hay más de una: con una sola es el negocio entero.
  const sede = listaSedes.length > 1 ? (listaSedes.find(x => x.id === loc)?.name ?? "Sede activa") : null;

  // Memoria en la zona del negocio (la otra mitad del problema).
  const ventas = sueltas
    .map(v => ({ v, dia: diaLocalDe(v.created_at, tz) }))
    .filter(x => x.dia >= r.desde && x.dia <= r.hasta);
  const ventasPrev = sueltasPrev
    .map(v => ({ v, dia: diaLocalDe(v.created_at, tz) }))
    .filter(x => x.dia >= prev.desde && x.dia <= prev.hasta);

  // Ingreso = solo lo cobrado (D10): citas con venta (valoradas por lo que se
  // cobró, sin caer al precio de lista) + ventas de mostrador.
  const cobradas     = cur.filter(estaCobrada);
  const cobradasPrev = prv.filter(estaCobrada);
  const revenue     = cobradas.reduce((s, a) => s + cobradoDe(a), 0) + ventas.reduce((s, x) => s + montoDe(x.v), 0);
  const prevRevenue = cobradasPrev.reduce((s, a) => s + cobradoDe(a), 0) + ventasPrev.reduce((s, x) => s + montoDe(x.v), 0);

  const activas = cur.filter(a => a.status !== "cancelled");
  // Denominador de inasistencia: todas las citas del periodo menos las
  // canceladas (mismo criterio que noShowRate en admin/page.tsx).
  const noShows = cur.filter(a => a.status === "no_show").length;
  // Ticket promedio = ingreso / cobros reales, sin los cobros en $0 (cortesías).
  const paidCount = cobradas.filter(a => cobradoDe(a) > 0).length + ventas.length;

  // Completadas sin venta: NO se valoran a precio de lista como ingreso (antes
  // marcar "Completada" inventaba plata: DIN-05). Se cuentan aparte como por
  // cobrar, para que no desaparezcan del reporte sin explicación.
  const sinCobro = cur.filter(a => a.status === "completed" && !estaCobrada(a) && !a.imported);

  // Clientes nuevos: comparar el DÍA del negocio en que se creó el cliente.
  // Comparar el timestamp con la fecha dejaba fuera el último día (TZ-05).
  const creados = new Map<string, string>();
  cur.forEach(a => { if (a.clients?.id && a.clients.created_at) creados.set(a.clients.id, a.clients.created_at); });
  const newClients = Array.from(creados.values())
    .map(c => diaLocalDe(c, tz))
    .filter(d => d >= r.desde && d <= r.hasta).length;

  // Ingresos por franja: días del rango (o meses del año) como cadenas, sin
  // new Date(y, m, d).toISOString(), que en UTC+ corría todo un día (TZ-02).
  let slots: { label: string; value: number }[];
  if (r.periodo === "anio") {
    const y = r.desde.slice(0, 4);
    slots = MESES_CORTOS.map((label, i) => {
      const mes = `${y}-${String(i + 1).padStart(2, "0")}`;
      return {
        label,
        value: cobradas.filter(a => mesDe(a.appointment_date) === mes).reduce((s, a) => s + cobradoDe(a), 0)
             + ventas.filter(x => mesDe(x.dia) === mes).reduce((s, x) => s + montoDe(x.v), 0),
      };
    });
  } else {
    slots = listaDeDias(r.desde, r.hasta).map((dia, i) => ({
      label: r.periodo === "semana" ? LETRAS_SEMANA[i] ?? "" : String(Number(dia.slice(8, 10))),
      value: cobradas.filter(a => a.appointment_date === dia).reduce((s, a) => s + cobradoDe(a), 0)
           + ventas.filter(x => x.dia === dia).reduce((s, x) => s + montoDe(x.v), 0),
    }));
  }

  const svcMap = new Map<string, number>();
  activas.forEach(a => {
    const sn = a.services?.name ?? "Sin servicio";
    svcMap.set(sn, (svcMap.get(sn) ?? 0) + 1);
  });
  const topServices = Array.from(svcMap.entries())
    .sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  const staffMap = new Map<string, { count: number; revenue: number }>();
  cobradas.forEach(a => {
    const sn = a.professionals?.name ?? "Sin profesional";
    const p2 = staffMap.get(sn) ?? { count: 0, revenue: 0 };
    staffMap.set(sn, { count: p2.count + 1, revenue: p2.revenue + cobradoDe(a) });
  });
  const staffPerf = Array.from(staffMap.entries())
    .sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 5)
    .map(([name, v]) => ({ name, ...v }));

  // Horas: 7–19 h ampliado con las que tengan citas (antes se recortaba y la
  // hora pico de las 20 h no tenía barra: TZ-09).
  const horas = activas.map(a => horaDe(a.appointment_time));
  const hourly = rangoDeHoras(horas, 7, 19).map(h => ({
    hour: h,
    label: `${h}h`,
    value: horas.filter(x => x === h).length,
  }));

  return {
    clave: claveDe(r),
    sede,
    revenue,
    prevRevenue,
    apptCount: activas.length,
    prevCount: prv.filter(a => a.status !== "cancelled").length,
    avgTicket: paidCount > 0 ? revenue / paidCount : 0,
    noShowRate: activas.length > 0 ? (noShows / activas.length) * 100 : 0,
    newClients,
    sinCobroCount: sinCobro.length,
    sinCobroMonto: sinCobro.reduce((s, a) => s + precioDeLista(a), 0),
    slots,
    topServices,
    staffPerf,
    hourly,
  };
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
  const { tenantId } = useAuth();
  const { timezone, ready } = useTenant();
  const guard = useGuardRespuestas();
  const [period, setPeriod] = useState<Period>("mes");
  // Día de referencia del periodo que se mira. null = el periodo actual, así
  // la pantalla sigue a "hoy" si cambia el día (o la semana) con la app abierta.
  const [ref, setRef] = useState<string | null>(null);
  const [datos, setDatos] = useState<Reporte | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);

  const { hoy, recargar } = useRecarga(async () => {
    if (!tenantId) return;
    const turno = guard.nuevo();
    try {
      const r = rangoDePeriodo(period, timezone, ref ?? hoyNegocio(timezone));
      const rep = await cargarReporte(tenantId, r);
      if (!turno.vigente()) return;
      setDatos(rep);
      setError(null);
    } catch (e) {
      if (turno.vigente()) setError(e);
    }
  }, [tenantId, timezone, period, ref], { timeZone: timezone, habilitado: !!tenantId && ready });

  const r = rangoDePeriodo(period, timezone, ref ?? hoy);
  const actual = rangoIncluyeHoy(r);
  const d = datos && datos.clave === claveDe(r) ? datos : null;

  const cambiarPeriodo = (p: Period) => { setPeriod(p); setRef(null); };
  const mover = (pasos: number) => {
    const nueva = moverReferencia(period, r.desde, pasos);
    // Volver al periodo de hoy lo deja en "actual" (sigue al cambio de día).
    setRef(rangoIncluyeHoy(rangoDePeriodo(period, timezone, nueva)) ? null : nueva);
  };

  const onRefresh = async () => { setRefreshing(true); await recargar(); setRefreshing(false); };

  const revTrend   = d && d.prevRevenue > 0 ? ((d.revenue - d.prevRevenue) / d.prevRevenue) * 100 : 0;
  const countTrend = d && d.prevCount   > 0 ? ((d.apptCount - d.prevCount) / d.prevCount) * 100   : 0;
  const peak = d ? d.hourly.reduce((a, b) => (b.value > a.value ? b : a), { hour: 0, value: 0, label: "" }) : null;

  const periodLabel = actual
    ? (period === "semana" ? "esta semana" : period === "mes" ? "este mes" : "este año")
    : etiquetaRango(r);
  const periodTag = period === "semana" ? "Semana" : period === "mes" ? "Mes" : "Año";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.canvas }}>
      <ScreenHeader
        crumb="Dinero"
        title="Reportes"
        subtitle={d?.sede ? `Sede ${d.sede} · solo lo cobrado` : "Análisis de rendimiento · solo lo cobrado"}
        onBack={() => router.back()}
      />

      <View style={{ paddingHorizontal: 20, paddingTop: 12, gap: 10 }}>
        <SegmentedControl<Period>
          options={[
            { value: "semana", label: "Semana" },
            { value: "mes", label: "Mes" },
            { value: "anio", label: "Año" },
          ]}
          value={period}
          onChange={cambiarPeriodo}
        />
        <View style={s.navRow}>
          <IconButton icon="chevron-back" label="Periodo anterior" onPress={() => mover(-1)} />
          <TouchableOpacity
            style={{ flex: 1, alignItems: "center" }}
            onPress={() => setRef(null)}
            disabled={actual}
            accessibilityRole="button"
            accessibilityLabel={actual ? etiquetaRango(r) : `${etiquetaRango(r)}. Volver al periodo actual`}
          >
            <Text style={[s.navLabel, { color: t.ink }]}>{etiquetaRango(r)}</Text>
            {!actual ? <Text style={[s.navHint, { color: Colors.red }]}>Volver a hoy</Text> : null}
          </TouchableOpacity>
          <IconButton icon="chevron-forward" label="Periodo siguiente" onPress={() => mover(1)} disabled={actual} />
        </View>
      </View>

      {error && !d ? (
        <ErrorState error={error} onRetry={recargar} />
      ) : !d ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={Colors.red} size="large" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 20, paddingTop: 12, paddingBottom: 110, gap: 14 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.red} />}
        >
          {error ? (
            <TouchableOpacity
              onPress={recargar}
              activeOpacity={0.8}
              style={[s.staleBanner, { backgroundColor: t.cardSolid, borderColor: "rgba(251,15,5,0.32)" }]}
              accessibilityRole="button"
              accessibilityLabel="No se pudo actualizar. Reintentar"
            >
              <Ionicons name="alert-circle-outline" size={16} color={Colors.red} />
              <Text style={[s.staleText, { color: t.ink }]} numberOfLines={2}>No se pudo actualizar: {mensajeError(error)}</Text>
              <Text style={s.staleRetry}>Reintentar</Text>
            </TouchableOpacity>
          ) : null}

          {/* KPIs */}
          <View style={s.kpiRow}>
            <KpiCard
              label="Ingresos" raw={d.revenue} fmt={fmtMoney} icon="cash-outline"
              trend={revTrend > 0 ? "up" : revTrend < 0 ? "down" : "neutral"}
              trendVal={d.prevRevenue > 0 ? `${revTrend > 0 ? "+" : ""}${pct(revTrend)}` : undefined}
              sub={d.prevRevenue > 0 ? "vs anterior" : undefined}
              delay={0}
            />
            <KpiCard
              label="Citas" raw={d.apptCount} fmt={v => String(Math.round(v))} icon="calendar-outline"
              trend={countTrend > 0 ? "up" : countTrend < 0 ? "down" : "neutral"}
              trendVal={d.prevCount > 0 ? `${countTrend > 0 ? "+" : ""}${pct(countTrend)}` : undefined}
              sub={d.prevCount > 0 ? "vs anterior" : undefined}
              delay={60}
            />
          </View>
          <View style={s.kpiRow}>
            <KpiCard label="Ticket promedio" raw={d.avgTicket} fmt={fmtMoney} icon="pricetag-outline" delay={120} />
            <KpiCard label="No asistió" raw={d.noShowRate} fmt={v => pct(v)} icon="person-remove-outline" alert={d.noShowRate > 15} delay={180} />
            <KpiCard label="Nuevos" raw={d.newClients} fmt={v => String(Math.round(v))} icon="person-add-outline" delay={240} />
          </View>

          {d.sinCobroCount > 0 ? (
            <View
              style={[s.aviso, { backgroundColor: t.cardSolid, borderColor: "rgba(217,119,6,0.35)" }]}
              accessible
              accessibilityRole="text"
            >
              <Ionicons name="wallet-outline" size={16} color="#d97706" />
              <Text style={[s.avisoText, { color: t.ink }]}>
                {d.sinCobroCount} cita{d.sinCobroCount !== 1 ? "s" : ""} completada{d.sinCobroCount !== 1 ? "s" : ""} sin cobro
                {d.sinCobroMonto > 0 ? ` · ${fmtMoney(d.sinCobroMonto)} por cobrar` : ""}. No suman en los ingresos hasta que se cobren.
              </Text>
            </View>
          ) : null}

          {/* Evolución de ingresos */}
          <Card delay={280}>
            <CardHead
              title={period === "anio" ? "Ingresos por mes" : "Ingresos por día"}
              sub={`Resumen ${periodLabel}`}
              aside={periodTag}
            />
            <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 }}>
              <AreaChart data={d.slots} fmt={fmtMoney} height={180} />
            </View>
          </Card>

          {/* Top servicios */}
          <Card delay={330}>
            <CardHead title="Top 5 servicios" sub="Los más solicitados del período" />
            <View style={{ padding: 18 }}>
              <RankBars
                items={d.topServices.map(svc => ({
                  label: svc.name, value: svc.count,
                  sub: d.apptCount > 0 ? `${((svc.count / d.apptCount) * 100).toFixed(0)}%` : undefined,
                }))}
                fmt={v => String(Math.round(v))}
              />
            </View>
          </Card>

          {/* Rendimiento del equipo */}
          <Card delay={380}>
            <CardHead title="Rendimiento del equipo" sub="Por lo cobrado en el período" />
            <View style={{ padding: 18 }}>
              <RankBars
                items={d.staffPerf.map(p => ({
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
              sub={peak && peak.value > 0 ? `Pico: ${peak.hour}:00 – ${peak.hour + 1}:00` : "Distribución de la agenda"}
            />
            <View style={{ paddingHorizontal: 18, paddingTop: 16, paddingBottom: 14 }}>
              {d.hourly.some(h => h.value > 0)
                ? <Bars data={d.hourly} accent="green" height={120} />
                : <ChartEmpty msg={`Sin citas ${periodLabel}.`} />}
            </View>
          </Card>

          {/* Empty state */}
          {d.revenue === 0 && d.apptCount === 0 && (
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
  kpiRow:   { flexDirection: "row", gap: 10 },
  navRow:   { flexDirection: "row", alignItems: "center", gap: 10 },
  navLabel: { fontSize: 14, fontFamily: Fonts.semibold, textTransform: "capitalize" },
  navHint:  { fontSize: 11, fontFamily: Fonts.semibold, marginTop: 1 },
  staleBanner: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11 },
  staleText:   { flex: 1, fontSize: 12, fontFamily: Fonts.regular },
  staleRetry:  { fontSize: 12, fontFamily: Fonts.bold, color: Colors.red },
  aviso:       { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11 },
  avisoText:   { flex: 1, fontSize: 12, fontFamily: Fonts.regular, lineHeight: 17 },
});
