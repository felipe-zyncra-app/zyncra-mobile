import { useEffect, useState, useMemo, useCallback } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { Colors, Gradients, Radius, Shadow } from "@/constants/theme";
import ErrorState from "@/components/ErrorState";
import { useTheme } from "@/lib/theme";
import { ScreenHeader } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { fmtMoneyFull } from "@/lib/format";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

type HistorySale = {
  id: string;
  created_at: string;
  total: number;
  payment_method: string;
  note: string | null;
  appointment_id: string | null;
  clients: { name: string } | null;
  pos_sale_items: { name: string; price: number; quantity: number }[];
};

const METHODS: { key: string; label: string; icon: IoniconName; color: string }[] = [
  { key: "efectivo",      label: "Efectivo",      icon: "cash-outline",           color: Colors.success },
  { key: "tarjeta",       label: "Tarjeta",        icon: "card-outline",           color: Colors.blue },
  { key: "transferencia", label: "Transferencia",  icon: "phone-portrait-outline", color: Colors.purple },
  { key: "nequi",         label: "Nequi",          icon: "logo-whatsapp",          color: "#00b5a5" },
];

function addMonths(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

export default function PosHistoryScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const { tenantId } = useAuth();
  const [month, setMonth]       = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [sales, setSales]       = useState<HistorySale[]>([]);
  const [loading, setLoading]   = useState(true);

  const load = useCallback(async (m: Date) => {
    if (!tenantId) return;
    setLoading(true);
    const y = m.getFullYear(), mo = m.getMonth();
    const start = new Date(y, mo, 1).toISOString().slice(0, 10);
    const end   = new Date(y, mo + 1, 0).toISOString().slice(0, 10);
    const { data } = await supabase
      .from("pos_sales")
      .select("id,created_at,total,payment_method,note,appointment_id,clients(name),pos_sale_items(name,price,quantity)")
      .eq("tenant_id", tenantId)
      .gte("created_at", `${start}T00:00:00`)
      .lte("created_at", `${end}T23:59:59`)
      .order("created_at", { ascending: false });
    setSales((data ?? []) as unknown as HistorySale[]);
    setLoading(false);
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    load(month).then(() => { if (cancelled) return; });
    return () => { cancelled = true; };
  }, [tenantId, month]);

  const now = new Date();
  const isCurrentMonth = month.getFullYear() === now.getFullYear() && month.getMonth() === now.getMonth();
  const monthLabel = month.toLocaleDateString("es-CO", { month: "long", year: "numeric" });

  const totalRevenue = sales.reduce((s, v) => s + Number(v.total), 0);
  const byMethod = METHODS
    .map(m => ({
      ...m,
      total: sales.filter(s => s.payment_method === m.key).reduce((sum, s) => sum + Number(s.total), 0),
      count: sales.filter(s => s.payment_method === m.key).length,
    }))
    .filter(m => m.total > 0);

  const grouped = useMemo(() => {
    const map: Record<string, HistorySale[]> = {};
    sales.forEach(s => {
      const d = s.created_at.slice(0, 10);
      if (!map[d]) map[d] = [];
      map[d].push(s);
    });
    return Object.keys(map).sort((a, b) => b.localeCompare(a)).map(d => ({ date: d, sales: map[d] }));
  }, [sales]);

  const voidSale = (sale: HistorySale) => {
    Alert.alert("Anular cobro", `¿Anular ${fmtMoneyFull(Number(sale.total))}?`, [
      { text: "No", style: "cancel" },
      { text: "Anular", style: "destructive", onPress: async () => {
        if (sale.appointment_id) {
          await supabase.from("appointments").update({ status: "confirmed" }).eq("id", sale.appointment_id);
        }
        await supabase.from("pos_sale_items").delete().eq("sale_id", sale.id);
        await supabase.from("pos_sales").delete().eq("id", sale.id);
        load(month);
      }},
    ]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader crumb="Ventas" title="Historial de Cobros" onBack={() => router.back()} />
      <View style={[s.monthNav, { backgroundColor: t.chipBg, borderColor: t.line }]}>
        <TouchableOpacity onPress={() => setMonth(m => addMonths(m, -1))} style={s.navBtn}>
          <Ionicons name="chevron-back" size={18} color={t.muted} />
        </TouchableOpacity>
        <Text style={[s.monthLabel, { color: t.ink }]}>{monthLabel}</Text>
        <TouchableOpacity onPress={() => setMonth(m => addMonths(m, 1))} style={s.navBtn} disabled={isCurrentMonth}>
          <Ionicons name="chevron-forward" size={18} color={isCurrentMonth ? t.subtle : t.muted} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={Colors.red} size="large" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <Animated.View entering={FadeInDown.duration(350)}>
            {/* Revenue summary */}
            <View style={[s.summaryCard, Shadow.md]}>
              <LinearGradient colors={Gradients.ink} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.summaryGrad}>
                <View>
                  <Text style={s.summaryLabel}>Total del mes</Text>
                  <Text style={s.summaryValue}>{totalRevenue > 0 ? fmtMoneyFull(totalRevenue) : "—"}</Text>
                  <Text style={s.summarySub}>{sales.length} cobro{sales.length !== 1 ? "s" : ""} registrado{sales.length !== 1 ? "s" : ""}</Text>
                </View>
              </LinearGradient>
            </View>

            {/* Payment breakdown */}
            {byMethod.length > 0 && (
              <View style={[s.methodsCard, Shadow.sm]}>
                <Text style={s.methodsTitle}>Desglose por método</Text>
                {byMethod.map((m, i) => (
                  <View key={m.key} style={[s.methodRow, i < byMethod.length - 1 && { borderBottomWidth: 1, borderBottomColor: Colors.border }]}>
                    <View style={[s.methodIcon, { backgroundColor: m.color + "14" }]}>
                      <Ionicons name={m.icon} size={16} color={m.color} />
                    </View>
                    <Text style={s.methodName}>{m.label}</Text>
                    <Text style={s.methodCount}>{m.count} cobros</Text>
                    <Text style={[s.methodTotal, { color: m.color }]}>{fmtMoneyFull(m.total)}</Text>
                  </View>
                ))}
              </View>
            )}
          </Animated.View>

          {/* Day groups */}
          {grouped.length === 0 ? (
            <Animated.View entering={FadeInDown.delay(100).duration(350)} style={[s.empty, Shadow.sm]}>
              <Ionicons name="receipt-outline" size={40} color={Colors.subtle} style={{ marginBottom: 12 }} />
              <Text style={s.emptyTitle}>Sin cobros este mes</Text>
              <Text style={s.emptySub}>Los cobros registrados aparecerán aquí</Text>
            </Animated.View>
          ) : (
            grouped.map((group, gi) => {
              const dayTotal = group.sales.reduce((sum, s) => sum + Number(s.total), 0);
              const dt = new Date(group.date + "T12:00:00");
              const dayLabel = dt.toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "short" });

              return (
                <Animated.View key={group.date} entering={FadeInDown.delay(gi * 60 + 120).duration(350)}>
                  <View style={s.dayHeader}>
                    <Text style={s.dayLabel}>{dayLabel}</Text>
                    <Text style={s.dayTotal}>{fmtMoneyFull(dayTotal)}</Text>
                  </View>

                  {group.sales.map(sale => {
                    const methodCfg = METHODS.find(m => m.key === sale.payment_method);
                    const timeStr = new Date(sale.created_at).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
                    return (
                      <View key={sale.id} style={[s.saleCard, Shadow.sm]}>
                        <View style={[s.saleAccent, { backgroundColor: methodCfg?.color ?? Colors.success }]} />
                        <View style={{ flex: 1, padding: 12 }}>
                          <View style={s.saleTopRow}>
                            <Text style={s.saleTime}>{timeStr}</Text>
                            <Text style={[s.saleAmount, { color: Colors.success }]}>{fmtMoneyFull(Number(sale.total))}</Text>
                          </View>
                          <Text style={s.saleClient} numberOfLines={1}>
                            {sale.clients?.name ?? "Venta directa"}
                          </Text>
                          <Text style={s.saleDesc} numberOfLines={1}>
                            {sale.note ?? sale.pos_sale_items?.[0]?.name ?? "—"}
                          </Text>
                          <View style={s.saleBottomRow}>
                            <View style={[s.methodTag, { backgroundColor: (methodCfg?.color ?? Colors.success) + "12" }]}>
                              <Ionicons name={methodCfg?.icon ?? "cash-outline"} size={11} color={methodCfg?.color ?? Colors.success} />
                              <Text style={[s.methodTagText, { color: methodCfg?.color ?? Colors.success }]}>
                                {methodCfg?.label ?? sale.payment_method}
                              </Text>
                            </View>
                            <TouchableOpacity onPress={() => voidSale(sale)} style={s.voidBtn}>
                              <Ionicons name="trash-outline" size={14} color={Colors.muted} />
                            </TouchableOpacity>
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
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header:       { paddingTop: 16, paddingHorizontal: 24, paddingBottom: 20 },
  headerRow:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  headerTitle:  { fontSize: 20, fontFamily: "SpaceGrotesk_700Bold", color: "white", letterSpacing: -0.4 },
  iconBtn:      { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,.10)", alignItems: "center", justifyContent: "center" },
  monthNav:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16, alignSelf: "center", borderRadius: 999, borderWidth: 1, paddingVertical: 6, paddingHorizontal: 14, marginTop: 4, marginBottom: 4 },
  navBtn:       { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,.15)", alignItems: "center", justifyContent: "center" },
  monthLabel:   { fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", color: "white", minWidth: 160, textAlign: "center", textTransform: "capitalize" },

  summaryCard:  { borderRadius: Radius.xl, overflow: "hidden", marginBottom: 12 },
  summaryGrad:  { padding: 22 },
  summaryLabel: { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: "rgba(255,255,255,.6)", marginBottom: 4 },
  summaryValue: { fontSize: 36, fontFamily: "SpaceGrotesk_700Bold", color: "white", letterSpacing: -1 },
  summarySub:   { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", color: "rgba(255,255,255,.5)", marginTop: 4 },

  methodsCard:  { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.lg, padding: 16, marginBottom: 16 },
  methodsTitle: { fontSize: 11, fontFamily: "JetBrainsMono_500Medium", color: Colors.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 },
  methodRow:    { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  methodIcon:   { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  methodName:   { flex: 1, fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  methodCount:  { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted },
  methodTotal:  { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", minWidth: 80, textAlign: "right" },

  dayHeader:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10, paddingHorizontal: 2 },
  dayLabel:     { fontSize: 13, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text, textTransform: "capitalize" },
  dayTotal:     { fontSize: 13, fontFamily: "SpaceGrotesk_700Bold", color: Colors.success },

  saleCard:     { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, flexDirection: "row", marginBottom: 8, overflow: "hidden" },
  saleAccent:   { width: 4 },
  saleTopRow:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  saleTime:     { fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted },
  saleAmount:   { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold" },
  saleClient:   { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text, marginBottom: 2 },
  saleDesc:     { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted },
  saleBottomRow:{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 },
  methodTag:    { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: Radius.full, paddingHorizontal: 9, paddingVertical: 4 },
  methodTagText:{ fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold" },
  voidBtn:      { width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.muted + "15", alignItems: "center", justifyContent: "center" },

  empty:        { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.xl, padding: 44, alignItems: "center", marginTop: 8 },
  emptyTitle:   { fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text, marginBottom: 6 },
  emptySub:     { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, textAlign: "center" },
});
