import { useEffect, useState } from "react";
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, Switch } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { Config, authedFetch } from "@/lib/config";
import { Colors, Gradients, Radius, Shadow } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";

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

type Tenant = { name: string; phone?: string };

export default function SettingsScreen() {
  const router = useRouter();
  const { mode, t, toggle } = useTheme();
  const { tenantId } = useAuth();
  const [tenant, setTenant] = useState<Tenant | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    supabase.from("tenants").select("name, phone").eq("id", tenantId).single()
      .then(({ data }) => { if (!cancelled && data) setTenant(data); });
    return () => { cancelled = true; };
  }, [tenantId]);

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

  const handleDeleteAccount = () => {
    Alert.alert(
      "Eliminar cuenta",
      "Se eliminará tu cuenta y todos los datos de tu negocio (clientes, citas, ventas, reportes). Esta acción no se puede deshacer.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Continuar", style: "destructive",
          onPress: () => {
            Alert.alert(
              "¿Confirmas la eliminación?",
              "Esta es tu última oportunidad para cancelar.",
              [
                { text: "Cancelar", style: "cancel" },
                {
                  text: "Eliminar cuenta", style: "destructive",
                  onPress: async () => {
                    try {
                      const res = await authedFetch(Config.edgeFunctions.deleteAccount, { method: "POST" });
                      if (!res.ok) {
                        const body = await res.json().catch(() => ({}));
                        throw new Error(body.error || "No se pudo eliminar la cuenta.");
                      }
                      await supabase.auth.signOut();
                      router.replace("/(auth)/login");
                    } catch (e: any) {
                      Alert.alert("Error", e.message || "No se pudo eliminar la cuenta. Intenta de nuevo.");
                    }
                  },
                },
              ],
            );
          },
        },
      ],
    );
  };

  const SECTIONS = [
    {
      title: "Marketing",
      color: "#25D366",
      items: [
        { icon: "chatbubble-ellipses-outline", label: "Chats de WhatsApp", sub: "Responde a tus clientes · Hanna y humano", route: "/(admin)/inbox" },
        { icon: "logo-whatsapp",        label: "Campañas WhatsApp",       sub: "Mensajes masivos personalizados",       route: "/(admin)/whatsapp" },
        { icon: "gift-outline",         label: "Fidelización",            sub: "Recompensas por visitas",               route: "/(admin)/loyalty" },
        { icon: "star-outline",         label: "Reseñas Google",          sub: "Solicita reseñas a tus clientes",       route: "/(admin)/reviews-google" },
        { icon: "chatbubbles-outline",  label: "Reseñas del negocio",     sub: "Modera las opiniones de tu negocio",    route: "/(admin)/reviews-site" },
      ],
    },
    {
      title: "Ventas",
      color: Colors.red,
      items: [
        { icon: "bar-chart-outline",     label: "Módulo Financiero",    sub: "Reportes de ventas y rentabilidad",    route: "/(admin)/finanzas" },
        { icon: "cube-outline",          label: "Inventario",           sub: "Stock y alertas de productos",         route: "/(admin)/inventario" },
        { icon: "wallet-outline",        label: "Caja",                 sub: "Control de ingresos y egresos",        route: "/(admin)/caja" },
        { icon: "ribbon-outline",        label: "Comisiones",           sub: "Paga a tu equipo de trabajo",          route: "/(admin)/commissions" },
        // Factura Electrónica retirada temporalmente del menú (la pantalla
        // invoices.tsx y la integración con Factus siguen en el código).
      ],
    },
    {
      title: "Negocio",
      color: Colors.blue,
      items: [
        { icon: "pricetags-outline",   label: "Servicios",             sub: "Gestiona tu catálogo de precios",      route: "/settings/services" },
        { icon: "people-outline",      label: "Equipo de trabajo",     sub: "Profesionales y permisos",             route: "/settings/team" },
        { icon: "location-outline",    label: "Sedes",                 sub: "Sede activa del celular y fotos",      route: "/settings/locations" },
        { icon: "time-outline",        label: "Horario de atención",   sub: "Días y horas disponibles",             route: "/settings/schedule" },
        { icon: "storefront-outline",  label: "Mi Tienda",             sub: "Personalización y link de reservas",   route: "/settings/store" },
      ],
    },
    {
      title: "Comunicación",
      color: Colors.purple,
      items: [
        { icon: "notifications-outline", label: "Recordatorios",         sub: "Alertas automáticas a clientes",       route: "/settings/reminders" },
        { icon: "bar-chart-outline",     label: "Reportes",              sub: "Ingresos, servicios y rendimiento",    route: "/(admin)/reports" },
        { icon: "options-outline",       label: "Campos personalizados", sub: "Datos extra para clientes y citas",    route: "/(admin)/custom-fields" },
      ],
    },
    {
      title: "Cuenta",
      color: "#f59e0b",
      items: [
        { icon: "person-outline",      label: "Mi perfil",            sub: "Datos personales y contraseña",        route: "/settings/profile" },
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
                    icon={item.icon as IoniconName}
                    color={sec.color}
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
            <View style={[s.divider, { backgroundColor: t.divider }]} />
            <SettingRow icon="trash-outline" label="Eliminar cuenta" onPress={handleDeleteAccount} danger />
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
  group:        { borderWidth: 1, borderRadius: Radius.lg, overflow: "hidden" },
  row:          { flexDirection: "row", alignItems: "center", gap: 14, padding: 16 },
  rowIcon:      { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  rowLabel:     { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  rowSub:       { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, marginTop: 2 },
  divider:      { height: 1, backgroundColor: Colors.border, marginLeft: 70 },
});
