import { useState } from "react";
import { View, Text, ScrollView, StyleSheet, Pressable, Alert, Share, ActivityIndicator } from "react-native";
import * as Linking from "expo-linking";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { Config, authedFetch } from "@/lib/config";
import { textoParaUsuario } from "@/lib/db";
import Constants from "expo-constants";
import { Colors, Fonts, Gradients } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { useTenant } from "@/lib/tenant";
import { useAuth } from "@/lib/auth";
import { Card, MonoTag, SectionLabel, ListRow } from "@/components/ui";
import { ThemePicker } from "@/components/ThemePicker";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

/** `route` abre una pantalla de la app; `url`, una página del portal en el navegador. */
type Item = { icon: IoniconName; label: string; sub: string; route?: string; url?: string; color?: string };

// Ordenado por lo que un dueño toca más desde el teléfono: primero lo que
// define el negocio, luego el dinero, los clientes y el marketing. Apariencia
// y cuenta van al final, como en los ajustes del propio teléfono.
// Cada sección tiene UN color; `color` en el ítem solo para logos de marca.
// El `crumb` de cada pantalla destino repite el nombre de su sección.
const SECTIONS: { title: string; tint: string; items: Item[] }[] = [
  {
    title: "Negocio",
    // No Colors.blue: el #0027fe casi desaparece sobre la card oscura.
    tint: "#3b82f6",
    items: [
      { icon: "business-outline",   label: "Info del negocio",    sub: "Nombre, contacto y zona horaria",  route: "/settings/business-info" },
      { icon: "cut-outline",        label: "Servicios",           sub: "Tu catálogo, precios y duración",  route: "/settings/services" },
      { icon: "time-outline",       label: "Horario de atención", sub: "Días y horas en que atiendes",     route: "/settings/schedule" },
      { icon: "people-outline",     label: "Equipo",              sub: "Profesionales y permisos",         route: "/settings/team" },
      { icon: "location-outline",   label: "Sedes",               sub: "Ubicaciones de tu negocio",        route: "/settings/locations" },
      { icon: "storefront-outline", label: "Mi Tienda",           sub: "Tu página y link de reservas",     route: "/settings/store" },
    ],
  },
  {
    title: "Dinero",
    tint: Colors.success,
    items: [
      { icon: "bar-chart-outline",     label: "Reportes",            sub: "Ingresos, servicios y rendimiento", route: "/(admin)/reports" },
      { icon: "stats-chart-outline",   label: "Módulo financiero",   sub: "Ingresos, egresos y balance",       route: "/(admin)/finanzas" },
      { icon: "wallet-outline",        label: "Sistema de caja",     sub: "Apertura, cierre y movimientos",    route: "/(admin)/caja" },
      { icon: "ribbon-outline",        label: "Nómina",              sub: "Básico, comisiones y pagos del equipo", route: "/(admin)/commissions" },
      { icon: "document-text-outline", label: "Factura electrónica", sub: "Facturas DIAN vía Factus",          route: "/(admin)/invoices" },
    ],
  },
  {
    title: "Clientes",
    tint: "#ec4899",
    items: [
      { icon: "notifications-outline", label: "Recordatorios",         sub: "Avisos automáticos antes de la cita", route: "/settings/reminders" },
      { icon: "gift-outline",          label: "Fidelización",          sub: "Premios por visitas",                 route: "/(admin)/loyalty" },
      { icon: "pulse-outline",         label: "Historias clínicas",    sub: "Fichas y evoluciones",                route: "/(admin)/clinical" },
      { icon: "options-outline",       label: "Campos personalizados", sub: "Datos extra de clientes y citas",     route: "/(admin)/custom-fields" },
    ],
  },
  {
    title: "Marketing",
    tint: "#8b5cf6",
    items: [
      { icon: "chatbox-ellipses-outline", label: "Bandeja de WhatsApp", sub: "Conversaciones con tus clientes",  route: "/(admin)/inbox", color: "#25D366" },
      { icon: "sparkles-outline",         label: "Hanna IA",            sub: "Asistente de reservas por WhatsApp", route: "/(admin)/hanna" },
      { icon: "megaphone-outline",        label: "Campañas WhatsApp",   sub: "Mensajes masivos a tus clientes",  route: "/(admin)/whatsapp" },
      { icon: "star-outline",             label: "Reseñas Google",      sub: "Pide reseñas a tus clientes",       route: "/(admin)/reviews-google" },
      { icon: "chatbubbles-outline",      label: "Reseñas del negocio", sub: "Modera lo que opinan de ti",       route: "/(admin)/reviews-site" },
    ],
  },
  {
    title: "Inventario y compras",
    tint: "#0ea5e9",
    items: [
      { icon: "cube-outline", label: "Inventario",  sub: "Productos, stock y valor",     route: "/(admin)/inventario" },
      { icon: "cart-outline", label: "Proveedores", sub: "Catálogo mayorista y pedidos", route: "/(admin)/proveedores" },
    ],
  },
];

function initialsOf(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => w[0]).join("");
  return (letters || "Z").toUpperCase();
}

export default function SettingsScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const { tenant } = useTenant();
  const { session, cerrarSesion } = useAuth();
  const [deleting, setDeleting] = useState(false);
  const [saliendo, setSaliendo] = useState(false);

  const email = session?.user?.email ?? "";
  const bookingLink = tenant?.slug ? `${Config.urls.booking}${tenant.slug}` : "";
  const bookingShort = bookingLink.replace(/^https?:\/\/(www\.)?/, "");

  const handleShare = async () => {
    if (!bookingLink) return;
    try {
      await Share.share({ message: bookingLink });
    } catch {
      // El usuario cerró la hoja o el SO no pudo abrirla: nada que hacer.
    }
  };

  const handleLogout = () => {
    Alert.alert("Cerrar sesión", "¿Seguro que quieres salir?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Salir", style: "destructive",
        onPress: async () => {
          // cerrarSesion borra el push_token de este teléfono, cancela los
          // recordatorios locales (con nombres de clientes) y cierra la sesión
          // también sin red. Con signOut() a secas, sin señal el dueño seguía
          // adentro y el teléfono seguía recibiendo avisos (ARQ-05 / SEG-14).
          setSaliendo(true);
          try { await cerrarSesion(); } finally { setSaliendo(false); }
        },
      },
    ]);
  };

  const deleteAccount = async () => {
    setDeleting(true);
    try {
      const res = await authedFetch(Config.edgeFunctions.deleteAccount, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(textoParaUsuario(body.error, "No se pudo eliminar la cuenta. Intenta de nuevo o escríbenos a soporte@zyncra.app."));
      }
      // La cuenta ya no existe: se limpia lo local (token, recordatorios, sede).
      await cerrarSesion();
    } catch (e: unknown) {
      setDeleting(false);
      const msg = e instanceof Error && e.message ? e.message : "No se pudo eliminar la cuenta. Intenta de nuevo.";
      Alert.alert("No se eliminó la cuenta", msg);
    }
  };

  const handleDeleteAccount = () => {
    if (deleting) return;
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
                { text: "Eliminar cuenta", style: "destructive", onPress: deleteAccount },
              ]
            );
          },
        },
      ]
    );
  };

  const accountItems: Item[] = [
    { icon: "person-outline",    label: "Mi perfil",       sub: email || "Datos personales y contraseña", route: "/settings/profile" },
    { icon: "help-buoy-outline", label: "Centro de ayuda", sub: "Guías paso a paso para usar Zyncra",     route: "/(admin)/help" },
    // Apple 5.1.1(i): la política de privacidad tiene que poder abrirse desde la app.
    { icon: "shield-checkmark-outline", label: "Política de privacidad", sub: "Cómo tratamos tus datos y los de tus clientes", url: Config.urls.privacidad },
    { icon: "document-text-outline",    label: "Términos y condiciones", sub: "Las reglas del servicio",                         url: Config.urls.terminos },
  ];

  const abrirItem = (item: Item) => {
    if (item.url) {
      Linking.openURL(item.url).catch(() =>
        Alert.alert("No se pudo abrir el enlace", `Ábrelo en tu navegador: ${item.url}`),
      );
      return;
    }
    if (item.route) router.push(item.route as any);
  };

  const renderSection = (title: string, tint: string, items: Item[], index: number) => (
    <Animated.View key={title} entering={FadeInDown.delay(120 + index * 50).duration(400)} style={s.section}>
      <SectionLabel>{title}</SectionLabel>
      <Card>
        {items.map((item, ii) => (
          <ListRow
            key={item.route ?? item.url ?? item.label}
            icon={item.icon}
            color={item.color ?? tint}
            label={item.label}
            sub={item.sub}
            last={ii === items.length - 1}
            onPress={() => abrirItem(item)}
            right={item.url ? <Ionicons name="open-outline" size={15} color={t.subtle} /> : undefined}
          />
        ))}
      </Card>
    </Animated.View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.canvas }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
        {/* ── Header compacto ── */}
        <Animated.View entering={FadeInDown.duration(350)} style={s.header}>
          <MonoTag>Ajustes</MonoTag>
          <Text style={[s.headerTitle, { color: t.ink }]}>Configura tu negocio</Text>
        </Animated.View>

        {/* ── Tarjeta del negocio: identidad + link de reservas ── */}
        <Animated.View entering={FadeInDown.delay(60).duration(400)}>
          <Card>
            <Pressable
              onPress={() => router.push("/settings/store" as any)}
              accessibilityRole="button"
              accessibilityLabel={`${tenant?.name ?? "Tu negocio"}. Abrir Mi Tienda`}
              style={({ pressed }) => [s.bizRow, pressed && { opacity: 0.7 }]}
            >
              <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.bizAvatar}>
                <Text style={s.bizInitials}>{initialsOf(tenant?.name ?? "")}</Text>
              </LinearGradient>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[s.bizName, { color: t.ink }]} numberOfLines={1}>
                  {tenant?.name ?? "Tu negocio"}
                </Text>
                <Text style={[s.bizLink, { color: t.subtle }]} numberOfLines={1}>
                  {bookingShort || "Configura tu link de reservas"}
                </Text>
              </View>
              {bookingLink ? (
                <Pressable
                  onPress={handleShare}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Compartir link de reservas"
                  style={({ pressed }) => [s.shareBtn, { backgroundColor: t.chipBg, borderColor: t.line }, pressed && { opacity: 0.6 }]}
                >
                  <Ionicons name="share-outline" size={17} color={t.ink} />
                </Pressable>
              ) : (
                <Ionicons name="chevron-forward" size={15} color={t.subtle} />
              )}
            </Pressable>
          </Card>
        </Animated.View>

        {SECTIONS.map((sec, i) => renderSection(sec.title, sec.tint, sec.items, i))}

        {/* ── Apariencia ── */}
        <Animated.View entering={FadeInDown.delay(120 + SECTIONS.length * 50).duration(400)} style={s.section}>
          <SectionLabel>Apariencia</SectionLabel>
          <Card>
            <ThemePicker />
          </Card>
        </Animated.View>

        {renderSection("Cuenta y soporte", "#6366f1", accountItems, SECTIONS.length + 1)}

        {/* ── Cerrar sesión ── */}
        <Animated.View entering={FadeInDown.delay(120 + (SECTIONS.length + 2) * 50).duration(400)} style={s.section}>
          <Pressable
            onPress={handleLogout}
            disabled={saliendo}
            accessibilityRole="button"
            accessibilityState={{ disabled: saliendo, busy: saliendo }}
            style={({ pressed }) => [
              s.logoutBtn,
              { backgroundColor: pressed ? Colors.red + "14" : t.cardSolid, borderColor: t.line },
            ]}
          >
            {saliendo
              ? <ActivityIndicator size="small" color={Colors.red} />
              : <Ionicons name="log-out-outline" size={18} color={Colors.red} />}
            <Text style={s.logoutText}>{saliendo ? "Cerrando sesión…" : "Cerrar sesión"}</Text>
          </Pressable>

          {/* Apple 5.1.1(v): borrar la cuenta tiene que estar a la vista. Discreto, no escondido. */}
          <Pressable
            onPress={handleDeleteAccount}
            disabled={deleting}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityState={{ disabled: deleting, busy: deleting }}
            style={({ pressed }) => [s.deleteBtn, pressed && { opacity: 0.6 }]}
          >
            {deleting ? (
              <ActivityIndicator size="small" color={t.subtle} />
            ) : (
              <Ionicons name="trash-outline" size={14} color={t.subtle} />
            )}
            <Text style={[s.deleteText, { color: t.subtle }]}>
              {deleting ? "Eliminando cuenta…" : "Eliminar mi cuenta"}
            </Text>
          </Pressable>
        </Animated.View>

        <View style={s.footerWrap}>
          <Text style={[s.footer, { color: t.subtle }]}>Zyncra · v{Constants.expoConfig?.version ?? "1.0.0"} · Hecho en Colombia 🇨🇴</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header:      { marginBottom: 16 },
  headerTitle: { fontSize: 23, fontFamily: Fonts.bold, letterSpacing: -0.6, marginTop: 3 },
  section:     { marginTop: 20 },

  bizRow:      { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  bizAvatar:   { width: 46, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  bizInitials: { color: "#fff", fontSize: 17, fontFamily: Fonts.bold, letterSpacing: -0.3 },
  bizName:     { fontSize: 16, fontFamily: Fonts.bold, letterSpacing: -0.3 },
  bizLink:     { fontSize: 11, fontFamily: Fonts.mono, marginTop: 3 },
  shareBtn:    { width: 38, height: 38, borderRadius: 19, borderWidth: 1, alignItems: "center", justifyContent: "center" },

  logoutBtn:   { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 50, borderRadius: 14, borderWidth: 1 },
  logoutText:  { fontSize: 14.5, fontFamily: Fonts.semibold, color: Colors.red },
  deleteBtn:   { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 14, marginTop: 6 },
  deleteText:  { fontSize: 12.5, fontFamily: Fonts.regular },
  footerWrap:  { alignItems: "center", marginTop: 8 },
  footer:      { fontSize: 12, fontFamily: Fonts.regular },
});
