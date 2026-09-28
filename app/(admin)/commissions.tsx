import { useMemo, useRef, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, TextInput, Modal,
  FlatList, ActivityIndicator, KeyboardAvoidingView, Platform, RefreshControl,
} from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { Colors, Fonts, Radius, Shadow } from "@/constants/theme";
import ErrorState from "@/components/ErrorState";
import { useTheme, type ThemeColors } from "@/lib/theme";
import { ScreenHeader, SegmentedControl, IconButton } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { fmtMoneyFull } from "@/lib/format";
import { leerMonto } from "@/lib/dinero";
import {
  diaLocalDe, fmtDia, hoyNegocio, listaDeDias, moverReferencia, rangoDePeriodo,
  rangoIncluyeHoy, rangoPersonalizado, sumarDias, etiquetaRango, diasEntre,
  type RangoNegocio,
} from "@/lib/tz";
import { ErrorDB, exigirFilas, mensajeError, nuevoId, revisar, traerTodo } from "@/lib/db";
import { useGuardRespuestas, useRecarga } from "@/lib/useRecarga";
import { cobradoDe, estaCobrada } from "@/lib/ingresos";
import {
  calcularComision, cobradoDespuesDeLiquidar, colorDeProfesional, completadasSinCobro, describirRegla,
  diasSinLiquidar, recortarHastaHoy, totalesEntre, type CitaComision, type Totales, type Tramo,
} from "@/lib/comisiones";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

// ─── Types ────────────────────────────────────────────────────────────────────

// professionals NO tiene columna color (ESQ-09): pedirla hacía fallar toda la
// consulta y la pantalla quedaba vacía. El color se deriva del id.
type Professional = { id: string; name: string; is_active: boolean | null };

type CommissionRule = {
  id?: string;
  professional_id: string;
  type: "percentage" | "fixed";
  value: number;
};

type CitaCom = CitaComision & { professional_id: string | null };

type Pago = {
  id: string;
  professional_id: string;
  period_start: string;
  period_end: string;
  commission_amount: number;
  appointments_count: number;
  revenue_total: number;
};

type TramoPendiente = Tramo & Totales;

type ProSummary = {
  pro: Professional;
  rule: CommissionRule | null;
  /** Cobrado y comisión del periodo completo. */
  total: Totales;
  /** Completadas sin venta: no suman hasta cobrarse (D10). */
  sinCobro: number;
  /** Lo ya liquidado en liquidaciones que se cruzan con el periodo. */
  pagado: number;
  pagos: Pago[];
  /** Días del periodo (hasta hoy) que nadie ha liquidado, con sus montos. */
  tramos: TramoPendiente[];
  pendiente: Totales;
  /**
   * Cobros de días YA liquidados que no entraron en esa liquidación (se
   * cobraron después). No se vuelven a liquidar solos para no pagar doble,
   * pero tampoco se puede decir "Liquidado".
   */
  tarde: { citas: number; ingresos: number };
  /** Citas cobradas de días que aún no llegan (no se liquidan hasta ese día). */
  futuras: number;
};

type Resumen = {
  clave: string;
  rango: RangoNegocio;
  hoy: string;
  summaries: ProSummary[];
  citasPorPro: Record<string, CitaCom[]>;
};

type HistRow = {
  id: string;
  professional_id: string;
  period_start: string;
  period_end: string;
  appointments_count: number;
  revenue_total: number;
  commission_amount: number;
  paid_at: string | null;
  note: string | null;
  professionals: { name: string } | null;
};

type Period = "semana" | "mes" | "custom";

type Liquidacion = {
  s: ProSummary;
  /** Tramos a guardar, cada uno con su id generado al abrir (idempotencia). */
  tramos: (TramoPendiente & { id: string })[];
};

const HIST_PAGINA = 30;
const MAX_DIAS_RANGO = 366;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** 'YYYY-MM-DD' que existe de verdad (2026-02-30 no). */
function esDia(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && sumarDias(s, 0) === s;
}

const claveDe = (r: RangoNegocio) => `${r.periodo}|${r.desde}|${r.hasta}|${r.timeZone}`;
// Fechas Y montos: si entró un cobro mientras el modal estaba abierto, las
// fechas no cambian pero el monto sí, y ese día quedaría "pagado" sin él.
// Se redondea a centavos: el orden de suma de dos ventas puede variar entre
// consultas y dar otro decimal flotante.
const firmaTramos = (ts: readonly TramoPendiente[]) =>
  ts.map(x => `${x.desde}_${x.hasta}_${x.citas}_${Math.round(x.ingresos * 100)}`).join(",");
const sumaTotales = (ts: readonly Totales[]): Totales =>
  ts.reduce((a, x) => ({ citas: a.citas + x.citas, ingresos: a.ingresos + x.ingresos, comision: a.comision + x.comision }), { citas: 0, ingresos: 0, comision: 0 });

function armarResumen(
  rango: RangoNegocio,
  hoy: string,
  pros: Professional[],
  rules: CommissionRule[],
  citas: CitaCom[],
  pagos: Pago[],
): Resumen {
  const citasPorPro: Record<string, CitaCom[]> = {};
  for (const c of citas) {
    if (!c.professional_id) continue;
    (citasPorPro[c.professional_id] ??= []).push(c);
  }
  const summaries = pros
    // Un profesional desactivado sigue apareciendo si tiene cobros en el
    // periodo: se le debe su comisión aunque ya no trabaje aquí (D1).
    .filter(p => p.is_active !== false || (citasPorPro[p.id] ?? []).some(estaCobrada))
    .map(pro => {
      const cs = citasPorPro[pro.id] ?? [];
      const rule = rules.find(r => r.professional_id === pro.id) ?? null;
      const pagosPro = pagos.filter(x => x.professional_id === pro.id);
      const sinCubrir = diasSinLiquidar(rango.desde, rango.hasta, pagosPro);
      const tramos = recortarHastaHoy(sinCubrir, hoy)
        .map(t => ({ ...t, ...totalesEntre(cs, rule, t.desde, t.hasta) }))
        .filter(t => t.citas > 0);
      const citasSinCubrir = sinCubrir.reduce((a, t) => a + totalesEntre(cs, rule, t.desde, t.hasta).citas, 0);
      const pendiente = sumaTotales(tramos);
      return {
        pro,
        rule,
        total: totalesEntre(cs, rule, rango.desde, rango.hasta),
        sinCobro: completadasSinCobro(cs),
        pagado: pagosPro.reduce((a, x) => a + (Number(x.commission_amount) || 0), 0),
        pagos: pagosPro,
        tramos,
        pendiente,
        tarde: cobradoDespuesDeLiquidar(cs, pagosPro, rango.desde, rango.hasta),
        // Cobradas en días sin liquidar que quedaron fuera por ser futuros.
        futuras: Math.max(0, citasSinCubrir - pendiente.citas),
      };
    });
  return { clave: claveDe(rango), rango, hoy, summaries, citasPorPro };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MiniBar({ data, color }: { data: number[]; color: string }) {
  const { t } = useTheme();
  const max = Math.max(...data, 1);
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", height: 44, gap: 3, marginTop: 8 }}>
      {data.map((v, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            height: `${Math.max((v / max) * 100, v > 0 ? 8 : 2)}%`,
            backgroundColor: v === 0 ? t.trackBg : color,
            borderRadius: 3,
          }}
        />
      ))}
    </View>
  );
}

function KpiCard({ label, value, icon, color }: { label: string; value: string; icon: IoniconName; color: string }) {
  const { t } = useTheme();
  return (
    <View style={[kpi.card, Shadow.sm, { backgroundColor: t.cardSolid, borderColor: t.line }]}>
      <View style={[kpi.iconBox, { backgroundColor: color + "18" }]}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <Text style={[kpi.value, { color: t.text }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={[kpi.label, { color: t.muted }]}>{label}</Text>
    </View>
  );
}

const kpi = StyleSheet.create({
  card:    { flex: 1, borderWidth: 1, borderRadius: Radius.md, padding: 14, alignItems: "center", gap: 6 },
  iconBox: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  value:   { fontSize: 16, fontFamily: Fonts.bold },
  label:   { fontSize: 11, fontFamily: Fonts.regular, textAlign: "center" },
});

function Avatar({ pro, size = 32 }: { pro: { id: string; name: string }; size?: number }) {
  return (
    <View style={[av.box, { width: size, height: size, borderRadius: size / 2, backgroundColor: colorDeProfesional(pro.id) }]}>
      <Text style={av.txt}>{(pro.name || "?")[0]?.toUpperCase()}</Text>
    </View>
  );
}

const av = StyleSheet.create({
  box: { alignItems: "center", justifyContent: "center" },
  txt: { fontSize: 13, fontFamily: Fonts.bold, color: "white" },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function CommissionsScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const s = useMemo(() => crearEstilos(t), [t]);
  const { tenantId } = useAuth();
  const { timezone, ready } = useTenant();
  const guard = useGuardRespuestas();
  const guardHist = useGuardRespuestas();
  const [tab, setTab] = useState(0);

  // Periodo. ref = día de referencia (null = periodo actual, así sigue a "hoy").
  const [period, setPeriod] = useState<Period>("semana");
  const [ref, setRef] = useState<string | null>(null);
  const [customDraft, setCustomDraft] = useState({ desde: "", hasta: "" });
  const [custom, setCustom] = useState<{ desde: string; hasta: string } | null>(null);

  // Datos
  const [pros, setPros] = useState<Professional[]>([]);
  const [rules, setRules] = useState<CommissionRule[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [cargado, setCargado] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Reglas
  const [editPro, setEditPro] = useState<Professional | null>(null);
  const [editRule, setEditRule] = useState<CommissionRule | null>(null);
  const [ruleType, setRuleType] = useState<"percentage" | "fixed">("percentage");
  const [ruleValue, setRuleValue] = useState("");
  const [savingRule, setSavingRule] = useState(false);

  // Historial
  const [hist, setHist] = useState<HistRow[]>([]);
  const [histError, setHistError] = useState<unknown>(null);
  const [histCargando, setHistCargando] = useState(false);
  const [histMas, setHistMas] = useState(false);
  const [filtroPro, setFiltroPro] = useState<string | null>(null);

  // Liquidar
  const [liquidar, setLiquidar] = useState<Liquidacion | null>(null);
  const [liquidarNote, setLiquidarNote] = useState("");
  const [savingLiq, setSavingLiq] = useState(false);
  const liqEnCurso = useRef(false);

  const rangoPara = (hoy: string): RangoNegocio | null => {
    if (period === "custom") return custom ? rangoPersonalizado(custom.desde, custom.hasta, timezone) : null;
    return rangoDePeriodo(period, timezone, ref ?? hoy);
  };

  const { hoy, recargar } = useRecarga(async () => {
    if (!tenantId) return;
    const turno = guard.nuevo();
    const hoyN = hoyNegocio(timezone);
    const rango = rangoPara(hoyN);
    try {
      // Todas las sedes, a propósito: la liquidación es por profesional y
      // commission_payments no guarda la sede. Filtrar por la sede activa
      // haría que al liquidar en una sede los días quedaran "pagados" también
      // para lo trabajado en la otra (DIN-12).
      const [prosRows, rulesRows, citas, pagos] = await Promise.all([
        traerTodo<Professional>((d, h) =>
          supabase.from("professionals").select("id, name, is_active")
            .eq("tenant_id", tenantId).order("name").order("id").range(d, h),
        { contexto: "No se pudo cargar el equipo" }),
        traerTodo<CommissionRule>((d, h) =>
          supabase.from("commission_rules").select("id, professional_id, type, value")
            .eq("tenant_id", tenantId).order("id").range(d, h),
        { contexto: "No se pudieron cargar las reglas de comisión" }),
        rango ? traerTodo<CitaCom>((d, h) =>
          supabase.from("appointments")
            // Las ventas embebidas: lo cobrado de cada cita, sin un .in()
            // gigante que al fallar caía al precio de lista (CAL-05).
            .select("id, professional_id, appointment_date, status, pos_sales(total)")
            .eq("tenant_id", tenantId)
            .not("professional_id", "is", null)
            .gte("appointment_date", rango.desde)
            .lte("appointment_date", rango.hasta)
            .order("appointment_date").order("id").range(d, h),
        { contexto: "No se pudieron cargar las citas del periodo" }) : Promise.resolve([] as CitaCom[]),
        // Liquidaciones que se cruzan con el periodo (para no pagar dos veces).
        rango ? traerTodo<Pago>((d, h) =>
          supabase.from("commission_payments")
            .select("id, professional_id, period_start, period_end, commission_amount, appointments_count, revenue_total")
            .eq("tenant_id", tenantId)
            .lte("period_start", rango.hasta)
            .gte("period_end", rango.desde)
            .order("period_start").order("id").range(d, h),
        { contexto: "No se pudieron cargar las liquidaciones" }) : Promise.resolve([] as Pago[]),
      ]);
      if (!turno.vigente()) return;
      setPros(prosRows);
      setRules(rulesRows);
      setResumen(rango ? armarResumen(rango, hoyN, prosRows, rulesRows, citas, pagos) : null);
      setError(null);
      setCargado(true);
    } catch (e) {
      if (turno.vigente()) setError(e);
    }
  }, [tenantId, timezone, period, ref, custom?.desde, custom?.hasta], { timeZone: timezone, habilitado: !!tenantId && ready });

  // Historial: se carga al abrir la pestaña y al cambiar el filtro.
  const cargarHist = async (desde: number) => {
    if (!tenantId) return;
    const turno = guardHist.nuevo();
    setHistCargando(true);
    try {
      let q = supabase.from("commission_payments")
        .select("id, professional_id, period_start, period_end, appointments_count, revenue_total, commission_amount, paid_at, note, professionals(name)")
        .eq("tenant_id", tenantId);
      if (filtroPro) q = q.eq("professional_id", filtroPro);
      const filas = revisar(
        await q.order("paid_at", { ascending: false }).order("id").range(desde, desde + HIST_PAGINA - 1)
          .overrideTypes<HistRow[], { merge: false }>(),
        "No se pudo cargar el historial de liquidaciones",
      ) ?? [];
      if (!turno.vigente()) return;
      setHist(prev => (desde === 0 ? filas : [...prev, ...filas]));
      setHistMas(filas.length === HIST_PAGINA);
      setHistError(null);
    } catch (e) {
      if (turno.vigente()) setHistError(e);
    } finally {
      if (turno.vigente()) setHistCargando(false);
    }
  };
  const { recargar: recargarHist } = useRecarga(
    () => cargarHist(0),
    [tenantId, filtroPro],
    { timeZone: timezone, habilitado: !!tenantId && tab === 2, alCambiarSede: false },
  );

  const rango = rangoPara(hoy);
  const actual = rango ? rangoIncluyeHoy(rango) : false;
  const res = resumen && rango && resumen.clave === claveDe(rango) ? resumen : null;
  const activos = pros.filter(p => p.is_active !== false);

  const cambiarPeriodo = (p: Period) => {
    if (p === "custom") {
      // Precarga el rango que se está viendo, en días del negocio (antes era
      // toISOString: de noche proponía "mañana").
      const base = rango ?? rangoDePeriodo("semana", timezone, hoy);
      const pre = { desde: base.desde, hasta: base.hasta > hoy ? hoy : base.hasta };
      setCustomDraft(pre);
      setCustom(pre);
    }
    setPeriod(p);
    setRef(null);
  };

  const mover = (pasos: number) => {
    if (period === "custom" || !rango) return;
    const nueva = moverReferencia(period, rango.desde, pasos);
    setRef(rangoIncluyeHoy(rangoDePeriodo(period, timezone, nueva)) ? null : nueva);
  };

  const aplicarCustom = () => {
    const { desde, hasta } = customDraft;
    if (!esDia(desde) || !esDia(hasta)) {
      Alert.alert("Fecha inválida", "Escribe las fechas como AAAA-MM-DD, por ejemplo 2026-09-01.");
      return;
    }
    const [a, b] = desde <= hasta ? [desde, hasta] : [hasta, desde];
    if (diasEntre(a, b) > MAX_DIAS_RANGO) {
      Alert.alert("Rango muy largo", "El rango no puede pasar de un año.");
      return;
    }
    setCustom({ desde: a, hasta: b });
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await (tab === 2 ? recargarHist() : recargar());
    setRefreshing(false);
  };

  // ── Reglas ──────────────────────────────────────────────────────────────────

  const openEditRule = (pro: Professional) => {
    const existing = rules.find(r => r.professional_id === pro.id) ?? null;
    setEditPro(pro);
    setEditRule(existing);
    setRuleType(existing?.type === "fixed" ? "fixed" : "percentage");
    setRuleValue(existing ? String(existing.value) : "");
  };

  const leerValorRegla = (): number | null => {
    if (ruleType === "percentage") {
      const n = Number(ruleValue.replace(",", ".").replace(/[^\d.]/g, ""));
      return Number.isFinite(n) ? n : null;
    }
    return leerMonto(ruleValue);
  };

  const saveRule = async () => {
    if (!tenantId || !editPro || savingRule) return;
    const val = leerValorRegla();
    if (val === null || val <= 0) { Alert.alert("Valor inválido", "Ingresa un valor mayor a 0"); return; }
    if (ruleType === "percentage" && val > 100) { Alert.alert("Valor inválido", "El porcentaje no puede superar 100%"); return; }
    setSavingRule(true);
    try {
      exigirFilas(
        await supabase.from("commission_rules").upsert({
          tenant_id: tenantId,
          professional_id: editPro.id,
          type: ruleType,
          value: val,
        }, { onConflict: "tenant_id,professional_id" }).select("id"),
        "No se pudo guardar la regla",
      );
      setEditPro(null);
      await recargar();
    } catch (e) {
      Alert.alert("No se guardó la regla", mensajeError(e));
    } finally {
      setSavingRule(false);
    }
  };

  const deleteRule = (pro: Professional) => {
    if (!tenantId) return;
    Alert.alert("Eliminar regla", `¿Eliminar la regla de comisión de ${pro.name}? Sin regla, su comisión queda en $0.`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Eliminar", style: "destructive",
        onPress: async () => {
          try {
            exigirFilas(
              await supabase.from("commission_rules").delete()
                .eq("professional_id", pro.id).eq("tenant_id", tenantId).select("id"),
              "No se pudo eliminar la regla",
            );
          } catch (e) {
            Alert.alert("No se eliminó la regla", mensajeError(e));
          }
          await recargar();
        },
      },
    ]);
  };

  // ── Liquidar (DIN-15) ───────────────────────────────────────────────────────

  const openLiquidar = (sum: ProSummary) => {
    setLiquidar({ s: sum, tramos: sum.tramos.map(x => ({ ...x, id: nuevoId() })) });
    setLiquidarNote("");
  };

  const confirmLiquidar = async () => {
    if (!tenantId || !liquidar || !res || liqEnCurso.current) return;
    liqEnCurso.current = true;
    setSavingLiq(true);
    const { s: sum, tramos } = liquidar;
    // El MISMO rango que se mostró y calculó, no uno recalculado ahora.
    const r = res.rango;
    try {
      // Revisar contra el servidor: otro teléfono o el web pudo liquidar o
      // cobrar citas de este profesional mientras el modal estaba abierto.
      const [pagosRes, citasFrescas] = await Promise.all([
        supabase.from("commission_payments")
          .select("id, period_start, period_end")
          .eq("tenant_id", tenantId)
          .eq("professional_id", sum.pro.id)
          .lte("period_start", r.hasta)
          .gte("period_end", r.desde),
        traerTodo<CitaCom>((d, h) =>
          supabase.from("appointments")
            .select("id, professional_id, appointment_date, status, pos_sales(total)")
            .eq("tenant_id", tenantId)
            .eq("professional_id", sum.pro.id)
            .gte("appointment_date", r.desde)
            .lte("appointment_date", r.hasta)
            .order("appointment_date").order("id").range(d, h),
        { contexto: "No se pudieron revisar los cobros del periodo" }),
      ]);
      const frescos = (revisar(pagosRes, "No se pudo revisar si ya estaba liquidado") ?? []) as
        { id: string; period_start: string; period_end: string }[];
      const mios = new Set(tramos.map(x => x.id));
      // Reintento después de un corte: si nuestras filas ya están, se guardó.
      const yaGuardado = tramos.every(x => frescos.some(f => f.id === x.id));
      if (!yaGuardado) {
        const ajenos = frescos.filter(f => !mios.has(f.id));
        const vigentes = recortarHastaHoy(diasSinLiquidar(r.desde, r.hasta, ajenos), res.hoy)
          .map(x => ({ ...x, ...totalesEntre(citasFrescas, sum.rule, x.desde, x.hasta) }))
          .filter(x => x.citas > 0);
        if (firmaTramos(vigentes) !== firmaTramos(tramos)) {
          setLiquidar(null);
          Alert.alert("La liquidación cambió", `Mientras tanto se registró un cobro o una liquidación de ${sum.pro.name}. Revisa el resumen antes de pagar.`);
          await recargar();
          return;
        }
        const paidAt = new Date().toISOString();
        const filas = tramos.filter(x => !frescos.some(f => f.id === x.id)).map(x => ({
          id: x.id,
          tenant_id: tenantId,
          professional_id: sum.pro.id,
          period_start: x.desde,
          period_end: x.hasta,
          appointments_count: x.citas,
          revenue_total: x.ingresos,
          commission_amount: x.comision,
          paid_at: paidAt,
          note: liquidarNote.trim() || null,
        }));
        const ins = await supabase.from("commission_payments").insert(filas).select("id");
        // 23505 = ya existía una fila con ese id: un reintento que sí se guardó.
        if (ins.error && (ins.error as { code?: string }).code !== "23505") {
          throw new ErrorDB(ins.error, "No se pudo registrar la liquidación");
        }
        if (!ins.error && (ins.data ?? []).length === 0) {
          throw new ErrorDB({ code: "SIN_FILAS", message: "" }, "No se pudo registrar la liquidación");
        }
      }
      setLiquidar(null);
      Alert.alert("Liquidado", `Comisión de ${sum.pro.name} registrada: ${fmtMoneyFull(sumaTotales(tramos).comision)}.`);
      await recargar();
      if (tab === 2) await recargarHist();
    } catch (e) {
      // El modal queda abierto con los mismos ids: reintentar no duplica.
      Alert.alert("No se registró la liquidación", mensajeError(e));
    } finally {
      liqEnCurso.current = false;
      setSavingLiq(false);
    }
  };

  // ── Render tabs ─────────────────────────────────────────────────────────────

  const summaries = res?.summaries ?? [];
  const totalComisiones = summaries.reduce((a, x) => a + x.total.comision, 0);
  const totalPendiente  = summaries.reduce((a, x) => a + (x.rule ? x.pendiente.comision : 0), 0);
  const totalRevenue    = summaries.reduce((a, x) => a + x.total.ingresos, 0);
  const prosConRegla    = summaries.filter(x => x.rule !== null).length;

  // Ingresos por día del periodo (semana/mes), sobre las citas cobradas.
  const grafica = useMemo(() => {
    if (!res || res.rango.periodo === "personalizado") return null;
    const dias = listaDeDias(res.rango.desde, res.rango.hasta);
    const todas = Object.values(res.citasPorPro).flat().filter(estaCobrada);
    const valores = dias.map(d => todas.filter(c => c.appointment_date === d).reduce((a, c) => a + cobradoDe(c), 0));
    const etiquetas = dias.map((d, i) => res.rango.periodo === "semana" ? ["L", "M", "X", "J", "V", "S", "D"][i] ?? "" : String(Number(d.slice(8, 10))));
    return { valores, etiquetas };
  }, [res]);

  const renderResumen = () => (
    <ScrollView
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={{ padding: 20, paddingBottom: 110 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.red} />}
    >
      <SegmentedControl<Period>
        options={[
          { value: "semana", label: "Semana" },
          { value: "mes", label: "Mes" },
          { value: "custom", label: "Rango" },
        ]}
        value={period}
        onChange={cambiarPeriodo}
      />

      {period === "custom" ? (
        <Animated.View entering={FadeInDown.duration(300)} style={s.customRow}>
          <TextInput
            style={[s.dateInput, { flex: 1 }]}
            placeholder="Inicio (AAAA-MM-DD)"
            placeholderTextColor={t.subtle}
            value={customDraft.desde}
            onChangeText={v => setCustomDraft(c => ({ ...c, desde: v }))}
            autoCapitalize="none"
            keyboardType="numbers-and-punctuation"
            accessibilityLabel="Fecha de inicio"
          />
          <Text style={{ color: t.muted, fontFamily: Fonts.regular }}>→</Text>
          <TextInput
            style={[s.dateInput, { flex: 1 }]}
            placeholder="Fin (AAAA-MM-DD)"
            placeholderTextColor={t.subtle}
            value={customDraft.hasta}
            onChangeText={v => setCustomDraft(c => ({ ...c, hasta: v }))}
            autoCapitalize="none"
            keyboardType="numbers-and-punctuation"
            accessibilityLabel="Fecha de fin"
          />
          <TouchableOpacity style={s.applyBtn} onPress={aplicarCustom} accessibilityRole="button">
            <Text style={s.applyTxt}>Ver</Text>
          </TouchableOpacity>
        </Animated.View>
      ) : (
        <View style={s.navRow}>
          <IconButton icon="chevron-back" label="Periodo anterior" onPress={() => mover(-1)} />
          <TouchableOpacity
            style={{ flex: 1, alignItems: "center" }}
            onPress={() => setRef(null)}
            disabled={actual}
            accessibilityRole="button"
            accessibilityLabel={rango ? etiquetaRango(rango) : ""}
          >
            <Text style={s.navLabel}>{rango ? etiquetaRango(rango) : ""}</Text>
            {!actual ? <Text style={s.navHint}>Volver a hoy</Text> : null}
          </TouchableOpacity>
          <IconButton icon="chevron-forward" label="Periodo siguiente" onPress={() => mover(1)} disabled={actual} />
        </View>
      )}

      {period === "custom" && rango ? <Text style={s.rangeLabel}>{etiquetaRango(rango)}</Text> : null}
      <Text style={s.scopeLabel}>Todas las sedes · solo citas cobradas</Text>

      {period === "custom" && !rango ? (
        <View style={s.emptyBox}>
          <Ionicons name="calendar-outline" size={36} color={t.subtle} />
          <Text style={s.emptyTxt}>Escribe las dos fechas y toca «Ver».</Text>
        </View>
      ) : error && !res ? (
        <ErrorState error={error} onRetry={recargar} />
      ) : !res ? (
        <ActivityIndicator color={Colors.red} style={{ marginTop: 32 }} />
      ) : (
        <>
          {error ? (
            <TouchableOpacity onPress={recargar} style={s.staleBanner} accessibilityRole="button">
              <Ionicons name="alert-circle-outline" size={16} color={Colors.red} />
              <Text style={s.staleText} numberOfLines={2}>No se pudo actualizar: {mensajeError(error)}</Text>
              <Text style={s.staleRetry}>Reintentar</Text>
            </TouchableOpacity>
          ) : null}

          {/* KPIs */}
          <View style={s.kpiRow}>
            <KpiCard label="Comisiones del período" value={fmtMoneyFull(totalComisiones)} icon="cash-outline" color={Colors.success} />
            <KpiCard label="Por liquidar" value={fmtMoneyFull(totalPendiente)} icon="hourglass-outline" color="#f59e0b" />
            <KpiCard label="Cobrado" value={fmtMoneyFull(totalRevenue)} icon="trending-up-outline" color={Colors.blue} />
          </View>
          <Text style={s.hintSmall}>{prosConRegla}/{summaries.length} profesionales con regla configurada.</Text>

          {grafica && grafica.valores.some(v => v > 0) && (
            <View style={[s.tableCard, Shadow.sm, { padding: 14 }]}>
              <Text style={s.chartTitle}>Cobrado en el período</Text>
              <Text style={s.chartValue}>{fmtMoneyFull(totalRevenue)}</Text>
              <MiniBar data={grafica.valores} color={Colors.blue} />
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
                {grafica.etiquetas.filter((_, i) => grafica.etiquetas.length <= 14 || i % Math.ceil(grafica.etiquetas.length / 7) === 0).map((l, i) => (
                  <Text key={i} style={s.chartLabel}>{l}</Text>
                ))}
              </View>
            </View>
          )}

          {/* Tabla por profesional */}
          {summaries.length === 0 ? (
            <View style={s.emptyBox}>
              <Ionicons name="receipt-outline" size={36} color={t.subtle} />
              <Text style={s.emptyTxt}>Sin profesionales activos</Text>
            </View>
          ) : (
            <View style={[s.tableCard, Shadow.sm]}>
              <View style={s.tableHeader}>
                <Text style={[s.thTxt, { flex: 2 }]}>Profesional</Text>
                <Text style={[s.thTxt, { flex: 1, textAlign: "right" }]}>Cobrado</Text>
                <Text style={[s.thTxt, { flex: 1, textAlign: "right" }]}>Comisión</Text>
                <Text style={[s.thTxt, { width: 74 }]} />
              </View>
              {summaries.map((sum, i) => {
                const detalle = [
                  `${sum.total.citas} cita${sum.total.citas !== 1 ? "s" : ""}`,
                  sum.pagado > 0 ? `liquidado ${fmtMoneyFull(sum.pagado)}` : null,
                  sum.tarde.ingresos > 0
                    ? `${fmtMoneyFull(sum.tarde.ingresos)} cobrado después de liquidar`
                    : sum.tarde.citas > 0 ? `${sum.tarde.citas} cobro${sum.tarde.citas !== 1 ? "s" : ""} después de liquidar` : null,
                  sum.sinCobro > 0 ? `${sum.sinCobro} sin cobro` : null,
                  sum.pro.is_active === false ? "inactivo" : null,
                ].filter(Boolean).join(" · ");
                return (
                  <View key={sum.pro.id}>
                    {i > 0 && <View style={s.divider} />}
                    <View style={s.tableRow}>
                      <View style={{ flex: 2, flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 }}>
                        <Avatar pro={sum.pro} />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={s.proName} numberOfLines={1}>{sum.pro.name}</Text>
                          <Text style={s.proCitas} numberOfLines={2}>{detalle}</Text>
                        </View>
                      </View>
                      <Text style={[s.cellTxt, { flex: 1, textAlign: "right" }]}>{fmtMoneyFull(sum.total.ingresos)}</Text>
                      <Text style={[s.cellTxtBold, { flex: 1, textAlign: "right", color: Colors.success }]}>
                        {fmtMoneyFull(sum.total.comision)}
                      </Text>
                      <View style={{ width: 74, alignItems: "flex-end" }}>
                        {!sum.rule ? (
                          <Text style={s.muted11}>Sin regla</Text>
                        ) : sum.pendiente.citas > 0 ? (
                          <TouchableOpacity style={s.liqBtn} onPress={() => openLiquidar(sum)} accessibilityRole="button" accessibilityLabel={`Liquidar a ${sum.pro.name}`}>
                            <Text style={s.liqBtnTxt}>Liquidar</Text>
                          </TouchableOpacity>
                        ) : sum.tarde.citas > 0 || sum.tarde.ingresos > 0 ? (
                          <Text style={s.reviewTxt}>Revisar</Text>
                        ) : sum.futuras > 0 ? (
                          // Solo hay cobros de días que aún no llegan: no está liquidado.
                          <Text style={s.muted11}>Pendiente</Text>
                        ) : sum.total.citas > 0 ? (
                          <View style={s.paidChip}>
                            <Ionicons name="checkmark" size={11} color={Colors.success} />
                            <Text style={s.paidChipTxt}>Liquidado</Text>
                          </View>
                        ) : (
                          <Text style={s.muted11}>—</Text>
                        )}
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
          {summaries.some(x => x.sinCobro > 0) ? (
            <Text style={s.hintSmall}>
              Las citas marcadas como completadas sin cobro no generan comisión hasta que se cobren.
            </Text>
          ) : null}
          {summaries.some(x => x.tarde.citas > 0 || x.tarde.ingresos > 0) ? (
            <Text style={[s.hintSmall, { color: "#d97706" }]}>
              «Revisar»: hay cobros de días que ya estaban liquidados y no entraron en esa liquidación. La app no vuelve a liquidar esos días para no pagarlos dos veces; acuerda la diferencia con el profesional.
            </Text>
          ) : null}
        </>
      )}
    </ScrollView>
  );

  const renderReglas = () => (
    <ScrollView
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={{ padding: 20, paddingBottom: 110 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.red} />}
    >
      <Text style={s.hint}>
        Define cómo se calcula la comisión de cada profesional sobre lo cobrado. Sin regla → comisión $0.
      </Text>
      {error && !cargado ? (
        <ErrorState error={error} onRetry={recargar} />
      ) : !cargado ? (
        <ActivityIndicator color={Colors.red} style={{ marginTop: 32 }} />
      ) : activos.length === 0 ? (
        <View style={s.emptyBox}>
          <Ionicons name="people-outline" size={36} color={t.subtle} />
          <Text style={s.emptyTxt}>Sin profesionales activos</Text>
        </View>
      ) : (
        <View style={[s.tableCard, Shadow.sm]}>
          {activos.map((pro, i) => {
            const rule = rules.find(r => r.professional_id === pro.id) ?? null;
            return (
              <View key={pro.id}>
                {i > 0 && <View style={s.divider} />}
                <View style={s.ruleRow}>
                  <Avatar pro={pro} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.proName}>{pro.name}</Text>
                    {rule ? (
                      <Text style={s.ruleBadge}>{describirRegla(rule, fmtMoneyFull)}</Text>
                    ) : (
                      <Text style={[s.ruleBadge, { color: t.subtle }]}>Sin regla</Text>
                    )}
                  </View>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <IconButton icon="pencil-outline" label={`Editar regla de ${pro.name}`} onPress={() => openEditRule(pro)} color={Colors.blue} size={14} />
                    {rule && (
                      <IconButton icon="trash-outline" label={`Eliminar regla de ${pro.name}`} onPress={() => deleteRule(pro)} color={Colors.red} size={14} />
                    )}
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );

  const renderHistorial = () => (
    <View style={{ flex: 1 }}>
      {pros.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 10, gap: 8, flexDirection: "row" }}
          style={s.filterBar}
        >
          <TouchableOpacity
            onPress={() => setFiltroPro(null)}
            style={[s.filterChip, filtroPro === null && s.filterChipActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: filtroPro === null }}
          >
            <Text style={[s.filterChipTxt, filtroPro === null && s.filterChipTxtActive]}>Todos</Text>
          </TouchableOpacity>
          {pros.map(pro => (
            <TouchableOpacity
              key={pro.id}
              onPress={() => setFiltroPro(prev => (prev === pro.id ? null : pro.id))}
              style={[s.filterChip, filtroPro === pro.id && s.filterChipActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: filtroPro === pro.id }}
            >
              <Text style={[s.filterChipTxt, filtroPro === pro.id && s.filterChipTxtActive]}>
                {pro.name.split(" ")[0]}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
      {histError && hist.length === 0 ? (
        <ErrorState error={histError} onRetry={recargarHist} />
      ) : histCargando && hist.length === 0 ? (
        <ActivityIndicator color={Colors.red} style={{ marginTop: 32 }} />
      ) : hist.length === 0 ? (
        <View style={[s.emptyBox, { marginTop: 40 }]}>
          <Ionicons name="document-text-outline" size={36} color={t.subtle} />
          <Text style={s.emptyTxt}>Sin liquidaciones registradas</Text>
        </View>
      ) : (
        <FlatList
          data={hist}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: 20, paddingBottom: 110 }}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.red} />}
          ListFooterComponent={histMas ? (
            <TouchableOpacity
              style={s.moreBtn}
              onPress={() => cargarHist(hist.length)}
              disabled={histCargando}
              accessibilityRole="button"
            >
              {histCargando
                ? <ActivityIndicator color={Colors.red} size="small" />
                : <Text style={s.moreTxt}>Ver más</Text>}
            </TouchableOpacity>
          ) : histError ? (
            <Text style={[s.hintSmall, { textAlign: "center", marginTop: 12 }]}>{mensajeError(histError)}</Text>
          ) : null}
          renderItem={({ item }) => {
            const nombre = item.professionals?.name ?? "—";
            return (
              <View style={[s.payCard, Shadow.sm]}>
                <View style={s.payHeader}>
                  <Avatar pro={{ id: item.professional_id, name: nombre }} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.proName}>{nombre}</Text>
                    {/* Días de calendario: sin parsearlos como UTC (salían un día antes: DIN-16). */}
                    <Text style={s.proCitas}>{etiquetaRango(rangoPersonalizado(item.period_start, item.period_end, timezone))}</Text>
                  </View>
                  <Text style={s.payAmount}>{fmtMoneyFull(item.commission_amount)}</Text>
                </View>
                <View style={s.payDetails}>
                  <Text style={s.payDetailTxt}>{item.appointments_count} citas · {fmtMoneyFull(item.revenue_total)} cobrados</Text>
                  {item.note ? <Text style={[s.payDetailTxt, { color: t.muted }]}>{item.note}</Text> : null}
                  {item.paid_at ? (
                    <Text style={[s.payDetailTxt, { color: Colors.success }]}>
                      Pagado el {fmtDia(diaLocalDe(item.paid_at, timezone), "corto")}
                    </Text>
                  ) : null}
                </View>
              </View>
            );
          }}
        />
      )}
    </View>
  );

  const liq = liquidar;
  const liqTotal = liq ? sumaTotales(liq.tramos) : null;
  const incluyeHoy = liq ? liq.tramos.some(x => x.hasta === res?.hoy) : false;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader crumb="Dinero" title="Comisiones" subtitle="Gestiona pagos a tu equipo" onBack={() => router.back()} />

      {/* Tab bar */}
      <View style={s.tabBar} accessibilityRole="tablist">
        {["Resumen", "Reglas", "Historial"].map((label, i) => (
          <TouchableOpacity
            key={i}
            style={s.tabItem}
            onPress={() => setTab(i)}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === i }}
          >
            <Text style={[s.tabTxt, tab === i && s.tabTxtActive]}>{label}</Text>
            {tab === i && <View style={s.tabUnderline} />}
          </TouchableOpacity>
        ))}
      </View>

      {tab === 0 && renderResumen()}
      {tab === 1 && renderReglas()}
      {tab === 2 && renderHistorial()}

      {/* Modal de regla */}
      <Modal visible={!!editPro} animationType="slide" transparent onRequestClose={() => setEditPro(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={s.overlay}>
          <View style={s.sheet}>
            <View style={s.handle} />
            <Text style={s.sheetTitle}>
              {editRule ? "Editar regla" : "Configurar regla"} — {editPro?.name}
            </Text>

            <Text style={s.label}>Tipo de comisión</Text>
            <View style={s.typeRow}>
              {(["percentage", "fixed"] as const).map((tipo) => (
                <TouchableOpacity
                  key={tipo}
                  style={[s.typeBtn, ruleType === tipo && s.typeBtnActive]}
                  onPress={() => setRuleType(tipo)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: ruleType === tipo }}
                >
                  <Ionicons
                    name={tipo === "percentage" ? "pricetag-outline" : "cash-outline"}
                    size={16}
                    color={ruleType === tipo ? "white" : t.muted}
                  />
                  <Text style={[s.typeTxt, ruleType === tipo && s.typeTxtActive]}>
                    {tipo === "percentage" ? "% de lo cobrado" : "Fijo por cita"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={s.label}>{ruleType === "percentage" ? "Porcentaje (%)" : "Monto por cita ($)"}</Text>
            <TextInput
              style={s.input}
              keyboardType="decimal-pad"
              placeholder={ruleType === "percentage" ? "Ej: 10" : "Ej: 20000"}
              placeholderTextColor={t.subtle}
              value={ruleValue}
              onChangeText={setRuleValue}
            />

            {(() => {
              const v = leerValorRegla();
              if (v === null || v <= 0) return null;
              return (
                <View style={s.preview}>
                  <Ionicons name="information-circle-outline" size={14} color={Colors.blue} />
                  <Text style={s.previewTxt}>
                    {ruleType === "percentage"
                      ? `Por $100.000 cobrados → comisión de ${fmtMoneyFull(calcularComision({ type: "percentage", value: v }, 100000, 0))}`
                      : `Por 10 citas cobradas → comisión de ${fmtMoneyFull(calcularComision({ type: "fixed", value: v }, 0, 10))}`}
                  </Text>
                </View>
              );
            })()}

            <View style={s.actions}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setEditPro(null)} accessibilityRole="button">
                <Text style={s.cancelTxt}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.saveBtn} onPress={saveRule} disabled={savingRule} accessibilityRole="button">
                {savingRule
                  ? <ActivityIndicator color="white" size="small" />
                  : <Text style={s.saveTxt}>Guardar</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Modal de liquidación */}
      <Modal visible={!!liq} animationType="slide" transparent onRequestClose={() => { if (!savingLiq) setLiquidar(null); }}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={s.overlay}>
          <View style={s.sheet}>
            <View style={s.handle} />
            <Text style={s.sheetTitle}>Liquidar comisión</Text>

            {liq && liqTotal && (
              <>
                <View style={s.liqSummary}>
                  <View style={{ alignSelf: "center" }}><Avatar pro={liq.s.pro} /></View>
                  <Text style={s.liqProName}>{liq.s.pro.name}</Text>
                  <Text style={s.liqPeriod}>
                    {liq.tramos.map(x => etiquetaRango(rangoPersonalizado(x.desde, x.hasta, timezone))).join(" · ")}
                  </Text>

                  <View style={s.liqGrid}>
                    <View style={s.liqCell}>
                      <Text style={s.liqCellVal}>{liqTotal.citas}</Text>
                      <Text style={s.liqCellLbl}>Citas</Text>
                    </View>
                    <View style={s.liqCell}>
                      <Text style={s.liqCellVal}>{fmtMoneyFull(liqTotal.ingresos)}</Text>
                      <Text style={s.liqCellLbl}>Cobrado</Text>
                    </View>
                    <View style={s.liqCell}>
                      <Text style={[s.liqCellVal, { color: Colors.success }]}>{fmtMoneyFull(liqTotal.comision)}</Text>
                      <Text style={s.liqCellLbl}>Comisión</Text>
                    </View>
                  </View>

                  {liq.s.rule && (
                    <View style={s.rulePill}>
                      <Ionicons name="checkmark-circle-outline" size={13} color={Colors.success} />
                      <Text style={s.rulePillTxt}>Regla: {describirRegla(liq.s.rule, fmtMoneyFull)}</Text>
                    </View>
                  )}
                </View>

                {liq.s.pagos.length > 0 ? (
                  <View style={s.notice}>
                    <Ionicons name="information-circle-outline" size={14} color={Colors.blue} />
                    <Text style={s.noticeTxt}>
                      Ya liquidaste {fmtMoneyFull(liq.s.pagado)} de este periodo
                      ({liq.s.pagos.map(p => etiquetaRango(rangoPersonalizado(p.period_start, p.period_end, timezone))).join(", ")}).
                      Esos días no se vuelven a pagar.
                    </Text>
                  </View>
                ) : null}
                {incluyeHoy ? (
                  <View style={[s.notice, { backgroundColor: "rgba(245,158,11,0.12)" }]}>
                    <Ionicons name="time-outline" size={14} color="#d97706" />
                    <Text style={[s.noticeTxt, { color: "#b45309" }]}>
                      Incluye hoy: los cobros que se hagan más tarde no entrarán en esta liquidación.
                    </Text>
                  </View>
                ) : null}

                <Text style={s.label}>Nota (opcional)</Text>
                <TextInput
                  style={s.input}
                  placeholder="Ej: Pago en efectivo, transferencia..."
                  placeholderTextColor={t.subtle}
                  value={liquidarNote}
                  onChangeText={setLiquidarNote}
                />

                <View style={s.actions}>
                  <TouchableOpacity style={s.cancelBtn} onPress={() => setLiquidar(null)} disabled={savingLiq} accessibilityRole="button">
                    <Text style={s.cancelTxt}>Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.saveBtn, savingLiq && { opacity: 0.7 }]} onPress={confirmLiquidar} disabled={savingLiq} accessibilityRole="button">
                    {savingLiq
                      ? <ActivityIndicator color="white" size="small" />
                      : <Text style={s.saveTxt}>Confirmar pago</Text>}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
// Con los tokens del tema: los Colors.white/text/cream2 fijos dejaban tarjetas
// blancas y textos oscuros invisibles en modo oscuro (D17).

function crearEstilos(t: ThemeColors) {
  return StyleSheet.create({
    tabBar:       { flexDirection: "row", backgroundColor: t.cardSolid, borderBottomWidth: 1, borderBottomColor: t.line },
    tabItem:      { flex: 1, alignItems: "center", paddingVertical: 12 },
    tabTxt:       { fontSize: 13, fontFamily: Fonts.semibold, color: t.muted },
    tabTxtActive: { color: Colors.red, fontFamily: Fonts.bold },
    tabUnderline: { position: "absolute", bottom: 0, left: 12, right: 12, height: 2, backgroundColor: Colors.red, borderRadius: 1 },

    navRow:     { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12 },
    navLabel:   { fontSize: 14, fontFamily: Fonts.semibold, color: t.ink, textTransform: "capitalize" },
    navHint:    { fontSize: 11, fontFamily: Fonts.semibold, color: Colors.red, marginTop: 1 },
    customRow:  { flexDirection: "row", gap: 8, alignItems: "center", marginTop: 12 },
    dateInput:  { backgroundColor: t.inputBg, borderRadius: Radius.md, padding: 10, fontSize: 13, fontFamily: Fonts.regular, color: t.text, borderWidth: 1, borderColor: t.inputBorder },
    applyBtn:   { backgroundColor: Colors.red, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 11 },
    applyTxt:   { fontSize: 13, fontFamily: Fonts.bold, color: "white" },
    rangeLabel: { fontSize: 12, fontFamily: Fonts.semibold, color: t.muted, marginTop: 10, textAlign: "center" },
    scopeLabel: { fontSize: 11, fontFamily: Fonts.regular, color: t.subtle, marginTop: 8, marginBottom: 14, textAlign: "center" },

    staleBanner: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: "rgba(251,15,5,0.32)", backgroundColor: t.cardSolid, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, marginBottom: 14 },
    staleText:   { flex: 1, fontSize: 12, fontFamily: Fonts.regular, color: t.ink },
    staleRetry:  { fontSize: 12, fontFamily: Fonts.bold, color: Colors.red },

    kpiRow:    { flexDirection: "row", gap: 10, marginBottom: 8 },
    hintSmall: { fontSize: 11, fontFamily: Fonts.regular, color: t.subtle, marginBottom: 16, lineHeight: 16 },

    chartTitle: { fontSize: 12, fontFamily: Fonts.semibold, color: t.muted, marginBottom: 2 },
    chartValue: { fontSize: 18, fontFamily: Fonts.bold, color: t.text, letterSpacing: -0.5 },
    chartLabel: { fontSize: 8, fontFamily: Fonts.regular, color: t.subtle },

    tableCard:   { backgroundColor: t.cardSolid, borderWidth: 1, borderColor: t.line, borderRadius: Radius.lg, overflow: "hidden", marginBottom: 16 },
    tableHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, backgroundColor: t.chipBg },
    thTxt:       { fontSize: 11, fontFamily: Fonts.mono, color: t.subtle, textTransform: "uppercase", letterSpacing: 0.5 },
    tableRow:    { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
    divider:     { height: 1, backgroundColor: t.line, marginHorizontal: 16 },

    proName:  { fontSize: 13, fontFamily: Fonts.semibold, color: t.text },
    proCitas: { fontSize: 11, fontFamily: Fonts.regular, color: t.muted },
    muted11:  { fontSize: 11, color: t.subtle, fontFamily: Fonts.regular },

    cellTxt:     { fontSize: 13, fontFamily: Fonts.regular, color: t.text },
    cellTxtBold: { fontSize: 13, fontFamily: Fonts.bold, color: t.text },

    liqBtn:      { backgroundColor: Colors.success + "18", paddingVertical: 5, paddingHorizontal: 8, borderRadius: Radius.sm },
    liqBtnTxt:   { fontSize: 11, fontFamily: Fonts.bold, color: Colors.success },
    paidChip:    { flexDirection: "row", alignItems: "center", gap: 3 },
    paidChipTxt: { fontSize: 10.5, fontFamily: Fonts.semibold, color: Colors.success },
    reviewTxt:   { fontSize: 11, fontFamily: Fonts.semibold, color: "#d97706" },

    ruleRow:   { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
    ruleBadge: { fontSize: 12, fontFamily: Fonts.regular, color: Colors.blue, marginTop: 2 },

    hint: { fontSize: 12, fontFamily: Fonts.regular, color: t.muted, marginBottom: 16, lineHeight: 18 },

    filterBar:           { backgroundColor: t.cardSolid, borderBottomWidth: 1, borderBottomColor: t.line, maxHeight: 52 },
    filterChip:          { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, backgroundColor: t.chipBg, borderWidth: 1, borderColor: t.line },
    filterChipActive:    { backgroundColor: t.ink, borderColor: t.ink },
    filterChipTxt:       { fontSize: 12, fontFamily: Fonts.semibold, color: t.muted },
    filterChipTxtActive: { color: t.cardSolid },

    payCard:      { backgroundColor: t.cardSolid, borderWidth: 1, borderColor: t.line, borderRadius: Radius.lg, padding: 16 },
    payHeader:    { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
    payAmount:    { fontSize: 16, fontFamily: Fonts.bold, color: Colors.success },
    payDetails:   { gap: 4, borderTopWidth: 1, borderTopColor: t.line, paddingTop: 10 },
    payDetailTxt: { fontSize: 12, fontFamily: Fonts.regular, color: t.subtle },
    moreBtn:      { alignItems: "center", paddingVertical: 14 },
    moreTxt:      { fontSize: 13, fontFamily: Fonts.bold, color: Colors.red },

    emptyBox: { alignItems: "center", justifyContent: "center", gap: 12, paddingVertical: 40 },
    emptyTxt: { fontSize: 14, fontFamily: Fonts.regular, color: t.muted, textAlign: "center" },

    // Modales
    overlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
    sheet:      { backgroundColor: t.cardSolid, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, gap: 16 },
    handle:     { width: 40, height: 4, backgroundColor: t.lineStrong, borderRadius: 2, alignSelf: "center", marginBottom: 8 },
    sheetTitle: { fontSize: 18, fontFamily: Fonts.bold, color: t.text },
    label:      { fontSize: 12, fontFamily: Fonts.mono, color: t.muted, textTransform: "uppercase", letterSpacing: 0.5 },
    input:      { backgroundColor: t.inputBg, borderRadius: Radius.md, padding: 14, fontSize: 14, fontFamily: Fonts.regular, color: t.text, borderWidth: 1, borderColor: t.inputBorder },
    typeRow:    { flexDirection: "row", gap: 10 },
    typeBtn:    { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: Radius.md, backgroundColor: t.chipBg, borderWidth: 1, borderColor: t.line },
    typeBtnActive: { backgroundColor: Colors.blue, borderColor: Colors.blue },
    typeTxt:    { fontSize: 13, fontFamily: Fonts.semibold, color: t.muted },
    typeTxtActive: { color: "white", fontFamily: Fonts.bold },
    preview:    { flexDirection: "row", gap: 8, alignItems: "center", backgroundColor: Colors.blue + "14", padding: 12, borderRadius: Radius.md },
    previewTxt: { fontSize: 12, fontFamily: Fonts.regular, color: t.text, flex: 1 },
    actions:    { flexDirection: "row", gap: 12 },
    cancelBtn:  { flex: 1, padding: 14, borderRadius: Radius.md, borderWidth: 1, borderColor: t.line, alignItems: "center" },
    cancelTxt:  { fontSize: 14, fontFamily: Fonts.semibold, color: t.muted },
    saveBtn:    { flex: 1, padding: 14, borderRadius: Radius.md, backgroundColor: Colors.red, alignItems: "center" },
    saveTxt:    { fontSize: 14, fontFamily: Fonts.bold, color: "white" },

    liqSummary:  { backgroundColor: t.chipBg, borderRadius: Radius.lg, padding: 16, alignItems: "center", gap: 8 },
    liqProName:  { fontSize: 16, fontFamily: Fonts.bold, color: t.text },
    liqPeriod:   { fontSize: 12, fontFamily: Fonts.regular, color: t.muted, textAlign: "center" },
    liqGrid:     { flexDirection: "row", width: "100%", marginTop: 8 },
    liqCell:     { flex: 1, alignItems: "center", gap: 4 },
    liqCellVal:  { fontSize: 15, fontFamily: Fonts.bold, color: t.text },
    liqCellLbl:  { fontSize: 11, fontFamily: Fonts.regular, color: t.muted },
    rulePill:    { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: Colors.success + "14", paddingVertical: 6, paddingHorizontal: 12, borderRadius: Radius.full, marginTop: 4 },
    rulePillTxt: { fontSize: 12, fontFamily: Fonts.semibold, color: Colors.success },
    notice:      { flexDirection: "row", gap: 8, alignItems: "flex-start", backgroundColor: Colors.blue + "12", padding: 12, borderRadius: Radius.md },
    noticeTxt:   { flex: 1, fontSize: 12, fontFamily: Fonts.regular, color: t.text, lineHeight: 17 },
  });
}
