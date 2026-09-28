import { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Platform, Alert, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import * as Linking from "expo-linking";
import { Ionicons } from "@expo/vector-icons";
import { Config, authedFetch } from "@/lib/config";
import { Colors, Fonts, Gradients, Radius } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { useTenant } from "@/lib/tenant";
import { useAuth } from "@/lib/auth";
import { mensajeError, textoParaUsuario } from "@/lib/db";
import { AVISO_ELIMINAR_CUENTA_EQUIPO, estadoServidorCuentas } from "@/lib/cuenta";

/**
 * Pantalla que reemplaza toda el área admin cuando la suscripción del negocio
 * queda `suspended` / `cancelled`.
 *
 * En iOS NO puede haber botón, link ni precio que lleve a pagar fuera de la
 * app: la directriz 3.1.1 lo prohíbe expresamente ("buttons, external links or
 * other calls to action that direct customers to purchasing mechanisms other
 * than in-app purchase") y esta app ya acumuló seis rechazos por ese motivo.
 * La 3.1.3(c) los exime de OFRECER IAP por ser software B2B, pero no habilita
 * enlazar al checkout propio. Así que iOS solo informa el estado.
 * Android no tiene esa restricción y sí lleva a la pasarela.
 *
 * El staff nunca ve el botón de pago en ninguna plataforma: no es quien
 * contrata ni puede resolverlo, así que se le indica avisar al administrador.
 *
 * Apple 5.1.1(v): eliminar la cuenta tiene que poder iniciarse desde la app.
 * Como esta pantalla tapa Ajustes y Mi perfil, aquí también está (ARQ-14).
 */
export default function AccountBlocked() {
  const { t } = useTheme();
  const { tenant } = useTenant();
  const { role, cerrarSesion } = useAuth();
  const isOwner = role === "admin";
  const canLinkToCheckout = isOwner && Platform.OS !== "ios";
  const [ocupado, setOcupado] = useState<"salir" | "eliminar" | null>(null);

  const handleLogout = async () => {
    // cerrarSesion funciona sin red y limpia el push_token y los
    // recordatorios; signOut() a secas no hacía nada visible sin señal.
    setOcupado("salir");
    try { await cerrarSesion(); } finally { setOcupado(null); }
  };

  const eliminarCuenta = async () => {
    setOcupado("eliminar");
    try {
      const res = await authedFetch(Config.edgeFunctions.deleteAccount, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { error?: string }));
        throw new Error(textoParaUsuario(body?.error, "No se pudo eliminar la cuenta. Intenta de nuevo o escríbenos a soporte@zyncra.app."));
      }
      await cerrarSesion();
    } catch (e) {
      setOcupado(null);
      Alert.alert(
        "No se eliminó la cuenta",
        e instanceof Error && e.message ? e.message : mensajeError(e),
      );
    }
  };

  const confirmarEliminar = async () => {
    if (ocupado) return;
    if (!isOwner) {
      // Misma regla que Mi perfil del staff: mientras el servidor no proteja
      // el historial, delete-account borra en cascada las citas y
      // liquidaciones del colaborador. Sin poder confirmarlo, no se arriesga.
      setOcupado("eliminar");
      const servidor = await estadoServidorCuentas().finally(() => setOcupado(null));
      if (servidor.estado === "desconocido") {
        Alert.alert("No se pudo continuar", mensajeError(servidor.error, "No pudimos verificar tu cuenta"));
        return;
      }
      if (servidor.estado === "pendiente") {
        Alert.alert("Eliminar cuenta", AVISO_ELIMINAR_CUENTA_EQUIPO, [
          { text: "Cancelar", style: "cancel" },
          { text: "Ir a soporte", onPress: () => { Linking.openURL(Config.urls.soporte).catch(() => Alert.alert("No se pudo abrir el enlace", Config.urls.soporte)); } },
        ]);
        return;
      }
    }
    Alert.alert(
      "Eliminar cuenta",
      isOwner
        ? "Se eliminará tu cuenta y todos los datos de tu negocio (clientes, citas, ventas, reportes). Esta acción no se puede deshacer."
        // Sin prometer que el negocio conserva las citas: hasta que se aplique
        // la migración, delete-account borra la ficha del profesional y la FK
        // en cascada se lleva sus citas. Se pide avisar antes al administrador.
        : "Se eliminará tu cuenta de colaborador y perderás el acceso a este negocio. Antes de continuar, avísale al administrador. Esta acción no se puede deshacer.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Continuar", style: "destructive",
          onPress: () => Alert.alert(
            "¿Confirmas la eliminación?",
            "Esta es tu última oportunidad para cancelar.",
            [
              { text: "Cancelar", style: "cancel" },
              { text: "Eliminar cuenta", style: "destructive", onPress: eliminarCuenta },
            ],
          ),
        },
      ],
    );
  };

  return (
    <SafeAreaView style={[s.root, { backgroundColor: t.canvas }]}>
      <View style={s.center}>
        <Animated.View entering={FadeInDown.duration(420)} style={[s.card, { backgroundColor: t.cardSolid, borderColor: t.line }]}>
          <LinearGradient
            colors={Gradients.brand}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={s.accent}
          />

          <View style={[s.iconWrap, { backgroundColor: t.chipBg }]}>
            <Ionicons name="lock-closed" size={26} color={Colors.red} />
          </View>

          <Text style={[s.crumb, { color: t.subtle }]}>
            {tenant?.name ?? "Tu negocio"}
          </Text>

          {canLinkToCheckout ? (
            <>
              <Text style={[s.title, { color: t.ink }]}>Tu plan está inactivo</Text>
              <Text style={[s.body, { color: t.muted }]}>
                Activa tu plan para volver a usar Zyncra. Tus datos siguen guardados.
              </Text>

              <TouchableOpacity
                style={s.cta}
                activeOpacity={0.85}
                onPress={() => Linking.openURL(Config.urls.billing)}
                accessibilityRole="link"
              >
                <LinearGradient
                  colors={Gradients.brand}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={s.ctaGrad}
                >
                  <Text style={s.ctaText}>Pagar mi plan</Text>
                  <Ionicons name="arrow-forward" size={16} color="white" />
                </LinearGradient>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={[s.title, { color: t.ink }]}>Cuenta inactiva</Text>
              <Text style={[s.body, { color: t.muted }]}>
                {isOwner
                  ? "Tu cuenta no está activa en este momento. Contacta a tu asesor Zyncra para reactivarla. Tus datos siguen guardados."
                  : "La cuenta de este negocio no está activa en este momento. Avísale al administrador para reactivarla. Tus datos siguen guardados."}
              </Text>
            </>
          )}

          <TouchableOpacity
            style={s.logout} onPress={handleLogout} activeOpacity={0.6}
            disabled={ocupado !== null} accessibilityRole="button"
            accessibilityState={{ disabled: ocupado !== null, busy: ocupado === "salir" }}
          >
            {ocupado === "salir"
              ? <ActivityIndicator size="small" color={t.subtle} />
              : <Text style={[s.logoutText, { color: t.muted }]}>Cerrar sesión</Text>}
          </TouchableOpacity>

          <View style={[s.divider, { backgroundColor: t.line }]} />

          <TouchableOpacity
            style={s.secondary} onPress={confirmarEliminar} activeOpacity={0.6}
            disabled={ocupado !== null} accessibilityRole="button"
            accessibilityState={{ disabled: ocupado !== null, busy: ocupado === "eliminar" }}
          >
            {ocupado === "eliminar"
              ? <ActivityIndicator size="small" color={t.subtle} />
              : <Ionicons name="trash-outline" size={13} color={t.subtle} />}
            <Text style={[s.secondaryText, { color: t.subtle }]}>
              {ocupado === "eliminar" ? "Eliminando cuenta…" : "Eliminar mi cuenta"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={s.secondary}
            onPress={() => Linking.openURL(Config.urls.privacidad).catch(() => {})}
            activeOpacity={0.6} accessibilityRole="link"
          >
            <Text style={[s.secondaryText, { color: t.subtle }]}>Política de privacidad</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root:      { flex: 1 },
  center:    { flex: 1, justifyContent: "center", paddingHorizontal: 22 },
  card:      { borderWidth: 1, borderRadius: Radius.xl, paddingHorizontal: 24, paddingTop: 30, paddingBottom: 14, alignItems: "center", overflow: "hidden" },
  accent:    { position: "absolute", top: 0, left: 0, right: 0, height: 3 },
  iconWrap:  { width: 60, height: 60, borderRadius: 20, alignItems: "center", justifyContent: "center", marginBottom: 18 },
  crumb:     { fontFamily: Fonts.mono, fontSize: 10, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 8 },
  title:     { fontFamily: Fonts.bold, fontSize: 21, letterSpacing: -0.5, textAlign: "center", marginBottom: 8 },
  body:      { fontFamily: Fonts.regular, fontSize: 14, lineHeight: 21, textAlign: "center", marginBottom: 24 },
  cta:       { alignSelf: "stretch", borderRadius: Radius.md, overflow: "hidden" },
  ctaGrad:   { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 15 },
  ctaText:   { fontFamily: Fonts.bold, fontSize: 15, color: "white" },
  logout:    { minHeight: 44, justifyContent: "center", paddingVertical: 10, marginTop: 6 },
  logoutText:{ fontFamily: Fonts.semibold, fontSize: 13.5 },
  divider:   { alignSelf: "stretch", height: 1, marginVertical: 6 },
  secondary: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40, paddingVertical: 8 },
  secondaryText: { fontFamily: Fonts.regular, fontSize: 12.5 },
});
