import { useEffect, useState } from "react";
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Linking, Platform } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown, FadeInRight } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { Colors, Gradients, Radius, Shadow } from "@/constants/theme";
import { useTheme } from "@/lib/theme";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

type TenantPlan = {
  name: string;
  plan: string;
  created_at: string;
  plan_expires_at: string | null;
};

const PLANS = {
  trial: {
    label: "Trial gratuito",
    color: "#f59e0b",
    icon: "hourglass-outline" as IoniconName,
    description: "Explora todas las funciones sin costo por 14 días.",
  },
  pro: {
    label: "Pro",
    color: Colors.red,
    icon: "flash-outline" as IoniconName,
    description: "Todo lo que tu negocio necesita para crecer.",
  },
  business: {
    label: "Business",
    color: Colors.purple,
    icon: "business-outline" as IoniconName,
    description: "Para cadenas y negocios con múltiples sedes.",
  },
};

const TRIAL_FEATURES = [
  { label: "Hasta 30 clientes",             ok: true },
  { label: "Hasta 5 servicios",             ok: true },
  { label: "Agenda semanal",                ok: true },
  { label: "1 profesional",                 ok: true },
  { label: "POS básico",                    ok: true },
  { label: "Recordatorios automáticos",     ok: false },
  { label: "Profesionales ilimitados",      ok: false },
  { label: "Clientes y servicios ilimitados", ok: false },
  { label: "Reportes avanzados",            ok: false },
  { label: "Soporte prioritario",           ok: false },
];

const PRO_FEATURES = [
  { label: "Clientes ilimitados",           ok: true },
  { label: "Servicios ilimitados",          ok: true },
  { label: "Agenda completa + historial",   ok: true },
  { label: "Hasta 10 profesionales",        ok: true },
  { label: "POS completo con reportes",     ok: true },
  { label: "Recordatorios automáticos",     ok: true },
  { label: "Página de reservas en línea",   ok: true },
  { label: "Soporte prioritario",           ok: true },
];

const BUSINESS_FEATURES = [
  { label: "Todo lo de Pro",                ok: true },
  { label: "Profesionales ilimitados",      ok: true },
  { label: "Múltiples sedes",               ok: true },
  { label: "Dashboard centralizado",        ok: true },
  { label: "Personalización de marca",      ok: true },
  { label: "Integración con WhatsApp",      ok: true },
  { label: "Gerente de cuenta dedicado",    ok: true },
];

function FeatureRow({ label, ok, delay }: { label: string; ok: boolean; delay: number }) {
  return (
    <Animated.View entering={FadeInRight.delay(delay).duration(300)} style={f.row}>
      <View style={[f.dot, { backgroundColor: ok ? Colors.success + "18" : Colors.border }]}>
        <Ionicons name={ok ? "checkmark" : "close"} size={12} color={ok ? Colors.success : Colors.subtle} />
      </View>
      <Text style={[f.label, !ok && { color: Colors.subtle }]}>{label}</Text>
    </Animated.View>
  );
}

const f = StyleSheet.create({
  row:   { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  dot:   { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text, flex: 1 },
});

function daysLeft(createdAt: string, expiresAt: string | null): number {
  if (expiresAt) {
    const diff = new Date(expiresAt).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / 86400000));
  }
  const trialEnd = new Date(createdAt);
  trialEnd.setDate(trialEnd.getDate() + 14);
  const diff = trialEnd.getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 86400000));
}

const SALES_PHONE = "573160000000"; // número de ventas Zyncra

function openWhatsApp(msg: string) {
  const url = `https://wa.me/${SALES_PHONE}?text=${encodeURIComponent(msg)}`;
  Linking.openURL(url);
}

export default function BillingScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const { tenantId } = useAuth();
  const { tenant: tenantCtx } = useTenant();
  const [tenant, setTenant] = useState<TenantPlan | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    supabase
      .from("tenants")
      .select("name, plan, created_at, plan_expires_at")
      .eq("id", tenantId)
      .single()
      .then(({ data }) => {
        if (!cancelled && data) setTenant(data as TenantPlan);
      });
    return () => { cancelled = true; };
  }, [tenantId]);

  const tenantName = tenantCtx?.name ?? tenant?.name ?? "Tu negocio";

  const plan = (tenant?.plan ?? "trial") as keyof typeof PLANS;
  const planMeta = PLANS[plan] ?? PLANS.trial;
  const remaining = tenant ? daysLeft(tenant.created_at, tenant.plan_expires_at) : 0;
  const isTrial = plan === "trial";
  const isPro   = plan === "pro";

  const upgradeMsg = `Hola, quiero actualizar mi negocio "${tenantName}" al plan Pro de Zyncra.`;
  const businessMsg = `Hola, quiero más información sobre el plan Business de Zyncra para mi negocio "${tenantName}".`;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>

        {/* ── Header ── */}
        <LinearGradient colors={Gradients.ink} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.header}>
          <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, zIndex: 1 }} />
          <View style={s.headerBlob} />
          <View style={s.headerRow}>
            <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
              <Ionicons name="arrow-back" size={20} color="white" />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={s.headerTitle}>Plan y facturación</Text>
              <Text style={s.headerSub}>{tenantName}</Text>
            </View>
          </View>

          {/* Current plan badge */}
          <Animated.View entering={FadeInDown.delay(100).duration(400)} style={s.planBadge}>
            <View style={[s.planBadgeIcon, { backgroundColor: planMeta.color + "22" }]}>
              <Ionicons name={planMeta.icon} size={22} color="white" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.planBadgeLabel}>Plan actual</Text>
              <Text style={s.planBadgeName}>{planMeta.label}</Text>
            </View>
            {isTrial && (
              <View style={s.trialPill}>
                <Text style={s.trialPillText}>{remaining}d restantes</Text>
              </View>
            )}
            {isPro && (
              <View style={[s.trialPill, { backgroundColor: Colors.success + "22" }]}>
                <Ionicons name="checkmark-circle" size={13} color={Colors.success} />
                <Text style={[s.trialPillText, { color: Colors.success }]}>Activo</Text>
              </View>
            )}
          </Animated.View>
        </LinearGradient>

        <View style={{ padding: 20 }}>

          {/* ── Trial warning ── */}
          {isTrial && remaining <= 5 && remaining > 0 && (
            <Animated.View entering={FadeInDown.duration(350)} style={[s.warnCard, Shadow.sm]}>
              <Ionicons name="warning-outline" size={18} color="#f59e0b" />
              <Text style={s.warnText}>
                Tu trial vence en <Text style={{ fontFamily: "SpaceGrotesk_700Bold" }}>{remaining} día{remaining !== 1 ? "s" : ""}</Text>. Actualiza para no perder el acceso.
              </Text>
            </Animated.View>
          )}
          {isTrial && remaining === 0 && (
            <Animated.View entering={FadeInDown.duration(350)} style={[s.warnCard, { borderColor: Colors.red + "33", backgroundColor: Colors.red + "08" }, Shadow.sm]}>
              <Ionicons name="alert-circle-outline" size={18} color={Colors.red} />
              <Text style={[s.warnText, { color: Colors.red }]}>Tu trial ha expirado. Actualiza tu plan para seguir usando Zyncra.</Text>
            </Animated.View>
          )}

          {/* ── Current plan features ── */}
          <Animated.View entering={FadeInDown.delay(80).duration(400)} style={[s.card, Shadow.sm]}>
            <Text style={s.cardTitle}>Tu plan incluye</Text>
            {(isTrial ? TRIAL_FEATURES : isPro ? PRO_FEATURES : BUSINESS_FEATURES).map((feat, i) => (
              <FeatureRow key={i} label={feat.label} ok={feat.ok} delay={i * 30} />
            ))}
          </Animated.View>

          {/* ── Pro plan card (show if on trial) ── */}
          {isTrial && (
            <Animated.View entering={FadeInDown.delay(200).duration(400)} style={{ marginTop: 20 }}>
              <Text style={s.sectionLabel}>Actualiza tu plan</Text>
              <View style={[s.proCard, Shadow.md]}>
                <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.proCardHeader}>
                  <View style={s.proCardHeaderBlob} />
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 }}>
                    <View style={s.proIconBox}>
                      <Ionicons name="flash" size={18} color="white" />
                    </View>
                    <View>
                      <Text style={s.proCardName}>Plan Pro</Text>
                      <Text style={s.proCardTagline}>Todo lo que necesitas</Text>
                    </View>
                    <View style={{ flex: 1, alignItems: "flex-end" }}>
                      <Text style={s.proPrice}>$89.900</Text>
                      <Text style={s.proPeriod}>COP / mes</Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    style={s.upgradeBtn}
                    onPress={() => openWhatsApp(upgradeMsg)}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="logo-whatsapp" size={18} color={Colors.red} />
                    <Text style={s.upgradeBtnText}>Contactar para actualizar</Text>
                  </TouchableOpacity>
                </LinearGradient>

                <View style={{ padding: 16 }}>
                  {PRO_FEATURES.map((feat, i) => (
                    <FeatureRow key={i} label={feat.label} ok={feat.ok} delay={i * 25} />
                  ))}
                </View>
              </View>
            </Animated.View>
          )}

          {/* ── Business card ── */}
          {!isPro ? (
            <Animated.View entering={FadeInDown.delay(300).duration(400)} style={{ marginTop: isTrial ? 16 : 20 }}>
              {!isTrial && <Text style={s.sectionLabel}>Más opciones</Text>}
              <TouchableOpacity
                style={[s.businessCard, Shadow.sm]}
                onPress={() => openWhatsApp(businessMsg)}
                activeOpacity={0.8}
              >
                <View style={[s.businessIconBox, { backgroundColor: Colors.purple + "14" }]}>
                  <Ionicons name="business-outline" size={20} color={Colors.purple} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.businessCardTitle}>Plan Business</Text>
                  <Text style={s.businessCardSub}>Múltiples sedes · Profesionales ilimitados · Precio personalizado</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={Colors.subtle} />
              </TouchableOpacity>
            </Animated.View>
          ) : null}

          {/* ── FAQ ── */}
          <Animated.View entering={FadeInDown.delay(360).duration(400)} style={{ marginTop: 28 }}>
            <Text style={s.sectionLabel}>Preguntas frecuentes</Text>
            {[
              { q: "¿Qué pasa si mi trial expira?", a: "Tu información se guarda de forma segura. Actualiza en cualquier momento para recuperar el acceso completo." },
              { q: "¿Cómo se realiza el pago?", a: "Aceptamos transferencia bancaria, Nequi, Daviplata y tarjeta. Te guiamos por WhatsApp." },
              { q: "¿Puedo cancelar en cualquier momento?", a: "Sí. Sin contratos ni cláusulas de permanencia." },
            ].map((item, i) => (
              <Animated.View key={i} entering={FadeInDown.delay(360 + i * 60).duration(350)} style={[s.faqCard, Shadow.sm]}>
                <Text style={s.faqQ}>{item.q}</Text>
                <Text style={s.faqA}>{item.a}</Text>
              </Animated.View>
            ))}
          </Animated.View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header:           { paddingTop: 16, paddingHorizontal: 24, paddingBottom: 28, overflow: "hidden" },
  headerBlob:       { position: "absolute", width: 220, height: 220, borderRadius: 110, backgroundColor: "rgba(255,255,255,.07)", top: -70, right: -50 },
  headerRow:        { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 20 },
  backBtn:          { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,.10)", alignItems: "center", justifyContent: "center" },
  headerTitle:      { fontSize: 20, fontFamily: "SpaceGrotesk_700Bold", color: "white", letterSpacing: -0.4 },
  headerSub:        { fontSize: 12, color: "rgba(255,255,255,.7)", fontFamily: "SpaceGrotesk_400Regular", marginTop: 2 },
  planBadge:        { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "rgba(255,255,255,.14)", borderRadius: Radius.lg, padding: 14 },
  planBadgeIcon:    { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  planBadgeLabel:   { fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold", color: "rgba(255,255,255,.7)" },
  planBadgeName:    { fontSize: 18, fontFamily: "SpaceGrotesk_700Bold", color: "white", letterSpacing: -0.3 },
  trialPill:        { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(255,255,255,.18)", borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 6 },
  trialPillText:    { fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
  warnCard:         { flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: "#fffbeb", borderRadius: Radius.md, padding: 14, borderWidth: 1, borderColor: "#f59e0b33", marginBottom: 16 },
  warnText:         { flex: 1, fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: "#92400e", lineHeight: 19 },
  card:             { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.lg, padding: 18 },
  cardTitle:        { fontSize: 13, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text, marginBottom: 14 },
  sectionLabel:     { fontSize: 12, fontFamily: "JetBrainsMono_500Medium", color: Colors.subtle, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12 },
  proCard:          { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.xl, overflow: "hidden" },
  proCardHeader:    { padding: 18, overflow: "hidden" },
  proCardHeaderBlob:{ position: "absolute", width: 160, height: 160, borderRadius: 80, backgroundColor: "rgba(255,255,255,.08)", top: -50, right: -30 },
  proIconBox:       { width: 36, height: 36, borderRadius: 12, backgroundColor: "rgba(255,255,255,.2)", alignItems: "center", justifyContent: "center" },
  proCardName:      { fontSize: 18, fontFamily: "SpaceGrotesk_700Bold", color: "white", letterSpacing: -0.4 },
  proCardTagline:   { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: "rgba(255,255,255,.75)" },
  proPrice:         { fontSize: 22, fontFamily: "SpaceGrotesk_700Bold", color: "white", letterSpacing: -0.5 },
  proPeriod:        { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", color: "rgba(255,255,255,.7)", textAlign: "right" },
  upgradeBtn:       { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "white", borderRadius: Radius.full, paddingVertical: 12 },
  upgradeBtnText:   { fontSize: 14, fontFamily: "SpaceGrotesk_700Bold", color: Colors.red },
  businessCard:     { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.lg, padding: 16 },
  businessIconBox:  { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  businessCardTitle:{ fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  businessCardSub:  { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, marginTop: 2 },
  faqCard:          { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, padding: 16, marginBottom: 10 },
  faqQ:             { fontSize: 13, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text, marginBottom: 6 },
  faqA:             { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, lineHeight: 19 },
});
