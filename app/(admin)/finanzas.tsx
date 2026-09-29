import { useMemo, useState, type ReactNode } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl,
} from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Fonts, Gradients, MonoLabel, Radius, Shadow } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import {
  diaLocalDe, horaLocalDe, hoyNegocio, sumarDias, listaDeDias, diaDeSemana,
  rangoPersonalizado, fmtDia, esHoy,
} from "@/lib/tz";
import { supabase } from "@/lib/supabase";
import { fmtMoneyFull, fmt12 } from "@/lib/format";
import { mensajeError, revisar, traerTodo, traerTodoDetalle } from "@/lib/db";
import { useRecarga, useGuardRespuestas } from "@/lib/useRecarga";
import { findOpenCashSession } from "@/lib/record-sale";
import { incluyeCajaGeneral } from "@/lib/sedes";
import { getActiveLocationId } from "@/lib/active-location";
import { type PaymentLine } from "@/lib/pos-payments";
import { desglosePorMedio, lineasDePago, montoDe } from "@/lib/ingresos";
import { agruparPorItem, nombreItem, totalesCaja, type TotalesCaja } from "@/lib/dinero";
import { PAY_METHODS, methodCfg } from "@/components/ChargeSheet";
import { SegmentedControl } from "@/components/ui";
import ErrorState from "@/components/ErrorState";
import { cargarListaSedes, nombreCorto, nombreSede, TODAS_LAS_SEDES, type SedeLite } from "@/components/SedeChip";

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = "resumen" | "caja" | "ventas" | "reportes" | "rentabilidad";
type Periodo = "7" | "30" | "90";
/** "sede": solo la sede activa (como el Panel y Reportes). "todas": el negocio entero (como el Finanzas web). */
type Alcance = "sede" | "todas";

/** La columna es `price` (DIN-01): `unit_price` no existe y tumbaba toda la consulta. */
interface SaleItem {
  quantity: number;
  price: number;
  name: string | null;
  item_type: string | null;
  services: { name: string } | null;
}

interface Sale {
  id: string;
  total: number;
  payment_method: string;
  /** Reparto real cuando el cobro se dividió en varios métodos (null = uno solo). */
  payments: PaymentLine[] | null;
  created_at: string;
  client_id: string | null;
  location_id: string | null;
  clients: { name: string } | null;
  pos_sale_items: SaleItem[];
}

interface CashSession {
  id: string;
  opened_at: string;
  opening_amount: number;
  closing_amount: number | null;
}

interface CashMovement {
  id: string;
  type: "ingreso" | "egreso";
  amount: number;
  description: string;
  created_at: string;
  payment_method: string | null;
}

type Datos = {
  /**
   * Período con el que se cargaron `ventas`. Las etiquetas salen de aquí y no
   * del filtro elegido: mientras recarga (o si la recarga falla) los números
   * siguen siendo del período anterior y el rótulo no debe mentir.
   */
  periodo: Periodo;
  /** Ventas del período elegido (días del negocio, hoy incluido), de TODAS las sedes. */
  ventas: Sale[];
  /** Ventas de los últimos DIAS_GRAFICO días, para el gráfico diario (todas las sedes). */
  ventasGrafico: Sale[];
  truncado: boolean;
  /** Caja abierta de la sede ACTIVA: una caja es un cajón físico, nunca "todas". */
  session: CashSession | null;
  movements: CashMovement[];
  /** Sede activa y sedes del negocio con las que se cargó (para filtrar y rotular). */
  sedeActiva: string | null;
  sedes: SedeLite[];
};

/** Datos ya filtrados por el alcance elegido, más el rótulo de la sede. */
type Vista = Datos & {
  /** Nombre de la sede activa (null = el negocio tiene una sola sede o ninguna). */
  sede: string | null;
  /** Qué se está sumando: la sede, "Todas las sedes" o null (no hace falta decirlo). */
  alcanceLabel: string | null;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string }[] = [
  { id: "resumen",      label: "Resumen"      },
  { id: "caja",         label: "Caja"         },
  { id: "ventas",       label: "Ventas"       },
  { id: "reportes",     label: "Reportes"     },
  { id: "rentabilidad", label: "Rentabilidad" },
];

const DIAS_GRAFICO = 12;
const MOVS_VISIBLES = 100;
const LETRAS_DIA = ["L", "M", "M", "J", "V", "S", "D"];

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = fmtMoneyFull;

function colorMetodo(pm: string, fallback: string): string {
  return methodCfg(pm)?.color ?? fallback;
}

function etiquetaMetodo(pm: string): string {
  return methodCfg(pm)?.label ?? (pm.charAt(0).toUpperCase() + pm.slice(1));
}

/**
 * "hoy 8:00 PM" / "ayer 8:00 PM" / "24 sep 8:00 PM" por día del negocio (TZ-08).
 * Antes era por diferencia de 24 h: un cobro de anoche consultado en la
 * mañana salía como "hoy".
 */
function fmtCuando(iso: string, timeZone: string): string {
  const dia = diaLocalDe(iso, timeZone);
  const hoy = hoyNegocio(timeZone);
  const hora = fmt12(horaLocalDe(iso, timeZone));
  if (dia === hoy) return `hoy ${hora}`;
  if (dia === sumarDias(hoy, -1)) return `ayer ${hora}`;
  return `${fmtDia(dia, "dia-mes")} ${hora}`;
}

function saleItemsLabel(items: SaleItem[]): string {
  const names = items.map(nombreItem).filter(Boolean);
  return names.length === 0 ? "Sin ítems" : names.join(" · ");
}

/** Barras de los últimos días, fechadas en la zona del negocio. */
function groupByDay(sales: Sale[], hoy: string, timeZone: string): { label: string; pct: number }[] {
  const dias = listaDeDias(sumarDias(hoy, -(DIAS_GRAFICO - 1)), hoy);
  const buckets: Record<string, number> = Object.fromEntries(dias.map(d => [d, 0]));
  for (const s of sales) {
    const key = diaLocalDe(s.created_at, timeZone);
    if (key in buckets) buckets[key] += Number(s.total) || 0;
  }
  const maxVal = Math.max(...dias.map(d => buckets[d]), 1);
  return dias.map(d => ({ label: LETRAS_DIA[diaDeSemana(d) - 1], pct: Math.round((buckets[d] / maxVal) * 100) }));
}

/**
 * Suma por medio de pago con desglosePorMedio (lib/ingresos.ts), la misma
 * función del Panel: un pago dividido se reparte por método real (efectivo,
 * nequi, ...) en vez de acumularse como "mixto". Colores y nombres del POS,
 * para que coincidan con las etiquetas de cada venta en esta pantalla.
 */
function mediosDePago(sales: Sale[]): { key: string; label: string; value: number; color: string }[] {
  return desglosePorMedio(sales).map(d => ({
    ...d,
    label: methodCfg(d.key)?.label ?? d.label,
    color: methodCfg(d.key)?.color ?? d.color,
  }));
}

/** Total cobrado (D10: solo pos_sales, que es lo que entró a caja). */
function totalCobrado(sales: Sale[]): number {
  return sales.reduce((a, s) => a + montoDe(s), 0);
}

/**
 * Caja abierta de la sede activa con TODOS sus movimientos (DIN-07 / CAL-13 / ESQ-22).
 * Con una sola sede también cuenta la caja general sin sede, igual que la
 * pantalla de Caja y el Resumen web (incluyeCajaGeneral).
 */
async function cargarCaja(tenantId: string, loc: string | null, sedes: readonly SedeLite[]): Promise<{ session: CashSession | null; movements: CashMovement[] }> {
  // findOpenCashSession filtra por la sede activa y toma la más reciente: con
  // una caja abierta por sede, maybeSingle() sobre todas fallaba (PGRST116).
  const abierta = await findOpenCashSession(tenantId, loc, { incluirGeneral: incluyeCajaGeneral(loc, sedes.length) });
  if (!abierta) return { session: null, movements: [] };
  const session = revisar(
    await supabase.from("cash_sessions").select("id, opened_at, opening_amount, closing_amount").eq("id", abierta.id).single(),
    "No se pudo cargar la caja abierta",
  ) as CashSession;
  const movements = await traerTodo<CashMovement>((d, h) =>
    supabase.from("cash_movements")
      .select("id, type, amount, description, created_at, payment_method")
      .eq("session_id", abierta.id)
      .order("created_at", { ascending: false }).order("id")
      .range(d, h),
  { contexto: "No se pudieron cargar los movimientos de la caja" });
  return { session, movements };
}

// ── Loading ───────────────────────────────────────────────────────────────────

function LoadingView() {
  const { t } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }}>
      <ActivityIndicator size="large" color={t.subtle} />
      <Text style={{ fontSize: 13, fontFamily: Fonts.regular, color: t.subtle }}>Cargando datos…</Text>
    </View>
  );
}

// ── Resumen ───────────────────────────────────────────────────────────────────

function TabResumen({ datos, caja }: { datos: Vista; caja: TotalesCaja }) {
  const { t } = useTheme();
  const { timezone } = useTenant();
  const sales = datos.ventas;
  const period = datos.periodo;

  const totalIngresos = totalCobrado(sales);
  const avgSale       = sales.length > 0 ? Math.round(totalIngresos / sales.length) : 0;
  const countSales    = sales.length;
  const barData       = groupByDay(datos.ventasGrafico, hoyNegocio(timezone), timezone);
  const medios        = mediosDePago(sales);
  const grandTotal    = medios.reduce((a, m) => a + m.value, 0) || 1;
  const recentSales   = sales.slice(0, 4);
  const subCaja       = !datos.session ? "sin caja abierta" : datos.sede ? `caja abierta de ${datos.sede}` : "caja abierta de la sede";

  const card = [s.card, { backgroundColor: t.bgAlt, borderColor: t.border }] as const;

  return (
    <>
      <Animated.View entering={FadeInDown.duration(320)} style={s.kpiGrid}>
        {[
          { label: `Cobrado (${period} días)`, value: fmt(totalIngresos), sub: `${countSales} cobros en el POS` },
          { label: "Promedio / venta",         value: fmt(avgSale),       sub: "por transacción"      },
          { label: `Ventas (${period} días)`,  value: String(countSales), sub: "transacciones"        },
          { label: "Efectivo en caja", value: fmt(datos.session ? caja.efectivoEsperado : 0), sub: subCaja },
        ].map((k, i) => (
          <View key={i} style={[s.kpiCard, Shadow.sm, { backgroundColor: t.bgAlt, borderColor: t.border }]}>
            <Text style={[s.kpiLabel, { color: t.subtle }]}>{k.label}</Text>
            <Text style={[s.kpiValue, { color: t.text }]}>{k.value}</Text>
            <Text style={[s.kpiSub, { color: t.muted }]}>{k.sub}</Text>
          </View>
        ))}
      </Animated.View>
      {datos.truncado && (
        <Text style={[s.kpiSub, { color: t.muted, marginTop: -4, marginBottom: 12 }]}>
          Hay más cobros de los que se pueden cargar en el teléfono: las cifras incluyen solo los más recientes. Consulta el período completo en el panel web.
        </Text>
      )}

      <Animated.View entering={FadeInDown.delay(60).duration(320)}>
        <View style={[...card, { marginBottom: 12 }]}>
          <Text style={[s.cardTitle, { color: t.text }]}>Ingresos diarios</Text>
          <Text style={[s.cardSub, { color: t.subtle }]}>últimos {DIAS_GRAFICO} días</Text>
          <View style={s.bars}>
            {barData.map((b, i) => (
              <View key={i} style={s.barCol}>
                <View style={[s.barTrack, { backgroundColor: t.border }]}>
                  <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 1 }} end={{ x: 0, y: 0 }}
                    style={[s.barFill, { height: `${b.pct || 2}%` }]} />
                </View>
                <Text style={[s.barLabel, { color: t.subtle }]}>{b.label}</Text>
              </View>
            ))}
          </View>
        </View>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(120).duration(320)}>
        <View style={[...card, { marginBottom: 12 }]}>
          <Text style={[s.cardTitle, { color: t.text }]}>Medios de pago</Text>
          {medios.length === 0
            ? <Text style={[s.kpiSub, { marginTop: 8, color: t.muted }]}>Sin ventas en el período.</Text>
            : medios.map(m => <FilaMedio key={m.key} medio={m} grandTotal={grandTotal} />)
          }
        </View>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(180).duration(320)}>
        <View style={[...card, { marginBottom: 16 }]}>
          <Text style={[s.cardTitle, { color: t.text }]}>Últimas ventas</Text>
          {recentSales.length === 0
            ? <Text style={[s.kpiSub, { marginTop: 8, color: t.muted }]}>Sin ventas registradas.</Text>
            : recentSales.map((sale, i) => <FilaVenta key={sale.id} sale={sale} ultima={i === recentSales.length - 1} />)
          }
        </View>
      </Animated.View>
    </>
  );
}

function FilaMedio({ medio, grandTotal, style }: {
  medio: { label: string; value: number; color: string }; grandTotal: number; style?: object;
}) {
  const { t } = useTheme();
  return (
    <View style={[s.pmRow, style]}>
      <View style={[s.pmDot, { backgroundColor: medio.color }]} />
      <Text style={[s.pmName, { color: t.text }]} numberOfLines={1}>{medio.label}</Text>
      <View style={[s.pmBarTrack, { backgroundColor: t.border }]}>
        <View style={[s.pmBarFill, { width: `${Math.round(medio.value / grandTotal * 100)}%`, backgroundColor: medio.color }]} />
      </View>
      <Text style={[s.pmVal, { color: t.muted }]}>{fmt(medio.value)}</Text>
    </View>
  );
}

function FilaVenta({ sale, ultima }: { sale: Sale; ultima: boolean }) {
  const { t } = useTheme();
  const { timezone } = useTenant();
  const pm = sale.payment_method;
  const color = colorMetodo(pm, t.subtle);
  return (
    <View style={[s.saleRow, !ultima && { borderBottomWidth: 1, borderColor: t.border }]}>
      <View style={[s.pmBadge, { backgroundColor: color + "18" }]}>
        <Text style={[s.pmBadgeText, { color }]}>{pm.slice(0, 3).toUpperCase()}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[s.saleName, { color: t.text }]}>{sale.clients?.name ?? "Venta directa"}</Text>
        <Text style={[s.saleItems, { color: t.subtle }]} numberOfLines={1}>{saleItemsLabel(sale.pos_sale_items ?? [])}</Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={[s.saleTotal, { color: t.text }]}>{fmt(Number(sale.total))}</Text>
        <Text style={[s.saleDate, { color: t.subtle }]}>{fmtCuando(sale.created_at, timezone)}</Text>
      </View>
    </View>
  );
}

// ── Caja ─────────────────────────────────────────────────────────────────────

function TabCaja({ datos, caja }: { datos: Vista; caja: TotalesCaja }) {
  const { t } = useTheme();
  const { timezone } = useTenant();
  const router = useRouter();
  const { session, movements } = datos;
  const irACaja = () => router.push("/(admin)/caja");

  if (!session) {
    return (
      <Animated.View entering={FadeInDown.duration(320)}>
        <View style={[s.card, { alignItems: "center", paddingVertical: 36, backgroundColor: t.bgAlt, borderColor: t.border }]}>
          <Ionicons name="lock-open-outline" size={36} color={t.subtle} />
          <Text style={[s.cardTitle, { marginTop: 12, textAlign: "center", color: t.text }]}>Sin caja abierta</Text>
          <Text style={[s.kpiSub, { textAlign: "center", marginTop: 4, color: t.muted }]}>
            {datos.sede ? `No hay una caja abierta en ${datos.sede}.` : "No hay una caja abierta en la sede activa."}
          </Text>
          <TouchableOpacity onPress={irACaja} style={s.cajaBtn} activeOpacity={0.85} accessibilityRole="button">
            <Text style={s.cajaBtnText}>Ir a Caja</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    );
  }

  const diaApertura = diaLocalDe(session.opened_at, timezone);
  const cuando = `${fmt12(horaLocalDe(session.opened_at, timezone))} · ${esHoy(diaApertura, timezone) ? "hoy" : fmtDia(diaApertura, "dia-mes")}`;
  const visibles = movements.slice(0, MOVS_VISIBLES);

  return (
    <>
      <Animated.View entering={FadeInDown.duration(320)}>
        <LinearGradient colors={Gradients.ink} style={[s.sessionCard, { marginBottom: 12 }]}>
          <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.sessionAccent} />
          <View style={s.sessionHeader}>
            <View style={s.sessionDot} />
            <Text style={s.sessionStatus} numberOfLines={1}>{datos.sede ? `Caja de ${datos.sede}` : "Sesión en curso"}</Text>
            <Text style={s.sessionTime}>desde {cuando}</Text>
          </View>
          <Text style={s.sessionBalance}>{fmt(caja.efectivoEsperado)}</Text>
          <Text style={s.sessionBalanceLabel}>efectivo en caja</Text>
          {caja.ingresosElectronicos > 0 && (
            <Text style={[s.sessionBalanceLabel, { textTransform: "none", letterSpacing: 0 }]}>
              + {fmt(caja.ingresosElectronicos)} en pagos electrónicos
            </Text>
          )}
          <View style={s.sessionBreakdown}>
            {[
              { label: "Apertura", val: fmt(Number(session.opening_amount)), color: "rgba(255,255,255,0.6)" },
              { label: "Ingresos", val: fmt(caja.ingresos),                  color: "#10b981"               },
              { label: "Egresos",  val: `−${fmt(caja.egresos)}`,             color: "#ef4444"               },
            ].map(item => (
              <View key={item.label} style={s.sessionItem}>
                <Text style={[s.sessionItemLabel, { color: "rgba(255,255,255,0.4)" }]}>{item.label}</Text>
                <Text style={[s.sessionItemVal, { color: item.color }]}>{item.val}</Text>
              </View>
            ))}
          </View>
        </LinearGradient>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(60).duration(320)}>
        <View style={[s.quickRow, { marginBottom: 12 }]}>
          {[
            { icon: "add-circle-outline"    as const, label: "Ingreso",     color: "#10b981" },
            { icon: "remove-circle-outline" as const, label: "Egreso",      color: "#ef4444" },
            { icon: "lock-closed-outline"   as const, label: "Cerrar caja", color: t.subtle  },
          ].map((a, i) => (
            <TouchableOpacity key={i} style={[s.quickBtn, { backgroundColor: t.bgAlt, borderColor: t.border }]} activeOpacity={0.7}
              onPress={irACaja} accessibilityRole="button" accessibilityLabel={`${a.label}: abrir Caja`}>
              <View style={[s.quickIcon, { backgroundColor: a.color + "18" }]}>
                <Ionicons name={a.icon} size={20} color={a.color} />
              </View>
              <Text style={[s.quickLabel, { color: t.text }]}>{a.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(120).duration(320)}>
        <View style={[s.card, { marginBottom: 16, backgroundColor: t.bgAlt, borderColor: t.border }]}>
          <Text style={[s.cardTitle, { color: t.text }]}>Movimientos de la sesión</Text>
          {movements.length > MOVS_VISIBLES && (
            <Text style={[s.cardSub, { color: t.subtle, marginBottom: 4 }]}>
              Se muestran los {MOVS_VISIBLES} más recientes de {movements.length}. El saldo incluye todos.
            </Text>
          )}
          {visibles.length === 0
            ? <Text style={[s.kpiSub, { marginTop: 8, color: t.muted }]}>Sin movimientos registrados.</Text>
            : visibles.map((m, i) => {
              const color = m.type === "ingreso" ? "#10b981" : "#ef4444";
              return (
                <View key={m.id} style={[s.moveRow, i < visibles.length - 1 && { borderBottomWidth: 1, borderColor: t.border }]}>
                  <View style={[s.moveIcon, { backgroundColor: color + "18" }]}>
                    <Ionicons name={m.type === "ingreso" ? "arrow-down-outline" : "arrow-up-outline"} size={16} color={color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.movDesc, { color: t.text }]}>{m.description}</Text>
                    <Text style={[s.movTime, { color: t.subtle }]}>
                      {fmt12(horaLocalDe(m.created_at, timezone))}
                      {m.payment_method && m.payment_method !== "efectivo" ? ` · ${etiquetaMetodo(m.payment_method)}` : ""}
                    </Text>
                  </View>
                  <Text style={[s.movAmount, { color }]}>
                    {m.type === "ingreso" ? "+" : "−"}{fmt(Number(m.amount))}
                  </Text>
                </View>
              );
            })
          }
        </View>
      </Animated.View>
    </>
  );
}

// ── Ventas ────────────────────────────────────────────────────────────────────

function TabVentas({ sales, period, onPeriodChange }: {
  sales: Sale[]; period: Periodo; onPeriodChange: (p: Periodo) => void;
}) {
  const { t, mode } = useTheme();
  const [pmFilter, setPmFilter] = useState("todos");

  // Una venta dividida aparece bajo CADA método que la compone.
  const filtered = pmFilter === "todos" ? sales : sales.filter(s => lineasDePago(s).some(l => l.method === pmFilter));
  const total    = totalCobrado(filtered);
  // Los filtros salen de los métodos del POS (antes faltaba "transferencia").
  const filtros  = [{ key: "todos", label: "Todos", color: mode === "dark" ? Colors.red : Colors.ink }, ...PAY_METHODS];

  return (
    <>
      <Animated.View entering={FadeInDown.duration(320)} style={{ marginBottom: 10 }}>
        <View style={[s.filterPills, { backgroundColor: t.border }]}>
          {(["7", "30", "90"] as const).map(d => (
            <TouchableOpacity key={d} activeOpacity={0.7}
              style={[s.pill, period === d && { backgroundColor: mode === "dark" ? Colors.red : Colors.ink }]}
              onPress={() => onPeriodChange(d)}
              accessibilityRole="button" accessibilityState={{ selected: period === d }}>
              <Text style={[s.pillText, { color: period === d ? Colors.white : t.muted }]}>{d} días</Text>
            </TouchableOpacity>
          ))}
        </View>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(40).duration(320)}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
          <View style={s.filterPillsH}>
            {filtros.map(pm => {
              const activo = pmFilter === pm.key;
              return (
                <TouchableOpacity key={pm.key} activeOpacity={0.7}
                  style={[s.pmPill, { backgroundColor: t.bgAlt, borderColor: t.border },
                    activo && { backgroundColor: pm.color + "20", borderColor: pm.color }]}
                  onPress={() => setPmFilter(pm.key)}
                  accessibilityRole="button" accessibilityState={{ selected: activo }}>
                  <Text style={[s.pmPillText, { color: t.muted }, activo && { color: pm.color, fontFamily: Fonts.bold }]}>
                    {pm.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
      </Animated.View>

      <Text style={[s.summaryText, { color: t.subtle, marginBottom: 10 }]}>
        <Text style={[s.summaryBold, { color: t.text }]}>{filtered.length}</Text>{" ventas · "}
        <Text style={[s.summaryBold, { color: t.text }]}>{fmt(total)}</Text>
      </Text>

      <Animated.View entering={FadeInDown.delay(80).duration(320)}>
        <View style={[s.card, { marginBottom: 16, backgroundColor: t.bgAlt, borderColor: t.border }]}>
          {filtered.length === 0
            ? <Text style={[s.kpiSub, { textAlign: "center", paddingVertical: 20, color: t.muted }]}>Sin ventas para los filtros seleccionados.</Text>
            : filtered.map((sale, i) => <FilaVenta key={sale.id} sale={sale} ultima={i === filtered.length - 1} />)
          }
        </View>
      </Animated.View>
    </>
  );
}

// ── Reportes ──────────────────────────────────────────────────────────────────

function RankingItems({ items }: { items: ReturnType<typeof agruparPorItem> }) {
  const { t } = useTheme();
  return (
    <>
      {items.map((svc, i) => (
        <View key={`${svc.esProducto ? "p" : "s"}-${svc.name}`} style={[s.serviceRow, i < items.length - 1 && { marginBottom: 14 }]}>
          <View style={s.serviceTop}>
            <Text style={[s.serviceName, { color: t.text }]} numberOfLines={1}>
              {svc.name}{svc.esProducto ? <Text style={{ color: t.subtle, fontFamily: Fonts.regular }}> · producto</Text> : null}
            </Text>
            <Text style={[s.serviceVal, { color: t.text }]}>{fmt(svc.val)}</Text>
          </View>
          <View style={[s.serviceTrack, { backgroundColor: t.border }]}>
            <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={[s.serviceFill, { width: `${svc.pct}%` }]} />
          </View>
        </View>
      ))}
    </>
  );
}

function TabReportes({ sales }: { sales: Sale[] }) {
  const { t } = useTheme();

  const totalIngresos = totalCobrado(sales);
  const avgTicket     = sales.length > 0 ? Math.round(totalIngresos / sales.length) : 0;
  const uniqueClients = new Set(sales.map(s => s.client_id).filter(Boolean)).size;
  const topItems      = agruparPorItem(sales);
  const medios        = mediosDePago(sales);
  const grandTotal    = medios.reduce((a, m) => a + m.value, 0) || 1;

  return (
    <>
      <Animated.View entering={FadeInDown.duration(320)} style={s.kpiGrid}>
        {[
          { label: "Cobrado en el período", value: fmt(totalIngresos) },
          // "Promedio por cobro", no "Ticket promedio": divide entre
          // transacciones del POS, no entre citas cobradas como el Panel.
          { label: "Promedio por cobro",    value: fmt(avgTicket)     },
          { label: "Ventas registradas", value: String(sales.length)  },
          { label: "Clientes únicos",    value: String(uniqueClients) },
        ].map((k, i) => (
          <View key={i} style={[s.kpiCard, Shadow.sm, { backgroundColor: t.bgAlt, borderColor: t.border }]}>
            <Text style={[s.kpiLabel, { color: t.subtle }]}>{k.label}</Text>
            <Text style={[s.kpiValue, { color: t.text }]}>{k.value}</Text>
          </View>
        ))}
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(60).duration(320)}>
        <View style={[s.card, { marginBottom: 12, backgroundColor: t.bgAlt, borderColor: t.border }]}>
          <Text style={[s.cardTitle, { color: t.text }]}>Lo más vendido</Text>
          {topItems.length === 0
            ? <Text style={[s.kpiSub, { marginTop: 8, color: t.muted }]}>Sin ventas en el período.</Text>
            : <RankingItems items={topItems} />
          }
        </View>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(120).duration(320)}>
        <View style={[s.card, { marginBottom: 16, backgroundColor: t.bgAlt, borderColor: t.border }]}>
          <Text style={[s.cardTitle, { color: t.text }]}>Desglose por método</Text>
          {medios.length === 0
            ? <Text style={[s.kpiSub, { marginTop: 8, color: t.muted }]}>Sin ventas en el período.</Text>
            : medios.map(m => <FilaMedio key={m.key} medio={m} grandTotal={grandTotal} style={{ marginBottom: 10 }} />)
          }
        </View>
      </Animated.View>
    </>
  );
}

// ── Rentabilidad ──────────────────────────────────────────────────────────────

function TabRentabilidad({ sales }: { sales: Sale[] }) {
  const { t } = useTheme();
  const ingresos = totalCobrado(sales);
  const topItems = agruparPorItem(sales);

  return (
    <>
      <Animated.View entering={FadeInDown.duration(320)}>
        <LinearGradient colors={Gradients.ink} style={[s.sessionCard, { marginBottom: 12 }]}>
          <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.sessionAccent} />
          <Text style={[s.sessionBalanceLabel, { marginBottom: 4 }]}>Ingresos del período</Text>
          <Text style={[s.sessionBalance, { color: "#10b981" }]}>{fmt(ingresos)}</Text>
          <View style={s.sessionBreakdown}>
            {[
              { label: "Ventas",   val: String(sales.length), color: "white"   },
              { label: "Promedio", val: fmt(sales.length > 0 ? Math.round(ingresos / sales.length) : 0), color: "#10b981" },
              { label: "Total",    val: fmt(ingresos),        color: "white"   },
            ].map(item => (
              <View key={item.label} style={s.sessionItem}>
                <Text style={[s.sessionItemLabel, { color: "rgba(255,255,255,0.4)" }]}>{item.label}</Text>
                <Text style={[s.sessionItemVal, { color: item.color }]}>{item.val}</Text>
              </View>
            ))}
          </View>
        </LinearGradient>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(60).duration(320)}>
        <View style={[s.card, { marginBottom: 12, alignItems: "center", paddingVertical: 24, backgroundColor: t.bgAlt, borderColor: t.border }]}>
          <Ionicons name="bar-chart-outline" size={32} color={t.subtle} />
          <Text style={[s.cardTitle, { marginTop: 10, textAlign: "center", color: t.text }]}>Análisis de costos</Text>
          <Text style={[s.kpiSub, { textAlign: "center", marginTop: 4, maxWidth: 260, color: t.muted }]}>
            Conecta tus costos en el panel web para ver el margen de rentabilidad.
          </Text>
        </View>
      </Animated.View>

      {topItems.length > 0 && (
        <Animated.View entering={FadeInDown.delay(120).duration(320)}>
          <View style={[s.card, { marginBottom: 16, backgroundColor: t.bgAlt, borderColor: t.border }]}>
            <Text style={[s.cardTitle, { color: t.text }]}>Ingresos por servicio y producto</Text>
            <RankingItems items={topItems} />
          </View>
        </Animated.View>
      )}
    </>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function FinanzasScreen() {
  const router = useRouter();
  const { t, mode } = useTheme();
  // tenantId de la sesión (antes se buscaba aparte por owner_id).
  const { tenantId } = useAuth();
  const { timezone, ready } = useTenant();
  const guard = useGuardRespuestas();
  const [tab, setTab]         = useState<Tab>("resumen");
  const [period, setPeriod]   = useState<Periodo>("30");
  // Por defecto la sede activa: así las cifras cuadran con el Panel y
  // Reportes (DIN-12). "Todas" suma el negocio entero, como el Finanzas web.
  const [alcance, setAlcance] = useState<Alcance>("sede");
  const [datos, setDatos]     = useState<Datos | null>(null);
  const [error, setError]     = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);

  const { recargar, cargando } = useRecarga(async () => {
    if (!tenantId) return;
    const turno = guard.nuevo();
    // Período = N días del NEGOCIO con hoy incluido (TZ-08), no una ventana
    // móvil de N×24 h. Se traen al menos los días del gráfico.
    const hoy = hoyNegocio(timezone);
    const dias = Number(period);
    const desdePeriodo = sumarDias(hoy, -(dias - 1));
    const r = rangoPersonalizado(sumarDias(hoy, -(Math.max(dias, DIAS_GRAFICO) - 1)), hoy, timezone);
    try {
      const loc = await getActiveLocationId(tenantId);
      const [ventasRes, { cajaRes, sedes }] = await Promise.all([
        // Paginado: el servidor corta en 1000 filas (antes limit(500) en silencio).
        // Se traen todas las sedes y el alcance se aplica en memoria: cambiar
        // entre "esta sede" y "todas" no vuelve a consultar.
        traerTodoDetalle((d, h) =>
          supabase
            .from("pos_sales")
            .select("id, total, payment_method, payments, created_at, client_id, location_id, clients(name), pos_sale_items(quantity, price, name, item_type, services(name))")
            .eq("tenant_id", tenantId)
            .gte("created_at", r.desdeUTC)
            .lte("created_at", r.hastaUTC)
            .order("created_at", { ascending: false })
            .order("id")
            .range(d, h),
        { contexto: "No se pudieron cargar las ventas" }),
        // La caja necesita saber cuántas sedes hay (caja general con una sola).
        cargarListaSedes(tenantId, loc).then(async lista => ({ sedes: lista, cajaRes: await cargarCaja(tenantId, loc, lista) })),
      ]);
      if (!turno.vigente()) return;
      const todas = ventasRes.filas as unknown as Sale[];
      setDatos({
        periodo: period,
        ventas: todas.filter(v => diaLocalDe(v.created_at, timezone) >= desdePeriodo),
        ventasGrafico: todas,
        truncado: ventasRes.truncado,
        session: cajaRes.session,
        movements: cajaRes.movements,
        sedeActiva: loc,
        sedes,
      });
      setError(null);
    } catch (e) {
      if (turno.vigente()) setError(e);
    }
  }, [tenantId, timezone, period], { timeZone: timezone, habilitado: !!tenantId && ready });

  const caja = useMemo(
    () => totalesCaja(datos?.movements ?? [], datos?.session?.opening_amount),
    [datos],
  );

  // Alcance por sede. Solo se filtra si el negocio tiene más de una: con una
  // sola, la sede ES el negocio y así no se esconden los cobros viejos que se
  // guardaron sin sede. Con varias, "esta sede" usa la misma regla que el
  // Panel y Reportes (location_id = sede activa).
  const vista = useMemo<Vista | null>(() => {
    if (!datos) return null;
    const sede = nombreSede(datos.sedes, datos.sedeActiva);
    const filtrar = !!sede && alcance === "sede";
    const deAlcance = (vs: Sale[]) => (filtrar ? vs.filter(v => v.location_id === datos.sedeActiva) : vs);
    return {
      ...datos,
      ventas: deAlcance(datos.ventas),
      ventasGrafico: deAlcance(datos.ventasGrafico),
      sede,
      alcanceLabel: !sede ? null : filtrar ? sede : TODAS_LAS_SEDES,
    };
  }, [datos, alcance]);

  const onRefresh = async () => { setRefreshing(true); await recargar(); setRefreshing(false); };

  let contenido: ReactNode;
  if (error && !vista) {
    contenido = <ErrorState error={error} onRetry={recargar} />;
  } else if (!vista) {
    contenido = <LoadingView />;
  } else {
    contenido = (
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.red} />}>
        {error ? (
          <TouchableOpacity onPress={recargar} style={s.errorBanner} activeOpacity={0.8} accessibilityRole="button">
            <Ionicons name="cloud-offline-outline" size={16} color={Colors.red} />
            <Text style={s.errorBannerText}>{mensajeError(error)} Toca para reintentar.</Text>
          </TouchableOpacity>
        ) : null}
        {/* La caja es siempre la de la sede activa; el resto se puede ver por sede o de todas. */}
        {vista.sede && tab !== "caja" ? (
          <View style={{ marginBottom: 12, alignSelf: "flex-start" }}>
            <SegmentedControl<Alcance>
              options={[
                { value: "sede", label: nombreCorto(vista.sede) },
                { value: "todas", label: TODAS_LAS_SEDES },
              ]}
              value={alcance}
              onChange={setAlcance}
            />
          </View>
        ) : null}
        {tab === "resumen"      && <TabResumen datos={vista} caja={caja} />}
        {tab === "caja"         && <TabCaja datos={vista} caja={caja} />}
        {tab === "ventas"       && <TabVentas sales={vista.ventas} period={period} onPeriodChange={setPeriod} />}
        {tab === "reportes"     && <TabReportes sales={vista.ventas} />}
        {tab === "rentabilidad" && <TabRentabilidad sales={vista.ventas} />}
      </ScrollView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={["top"]}>
      {/* Header de subpantalla: superficie oscura + acento de marca de 3px */}
      <LinearGradient colors={Gradients.ink} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.header}>
        <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3 }} />
        <View style={s.headerBlob1} />
        <View style={s.headerBlob2} />
        <View style={s.headerTopRow}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.7}
            accessibilityRole="button" accessibilityLabel="Volver" hitSlop={8}>
            <Ionicons name="chevron-back" size={20} color="white" />
          </TouchableOpacity>
          <View style={s.headerIconBox}>
            <Ionicons name="bar-chart-outline" size={15} color="white" />
          </View>
          <Text style={s.headerLabel}>HUB FINANCIERO</Text>
          {cargando && vista ? <ActivityIndicator color="rgba(255,255,255,.7)" size="small" style={{ marginLeft: "auto" }} /> : null}
        </View>
        <Text style={s.headerTitle}>Finanzas</Text>
        {/* Qué se está sumando (DIN-12): solo si el negocio tiene varias sedes. */}
        {vista?.alcanceLabel ? (
          <View style={s.headerSede}>
            <Ionicons name="location-outline" size={12} color="rgba(255,255,255,.7)" />
            <Text style={s.headerSedeText} numberOfLines={1}>
              {tab === "caja" && vista.sede ? `Caja de ${vista.sede}` : vista.alcanceLabel}
            </Text>
          </View>
        ) : null}
      </LinearGradient>

      <ScrollView
        horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.tabBar}
        style={[s.tabBarScroll, { backgroundColor: t.bgAlt, borderBottomColor: t.border }]}
      >
        {TABS.map(tb => {
          const active = tab === tb.id;
          return (
            <TouchableOpacity
              key={tb.id}
              style={[s.tabBtn, active && { backgroundColor: mode === "dark" ? Colors.red : Colors.ink }]}
              onPress={() => setTab(tb.id)}
              activeOpacity={0.7}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Text style={[s.tabBtnText, { color: active ? Colors.white : t.muted }]}>{tb.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={[s.content, { backgroundColor: t.bg }]}>{contenido}</View>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  header:       { paddingTop: 14, paddingHorizontal: 20, paddingBottom: 16, overflow: "hidden" },
  headerBlob1:  { position: "absolute", width: 200, height: 200, borderRadius: 100, backgroundColor: "rgba(255,255,255,.06)", top: -80, right: -40 },
  headerBlob2:  { position: "absolute", width: 100, height: 100, borderRadius: 50,  backgroundColor: "rgba(0,0,0,.05)", bottom: -30, left: -20 },
  headerTopRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14, zIndex: 1 },
  backBtn:      { width: 32, height: 32, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.2)" },
  headerIconBox:{ width: 32, height: 32, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.2)" },
  headerLabel:  { fontSize: 14, fontFamily: Fonts.semibold, color: "rgba(255,255,255,.8)" },
  headerTitle:  { fontSize: 22, fontFamily: Fonts.bold, color: "white", letterSpacing: -0.5, marginBottom: 4, zIndex: 1 },
  headerSede:   { flexDirection: "row", alignItems: "center", gap: 5, zIndex: 1 },
  headerSedeText: { fontSize: 12, fontFamily: Fonts.semibold, color: "rgba(255,255,255,.75)", flexShrink: 1 },

  tabBarScroll: { borderBottomWidth: 1, flexShrink: 0, flexGrow: 0 },
  tabBar:       { flexDirection: "row", padding: 6, gap: 4, alignItems: "center" },
  tabBtn:       { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  tabBtnText:   { fontSize: 13, fontFamily: Fonts.semibold },

  content: { flex: 1, paddingHorizontal: 16, paddingTop: 16 },

  errorBanner:    { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12, padding: 12, borderRadius: Radius.md, backgroundColor: "rgba(251,15,5,0.08)" },
  errorBannerText:{ flex: 1, fontSize: 12.5, fontFamily: Fonts.semibold, color: Colors.red },

  kpiGrid:  { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 12 },
  kpiCard:  { flex: 1, minWidth: "45%", borderRadius: Radius.md, borderWidth: 1, padding: 14 },
  kpiLabel: { ...MonoLabel, fontSize: 9.5, marginBottom: 8 },
  kpiValue: { fontSize: 18, fontFamily: Fonts.bold, letterSpacing: -0.4, fontVariant: ["tabular-nums"] },
  kpiSub:   { fontSize: 11, fontFamily: Fonts.regular, marginTop: 4 },

  card:      { borderRadius: Radius.lg, borderWidth: 1, padding: 16, ...Shadow.sm },
  cardTitle: { fontSize: 14, fontFamily: Fonts.bold, marginBottom: 4 },
  cardSub:   { fontSize: 11, fontFamily: Fonts.regular, marginBottom: 12 },
  cajaBtn:   { marginTop: 16, backgroundColor: Colors.red, borderRadius: Radius.full, paddingHorizontal: 22, paddingVertical: 11 },
  cajaBtnText: { fontSize: 13, fontFamily: Fonts.bold, color: "white" },

  bars:     { flexDirection: "row", alignItems: "flex-end", height: 80, gap: 4, marginTop: 8 },
  barCol:   { flex: 1, alignItems: "center", gap: 4 },
  barTrack: { flex: 1, width: "100%", borderRadius: 4, overflow: "hidden", justifyContent: "flex-end" },
  barFill:  { width: "100%", borderRadius: 4 },
  barLabel: { fontSize: 8, fontFamily: Fonts.mono },

  pmRow:      { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  pmDot:      { width: 8, height: 8, borderRadius: 4 },
  pmName:     { fontSize: 12, fontFamily: Fonts.semibold, width: 86 },
  pmBarTrack: { flex: 1, height: 6, borderRadius: 3, overflow: "hidden" },
  pmBarFill:  { height: "100%", borderRadius: 3 },
  pmVal:      { fontSize: 11, fontFamily: Fonts.mono, width: 84, textAlign: "right" },

  saleRow:     { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 },
  pmBadge:     { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  pmBadgeText: { fontSize: 9, fontFamily: Fonts.monoBold, letterSpacing: 0.5 },
  saleName:    { fontSize: 13, fontFamily: Fonts.semibold },
  saleItems:   { fontSize: 11, fontFamily: Fonts.regular, marginTop: 1 },
  saleTotal:   { fontSize: 13, fontFamily: Fonts.bold, fontVariant: ["tabular-nums"] },
  saleDate:    { fontSize: 10, fontFamily: Fonts.mono, marginTop: 1 },

  sessionCard:         { borderRadius: Radius.lg, padding: 20, overflow: "hidden" },
  sessionAccent:       { position: "absolute", top: 0, left: 0, right: 0, height: 3, borderRadius: Radius.lg },
  sessionHeader:       { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 },
  sessionDot:          { width: 7, height: 7, borderRadius: 4, backgroundColor: "#10b981" },
  sessionStatus:       { fontSize: 12, fontFamily: Fonts.semibold, color: "rgba(255,255,255,0.7)" },
  sessionTime:         { fontSize: 11, fontFamily: Fonts.mono, color: "rgba(255,255,255,0.4)", marginLeft: "auto" },
  sessionBalance:      { fontSize: 32, fontFamily: Fonts.bold, color: Colors.white, letterSpacing: -1, fontVariant: ["tabular-nums"] },
  sessionBalanceLabel: { fontSize: 11, fontFamily: Fonts.mono, color: "rgba(255,255,255,0.45)", letterSpacing: 1, textTransform: "uppercase", marginTop: 2 },
  sessionBreakdown:    { flexDirection: "row", marginTop: 18, paddingTop: 16, borderTopWidth: 1, borderColor: "rgba(255,255,255,0.10)" },
  sessionItem:         { flex: 1, alignItems: "center" },
  sessionItemLabel:    { fontSize: 9, fontFamily: Fonts.mono, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 },
  sessionItemVal:      { fontSize: 14, fontFamily: Fonts.bold, fontVariant: ["tabular-nums"] },

  quickRow:  { flexDirection: "row", gap: 10 },
  quickBtn:  { flex: 1, alignItems: "center", borderRadius: Radius.md, borderWidth: 1, paddingVertical: 14, gap: 6, ...Shadow.sm },
  quickIcon: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  quickLabel:{ fontSize: 12, fontFamily: Fonts.semibold },

  moveRow:   { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 },
  moveIcon:  { width: 34, height: 34, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  movDesc:   { fontSize: 13, fontFamily: Fonts.semibold },
  movTime:   { fontSize: 10, fontFamily: Fonts.mono, marginTop: 1 },
  movAmount: { fontSize: 13, fontFamily: Fonts.bold, fontVariant: ["tabular-nums"] },

  filterPills:  { flexDirection: "row", padding: 4, borderRadius: 12, alignSelf: "flex-start", gap: 2 },
  filterPillsH: { flexDirection: "row", gap: 6 },
  pill:         { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8 },
  pillText:     { fontSize: 12, fontFamily: Fonts.semibold },
  pmPill:       { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5 },
  pmPillText:   { fontSize: 12, fontFamily: Fonts.semibold },

  summaryText:  { fontSize: 13, fontFamily: Fonts.regular },
  summaryBold:  { fontFamily: Fonts.bold },

  serviceRow:   { marginBottom: 0 },
  serviceTop:   { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 8 },
  serviceName:  { fontSize: 13, fontFamily: Fonts.semibold, flex: 1 },
  serviceVal:   { fontSize: 13, fontFamily: Fonts.bold, fontVariant: ["tabular-nums"] },
  serviceTrack: { height: 5, borderRadius: 4, overflow: "hidden" },
  serviceFill:  { height: "100%", borderRadius: 4 },
});
