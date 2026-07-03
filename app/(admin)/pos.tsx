import { useEffect, useState, useCallback } from "react";
import { useRouter } from "expo-router";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, ActivityIndicator, Modal, Alert,
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
import ManualSaleModal from "@/components/ManualSaleModal";

// ─── Types ────────────────────────────────────────────────────────────────────

type Appt = {
  id: string;
  appointment_time: string;
  status: string;
  clients: { name: string } | null;
  services: { name: string; price: number } | null;
};

type PosSale = {
  id: string;
  created_at: string;
  total: number;
  payment_method: string;
  note: string | null;
  appointment_id: string | null;
  clients: { name: string } | null;
  pos_sale_items: { name: string; price: number; quantity: number }[];
};

// ─── Config ───────────────────────────────────────────────────────────────────

const METHODS = [
  { key: "efectivo",      label: "Efectivo",       icon: "cash-outline" as const,           color: Colors.success },
  { key: "tarjeta",       label: "Tarjeta",         icon: "card-outline" as const,           color: Colors.blue },
  { key: "transferencia", label: "Transferencia",   icon: "phone-portrait-outline" as const, color: Colors.purple },
  { key: "nequi",         label: "Nequi",           icon: "logo-whatsapp" as const,          color: "#00b5a5" },
];

function addDays(d: Date, n: number) {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}

// ─── Payment Modal ────────────────────────────────────────────────────────────

function PaymentModal({ appt, onConfirm, onClose }: {
  appt: Appt | null;
  onConfirm: (method: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTheme();
  const [method, setMethod] = useState("efectivo");
  const [saving, setSaving] = useState(false);
  const price = Number((appt?.services as any)?.price ?? 0);

  useEffect(() => { setMethod("efectivo"); setSaving(false); }, [appt]);
  if (!appt) return null;

  return (
    <Modal visible={!!appt} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: Colors.cream2 }}>
        <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={pm.header}>
          <View style={pm.headerRow}>
            <TouchableOpacity onPress={onClose} style={pm.closeBtn}>
              <Ionicons name="close" size={20} color="white" />
            </TouchableOpacity>
            <Text style={pm.title}>Cobrar cita</Text>
            <View style={{ width: 40 }} />
          </View>

          {/* Receipt summary */}
          <View style={pm.receipt}>
            <View style={pm.receiptRow}>
              <Text style={pm.receiptLabel}>Cliente</Text>
              <Text style={pm.receiptVal}>{appt.clients?.name ?? "Sin cliente"}</Text>
            </View>
            <View style={pm.divider} />
            <View style={pm.receiptRow}>
              <Text style={pm.receiptLabel}>Servicio</Text>
              <Text style={pm.receiptVal}>{appt.services?.name ?? "Sin servicio"}</Text>
            </View>
            <View style={pm.divider} />
            <View style={pm.receiptRow}>
              <Text style={pm.receiptLabel}>Hora</Text>
              <Text style={pm.receiptVal}>{fmt12(appt.appointment_time.slice(0, 5))}</Text>
            </View>
            <View style={[pm.divider, { backgroundColor: "rgba(255,255,255,.3)" }]} />
            <View style={pm.receiptRow}>
              <Text style={[pm.receiptLabel, { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold" }]}>Total</Text>
              <Text style={pm.totalVal}>{price > 0 ? fmtMoneyFull(price) : "—"}</Text>
            </View>
          </View>
        </LinearGradient>

        <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 120 }}>
          <Text style={pm.sectionLabel}>¿Cómo pagó el cliente?</Text>
          {METHODS.map(m => {
            const active = method === m.key;
            return (
              <TouchableOpacity
                key={m.key}
                style={[pm.methodRow, active && pm.methodRowActive]}
                onPress={() => setMethod(m.key)}
                activeOpacity={0.75}
              >
                {active && <View style={[StyleSheet.absoluteFill, { backgroundColor: Colors.red, borderRadius: Radius.md }]} />}
                <View style={[pm.methodIcon, { backgroundColor: active ? "rgba(255,255,255,.2)" : m.color + "15" }]}>
                  <Ionicons name={m.icon} size={20} color={active ? "white" : m.color} />
                </View>
                <Text style={[pm.methodLabel, active && { color: "white" }]}>{m.label}</Text>
                {active && <Ionicons name="checkmark-circle" size={20} color="white" style={{ marginLeft: "auto" }} />}
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={pm.bottomBar}>
          <TouchableOpacity
            style={[pm.btn, saving && { opacity: 0.6 }]}
            onPress={async () => { setSaving(true); await onConfirm(method); setSaving(false); }}
            disabled={saving}
            activeOpacity={0.85}
          >
            <View style={pm.btnGrad}>
              {saving
                ? <ActivityIndicator color="white" />
                : <>
                    <Ionicons name="checkmark-circle" size={18} color="white" />
                    <Text style={pm.btnText}>{price > 0 ? `Confirmar cobro · ${fmtMoneyFull(price)}` : "Completar cita"}</Text>
                  </>
              }
            </View>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const pm = StyleSheet.create({
  header:       { paddingTop: 16, paddingHorizontal: 20, paddingBottom: 24 },
  headerRow:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 },
  closeBtn:     { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,.2)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.3)" },
  title:        { fontSize: 18, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
  receipt:      { backgroundColor: "rgba(255,255,255,.18)", borderRadius: Radius.lg, paddingHorizontal: 16, paddingVertical: 8, borderWidth: 1, borderColor: "rgba(255,255,255,0.25)" },
  receiptRow:   { flexDirection: "row", justifyContent: "space-between", paddingVertical: 11 },
  receiptLabel: { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: "rgba(255,255,255,.75)" },
  receiptVal:   { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: "white" },
  totalVal:     { fontSize: 20, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
  divider:      { height: 1, backgroundColor: "rgba(255,255,255,.15)" },
  sectionLabel: { fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", color: Colors.muted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 12 },
  methodRow:       { flexDirection: "row", alignItems: "center", gap: 14, ...Glass.cardStrong, borderRadius: Radius.md, padding: 14, marginBottom: 10, overflow: "hidden" },
  methodRowActive: { borderWidth: 0 },
  methodIcon:      { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  methodLabel:     { fontSize: 15, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  bottomBar:    { padding: 20, paddingBottom: 34, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.6)", backgroundColor: "rgba(244,244,249,0.85)" },
  btn:          { borderRadius: Radius.full, overflow: "hidden" },
  btnGrad: { paddingVertical: 16, alignItems: "center", backgroundColor: Colors.red },
  btnText:      { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
});

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
  const methodCfg   = METHODS.find(m => m.key === linkedSale?.payment_method);

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
            {price > 0 && (
              <Text style={[ac.price, isPaid && { color: Colors.success }]}>{fmtMoneyFull(price)}</Text>
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
              {methodCfg && (
                <View style={[ac.methodTag, { backgroundColor: methodCfg.color + "12" }]}>
                  <Ionicons name={methodCfg.icon} size={11} color={methodCfg.color} />
                  <Text style={[ac.methodTagText, { color: methodCfg.color }]}>{methodCfg.label}</Text>
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
  const [payAppt, setPayAppt]       = useState<Appt | null>(null);
  const [showManual, setShowManual] = useState(false);

  const load = useCallback(async (d: Date) => {
    if (!tenantId) return;
    const dateStr = localDateStr(d);
    // created_at es UTC: el día local se acota con instantes reales, no con la fecha recortada
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const dayEnd   = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    const [{ data: apptData }, { data: salesData }] = await Promise.all([
      supabase.from("appointments")
        .select("id, appointment_time, status, clients(name), services(name, price)")
        .eq("tenant_id", tenantId)
        .eq("appointment_date", dateStr)
        .order("appointment_time"),
      supabase.from("pos_sales")
        .select("id, created_at, total, payment_method, note, appointment_id, clients(name), pos_sale_items(name, price, quantity)")
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

  const handlePay = async (appt: Appt, paymentMethod: string) => {
    const price = Number((appt.services as any)?.price ?? 0);
    const prevStatus = appt.status;
    const { error: statusError } = await supabase.from("appointments").update({ status: "completed" }).eq("id", appt.id);
    if (statusError) {
      Alert.alert("No se pudo registrar el cobro", "Revisa tu conexión e inténtalo de nuevo.");
      return;
    }
    const { error: saleError } = await supabase.from("pos_sales").insert({
      tenant_id: tenantId,
      client_id: null,
      appointment_id: appt.id,
      subtotal: price,
      total: price,
      payment_method: paymentMethod,
      note: appt.services?.name ?? null,
    });
    if (saleError) {
      await supabase.from("appointments").update({ status: prevStatus }).eq("id", appt.id);
      Alert.alert("No se pudo registrar el cobro", "Revisa tu conexión e inténtalo de nuevo.");
      return;
    }
    setPayAppt(null);
    await load(date);
  };

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
          if (sale.appointment_id) {
            await supabase.from("appointments").update({ status: "confirmed" }).eq("id", sale.appointment_id);
          }
          await supabase.from("pos_sale_items").delete().eq("sale_id", sale.id);
          const { error: voidError } = await supabase.from("pos_sales").delete().eq("id", sale.id);
          if (voidError) Alert.alert("No se pudo anular el cobro", "Revisa tu conexión e inténtalo de nuevo.");
          await load(date);
        },
      },
    ]);
  };

  // ── Metrics ──
  const cobrado   = sales.reduce((s, v) => s + Number(v.total), 0);
  const pendingAppts = appts.filter(a => a.status === "pending" || a.status === "confirmed");
  const projected = pendingAppts.reduce((s, a) => s + Number((a.services as any)?.price ?? 0), 0);
  const byMethod  = METHODS.map(m => ({
    ...m,
    total: sales.filter(s => s.payment_method === m.key).reduce((sum, s) => sum + Number(s.total), 0),
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
          <TouchableOpacity style={s.headerActionBtn} onPress={() => setShowManual(true)} activeOpacity={0.8}>
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
              <LinearGradient colors={["#1a1a2e", "#16213e"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.heroGrad}>
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
                      onCobrar={() => setPayAppt(a)}
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
                  const methodCfg = METHODS.find(m => m.key === sale.payment_method);
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

      <PaymentModal
        appt={payAppt}
        onConfirm={(method) => handlePay(payAppt!, method)}
        onClose={() => setPayAppt(null)}
      />

      {tenantId && (
        <ManualSaleModal
          visible={showManual}
          tenantId={tenantId}
          onClose={() => setShowManual(false)}
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
