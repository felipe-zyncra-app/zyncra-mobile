import { View, Text, StyleSheet, TouchableOpacity, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import * as Linking from "expo-linking";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { Config } from "@/lib/config";
import { Colors, Fonts, Gradients, Radius } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { useTenant } from "@/lib/tenant";
import { useAuth } from "@/lib/auth";

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
 */
export default function AccountBlocked() {
  const { t } = useTheme();
  const { tenant } = useTenant();
  const { role } = useAuth();
  const isOwner = role === "admin";
  const canLinkToCheckout = isOwner && Platform.OS !== "ios";

  const handleLogout = async () => {
    await supabase.auth.signOut();
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

          <TouchableOpacity style={s.logout} onPress={handleLogout} activeOpacity={0.6}>
            <Text style={[s.logoutText, { color: t.subtle }]}>Cerrar sesión</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root:      { flex: 1 },
  center:    { flex: 1, justifyContent: "center", paddingHorizontal: 22 },
  card:      { borderWidth: 1, borderRadius: Radius.xl, paddingHorizontal: 24, paddingTop: 30, paddingBottom: 18, alignItems: "center", overflow: "hidden" },
  accent:    { position: "absolute", top: 0, left: 0, right: 0, height: 3 },
  iconWrap:  { width: 60, height: 60, borderRadius: 20, alignItems: "center", justifyContent: "center", marginBottom: 18 },
  crumb:     { fontFamily: Fonts.mono, fontSize: 10, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 8 },
  title:     { fontFamily: Fonts.bold, fontSize: 21, letterSpacing: -0.5, textAlign: "center", marginBottom: 8 },
  body:      { fontFamily: Fonts.regular, fontSize: 14, lineHeight: 21, textAlign: "center", marginBottom: 24 },
  cta:       { alignSelf: "stretch", borderRadius: Radius.md, overflow: "hidden" },
  ctaGrad:   { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 15 },
  ctaText:   { fontFamily: Fonts.bold, fontSize: 15, color: "white" },
  logout:    { paddingVertical: 14, marginTop: 6 },
  logoutText:{ fontFamily: Fonts.semibold, fontSize: 13.5 },
});
