import { useMemo, useState } from "react";
import { useRouter } from "expo-router";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, ActivityIndicator, Alert,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown, FadeInRight } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { getActiveLocationId } from "@/lib/active-location";
import { Colors, Gradients, Radius, Shadow } from "@/constants/theme";
import { useTheme, type ThemeColors } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { fmtMoneyFull, fmt12 } from "@/lib/format";
import { sumarDias, inicioDelDiaUTC, finDelDiaUTC, horaLocalDe, fmtDia, hoyNegocio } from "@/lib/tz";
import { exigirFilas, mensajeError, traerTodo } from "@/lib/db";
import { useRecarga, useGuardRespuestas } from "@/lib/useRecarga";
import { cancelarRecordatorioCita } from "@/lib/notifications";
import {
  cobradoDe, desglosePorMedio, estaCobrada, montoDe, precioDeLista, ventasDe, type VentaResumen,
} from "@/lib/ingresos";
import ErrorState from "@/components/ErrorState";
import SedeChip, { cargarListaSedes, nombreSede } from "@/components/SedeChip";
import AnularCobroModal, { type CobroAAnular } from "@/components/AnularCobroModal";
import ChargeSheet, { methodCfg as getMethodCfg, type ChargeTarget, type LinkedAppt } from "@/components/ChargeSheet";

// ─── Types ────────────────────────────────────────────────────────────────────

type Appt = {
  id: string;
  appointment_time: string;
  status: string;
  client_id: string | null;
  service_id: string | null;
  location_id: string | null;
  clients: { name: string; phone?: string | null } | null;
  services: { name: string; price: number } | null;
  /** Servicios adicionales: se cobran junto al principal (DIN-23). */
  appointment_services: { price: number }[] | null;
  /**
   * Cobros de la cita, embebidos (se hayan hecho el día que se hayan hecho):
   * así una cita ya cobrada nunca vuelve a ofrecer "Cobrar". Mismo criterio
   * que el Panel y Reportes (lib/ingresos.ts, D10).
   */
  pos_sales: VentaResumen[] | null;
};

type PosSale = {
  id: string;
  created_at: string;
  total: number;
  payment_method: string;
  payments: { method: string; amount: number }[] | null;
  note: string | null;
  appointment_id: string | null;
  clients: { name: string } | null;
  pos_sale_items: { name: string; price: number; quantity: number }[];
};

/** Lo cobrado por una cita (null = sin cobrar). */
type VentaCita = { total: number; payment_method: string };

/**
 * Cobro de la cita. Si quedó con dos cobros (casos viejos, DIN-06) se suman,
 * y si se pagaron con métodos distintos se muestra como pago dividido.
 */
function ventaDeCita(a: Appt): VentaCita | null {
  if (!estaCobrada(a)) return null;
  const metodos = new Set(ventasDe(a).map(v => v.payment_method || "otro"));
  return { total: cobradoDe(a), payment_method: metodos.size === 1 ? [...metodos][0] : "mixto" };
}

/** Citas que todavía se pueden cobrar: activas, o completadas sin cobro (D10: "por cobrar"). */
function esCobrable(a: Appt): boolean {
  return a.status === "pending" || a.status === "confirmed" || a.status === "completed";
}

function toLinkedAppt(a: Appt): LinkedAppt {
  return {
    id: a.id,
    clientId: a.client_id,
    clientName: a.clients?.name ?? null,
    clientPhone: a.clients?.phone ?? null,
    serviceId: a.service_id,
    serviceName: a.services?.name ?? null,
    servicePrice: Number(a.services?.price ?? 0),
    locationId: a.location_id,
    time: a.appointment_time,
  };
}

// ─── Appointment card ─────────────────────────────────────────────────────────

function ApptCard({ appt, venta, onCobrar, onCancel, index }: {
  appt: Appt;
  /** Cobro registrado para esta cita (null = sin cobrar). */
  venta: VentaCita | null;
  onCobrar: () => void;
  onCancel: () => void;
  index: number;
}) {
  const { t } = useTheme();
  const ac = useMemo(() => crearEstilosCard(t), [t]);
  const price       = precioDeLista(appt);
  const time        = fmt12(appt.appointment_time.slice(0, 5));
  const isCancelled = appt.status === "cancelled" || appt.status === "no_show";
  // "Cobrado" lo decide el cobro, no el estado: una cita completada sin cobro
  // sigue por cobrar, y una cobrada no vuelve a mostrar "Cobrar" (DIN-06).
  const isPaid      = !!venta;
  const porCobrar   = !isPaid && esCobrable(appt);
  const completadaSinCobro = porCobrar && appt.status === "completed";

  const accentColor = isPaid ? Colors.success : isCancelled ? t.subtle : Colors.red;
  const method      = getMethodCfg(venta?.payment_method);
  const paidTotal   = venta ? Number(venta.total) : null;

  return (
    <Animated.View entering={FadeInRight.delay(index * 60).duration(320)}>
      <View style={[ac.card, Shadow.sm, isCancelled && { opacity: 0.5 }]}>
        <View style={[ac.accent, { backgroundColor: accentColor }]} />

        <View style={{ flex: 1, padding: 14 }}>
          <View style={ac.topRow}>
            <View style={[ac.timePill, { backgroundColor: accentColor + "15" }]}>
              <Ionicons name="time-outline" size={11} color={accentColor} />
              <Text style={[ac.timeText, { color: accentColor }]}>{time}</Text>
            </View>
            {(paidTotal ?? price) > 0 && (
              <Text style={[ac.price, isPaid && { color: Colors.success }]}>{fmtMoneyFull(paidTotal ?? price)}</Text>
            )}
          </View>

          <Text style={ac.clientName} numberOfLines={1}>{appt.clients?.name ?? "Sin cliente"}</Text>
          <Text style={ac.serviceName} numberOfLines={1}>
            {appt.services?.name ?? "Sin servicio"}
            {(appt.appointment_services?.length ?? 0) > 0 ? ` + ${appt.appointment_services!.length} adicional${appt.appointment_services!.length > 1 ? "es" : ""}` : ""}
          </Text>

          {completadaSinCobro && (
            <View style={[ac.methodTag, { backgroundColor: "rgba(245,158,11,0.14)", alignSelf: "flex-start", marginTop: 8 }]}>
              <Ionicons name="alert-circle-outline" size={11} color="#d97706" />
              <Text style={[ac.methodTagText, { color: "#d97706" }]}>Completada sin cobro</Text>
            </View>
          )}

          {porCobrar && (
            <View style={ac.actionRow}>
              {!completadaSinCobro && (
                <TouchableOpacity style={ac.cancelBtn} onPress={onCancel} activeOpacity={0.75} accessibilityRole="button" accessibilityLabel="Cancelar cita">
                  <Ionicons name="close" size={13} color={Colors.red} />
                  <Text style={ac.cancelText}>Cancelar</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={ac.cobraBtn} onPress={onCobrar} activeOpacity={0.85} accessibilityRole="button">
                <Ionicons name="card-outline" size={15} color="white" />
                <Text style={ac.cobraText}>Cobrar{price > 0 ? ` ${fmtMoneyFull(price)}` : ""}</Text>
              </TouchableOpacity>
            </View>
          )}

          {isPaid && (
            <View style={ac.paidRow}>
              <View style={ac.paidBadge}>
                <Ionicons name="checkmark-circle" size={13} color={Colors.success} />
                <Text style={ac.paidText}>Cobrado</Text>
              </View>
              {method && (
                <View style={[ac.methodTag, { backgroundColor: method.color + "12" }]}>
                  <Ionicons name={method.icon} size={11} color={method.color} />
                  <Text style={[ac.methodTagText, { color: method.color }]}>{method.label}</Text>
                </View>
              )}
            </View>
          )}

          {isCancelled && !isPaid && (
            <View style={[ac.methodTag, { backgroundColor: t.chipBg, alignSelf: "flex-start", marginTop: 10 }]}>
              <Text style={[ac.methodTagText, { color: t.muted }]}>{appt.status === "no_show" ? "No asistió" : "Cancelada"}</Text>
            </View>
          )}
        </View>
      </View>
    </Animated.View>
  );
}

function crearEstilosCard(t: ThemeColors) {
  return StyleSheet.create({
    card:        { backgroundColor: t.cardSolid, borderWidth: 1, borderColor: t.line, borderRadius: Radius.lg, flexDirection: "row", marginBottom: 10, overflow: "hidden" },
    accent:      { width: 5 },
    topRow:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
    timePill:    { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 5 },
    timeText:    { fontSize: 12, fontFamily: "SpaceGrotesk_700Bold" },
    price:       { fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", color: t.text },
    clientName:  { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: t.text, marginBottom: 2 },
    serviceName: { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: t.muted },
    actionRow:   { flexDirection: "row", gap: 8, marginTop: 14 },
    cancelBtn:   { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.red + "40", paddingHorizontal: 12, paddingVertical: 10 },
    cancelText:  { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.red },
    cobraBtn:    { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: Radius.md, paddingVertical: 11, backgroundColor: Colors.red },
    cobraText:   { fontSize: 13, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
    paidRow:     { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
    paidBadge:   { flexDirection: "row", alignItems: "center", gap: 4 },
    paidText:    { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.success },
    methodTag:   { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: Radius.full, paddingHorizontal: 9, paddingVertical: 4 },
    methodTagText:{ fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold" },
  });
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function PosScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const s = useMemo(() => crearEstilos(t), [t]);
  const { tenantId } = useAuth();
  const { timezone, ready } = useTenant();
  const guard = useGuardRespuestas();
  // Día elegido en la zona del NEGOCIO (DIN-11). null = hoy: así la pantalla
  // sigue a "hoy" cuando cambia el día con la app abierta.
  const [diaSel, setDiaSel]         = useState<string | null>(null);
  const [appts, setAppts]           = useState<Appt[]>([]);
  const [sales, setSales]           = useState<PosSale[]>([]);
  // Nombre de la sede de las cifras (solo con varias sedes: ARQ-10).
  const [sede, setSede]             = useState<string | null>(null);
  const [cargado, setCargado]       = useState(false);
  const [error, setError]           = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab]   = useState<"citas" | "cobros">("citas");
  // Hoja de cobro: una cita (precarga servicio + adicionales + cliente) o venta directa
  const [charge, setCharge]         = useState<ChargeTarget | null>(null);
  const [anular, setAnular]         = useState<CobroAAnular | null>(null);

  const { hoy, recargar } = useRecarga(async () => {
    if (!tenantId) return;
    const turno = guard.nuevo();
    const dia = diaSel ?? hoyNegocio(timezone);
    try {
      // Misma sede que el POS web (historial y citas del día por location_id).
      const loc = await getActiveLocationId(tenantId);
      const [citasCrudas, ventasCrudas, sedes] = await Promise.all([
        traerTodo((d, h) => {
          let q = supabase.from("appointments")
            .select("id, appointment_time, status, client_id, service_id, location_id, clients(name, phone), services(name, price), appointment_services(price), pos_sales(total, payment_method)")
            .eq("tenant_id", tenantId)
            .eq("appointment_date", dia);
          if (loc) q = q.eq("location_id", loc);
          return q.order("appointment_time").order("id").range(d, h);
        }, { contexto: "No se pudieron cargar las citas del día" }),
        // created_at es UTC: el día del negocio se acota con sus instantes reales.
        traerTodo((d, h) => {
          let q = supabase.from("pos_sales")
            .select("id, created_at, total, payment_method, payments, note, appointment_id, clients(name), pos_sale_items(name, price, quantity)")
            .eq("tenant_id", tenantId)
            .gte("created_at", inicioDelDiaUTC(dia, timezone))
            .lte("created_at", finDelDiaUTC(dia, timezone));
          if (loc) q = q.eq("location_id", loc);
          return q.order("created_at", { ascending: false }).order("id").range(d, h);
        }, { contexto: "No se pudieron cargar los cobros del día" }),
        cargarListaSedes(tenantId, loc),
      ]);
      // Los embebidos (clients, services…) llegan tipados como arreglos: se
      // leen con la forma real de la respuesta (objeto por FK muchos-a-uno).
      const citas = citasCrudas as unknown as Appt[];
      const ventas = ventasCrudas as unknown as PosSale[];
      if (!turno.vigente()) return;
      setAppts(citas);
      setSales(ventas);
      setSede(nombreSede(sedes, loc));
      setError(null);
      setCargado(true);
    } catch (e) {
      if (turno.vigente()) setError(e);
    }
  }, [tenantId, timezone, diaSel], { timeZone: timezone, habilitado: !!tenantId && ready });

  const dia = diaSel ?? hoy;
  const isToday = dia === hoy;
  const irA = (nuevo: string) => setDiaSel(nuevo >= hoy ? null : nuevo);

  const onRefresh = async () => { setRefreshing(true); await recargar(); setRefreshing(false); };

  const cancelAppt = (appt: Appt) => {
    Alert.alert("Cancelar cita", `¿Cancelar la cita de ${appt.clients?.name ?? "este cliente"}?`, [
      { text: "No", style: "cancel" },
      { text: "Cancelar cita", style: "destructive",
        onPress: async () => {
          try {
            // Solo si sigue activa: una cita cobrada o ya cambiada en otro
            // dispositivo no se cancela a ciegas.
            exigirFilas(
              await supabase.from("appointments").update({ status: "cancelled" })
                .eq("id", appt.id).in("status", ["pending", "confirmed"]).select("id"),
              "No se pudo cancelar la cita",
            );
            cancelarRecordatorioCita(appt.id).catch(() => {});
          } catch (e) {
            Alert.alert("No se canceló la cita", mensajeError(e));
          }
          await recargar();
        },
      },
    ]);
  };

  // ── Metrics ──
  // Solo lo cobrado (D10), con las mismas funciones que el Panel y Reportes.
  const cobrado      = sales.reduce((sum, v) => sum + montoDe(v), 0);
  const pendingAppts = appts.filter(a => esCobrable(a) && !estaCobrada(a));
  const projected    = pendingAppts.reduce((sum, a) => sum + precioDeLista(a), 0);
  // Pago dividido: se expande el desglose para sumar por método real (no
  // "mixto"). Íconos y colores del POS, para que coincidan con la hoja de cobro.
  const byMethod = desglosePorMedio(sales).map(d => {
    const cfg = getMethodCfg(d.key);
    return { key: d.key, total: d.value, label: cfg?.label ?? d.label, color: cfg?.color ?? d.color, icon: cfg?.icon ?? ("ellipsis-horizontal-circle-outline" as const) };
  });

  const dateLabel = isToday ? "Hoy" : `${fmtDia(dia, "semana-dia")} ${fmtDia(dia, "dia-mes").split(" ")[1]}`;

  // Primero lo que falta cobrar, luego lo cobrado, luego canceladas.
  const sortedAppts = [...appts].sort((a, b) => {
    const order = (x: Appt) => (esCobrable(x) && !estaCobrada(x) ? 0 : estaCobrada(x) ? 1 : 2);
    return order(a) - order(b);
  });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      {/* Header */}
      <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.header}>
        <View style={s.headerBlob1} />
        <View style={s.headerBlob2} />

        <View style={s.headerTopRow}>
          <View style={s.headerIconBox}>
            <Ionicons name="card" size={16} color="white" />
          </View>
          <Text style={s.headerLabel}>Cobros</Text>
          <View style={{ flex: 1 }} />
          <TouchableOpacity style={s.headerActionBtn} onPress={() => router.push("/(admin)/pos-history" as any)} activeOpacity={0.8}
            accessibilityRole="button" accessibilityLabel="Historial de cobros" hitSlop={8}>
            <Ionicons name="time-outline" size={17} color="white" />
          </TouchableOpacity>
          <TouchableOpacity style={s.headerActionBtn} onPress={() => setCharge({ kind: "direct" })} activeOpacity={0.8}
            accessibilityRole="button" accessibilityLabel="Nueva venta directa" hitSlop={8}>
            <Ionicons name="add" size={20} color="white" />
          </TouchableOpacity>
        </View>

        <View style={s.headerHeroRow}>
          <View style={{ flexShrink: 1 }}>
            <Text style={s.headerTitle}>Gestión de pagos</Text>
            {sede ? <View style={{ marginTop: -4, marginBottom: 10 }}><SedeChip nombre={sede} sobreColor /></View> : null}
            <View style={s.dateNav}>
              <TouchableOpacity onPress={() => irA(sumarDias(dia, -1))} style={s.navBtn} accessibilityRole="button" accessibilityLabel="Día anterior" hitSlop={8}>
                <Ionicons name="chevron-back" size={14} color="white" />
              </TouchableOpacity>
              <Text style={s.dateLabel}>{dateLabel}</Text>
              <TouchableOpacity onPress={() => irA(sumarDias(dia, 1))} style={s.navBtn} disabled={isToday}
                accessibilityRole="button" accessibilityLabel="Día siguiente" accessibilityState={{ disabled: isToday }} hitSlop={8}>
                <Ionicons name="chevron-forward" size={14} color={isToday ? "rgba(255,255,255,.3)" : "white"} />
              </TouchableOpacity>
            </View>
          </View>
          {cobrado > 0 && (
            <View style={s.headerAmountBox}>
              <Text style={s.headerAmountLabel}>Cobrado</Text>
              <Text style={s.headerAmountValue}>{fmtMoneyFull(cobrado)}</Text>
            </View>
          )}
        </View>
      </LinearGradient>

      {error && !cargado ? (
        <ErrorState error={error} onRetry={recargar} />
      ) : !cargado ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={Colors.red} size="large" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 110 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.red} />}
        >
          {error ? (
            <TouchableOpacity onPress={recargar} style={s.errorBanner} activeOpacity={0.8} accessibilityRole="button">
              <Ionicons name="cloud-offline-outline" size={16} color={Colors.red} />
              <Text style={s.errorBannerText}>{mensajeError(error)} Toca para reintentar.</Text>
            </TouchableOpacity>
          ) : null}

          {/* ── Revenue hero ── */}
          <Animated.View entering={FadeInDown.duration(350)} style={{ padding: 20, paddingBottom: 0, gap: 12 }}>
            <View style={[s.heroCard, Shadow.md]}>
              <LinearGradient colors={Gradients.ink} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.heroGrad}>
                <View style={{ flex: 1 }}>
                  <Text style={s.heroLabel}>Total cobrado</Text>
                  <Text style={s.heroValue}>{cobrado > 0 ? fmtMoneyFull(cobrado) : "—"}</Text>
                  <Text style={s.heroSub}>{sales.length} cobro{sales.length !== 1 ? "s" : ""} registrado{sales.length !== 1 ? "s" : ""}</Text>
                </View>
                {projected > 0 && (
                  <View style={s.projectedBox}>
                    <Text style={s.projectedLabel}>Por cobrar</Text>
                    <Text style={s.projectedValue}>{fmtMoneyFull(projected)}</Text>
                    <Text style={s.projectedSub}>{pendingAppts.length} cita{pendingAppts.length !== 1 ? "s" : ""}</Text>
                  </View>
                )}
              </LinearGradient>
            </View>

            {byMethod.length > 0 && (
              <View style={[s.methodsCard, Shadow.sm]}>
                <Text style={s.methodsTitle}>Desglose de pagos</Text>
                <View style={s.methodsRow}>
                  {byMethod.map(m => (
                    <View key={m.key} style={[s.methodChip, { backgroundColor: m.color + "12" }]}>
                      <Ionicons name={m.icon} size={14} color={m.color} />
                      <View>
                        <Text style={[s.methodChipLabel, { color: m.color }]}>{m.label}</Text>
                        <Text style={[s.methodChipValue, { color: m.color }]}>{fmtMoneyFull(m.total)}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </Animated.View>

          {/* ── Tabs ── */}
          <View style={s.tabs}>
            {([
              { key: "citas",  label: `Citas · ${appts.length}` },
              { key: "cobros", label: `Cobros · ${sales.length}` },
            ] as const).map(tab => {
              const active = activeTab === tab.key;
              return (
                <TouchableOpacity
                  key={tab.key}
                  style={[s.tab, active && s.tabActive]}
                  onPress={() => setActiveTab(tab.key)}
                  activeOpacity={0.75}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                >
                  {active && <View style={[StyleSheet.absoluteFill, { backgroundColor: Colors.red }]} />}
                  <Text style={[s.tabLabel, active && { color: "white" }]}>{tab.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={{ paddingHorizontal: 16 }}>
            {/* ─── Citas ─── */}
            {activeTab === "citas" && (
              sortedAppts.length === 0 ? (
                <Animated.View entering={FadeInDown.duration(350)} style={[s.empty, Shadow.sm]}>
                  <Ionicons name="calendar-outline" size={40} color={t.subtle} style={{ marginBottom: 12 }} />
                  <Text style={s.emptyTitle}>Sin citas para este día</Text>
                  <Text style={s.emptySub}>Agenda citas desde la sección Agenda</Text>
                </Animated.View>
              ) : (
                <>
                  {pendingAppts.length > 0 && (
                    <View style={s.sectionHeader}>
                      <View style={[s.sectionDot, { backgroundColor: Colors.red }]} />
                      <Text style={s.sectionTitle}>Pendientes de cobro ({pendingAppts.length})</Text>
                    </View>
                  )}
                  {sortedAppts.map((a, i) => (
                    <ApptCard
                      key={a.id}
                      appt={a}
                      venta={ventaDeCita(a)}
                      onCobrar={() => setCharge({ kind: "appointment", appt: toLinkedAppt(a) })}
                      onCancel={() => cancelAppt(a)}
                      index={i}
                    />
                  ))}
                </>
              )
            )}

            {/* ─── Cobros ─── */}
            {activeTab === "cobros" && (
              sales.length === 0 ? (
                <Animated.View entering={FadeInDown.duration(350)} style={[s.empty, Shadow.sm]}>
                  <Ionicons name="receipt-outline" size={40} color={t.subtle} style={{ marginBottom: 12 }} />
                  <Text style={s.emptyTitle}>Sin cobros registrados</Text>
                  <Text style={s.emptySub}>Completa citas o toca + para una venta directa</Text>
                </Animated.View>
              ) : (
                sales.map((sale, i) => {
                  const methodCfg = getMethodCfg(sale.payment_method);
                  const color     = methodCfg?.color ?? Colors.success;
                  const timeStr   = fmt12(horaLocalDe(sale.created_at, timezone));
                  const linkedAppt = appts.find(a => a.id === sale.appointment_id);
                  const cliente   = linkedAppt ? (linkedAppt.clients?.name ?? "Sin cliente") : (sale.clients?.name ?? null);
                  const detalle   = sale.note ?? sale.pos_sale_items?.[0]?.name ?? null;

                  return (
                    <Animated.View key={sale.id} entering={i < 10 ? FadeInRight.delay(i * 55).duration(320) : undefined}>
                      <View style={[s.saleCard, Shadow.sm]}>
                        <View style={[s.saleAccent, { backgroundColor: color }]} />
                        <View style={{ flex: 1, padding: 14 }}>
                          <View style={s.saleTopRow}>
                            <View style={[s.saleTimePill, { backgroundColor: color + "15" }]}>
                              <Ionicons name={methodCfg?.icon ?? "cash-outline"} size={11} color={color} />
                              <Text style={[s.saleTime, { color }]}>{timeStr}</Text>
                            </View>
                            <Text style={[s.saleTotal, { color: Colors.success }]}>{fmtMoneyFull(sale.total)}</Text>
                          </View>
                          <Text style={s.saleClient} numberOfLines={1}>{cliente ?? "Venta directa"}</Text>
                          <Text style={s.saleService} numberOfLines={1}>{detalle ?? "—"}</Text>
                          <View style={s.saleBottomRow}>
                            <View style={[s.methodTag, { backgroundColor: color + "12" }]}>
                              <Text style={[s.methodTagText, { color }]}>{methodCfg?.label ?? sale.payment_method}</Text>
                            </View>
                            <TouchableOpacity
                              onPress={() => setAnular({ id: sale.id, total: Number(sale.total), created_at: sale.created_at, appointment_id: sale.appointment_id, cliente, detalle })}
                              style={s.voidBtn}
                              hitSlop={10}
                              accessibilityRole="button"
                              accessibilityLabel="Anular cobro"
                            >
                              <Ionicons name="trash-outline" size={14} color={Colors.red} />
                            </TouchableOpacity>
                          </View>
                        </View>
                      </View>
                    </Animated.View>
                  );
                })
              )
            )}
          </View>
        </ScrollView>
      )}

      {tenantId && (
        <ChargeSheet
          visible={!!charge}
          tenantId={tenantId}
          target={charge}
          onClose={() => setCharge(null)}
          onSaved={() => { recargar(); }}
        />
      )}

      <AnularCobroModal
        cobro={anular}
        onClose={() => setAnular(null)}
        onAnulado={aviso => {
          setAnular(null);
          if (aviso) Alert.alert("Cobro anulado", aviso);
          recargar();
        }}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function crearEstilos(t: ThemeColors) {
  return StyleSheet.create({
    header:          { paddingTop: 14, paddingHorizontal: 20, paddingBottom: 18, overflow: "hidden" },
    headerBlob1:     { position: "absolute", width: 200, height: 200, borderRadius: 100, backgroundColor: "rgba(255,255,255,.06)", top: -80, right: -40 },
    headerBlob2:     { position: "absolute", width: 100, height: 100, borderRadius: 50, backgroundColor: "rgba(0,0,0,.05)", bottom: -30, left: -20 },
    headerTopRow:    { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14, position: "relative", zIndex: 1 },
    headerIconBox:   { width: 32, height: 32, borderRadius: 10, backgroundColor: "rgba(255,255,255,.15)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.2)" },
    headerLabel:     { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: "rgba(255,255,255,.8)" },
    headerActionBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,.15)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.25)", marginLeft: 6 },
    headerHeroRow:   { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", position: "relative", zIndex: 1 },
    headerTitle:     { fontSize: 20, fontFamily: "SpaceGrotesk_700Bold", color: "white", letterSpacing: -0.4, marginBottom: 10 },
    dateNav:         { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(255,255,255,.14)", borderRadius: Radius.full, paddingVertical: 6, paddingHorizontal: 8, borderWidth: 1, borderColor: "rgba(255,255,255,0.2)" },
    navBtn:          { padding: 2 },
    dateLabel:       { fontSize: 12, fontFamily: "SpaceGrotesk_700Bold", color: "white", minWidth: 36, textAlign: "center" },
    headerAmountBox: { backgroundColor: "rgba(255,255,255,.15)", borderRadius: Radius.lg, paddingVertical: 10, paddingHorizontal: 14, alignItems: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.2)" },
    headerAmountLabel:{ fontSize: 10, fontFamily: "SpaceGrotesk_600SemiBold", color: "rgba(255,255,255,.65)", textTransform: "uppercase", letterSpacing: 0.5 },
    headerAmountValue:{ fontSize: 18, fontFamily: "SpaceGrotesk_700Bold", color: "white", marginTop: 2 },

    errorBanner:    { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 20, marginTop: 14, padding: 12, borderRadius: Radius.md, backgroundColor: "rgba(251,15,5,0.08)" },
    errorBannerText:{ flex: 1, fontSize: 12.5, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.red },

    heroCard:       { borderRadius: Radius.xl, overflow: "hidden" },
    heroGrad:       { flexDirection: "row", alignItems: "center", padding: 22, gap: 16 },
    heroLabel:      { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: "rgba(255,255,255,.6)", marginBottom: 4 },
    heroValue:      { fontSize: 34, fontFamily: "SpaceGrotesk_700Bold", color: "white", letterSpacing: -1 },
    heroSub:        { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", color: "rgba(255,255,255,.5)", marginTop: 4 },
    projectedBox:   { backgroundColor: "rgba(255,255,255,.1)", borderRadius: Radius.lg, padding: 14, alignItems: "center", minWidth: 110, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)" },
    projectedLabel: { fontSize: 10, fontFamily: "SpaceGrotesk_600SemiBold", color: "rgba(255,255,255,.6)", textTransform: "uppercase", letterSpacing: 0.5 },
    projectedValue: { fontSize: 18, fontFamily: "SpaceGrotesk_700Bold", color: "white", marginTop: 4 },
    projectedSub:   { fontSize: 10, fontFamily: "SpaceGrotesk_400Regular", color: "rgba(255,255,255,.5)", marginTop: 2 },

    methodsCard:    { backgroundColor: t.cardSolid, borderWidth: 1, borderColor: t.line, borderRadius: Radius.lg, padding: 16 },
    methodsTitle:   { fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", color: t.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 },
    methodsRow:     { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    methodChip:     { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: Radius.full, paddingHorizontal: 12, paddingVertical: 8 },
    methodChipLabel:{ fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold" },
    methodChipValue:{ fontSize: 13, fontFamily: "SpaceGrotesk_700Bold" },

    tabs:           { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 16 },
    tab:            { flex: 1, borderRadius: Radius.full, overflow: "hidden", backgroundColor: t.cardSolid, borderWidth: 1, borderColor: t.line, alignItems: "center" },
    tabActive:      { borderWidth: 0 },
    tabLabel:       { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: t.muted, paddingVertical: 11, textAlign: "center" },

    sectionHeader:  { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
    sectionDot:     { width: 8, height: 8, borderRadius: 4 },
    sectionTitle:   { fontSize: 12, fontFamily: "SpaceGrotesk_700Bold", color: t.muted, textTransform: "uppercase", letterSpacing: 0.5 },

    saleCard:       { backgroundColor: t.cardSolid, borderWidth: 1, borderColor: t.line, borderRadius: Radius.lg, flexDirection: "row", marginBottom: 10, overflow: "hidden" },
    saleAccent:     { width: 5 },
    saleTopRow:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
    saleTimePill:   { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 5 },
    saleTime:       { fontSize: 11, fontFamily: "SpaceGrotesk_700Bold" },
    saleTotal:      { fontSize: 16, fontFamily: "SpaceGrotesk_700Bold" },
    saleClient:     { fontSize: 14, fontFamily: "SpaceGrotesk_700Bold", color: t.text, marginBottom: 2 },
    saleService:    { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: t.muted },
    saleBottomRow:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10 },
    methodTag:      { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: Radius.full, paddingHorizontal: 9, paddingVertical: 4 },
    methodTagText:  { fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold" },
    voidBtn:        { width: 32, height: 32, borderRadius: 16, backgroundColor: Colors.red + "12", alignItems: "center", justifyContent: "center" },

    empty:          { backgroundColor: t.cardSolid, borderWidth: 1, borderColor: t.line, borderRadius: Radius.xl, padding: 44, alignItems: "center", marginTop: 4 },
    emptyTitle:     { fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", color: t.text, marginBottom: 6 },
    emptySub:       { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: t.muted, textAlign: "center" },
  });
}
