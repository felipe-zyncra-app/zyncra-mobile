import { useState } from "react";
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, Switch } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { Colors, Gradients, Radius, Shadow, Glass } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

function SettingRow({
  icon, color, label, sub, onPress, danger,
}: {
  icon: IoniconName; color?: string; label: string; sub?: string; onPress?: () => void; danger?: boolean;
}) {
  const { t } = useTheme();
  const iconColor = danger ? Colors.red : (color ?? Colors.purple);
  const iconBg    = danger ? Colors.red + "12" : (color ?? Colors.purple) + "12";
  return (
    <TouchableOpacity style={s.row} onPress={onPress} activeOpacity={0.7}>
      <View style={[s.rowIcon, { backgroundColor: iconBg }]}>
        <Ionicons name={icon} size={18} color={iconColor} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[s.rowLabel, { color: danger ? Colors.red : t.text }]}>{label}</Text>
        {sub && <Text style={[s.rowSub, { color: t.muted }]}>{sub}</Text>}
      </View>
      {!danger && <Ionicons name="chevron-forward" size={16} color={t.subtle} />}
    </TouchableOpacity>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const { mode, t, toggle } = useTheme();
  const { tenantId } = useAuth();
  const { tenant: tenantData } = useTenant();
  const tenant = tenantData ? { name: tenantData.name, phone: tenantData.phone } : null;

  const handleLogout = () => {
    Alert.alert("Cerrar sesión", "¿Seguro que quieres salir?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Salir", style: "destructive",
        onPress: async () => {
          await supabase.auth.signOut();
          router.replace("/(auth)/login");
        },
      },
    ]);
  };

  const SECTIONS = [
    {
      title: "Evento especial",
      items: [
        { icon: "airplane-outline" as IoniconName, color: Colors.red, label: "Enviar notificación ahora", sub: "Botones rápidos para el salto en paracaídas 🪂", route: "/(admin)/push-now" },
      ],
    },
    {
      title: "Tu negocio",
      items: [
        { icon: "storefront-outline" as IoniconName,  color: Colors.red,     label: "Mi Tienda",                sub: "Personalización y link de reservas",          route: "/settings/store" },
        { icon: "time-outline" as IoniconName,        color: "#f59e0b",      label: "Horario de atención",      sub: "Días y horas disponibles",                    route: "/settings/schedule" },
        { icon: "cut-outline" as IoniconName,         color: Colors.purple,  label: "Servicios",                sub: "Gestiona tu catálogo de precios",             route: "/settings/services" },
        { icon: "people-outline" as IoniconName,      color: Colors.blue,    label: "Equipo de trabajo",        sub: "Profesionales y permisos",                    route: "/settings/team" },
      ],
    },
    {
      title: "Comunicación",
      items: [
        { icon: "notifications-outline" as IoniconName, color: Colors.success, label: "Recordatorios",          sub: "Alertas automáticas a clientes",      route: "/settings/reminders" },
      ],
    },
    {
      title: "Marketing",
      items: [
        { icon: "logo-whatsapp" as IoniconName,        color: "#25D366",      label: "Campañas WhatsApp",       sub: "Mensajes masivos personalizados",      route: "/(admin)/whatsapp" },
        { icon: "star-outline" as IoniconName,         color: "#f59e0b",      label: "Reseñas Google",           sub: "Solicita reseñas a tus clientes",      route: "/(admin)/reviews-google" },
        { icon: "chatbubbles-outline" as IoniconName,  color: Colors.purple,  label: "Reseñas del sitio",        sub: "Modera las opiniones de tu negocio",   route: "/(admin)/reviews-site" },
      ],
    },
    {
      title: "Finanzas",
      items: [
        { icon: "wallet-outline" as IoniconName,      color: Colors.success, label: "Caja",                sub: "Control de ingresos y egresos",   route: "/(admin)/caja" },
        { icon: "ribbon-outline" as IoniconName,      color: "#f59e0b",      label: "Comisiones",          sub: "Paga a tu equipo de trabajo",     route: "/(admin)/commissions" },
        { icon: "document-text-outline" as IoniconName, color: Colors.blue,  label: "Factura Electrónica", sub: "Emite facturas DIAN vía Factus",  route: "/(admin)/invoices" },
      ],
    },
    {
      title: "Herramientas",
      items: [
        { icon: "bar-chart-outline" as IoniconName,   color: Colors.red,     label: "Reportes",              sub: "Ingresos, servicios y rendimiento", route: "/(admin)/reports" },
        { icon: "options-outline" as IoniconName,     color: "#8b5cf6",      label: "Campos Personalizados", sub: "Datos extra para clientes y citas", route: "/(admin)/custom-fields" },
      ],
    },
    {
      title: "Cuenta",
      items: [
        { icon: "person-outline" as IoniconName,      color: Colors.purple,  label: "Mi perfil",         sub: "Datos personales y contraseña", route: "/settings/profile" },
        { icon: "card-outline" as IoniconName,        color: Colors.blue,    label: "Plan y facturación", sub: "Plan actual: Trial",            route: "/settings/billing" },
      ],
    },
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.header}>
        <View style={s.headerBlob1} />
        <View style={s.headerBlob2} />

        <View style={s.headerTopRow}>
          <View style={s.headerIconBox}>
            <Ionicons name="settings" size={16} color="white" />
          </View>
          <Text style={s.headerLabel}>Ajustes</Text>
        </View>

        <Text style={s.headerTitle}>Configura tu negocio</Text>

        {tenant && (
          <View style={s.headerPill}>
            <Ionicons name="storefront" size={12} color="rgba(255,255,255,.9)" />
            <Text style={s.headerPillText}>{tenant.name}</Text>
          </View>
        )}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 110 }}>
        {/* ── Theme toggle ── */}
        <Animated.View entering={FadeInDown.duration(400)}>
          <Text style={[s.sectionTitle, { color: t.subtle }]}>Apariencia</Text>
          <View style={[s.group, Shadow.sm, { backgroundColor: t.card, borderColor: t.cardBorder }]}>
            <View style={s.row}>
              <View style={[s.rowIcon, { backgroundColor: mode === "dark" ? "#6366f1" + "18" : "#f59e0b" + "18" }]}>
                <Ionicons name={mode === "dark" ? "moon" : "sunny"} size={18} color={mode === "dark" ? "#6366f1" : "#f59e0b"} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.rowLabel, { color: t.text }]}>Modo oscuro</Text>
                <Text style={[s.rowSub, { color: t.muted }]}>{mode === "dark" ? "Activado" : "Desactivado"}</Text>
              </View>
              <Switch
                value={mode === "dark"}
                onValueChange={toggle}
                trackColor={{ false: "rgba(20,15,30,0.12)", true: Colors.red + "60" }}
                thumbColor={mode === "dark" ? Colors.red : "#f4f3f4"}
              />
            </View>
          </View>
        </Animated.View>

        {SECTIONS.map((sec, si) => (
          <Animated.View key={si} entering={FadeInDown.delay((si + 1) * 80).duration(400)}>
            <Text style={[s.sectionTitle, { color: t.subtle }]}>{sec.title}</Text>
            <View style={[s.group, Shadow.sm, { backgroundColor: t.card, borderColor: t.cardBorder }]}>
              {sec.items.map((item, ii) => (
                <View key={ii}>
                  <SettingRow
                    icon={item.icon}
                    color={item.color}
                    label={item.label}
                    sub={item.sub}
                    onPress={item.route ? () => router.push(item.route as any) : undefined}
                  />
                  {ii < sec.items.length - 1 && <View style={[s.divider, { backgroundColor: t.divider }]} />}
                </View>
              ))}
            </View>
          </Animated.View>
        ))}

        <Animated.View entering={FadeInDown.delay(400).duration(400)}>
          <View style={[s.group, Shadow.sm, { backgroundColor: t.card, borderColor: t.cardBorder }]}>
            <SettingRow icon="log-out-outline" label="Cerrar sesión" onPress={handleLogout} danger />
          </View>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(480).duration(400)} style={{ alignItems: "center", marginTop: 24 }}>
          <Text style={{ fontSize: 12, color: t.subtle, fontFamily: "SpaceGrotesk_400Regular" }}>
            Zyncra · v1.0.0 · Hecho en Colombia 🇨🇴
          </Text>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header:          { paddingTop: 14, paddingHorizontal: 20, paddingBottom: 16, overflow: "hidden" },
  headerBlob1:     { position: "absolute", width: 200, height: 200, borderRadius: 100, backgroundColor: "rgba(255,255,255,.06)", top: -80, right: -40 },
  headerBlob2:     { position: "absolute", width: 100, height: 100, borderRadius: 50, backgroundColor: "rgba(0,0,0,.05)", bottom: -30, left: -20 },
  headerTopRow:    { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14, position: "relative", zIndex: 1 },
  headerIconBox:   { width: 32, height: 32, borderRadius: 10, backgroundColor: "rgba(255,255,255,.15)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.2)" },
  headerLabel:     { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: "rgba(255,255,255,.8)" },
  headerTitle:     { fontSize: 22, fontFamily: "SpaceGrotesk_700Bold", color: "white", letterSpacing: -0.5, marginBottom: 12, position: "relative", zIndex: 1 },
  headerPill:      { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,.14)", borderRadius: Radius.full, paddingVertical: 8, paddingHorizontal: 14, alignSelf: "flex-start", borderWidth: 1, borderColor: "rgba(255,255,255,0.2)", position: "relative", zIndex: 1 },
  headerPillText:  { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: "rgba(255,255,255,.9)" },
  sectionTitle: { fontSize: 12, fontFamily: "SpaceGrotesk_700Bold", color: Colors.subtle, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10, marginTop: 20 },
  group:        { ...Glass.cardStrong, borderRadius: Radius.lg, overflow: "hidden" },
  row:          { flexDirection: "row", alignItems: "center", gap: 14, padding: 16 },
  rowIcon:      { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  rowLabel:     { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  rowSub:       { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, marginTop: 2 },
  divider:      { height: 1, backgroundColor: Colors.border, marginLeft: 70 },
});
