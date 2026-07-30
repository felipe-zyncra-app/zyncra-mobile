import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { Colors, Gradients, Radius, Shadow } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { fmtMoneyFull } from "@/lib/format";

type StaffInfo = {
  id: string; name: string; role: string; email: string | null;
  tenantName: string; tenantId: string; color?: string;
};

type CommissionData = {
  appointments_count: number;
  revenue_total: number;
  commission_amount: number;
  rule: { type: "percentage" | "fixed"; value: number } | null;
};

function getMonthRange() {
  const now   = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  return { start, end };
}

function getWeekRange() {
  const now  = new Date();
  const day  = now.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  const mon  = new Date(now); mon.setDate(now.getDate() + diff);
  const sun  = new Date(mon); sun.setDate(mon.getDate() + 6);
  return { start: mon.toISOString().slice(0, 10), end: sun.toISOString().slice(0, 10) };
}

export default function StaffProfileScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useTheme();
  const [info, setInfo]   = useState<StaffInfo | null>(null);
  const [commMonth, setCommMonth] = useState<CommissionData | null>(null);
  const [commWeek, setCommWeek]   = useState<CommissionData | null>(null);
  const [loadingComm, setLoadingComm] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data: pro } = await supabase
        .from("professionals")
        .select("id, name, role, email, color, tenants(id, name)")
        .eq("user_id", user.id)
        .single();
      if (cancelled || !pro) return;
      const staffInfo: StaffInfo = {
        id:         pro.id,
        name:       pro.name,
        role:       pro.role,
        email:      pro.email ?? user.email ?? null,
        tenantName: (pro.tenants as any)?.name ?? "Tu negocio",
        tenantId:   (pro.tenants as any)?.id ?? "",
        color:      pro.color,
      };
      setInfo(staffInfo);
      loadCommissions(pro.id, (pro.tenants as any)?.id ?? "");
    })();
    return () => { cancelled = true; };
  }, [user]);

  const loadCommissions = async (proId: string, tenantId: string) => {
    setLoadingComm(true);
    const { start: ms, end: me } = getMonthRange();
    const { start: ws, end: we } = getWeekRange();

    // Solo citas COBRADAS — una cita agendada o confirmada todavía no es
    // ingreso ni genera comisión hasta que se cobra en el POS.
    const [ruleRes, monthAppts, weekAppts] = await Promise.all([
      supabase.from("commission_rules").select("type, value").eq("professional_id", proId).eq("tenant_id", tenantId).maybeSingle(),
      supabase.from("appointments")
        .select("id, status, services(price)")
        .eq("professional_id", proId)
        .eq("tenant_id", tenantId)
        .eq("status", "completed")
        .gte("appointment_date", ms)
        .lte("appointment_date", me),
      supabase.from("appointments")
        .select("id, status, services(price)")
        .eq("professional_id", proId)
        .eq("tenant_id", tenantId)
        .eq("status", "completed")
        .gte("appointment_date", ws)
        .lte("appointment_date", we),
    ]);

    const rule = ruleRes.data ?? null;

    // Lo REALMENTE cobrado (pos_sales) manda sobre el precio de lista del
    // servicio — cubre descuentos, precio variable por foto, etc.
    const allIds = [...(monthAppts.data ?? []), ...(weekAppts.data ?? [])].map((a: any) => a.id).filter(Boolean);
    const posSaleMap: Record<string, number> = {};
    if (allIds.length > 0) {
      const { data: posSales } = await supabase
        .from("pos_sales")
        .select("appointment_id, total")
        .in("appointment_id", [...new Set(allIds)]);
      (posSales ?? []).forEach((s: any) => {
        if (s.appointment_id) posSaleMap[s.appointment_id] = Number(s.total);
      });
    }

    const calcComm = (appts: any[]) => {
      const count   = appts.length;
      const revenue = appts.reduce((s: number, a: any) => s + (posSaleMap[a.id] ?? (a.services?.price ?? 0)), 0);
      let commission = 0;
      if (rule) {
        commission = rule.type === "percentage"
          ? Math.round(revenue * rule.value / 100)
          : Math.round(rule.value * count);
      }
      return { appointments_count: count, revenue_total: revenue, commission_amount: commission, rule };
    };

    setCommMonth(calcComm(monthAppts.data ?? []));
    setCommWeek(calcComm(weekAppts.data ?? []));
    setLoadingComm(false);
  };

  const handleLogout = () => {
    Alert.alert("Cerrar sesión", "¿Seguro que quieres salir?", [
      { text: "Cancelar", style: "cancel" },
      { text: "Salir", style: "destructive", onPress: async () => {
        await supabase.auth.signOut();
        router.replace("/(auth)/login");
      }},
    ]);
  };

  const initials = info
    ? info.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()
    : "?";

  const avatarColor = info?.color ?? Colors.red;

  const now = new Date();
  const monthName = now.toLocaleDateString("es-CO", { month: "long" });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      {/* Header */}
      <LinearGradient colors={Gradients.ink} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.header}>
        <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, zIndex: 1 }} />
        <View style={s.headerBlob} />
        <Animated.View entering={FadeInDown.duration(400)} style={{ alignItems: "center", position: "relative", zIndex: 1 }}>
          <View style={[s.avatarRing, { borderColor: avatarColor + "60" }]}>
            <View style={[s.avatarInner, { backgroundColor: avatarColor }]}>
              <Text style={s.avatarText}>{initials}</Text>
            </View>
          </View>
          <Text style={s.name}>{info?.name ?? "..."}</Text>
          <Text style={s.role}>{info?.role ?? ""}</Text>
          <View style={s.businessPill}>
            <Ionicons name="business-outline" size={12} color="rgba(255,255,255,.8)" />
            <Text style={s.businessText}>{info?.tenantName ?? ""}</Text>
          </View>
        </Animated.View>
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 120 }}>

        {/* Comisiones this month */}
        <Animated.View entering={FadeInDown.delay(80).duration(400)}>
          <Text style={s.sectionLabel}>Mis comisiones · {monthName}</Text>
          <View style={[s.commCard, Shadow.sm, { backgroundColor: t.bgAlt }]}>
            {loadingComm ? (
              <ActivityIndicator color={Colors.red} style={{ paddingVertical: 24 }} />
            ) : commMonth ? (
              <>
                <View style={s.commMain}>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.commLabel, { color: t.muted }]}>Comisión del mes</Text>
                    <Text style={[s.commAmount, { color: t.text }]}>{fmtMoneyFull(commMonth.commission_amount)}</Text>
                    {commMonth.rule ? (
                      <Text style={s.commRule}>
                        {commMonth.rule.type === "percentage"
                          ? `${commMonth.rule.value}% de ingresos`
                          : `$${commMonth.rule.value.toLocaleString("es-CO")} por cita`}
                      </Text>
                    ) : (
                      <Text style={[s.commRule, { color: Colors.subtle }]}>Sin regla configurada</Text>
                    )}
                  </View>
                  <View style={[s.commIcon, { backgroundColor: Colors.success + "14" }]}>
                    <Ionicons name="cash-outline" size={24} color={Colors.success} />
                  </View>
                </View>

                <View style={s.commGrid}>
                  <View style={s.commStat}>
                    <Text style={s.commStatVal}>{commMonth.appointments_count}</Text>
                    <Text style={s.commStatLabel}>Citas</Text>
                  </View>
                  <View style={[s.commStatDivider]} />
                  <View style={s.commStat}>
                    <Text style={s.commStatVal}>{fmtMoneyFull(commMonth.revenue_total)}</Text>
                    <Text style={s.commStatLabel}>Ingresos generados</Text>
                  </View>
                </View>

                {/* Reparto: cuánto es para mí vs. cuánto se queda el negocio */}
                <View style={s.splitRow}>
                  <View style={[s.splitCell, { backgroundColor: Colors.success + "12" }]}>
                    <Text style={[s.splitVal, { color: Colors.success }]}>{fmtMoneyFull(commMonth.commission_amount)}</Text>
                    <Text style={s.splitLabel}>Para mí</Text>
                  </View>
                  <View style={[s.splitCell, { backgroundColor: t.bg }]}>
                    <Text style={[s.splitVal, { color: t.muted }]}>{fmtMoneyFull(Math.max(0, commMonth.revenue_total - commMonth.commission_amount))}</Text>
                    <Text style={s.splitLabel}>Para el negocio</Text>
                  </View>
                </View>
              </>
            ) : null}
          </View>
        </Animated.View>

        {/* Esta semana */}
        {!loadingComm && commWeek && (
          <Animated.View entering={FadeInDown.delay(140).duration(400)} style={{ marginTop: 12 }}>
            <View style={[s.weekCard, Shadow.sm, { backgroundColor: t.bgAlt }]}>
              <View style={[s.weekIconBox, { backgroundColor: Colors.blue + "14" }]}>
                <Ionicons name="calendar-outline" size={16} color={Colors.blue} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.weekLabel, { color: t.text }]}>Esta semana</Text>
                <Text style={[s.weekSub, { color: t.muted }]}>{commWeek.appointments_count} citas · {fmtMoneyFull(commWeek.revenue_total)} en ingresos</Text>
              </View>
              <Text style={s.weekAmount}>{fmtMoneyFull(commWeek.commission_amount)}</Text>
            </View>
          </Animated.View>
        )}

        {/* Info de cuenta */}
        <Animated.View entering={FadeInDown.delay(200).duration(400)} style={{ marginTop: 20 }}>
          <Text style={s.sectionLabel}>Cuenta</Text>
          <View style={[s.card, Shadow.sm, { backgroundColor: t.bgAlt }]}>
            <View style={s.infoRow}>
              <View style={[s.infoIcon, { backgroundColor: t.bg }]}><Ionicons name="mail-outline" size={16} color={t.muted} /></View>
              <View style={{ flex: 1 }}>
                <Text style={[s.infoLabel, { color: t.muted }]}>Correo electrónico</Text>
                <Text style={[s.infoValue, { color: t.text }]}>{info?.email ?? "—"}</Text>
              </View>
            </View>
            <View style={[s.divider, { backgroundColor: t.border }]} />
            <View style={s.infoRow}>
              <View style={[s.infoIcon, { backgroundColor: t.bg }]}><Ionicons name="briefcase-outline" size={16} color={t.muted} /></View>
              <View style={{ flex: 1 }}>
                <Text style={[s.infoLabel, { color: t.muted }]}>Cargo</Text>
                <Text style={[s.infoValue, { color: t.text }]}>{info?.role ?? "—"}</Text>
              </View>
            </View>
          </View>
        </Animated.View>

        {/* Logout */}
        <Animated.View entering={FadeInDown.delay(260).duration(400)} style={{ marginTop: 16 }}>
          <TouchableOpacity style={[s.logoutBtn, Shadow.sm, { backgroundColor: t.bgAlt }]} onPress={handleLogout} activeOpacity={0.8}>
            <Ionicons name="log-out-outline" size={18} color={Colors.red} />
            <Text style={s.logoutText}>Cerrar sesión</Text>
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header:       { paddingTop: 32, paddingBottom: 40, paddingHorizontal: 24, overflow: "hidden" },
  headerBlob:   { position: "absolute", width: 200, height: 200, borderRadius: 100, backgroundColor: "rgba(255,255,255,.08)", top: -60, right: -40 },
  avatarRing:   { width: 88, height: 88, borderRadius: 44, borderWidth: 2.5, borderColor: "rgba(255,255,255,.4)", alignItems: "center", justifyContent: "center", marginBottom: 14 },
  avatarInner:  { width: 78, height: 78, borderRadius: 39, alignItems: "center", justifyContent: "center" },
  avatarText:   { fontSize: 28, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
  name:         { fontSize: 22, fontFamily: "SpaceGrotesk_700Bold", color: "white", letterSpacing: -0.5 },
  role:         { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: "rgba(255,255,255,.8)", marginTop: 4 },
  businessPill: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(255,255,255,.14)", borderRadius: Radius.full, paddingHorizontal: 12, paddingVertical: 5, marginTop: 10 },
  businessText: { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: "rgba(255,255,255,.85)" },

  sectionLabel: { fontSize: 11, fontFamily: "JetBrainsMono_500Medium", color: Colors.subtle, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 },

  commCard:   { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.lg, padding: 16, overflow: "hidden" },
  commMain:   { flexDirection: "row", alignItems: "flex-start", gap: 14, marginBottom: 16 },
  commLabel:  { fontSize: 11, fontFamily: "JetBrainsMono_500Medium", color: Colors.muted, textTransform: "uppercase", letterSpacing: 0.5 },
  commAmount: { fontSize: 32, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text, letterSpacing: -1, marginTop: 4 },
  commRule:   { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: Colors.success, marginTop: 4 },
  commIcon:   { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  commGrid:   { flexDirection: "row", borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: 14 },
  commStat:   { flex: 1, alignItems: "center", gap: 2 },
  commStatDivider: { width: 1, backgroundColor: Colors.border, alignSelf: "stretch" },
  commStatVal:   { fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text },
  commStatLabel: { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted },

  splitRow:   { flexDirection: "row", gap: 8, marginTop: 12 },
  splitCell:  { flex: 1, borderRadius: Radius.md, padding: 10, alignItems: "center", gap: 2 },
  splitVal:   { fontSize: 14, fontFamily: "SpaceGrotesk_700Bold" },
  splitLabel: { fontSize: 10, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted },

  weekCard:    { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.lg, padding: 14 },
  weekIconBox: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  weekLabel:   { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  weekSub:     { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, marginTop: 2 },
  weekAmount:  { fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", color: Colors.blue },

  card:     { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.lg, overflow: "hidden" },
  infoRow:  { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  infoIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: Colors.cream2, alignItems: "center", justifyContent: "center" },
  infoLabel:{ fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted },
  infoValue:{ fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text, marginTop: 2 },
  divider:  { height: 1, backgroundColor: Colors.border, marginHorizontal: 14 },

  logoutBtn:  { backgroundColor: Colors.white, borderRadius: Radius.md, padding: 16, flexDirection: "row", alignItems: "center", gap: 10 },
  logoutText: { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.red },
});
