import { useEffect, useRef, useState } from "react";
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl, ActivityIndicator } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown, FadeInRight } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { getActiveLocationId } from "@/lib/active-location";
import {
  inicioDelDiaUTC, finDelDiaUTC, diaLocalDe, horaLocalDe, hoyNegocio, sumarDias,
  listaDeDias, diaDeSemana, fmtDia, minutosDelDia,
} from "@/lib/tz";
import { ErrorDB, esErrorDeRed, mensajeError, traerTodo } from "@/lib/db";
import { useGuardRespuestas, useRecarga } from "@/lib/useRecarga";
import {
  cobradoDe, estaCobrada, precioDeLista, ventasDe, montoDe, desglosePorMedio,
  rangoDeHoras, horaDe, type VentaResumen,
} from "@/lib/ingresos";
import { Colors, Fonts, Gradients, CardStyle } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { fmtMoney, fmtMoneyFull } from "@/lib/format";
import { agruparPorCobrar, traerPorCobrar, RUTA_POR_COBRAR } from "@/lib/porCobrar";
import { STATUS_META } from "@/constants/status";
import { refreshAllReminders } from "@/lib/notifications";
import NewApptModal from "@/components/NewApptModal";
import SubscriptionBanner from "@/components/SubscriptionBanner";
import ErrorState from "@/components/ErrorState";
import CampanaAvisos from "@/components/CampanaAvisos";
import { Card, CardHead, MonoTag, TrendChip, TenantBadge, SegmentedControl, useCountUp } from "@/components/ui";
import { Spark, AreaChart, Bars, Donut, RankBars, ChartEmpty } from "@/components/charts";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

/** Saludo según la hora DEL NEGOCIO (no la del teléfono, que puede estar de viaje). */
function greeting(timeZone: string) {
  const h = Math.floor(minutosDelDia(new Date(), timeZone) / 60);
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
  services: { name: string; price?: number | string | null } | null;
  appointment_services: { price: number | string | null }[] | null;
  /** Ventas de la cita (embed). Si hay alguna, la cita está cobrada. */
  pos_sales: VentaResumen[] | null;
};

/** Venta de mostrador (sin cita). */
type VentaSuelta = VentaResumen & { id: string; created_at: string };

type Period = "hoy" | "semana" | "mes";

const DAY_NAMES = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

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
/**
 * Con `onPress` la tarjeta se toca (p. ej. "Por cobrar" abre su detalle): un
 * "Ver detalle ›" discreto abajo avisa que se puede, y `a11yLabel` es lo que
 * dice el lector de pantalla (el monto completo, no el "$1.4M" abreviado).
 */
function MetricCard({ label, raw, fmt, sub, icon, trend, trendVal, alert, spark, delay = 0, onPress, a11yLabel, a11yHint }: {
  label: string; raw: number; fmt: (n: number) => string;
  sub?: string; icon: IoniconName;
  trend?: "up" | "down" | "neutral"; trendVal?: string;
  alert?: boolean; spark?: number[]; delay?: number;
  onPress?: () => void; a11yLabel?: string; a11yHint?: string;
}) {
  const { t } = useTheme();
  const v = useCountUp(raw);
  const contenido = (
    <>
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
      {onPress ? (
        <View style={ms.rowMore}>
          <Text style={[ms.more, { color: t.muted }]}>Ver detalle</Text>
          <Ionicons name="chevron-forward" size={12} color={t.subtle} />
        </View>
      ) : null}
    </>
  );
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
      {onPress ? (
        <TouchableOpacity
          style={ms.inner}
          onPress={onPress}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={a11yLabel}
          accessibilityHint={a11yHint}
        >
          {contenido}
        </TouchableOpacity>
      ) : (
        <View style={ms.inner}>{contenido}</View>
      )}
    </Animated.View>
  );
}

const ms = StyleSheet.create({
  // El relleno va adentro: en la tarjeta tocable toda la superficie responde.
  card:     { overflow: "hidden", width: "48.5%" as any, flexGrow: 1 },
  inner:    { padding: 15, flexGrow: 1 },
  alertBar: { position: "absolute", top: 0, left: 0, right: 0, height: 2.5 },
  rowTop:   { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  rowValue: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: 8, marginTop: 10 },
  value:    { fontSize: 22, fontFamily: Fonts.bold, letterSpacing: -0.8, lineHeight: 24, flexShrink: 1 },
  rowSub:   { flexDirection: "row", gap: 7, alignItems: "center", marginTop: 9, flexWrap: "wrap" },
  sub:      { fontSize: 11, fontFamily: Fonts.regular, flexShrink: 1 },
  rowMore:  { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 8 },
  more:     { fontSize: 11, fontFamily: Fonts.semibold },
});

// ─── Fila de cita (listItem del web) ─────────────────────────────────────────
const SIN_COBRO = { label: "Sin cobro", color: "#d97706" };

function ApptRow({ a, i, last, onPress }: { a: Appt; i: number; last: boolean; onPress: () => void }) {
  const { t } = useTheme();
  const time  = a.appointment_time.substring(0, 5);
  // Completada sin venta: no es ingreso sino "por cobrar" (D10). Se marca
  // distinto para que no pase por cobrada.
  const sinCobro = a.status === "completed" && !estaCobrada(a);
  const color = sinCobro ? SIN_COBRO.color : STATUS_META[a.status]?.color ?? t.subtle;
  const label = sinCobro ? SIN_COBRO.label : STATUS_META[a.status]?.label ?? a.status;

  return (
    <Animated.View entering={i < 10 ? FadeInRight.delay(i * 50).duration(300) : undefined}>
      <TouchableOpacity
        style={[apt.row, !last && { borderBottomWidth: 1, borderBottomColor: t.divider }]}
        onPress={onPress}
        activeOpacity={0.6}
        accessibilityRole="button"
        accessibilityLabel={`${time}, ${a.clients?.name ?? "Sin cliente"}, ${a.services?.name ?? "Sin servicio"}, ${label}`}
      >
        <Text style={[apt.time, { color: t.ink }]}>{time}</Text>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[apt.client, { color: t.ink }]} numberOfLines={1}>{a.clients?.name ?? "Sin cliente"}</Text>
          <Text style={[apt.service, { color: t.subtle }]} numberOfLines={1}>{a.services?.name ?? "Sin servicio"}</Text>
        </View>
        <View style={[apt.pill, { backgroundColor: color + "1F" }]}>
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

// ─── Datos del panel ──────────────────────────────────────────────────────────

type DashData = {
  /** Periodo y zona con que se calculó: no mostrar cifras de otro periodo. */
  clave: string;
  /** Nombre de la sede de las cifras; null si el negocio tiene una sola. */
  sede: string | null;
  revenue: number;
  prevRevenue: number;
  apptCount: number;
  confirmed: number;
  pending: number;
  /** Agendado que todavía no se ha cobrado (incluye completadas sin venta). */
  pendingRevenue: number;
  /** Parte de pendingRevenue cuya cita ya pasó y sigue sin cobrar. */
  overdueRevenue: number;
  overdueCount: number;
  /** Citas marcadas completadas sin venta: por cobrar, no ingreso (D10). */
  completedUnpaid: number;
  /** Plata que no entró: canceladas + inasistencias ya marcadas. */
  lostRevenue: number;
  cancelledCount: number;
  noShowCount: number;
  avgTicket: number;
  clients: number;
  revenueSeries: { label: string; value: number }[];
  hourly: { label: string; value: number }[];
  topServices: { label: string; value: number; sub?: string }[];
  payments: { label: string; value: number; color: string }[];
  todayAppts: Appt[];
};

async function cargarPanel(tenantId: string, p: Period, hoy: string, tz: string): Promise<DashData> {
  // Días del NEGOCIO, no del teléfono (TZ-06): después de las 7 PM en
  // Colombia el UTC ya es mañana, y con el teléfono en otra zona "hoy" era otro.
  const desde = p === "hoy" ? hoy : sumarDias(hoy, p === "semana" ? -6 : -29);
  const ayer  = sumarDias(hoy, -1);
  // Para "hoy" se trae también ayer, para la tendencia vs ayer.
  const fetchDesde = p === "hoy" ? ayer : desde;

  // Misma sede que el Resumen del panel web: las citas y las ventas se
  // filtran por location_id. Los clientes NO — son del negocio entero en
  // ambos lados.
  const loc = await getActiveLocationId(tenantId);

  const [citas, sueltas, clientesRes, porCobrar, sedesRes] = await Promise.all([
    traerTodo<Appt>((d, h) => {
      let q = supabase.from("appointments")
        .select("id, appointment_date, appointment_time, status, clients(name), services(name, price), appointment_services(price), pos_sales(total, payment_method, payments)")
        .eq("tenant_id", tenantId)
        .gte("appointment_date", fetchDesde)
        .lte("appointment_date", hoy);
      if (loc) q = q.eq("location_id", loc);
      return q.order("appointment_date").order("appointment_time").order("id").range(d, h)
        .overrideTypes<Appt[], { merge: false }>();
    }, { contexto: "No se pudieron cargar las citas" }),
    // Ventas de mostrador: el cobro de una cita ya viene en la cita (embed);
    // sumarlo aquí lo contaría dos veces.
    traerTodo<VentaSuelta>((d, h) => {
      let q = supabase.from("pos_sales")
        .select("id, total, created_at, payment_method, payments")
        .eq("tenant_id", tenantId)
        .is("appointment_id", null)
        // Fronteras en la zona del negocio: con el literal pelado, Postgres
        // las leía en UTC y los cobros de la noche caían fuera del día.
        .gte("created_at", inicioDelDiaUTC(fetchDesde, tz))
        .lte("created_at", finDelDiaUTC(hoy, tz));
      if (loc) q = q.eq("location_id", loc);
      return q.order("created_at").order("id").range(d, h);
    }, { contexto: "No se pudieron cargar las ventas" }),
    supabase.from("clients").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
    // Toda cita sin cobrar, de cualquier fecha (lib/porCobrar.ts): la MISMA
    // consulta y suma que la pantalla Por cobrar, que abre esta tarjeta.
    traerPorCobrar(tenantId, loc),
    // Sin sede activa (negocio sin sedes) no hay nada que nombrar.
    loc
      ? supabase.from("locations").select("id, name").eq("tenant_id", tenantId).eq("is_active", true)
      : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
  ]);
  if (clientesRes.error) throw new ErrorDB(clientesRes.error, "No se pudo contar los clientes");

  // Qué sede se está mirando, solo si hay más de una (ARQ-10): con varias, las
  // cifras de una sede parecían las del negocio entero. Es un rótulo: si esa
  // consulta falla, el panel se muestra igual, sin el nombre.
  const listaSedes = sedesRes.error ? [] : (sedesRes.data ?? []);
  const sede = listaSedes.length > 1 ? (listaSedes.find(x => x.id === loc)?.name ?? "Sede activa") : null;

  const enPeriodo = (dia: string) => dia >= desde && dia <= hoy;

  // La otra mitad del problema de zona: agrupar en memoria por el día y la
  // hora DEL NEGOCIO. Arreglar los límites de la consulta no basta.
  const ventas = sueltas.map(v => ({ v, dia: diaLocalDe(v.created_at, tz), hora: horaDe(horaLocalDe(v.created_at, tz)) }));
  const ventasPeriodo = ventas.filter(x => enPeriodo(x.dia));

  const citasPeriodo = citas.filter(a => enPeriodo(a.appointment_date));
  // Ingreso = SOLO lo cobrado (D10): citas con venta, valoradas por lo que
  // se cobró, más las ventas de mostrador. Una completada sin venta es "por
  // cobrar", y una cita cobrada cuenta aunque después le cambien el estado.
  const cobradas = citasPeriodo.filter(estaCobrada);
  const sumCobrado = (list: Appt[]) => list.reduce((sum, a) => sum + cobradoDe(a), 0);
  const sumVentas  = (list: typeof ventas) => list.reduce((sum, x) => sum + montoDe(x.v), 0);

  const revenue = sumCobrado(cobradas) + sumVentas(ventasPeriodo);

  // Tendencia vs ayer (solo período "hoy")
  const prevRevenue = p === "hoy"
    ? sumCobrado(citas.filter(a => a.appointment_date === ayer && estaCobrada(a)))
      + sumVentas(ventas.filter(x => x.dia === ayer))
    : 0;

  const active    = citasPeriodo.filter(a => a.status !== "cancelled");
  const confirmed = citasPeriodo.filter(a => a.status === "confirmed").length;
  const pending   = citasPeriodo.filter(a => a.status === "pending").length;
  // El divisor del ticket promedio excluye los cobros en $0 — cortesías y
  // demás. Contarlos hunde el promedio sin que haya entrado plata de por
  // medio. Mismo criterio que avgTicket en admin/page.tsx.
  const paidCount = cobradas.filter(a => cobradoDe(a) > 0).length + ventasPeriodo.length;
  const avgTicket = paidCount > 0 ? revenue / paidCount : 0;

  // Por cobrar: plata comprometida, no ingreso — nunca entra en "Ingresos".
  // Vencidas: la cita ya pasó (día del negocio) y nadie la cobró. Se marcan en
  // rojo para que el negocio decida; hasta que lo haga NO es una pérdida.
  const resumenPorCobrar = agruparPorCobrar(porCobrar, hoy);
  const pendingRevenue   = resumenPorCobrar.total;
  const overdueRevenue   = resumenPorCobrar.vencidas.total;
  const overdueCount     = resumenPorCobrar.vencidas.citas.length;
  const completedUnpaid  = resumenPorCobrar.completadasSinCobro;

  // Pérdidas: solo lo que el negocio marcó como caído y no se cobró.
  const perdidas       = citasPeriodo.filter(a => (a.status === "cancelled" || a.status === "no_show") && !estaCobrada(a));
  const cancelledCount = perdidas.filter(a => a.status === "cancelled").length;
  const noShowCount    = perdidas.filter(a => a.status === "no_show").length;
  const lostRevenue    = perdidas.reduce((sum, a) => sum + precioDeLista(a), 0);

  // ── Serie de ingresos alineada al período (mismo criterio que el hero) ──
  let revenueSeries: { label: string; value: number }[];
  if (p === "hoy") {
    const horas = rangoDeHoras([
      ...cobradas.map(a => horaDe(a.appointment_time)),
      ...ventasPeriodo.map(x => x.hora),
    ]);
    revenueSeries = horas.map(h => ({
      label: `${String(h).padStart(2, "0")}h`,
      value: sumCobrado(cobradas.filter(a => horaDe(a.appointment_time) === h))
           + sumVentas(ventasPeriodo.filter(x => x.hora === h)),
    }));
  } else if (p === "semana") {
    revenueSeries = listaDeDias(desde, hoy).map(d => ({
      label: `${DAY_NAMES[diaDeSemana(d) - 1]} ${Number(d.slice(8, 10))}`,
      value: sumCobrado(cobradas.filter(a => a.appointment_date === d)) + sumVentas(ventasPeriodo.filter(x => x.dia === d)),
    }));
  } else {
    // Tramos de 7 días desde el inicio del período; el último termina hoy.
    revenueSeries = [];
    for (let ws = desde; ws <= hoy; ws = sumarDias(ws, 7)) {
      const we = sumarDias(ws, 6) < hoy ? sumarDias(ws, 6) : hoy;
      revenueSeries.push({
        label: fmtDia(ws, "dia-mes"),
        value: sumCobrado(cobradas.filter(a => a.appointment_date >= ws && a.appointment_date <= we))
             + sumVentas(ventasPeriodo.filter(x => x.dia >= ws && x.dia <= we)),
      });
    }
  }

  const horasCitas = rangoDeHoras(active.map(a => horaDe(a.appointment_time)));
  const hourly = horasCitas.map(h => ({
    label: `${String(h).padStart(2, "0")}h`,
    value: active.filter(a => horaDe(a.appointment_time) === h).length,
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

  // Medios de pago de LAS MISMAS ventas que suman el hero, con los pagos
  // divididos repartidos por método real: el total del donut cuadra con
  // "Ingresos" (DIN-14 / CAL-23).
  const payments = desglosePorMedio([...cobradas.flatMap(ventasDe), ...ventasPeriodo.map(x => x.v)])
    .map(({ label, value, color }) => ({ label, value, color }));

  const todayAppts = citas.filter(a => a.appointment_date === hoy);

  return {
    clave: `${p}|${tz}`,
    sede,
    revenue, prevRevenue, apptCount: active.length, confirmed, pending,
    pendingRevenue, overdueRevenue, overdueCount, completedUnpaid,
    lostRevenue, cancelledCount, noShowCount,
    avgTicket, clients: clientesRes.count ?? 0, revenueSeries, hourly, topServices,
    payments, todayAppts,
  };
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const { tenantId } = useAuth();
  const { tenant: tenantData, timezone, ready } = useTenant();
  const tenantName = tenantData?.name ?? "Tu negocio";
  const guard = useGuardRespuestas();

  const [period, setPeriod]         = useState<Period>("hoy");
  const [data, setData]             = useState<DashData | null>(null);
  const [error, setError]           = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showNew, setShowNew]       = useState(false);

  // Carga al enfocar, al volver a primer plano, al cambiar de día o de sede, y
  // espera la zona real del negocio (antes cargaba con la de Bogotá: DIN-09).
  const { hoy, recargar } = useRecarga(async () => {
    if (!tenantId) return;
    const turno = guard.nuevo();
    try {
      const d = await cargarPanel(tenantId, period, hoyNegocio(timezone), timezone);
      if (!turno.vigente()) return;
      setData(d);
      setError(null);
    } catch (e) {
      if (turno.vigente()) setError(e);
    }
  }, [tenantId, timezone, period], { timeZone: timezone, habilitado: !!tenantId && ready });

  // Recordatorios locales: una vez por negocio y zona, no en cada enfoque.
  const recordatoriosDe = useRef<string | null>(null);
  useEffect(() => {
    if (!tenantId || !ready) return;
    const clave = `${tenantId}|${timezone}`;
    if (recordatoriosDe.current === clave) return;
    recordatoriosDe.current = clave;
    // En segundo plano: si falla se reintenta en la próxima carga del Panel.
    refreshAllReminders(tenantId, timezone).catch(() => { recordatoriosDe.current = null; });
  }, [tenantId, timezone, ready]);

  const onRefresh = async () => { setRefreshing(true); await recargar(); setRefreshing(false); };

  const periodTag   = period === "hoy" ? "Hoy" : period === "semana" ? "7 días" : "30 días";
  const periodLabel = period === "hoy" ? "hoy" : period === "semana" ? "últimos 7 días" : "últimos 30 días";

  // Al cambiar de periodo no se muestran un instante las cifras del anterior
  // bajo la etiqueta nueva: spinner hasta que llegan las correctas.
  const d = data && data.clave === `${period}|${timezone}` ? data : null;
  const revDiff  = d ? d.revenue - d.prevRevenue : 0;
  const revTrend: "up" | "down" | "neutral" = revDiff > 0 ? "up" : revDiff < 0 ? "down" : "neutral";
  const posTotal = d ? d.payments.reduce((sum, p) => sum + p.value, 0) : 0;
  // De la última carga (no de `d`): así el rótulo no parpadea al cambiar de
  // periodo. Al cambiar de sede, useRecarga recarga y lo actualiza.
  const sede = data?.sede ?? null;

  const porCobrarSub = !d ? "" : d.overdueCount > 0
    ? `${fmtMoney(d.overdueRevenue)} vencido · ${d.overdueCount} sin cobrar`
    : d.completedUnpaid > 0 ? `${d.completedUnpaid} completada${d.completedUnpaid !== 1 ? "s" : ""} sin cobro` : "total sin cobrar";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.canvas }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.red} />}
        contentContainerStyle={{ padding: 20, paddingBottom: 120, gap: 14, flexGrow: 1 }}
      >
        {/* Aviso de prueba por terminar / plan por vencer / pago en mora */}
        <SubscriptionBanner />

        {/* ── Header compacto (patrón del web: título + fecha serif) ── */}
        <Animated.View entering={FadeInDown.duration(350)}>
          <View style={s.headerRow}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <MonoTag>Panel</MonoTag>
              <Text style={[s.greeting, { color: t.ink }]}>{greeting(timezone)}</Text>
              <Text style={[s.date, { color: t.muted }]}>{fmtDia(hoy, "largo")}</Text>
              {sede ? (
                <TouchableOpacity
                  onPress={() => router.push("/settings/locations" as any)}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={[s.sedeChip, { backgroundColor: t.chipBg, borderColor: t.line }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Sede ${sede}. Cambiar de sede`}
                >
                  <Ionicons name="location-outline" size={12} color={t.muted} />
                  <Text style={[s.sedeText, { color: t.muted }]} numberOfLines={1}>{sede}</Text>
                  <Ionicons name="chevron-down" size={12} color={t.subtle} />
                </TouchableOpacity>
              ) : null}
            </View>
            {/* Campana de avisos al lado del nombre del negocio (como el portal). */}
            <View style={s.headerAside}>
              <TenantBadge name={tenantName} style={s.tenantBadge} />
              <CampanaAvisos />
            </View>
          </View>

          <View style={s.controlsRow}>
            <SegmentedControl<Period>
              options={[
                { value: "hoy", label: "Hoy" },
                { value: "semana", label: "7 días" },
                { value: "mes", label: "30 días" },
              ]}
              value={period}
              onChange={setPeriod}
            />
            <TouchableOpacity onPress={() => setShowNew(true)} activeOpacity={0.85} style={s.newBtnWrap} accessibilityRole="button" accessibilityLabel="Nueva cita">
              <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.newBtn}>
                <Ionicons name="add" size={14} color="white" />
                <Text style={s.newBtnText}>Nueva cita</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </Animated.View>

        {/* Un fallo de red ya no se pinta como "$0": sin datos, error con
            reintento; con datos viejos, un aviso encima (ARQ-11). */}
        {error && !d ? (
          <ErrorState error={error} onRetry={recargar} />
        ) : !d ? (
          <View style={s.loadingBox}>
            <ActivityIndicator color={Colors.red} size="large" />
          </View>
        ) : (
          <>
            {error ? (
              <TouchableOpacity
                onPress={recargar}
                activeOpacity={0.8}
                style={[s.staleBanner, { backgroundColor: t.cardSolid, borderColor: "rgba(251,15,5,0.32)" }]}
                accessibilityRole="button"
                accessibilityLabel="No se pudo actualizar. Reintentar"
              >
                <Ionicons name={esErrorDeRed(error) ? "cloud-offline-outline" : "alert-circle-outline"} size={16} color={Colors.red} />
                <Text style={[s.staleText, { color: t.ink }]} numberOfLines={2}>
                  No se pudo actualizar: {mensajeError(error)}
                </Text>
                <Text style={s.staleRetry}>Reintentar</Text>
              </TouchableOpacity>
            ) : null}

            {/* ── Hero de ingresos ── */}
            <HeroCard
              label={period === "hoy" ? "Ingresos de hoy" : "Ingresos del período"}
              raw={d.revenue}
              tag={periodTag}
              trend={period === "hoy" ? revTrend : undefined}
              trendVal={period === "hoy" ? (Math.abs(revDiff) > 0 ? `${fmtMoney(Math.abs(revDiff))} vs ayer` : "igual vs ayer") : undefined}
              sub={period !== "hoy" ? `Cobrado · ${periodLabel}` : "Solo lo cobrado"}
              spark={d.revenueSeries.map(x => x.value)}
            />

            {/* ── Métricas ── */}
            <View style={s.metricsGrid}>
              <MetricCard
                icon="calendar-outline"
                label={period === "hoy" ? "Citas hoy" : "Citas"}
                raw={d.apptCount} fmt={v => String(Math.round(v))}
                sub={`${d.confirmed} confirmadas`}
                spark={d.hourly.map(h => h.value)}
                delay={60}
              />
              <MetricCard
                icon="notifications-outline"
                label="Pendientes"
                raw={d.pending} fmt={v => String(Math.round(v))}
                sub="requieren acción"
                alert={d.pending > 3}
                trend={d.pending > 3 ? "down" : "neutral"}
                trendVal={d.pending > 3 ? "atención" : undefined}
                delay={110}
              />
              {/* Se toca: abre la lista de citas que suman esta cifra (lib/porCobrar). */}
              <MetricCard
                icon="wallet-outline"
                label="Por cobrar"
                raw={d.pendingRevenue} fmt={v => fmtMoney(v)}
                sub={porCobrarSub}
                alert={d.overdueCount > 0}
                delay={160}
                onPress={() => router.push(RUTA_POR_COBRAR)}
                a11yLabel={`Por cobrar: ${fmtMoneyFull(d.pendingRevenue)}${d.overdueCount > 0 ? `, ${fmtMoneyFull(d.overdueRevenue)} vencido` : ""}. Ver detalle`}
                a11yHint="Muestra de qué citas es y deja cobrarlas"
              />
              <MetricCard
                icon="close-circle-outline"
                label="Pérdidas"
                raw={d.lostRevenue} fmt={v => fmtMoney(v)}
                sub={`${d.cancelledCount} cancel. · ${d.noShowCount} inasist.`}
                // El rojo se enciende solo cuando se perdió más del 15% de lo
                // que se pudo haber cobrado. Toda empresa tiene cancelaciones:
                // alertar con que haya un peso perdido convierte el rojo en
                // ruido. Mismo umbral que usa el panel web para inasistencias.
                alert={d.lostRevenue > (d.revenue + d.lostRevenue) * 0.15}
                delay={210}
              />
              <MetricCard
                icon="card-outline"
                label="Ticket promedio"
                raw={d.avgTicket} fmt={v => fmtMoney(v)}
                sub="por cobro"
                delay={260}
              />
              <MetricCard
                icon="people-outline"
                label="Clientes"
                raw={d.clients} fmt={v => String(Math.round(v))}
                sub="en tu base"
                delay={310}
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
                <AreaChart data={d.revenueSeries} fmt={fmtMoney} height={180} />
              </View>
            </Card>

            {/* ── Citas por hora ── */}
            <Card delay={280}>
              <CardHead title="Citas por hora" sub="Distribución de la agenda" />
              <View style={{ paddingHorizontal: 18, paddingTop: 16, paddingBottom: 14 }}>
                <Bars data={d.hourly} accent="green" height={130} />
              </View>
            </Card>

            {/* ── Top servicios ── */}
            <Card delay={320}>
              <CardHead title="Top 5 servicios" sub="Los más solicitados del período" />
              <View style={{ padding: 18 }}>
                <RankBars items={d.topServices} fmt={v => String(Math.round(v))} />
              </View>
            </Card>

            {/* ── Medios de pago ── */}
            <Card delay={360}>
              <CardHead
                title="Medios de pago"
                sub="Cómo se cobraron los ingresos del período"
                aside={posTotal > 0 ? fmtMoney(posTotal) : undefined}
              />
              <View style={{ padding: 18 }}>
                <Donut data={d.payments} fmt={fmtMoney} centerLabel="cobrado" />
              </View>
            </Card>

            {/* ── Agenda de hoy ── */}
            <Card delay={400}>
              <CardHead
                title="Agenda de hoy"
                sub={`${d.todayAppts.length} agendada${d.todayAppts.length !== 1 ? "s" : ""}`}
                aside={(
                  <TouchableOpacity onPress={() => router.navigate("/agenda" as any)} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Ver toda la agenda">
                    <Text style={s.seeAll}>Ver todo →</Text>
                  </TouchableOpacity>
                )}
              />
              {d.todayAppts.length === 0 ? (
                <ChartEmpty
                  msg="Sin citas para hoy."
                  action={(
                    <TouchableOpacity onPress={() => setShowNew(true)} activeOpacity={0.85} accessibilityRole="button">
                      <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.emptyBtn}>
                        <Ionicons name="add" size={14} color="white" />
                        <Text style={s.emptyBtnText}>Agendar cita</Text>
                      </LinearGradient>
                    </TouchableOpacity>
                  )}
                />
              ) : (
                d.todayAppts.map((a, i) => (
                  <ApptRow
                    key={a.id}
                    a={a}
                    i={i}
                    last={i === d.todayAppts.length - 1}
                    onPress={() => router.navigate("/agenda" as any)}
                  />
                ))
              )}
            </Card>
          </>
        )}

        {/* ── Acceso a reportes ── */}
        <Card delay={440}>
          <TouchableOpacity style={s.reportsRow} onPress={() => router.navigate("/(admin)/reports" as any)} activeOpacity={0.6} accessibilityRole="button">
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
          // El día del negocio tal cual ('YYYY-MM-DD'): con new Date() el
          // teléfono en otra zona abría el modal en otro día.
          initialDate={hoy}
          onSuccess={() => { recargar(); }}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  headerRow:   { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  headerAside: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1, maxWidth: "58%" },
  // Con la campana al lado el nombre se corta antes, para no apretar el saludo.
  tenantBadge: { alignSelf: "center", flexShrink: 1, maxWidth: 150 },
  greeting:    { fontSize: 23, fontFamily: Fonts.bold, letterSpacing: -0.6, marginTop: 3 },
  date:        { fontSize: 15.5, fontFamily: Fonts.serifItalic, marginTop: 2, textTransform: "capitalize" },
  sedeChip:    { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", maxWidth: "100%", borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginTop: 8 },
  sedeText:    { fontSize: 11.5, fontFamily: Fonts.semibold, flexShrink: 1 },

  controlsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 14, flexWrap: "wrap" },
  newBtnWrap:  { borderRadius: 9, overflow: "hidden" },
  newBtn:      { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 14, paddingVertical: 9 },
  newBtnText:  { fontSize: 12.5, fontFamily: Fonts.bold, color: "white" },

  loadingBox:  { paddingVertical: 80, alignItems: "center", justifyContent: "center" },
  staleBanner: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11 },
  staleText:   { flex: 1, fontSize: 12, fontFamily: Fonts.regular },
  staleRetry:  { fontSize: 12, fontFamily: Fonts.bold, color: Colors.red },

  metricsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },

  seeAll:      { fontSize: 12, fontFamily: Fonts.semibold, color: Colors.red },

  emptyBtn:     { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 9, paddingHorizontal: 16, paddingVertical: 9 },
  emptyBtnText: { fontSize: 12.5, fontFamily: Fonts.bold, color: "white" },

  reportsRow:   { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  reportsIcon:  { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  reportsTitle: { fontSize: 13.5, fontFamily: Fonts.semibold },
  reportsSub:   { fontSize: 11.5, fontFamily: Fonts.regular, marginTop: 1 },
});
