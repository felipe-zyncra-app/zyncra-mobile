import { useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform, ActivityIndicator,
  Modal, Alert, RefreshControl,
} from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { Colors, Radius, Shadow } from "@/constants/theme";
import ErrorState from "@/components/ErrorState";
import { useTheme, type ThemeColors } from "@/lib/theme";
import { ScreenHeader } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { fmtMoneyFull, fmt12 } from "@/lib/format";
import { diaLocalDe, horaLocalDe, fmtDia, esHoy } from "@/lib/tz";
import { getActiveLocationId } from "@/lib/active-location";
import { exigirFilas, mensajeError, revisar, traerTodo, traerPorIds } from "@/lib/db";
import { useRecarga, useGuardRespuestas } from "@/lib/useRecarga";
import { leerMonto, totalesCaja, esIngresoHuerfano } from "@/lib/dinero";
import { cargarListaSedes, nombreSede, type SedeLite } from "@/components/SedeChip";
import { filtroSedeOGeneral, incluyeCajaGeneral, preferirCajaDeSede } from "@/lib/sedes";
import { CATEGORIA_PROPINA, profesionalDeMovimiento, type Profesional } from "@/lib/propinas";

type Tab      = "caja" | "historial";
type MoveType = "ingreso" | "egreso";

type Session  = { id: string; location_id: string | null; opening_amount: number; opening_note: string | null; opened_at: string; closed_at: string | null; closing_amount: number | null; closing_note: string | null };
type Movement = {
  id: string; session_id: string; type: MoveType; amount: number; description: string;
  category: string | null; payment_method: string | null; created_at: string;
  pos_sale_id: string | null; layaway_payment_id: string | null;
  /** A quién va una propina registrada a mano (null = para el negocio). */
  professional_id: string | null;
};
type HistRow = {
  session: Session;
  ingresos: number; egresos: number; electronicos: number;
  efectivoEsperado: number;
  /** closing_amount − efectivo esperado (null si no se contó). */
  diferencia: number | null;
};

const INGRESO_CATS = ["Servicio", "Producto", "Propina", "Otro"];
const EGRESO_CATS  = ["Arriendo", "Nómina", "Insumos", "Servicios públicos", "Otro"];

const COLS_SESION = "id, location_id, opening_amount, opening_note, opened_at, closed_at, closing_amount, closing_note";
const COLS_MOV    = "id, session_id, type, amount, description, category, payment_method, created_at, pos_sale_id, layaway_payment_id, professional_id";

/**
 * Sede de la caja y si la caja general (sin sede) cuenta como suya: solo en un
 * negocio de una sola sede, donde las cajas viejas se abrieron sin sede y no
 * había otra forma de verlas ni de cerrarlas (web TabCaja, 29-sep).
 */
async function alcanceCaja(tenantId: string): Promise<{ loc: string | null; sedes: SedeLite[]; incluirGeneral: boolean }> {
  const loc = await getActiveLocationId(tenantId);
  const sedes = await cargarListaSedes(tenantId, loc);
  return { loc, sedes, incluirGeneral: incluyeCajaGeneral(loc, sedes.length) };
}

/** Caja abierta de la sede activa (misma regla que /admin/caja y el POS web). */
async function cajaAbierta(tenantId: string, loc: string | null, incluirGeneral: boolean): Promise<Session | null> {
  let q = supabase.from("cash_sessions").select(COLS_SESION).eq("tenant_id", tenantId).is("closed_at", null);
  if (loc && incluirGeneral) q = q.or(filtroSedeOGeneral(loc));
  else if (loc) q = q.eq("location_id", loc);
  const data = (revisar(await q.order("opened_at", { ascending: false }).limit(incluirGeneral ? 2 : 1), "No se pudo revisar la caja") ?? []) as Session[];
  // Con la general incluida puede haber dos abiertas: primero la de la sede, que es la que usa el POS.
  return incluirGeneral ? preferirCajaDeSede(data, loc) : data[0] ?? null;
}

export default function CajaScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const s = useMemo(() => crearEstilos(t), [t]);
  const { tenantId } = useAuth();
  const { timezone, ready } = useTenant();
  const guard = useGuardRespuestas();
  const guardHist = useGuardRespuestas();
  const [tab, setTab]               = useState<Tab>("caja");

  // Sesión
  const [session, setSession]       = useState<Session | null>(null);
  const [movements, setMovements]   = useState<Movement[]>([]);
  const [cargado, setCargado]       = useState(false);
  const [error, setError]           = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  // De qué sede es la caja (solo con varias sedes: DIN-12). Una caja es un
  // cajón físico: siempre es la de la sede activa, nunca "todas".
  const [sede, setSede]             = useState<string | null>(null);
  // Negocio de una sola sede: sus cajas viejas sin sede se muestran como "Caja general".
  const [conGeneral, setConGeneral] = useState(false);

  // Apertura
  const [openAmt, setOpenAmt]       = useState("");
  const [openNote, setOpenNote]     = useState("");
  const [opening, setOpening]       = useState(false);

  // Movimiento
  const [movModal, setMovModal]     = useState(false);
  const [movType, setMovType]       = useState<MoveType>("ingreso");
  const [movAmt, setMovAmt]         = useState("");
  const [movDesc, setMovDesc]       = useState("");
  const [movCat, setMovCat]         = useState("");
  const [movSaving, setMovSaving]   = useState(false);
  // Propina: ¿para quién es? "" = para el negocio (no va a nómina). Igual que
  // la Caja web: con alguien elegido, el trigger nomina_propina_de_caja la
  // anota en su nómina.
  const [propinaPara, setPropinaPara] = useState("");
  const [equipo, setEquipo]         = useState<Profesional[]>([]);

  // Cierre
  const [closeModal, setCloseModal] = useState(false);
  const [closeAmt, setCloseAmt]     = useState("");
  const [closeNote, setCloseNote]   = useState("");
  const [closing, setClosing]       = useState(false);

  // Historial
  const [history, setHistory]       = useState<HistRow[]>([]);
  const [histCargado, setHistCargado] = useState(false);
  const [histError, setHistError]   = useState<unknown>(null);

  // Evita el doble envío con dos toques rápidos (el estado llega tarde).
  const ocupado = useRef(false);

  // Equipo activo, para decir de quién es una propina. Si no carga, la
  // propina queda para el negocio (como antes) y no se bloquea nada.
  useEffect(() => {
    if (!tenantId) return;
    let vivo = true;
    supabase.from("professionals").select("id, name").eq("tenant_id", tenantId).eq("is_active", true).order("name")
      .then(({ data, error }) => { if (vivo && !error) setEquipo((data ?? []) as Profesional[]); }, () => {});
    return () => { vivo = false; };
  }, [tenantId]);
  const nombreDe = (id: string | null) => (id ? equipo.find(p => p.id === id)?.name ?? null : null);

  // ── Carga de la sesión: al enfocar, al volver a primer plano, al cambiar de sede o de día.
  const { recargar } = useRecarga(async () => {
    if (!tenantId) return;
    const turno = guard.nuevo();
    try {
      const { loc, sedes, incluirGeneral } = await alcanceCaja(tenantId);
      const sesion = await cajaAbierta(tenantId, loc, incluirGeneral);
      // Todos los movimientos (sin tope): el saldo y el arqueo tienen que
      // cuadrar con el cierre aunque la sesión tenga cientos.
      const movs = sesion
        ? await traerTodo<Movement>((d, h) =>
            supabase.from("cash_movements").select(COLS_MOV)
              .eq("session_id", sesion.id)
              .order("created_at", { ascending: false }).order("id")
              .range(d, h),
          { contexto: "No se pudieron cargar los movimientos de la caja" })
        : [];
      if (!turno.vigente()) return;
      setSede(nombreSede(sedes, loc));
      setConGeneral(incluirGeneral);
      setSession(sesion);
      if (!sesion) setCloseModal(false);
      setMovements(movs);
      setError(null);
      setCargado(true);
    } catch (e) {
      if (turno.vigente()) setError(e);
    }
  }, [tenantId], { timeZone: timezone, habilitado: !!tenantId });

  // ── Historial (DIN-21 / CAL-14): por sede, paginado y con el arqueo real.
  const { recargar: recargarHist } = useRecarga(async () => {
    if (!tenantId) return;
    const turno = guardHist.nuevo();
    try {
      const { loc, incluirGeneral } = await alcanceCaja(tenantId);
      let q = supabase.from("cash_sessions").select(COLS_SESION)
        .eq("tenant_id", tenantId).not("closed_at", "is", null);
      if (loc && incluirGeneral) q = q.or(filtroSedeOGeneral(loc));
      else if (loc) q = q.eq("location_id", loc);
      const ss = (revisar(await q.order("opened_at", { ascending: false }).limit(30), "No se pudo cargar el historial de caja") ?? []) as Session[];
      const mvs = ss.length === 0 ? [] : await traerPorIds<Pick<Movement, "session_id" | "type" | "amount" | "payment_method">>(
        ss.map(x => x.id),
        (lote, d, h) => supabase.from("cash_movements")
          .select("id, session_id, type, amount, payment_method")
          .in("session_id", lote).order("id").range(d, h),
        { contexto: "No se pudieron cargar los movimientos del historial" },
      );
      const porSesion = new Map<string, typeof mvs>();
      for (const m of mvs) {
        const lista = porSesion.get(m.session_id) ?? [];
        lista.push(m);
        porSesion.set(m.session_id, lista);
      }
      const filas: HistRow[] = ss.map(x => {
        const tot = totalesCaja(porSesion.get(x.id) ?? [], x.opening_amount);
        return {
          session: x,
          ingresos: tot.ingresos,
          egresos: tot.egresos,
          electronicos: tot.ingresosElectronicos,
          efectivoEsperado: tot.efectivoEsperado,
          diferencia: x.closing_amount == null ? null : Number(x.closing_amount) - tot.efectivoEsperado,
        };
      });
      if (!turno.vigente()) return;
      setHistory(filas);
      setHistError(null);
      setHistCargado(true);
    } catch (e) {
      if (turno.vigente()) setHistError(e);
    }
  }, [tenantId], { timeZone: timezone, habilitado: !!tenantId && ready && tab === "historial" });

  const onRefresh = async () => {
    setRefreshing(true);
    await (tab === "historial" ? recargarHist() : recargar());
    setRefreshing(false);
  };

  // ── Apertura (DIN-22): antes de insertar se vuelve a mirar si alguien ya
  // abrió la caja de esta sede (en el web u otro teléfono) con la pantalla
  // cargada desde antes.
  const handleOpen = async () => {
    if (!tenantId || ocupado.current) return;
    const amt = leerMonto(openAmt);
    if (amt === null || amt < 0) { Alert.alert("Revisa el fondo", "Ingresa un fondo inicial válido (puede ser 0)."); return; }
    ocupado.current = true;
    setOpening(true);
    try {
      const { loc: locationId, incluirGeneral } = await alcanceCaja(tenantId);
      const yaAbierta = await cajaAbierta(tenantId, locationId, incluirGeneral);
      if (yaAbierta) {
        Alert.alert(
          "La caja ya está abierta",
          `Alguien la abrió a las ${fmt12(horaLocalDe(yaAbierta.opened_at, timezone))}. Se muestra esa caja para no partir el arqueo en dos.`,
        );
        await recargar();
        return;
      }
      // Sede activa: el POS exige caja abierta EN LA SEDE ACTIVA para cobrar.
      revisar(await supabase.from("cash_sessions").insert({
        tenant_id: tenantId, opening_amount: amt, opening_note: openNote.trim() || null,
        ...(locationId ? { location_id: locationId } : {}),
      }).select("id").single(), "No se pudo abrir la caja");
      setOpenAmt(""); setOpenNote("");
      await recargar();
    } catch (e) {
      Alert.alert("No se pudo abrir la caja", mensajeError(e));
    } finally {
      ocupado.current = false;
      setOpening(false);
    }
  };

  const handleMovement = async () => {
    if (!tenantId || !session || ocupado.current) return;
    const amt = leerMonto(movAmt);
    if (amt === null || amt <= 0) { Alert.alert("Revisa el monto", "Ingresa un monto mayor a cero."); return; }
    if (!movDesc.trim()) { Alert.alert("Falta la descripción", "La descripción es obligatoria."); return; }
    ocupado.current = true;
    setMovSaving(true);
    try {
      revisar(await supabase.from("cash_movements").insert({
        session_id: session.id, tenant_id: tenantId,
        type: movType, amount: amt, description: movDesc.trim(),
        category: movCat || null,
        professional_id: profesionalDeMovimiento(movType, movCat, propinaPara),
      }).select("id").single(), "No se pudo guardar el movimiento");
      setMovAmt(""); setMovDesc(""); setMovCat(""); setPropinaPara("");
      setMovModal(false);
      await recargar();
    } catch (e) {
      Alert.alert("No se guardó el movimiento", mensajeError(e));
    } finally {
      ocupado.current = false;
      setMovSaving(false);
    }
  };

  // Antes de mostrar el cierre se recargan los movimientos: el efectivo
  // esperado tiene que incluir lo cobrado en otro dispositivo mientras tanto.
  const abrirCierre = async () => {
    await recargar();
    setCloseModal(true);
  };
  // Si al recargar resulta que ya la cerraron en otro dispositivo, el modal no
  // se muestra (antes quedaba abierto con $0 y "Confirmar cierre" no hacía nada).
  const cierreVisible = closeModal && !!session;

  const handleClose = async () => {
    if (!session || ocupado.current) return;
    const amt = leerMonto(closeAmt);
    if (amt === null || amt < 0) { Alert.alert("Revisa el monto", "Ingresa el efectivo contado (puede ser 0)."); return; }
    ocupado.current = true;
    setClosing(true);
    try {
      // .is("closed_at", null): si otro dispositivo ya la cerró, no se pisa su cierre.
      exigirFilas(
        await supabase.from("cash_sessions").update({
          closed_at: new Date().toISOString(), closing_amount: amt,
          closing_note: closeNote.trim() || null,
        }).eq("id", session.id).is("closed_at", null).select("id"),
        "No se pudo cerrar la caja (puede que ya la hayan cerrado en otro dispositivo)",
      );
      setCloseAmt(""); setCloseNote("");
      setCloseModal(false);
      await recargar();
      Alert.alert("Caja cerrada", "La sesión fue cerrada correctamente.");
    } catch (e) {
      Alert.alert("No se cerró la caja", mensajeError(e));
      await recargar();
    } finally {
      ocupado.current = false;
      setClosing(false);
    }
  };

  // DIN-X1: un ingreso de un cobro ya anulado se puede quitar de la caja.
  const quitarHuerfano = (m: Movement) => {
    if (!session) return;
    Alert.alert(
      "Quitar ingreso de la caja",
      `«${m.description}» (${fmtMoneyFull(Number(m.amount))}) es de un cobro que ya se anuló, pero sigue sumando en la caja. Si el dinero se devolvió al cliente, quítalo para que el arqueo cuadre.`,
      [
        { text: "Dejarlo", style: "cancel" },
        { text: "Quitar", style: "destructive", onPress: async () => {
          try {
            exigirFilas(
              await supabase.from("cash_movements").delete()
                .eq("id", m.id).eq("session_id", session.id).is("pos_sale_id", null).select("id"),
              "No se pudo quitar el ingreso",
            );
          } catch (e) {
            Alert.alert("No se quitó", mensajeError(e));
          }
          await recargar();
        } },
      ],
    );
  };

  // ── Cálculos
  const tot = totalesCaja(movements, session?.opening_amount);
  const huerfanos = movements.filter(esIngresoHuerfano);
  const totalHuerfanos = huerfanos.reduce((a, m) => a + Number(m.amount), 0);
  const closeLeido = leerMonto(closeAmt);
  const diff = (closeLeido ?? 0) - tot.efectivoEsperado;
  const abiertaHoy = session ? esHoy(diaLocalDe(session.opened_at, timezone), timezone) : true;
  const cuandoAbrio = session
    ? `${abiertaHoy ? "" : `${fmtDia(diaLocalDe(session.opened_at, timezone), "dia-mes")}, `}${fmt12(horaLocalDe(session.opened_at, timezone))}`
    : "";

  const TABS: { key: Tab; label: string }[] = [
    { key: "caja",      label: "Caja" },
    { key: "historial", label: "Historial" },
  ];

  /** "= $200.000" debajo del campo: se ve cómo se interpretó lo escrito. */
  const interpretado = (texto: string) => {
    const n = leerMonto(texto);
    if (n === null) return null;
    return <Text style={s.hint}>= {fmtMoneyFull(n)}</Text>;
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader crumb="Dinero" title="Sistema de Caja" onBack={() => router.back()}
        subtitle={sede ? `Caja de ${sede} · ingresos y egresos` : "Control de ingresos y egresos"} />

      <View style={s.tabBar}>
        {TABS.map(tb => (
          <TouchableOpacity key={tb.key} style={[s.tabBtn, tab === tb.key && s.tabBtnActive]} onPress={() => setTab(tb.key)} activeOpacity={0.75}
            accessibilityRole="tab" accessibilityState={{ selected: tab === tb.key }}>
            <Text style={[s.tabLabel, tab === tb.key && s.tabLabelActive]}>{tb.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === "caja" && (error && !cargado ? (
        <ErrorState error={error} onRetry={recargar} />
      ) : !cargado ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={Colors.red} size="large" />
        </View>
      ) : !session ? (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.red} />}>
            <Animated.View entering={FadeInDown.duration(350)}>
              {error ? <ErrorBanner s={s} error={error} onRetry={recargar} /> : null}
              <View style={[s.closedCard, Shadow.sm]}>
                <View style={s.closedIcon}>
                  <Ionicons name="lock-closed-outline" size={32} color={t.muted} />
                </View>
                <Text style={s.closedTitle}>Caja cerrada</Text>
                <Text style={s.closedSub}>Abre la caja para empezar a registrar movimientos</Text>
              </View>

              <Text style={s.label}>Fondo inicial</Text>
              <View style={s.amountRow}>
                <Text style={s.currencySign}>$</Text>
                <TextInput style={[s.input, s.inputAmount]}
                  value={openAmt} onChangeText={setOpenAmt} placeholder="Ej: 200000"
                  placeholderTextColor={t.subtle} keyboardType="number-pad" accessibilityLabel="Fondo inicial" />
              </View>
              {interpretado(openAmt)}

              <Text style={s.label}>Nota de apertura (opcional)</Text>
              <TextInput style={s.input} value={openNote} onChangeText={setOpenNote}
                placeholder="Ej: Turno mañana" placeholderTextColor={t.subtle} />

              <TouchableOpacity style={s.btn} onPress={handleOpen} disabled={opening} activeOpacity={0.85} accessibilityRole="button">
                <View style={s.btnInner}>
                  {opening ? <ActivityIndicator color="white" /> : <><Ionicons name="lock-open-outline" size={16} color="white" /><Text style={s.btnText}>Abrir caja</Text></>}
                </View>
              </TouchableOpacity>
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
      ) : (
        <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.red} />}>
          {error ? <ErrorBanner s={s} error={error} onRetry={recargar} /> : null}
          <View style={[s.statusBanner, Shadow.sm]}>
            <View style={s.statusDot} />
            <Text style={s.statusText}>
              Caja abierta desde {abiertaHoy ? "las " : "el "}{cuandoAbrio}
              {conGeneral && !session.location_id ? " · Caja general" : ""}
              {session.opening_note ? ` · ${session.opening_note}` : ""}
            </Text>
          </View>

          {conGeneral && !session.location_id && (
            <View style={s.warnBox}>
              <Ionicons name="alert-circle-outline" size={18} color="#d97706" />
              <Text style={s.warnText}>
                Esta caja se abrió sin sede y el POS no cobra en ella. Ciérrala y abre la caja de nuevo para seguir cobrando.
              </Text>
            </View>
          )}

          {huerfanos.length > 0 && (
            <View style={s.warnBox}>
              <Ionicons name="alert-circle-outline" size={18} color="#d97706" />
              <Text style={s.warnText}>
                {huerfanos.length === 1 ? "Hay 1 ingreso" : `Hay ${huerfanos.length} ingresos`} de cobros ya anulados ({fmtMoneyFull(totalHuerfanos)}) que siguen sumando en la caja. Tócalos en la lista para revisarlos.
              </Text>
            </View>
          )}

          <View style={s.metricsGrid}>
            <View style={[s.metricCard, Shadow.sm]}>
              <Text style={s.metricLabel}>Fondo inicial</Text>
              <Text style={s.metricValue}>{fmtMoneyFull(Number(session.opening_amount))}</Text>
            </View>
            <View style={[s.metricCard, Shadow.sm]}>
              <Text style={s.metricLabel}>Ingresos</Text>
              <Text style={[s.metricValue, { color: Colors.success }]}>{fmtMoneyFull(tot.ingresos)}</Text>
            </View>
            <View style={[s.metricCard, Shadow.sm]}>
              <Text style={s.metricLabel}>Egresos</Text>
              <Text style={[s.metricValue, { color: Colors.red }]}>{fmtMoneyFull(tot.egresos)}</Text>
            </View>
            <View style={[s.metricCard, Shadow.sm]}>
              <Text style={s.metricLabel}>Efectivo en caja</Text>
              <Text style={[s.metricValue, { color: Colors.purple }]}>{fmtMoneyFull(tot.efectivoEsperado)}</Text>
              {tot.ingresosElectronicos > 0 && (
                <Text style={s.metricSub}>+ {fmtMoneyFull(tot.ingresosElectronicos)} electrónicos</Text>
              )}
            </View>
          </View>

          <View style={{ flexDirection: "row", gap: 10, marginBottom: 20 }}>
            <TouchableOpacity style={[s.actionBtn, { flex: 2, backgroundColor: Colors.success }]}
              onPress={() => { setMovType("ingreso"); setMovModal(true); }} activeOpacity={0.8} accessibilityRole="button">
              <Ionicons name="add-circle-outline" size={16} color="white" />
              <Text style={s.actionBtnText}>Registrar movimiento</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.actionBtn, { flex: 1, backgroundColor: t.cardSolid, borderWidth: 1.5, borderColor: Colors.red }]}
              onPress={abrirCierre} activeOpacity={0.8} accessibilityRole="button">
              <Text style={[s.actionBtnText, { color: Colors.red }]}>Cerrar caja</Text>
            </TouchableOpacity>
          </View>

          <View style={[s.movList, Shadow.sm]}>
            <View style={s.movListHeader}>
              <Text style={s.movListTitle}>Movimientos de la sesión</Text>
              <Text style={s.movListCount}>{movements.length}</Text>
            </View>
            {movements.length === 0 ? (
              <View style={{ padding: 24, alignItems: "center" }}>
                <Text style={s.emptyText}>Sin movimientos aún</Text>
              </View>
            ) : (
              movements.map((m, i) => {
                const huerfano = esIngresoHuerfano(m);
                const color = m.type === "ingreso" ? Colors.success : Colors.red;
                const fila = (
                  <View style={[s.movRow, i > 0 && s.movRowBorder]}>
                    <View style={[s.movBadge, { backgroundColor: color + "18" }]}>
                      <Text style={[s.movBadgeText, { color }]}>{m.type === "ingreso" ? "+" : "−"}</Text>
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={[s.movDesc, huerfano && { textDecorationLine: "line-through" }]}>{m.description}</Text>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        {huerfano ? (
                          <View style={[s.movCatBadge, { backgroundColor: "rgba(245,158,11,0.14)" }]}>
                            <Text style={[s.movCatText, { color: "#d97706" }]}>Cobro anulado · tocar para quitar</Text>
                          </View>
                        ) : m.category ? (
                          <View style={s.movCatBadge}>
                            <Text style={s.movCatText}>
                              {m.category}{m.category === CATEGORIA_PROPINA && nombreDe(m.professional_id) ? ` · ${nombreDe(m.professional_id)}` : ""}
                            </Text>
                          </View>
                        ) : null}
                        {m.payment_method && m.payment_method !== "efectivo" ? (
                          <Text style={s.movTime}>{m.payment_method}</Text>
                        ) : null}
                        <Text style={s.movTime}>{fmt12(horaLocalDe(m.created_at, timezone))}</Text>
                      </View>
                    </View>
                    <Text style={[s.movAmt, { color }]}>
                      {m.type === "ingreso" ? "+" : "−"}{fmtMoneyFull(Number(m.amount))}
                    </Text>
                  </View>
                );
                return (
                  <Animated.View key={m.id} entering={i < 10 ? FadeInDown.delay(i * 30).duration(250) : undefined}>
                    {huerfano ? (
                      <TouchableOpacity onPress={() => quitarHuerfano(m)} activeOpacity={0.7} accessibilityRole="button"
                        accessibilityLabel={`Ingreso de cobro anulado: ${m.description}. Tocar para quitarlo de la caja`}>
                        {fila}
                      </TouchableOpacity>
                    ) : fila}
                  </Animated.View>
                );
              })
            )}
          </View>
        </ScrollView>
      ))}

      {tab === "historial" && (histError && !histCargado ? (
        <ErrorState error={histError} onRetry={recargarHist} />
      ) : (
        <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.red} />}>
          {histError ? <ErrorBanner s={s} error={histError} onRetry={recargarHist} /> : null}
          {!histCargado ? (
            <ActivityIndicator color={Colors.red} style={{ marginTop: 40 }} />
          ) : history.length === 0 ? (
            <Animated.View entering={FadeInDown.duration(350)} style={[s.emptyCard, Shadow.sm]}>
              <Ionicons name="time-outline" size={40} color={t.subtle} style={{ marginBottom: 12 }} />
              <Text style={s.emptyTitle}>Sin sesiones cerradas aún</Text>
            </Animated.View>
          ) : (
            history.map((h, i) => {
              const dia = diaLocalDe(h.session.opened_at, timezone);
              const colorDif = h.diferencia == null ? t.muted : h.diferencia >= 0 ? Colors.success : Colors.red;
              return (
                <Animated.View key={h.session.id} entering={i < 10 ? FadeInDown.delay(i * 40).duration(280) : undefined}>
                  <View style={[s.histCard, Shadow.sm]}>
                    <View style={s.histCardTop}>
                      <Text style={s.histDate}>{fmtDia(dia, "corto")}</Text>
                      <Text style={s.histTime}>
                        {fmt12(horaLocalDe(h.session.opened_at, timezone))} → {h.session.closed_at ? fmt12(horaLocalDe(h.session.closed_at, timezone)) : "—"}
                        {conGeneral && !h.session.location_id ? "  ·  Caja general" : ""}
                        {h.session.opening_note ? `  ·  ${h.session.opening_note}` : ""}
                      </Text>
                    </View>
                    {/* El arqueo se hace contra el EFECTIVO: los pagos electrónicos van aparte. */}
                    <View style={s.histMetrics}>
                      <View style={s.histMetric}>
                        <Text style={s.histMetricLabel}>Esperado</Text>
                        <Text style={s.histMetricValue}>{fmtMoneyFull(h.efectivoEsperado)}</Text>
                      </View>
                      <View style={s.histMetric}>
                        <Text style={s.histMetricLabel}>Contado</Text>
                        <Text style={s.histMetricValue}>{h.session.closing_amount == null ? "—" : fmtMoneyFull(Number(h.session.closing_amount))}</Text>
                      </View>
                      <View style={s.histMetric}>
                        <Text style={s.histMetricLabel}>Diferencia</Text>
                        <Text style={[s.histMetricValue, { color: colorDif }]}>
                          {h.diferencia == null ? "—" : `${h.diferencia > 0 ? "+" : ""}${fmtMoneyFull(h.diferencia)}`}
                        </Text>
                      </View>
                    </View>
                    <Text style={s.histFoot}>
                      Fondo {fmtMoneyFull(Number(h.session.opening_amount))} · Ingresos {fmtMoneyFull(h.ingresos)}
                      {h.electronicos > 0 ? ` (${fmtMoneyFull(h.electronicos)} electrónicos)` : ""} · Egresos {fmtMoneyFull(h.egresos)}
                    </Text>
                    {h.session.closing_note ? <Text style={s.histFoot}>Nota de cierre: {h.session.closing_note}</Text> : null}
                  </View>
                </Animated.View>
              );
            })
          )}
        </ScrollView>
      ))}

      {/* ── MOVEMENT MODAL ── */}
      <Modal visible={movModal} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setMovModal(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Registrar movimiento</Text>
              <TouchableOpacity onPress={() => setMovModal(false)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Cerrar">
                <Ionicons name="close" size={22} color={t.text} />
              </TouchableOpacity>
            </View>

            <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
              <View style={s.typeToggle}>
                {(["ingreso", "egreso"] as MoveType[]).map(mt => (
                  <TouchableOpacity key={mt} style={[s.typeBtn, movType === mt && { backgroundColor: mt === "ingreso" ? Colors.success : Colors.red }]}
                    onPress={() => { setMovType(mt); setMovCat(""); setPropinaPara(""); }} activeOpacity={0.8}
                    accessibilityRole="button" accessibilityState={{ selected: movType === mt }}>
                    <Text style={[s.typeBtnText, movType === mt && { color: "white" }]}>
                      {mt === "ingreso" ? "Ingreso" : "Egreso"}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={s.label}>Monto *</Text>
              <View style={s.amountRow}>
                <Text style={s.currencySign}>$</Text>
                <TextInput style={[s.input, s.inputAmount]}
                  value={movAmt} onChangeText={setMovAmt} placeholder="50000"
                  placeholderTextColor={t.subtle} keyboardType="number-pad" accessibilityLabel="Monto" />
              </View>
              {interpretado(movAmt)}

              <Text style={s.label}>Descripción *</Text>
              <TextInput style={s.input} value={movDesc} onChangeText={setMovDesc}
                placeholder={movType === "ingreso" ? "Ej: Corte de cabello" : "Ej: Pago de arriendo"}
                placeholderTextColor={t.subtle} />

              <Text style={s.label}>Categoría (opcional)</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {(movType === "ingreso" ? INGRESO_CATS : EGRESO_CATS).map(cat => (
                    <TouchableOpacity key={cat}
                      style={[s.catChip, movCat === cat && { backgroundColor: Colors.purple, borderColor: Colors.purple }]}
                      onPress={() => { setMovCat(movCat === cat ? "" : cat); setPropinaPara(""); }} activeOpacity={0.75}
                      accessibilityRole="button" accessibilityState={{ selected: movCat === cat }}>
                      <Text style={[s.catChipText, movCat === cat && { color: "white" }]}>{cat}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              {movType === "ingreso" && movCat === CATEGORIA_PROPINA && equipo.length > 0 && (
                <>
                  <Text style={s.label}>¿Para quién es?</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }} keyboardShouldPersistTaps="handled">
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      {[{ id: "", name: "Para el negocio" }, ...equipo].map(p => {
                        const activo = propinaPara === p.id;
                        return (
                          <TouchableOpacity key={p.id || "negocio"}
                            style={[s.catChip, activo && { backgroundColor: Colors.success, borderColor: Colors.success }]}
                            onPress={() => setPropinaPara(p.id)} activeOpacity={0.75}
                            accessibilityRole="radio" accessibilityState={{ checked: activo }}>
                            <Text style={[s.catChipText, activo && { color: "white" }]}>{p.name}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </ScrollView>
                  <Text style={s.hint}>
                    {propinaPara
                      ? `Se le suma a ${nombreDe(propinaPara) ?? "esa persona"} en su nómina.`
                      : "Para el negocio no va a nómina. Si eliges a alguien, se le suma en su nómina."}
                  </Text>
                </>
              )}

              <TouchableOpacity
                style={[s.btn, { marginTop: 24 }, (!movAmt || !movDesc.trim() || movSaving) && { opacity: 0.4 }]}
                onPress={handleMovement} disabled={!movAmt || !movDesc.trim() || movSaving} activeOpacity={0.85} accessibilityRole="button">
                <View style={[s.btnInner, { backgroundColor: movType === "ingreso" ? Colors.success : Colors.red }]}>
                  {movSaving ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>Registrar {movType}</Text>}
                </View>
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* ── CLOSE MODAL ── */}
      <Modal visible={cierreVisible} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setCloseModal(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Cerrar caja</Text>
              <TouchableOpacity onPress={() => setCloseModal(false)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Cerrar">
                <Ionicons name="close" size={22} color={t.text} />
              </TouchableOpacity>
            </View>

            <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
              <View style={[s.summaryBox, Shadow.sm]}>
                {[
                  { label: "Fondo inicial",        value: fmtMoneyFull(session ? Number(session.opening_amount) : 0), color: t.text },
                  { label: "Ingresos en efectivo", value: fmtMoneyFull(tot.ingresosEfectivo), color: Colors.success },
                  { label: "Total egresos",        value: fmtMoneyFull(tot.egresos),  color: Colors.red },
                ].map(r => (
                  <View key={r.label} style={s.summaryRow}>
                    <Text style={s.summaryLabel}>{r.label}</Text>
                    <Text style={[s.summaryValue, { color: r.color }]}>{r.value}</Text>
                  </View>
                ))}
                <View style={s.summaryDivider} />
                <View style={s.summaryRow}>
                  <Text style={[s.summaryLabel, { fontFamily: "SpaceGrotesk_700Bold", color: t.text }]}>Efectivo esperado en caja</Text>
                  <Text style={[s.summaryValue, { color: Colors.purple, fontFamily: "SpaceGrotesk_700Bold" }]}>{fmtMoneyFull(tot.efectivoEsperado)}</Text>
                </View>
                {tot.ingresosElectronicos > 0 && (
                  <View style={s.summaryRow}>
                    <Text style={[s.summaryLabel, { color: t.subtle, fontSize: 11 }]}>
                      + {fmtMoneyFull(tot.ingresosElectronicos)} por Nequi/tarjeta/QR
                    </Text>
                    <Text style={[s.summaryValue, { color: t.subtle, fontSize: 11 }]}>no está en el cajón</Text>
                  </View>
                )}
                {huerfanos.length > 0 && (
                  <Text style={[s.summaryLabel, { color: "#d97706", fontSize: 11, paddingBottom: 8 }]}>
                    Incluye {fmtMoneyFull(totalHuerfanos)} de cobros ya anulados. Quítalos de la lista antes de cerrar si el dinero se devolvió.
                  </Text>
                )}
              </View>

              <Text style={s.label}>Efectivo contado *</Text>
              <View style={s.amountRow}>
                <Text style={s.currencySign}>$</Text>
                <TextInput style={[s.input, s.inputAmount]}
                  value={closeAmt} onChangeText={setCloseAmt}
                  placeholder="Lo que hay físicamente en caja"
                  placeholderTextColor={t.subtle} keyboardType="number-pad" accessibilityLabel="Efectivo contado" />
              </View>
              {interpretado(closeAmt)}

              {closeLeido !== null && (
                <View style={[s.diffBox, { backgroundColor: diff >= 0 ? Colors.success + "14" : Colors.red + "14" }]}>
                  <Text style={s.diffLabel}>Diferencia vs efectivo esperado</Text>
                  <Text style={[s.diffValue, { color: diff >= 0 ? Colors.success : Colors.red }]}>
                    {diff > 0 ? "+" : ""}{fmtMoneyFull(diff)}  ({diff === 0 ? "cuadra" : diff > 0 ? "sobrante" : "faltante"})
                  </Text>
                </View>
              )}

              <Text style={s.label}>Nota de cierre (opcional)</Text>
              <TextInput style={s.input} value={closeNote} onChangeText={setCloseNote}
                placeholder="Ej: Turno tarde" placeholderTextColor={t.subtle} />

              <TouchableOpacity
                style={[s.btn, { marginTop: 24 }, (closeLeido === null || closing) && { opacity: 0.4 }]}
                onPress={handleClose} disabled={closeLeido === null || closing} activeOpacity={0.85} accessibilityRole="button">
                <View style={s.btnInner}>
                  {closing ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>Confirmar cierre</Text>}
                </View>
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function ErrorBanner({ s, error, onRetry }: { s: ReturnType<typeof crearEstilos>; error: unknown; onRetry: () => void }) {
  return (
    <TouchableOpacity onPress={onRetry} style={s.errorBanner} activeOpacity={0.8} accessibilityRole="button">
      <Ionicons name="cloud-offline-outline" size={16} color={Colors.red} />
      <Text style={s.errorBannerText}>{mensajeError(error)} Toca para reintentar.</Text>
    </TouchableOpacity>
  );
}

function crearEstilos(t: ThemeColors) {
  return StyleSheet.create({
    tabBar:       { flexDirection: "row", backgroundColor: t.cardSolid, borderBottomWidth: 1, borderBottomColor: t.line },
    tabBtn:       { flex: 1, paddingVertical: 13, alignItems: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
    tabBtnActive: { borderBottomColor: Colors.red },
    tabLabel:     { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: t.muted },
    tabLabelActive:{ fontSize: 13, fontFamily: "SpaceGrotesk_700Bold", color: Colors.red },

    errorBanner:    { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12, padding: 12, borderRadius: Radius.md, backgroundColor: "rgba(251,15,5,0.08)" },
    errorBannerText:{ flex: 1, fontSize: 12.5, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.red },

    label:        { fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", color: t.muted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8, marginTop: 18 },
    hint:         { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: t.subtle, marginTop: 6 },
    input:        { backgroundColor: t.inputBg, borderWidth: 1.5, borderColor: t.inputBorder, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, fontFamily: "SpaceGrotesk_400Regular", color: t.text },
    inputAmount:  { flex: 1, borderLeftWidth: 0, borderTopLeftRadius: 0, borderBottomLeftRadius: 0 },
    amountRow:    { flexDirection: "row", alignItems: "center" },
    currencySign: { backgroundColor: t.inputBg, borderWidth: 1.5, borderColor: t.inputBorder, borderTopLeftRadius: Radius.md, borderBottomLeftRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: t.muted, borderRightWidth: 0 },

    closedCard:   { backgroundColor: t.cardSolid, borderWidth: 1, borderColor: t.line, borderRadius: Radius.xl, padding: 32, alignItems: "center", marginBottom: 8 },
    closedIcon:   { width: 64, height: 64, borderRadius: 32, backgroundColor: t.chipBg, alignItems: "center", justifyContent: "center", marginBottom: 12 },
    closedTitle:  { fontSize: 18, fontFamily: "SpaceGrotesk_700Bold", color: t.text, marginBottom: 6 },
    closedSub:    { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: t.muted, textAlign: "center" },

    statusBanner: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: Colors.success + "14", borderRadius: Radius.md, padding: 14, marginBottom: 16 },
    statusDot:    { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.success },
    statusText:   { flex: 1, fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.success },

    warnBox:      { flexDirection: "row", gap: 10, alignItems: "flex-start", backgroundColor: "rgba(245,158,11,0.12)", borderRadius: Radius.md, padding: 14, marginBottom: 16 },
    warnText:     { flex: 1, fontSize: 12.5, lineHeight: 18, fontFamily: "SpaceGrotesk_600SemiBold", color: "#d97706" },

    metricsGrid:  { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 },
    metricCard:   { width: "47.5%", backgroundColor: t.cardSolid, borderWidth: 1, borderColor: t.line, borderRadius: Radius.lg, padding: 14 },
    metricLabel:  { fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold", color: t.muted, marginBottom: 6 },
    metricValue:  { fontSize: 18, fontFamily: "SpaceGrotesk_700Bold", color: t.text },
    metricSub:    { fontSize: 10.5, fontFamily: "SpaceGrotesk_400Regular", color: t.subtle, marginTop: 3 },

    actionBtn:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: Radius.md, paddingVertical: 14 },
    actionBtnText:{ fontSize: 13, fontFamily: "SpaceGrotesk_700Bold", color: "white" },

    movList:      { backgroundColor: t.cardSolid, borderWidth: 1, borderColor: t.line, borderRadius: Radius.lg, overflow: "hidden" },
    movListHeader:{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 1, borderBottomColor: t.line },
    movListTitle: { fontSize: 14, fontFamily: "SpaceGrotesk_700Bold", color: t.text },
    movListCount: { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: t.muted },
    movRow:       { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
    movRowBorder: { borderTopWidth: 1, borderTopColor: t.line },
    movBadge:     { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
    movBadgeText: { fontSize: 18, fontFamily: "SpaceGrotesk_700Bold" },
    movDesc:      { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: t.text },
    movCatBadge:  { backgroundColor: t.chipBg, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
    movCatText:   { fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold", color: t.muted },
    movTime:      { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", color: t.subtle },
    movAmt:       { fontSize: 14, fontFamily: "SpaceGrotesk_700Bold" },

    histCard:     { backgroundColor: t.cardSolid, borderWidth: 1, borderColor: t.line, borderRadius: Radius.lg, padding: 16, marginBottom: 10 },
    histCardTop:  { marginBottom: 12 },
    histDate:     { fontSize: 14, fontFamily: "SpaceGrotesk_700Bold", color: t.text },
    histTime:     { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: t.muted, marginTop: 2 },
    histMetrics:  { flexDirection: "row", justifyContent: "space-between" },
    histMetric:   { alignItems: "center", flex: 1 },
    histMetricLabel:{ fontSize: 10, fontFamily: "SpaceGrotesk_600SemiBold", color: t.muted, marginBottom: 4 },
    histMetricValue:{ fontSize: 13, fontFamily: "SpaceGrotesk_700Bold", color: t.text },
    histFoot:     { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", color: t.subtle, marginTop: 10, lineHeight: 16 },

    emptyCard:    { backgroundColor: t.cardSolid, borderWidth: 1, borderColor: t.line, borderRadius: Radius.xl, padding: 48, alignItems: "center", marginTop: 20 },
    emptyTitle:   { fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", color: t.text },
    emptyText:    { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: t.subtle },

    btn:          { borderRadius: Radius.full, overflow: "hidden", marginTop: 24 },
    btnInner:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 16, backgroundColor: Colors.red },
    btnText:      { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: "white" },

    modalHeader:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 20, borderBottomWidth: 1, borderBottomColor: t.line },
    modalTitle:   { fontSize: 17, fontFamily: "SpaceGrotesk_700Bold", color: t.text },
    typeToggle:   { flexDirection: "row", backgroundColor: t.chipBg, borderRadius: Radius.md, padding: 4, marginTop: 4 },
    typeBtn:      { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: Radius.md - 2 },
    typeBtnText:  { fontSize: 13, fontFamily: "SpaceGrotesk_700Bold", color: t.muted },
    catChip:      { borderRadius: Radius.full, borderWidth: 1.5, borderColor: t.line, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: t.cardSolid },
    catChipText:  { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: t.muted },
    summaryBox:   { backgroundColor: t.cardSolid, borderWidth: 1, borderColor: t.line, borderRadius: Radius.lg, padding: 16, marginBottom: 4 },
    summaryRow:   { flexDirection: "row", justifyContent: "space-between", paddingVertical: 10, gap: 10 },
    summaryLabel: { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: t.muted, flexShrink: 1 },
    summaryValue: { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold" },
    summaryDivider:{ height: 1, backgroundColor: t.line },
    diffBox:      { borderRadius: Radius.md, padding: 14, marginTop: 10, gap: 4 },
    diffLabel:    { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: t.text },
    diffValue:    { fontSize: 14, fontFamily: "SpaceGrotesk_700Bold" },
  });
}
