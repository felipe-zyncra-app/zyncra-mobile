import { useState, useEffect } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, ActivityIndicator,
} from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Fonts, Gradients, MonoLabel, Radius, Shadow } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { supabase } from "@/lib/supabase";

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = "resumen" | "caja" | "ventas" | "reportes" | "rentabilidad";

interface SaleItem {
  quantity: number;
  unit_price: number;
  services: { name: string } | null;
}

interface Sale {
  id: string;
  total: number;
  payment_method: string;
  created_at: string;
  client_id: string | null;
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
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string }[] = [
  { id: "resumen",      label: "Resumen"      },
  { id: "caja",         label: "Caja"         },
  { id: "ventas",       label: "Ventas"       },
  { id: "reportes",     label: "Reportes"     },
  { id: "rentabilidad", label: "Rentabilidad" },
];

const PM_COLOR: Record<string, string> = {
  efectivo: "#10b981", tarjeta: "#6366f1", nequi: "#0027fe", daviplata: "#f59e0b",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n);
}

function startOfPeriod(period: "7" | "30" | "90"): string {
  const d = new Date();
  d.setDate(d.getDate() - parseInt(period));
  return d.toISOString();
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  const hhmm = d.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 0) return `hoy ${hhmm}`;
  if (diffDays === 1) return `ayer ${hhmm}`;
  return `${d.getDate()} ${d.toLocaleString("es-CO", { month: "short" })} ${hhmm}`;
}

function saleItemsLabel(items: SaleItem[]): string {
  const names = items.map(i => i.services?.name).filter(Boolean) as string[];
  return names.length === 0 ? "Sin servicios" : names.join(" · ");
}

function groupByDay(sales: Sale[], days: number): { label: string; pct: number }[] {
  const buckets: Record<string, number> = {};
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    buckets[d.toISOString().slice(0, 10)] = 0;
  }
  for (const s of sales) {
    const key = s.created_at.slice(0, 10);
    if (key in buckets) buckets[key] += s.total;
  }
  const entries = Object.entries(buckets);
  const maxVal = Math.max(...entries.map(([, v]) => v), 1);
  const dayLetters = ["D", "L", "M", "M", "J", "V", "S"];
  return entries.map(([dateStr, val]) => ({
    label: dayLetters[new Date(dateStr + "T12:00:00").getDay()],
    pct: Math.round((val / maxVal) * 100),
  }));
}

function groupByPaymentMethod(sales: Sale[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const s of sales) result[s.payment_method] = (result[s.payment_method] ?? 0) + s.total;
  return result;
}

function groupByService(sales: Sale[]): { name: string; val: number; pct: number }[] {
  const totals: Record<string, number> = {};
  for (const sale of sales)
    for (const item of sale.pos_sale_items) {
      const name = item.services?.name ?? "Sin nombre";
      totals[name] = (totals[name] ?? 0) + item.quantity * item.unit_price;
    }
  const sorted = Object.entries(totals)
    .map(([name, val]) => ({ name, val }))
    .sort((a, b) => b.val - a.val)
    .slice(0, 6);
  const maxVal = sorted[0]?.val ?? 1;
  return sorted.map(s => ({ ...s, pct: Math.round((s.val / maxVal) * 100) }));
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

function TabResumen({ sales, session, movements, period, loading }: {
  sales: Sale[]; session: CashSession | null; movements: CashMovement[];
  period: "7" | "30" | "90"; loading: boolean;
}) {
  const { t } = useTheme();
  if (loading) return <LoadingView />;

  const totalIngresos = sales.reduce((a, s) => a + s.total, 0);
  const avgSale       = sales.length > 0 ? Math.round(totalIngresos / sales.length) : 0;
  const countSales    = sales.length;
  const cajaIngresos  = movements.filter(m => m.type === "ingreso").reduce((a, m) => a + m.amount, 0);
  const cajaEgresos   = movements.filter(m => m.type === "egreso").reduce((a, m) => a + m.amount, 0);
  const cajaBalance   = session ? session.opening_amount + cajaIngresos - cajaEgresos : 0;
  const barData       = groupByDay(sales, 12);
  const pmTotals      = groupByPaymentMethod(sales);
  const grandTotal    = Object.values(pmTotals).reduce((a, b) => a + b, 0) || 1;
  const recentSales   = sales.slice(0, 4);

  const card = [s.card, { backgroundColor: t.bgAlt, borderColor: t.border }] as const;

  return (
    <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
      <Animated.View entering={FadeInDown.duration(320)} style={s.kpiGrid}>
        {[
          { label: `Ingresos (${period}d)`, value: fmt(totalIngresos), sub: `${countSales} ventas` },
          { label: "Promedio / venta",       value: fmt(avgSale),       sub: "por transacción"      },
          { label: `Ventas (${period}d)`,    value: String(countSales), sub: "transacciones"        },
          { label: "Caja actual", value: fmt(cajaBalance), sub: session ? "sesión activa" : "sin sesión" },
        ].map((k, i) => (
          <View key={i} style={[s.kpiCard, Shadow.sm, { backgroundColor: t.bgAlt, borderColor: t.border }]}>
            <Text style={[s.kpiLabel, { color: t.subtle }]}>{k.label}</Text>
            <Text style={[s.kpiValue, { color: t.text }]}>{k.value}</Text>
            <Text style={[s.kpiSub, { color: t.muted }]}>{k.sub}</Text>
          </View>
        ))}
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(60).duration(320)}>
        <View style={[...card, { marginBottom: 12 }]}>
          <Text style={[s.cardTitle, { color: t.text }]}>Ingresos diarios</Text>
          <Text style={[s.cardSub, { color: t.subtle }]}>últimos 12 días</Text>
          <View style={s.bars}>
            {barData.map((b, i) => (
              <View key={i} style={s.barCol}>
                <View style={[s.barTrack, { backgroundColor: t.border }]}>
                  <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 1 }} end={{ x: 0, y: 0 }}
                    style={[s.barFill, { height: `${b.pct || 2}%` as any }]} />
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
          {Object.keys(pmTotals).length === 0
            ? <Text style={[s.kpiSub, { marginTop: 8, color: t.muted }]}>Sin ventas en el período.</Text>
            : (Object.entries(pmTotals) as [string, number][]).map(([pm, val]) => (
              <View key={pm} style={s.pmRow}>
                <View style={[s.pmDot, { backgroundColor: PM_COLOR[pm] ?? Colors.dim }]} />
                <Text style={[s.pmName, { color: t.text }]}>{pm.charAt(0).toUpperCase() + pm.slice(1)}</Text>
                <View style={[s.pmBarTrack, { backgroundColor: t.border }]}>
                  <View style={[s.pmBarFill, { width: `${Math.round(val / grandTotal * 100)}%` as any, backgroundColor: PM_COLOR[pm] ?? Colors.dim }]} />
                </View>
                <Text style={[s.pmVal, { color: t.muted }]}>{fmt(val)}</Text>
              </View>
            ))
          }
        </View>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(180).duration(320)}>
        <View style={[...card, { marginBottom: 16 }]}>
          <Text style={[s.cardTitle, { color: t.text }]}>Últimas ventas</Text>
          {recentSales.length === 0
            ? <Text style={[s.kpiSub, { marginTop: 8, color: t.muted }]}>Sin ventas registradas.</Text>
            : recentSales.map((sale, i) => {
              const pm = sale.payment_method;
              return (
                <View key={sale.id} style={[s.saleRow, i < recentSales.length - 1 && { borderBottomWidth: 1, borderColor: t.border }]}>
                  <View style={[s.pmBadge, { backgroundColor: (PM_COLOR[pm] ?? Colors.dim) + "18" }]}>
                    <Text style={[s.pmBadgeText, { color: PM_COLOR[pm] ?? Colors.dim }]}>{pm.slice(0, 3).toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.saleName, { color: t.text }]}>{sale.clients?.name ?? "Cliente"}</Text>
                    <Text style={[s.saleItems, { color: t.subtle }]}>{saleItemsLabel(sale.pos_sale_items)}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={[s.saleTotal, { color: t.text }]}>{fmt(sale.total)}</Text>
                    <Text style={[s.saleDate, { color: t.subtle }]}>{fmtTime(sale.created_at)}</Text>
                  </View>
                </View>
              );
            })
          }
        </View>
      </Animated.View>
    </ScrollView>
  );
}

// ── Caja ─────────────────────────────────────────────────────────────────────

function TabCaja({ session, movements, loading }: {
  session: CashSession | null; movements: CashMovement[]; loading: boolean;
}) {
  const { t } = useTheme();
  if (loading) return <LoadingView />;

  const cajaIngresos = movements.filter(m => m.type === "ingreso").reduce((a, m) => a + m.amount, 0);
  const cajaEgresos  = movements.filter(m => m.type === "egreso").reduce((a, m) => a + m.amount, 0);
  const balance      = session ? session.opening_amount + cajaIngresos - cajaEgresos : 0;
  const openedTime   = session
    ? new Date(session.opened_at).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })
    : "";

  const webAction = () => Alert.alert("Acción no disponible", "Usa el panel web para esta acción.");

  if (!session) {
    return (
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeInDown.duration(320)}>
          <View style={[s.card, { alignItems: "center", paddingVertical: 36, backgroundColor: t.bgAlt, borderColor: t.border }]}>
            <Ionicons name="lock-open-outline" size={36} color={t.subtle} />
            <Text style={[s.cardTitle, { marginTop: 12, textAlign: "center", color: t.text }]}>Sin sesión activa</Text>
            <Text style={[s.kpiSub, { textAlign: "center", marginTop: 4, color: t.muted }]}>
              Abre una sesión desde el panel web para registrar movimientos.
            </Text>
          </View>
        </Animated.View>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
      <Animated.View entering={FadeInDown.duration(320)}>
        <LinearGradient colors={Gradients.ink} style={[s.sessionCard, { marginBottom: 12 }]}>
          <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.sessionAccent} />
          <View style={s.sessionHeader}>
            <View style={s.sessionDot} />
            <Text style={s.sessionStatus}>Sesión en curso</Text>
            <Text style={s.sessionTime}>desde {openedTime} · hoy</Text>
          </View>
          <Text style={s.sessionBalance}>{fmt(balance)}</Text>
          <Text style={s.sessionBalanceLabel}>saldo en caja</Text>
          <View style={s.sessionBreakdown}>
            {[
              { label: "Apertura", val: fmt(session.opening_amount), color: "rgba(255,255,255,0.6)" },
              { label: "Ingresos", val: fmt(cajaIngresos),           color: "#10b981"               },
              { label: "Egresos",  val: `−${fmt(cajaEgresos)}`,      color: "#ef4444"               },
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
            { icon: "add-circle-outline"    as const, label: "Ingreso",      color: "#10b981"  },
            { icon: "remove-circle-outline" as const, label: "Egreso",       color: "#ef4444"  },
            { icon: "lock-closed-outline"   as const, label: "Cerrar caja",  color: t.subtle   },
          ].map((a, i) => (
            <TouchableOpacity key={i} style={[s.quickBtn, { backgroundColor: t.bgAlt, borderColor: t.border }]} activeOpacity={0.7} onPress={webAction}>
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
          {movements.length === 0
            ? <Text style={[s.kpiSub, { marginTop: 8, color: t.muted }]}>Sin movimientos registrados.</Text>
            : movements.map((m, i) => (
              <View key={m.id} style={[s.moveRow, i < movements.length - 1 && { borderBottomWidth: 1, borderColor: t.border }]}>
                <View style={[s.moveIcon, { backgroundColor: (m.type === "ingreso" ? "#10b981" : "#ef4444") + "18" }]}>
                  <Ionicons name={m.type === "ingreso" ? "arrow-down-outline" : "arrow-up-outline"} size={16}
                    color={m.type === "ingreso" ? "#10b981" : "#ef4444"} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.movDesc, { color: t.text }]}>{m.description}</Text>
                  <Text style={[s.movTime, { color: t.subtle }]}>
                    {new Date(m.created_at).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}
                  </Text>
                </View>
                <Text style={[s.movAmount, { color: m.type === "ingreso" ? "#10b981" : "#ef4444" }]}>
                  {m.type === "ingreso" ? "+" : "−"}{fmt(m.amount)}
                </Text>
              </View>
            ))
          }
        </View>
      </Animated.View>
    </ScrollView>
  );
}

// ── Ventas ────────────────────────────────────────────────────────────────────

function TabVentas({ sales, period, onPeriodChange, loading }: {
  sales: Sale[]; period: "7" | "30" | "90";
  onPeriodChange: (p: "7" | "30" | "90") => void; loading: boolean;
}) {
  const { t, mode } = useTheme();
  const [pmFilter, setPmFilter] = useState("todos");
  if (loading) return <LoadingView />;

  const filtered = pmFilter === "todos" ? sales : sales.filter(s => s.payment_method === pmFilter);
  const total    = filtered.reduce((a, s) => a + s.total, 0);

  return (
    <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
      <Animated.View entering={FadeInDown.duration(320)} style={{ marginBottom: 10 }}>
        <View style={[s.filterPills, { backgroundColor: t.border }]}>
          {(["7", "30", "90"] as const).map(d => (
            <TouchableOpacity key={d} activeOpacity={0.7}
              style={[s.pill, period === d && { backgroundColor: mode === "dark" ? Colors.red : Colors.ink }]}
              onPress={() => onPeriodChange(d)}>
              <Text style={[s.pillText, { color: period === d ? Colors.white : t.muted }]}>
                {d === "7" ? "7 días" : d === "30" ? "30 días" : "90 días"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(40).duration(320)}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
          <View style={s.filterPillsH}>
            {["todos", "efectivo", "nequi", "daviplata", "tarjeta"].map(pm => (
              <TouchableOpacity key={pm} activeOpacity={0.7}
                style={[s.pmPill, { backgroundColor: t.bgAlt, borderColor: t.border },
                  pmFilter === pm && { backgroundColor: (PM_COLOR[pm] ?? Colors.ink) + "20", borderColor: PM_COLOR[pm] ?? Colors.ink }]}
                onPress={() => setPmFilter(pm)}>
                <Text style={[s.pmPillText, { color: t.muted },
                  pmFilter === pm && { color: PM_COLOR[pm] ?? Colors.ink, fontFamily: Fonts.bold }]}>
                  {pm.charAt(0).toUpperCase() + pm.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
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
            : filtered.map((sale, i) => {
              const pm = sale.payment_method;
              return (
                <View key={sale.id} style={[s.saleRow, i < filtered.length - 1 && { borderBottomWidth: 1, borderColor: t.border }]}>
                  <View style={[s.pmBadge, { backgroundColor: (PM_COLOR[pm] ?? Colors.dim) + "18" }]}>
                    <Text style={[s.pmBadgeText, { color: PM_COLOR[pm] ?? Colors.dim }]}>{pm.slice(0, 3).toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.saleName, { color: t.text }]}>{sale.clients?.name ?? "Cliente"}</Text>
                    <Text style={[s.saleItems, { color: t.subtle }]}>{saleItemsLabel(sale.pos_sale_items)}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={[s.saleTotal, { color: t.text }]}>{fmt(sale.total)}</Text>
                    <Text style={[s.saleDate, { color: t.subtle }]}>{fmtTime(sale.created_at)}</Text>
                  </View>
                </View>
              );
            })
          }
        </View>
      </Animated.View>
    </ScrollView>
  );
}

// ── Reportes ──────────────────────────────────────────────────────────────────

function TabReportes({ sales, loading }: { sales: Sale[]; loading: boolean }) {
  const { t } = useTheme();
  if (loading) return <LoadingView />;

  const totalIngresos = sales.reduce((a, s) => a + s.total, 0);
  const avgTicket     = sales.length > 0 ? Math.round(totalIngresos / sales.length) : 0;
  const uniqueClients = new Set(sales.map(s => s.client_id).filter(Boolean)).size;
  const topServices   = groupByService(sales);
  const pmTotals      = groupByPaymentMethod(sales);
  const grandTotal    = Object.values(pmTotals).reduce((a, b) => a + b, 0) || 1;

  return (
    <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
      <Animated.View entering={FadeInDown.duration(320)} style={s.kpiGrid}>
        {[
          { label: "Ingresos totales",   value: fmt(totalIngresos)    },
          { label: "Ticket promedio",    value: fmt(avgTicket)        },
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
          <Text style={[s.cardTitle, { color: t.text }]}>Servicios más vendidos</Text>
          {topServices.length === 0
            ? <Text style={[s.kpiSub, { marginTop: 8, color: t.muted }]}>Sin datos de servicios en el período.</Text>
            : topServices.map((svc, i) => (
              <View key={i} style={[s.serviceRow, i < topServices.length - 1 && { marginBottom: 14 }]}>
                <View style={s.serviceTop}>
                  <Text style={[s.serviceName, { color: t.text }]}>{svc.name}</Text>
                  <Text style={[s.serviceVal, { color: t.text }]}>{fmt(svc.val)}</Text>
                </View>
                <View style={[s.serviceTrack, { backgroundColor: t.border }]}>
                  <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                    style={[s.serviceFill, { width: `${svc.pct}%` as any }]} />
                </View>
              </View>
            ))
          }
        </View>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(120).duration(320)}>
        <View style={[s.card, { marginBottom: 16, backgroundColor: t.bgAlt, borderColor: t.border }]}>
          <Text style={[s.cardTitle, { color: t.text }]}>Desglose por método</Text>
          {Object.keys(pmTotals).length === 0
            ? <Text style={[s.kpiSub, { marginTop: 8, color: t.muted }]}>Sin ventas en el período.</Text>
            : (Object.entries(pmTotals) as [string, number][]).map(([pm, val]) => (
              <View key={pm} style={[s.pmRow, { marginBottom: 10 }]}>
                <View style={[s.pmDot, { backgroundColor: PM_COLOR[pm] ?? Colors.dim }]} />
                <Text style={[s.pmName, { color: t.text }]}>{pm.charAt(0).toUpperCase() + pm.slice(1)}</Text>
                <View style={[s.pmBarTrack, { backgroundColor: t.border }]}>
                  <View style={[s.pmBarFill, { width: `${Math.round(val / grandTotal * 100)}%` as any, backgroundColor: PM_COLOR[pm] ?? Colors.dim }]} />
                </View>
                <Text style={[s.pmVal, { color: t.muted }]}>{fmt(val)}</Text>
              </View>
            ))
          }
        </View>
      </Animated.View>
    </ScrollView>
  );
}

// ── Rentabilidad ──────────────────────────────────────────────────────────────

function TabRentabilidad({ sales, loading }: { sales: Sale[]; loading: boolean }) {
  const { t } = useTheme();
  if (loading) return <LoadingView />;

  const ingresos    = sales.reduce((a, s) => a + s.total, 0);
  const topServices = groupByService(sales);

  return (
    <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
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

      {topServices.length > 0 && (
        <Animated.View entering={FadeInDown.delay(120).duration(320)}>
          <View style={[s.card, { marginBottom: 16, backgroundColor: t.bgAlt, borderColor: t.border }]}>
            <Text style={[s.cardTitle, { color: t.text }]}>Ingresos por servicio</Text>
            {topServices.map((svc, i) => (
              <View key={i} style={[s.serviceRow, i < topServices.length - 1 && { marginBottom: 14 }]}>
                <View style={s.serviceTop}>
                  <Text style={[s.serviceName, { color: t.text }]}>{svc.name}</Text>
                  <Text style={[s.serviceVal, { color: t.text }]}>{fmt(svc.val)}</Text>
                </View>
                <View style={[s.serviceTrack, { backgroundColor: t.border }]}>
                  <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                    style={[s.serviceFill, { width: `${svc.pct}%` as any }]} />
                </View>
              </View>
            ))}
          </View>
        </Animated.View>
      )}
    </ScrollView>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function FinanzasScreen() {
  const router = useRouter();
  const { t, mode } = useTheme();
  const [tab, setTab]           = useState<Tab>("resumen");
  const [period, setPeriod]     = useState<"7" | "30" | "90">("30");
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [loading, setLoading]   = useState(true);
  const [sales, setSales]       = useState<Sale[]>([]);
  const [session, setSession]   = useState<CashSession | null>(null);
  const [movements, setMovements] = useState<CashMovement[]>([]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from("tenants").select("id").eq("owner_id", user.id).single()
        .then(({ data }) => { if (data?.id) setTenantId(data.id); });
    });
  }, []);

  useEffect(() => {
    if (tenantId) loadData(tenantId, period);
  }, [tenantId, period]);

  async function loadData(tid: string, p: "7" | "30" | "90") {
    setLoading(true);
    const startDate = startOfPeriod(p);

    const [salesRes, sessionRes] = await Promise.all([
      supabase
        .from("pos_sales")
        .select("id, total, payment_method, created_at, client_id, clients(name), pos_sale_items(quantity, unit_price, services(name))")
        .eq("tenant_id", tid).gte("created_at", startDate)
        .order("created_at", { ascending: false }).limit(500),
      supabase
        .from("cash_sessions")
        .select("id, opened_at, closing_amount, opening_amount")
        .eq("tenant_id", tid).is("closed_at", null).maybeSingle(),
    ]);

    setSales((salesRes.data ?? []) as unknown as Sale[]);
    const activeSession = sessionRes.data as CashSession | null;
    setSession(activeSession);

    if (activeSession?.id) {
      const { data: movData } = await supabase
        .from("cash_movements").select("id, type, amount, description, created_at")
        .eq("session_id", activeSession.id).order("created_at", { ascending: false }).limit(100);
      setMovements((movData ?? []) as CashMovement[]);
    } else {
      setMovements([]);
    }
    setLoading(false);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={["top"]}>
      {/* Header de subpantalla: superficie oscura + acento de marca de 3px */}
      <LinearGradient colors={Gradients.ink} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.header}>
        <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3 }} />
        <View style={s.headerBlob1} />
        <View style={s.headerBlob2} />
        <View style={s.headerTopRow}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={20} color="white" />
          </TouchableOpacity>
          <View style={s.headerIconBox}>
            <Ionicons name="bar-chart-outline" size={15} color="white" />
          </View>
          <Text style={s.headerLabel}>HUB FINANCIERO</Text>
        </View>
        <Text style={s.headerTitle}>Finanzas</Text>
      </LinearGradient>

      {/* Tab bar */}
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
            >
              <Text style={[s.tabBtnText, { color: active ? Colors.white : t.muted }]}>
                {tb.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Content */}
      <View style={[s.content, { backgroundColor: t.bg }]}>
        {tab === "resumen"      && <TabResumen sales={sales} session={session} movements={movements} period={period} loading={loading} />}
        {tab === "caja"         && <TabCaja session={session} movements={movements} loading={loading} />}
        {tab === "ventas"       && <TabVentas sales={sales} period={period} onPeriodChange={p => setPeriod(p)} loading={loading} />}
        {tab === "reportes"     && <TabReportes sales={sales} loading={loading} />}
        {tab === "rentabilidad" && <TabRentabilidad sales={sales} loading={loading} />}
      </View>
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

  tabBarScroll: { borderBottomWidth: 1, flexShrink: 0 },
  tabBar:       { flexDirection: "row", padding: 6, gap: 4, alignItems: "center" },
  tabBtn:       { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  tabBtnText:   { fontSize: 13, fontFamily: Fonts.semibold },

  content: { flex: 1, paddingHorizontal: 16, paddingTop: 16 },

  kpiGrid:  { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 12 },
  kpiCard:  { flex: 1, minWidth: "45%", borderRadius: Radius.md, borderWidth: 1, padding: 14 },
  kpiLabel: { ...MonoLabel, fontSize: 9.5, marginBottom: 8 },
  kpiValue: { fontSize: 18, fontFamily: Fonts.bold, letterSpacing: -0.4, fontVariant: ["tabular-nums"] },
  kpiSub:   { fontSize: 11, fontFamily: Fonts.regular, marginTop: 4 },

  card:      { borderRadius: Radius.lg, borderWidth: 1, padding: 16, ...Shadow.sm },
  cardTitle: { fontSize: 14, fontFamily: Fonts.bold, marginBottom: 4 },
  cardSub:   { fontSize: 11, fontFamily: Fonts.regular, marginBottom: 12 },

  bars:     { flexDirection: "row", alignItems: "flex-end", height: 80, gap: 4, marginTop: 8 },
  barCol:   { flex: 1, alignItems: "center", gap: 4 },
  barTrack: { flex: 1, width: "100%", borderRadius: 4, overflow: "hidden", justifyContent: "flex-end" },
  barFill:  { width: "100%", borderRadius: 4 },
  barLabel: { fontSize: 8, fontFamily: Fonts.mono },

  pmRow:      { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  pmDot:      { width: 8, height: 8, borderRadius: 4 },
  pmName:     { fontSize: 12, fontFamily: Fonts.semibold, width: 72 },
  pmBarTrack: { flex: 1, height: 6, borderRadius: 3, overflow: "hidden" },
  pmBarFill:  { height: "100%", borderRadius: 3 },
  pmVal:      { fontSize: 11, fontFamily: Fonts.mono, width: 80, textAlign: "right" },

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
  serviceTop:   { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  serviceName:  { fontSize: 13, fontFamily: Fonts.semibold, flex: 1 },
  serviceVal:   { fontSize: 13, fontFamily: Fonts.bold, fontVariant: ["tabular-nums"] },
  serviceTrack: { height: 5, borderRadius: 4, overflow: "hidden" },
  serviceFill:  { height: "100%", borderRadius: 4 },
});
