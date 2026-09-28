import { useMemo, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, RefreshControl,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { useTenant } from "@/lib/tenant";
import {
  diaLocalDe, horaLocalDe, fmtDia, rangoDePeriodo, moverReferencia,
  rangoIncluyeHoy, etiquetaRango, hoyNegocio,
} from "@/lib/tz";
import { Colors, Gradients, Radius, Shadow } from "@/constants/theme";
import ErrorState from "@/components/ErrorState";
import { useTheme, type ThemeColors } from "@/lib/theme";
import { ScreenHeader, SegmentedControl } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { fmtMoneyFull, fmt12 } from "@/lib/format";
import { mensajeError, traerTodoDetalle } from "@/lib/db";
import { useRecarga, useGuardRespuestas } from "@/lib/useRecarga";
import { getActiveLocationId } from "@/lib/active-location";
import { desglosePorMedio, lineasDePago, montoDe } from "@/lib/ingresos";
import { methodCfg as getMethodCfg } from "@/components/ChargeSheet";
import AnularCobroModal, { type CobroAAnular } from "@/components/AnularCobroModal";
import {
  cargarListaSedes, nombreCorto, nombreSede, sedeDeFila, TODAS_LAS_SEDES, type SedeLite,
} from "@/components/SedeChip";

type FacturaVenta = { id: string; number: string | null; status: string; credit_note_cufe: string | null };

/** "sede": solo la sede activa (como el Panel, el POS y Reportes). "todas": el negocio entero (como el historial del POS web). */
type Alcance = "sede" | "todas";

type HistorySale = {
  id: string;
  created_at: string;
  total: number;
  payment_method: string;
  payments: { method: string; amount: number }[] | null;
  note: string | null;
  appointment_id: string | null;
  location_id: string | null;
  clients: { name: string } | null;
  pos_sale_items: { name: string; price: number; quantity: number }[];
  invoices: FacturaVenta[] | null;
};

/** Factura vigente de la venta (sin nota crédito y no rechazada). */
function facturaVigente(v: HistorySale): FacturaVenta | null {
  return (v.invoices ?? []).find(f => !f.credit_note_cufe && f.status !== "rejected" && f.status !== "credited") ?? null;
}

export default function PosHistoryScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const s = useMemo(() => crearEstilos(t), [t]);
  const { tenantId } = useAuth();
  const { timezone, ready } = useTenant();
  const guard = useGuardRespuestas();
  // Mes elegido como día 1 'YYYY-MM-01' en la zona del negocio; null = el mes
  // en curso (DIN-10: antes medianoche local → toISOString corría el mes un
  // día hacia atrás en zonas positivas).
  const [ref, setRef]           = useState<string | null>(null);
  const [sales, setSales]       = useState<HistorySale[]>([]);
  const [truncado, setTruncado] = useState(false);
  const [cargado, setCargado]   = useState(false);
  const [error, setError]       = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [facturacion, setFacturacion] = useState(false);
  const [anular, setAnular]     = useState<CobroAAnular | null>(null);
  // Sede activa y sedes del negocio de la última carga (para filtrar y rotular).
  const [sedes, setSedes]       = useState<{ activa: string | null; lista: SedeLite[] }>({ activa: null, lista: [] });
  // Por defecto la sede activa, para que el total cuadre con el Panel y el
  // POS (DIN-12). "Todas" sirve para encontrar un cobro de otra sede o uno
  // guardado sin sede, y anularlo o facturarlo.
  const [alcance, setAlcance]   = useState<Alcance>("sede");

  const { hoy, recargar } = useRecarga(async () => {
    if (!tenantId) return;
    const turno = guard.nuevo();
    const r = rangoDePeriodo("mes", timezone, ref ?? hoyNegocio(timezone));
    try {
      const loc = await getActiveLocationId(tenantId);
      const [res, conf, lista] = await Promise.all([
        // Paginado: con más de 1000 cobros al mes el total y el desglose
        // quedaban incompletos (CAL-14). Se traen todas las sedes y el alcance
        // se aplica en memoria: cambiarlo no vuelve a consultar.
        traerTodoDetalle((d, h) =>
          supabase
            .from("pos_sales")
            .select("id,created_at,total,payment_method,payments,note,appointment_id,location_id,clients(name),pos_sale_items(name,price,quantity),invoices(id,number,status,credit_note_cufe)")
            .eq("tenant_id", tenantId)
            .gte("created_at", r.desdeUTC)
            .lte("created_at", r.hastaUTC)
            .order("created_at", { ascending: false })
            .order("id")
            .range(d, h),
        { contexto: "No se pudieron cargar los cobros del mes" }),
        // Solo decide si se muestra "Facturar": si falla, se oculta el botón
        // y el resto de la pantalla sigue funcionando.
        supabase.from("invoice_settings").select("factus_client_id").eq("tenant_id", tenantId).maybeSingle(),
        cargarListaSedes(tenantId, loc),
      ]);
      if (!turno.vigente()) return;
      setSales(res.filas as unknown as HistorySale[]);
      setSedes({ activa: loc, lista });
      setTruncado(res.truncado);
      setFacturacion(!conf.error && !!(conf.data as { factus_client_id?: string | null } | null)?.factus_client_id);
      setError(null);
      setCargado(true);
    } catch (e) {
      if (turno.vigente()) setError(e);
    }
  }, [tenantId, timezone, ref], { timeZone: timezone, habilitado: !!tenantId && ready });

  const rango = rangoDePeriodo("mes", timezone, ref ?? hoy);
  const isCurrentMonth = rangoIncluyeHoy(rango);
  const irAMes = (pasos: number) => {
    const nuevo = moverReferencia("mes", rango.desde, pasos);
    setRef(nuevo > hoy || rangoIncluyeHoy(rangoDePeriodo("mes", timezone, nuevo)) ? null : nuevo);
  };

  const onRefresh = async () => { setRefreshing(true); await recargar(); setRefreshing(false); };

  // Alcance por sede. Solo se filtra si el negocio tiene más de una: con una
  // sola, la sede ES el negocio y no se esconden los cobros viejos guardados
  // sin sede. Con varias, "esta sede" es la misma regla del Panel y el POS.
  const sede = nombreSede(sedes.lista, sedes.activa);
  const filtrar = !!sede && alcance === "sede";
  const visibles = useMemo(
    () => (filtrar ? sales.filter(v => v.location_id === sedes.activa) : sales),
    [sales, filtrar, sedes.activa],
  );

  // Solo lo cobrado (D10), con las mismas funciones que el Panel y Reportes.
  const totalRevenue = visibles.reduce((sum, v) => sum + montoDe(v), 0);
  // Pago dividido ("mixto"): desglosePorMedio lo expande por método real. Los
  // métodos que el POS no conoce salen con su nombre en vez de desaparecer.
  const byMethod = useMemo(() => desglosePorMedio(visibles).map(d => {
    const cfg = getMethodCfg(d.key);
    return {
      key: d.key,
      label: cfg?.label ?? d.label,
      icon: cfg?.icon ?? ("ellipsis-horizontal-circle-outline" as const),
      color: cfg?.color ?? d.color,
      total: d.value,
      count: visibles.filter(v => lineasDePago(v).some(l => l.method === d.key)).length,
    };
  }), [visibles]);

  // Agrupado por el día del NEGOCIO (no del teléfono ni de UTC).
  const grouped = useMemo(() => {
    const map: Record<string, HistorySale[]> = {};
    visibles.forEach(v => {
      const d = diaLocalDe(v.created_at, timezone);
      if (!map[d]) map[d] = [];
      map[d].push(v);
    });
    return Object.keys(map).sort((a, b) => b.localeCompare(a)).map(d => ({ date: d, sales: map[d] }));
  }, [visibles, timezone]);

  const facturar = (sale: HistorySale) => {
    const f = facturaVigente(sale);
    if (f) {
      Alert.alert("Ya está facturado", `Este cobro ya tiene la factura electrónica #${f.number || "—"}. Consúltala en Factura electrónica → Historial.`);
      return;
    }
    router.push({ pathname: "/(admin)/invoices", params: { venta: sale.id } } as never);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader crumb="Ventas" title="Historial de Cobros" onBack={() => router.back()}
        subtitle={sede ? (filtrar ? sede : TODAS_LAS_SEDES) : undefined} />
      <View style={[s.monthNav, { backgroundColor: t.chipBg, borderColor: t.line }]}>
        <TouchableOpacity onPress={() => irAMes(-1)} style={s.navBtn} accessibilityRole="button" accessibilityLabel="Mes anterior" hitSlop={8}>
          <Ionicons name="chevron-back" size={18} color={t.muted} />
        </TouchableOpacity>
        <Text style={[s.monthLabel, { color: t.ink }]}>{etiquetaRango(rango)}</Text>
        <TouchableOpacity onPress={() => irAMes(1)} style={s.navBtn} disabled={isCurrentMonth}
          accessibilityRole="button" accessibilityLabel="Mes siguiente" accessibilityState={{ disabled: isCurrentMonth }} hitSlop={8}>
          <Ionicons name="chevron-forward" size={18} color={isCurrentMonth ? t.subtle : t.muted} />
        </TouchableOpacity>
      </View>
      {sede ? (
        <View style={{ alignSelf: "center", marginTop: 6, marginBottom: 2 }}>
          <SegmentedControl<Alcance>
            options={[
              { value: "sede", label: nombreCorto(sede) },
              { value: "todas", label: TODAS_LAS_SEDES },
            ]}
            value={alcance}
            onChange={setAlcance}
          />
        </View>
      ) : null}

      {error && !cargado ? (
        <ErrorState error={error} onRetry={recargar} />
      ) : !cargado ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={Colors.red} size="large" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.red} />}
        >
          {error ? (
            <TouchableOpacity onPress={recargar} style={s.errorBanner} activeOpacity={0.8} accessibilityRole="button">
              <Ionicons name="cloud-offline-outline" size={16} color={Colors.red} />
              <Text style={s.errorBannerText}>{mensajeError(error)} Toca para reintentar.</Text>
            </TouchableOpacity>
          ) : null}

          <Animated.View entering={FadeInDown.duration(350)}>
            <View style={[s.summaryCard, Shadow.md]}>
              <LinearGradient colors={Gradients.ink} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.summaryGrad}>
                <View>
                  <Text style={s.summaryLabel}>Total del mes</Text>
                  <Text style={s.summaryValue}>{totalRevenue > 0 ? fmtMoneyFull(totalRevenue) : "—"}</Text>
                  <Text style={s.summarySub}>{visibles.length} cobro{visibles.length !== 1 ? "s" : ""} registrado{visibles.length !== 1 ? "s" : ""}</Text>
                  {truncado && <Text style={s.summarySub}>Mostrando los {sales.length} más recientes del negocio: el total puede ser mayor.</Text>}
                </View>
              </LinearGradient>
            </View>

            {byMethod.length > 0 && (
              <View style={[s.methodsCard, Shadow.sm]}>
                <Text style={s.methodsTitle}>Desglose por método</Text>
                {byMethod.map((m, i) => (
                  <View key={m.key} style={[s.methodRow, i < byMethod.length - 1 && { borderBottomWidth: 1, borderBottomColor: t.line }]}>
                    <View style={[s.methodIcon, { backgroundColor: m.color + "14" }]}>
                      <Ionicons name={m.icon} size={16} color={m.color} />
                    </View>
                    <Text style={s.methodName}>{m.label}</Text>
                    <Text style={s.methodCount}>{m.count} cobro{m.count !== 1 ? "s" : ""}</Text>
                    <Text style={[s.methodTotal, { color: m.color }]}>{fmtMoneyFull(m.total)}</Text>
                  </View>
                ))}
              </View>
            )}
          </Animated.View>

          {grouped.length === 0 ? (
            <Animated.View entering={FadeInDown.delay(100).duration(350)} style={[s.empty, Shadow.sm]}>
              <Ionicons name="receipt-outline" size={40} color={t.subtle} style={{ marginBottom: 12 }} />
              <Text style={s.emptyTitle}>Sin cobros este mes</Text>
              <Text style={s.emptySub}>
                {filtrar && sales.length > 0
                  ? `No hay cobros en ${sede}. Toca "${TODAS_LAS_SEDES}" para ver los de las demás.`
                  : "Los cobros registrados aparecerán aquí"}
              </Text>
            </Animated.View>
          ) : (
            grouped.map((group, gi) => {
              const dayTotal = group.sales.reduce((sum, v) => sum + montoDe(v), 0);
              return (
                <Animated.View key={group.date} entering={gi < 8 ? FadeInDown.delay(gi * 60 + 120).duration(350) : undefined}>
                  <View style={s.dayHeader}>
                    <Text style={s.dayLabel}>{fmtDia(group.date, "largo")}</Text>
                    <Text style={s.dayTotal}>{fmtMoneyFull(dayTotal)}</Text>
                  </View>

                  {group.sales.map(sale => {
                    const methodCfg = getMethodCfg(sale.payment_method);
                    const color = methodCfg?.color ?? Colors.success;
                    const factura = facturaVigente(sale);
                    const cliente = sale.clients?.name ?? null;
                    const detalle = sale.note ?? sale.pos_sale_items?.[0]?.name ?? null;
                    return (
                      <View key={sale.id} style={[s.saleCard, Shadow.sm]}>
                        <View style={[s.saleAccent, { backgroundColor: color }]} />
                        <View style={{ flex: 1, padding: 12 }}>
                          <View style={s.saleTopRow}>
                            <Text style={s.saleTime}>{fmt12(horaLocalDe(sale.created_at, timezone))}</Text>
                            <Text style={[s.saleAmount, { color: Colors.success }]}>{fmtMoneyFull(Number(sale.total))}</Text>
                          </View>
                          <Text style={s.saleClient} numberOfLines={1}>{cliente ?? "Venta directa"}</Text>
                          <Text style={s.saleDesc} numberOfLines={1}>{detalle ?? "—"}</Text>
                          <View style={s.saleBottomRow}>
                            <View style={{ flexDirection: "row", gap: 6, flexShrink: 1, flexWrap: "wrap" }}>
                              <View style={[s.methodTag, { backgroundColor: color + "12" }]}>
                                <Ionicons name={methodCfg?.icon ?? "cash-outline"} size={11} color={color} />
                                <Text style={[s.methodTagText, { color }]}>{methodCfg?.label ?? sale.payment_method}</Text>
                              </View>
                              {/* En "todas las sedes", de cuál es cada cobro. */}
                              {sede && !filtrar && (
                                <View style={[s.methodTag, { backgroundColor: t.chipBg }]}>
                                  <Ionicons name="location-outline" size={11} color={t.muted} />
                                  <Text style={[s.methodTagText, { color: t.muted }]} numberOfLines={1}>{sedeDeFila(sedes.lista, sale.location_id)}</Text>
                                </View>
                              )}
                              {factura && (
                                <View style={[s.methodTag, { backgroundColor: t.chipBg }]}>
                                  <Ionicons name="document-text-outline" size={11} color={t.muted} />
                                  <Text style={[s.methodTagText, { color: t.muted }]}>Factura #{factura.number || "—"}</Text>
                                </View>
                              )}
                            </View>
                            <View style={{ flexDirection: "row", gap: 8 }}>
                              {facturacion && !factura && (
                                <TouchableOpacity onPress={() => facturar(sale)} style={s.iconBtn} hitSlop={8}
                                  accessibilityRole="button" accessibilityLabel="Emitir factura electrónica de este cobro">
                                  <Ionicons name="document-text-outline" size={14} color={t.muted} />
                                </TouchableOpacity>
                              )}
                              <TouchableOpacity
                                onPress={() => setAnular({ id: sale.id, total: Number(sale.total), created_at: sale.created_at, appointment_id: sale.appointment_id, cliente, detalle })}
                                style={s.iconBtn}
                                hitSlop={8}
                                accessibilityRole="button"
                                accessibilityLabel="Anular cobro"
                              >
                                <Ionicons name="trash-outline" size={14} color={t.muted} />
                              </TouchableOpacity>
                            </View>
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </Animated.View>
              );
            })
          )}
        </ScrollView>
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

function crearEstilos(t: ThemeColors) {
  return StyleSheet.create({
    monthNav:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16, alignSelf: "center", borderRadius: 999, borderWidth: 1, paddingVertical: 6, paddingHorizontal: 14, marginTop: 4, marginBottom: 4 },
    navBtn:       { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
    monthLabel:   { fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", minWidth: 160, textAlign: "center", textTransform: "capitalize" },

    errorBanner:    { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12, padding: 12, borderRadius: Radius.md, backgroundColor: "rgba(251,15,5,0.08)" },
    errorBannerText:{ flex: 1, fontSize: 12.5, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.red },

    summaryCard:  { borderRadius: Radius.xl, overflow: "hidden", marginBottom: 12 },
    summaryGrad:  { padding: 22 },
    summaryLabel: { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: "rgba(255,255,255,.6)", marginBottom: 4 },
    summaryValue: { fontSize: 36, fontFamily: "SpaceGrotesk_700Bold", color: "white", letterSpacing: -1 },
    summarySub:   { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", color: "rgba(255,255,255,.5)", marginTop: 4 },

    methodsCard:  { backgroundColor: t.cardSolid, borderWidth: 1, borderColor: t.line, borderRadius: Radius.lg, padding: 16, marginBottom: 16 },
    methodsTitle: { fontSize: 11, fontFamily: "JetBrainsMono_500Medium", color: t.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 },
    methodRow:    { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
    methodIcon:   { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
    methodName:   { flex: 1, fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: t.text },
    methodCount:  { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: t.muted },
    methodTotal:  { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", minWidth: 80, textAlign: "right" },

    dayHeader:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10, paddingHorizontal: 2 },
    dayLabel:     { fontSize: 13, fontFamily: "SpaceGrotesk_700Bold", color: t.text, textTransform: "capitalize" },
    dayTotal:     { fontSize: 13, fontFamily: "SpaceGrotesk_700Bold", color: Colors.success },

    saleCard:     { backgroundColor: t.cardSolid, borderWidth: 1, borderColor: t.line, borderRadius: Radius.md, flexDirection: "row", marginBottom: 8, overflow: "hidden" },
    saleAccent:   { width: 4 },
    saleTopRow:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
    saleTime:     { fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold", color: t.muted },
    saleAmount:   { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold" },
    saleClient:   { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: t.text, marginBottom: 2 },
    saleDesc:     { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: t.muted },
    saleBottomRow:{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8, gap: 8 },
    methodTag:    { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: Radius.full, paddingHorizontal: 9, paddingVertical: 4 },
    methodTagText:{ fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold" },
    iconBtn:      { width: 32, height: 32, borderRadius: 16, backgroundColor: t.chipBg, alignItems: "center", justifyContent: "center" },

    empty:        { backgroundColor: t.cardSolid, borderWidth: 1, borderColor: t.line, borderRadius: Radius.xl, padding: 44, alignItems: "center", marginTop: 8 },
    emptyTitle:   { fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", color: t.text, marginBottom: 6 },
    emptySub:     { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: t.muted, textAlign: "center" },
  });
}
