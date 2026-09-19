import { useEffect, useState, useCallback } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Alert, TextInput, Modal, FlatList, ActivityIndicator,
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
import { fmtMoneyFull, fmtDateCompact } from "@/lib/format";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

// ─── Types ────────────────────────────────────────────────────────────────────

type Professional = {
  id: string;
  name: string;
  color?: string;
};

type CommissionRule = {
  id?: string;
  professional_id: string;
  type: "percentage" | "fixed";
  value: number;
};

type ProSummary = {
  pro: Professional;
  rule: CommissionRule | null;
  appointments_count: number;
  revenue_total: number;
  commission_amount: number;
};

type CommissionPayment = {
  id: string;
  professional_id: string;
  professional_name?: string;
  period_start: string;
  period_end: string;
  appointments_count: number;
  revenue_total: number;
  commission_amount: number;
  paid_at?: string;
  note?: string;
};

type Period = "week" | "month" | "custom";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getRange(period: Period, customStart: string, customEnd: string): { start: string; end: string } {
  const now = new Date();
  if (period === "week") {
    const day = now.getDay();
    const diff = (day === 0 ? -6 : 1) - day;
    const mon = new Date(now); mon.setDate(now.getDate() + diff);
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    return { start: mon.toISOString().slice(0, 10), end: sun.toISOString().slice(0, 10) };
  }
  if (period === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    return { start, end };
  }
  return { start: customStart || now.toISOString().slice(0, 10), end: customEnd || now.toISOString().slice(0, 10) };
}

function calcCommission(rule: CommissionRule | null, revenue: number, count: number) {
  if (!rule) return 0;
  if (rule.type === "percentage") return Math.round(revenue * rule.value / 100);
  return Math.round(rule.value * count);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MiniBar({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data, 1);
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", height: 44, gap: 3, marginTop: 8 }}>
      {data.map((v, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            height: `${Math.max((v / max) * 100, v > 0 ? 8 : 2)}%`,
            backgroundColor: v === 0 ? "rgba(20,15,30,0.07)" : color,
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
    <View style={[kpi.card, Shadow.sm, { backgroundColor: t.bgAlt }]}>
      <View style={[kpi.iconBox, { backgroundColor: color + "18" }]}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <Text style={[kpi.value, { color: t.text }]}>{value}</Text>
      <Text style={[kpi.label, { color: t.muted }]}>{label}</Text>
    </View>
  );
}

const kpi = StyleSheet.create({
  card:    { flex: 1, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, padding: 14, alignItems: "center", gap: 6 },
  iconBox: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  value:   { fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text },
  label:   { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, textAlign: "center" },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function CommissionsScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const [tab, setTab]       = useState(0);
  const { tenantId } = useAuth();

  // Resumen
  const [period, setPeriod]         = useState<Period>("month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd]   = useState("");
  const [summaries, setSummaries]   = useState<ProSummary[]>([]);
  const [chartSlots, setChartSlots] = useState<number[]>([]);
  const [chartLabels, setChartLabels] = useState<string[]>([]);
  const [loadingSum, setLoadingSum] = useState(false);

  // Reglas
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [rules, setRules]   = useState<CommissionRule[]>([]);
  const [editPro, setEditPro] = useState<Professional | null>(null);
  const [editRule, setEditRule] = useState<CommissionRule | null>(null);
  const [ruleType, setRuleType] = useState<"percentage" | "fixed">("percentage");
  const [ruleValue, setRuleValue] = useState("");
  const [savingRule, setSavingRule] = useState(false);

  // Historial
  const [payments, setPayments] = useState<CommissionPayment[]>([]);
  const [loadingPay, setLoadingPay] = useState(false);
  const [filterProIdHist, setFilterProIdHist] = useState<string | null>(null);

  // Liquidar modal
  const [liquidarPro, setLiquidarPro] = useState<ProSummary | null>(null);
  const [liquidarNote, setLiquidarNote] = useState("");
  const [savingLiq, setSavingLiq] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    Promise.all([loadProfessionals(), loadRules()]).then(() => { if (cancelled) return; });
    return () => { cancelled = true; };
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    loadSummaries().then(() => { if (cancelled) return; });
    return () => { cancelled = true; };
  }, [tenantId, period, customStart, customEnd]);

  useEffect(() => {
    if (!tenantId || tab !== 2) return;
    let cancelled = false;
    loadPayments().then(() => { if (cancelled) return; });
    return () => { cancelled = true; };
  }, [tenantId, tab]);

  const loadProfessionals = async () => {
    if (!tenantId) return;
    const { data } = await supabase.from("professionals")
      .select("id, name, color")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("name");
    if (data) setProfessionals(data);
  };

  const loadRules = async () => {
    if (!tenantId) return;
    const { data } = await supabase.from("commission_rules")
      .select("*")
      .eq("tenant_id", tenantId);
    if (data) setRules(data);
  };

  const loadSummaries = useCallback(async () => {
    if (!tenantId) return;
    setLoadingSum(true);
    const { start, end } = getRange(period, customStart, customEnd);

    const [prosRes, rulesRes, apptRes] = await Promise.all([
      supabase.from("professionals").select("id, name, color").eq("tenant_id", tenantId).eq("is_active", true).order("name"),
      supabase.from("commission_rules").select("*").eq("tenant_id", tenantId),
      // Solo citas COBRADAS — una cita agendada o confirmada todavía no es
      // ingreso ni genera comisión hasta que se cobra en el POS.
      supabase.from("appointments")
        .select("id, professional_id, appointment_date, services(price)")
        .eq("tenant_id", tenantId)
        .eq("status", "completed")
        .gte("appointment_date", start)
        .lte("appointment_date", end),
    ]);

    const pros: Professional[]      = prosRes.data ?? [];
    const rulesList: CommissionRule[] = rulesRes.data ?? [];
    const appts: any[]              = apptRes.data ?? [];

    // Lo REALMENTE cobrado (pos_sales) manda sobre el precio de lista del
    // servicio — cubre descuentos, precio variable por foto, etc.
    const aptIds = appts.map((a: any) => a.id).filter(Boolean);
    const posSaleMap: Record<string, number> = {};
    if (aptIds.length > 0) {
      const { data: posSales } = await supabase
        .from("pos_sales")
        .select("appointment_id, total")
        .in("appointment_id", aptIds);
      (posSales ?? []).forEach((s: any) => {
        if (s.appointment_id) posSaleMap[s.appointment_id] = Number(s.total);
      });
    }
    const aptRevenue = (a: any) => posSaleMap[a.id] ?? (a.services?.price ?? 0);

    const result: ProSummary[] = pros.map((pro) => {
      const rule = rulesList.find(r => r.professional_id === pro.id) ?? null;
      const proAppts = appts.filter(a => a.professional_id === pro.id);
      const count   = proAppts.length;
      const revenue = proAppts.reduce((sum: number, a: any) => sum + aptRevenue(a), 0);
      const commission = calcCommission(rule, revenue, count);
      return { pro, rule, appointments_count: count, revenue_total: revenue, commission_amount: commission };
    });

    setSummaries(result);

    const now = new Date();
    if (period === "week" || period === "month") {
      const days = period === "week" ? 7 : new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const baseDate = period === "week"
        ? (() => { const d = new Date(now); d.setDate(now.getDate() - ((now.getDay() + 6) % 7)); return d; })()
        : new Date(now.getFullYear(), now.getMonth(), 1);
      const slots: number[] = [];
      const labels: string[] = [];
      for (let i = 0; i < days; i++) {
        const d = new Date(baseDate); d.setDate(baseDate.getDate() + i);
        const ds = d.toISOString().slice(0, 10);
        const dayAppts = appts.filter((a: any) => (a.appointment_date ?? "").startsWith(ds));
        const dayRev = dayAppts.reduce((s: number, a: any) => s + aptRevenue(a), 0);
        slots.push(dayRev);
        labels.push(period === "week" ? ["L","M","X","J","V","S","D"][i] : String(i + 1));
      }
      setChartSlots(slots);
      setChartLabels(labels);
    } else {
      setChartSlots([]);
      setChartLabels([]);
    }

    setLoadingSum(false);
  }, [tenantId, period, customStart, customEnd]);

  const loadPayments = async () => {
    if (!tenantId) return;
    setLoadingPay(true);
    const { data } = await supabase.from("commission_payments")
      .select("*, professionals(name)")
      .eq("tenant_id", tenantId)
      .order("period_start", { ascending: false })
      .limit(50);
    if (data) {
      setPayments(data.map((p: any) => ({
        ...p,
        professional_name: p.professionals?.name ?? "—",
      })));
    }
    setLoadingPay(false);
  };

  const openEditRule = (pro: Professional) => {
    const existing = rules.find(r => r.professional_id === pro.id) ?? null;
    setEditPro(pro);
    setEditRule(existing);
    setRuleType(existing?.type ?? "percentage");
    setRuleValue(existing ? String(existing.value) : "");
  };

  const saveRule = async () => {
    if (!tenantId || !editPro) return;
    const val = parseFloat(ruleValue);
    if (isNaN(val) || val <= 0) { Alert.alert("Valor inválido", "Ingresa un valor mayor a 0"); return; }
    if (ruleType === "percentage" && val > 100) { Alert.alert("Valor inválido", "El porcentaje no puede superar 100%"); return; }
    setSavingRule(true);

    await supabase.from("commission_rules").upsert({
      tenant_id: tenantId,
      professional_id: editPro.id,
      type: ruleType,
      value: val,
    }, { onConflict: "tenant_id,professional_id" });

    await loadRules();
    await loadSummaries();
    setSavingRule(false);
    setEditPro(null);
  };

  const deleteRule = async (proId: string) => {
    Alert.alert("Eliminar regla", "¿Eliminar la regla de comisión de este profesional?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Eliminar", style: "destructive",
        onPress: async () => {
          await supabase.from("commission_rules").delete().eq("professional_id", proId).eq("tenant_id", tenantId!);
          await loadRules();
          await loadSummaries();
        },
      },
    ]);
  };

  const openLiquidar = (s: ProSummary) => {
    setLiquidarPro(s);
    setLiquidarNote("");
  };

  const confirmLiquidar = async () => {
    if (!tenantId || !liquidarPro) return;
    setSavingLiq(true);
    const { start, end } = getRange(period, customStart, customEnd);
    await supabase.from("commission_payments").insert({
      tenant_id:         tenantId,
      professional_id:   liquidarPro.pro.id,
      period_start:      start,
      period_end:        end,
      appointments_count: liquidarPro.appointments_count,
      revenue_total:     liquidarPro.revenue_total,
      commission_amount: liquidarPro.commission_amount,
      paid_at:           new Date().toISOString(),
      note:              liquidarNote || null,
    });
    setSavingLiq(false);
    setLiquidarPro(null);
    Alert.alert("Liquidado", `Comisión de ${liquidarPro.pro.name} registrada.`);
    loadPayments();
  };

  const totalComisiones = summaries.reduce((s, x) => s + x.commission_amount, 0);
  const totalRevenue    = summaries.reduce((s, x) => s + x.revenue_total, 0);
  const prosConRegla    = summaries.filter(x => x.rule !== null).length;
  const { start: rStart, end: rEnd } = getRange(period, customStart, customEnd);

  // ── Render tabs ─────────────────────────────────────────────────────────────

  const renderResumen = () => (
    <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 20, paddingBottom: 110 }}>
      {/* Period selector */}
      <View style={s.periodRow}>
        {(["week", "month", "custom"] as Period[]).map((p) => (
          <TouchableOpacity
            key={p}
            style={[s.periodBtn, { backgroundColor: t.bgAlt, borderColor: t.border }, period === p && s.periodBtnActive]}
            onPress={() => setPeriod(p)}
          >
            <Text style={[s.periodBtnTxt, { color: t.muted }, period === p && s.periodBtnTxtActive]}>
              {p === "week" ? "Esta semana" : p === "month" ? "Este mes" : "Rango"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {period === "custom" && (
        <Animated.View entering={FadeInDown.duration(300)} style={s.customRow}>
          <TextInput
            style={[s.dateInput, { flex: 1, backgroundColor: t.bgAlt, borderColor: t.border, color: t.text }]}
            placeholder="Inicio (YYYY-MM-DD)"
            placeholderTextColor={t.subtle}
            value={customStart}
            onChangeText={setCustomStart}
          />
          <Text style={{ color: t.muted, fontFamily: "SpaceGrotesk_400Regular" }}>→</Text>
          <TextInput
            style={[s.dateInput, { flex: 1, backgroundColor: t.bgAlt, borderColor: t.border, color: t.text }]}
            placeholder="Fin (YYYY-MM-DD)"
            placeholderTextColor={t.subtle}
            value={customEnd}
            onChangeText={setCustomEnd}
          />
        </Animated.View>
      )}

      <Text style={[s.rangeLabel, { color: t.muted }]}>{fmtDateCompact(rStart)} – {fmtDateCompact(rEnd)}</Text>

      {/* KPIs */}
      <View style={s.kpiRow}>
        <KpiCard label="Total comisiones" value={fmtMoneyFull(totalComisiones)} icon="cash-outline" color={Colors.success} />
        <KpiCard label="Ingresos del período" value={fmtMoneyFull(totalRevenue)} icon="trending-up-outline" color={Colors.blue} />
        <KpiCard label="Con regla" value={`${prosConRegla}/${summaries.length}`} icon="people-outline" color="#f59e0b" />
      </View>

      {chartSlots.length > 0 && chartSlots.some(v => v > 0) && (
        <View style={[s.tableCard, Shadow.sm, { padding: 14, marginBottom: 16 }]}>
          <Text style={{ fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted, marginBottom: 2 }}>
            Ingresos del período
          </Text>
          <Text style={{ fontSize: 18, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text, letterSpacing: -0.5 }}>
            {fmtMoneyFull(totalRevenue)}
          </Text>
          <MiniBar data={chartSlots} color={Colors.blue} />
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
            {chartLabels.filter((_, i) => chartLabels.length <= 14 || i % Math.ceil(chartLabels.length / 7) === 0).map((l, i) => (
              <Text key={i} style={{ fontSize: 8, fontFamily: "SpaceGrotesk_400Regular", color: Colors.subtle }}>{l}</Text>
            ))}
          </View>
        </View>
      )}

      {/* Pro table */}
      {loadingSum ? (
        <ActivityIndicator color={Colors.red} style={{ marginTop: 32 }} />
      ) : summaries.length === 0 ? (
        <View style={s.emptyBox}>
          <Ionicons name="receipt-outline" size={36} color={t.subtle} />
          <Text style={[s.emptyTxt, { color: t.muted }]}>Sin datos en este período</Text>
        </View>
      ) : (
        <View style={[s.tableCard, Shadow.sm, { backgroundColor: t.bgAlt }]}>
          <View style={[s.tableHeader, { backgroundColor: t.bg }]}>
            <Text style={[s.thTxt, { flex: 2, color: t.subtle }]}>Profesional</Text>
            <Text style={[s.thTxt, { flex: 1, textAlign: "right", color: t.subtle }]}>Ingresos</Text>
            <Text style={[s.thTxt, { flex: 1, textAlign: "right", color: t.subtle }]}>Comisión</Text>
            <Text style={[s.thTxt, { width: 70 }]}></Text>
          </View>
          {summaries.map((s2, i) => (
            <View key={s2.pro.id}>
              {i > 0 && <View style={[s.divider, { backgroundColor: t.border }]} />}
              <View style={s.tableRow}>
                <View style={{ flex: 2, flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <View style={[s.proAvatar, { backgroundColor: s2.pro.color ?? Colors.red }]}>
                    <Text style={s.proAvatarTxt}>{s2.pro.name[0]}</Text>
                  </View>
                  <View>
                    <Text style={[s.proName, { color: t.text }]}>{s2.pro.name}</Text>
                    <Text style={[s.proCitas, { color: t.muted }]}>{s2.appointments_count} citas</Text>
                  </View>
                </View>
                <Text style={[s.cellTxt, { flex: 1, textAlign: "right", color: t.text }]}>{fmtMoneyFull(s2.revenue_total)}</Text>
                <Text style={[s.cellTxtBold, { flex: 1, textAlign: "right", color: Colors.success }]}>
                  {fmtMoneyFull(s2.commission_amount)}
                </Text>
                <View style={{ width: 70, alignItems: "flex-end" }}>
                  {s2.rule && s2.appointments_count > 0 ? (
                    <TouchableOpacity style={s.liqBtn} onPress={() => openLiquidar(s2)}>
                      <Text style={s.liqBtnTxt}>Liquidar</Text>
                    </TouchableOpacity>
                  ) : (
                    <Text style={{ fontSize: 11, color: Colors.subtle, fontFamily: "SpaceGrotesk_400Regular" }}>—</Text>
                  )}
                </View>
              </View>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );

  const renderReglas = () => (
    <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 20, paddingBottom: 110 }}>
      <Text style={s.hint}>
        Define cómo se calcula la comisión de cada profesional. Sin regla → comisión $0.
      </Text>
      {professionals.length === 0 ? (
        <View style={s.emptyBox}>
          <Ionicons name="people-outline" size={36} color={Colors.subtle} />
          <Text style={s.emptyTxt}>Sin profesionales activos</Text>
        </View>
      ) : (
        <View style={[s.tableCard, Shadow.sm]}>
          {professionals.map((pro, i) => {
            const rule = rules.find(r => r.professional_id === pro.id) ?? null;
            return (
              <View key={pro.id}>
                {i > 0 && <View style={s.divider} />}
                <View style={s.ruleRow}>
                  <View style={[s.proAvatar, { backgroundColor: pro.color ?? Colors.red }]}>
                    <Text style={s.proAvatarTxt}>{pro.name[0]}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.proName}>{pro.name}</Text>
                    {rule ? (
                      <Text style={s.ruleBadge}>
                        {rule.type === "percentage" ? `${rule.value}% de ingresos` : `$${rule.value.toLocaleString("es-CO")} por cita`}
                      </Text>
                    ) : (
                      <Text style={[s.ruleBadge, { color: Colors.subtle }]}>Sin regla</Text>
                    )}
                  </View>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <TouchableOpacity style={s.editBtn} onPress={() => openEditRule(pro)}>
                      <Ionicons name="pencil-outline" size={14} color={Colors.blue} />
                    </TouchableOpacity>
                    {rule && (
                      <TouchableOpacity style={[s.editBtn, { backgroundColor: Colors.red + "12" }]} onPress={() => deleteRule(pro.id)}>
                        <Ionicons name="trash-outline" size={14} color={Colors.red} />
                      </TouchableOpacity>
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

  const renderHistorial = () => {
    const filteredPayments = filterProIdHist
      ? payments.filter(p => p.professional_id === filterProIdHist)
      : payments;

    return (
    <View style={{ flex: 1 }}>
      {professionals.length > 1 && (
        <ScrollView automaticallyAdjustKeyboardInsets
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 10, gap: 8, flexDirection: "row" }}
          style={{ backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border, maxHeight: 52 }}
        >
          <TouchableOpacity
            onPress={() => setFilterProIdHist(null)}
            style={[s.filterChip, filterProIdHist === null && s.filterChipActive]}
          >
            <Text style={[s.filterChipTxt, filterProIdHist === null && s.filterChipTxtActive]}>Todos</Text>
          </TouchableOpacity>
          {professionals.map(pro => (
            <TouchableOpacity
              key={pro.id}
              onPress={() => setFilterProIdHist(prev => prev === pro.id ? null : pro.id)}
              style={[s.filterChip, filterProIdHist === pro.id && s.filterChipActive]}
            >
              <Text style={[s.filterChipTxt, filterProIdHist === pro.id && s.filterChipTxtActive]}>
                {pro.name.split(" ")[0]}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
      {loadingPay ? (
        <ActivityIndicator color={Colors.red} style={{ marginTop: 32 }} />
      ) : filteredPayments.length === 0 ? (
        <View style={[s.emptyBox, { marginTop: 40 }]}>
          <Ionicons name="document-text-outline" size={36} color={Colors.subtle} />
          <Text style={s.emptyTxt}>Sin liquidaciones registradas</Text>
        </View>
      ) : (
        <FlatList
          data={filteredPayments}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: 20, paddingBottom: 110 }}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          renderItem={({ item }) => (
            <View style={[s.payCard, Shadow.sm]}>
              <View style={s.payHeader}>
                <View style={[s.proAvatar, { backgroundColor: Colors.blue }]}>
                  <Text style={s.proAvatarTxt}>{(item.professional_name ?? "?")[0]}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.proName}>{item.professional_name}</Text>
                  <Text style={s.proCitas}>{fmtDateCompact(item.period_start)} – {fmtDateCompact(item.period_end)}</Text>
                </View>
                <Text style={s.payAmount}>{fmtMoneyFull(item.commission_amount)}</Text>
              </View>
              <View style={s.payDetails}>
                <Text style={s.payDetailTxt}>{item.appointments_count} citas · {fmtMoneyFull(item.revenue_total)} ingresos</Text>
                {item.note ? <Text style={[s.payDetailTxt, { color: Colors.muted }]}>{item.note}</Text> : null}
                {item.paid_at ? (
                  <Text style={[s.payDetailTxt, { color: Colors.success }]}>
                    Pagado {new Date(item.paid_at).toLocaleDateString("es-CO")}
                  </Text>
                ) : null}
              </View>
            </View>
          )}
        />
      )}
    </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      {/* Header */}
      <ScreenHeader crumb="Ventas" title="Comisiones" subtitle="Gestiona pagos a tu equipo" onBack={() => router.back()} />

      {/* Tab bar */}
      <View style={[s.tabBar, { backgroundColor: t.bgAlt, borderBottomColor: t.border }]}>
        {["Resumen", "Reglas", "Historial"].map((label, i) => (
          <TouchableOpacity key={i} style={s.tabItem} onPress={() => setTab(i)}>
            <Text style={[s.tabTxt, { color: t.muted }, tab === i && s.tabTxtActive]}>{label}</Text>
            {tab === i && <View style={s.tabUnderline} />}
          </TouchableOpacity>
        ))}
      </View>

      {/* Content */}
      {tab === 0 && renderResumen()}
      {tab === 1 && renderReglas()}
      {tab === 2 && renderHistorial()}

      {/* Edit Rule Modal */}
      <Modal visible={!!editPro} animationType="slide" transparent>
        <View style={m.overlay}>
          <View style={m.sheet}>
            <View style={m.handle} />
            <Text style={m.title}>
              {editRule ? "Editar regla" : "Configurar regla"} — {editPro?.name}
            </Text>

            <Text style={m.label}>Tipo de comisión</Text>
            <View style={m.typeRow}>
              {(["percentage", "fixed"] as const).map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[m.typeBtn, ruleType === t && m.typeBtnActive]}
                  onPress={() => setRuleType(t)}
                >
                  <Ionicons
                    name={t === "percentage" ? "pricetag-outline" : "cash-outline"}
                    size={16}
                    color={ruleType === t ? Colors.white : Colors.muted}
                  />
                  <Text style={[m.typeTxt, ruleType === t && m.typeTxtActive]}>
                    {t === "percentage" ? "% de ingresos" : "Fijo por cita"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={m.label}>{ruleType === "percentage" ? "Porcentaje (%)" : "Monto por cita ($)"}</Text>
            <TextInput
              style={m.input}
              keyboardType="numeric"
              placeholder={ruleType === "percentage" ? "Ej: 10" : "Ej: 20000"}
              placeholderTextColor={Colors.subtle}
              value={ruleValue}
              onChangeText={setRuleValue}
            />

            {ruleValue && !isNaN(parseFloat(ruleValue)) && (
              <View style={m.preview}>
                <Ionicons name="information-circle-outline" size={14} color={Colors.blue} />
                <Text style={m.previewTxt}>
                  {ruleType === "percentage"
                    ? `Por $100.000 en ingresos → comisión de ${fmtMoneyFull(Math.round(100000 * parseFloat(ruleValue) / 100))}`
                    : `Por 10 citas → comisión de ${fmtMoneyFull(parseFloat(ruleValue) * 10)}`
                  }
                </Text>
              </View>
            )}

            <View style={m.actions}>
              <TouchableOpacity style={m.cancelBtn} onPress={() => setEditPro(null)}>
                <Text style={m.cancelTxt}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={m.saveBtn} onPress={saveRule} disabled={savingRule}>
                {savingRule
                  ? <ActivityIndicator color="white" size="small" />
                  : <Text style={m.saveTxt}>Guardar</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Liquidar Modal */}
      <Modal visible={!!liquidarPro} animationType="slide" transparent>
        <View style={m.overlay}>
          <View style={m.sheet}>
            <View style={m.handle} />
            <Text style={m.title}>Liquidar comisión</Text>

            {liquidarPro && (
              <>
                <View style={liq.summary}>
                  <View style={[s.proAvatar, { backgroundColor: liquidarPro.pro.color ?? Colors.red, alignSelf: "center" }]}>
                    <Text style={s.proAvatarTxt}>{liquidarPro.pro.name[0]}</Text>
                  </View>
                  <Text style={liq.proName}>{liquidarPro.pro.name}</Text>
                  <Text style={liq.period}>{fmtDateCompact(rStart)} – {fmtDateCompact(rEnd)}</Text>

                  <View style={liq.grid}>
                    <View style={liq.cell}>
                      <Text style={liq.cellVal}>{liquidarPro.appointments_count}</Text>
                      <Text style={liq.cellLbl}>Citas</Text>
                    </View>
                    <View style={liq.cell}>
                      <Text style={liq.cellVal}>{fmtMoneyFull(liquidarPro.revenue_total)}</Text>
                      <Text style={liq.cellLbl}>Ingresos</Text>
                    </View>
                    <View style={liq.cell}>
                      <Text style={[liq.cellVal, { color: Colors.success }]}>{fmtMoneyFull(liquidarPro.commission_amount)}</Text>
                      <Text style={liq.cellLbl}>Comisión</Text>
                    </View>
                  </View>

                  {liquidarPro.rule && (
                    <View style={liq.rulePill}>
                      <Ionicons name="checkmark-circle-outline" size={13} color={Colors.success} />
                      <Text style={liq.rulePillTxt}>
                        Regla: {liquidarPro.rule.type === "percentage"
                          ? `${liquidarPro.rule.value}% de ingresos`
                          : `$${liquidarPro.rule.value.toLocaleString("es-CO")} por cita`}
                      </Text>
                    </View>
                  )}
                </View>

                <Text style={m.label}>Nota (opcional)</Text>
                <TextInput
                  style={m.input}
                  placeholder="Ej: Pago en efectivo, transferencia..."
                  placeholderTextColor={Colors.subtle}
                  value={liquidarNote}
                  onChangeText={setLiquidarNote}
                />

                <View style={m.actions}>
                  <TouchableOpacity style={m.cancelBtn} onPress={() => setLiquidarPro(null)}>
                    <Text style={m.cancelTxt}>Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={m.saveBtn} onPress={confirmLiquidar} disabled={savingLiq}>
                    {savingLiq
                      ? <ActivityIndicator color="white" size="small" />
                      : <Text style={m.saveTxt}>Confirmar pago</Text>}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  header:       { paddingTop: 16, paddingHorizontal: 24, paddingBottom: 20 },
  headerRow:    { flexDirection: "row", alignItems: "center", gap: 14 },
  backBtn:      { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" },
  headerTitle:  { fontSize: 22, fontFamily: "SpaceGrotesk_700Bold", color: "white", letterSpacing: -0.5 },
  headerSub:    { fontSize: 13, color: "rgba(255,255,255,.75)", fontFamily: "SpaceGrotesk_400Regular", marginTop: 2 },
  tabBar:       { flexDirection: "row", backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border },
  tabItem:      { flex: 1, alignItems: "center", paddingVertical: 12 },
  tabTxt:       { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted },
  tabTxtActive: { color: Colors.red, fontFamily: "SpaceGrotesk_700Bold" },
  tabUnderline: { position: "absolute", bottom: 0, left: 12, right: 12, height: 2, backgroundColor: Colors.red, borderRadius: 1 },

  periodRow:       { flexDirection: "row", gap: 8, marginBottom: 12 },
  periodBtn:       { flex: 1, paddingVertical: 8, borderRadius: Radius.md, backgroundColor: Colors.white, alignItems: "center", borderWidth: 1, borderColor: Colors.border },
  periodBtnActive: { backgroundColor: Colors.red, borderColor: Colors.red },
  periodBtnTxt:    { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted },
  periodBtnTxtActive: { color: Colors.white, fontFamily: "SpaceGrotesk_700Bold" },
  customRow:    { flexDirection: "row", gap: 8, alignItems: "center", marginBottom: 12 },
  dateInput:    { backgroundColor: Colors.white, borderRadius: Radius.md, padding: 10, fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: Colors.text, borderWidth: 1, borderColor: Colors.border },
  rangeLabel:   { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, marginBottom: 16, textAlign: "center" },

  kpiRow:   { flexDirection: "row", gap: 10, marginBottom: 20 },

  tableCard:   { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.lg, overflow: "hidden", marginBottom: 16 },
  tableHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, backgroundColor: Colors.cream2 },
  thTxt:       { fontSize: 11, fontFamily: "JetBrainsMono_500Medium", color: Colors.subtle, textTransform: "uppercase", letterSpacing: 0.5 },
  tableRow:    { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  divider:     { height: 1, backgroundColor: Colors.border, marginHorizontal: 16 },

  proAvatar:    { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  proAvatarTxt: { fontSize: 13, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
  proName:      { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  proCitas:     { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted },

  cellTxt:     { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: Colors.text },
  cellTxtBold: { fontSize: 13, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text },

  liqBtn:    { backgroundColor: Colors.success + "18", paddingVertical: 4, paddingHorizontal: 8, borderRadius: Radius.sm },
  liqBtnTxt: { fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", color: Colors.success },

  ruleRow:   { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
  ruleBadge: { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: Colors.blue, marginTop: 2 },
  editBtn:   { width: 30, height: 30, borderRadius: 8, backgroundColor: Colors.blue + "12", alignItems: "center", justifyContent: "center" },

  hint: { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, marginBottom: 16, lineHeight: 18 },

  payCard:    { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.lg, padding: 16 },
  payHeader:  { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  payAmount:  { fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", color: Colors.success },
  payDetails: { gap: 4, borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: 10 },
  payDetailTxt: { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: Colors.subtle },

  emptyBox: { alignItems: "center", justifyContent: "center", gap: 12, paddingVertical: 40 },
  emptyTxt: { fontSize: 14, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted },

  filterChip:       { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, backgroundColor: Colors.cream2, borderWidth: 1, borderColor: Colors.border },
  filterChipActive: { backgroundColor: Colors.ink, borderColor: Colors.ink },
  filterChipTxt:    { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted },
  filterChipTxtActive: { color: "white" },
});

const m = StyleSheet.create({
  overlay:   { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet:     { backgroundColor: Colors.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, gap: 16 },
  handle:    { width: 40, height: 4, backgroundColor: Colors.border, borderRadius: 2, alignSelf: "center", marginBottom: 8 },
  title:     { fontSize: 18, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text },
  label:     { fontSize: 12, fontFamily: "JetBrainsMono_500Medium", color: Colors.muted, textTransform: "uppercase", letterSpacing: 0.5 },
  input:     { backgroundColor: Colors.cream2, borderRadius: Radius.md, padding: 14, fontSize: 14, fontFamily: "SpaceGrotesk_400Regular", color: Colors.text },
  typeRow:   { flexDirection: "row", gap: 10 },
  typeBtn:   { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: Radius.md, backgroundColor: Colors.cream2, borderWidth: 1, borderColor: Colors.border },
  typeBtnActive: { backgroundColor: Colors.blue, borderColor: Colors.blue },
  typeTxt:   { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted },
  typeTxtActive: { color: Colors.white, fontFamily: "SpaceGrotesk_700Bold" },
  preview:   { flexDirection: "row", gap: 8, alignItems: "center", backgroundColor: Colors.blue + "10", padding: 12, borderRadius: Radius.md },
  previewTxt: { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: Colors.blue, flex: 1 },
  actions:   { flexDirection: "row", gap: 12 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, alignItems: "center" },
  cancelTxt: { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted },
  saveBtn:   { flex: 1, padding: 14, borderRadius: Radius.md, backgroundColor: Colors.red, alignItems: "center" },
  saveTxt:   { fontSize: 14, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
});

const liq = StyleSheet.create({
  summary:  { backgroundColor: Colors.cream2, borderRadius: Radius.lg, padding: 16, alignItems: "center", gap: 8 },
  proName:  { fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text },
  period:   { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted },
  grid:     { flexDirection: "row", gap: 0, width: "100%", marginTop: 8 },
  cell:     { flex: 1, alignItems: "center", gap: 4 },
  cellVal:  { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text },
  cellLbl:  { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted },
  rulePill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: Colors.success + "12", paddingVertical: 6, paddingHorizontal: 12, borderRadius: Radius.full, marginTop: 4 },
  rulePillTxt: { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.success },
});
