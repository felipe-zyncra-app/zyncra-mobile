import { View, Text, StyleSheet, TouchableOpacity, Platform, type StyleProp, type ViewStyle } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import * as Linking from "expo-linking";
import { Ionicons } from "@expo/vector-icons";
import { Config } from "@/lib/config";
import { Colors, Fonts, Radius } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { useSubscription } from "@/lib/subscription";

const plural = (n: number) => (n === 1 ? "1 día" : `${n} días`);

/**
 * Aviso previo al bloqueo: prueba por terminar, plan por vencer o pago en mora.
 * Se muestra en el Panel (admin) y en Mi Agenda (staff); si no hay nada que
 * advertir no renderiza nada.
 *
 * El botón de pago solo aparece para el DUEÑO y solo fuera de iOS: la
 * directriz 3.1.1 prohíbe llevar al usuario a un pago externo, y un
 * colaborador no es quien paga. En esos casos el aviso solo informa.
 */
export default function SubscriptionBanner({ style }: { style?: StyleProp<ViewStyle> }) {
  const { t } = useTheme();
  const { role } = useAuth();
  const { notice } = useSubscription();

  if (!notice) return null;

  const isOwner = role === "admin";
  const canLinkToCheckout = isOwner && Platform.OS !== "ios";
  const urgent = notice.kind === "past-due";
  const tone = urgent ? Colors.red : "#f59e0b";

  let title: string;
  let body: string;

  if (notice.kind === "past-due") {
    title = isOwner ? "Tu pago está vencido" : "El pago del negocio está vencido";
    body = notice.days > 0
      ? `Quedan ${plural(notice.days)} antes de que se bloquee el acceso.`
      : "El acceso se bloqueará muy pronto.";
    if (!isOwner) body += " Avísale al administrador.";
  } else if (notice.kind === "trial-ending") {
    title = notice.days <= 0
      ? (isOwner ? "Tu prueba termina hoy" : "La prueba del negocio termina hoy")
      : (isOwner ? `Tu prueba termina en ${plural(notice.days)}` : `La prueba del negocio termina en ${plural(notice.days)}`);
    body = isOwner
      ? (canLinkToCheckout ? "Activa tu plan para no perder el acceso." : "Al terminar, el acceso queda inactivo.")
      : "Avísale al administrador del negocio.";
  } else {
    title = notice.days <= 0
      ? (isOwner ? "Tu plan vence hoy" : "El plan del negocio vence hoy")
      : (isOwner ? `Tu plan vence en ${plural(notice.days)}` : `El plan del negocio vence en ${plural(notice.days)}`);
    body = isOwner
      ? (canLinkToCheckout ? "Renueva para no perder el acceso." : "Al vencer, el acceso queda inactivo.")
      : "Avísale al administrador del negocio.";
  }

  return (
    <Animated.View
      entering={FadeInDown.duration(350)}
      style={[s.wrap, { backgroundColor: t.cardSolid, borderColor: tone + "55" }, style]}
    >
      <View style={[s.stripe, { backgroundColor: tone }]} />
      <View style={[s.icon, { backgroundColor: tone + "18" }]}>
        <Ionicons name={urgent ? "alert-circle" : "time-outline"} size={17} color={tone} />
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[s.title, { color: t.ink }]}>{title}</Text>
        <Text style={[s.body, { color: t.muted }]}>{body}</Text>
      </View>

      {canLinkToCheckout && (
        <TouchableOpacity
          style={[s.cta, { backgroundColor: tone }]}
          onPress={() => Linking.openURL(Config.urls.billing)}
          activeOpacity={0.85}
        >
          <Text style={s.ctaText}>{notice.kind === "trial-ending" ? "Activar" : "Pagar"}</Text>
        </TouchableOpacity>
      )}
    </Animated.View>
  );
}

const s = StyleSheet.create({
  wrap:    { flexDirection: "row", alignItems: "center", gap: 11, borderWidth: 1, borderRadius: Radius.md, paddingVertical: 12, paddingLeft: 15, paddingRight: 12, overflow: "hidden" },
  stripe:  { position: "absolute", left: 0, top: 0, bottom: 0, width: 3 },
  icon:    { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  title:   { fontFamily: Fonts.bold, fontSize: 13.5, letterSpacing: -0.2 },
  body:    { fontFamily: Fonts.regular, fontSize: 11.5, lineHeight: 16, marginTop: 1 },
  cta:     { borderRadius: Radius.sm, paddingHorizontal: 13, paddingVertical: 8 },
  ctaText: { fontFamily: Fonts.bold, fontSize: 12.5, color: "white" },
});
