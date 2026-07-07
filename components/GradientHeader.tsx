import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { Gradients } from "@/constants/theme";

// Header de subpantalla: superficie oscura con la firma de gradiente como acento de 3px
// (regla del design system — el gradiente full-bleed queda solo para los héroes de los tabs)

type Props = {
  title: string;
  subtitle?: string;
  onBack: () => void;
  rightAction?: { icon: React.ComponentProps<typeof Ionicons>["name"]; onPress: () => void };
};

export default function GradientHeader({ title, subtitle, onBack, rightAction }: Props) {
  return (
    <LinearGradient colors={Gradients.ink} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.header}>
      <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.accent} />
      <View style={s.headerRow}>
        <TouchableOpacity onPress={onBack} style={s.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="arrow-back" size={20} color="white" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>{title}</Text>
          {subtitle ? <Text style={s.sub}>{subtitle}</Text> : null}
        </View>
        {rightAction ? (
          <TouchableOpacity style={s.actionBtn} onPress={rightAction.onPress} activeOpacity={0.8}>
            <Ionicons name={rightAction.icon} size={22} color="white" />
          </TouchableOpacity>
        ) : null}
      </View>
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  header:    { paddingTop: 16, paddingHorizontal: 24, paddingBottom: 20 },
  accent:    { position: "absolute", top: 0, left: 0, right: 0, height: 3 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  backBtn:   { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,.18)", alignItems: "center", justifyContent: "center" },
  title:     { fontSize: 22, fontFamily: "SpaceGrotesk_700Bold", color: "white", letterSpacing: -0.4 },
  sub:       { fontSize: 12, color: "rgba(255,255,255,.75)", fontFamily: "SpaceGrotesk_400Regular", marginTop: 2 },
  actionBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: "rgba(255,255,255,.22)", alignItems: "center", justifyContent: "center" },
});
