import { useEffect, useState, useCallback } from "react";
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
import { Colors, Gradients, Radius, Shadow, Glass } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { fmtMoneyFull, fmt12, localDateStr } from "@/lib/format";
import { voidSale as voidRecordedSale } from "@/lib/record-sale";
import { salePaymentLines } from "@/lib/pos-payments";
import ChargeSheet, { PAY_METHODS, methodCfg as getMethodCfg, type ChargeTarget, type LinkedAppt } from "@/components/ChargeSheet";

// ─── Types ────────────────────────────────────────────────────────────────────

type Appt = {
  id: string;
  appointment_time: string;
  status: string;
  client_id: string | null;
  service_id: string | null;
  location_id: string | null;
  clients: { name: string } | null;
  services: { name: string; price: number } | null;
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

function addDays(d: Date, n: number) {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}

function toLinkedAppt(a: Appt): LinkedAppt {
  return {
    id: a.id,
    clientId: a.client_id,
    clientName: a.clients?.name ?? null,
    serviceId: a.service_id,
    serviceName: a.services?.name ?? null,
    servicePrice: Number(a.services?.price ?? 0),
    locationId: a.location_id,
    time: a.appointment_time,
  };
}

// ─── Appointment card ─────────────────────────────────────────────────────────

function ApptCard({ appt, linkedSale, onCobrar, onCancel, index }: {
  appt: Appt;
  linkedSale?: PosSale;
  onCobrar: () => void;
  onCancel: () => void;
  index: number;
}) {
  const price      = Number((appt.services as any)?.price ?? 0);
  const time       = fmt12(appt.appointment_time.slice(0, 5));
  const isActive   = appt.status === "pending" || appt.status === "confirmed";
  const isPaid     = appt.status === "completed";
  const isCancelled = appt.status === "cancelled";

  const accentColor = isPaid ? Colors.success : isCancelled ? Colors.muted : Colors.red;
  const method      = getMethodCfg(linkedSale?.payment_method);
  // Lo realmente cobrado (puede incluir adicionales, productos o descuento)
  const paidTotal   = linkedSale ? Number(linkedSale.total) : null;

  return (
    <Animated.View entering={FadeInRight.delay(index * 60).duration(320)}>
      <View style={[ac.card, Shadow.sm, isCancelled && { opacity: 0.5 }]}>
        {/* Left accent */}
        <View style={[ac.accent, { backgroundColor: accentColor }]} />

        <View style={{ flex: 1, padding: 14 }}>
          {/* Time + price row */}
          <View style={ac.topRow}>
            <View style={[ac.timePill, { backgroundColor: accentColor + "15" }]}>
              <Ionicons name="time-outline" size={11} color={accentColor} />
              <Text style={[ac.timeText, { color: accentColor }]}>{time}</Text>
            </View>
            {(paidTotal ?? price) > 0 && (
              <Text style={[ac.price, isPaid && { color: Colors.success }]}>{fmtMoneyFull(paidTotal ?? price)}</Text>
            )}
          </View>

          {/* Client + service */}
          <Text style={ac.clientName} numberOfLines={1}>
            {appt.clients?.name ?? "Sin cliente"}
          </Text>
          <Text style={ac.serviceName} numberOfLines={1}>
            {appt.services?.name ?? "Sin servicio"}
          </Text>

          {/* Action area */}
          {isActive && (
            <View style={ac.actionRow}>
              <TouchableOpacity style={ac.cancelBtn} onPress={onCancel} activeOpacity={0.75}>
                <Ionicons name="close" size={13} color={Colors.red} />
                <Text style={ac.cancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={ac.cobraBtn} onPress={onCobrar} activeOpacity={0.85}>
                <Ionicons name="card-outline" size={15} color="white" />
                <Text style={ac.cobraText}>Cobrar{price > 0 ? ` ${fmtMoneyFull(price)}` : ""}</Text>
              </TouchableOpacity>
            </View>
          )}

          {isPaid && linkedSale && (
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

          {isCancelled && (
            <View style={[ac.methodTag, { backgroundColor: Colors.muted + "20", alignSelf: "flex-start", marginTop: 10 }]}>
              <Text style={[ac.methodTagText, { color: Colors.muted }]}>Cancelada</Text>
            </View>
          )}
        </View>
      </View>
    </Animated.View>
  );
}

const ac = StyleSheet.create({
  card:        { ...Glass.cardStrong, borderRadius: Radius.lg, flexDirection: "row", marginBottom: 10, overflow: "hidden" },
  accent:      { width: 5 },
  topRow:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  timePill:    { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 5 },
  timeText:    { fontSize: 12, fontFamily: "SpaceGrotesk_700Bold" },
  price:       { fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text },
  clientName:  { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text, marginBottom: 2 },
  serviceName: { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted },
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

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function PosScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const { tenantId } = useAuth();
  const [date, setDate]             = useState(new Date());
  const [appts, setAppts]           = useState<Appt[]>([]);
  const [sales, setSales]           = useState<PosSale[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab]   = useState<"citas" | "cobros">("citas");
  // Hoja de cobro: una cita (precarga servicio + adicionales + cliente) o venta directa
  const [charge, setCharge]         = useState<ChargeTarget | null>(null);

  const load = useCallback(async (d: Date) => {
    if (!tenantId) return;
    const dateStr = localDateStr(d);
    // created_at es UTC: el día local se acota con instantes reales, no con la fecha recortada
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const dayEnd   = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    const [{ data: apptData }, { data: salesData }] = await Promise.all([
      supabase.from("appointments")
        .select("id, appointment_time, status, client_id, service_id, location_id, clients(name), services(name, price)")
        .eq("tenant_id", tenantId)
        .eq("appointment_date", dateStr)
        .order("appointment_time"),
      supabase.from("pos_sales")
        .select("id, created_at, total, payment_method, payments, note, appointment_id, clients(name), pos_sale_items(name, price, quantity)")
        .eq("tenant_id", tenantId)
        .gte("created_at", dayStart.toISOString())
        .lt("created_at", dayEnd.toISOString())
        .order("created_at", { ascending: false }),
    ]);
    setAppts((apptData as unknown as Appt[]) ?? []);
    setSales((salesData as unknown as PosSale[]) ?? []);
    setLoading(false);
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    setLoading(true);
    load(date).then(() => { if (cancelled) return; });
    return () => { cancelled = true; };
  }, [tenantId, date]);

  const onRefresh = async () => { setRefreshing(true); await load(date); setRefreshing(false); };

  const cancelAppt = (appt: Appt) => {
    Alert.alert("Cancelar cita", `¿Cancelar la cita de ${appt.clients?.name ?? "este cliente"}?`, [
      { text: "No", style: "cancel" },
      { text: "Cancelar cita", style: "destructive",
        onPress: async () => {
          await supabase.from("appointments").update({ status: "cancelled" }).eq("id", appt.id);
          await load(date);
        },
      },
    ]);
  };

  const voidSale = (sale: PosSale) => {
    Alert.alert("Anular cobro", `¿Anular ${fmtMoneyFull(sale.total)}?`, [
      { text: "No", style: "cancel" },
      { text: "Anular", style: "destructive",
        onPress: async () => {
          // Borra también el ingreso de caja: la FK es SET NULL, no cascade,
          // y antes la venta anulada seguía sumando en el arqueo.
          const { ok } = await voidRecordedSale(sale.id, sale.appointment_id);
          if (!ok) Alert.alert("No se pudo anular el cobro", "Revisa tu conexión e inténtalo de nuevo.");
          await load(date);
        },
      },
    ]);
  };

  // ── Metrics ──
  const cobrado   = sales.reduce((s, v) => s + Number(v.total), 0);
  const pendingAppts = appts.filter(a => a.status === "pending" || a.status === "confirmed");
  const projected = pendingAppts.reduce((s, a) => s + Number((a.services as any)?.price ?? 0), 0);
  // Pago dividido: se expande el desglose para sumar por método real (no "mixto")
  const byMethod  = PAY_METHODS.map(m => ({
    ...m,
    total: sales.reduce((sum, s) => sum + salePaymentLines(s).filter(l => l.method === m.key).reduce((a, l) => a + l.amount, 0), 0),
  })).filter(m => m.total > 0);

  const isToday   = date.toDateString() === new Date().toDateString();
  const dateLabel = isToday
    ? "Hoy"
    : date.toLocaleDateString("es-CO", { weekday: "short", day: "numeric", month: "short" });

  // Sort: active first, then completed, then cancelled
  const sortedAppts = [...appts].sort((a, b) => {
    const order = (s: string) => s === "pending" || s === "confirmed" ? 0 : s === "completed" ? 1 : 2;
    return order(a.status) - order(b.status);
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
          <TouchableOpacity style={s.headerActionBtn} onPress={() => router.push("/(admin)/pos-history" as any)} activeOpacity={0.8}>
            <Ionicons name="time-outline" size={17} color="white" />
          </TouchableOpacity>
          <TouchableOpacity style={s.headerActionBtn} onPress={() => setCharge({ kind: "direct" })} activeOpacity={0.8}>
            <Ionicons name="add" size={20} color="white" />
          </TouchableOpacity>
        </View>

        <View style={s.headerHeroRow}>
          <View>
            <Text style={s.headerTitle}>Gestión de pagos</Text>
            <View style={s.dateNav}>
              <TouchableOpacity onPress={() => setDate(d => addDays(d, -1))} style={s.navBtn}>
                <Ionicons name="chevron-back" size={14} color="white" />
              </TouchableOpacity>
              <Text style={s.dateLabel}>{dateLabel}</Text>
              <TouchableOpacity onPress={() => setDate(d => addDays(d, 1))} style={s.navBtn} disabled={isToday}>
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

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={Colors.red} size="large" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 110 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.red} />}
        >
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

            {/* Payment breakdown */}
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
                >
                  {active && (
                    <View style={[StyleSheet.absoluteFill, { backgroundColor: Colors.red }]} />
                  )}
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
                  <Ionicons name="calendar-outline" size={40} color={Colors.subtle} style={{ marginBottom: 12 }} />
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
                      linkedSale={sales.find(s => s.appointment_id === a.id)}
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
                  <Ionicons name="receipt-outline" size={40} color={Colors.subtle} style={{ marginBottom: 12 }} />
                  <Text style={s.emptyTitle}>Sin cobros registrados</Text>
                  <Text style={s.emptySub}>Completa citas o toca + para una venta directa</Text>
                </Animated.View>
              ) : (
                sales.map((sale, i) => {
                  const methodCfg = getMethodCfg(sale.payment_method);
                  const timeStr   = new Date(sale.created_at).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
                  const linkedAppt = appts.find(a => a.id === sale.appointment_id);

                  return (
                    <Animated.View key={sale.id} entering={i < 10 ? FadeInRight.delay(i * 55).duration(320) : undefined}>
                      <View style={[s.saleCard, Shadow.sm]}>
                        <View style={[s.saleAccent, { backgroundColor: methodCfg?.color ?? Colors.success }]} />
                        <View style={{ flex: 1, padding: 14 }}>
                          <View style={s.saleTopRow}>
                            <View style={[s.saleTimePill, { backgroundColor: (methodCfg?.color ?? Colors.success) + "15" }]}>
                              <Ionicons name={methodCfg?.icon ?? "cash-outline"} size={11} color={methodCfg?.color ?? Colors.success} />
                              <Text style={[s.saleTime, { color: methodCfg?.color ?? Colors.success }]}>{timeStr}</Text>
                            </View>
                            <Text style={[s.saleTotal, { color: Colors.success }]}>{fmtMoneyFull(sale.total)}</Text>
                          </View>
                          <Text style={s.saleClient} numberOfLines={1}>
                            {linkedAppt ? (linkedAppt.clients?.name ?? "Sin cliente") : (sale.clients?.name ?? "Venta directa")}
                          </Text>
                          <Text style={s.saleService} numberOfLines={1}>
                            {sale.note ?? sale.pos_sale_items?.[0]?.name ?? "—"}
                          </Text>
                          <View style={s.saleBottomRow}>
                            <View style={[s.methodTag, { backgroundColor: (methodCfg?.color ?? Colors.success) + "12" }]}>
                              <Text style={[s.methodTagText, { color: methodCfg?.color ?? Colors.success }]}>
                                {methodCfg?.label ?? sale.payment_method}
                              </Text>
                            </View>
                            <TouchableOpacity onPress={() => voidSale(sale)} style={s.voidBtn}>
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
          onSaved={() => load(date)}
        />
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
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

  heroCard:       { borderRadius: Radius.xl, overflow: "hidden" },
  heroGrad:       { flexDirection: "row", alignItems: "center", padding: 22, gap: 16 },
  heroLabel:      { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: "rgba(255,255,255,.6)", marginBottom: 4 },
  heroValue:      { fontSize: 34, fontFamily: "SpaceGrotesk_700Bold", color: "white", letterSpacing: -1 },
  heroSub:        { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", color: "rgba(255,255,255,.5)", marginTop: 4 },
  projectedBox:   { backgroundColor: "rgba(255,255,255,.1)", borderRadius: Radius.lg, padding: 14, alignItems: "center", minWidth: 110, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)" },
  projectedLabel: { fontSize: 10, fontFamily: "SpaceGrotesk_600SemiBold", color: "rgba(255,255,255,.6)", textTransform: "uppercase", letterSpacing: 0.5 },
  projectedValue: { fontSize: 18, fontFamily: "SpaceGrotesk_700Bold", color: "white", marginTop: 4 },
  projectedSub:   { fontSize: 10, fontFamily: "SpaceGrotesk_400Regular", color: "rgba(255,255,255,.5)", marginTop: 2 },

  methodsCard:    { ...Glass.cardStrong, borderRadius: Radius.lg, padding: 16 },
  methodsTitle:   { fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", color: Colors.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 },
  methodsRow:     { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  methodChip:     { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: Radius.full, paddingHorizontal: 12, paddingVertical: 8 },
  methodChipLabel:{ fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold" },
  methodChipValue:{ fontSize: 13, fontFamily: "SpaceGrotesk_700Bold" },

  tabs:           { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 16 },
  tab:            { flex: 1, borderRadius: Radius.full, overflow: "hidden", ...Glass.card, alignItems: "center" },
  tabActive:      { borderWidth: 0 },
  tabLabel:       { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted, paddingVertical: 11, textAlign: "center" },

  sectionHeader:  { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  sectionDot:     { width: 8, height: 8, borderRadius: 4 },
  sectionTitle:   { fontSize: 12, fontFamily: "SpaceGrotesk_700Bold", color: Colors.muted, textTransform: "uppercase", letterSpacing: 0.5 },

  saleCard:       { ...Glass.cardStrong, borderRadius: Radius.lg, flexDirection: "row", marginBottom: 10, overflow: "hidden" },
  saleAccent:     { width: 5 },
  saleTopRow:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  saleTimePill:   { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 5 },
  saleTime:       { fontSize: 11, fontFamily: "SpaceGrotesk_700Bold" },
  saleTotal:      { fontSize: 16, fontFamily: "SpaceGrotesk_700Bold" },
  saleClient:     { fontSize: 14, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text, marginBottom: 2 },
  saleService:    { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted },
  saleBottomRow:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10 },
  methodTag:      { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: Radius.full, paddingHorizontal: 9, paddingVertical: 4 },
  methodTagText:  { fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold" },
  voidBtn:        { width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.red + "12", alignItems: "center", justifyContent: "center" },

  empty:          { ...Glass.cardStrong, borderRadius: Radius.xl, padding: 44, alignItems: "center", marginTop: 4 },
  emptyTitle:     { fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text, marginBottom: 6 },
  emptySub:       { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, textAlign: "center" },
});
