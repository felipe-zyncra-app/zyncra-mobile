import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, Switch } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { Colors, Fonts } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { useTenant } from "@/lib/tenant";
import { Card, MonoTag, SectionLabel, ListRow, TenantBadge } from "@/components/ui";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

// Grupos espejando NAV_GROUPS del portal web (admin/layout.tsx):
// Panel · Marketing · Ventas · Negocio · Cuenta
const SECTIONS: {
  title: string;
  items: { icon: IoniconName; color: string; label: string; sub: string; route: string }[];
}[] = [
  {
    title: "Evento especial",
    items: [
      { icon: "airplane-outline", color: Colors.red, label: "Enviar notificación ahora", sub: "Botones rápidos para el salto en paracaídas 🪂", route: "/(admin)/push-now" },
    ],
  },
  {
    title: "Panel",
    items: [
      { icon: "notifications-outline", color: Colors.success, label: "Recordatorios", sub: "Alertas automáticas a clientes",         route: "/settings/reminders" },
      { icon: "bar-chart-outline",     color: Colors.red,     label: "Reportes",      sub: "Ingresos, servicios y rendimiento",      route: "/(admin)/reports" },
    ],
  },
  {
    title: "Marketing",
    items: [
      { icon: "sparkles-outline",     color: "#a855f7",     label: "Hanna IA",            sub: "Asistente de reservas por WhatsApp",   route: "/(admin)/hanna" },
      { icon: "logo-whatsapp",        color: "#25D366",     label: "Marketing WhatsApp",  sub: "Campañas y mensajes masivos",          route: "/(admin)/whatsapp" },
      { icon: "star-outline",         color: "#f59e0b",     label: "Reseñas Google",      sub: "Solicita reseñas a tus clientes",      route: "/(admin)/reviews-google" },
      { icon: "chatbubbles-outline",  color: Colors.blue,   label: "Reseñas del negocio", sub: "Modera las opiniones de tu negocio",   route: "/(admin)/reviews-site" },
    ],
  },
  {
    title: "Ventas",
    items: [
      { icon: "stats-chart-outline",   color: Colors.red,     label: "Módulo Financiero",   sub: "Ingresos, egresos y balance",    route: "/(admin)/finanzas" },
      { icon: "cube-outline",          color: "#8b5cf6",      label: "Inventario",          sub: "Productos, stock y valor",       route: "/(admin)/inventario" },
      { icon: "wallet-outline",        color: Colors.success, label: "Sistema de Caja",     sub: "Control de ingresos y egresos",  route: "/(admin)/caja" },
      { icon: "ribbon-outline",        color: "#f59e0b",      label: "Comisiones",          sub: "Paga a tu equipo de trabajo",    route: "/(admin)/commissions" },
      { icon: "document-text-outline", color: Colors.blue,    label: "Factura Electrónica", sub: "Emite facturas DIAN vía Factus", route: "/(admin)/invoices" },
    ],
  },
  {
    title: "Compras",
    items: [
      { icon: "cart-outline", color: "#0ea5e9", label: "Proveedores", sub: "Catálogo mayorista y pedidos", route: "/(admin)/proveedores" },
    ],
  },
  {
    title: "Clientes",
    items: [
      { icon: "pulse-outline", color: "#0ea5e9", label: "Historias Clínicas", sub: "Fichas y evoluciones de pacientes", route: "/(admin)/clinical" },
    ],
  },
  {
    title: "Negocio",
    items: [
      { icon: "storefront-outline", color: Colors.red,   label: "Mi Tienda",             sub: "Personalización y link de reservas",  route: "/settings/store" },
      { icon: "time-outline",       color: "#f59e0b",    label: "Horario de atención",   sub: "Días y horas disponibles",            route: "/settings/schedule" },
      { icon: "cut-outline",        color: "#8b5cf6",    label: "Servicios",             sub: "Gestiona tu catálogo de precios",     route: "/settings/services" },
      { icon: "people-outline",     color: Colors.blue,  label: "Equipo",                sub: "Profesionales y permisos",            route: "/settings/team" },
      { icon: "location-outline",   color: "#10b981",    label: "Sedes",                 sub: "Ubicaciones de tu negocio",           route: "/(admin)/locations" },
      { icon: "options-outline",    color: "#8b5cf6",    label: "Campos Personalizados", sub: "Datos extra para clientes y citas",   route: "/(admin)/custom-fields" },
    ],
  },
  {
    title: "Cuenta",
    items: [
      { icon: "person-outline", color: "#6366f1",   label: "Mi perfil",          sub: "Datos personales y contraseña", route: "/settings/profile" },
      { icon: "card-outline",   color: Colors.blue, label: "Plan y facturación", sub: "Tu suscripción de Zyncra",      route: "/settings/billing" },
    ],
  },
];

export default function SettingsScreen() {
  const router = useRouter();
  const { mode, t, toggle } = useTheme();
  const { tenant: tenantData } = useTenant();

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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.canvas }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
        {/* ── Header compacto ── */}
        <Animated.View entering={FadeInDown.duration(350)} style={s.headerRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <MonoTag>Ajustes</MonoTag>
            <Text style={[s.headerTitle, { color: t.ink }]}>Configura tu negocio</Text>
          </View>
          {tenantData && <TenantBadge name={tenantData.name} />}
        </Animated.View>

        {/* ── Apariencia ── */}
        <Animated.View entering={FadeInDown.delay(60).duration(400)}>
          <SectionLabel>Apariencia</SectionLabel>
          <Card>
            <ListRow
              icon={mode === "dark" ? "moon" : "sunny"}
              color={mode === "dark" ? "#6366f1" : "#f59e0b"}
              label="Modo oscuro"
              sub={mode === "dark" ? "Activado" : "Desactivado"}
              last
              right={(
                <Switch
                  value={mode === "dark"}
                  onValueChange={toggle}
                  trackColor={{ false: "rgba(20,15,30,0.12)", true: Colors.red + "60" }}
                  thumbColor={mode === "dark" ? Colors.red : "#f4f3f4"}
                />
              )}
            />
          </Card>
        </Animated.View>

        {SECTIONS.map((sec, si) => (
          <Animated.View key={sec.title} entering={FadeInDown.delay((si + 2) * 60).duration(400)} style={{ marginTop: 18 }}>
            <SectionLabel>{sec.title}</SectionLabel>
            <Card>
              {sec.items.map((item, ii) => (
                <ListRow
                  key={item.route}
                  icon={item.icon}
                  color={item.color}
                  label={item.label}
                  sub={item.sub}
                  last={ii === sec.items.length - 1}
                  onPress={() => router.push(item.route as any)}
                />
              ))}
            </Card>
          </Animated.View>
        ))}

        {/* ── Cerrar sesión ── */}
        <Animated.View entering={FadeInDown.delay(520).duration(400)} style={{ marginTop: 18 }}>
          <Card>
            <TouchableOpacity style={s.logoutRow} onPress={handleLogout} activeOpacity={0.6}>
              <View style={[s.logoutIcon, { backgroundColor: Colors.red + "12" }]}>
                <Ionicons name="log-out-outline" size={17} color={Colors.red} />
              </View>
              <Text style={s.logoutText}>Cerrar sesión</Text>
            </TouchableOpacity>
          </Card>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(580).duration(400)} style={{ alignItems: "center", marginTop: 24 }}>
          <Text style={[s.footer, { color: t.subtle }]}>Zyncra · v1.0.0 · Hecho en Colombia 🇨🇴</Text>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  headerRow:   { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 20 },
  headerTitle: { fontSize: 23, fontFamily: Fonts.bold, letterSpacing: -0.6, marginTop: 3 },
  logoutRow:   { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 13 },
  logoutIcon:  { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  logoutText:  { fontSize: 13.5, fontFamily: Fonts.semibold, color: Colors.red },
  footer:      { fontSize: 12, fontFamily: Fonts.regular },
});
