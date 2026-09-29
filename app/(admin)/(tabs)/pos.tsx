import { useMemo, useState } from "react";
import { useRouter } from "expo-router";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, ActivityIndicator, Alert,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { getActiveLocationId } from "@/lib/active-location";
import { Colors, Fonts, Gradients, Radius, Shadow } from "@/constants/theme";
import { STATUS_META } from "@/constants/status";
import { useTheme, type ThemeColors } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { fmtMoneyFull, fmt12 } from "@/lib/format";
import { sumarDias, inicioDelDiaUTC, finDelDiaUTC, fmtDia, hoyNegocio } from "@/lib/tz";
import { exigirFilas, mensajeError, traerTodo } from "@/lib/db";
import { useRecarga, useGuardRespuestas } from "@/lib/useRecarga";
import { cancelarRecordatorioCita } from "@/lib/notifications";
import { cobradoDe, desglosePorMedio, estaCobrada, montoDe, precioDeLista } from "@/lib/ingresos";
import { medioOGenerico } from "@/lib/medios-pago";
import { agruparPorCobrar, RUTA_POR_COBRAR, traerPorCobrar, type CitaPorCobrar } from "@/lib/porCobrar";
import ErrorState from "@/components/ErrorState";
import { IconButton, MonoTag } from "@/components/ui";
import SedeChip, { cargarListaSedes, nombreSede } from "@/components/SedeChip";
import ChargeSheet, { type ChargeTarget, type LinkedAppt } from "@/components/ChargeSheet";
import TarjetaCita, { esCobrable, porCobrar, type CitaCobro } from "@/components/cobros/TarjetaCita";
import FilaCobro from "@/components/cobros/FilaCobro";
import DetalleCobro, { type CobroDetalle } from "@/components/cobros/DetalleCobro";
import EstadoCaja, { CajaAbierta, type EstadoDeCaja } from "@/components/cobros/EstadoCaja";
import ResumenCobros from "@/components/cobros/ResumenCobros";

// ─── Types ────────────────────────────────────────────────────────────────────

type FacturaVenta = { id: string; number: string | null; status: string; credit_note_cufe: string | null };

type PosSale = CobroDetalle & {
  payments: { method: string; amount: number }[] | null;
  invoices: FacturaVenta[] | null;
};

/** Factura vigente de la venta (sin nota crédito y no rechazada), igual que el Historial. */
function facturaVigente(v: PosSale): FacturaVenta | null {
  return (v.invoices ?? []).find(f => !f.credit_note_cufe && f.status !== "rejected" && f.status !== "credited") ?? null;
}

function toLinkedAppt(a: CitaCobro): LinkedAppt {
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

/** Caja abierta de la sede activa: la misma regla con que recordSale deja cobrar. */
async function leerCaja(tenantId: string, loc: string | null): Promise<EstadoDeCaja> {
  let q = supabase.from("cash_sessions").select("opened_at").eq("tenant_id", tenantId).is("closed_at", null);
  if (loc) q = q.eq("location_id", loc);
  const { data, error } = await q.order("opened_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data ? { abierta: true, desde: (data as { opened_at: string }).opened_at } : { abierta: false };
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
/** Solo la primera letra: textTransform "capitalize" dejaría "Domingo 28 De Septiembre". */
const conMayuscula = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1);

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function PosScreen() {
  const router = useRouter();
  const { t, mode } = useTheme();
  const s = useMemo(() => crearEstilos(t), [t]);
  const { tenantId } = useAuth();
  const { timezone, ready } = useTenant();
  const guard = useGuardRespuestas();
  // Día elegido en la zona del NEGOCIO (DIN-11). null = hoy: así la pantalla
  // sigue a "hoy" cuando cambia el día con la app abierta.
  const [diaSel, setDiaSel]         = useState<string | null>(null);
  const [appts, setAppts]           = useState<CitaCobro[]>([]);
  const [sales, setSales]           = useState<PosSale[]>([]);
  // Nombre de la sede de las cifras (solo con varias sedes: ARQ-10).
  const [sede, setSede]             = useState<string | null>(null);
  // null = no se pudo revisar: no se muestra nada (recordSale vuelve a revisar al cobrar).
  const [caja, setCaja]             = useState<EstadoDeCaja | null>(null);
  // Citas sin cobro de cualquier fecha (la cifra del Panel), para avisar de las vencidas.
  const [sinCobro, setSinCobro]     = useState<CitaPorCobrar[] | null>(null);
  const [facturacion, setFacturacion] = useState(false);
  const [cargado, setCargado]       = useState(false);
  const [error, setError]           = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab]   = useState<"citas" | "cobros">("citas");
  // Hoja de cobro: una cita (precarga servicio + adicionales + cliente) o venta directa
  const [charge, setCharge]         = useState<ChargeTarget | null>(null);
  const [detalle, setDetalle]       = useState<PosSale | null>(null);

  const { hoy, recargar } = useRecarga(async () => {
    if (!tenantId) return;
    const turno = guard.nuevo();
    const dia = diaSel ?? hoyNegocio(timezone);
    try {
      // Misma sede que el POS web (historial y citas del día por location_id).
      const loc = await getActiveLocationId(tenantId);
      const [citasCrudas, ventasCrudas, sedes, estadoCaja, pendientes, conf] = await Promise.all([
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
            .select("id, created_at, total, subtotal, payment_method, payments, note, appointment_id, clients(name, phone), pos_sale_items(name, price, quantity), invoices(id, number, status, credit_note_cufe)")
            .eq("tenant_id", tenantId)
            .gte("created_at", inicioDelDiaUTC(dia, timezone))
            .lte("created_at", finDelDiaUTC(dia, timezone));
          if (loc) q = q.eq("location_id", loc);
          return q.order("created_at", { ascending: false }).order("id").range(d, h);
        }, { contexto: "No se pudieron cargar los cobros del día" }),
        cargarListaSedes(tenantId, loc),
        // Lo que sigue solo informa: si falla, la pantalla funciona igual sin ello.
        leerCaja(tenantId, loc).catch(() => null),
        traerPorCobrar(tenantId, loc).catch(() => null),
        supabase.from("invoice_settings").select("factus_client_id").eq("tenant_id", tenantId).maybeSingle(),
      ]);
      // Los embebidos (clients, services…) llegan tipados como arreglos: se
      // leen con la forma real de la respuesta (objeto por FK muchos-a-uno).
      if (!turno.vigente()) return;
      setAppts(citasCrudas as unknown as CitaCobro[]);
      setSales(ventasCrudas as unknown as PosSale[]);
      setSede(nombreSede(sedes, loc));
      setCaja(estadoCaja);
      setSinCobro(pendientes);
      setFacturacion(!conf.error && !!(conf.data as { factus_client_id?: string | null } | null)?.factus_client_id);
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

  /** No asistió / Cancelada: solo si sigue sin cobro (otro teléfono o el portal pudo cobrarla). */
  const cambiarEstado = async (a: CitaCobro, status: "no_show" | "cancelled") => {
    if (!tenantId) return;
    try {
      const venta = await supabase.from("pos_sales").select("id").eq("appointment_id", a.id).limit(1);
      if (venta.error) throw venta.error;
      if ((venta.data ?? []).length > 0) {
        Alert.alert("Esta cita ya se cobró", "Alguien la cobró mientras tanto, así que no se le cambia el estado.");
      } else {
        exigirFilas(
          await supabase.from("appointments").update({ status })
            .eq("id", a.id).eq("tenant_id", tenantId).in("status", ["pending", "confirmed", "completed"]).select("id"),
          "No se pudo cambiar el estado de la cita",
        );
        cancelarRecordatorioCita(a.id).catch(() => {});
      }
    } catch (e) {
      Alert.alert("No se cambió el estado", mensajeError(e));
    }
    await recargar();
  };

  const masOpciones = (a: CitaCobro) => {
    const cliente = a.clients?.name ?? "Sin cliente";
    Alert.alert(cliente, `${fmt12(a.appointment_time.slice(0, 5))} · ${a.services?.name ?? "Sin servicio"}`, [
      { text: "Abrir en la agenda", onPress: () => router.navigate({ pathname: "/(admin)/(tabs)/agenda", params: { fecha: dia, cita: a.id } }) },
      { text: `Marcar ${STATUS_META.no_show.label}`, onPress: () => cambiarEstado(a, "no_show") },
      { text: "Cancelar la cita", style: "destructive", onPress: () => cambiarEstado(a, "cancelled") },
      { text: "Cerrar", style: "cancel" },
    ]);
  };

  // ── Cifras ──
  // Solo lo cobrado (D10), con las mismas funciones que el Panel y Reportes.
  const cobrado    = sales.reduce((sum, v) => sum + montoDe(v), 0);
  const pendientes = appts.filter(porCobrar);
  const cobradas   = appts.filter(a => estaCobrada(a));
  const caidas     = appts.filter(a => !esCobrable(a) && !estaCobrada(a));
  const projected  = pendientes.reduce((sum, a) => sum + precioDeLista(a), 0);
  // Pago dividido: se expande el desglose para sumar por método real (no "mixto").
  const medios = desglosePorMedio(sales).map(d => {
    const m = medioOGenerico(d.key);
    return { key: d.key, label: m.label, color: m.color, total: d.value };
  });
  // Vencidas: citas de días anteriores sin cobro. Esta pantalla solo muestra un
  // día, así que sin este aviso quedaban escondidas (salen en el Panel).
  const vencidas = useMemo(() => (sinCobro ? agruparPorCobrar(sinCobro, hoy).vencidas : null), [sinCobro, hoy]);

  const titulo = isToday ? `Hoy, ${fmtDia(dia, "semana-dia-mes")}` : conMayuscula(fmtDia(dia, "largo"));
  const subtitulo = !cargado ? " "
    : appts.length === 0 && sales.length === 0 ? "Sin citas ni cobros"
    : `${pendientes.length} por cobrar · ${plural(sales.length, "cobro", "cobros")}`;

  const ventaDeLaCita = (a: CitaCobro) => sales.find(v => v.appointment_id === a.id) ?? null;
  const nombreDeCita = (v: PosSale) => {
    const cita = v.appointment_id ? appts.find(a => a.id === v.appointment_id) : null;
    return cita ? (cita.clients?.name ?? "Sin cliente") : null;
  };
  const rojo = mode === "dark" ? "#f87171" : "#dc2626";

  const seccion = (titulo: string, cantidad: number, total?: number) => (
    <View style={s.seccion}>
      <Text style={[s.seccionTitulo, { color: t.ink }]} accessibilityRole="header">{titulo}</Text>
      <Text style={[s.seccionCuenta, { color: t.subtle }]}>{cantidad}{total ? ` · ${fmtMoneyFull(total)}` : ""}</Text>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      {/* Encabezado: mismo estilo que Agenda y Clientes */}
      <View style={s.header}>
        <MonoTag>Cobros</MonoTag>
        <View style={s.tituloFila}>
          <Text style={[s.headerTitle, { color: t.ink }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{titulo}</Text>
          <IconButton icon="chevron-back" label="Día anterior" onPress={() => irA(sumarDias(dia, -1))} />
          <IconButton icon="chevron-forward" label="Día siguiente" onPress={() => irA(sumarDias(dia, 1))} disabled={isToday} />
        </View>
        <View style={s.subFila}>
          <Text style={[s.headerSub, { color: t.muted }]} numberOfLines={1}>{subtitulo}</Text>
          {isToday && caja?.abierta ? <CajaAbierta desde={caja.desde} timezone={timezone} onPress={() => router.push("/(admin)/caja")} /> : null}
          {!isToday ? (
            <TouchableOpacity onPress={() => setDiaSel(null)} hitSlop={8} accessibilityRole="button">
              <Text style={s.volverHoy}>Volver a hoy</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        {sede ? <View style={{ marginTop: 8 }}><SedeChip nombre={sede} /></View> : null}

        <View style={s.acciones}>
          <TouchableOpacity onPress={() => setCharge({ kind: "direct" })} activeOpacity={0.85} style={s.ventaWrap}
            accessibilityRole="button" accessibilityLabel="Nueva venta directa">
            <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.venta}>
              <Ionicons name="add" size={18} color="white" />
              <Text style={s.ventaTxt}>Venta directa</Text>
            </LinearGradient>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push("/(admin)/pos-history")} activeOpacity={0.8}
            style={[s.historial, { borderColor: t.lineStrong, backgroundColor: t.cardSolid }]} accessibilityRole="button">
            <Ionicons name="time-outline" size={16} color={t.ink} />
            <Text style={[s.historialTxt, { color: t.ink }]}>Historial</Text>
          </TouchableOpacity>
        </View>
      </View>

      {error && !cargado ? (
        <ErrorState error={error} onRetry={recargar} />
      ) : !cargado ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={Colors.red} size="large" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 110, gap: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.red} />}
        >
          {error ? (
            <TouchableOpacity onPress={recargar} style={s.errorBanner} activeOpacity={0.8} accessibilityRole="button">
              <Ionicons name="cloud-offline-outline" size={16} color={Colors.red} />
              <Text style={s.errorBannerText}>{mensajeError(error)} Toca para reintentar.</Text>
            </TouchableOpacity>
          ) : null}

          {/* Caja cerrada: sin ella no se puede cobrar, así que se avisa en grande. */}
          {caja && !caja.abierta && isToday ? <EstadoCaja caja={caja} timezone={timezone} onPress={() => router.push("/(admin)/caja")} /> : null}

          {isToday && vencidas && vencidas.citas.length > 0 ? (
            <TouchableOpacity
              onPress={() => router.push(RUTA_POR_COBRAR)}
              activeOpacity={0.8}
              style={[s.vencidas, { borderColor: rojo + "44", backgroundColor: rojo + "10" }]}
              accessibilityRole="button"
            >
              <Ionicons name="alert-circle" size={18} color={rojo} />
              <View style={{ flex: 1 }}>
                <Text style={[s.vencidasTitulo, { color: t.ink }]}>
                  {vencidas.citas.length === 1 ? "1 cita de días anteriores sin cobrar" : `${vencidas.citas.length} citas de días anteriores sin cobrar`}
                </Text>
                <Text style={[s.vencidasSub, { color: t.muted }]}>{fmtMoneyFull(vencidas.total)} · cóbralas o márcalas como No asistió</Text>
              </View>
              <Text style={[s.vencidasVer, { color: rojo }]}>Ver</Text>
            </TouchableOpacity>
          ) : null}

          <Animated.View entering={FadeInDown.duration(320)}>
            <ResumenCobros
              cobrado={cobrado}
              cobros={sales.length}
              porCobrar={projected}
              citasPorCobrar={pendientes.length}
              esHoy={isToday}
              medios={medios}
            />
          </Animated.View>

          {/* ── Pestañas ── */}
          <View style={[s.tabs, { backgroundColor: t.chipBg }]} accessibilityRole="tablist">
            {([
              { key: "citas",  label: "Citas del día", cuenta: appts.length, alerta: pendientes.length },
              { key: "cobros", label: "Cobros",        cuenta: sales.length, alerta: 0 },
            ] as const).map(tab => {
              const active = activeTab === tab.key;
              return (
                <TouchableOpacity
                  key={tab.key}
                  style={[s.tab, active && [s.tabActive, { backgroundColor: t.cardSolid }]]}
                  onPress={() => setActiveTab(tab.key)}
                  activeOpacity={0.75}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${tab.label}, ${tab.cuenta}${tab.alerta ? `, ${tab.alerta} por cobrar` : ""}`}
                >
                  <Text style={[s.tabLabel, { color: active ? t.ink : t.muted }]}>{tab.label}</Text>
                  <View style={[s.tabCuenta, { backgroundColor: tab.alerta ? Colors.red : t.trackBg }]}>
                    <Text style={[s.tabCuentaTxt, { color: tab.alerta ? "white" : t.muted }]}>{tab.alerta || tab.cuenta}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* ─── Citas ─── */}
          {activeTab === "citas" && (
            appts.length === 0 ? (
              <Animated.View entering={FadeInDown.duration(350)} style={[s.empty, Shadow.sm]}>
                <Ionicons name="calendar-outline" size={40} color={t.subtle} style={{ marginBottom: 12 }} />
                <Text style={s.emptyTitle}>Sin citas para este día</Text>
                <Text style={s.emptySub}>Agenda citas desde la pestaña Agenda, o usa Venta directa para cobrar sin cita.</Text>
              </Animated.View>
            ) : (
              <View>
                {pendientes.length > 0 && seccion("Por cobrar", pendientes.length, projected)}
                {pendientes.map((a, i) => (
                  <TarjetaCita key={a.id} cita={a} index={i}
                    onCobrar={() => setCharge({ kind: "appointment", appt: toLinkedAppt(a) })}
                    onMas={() => masOpciones(a)} />
                ))}
                {pendientes.length === 0 && (
                  <View style={[s.todoCobrado, { backgroundColor: Colors.success + "12" }]}>
                    <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
                    <Text style={[s.todoCobradoTxt, { color: t.text }]}>No queda nada por cobrar de este día.</Text>
                  </View>
                )}
                {cobradas.length > 0 && seccion("Cobradas", cobradas.length, cobradas.reduce((sum, a) => sum + cobradoDe(a), 0))}
                {cobradas.map((a, i) => {
                  const venta = ventaDeLaCita(a);
                  return (
                    <TarjetaCita key={a.id} cita={a} index={i}
                      onVerCobro={venta ? () => setDetalle(venta) : undefined} />
                  );
                })}
                {caidas.length > 0 && seccion("Canceladas y no asistió", caidas.length)}
                {caidas.map((a, i) => (
                  <TarjetaCita key={a.id} cita={a} index={i} />
                ))}
              </View>
            )
          )}

          {/* ─── Cobros ─── */}
          {activeTab === "cobros" && (
            sales.length === 0 ? (
              <Animated.View entering={FadeInDown.duration(350)} style={[s.empty, Shadow.sm]}>
                <Ionicons name="receipt-outline" size={40} color={t.subtle} style={{ marginBottom: 12 }} />
                <Text style={s.emptyTitle}>Sin cobros registrados</Text>
                <Text style={s.emptySub}>Cobra una cita de la lista o registra una venta directa.</Text>
              </Animated.View>
            ) : (
              <View>
                {sales.map(v => {
                  const factura = facturaVigente(v);
                  return (
                    <FilaCobro
                      key={v.id}
                      cobro={v}
                      cliente={nombreDeCita(v)}
                      timezone={timezone}
                      etiquetas={factura ? [{ icon: "document-text-outline", texto: `Factura #${factura.number || "—"}` }] : undefined}
                      onPress={() => setDetalle(v)}
                    />
                  );
                })}
              </View>
            )
          )}
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

      <DetalleCobro
        cobro={detalle}
        cliente={detalle ? nombreDeCita(detalle) : null}
        factura={detalle ? facturaVigente(detalle) : null}
        onFacturar={detalle && facturacion && !facturaVigente(detalle)
          ? () => {
              const id = detalle.id;
              setDetalle(null);
              router.push({ pathname: "/(admin)/invoices", params: { venta: id } } as never);
            }
          : undefined}
        onClose={() => setDetalle(null)}
        onAnulado={aviso => {
          setDetalle(null);
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
    header:         { paddingTop: 14, paddingHorizontal: 20, paddingBottom: 14 },
    tituloFila:     { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 },
    headerTitle:    { flex: 1, fontSize: 21, fontFamily: Fonts.bold, letterSpacing: -0.5 },
    subFila:        { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 1 },
    headerSub:      { flexShrink: 1, fontSize: 12.5, fontFamily: Fonts.regular },
    volverHoy:      { fontSize: 12.5, fontFamily: Fonts.bold, color: Colors.red },
    acciones:       { flexDirection: "row", gap: 10, marginTop: 14 },
    ventaWrap:      { flex: 1, borderRadius: Radius.full, overflow: "hidden" },
    venta:          { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12 },
    ventaTxt:       { fontSize: 14, fontFamily: Fonts.bold, color: "white" },
    historial:      { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 18, borderRadius: Radius.full, borderWidth: 1 },
    historialTxt:   { fontSize: 14, fontFamily: Fonts.bold },

    errorBanner:    { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: Radius.md, backgroundColor: "rgba(251,15,5,0.08)" },
    errorBannerText:{ flex: 1, fontSize: 12.5, fontFamily: Fonts.semibold, color: Colors.red },

    vencidas:       { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: Radius.lg, padding: 12 },
    vencidasTitulo: { fontSize: 13.5, fontFamily: Fonts.bold },
    vencidasSub:    { fontSize: 12, fontFamily: Fonts.regular, marginTop: 2 },
    vencidasVer:    { fontSize: 13, fontFamily: Fonts.bold },

    tabs:           { flexDirection: "row", borderRadius: Radius.full, padding: 4, marginTop: 4 },
    tab:            { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderRadius: Radius.full, paddingVertical: 9 },
    tabActive:      { ...Shadow.sm },
    tabLabel:       { fontSize: 13, fontFamily: Fonts.bold },
    tabCuenta:      { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: "center", justifyContent: "center" },
    tabCuentaTxt:   { fontSize: 11, fontFamily: Fonts.bold },

    seccion:        { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginTop: 6, marginBottom: 10 },
    seccionTitulo:  { fontSize: 14, fontFamily: Fonts.bold },
    seccionCuenta:  { fontSize: 12, fontFamily: Fonts.semibold },

    todoCobrado:    { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: Radius.md, marginBottom: 4 },
    todoCobradoTxt: { flex: 1, fontSize: 13, fontFamily: Fonts.semibold },

    empty:          { backgroundColor: t.cardSolid, borderWidth: 1, borderColor: t.line, borderRadius: Radius.xl, padding: 36, alignItems: "center" },
    emptyTitle:     { fontSize: 16, fontFamily: Fonts.bold, color: t.text, marginBottom: 6 },
    emptySub:       { fontSize: 13, fontFamily: Fonts.regular, color: t.muted, textAlign: "center", lineHeight: 18 },
  });
}
