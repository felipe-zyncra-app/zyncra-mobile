import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { Gradients } from "@/constants/theme";

type Props = {
  title: string;
  onClose: () => void;
  rightAction?: { icon: React.ComponentProps<typeof Ionicons>["name"]; onPress: () => void };
};

// Header de modal en tinta (#0C0C14) con barra de acento gradiente —
// mismo patrón que los headers de modales del resto del app.
export default function ModalHeader({ title, onClose, rightAction }: Props) {
  return (
    <View style={s.header}>
      <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.accent} />
      <View style={s.row}>
        <TouchableOpacity onPress={onClose} style={s.btn}>
          <Ionicons name="close" size={20} color="white" />
        </TouchableOpacity>
        <Text style={s.title}>{title}</Text>
        {rightAction ? (
          <TouchableOpacity onPress={rightAction.onPress} style={s.btn}>
            <Ionicons name={rightAction.icon} size={18} color="white" />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  header: { paddingTop: 16, paddingHorizontal: 20, paddingBottom: 20, backgroundColor: "#0C0C14" },
  accent: { position: "absolute", top: 0, left: 0, right: 0, height: 3 },
  row:    { flexDirection: "row", alignItems: "center", gap: 12 },
  btn:    { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,.18)", alignItems: "center", justifyContent: "center" },
  title:  { flex: 1, fontSize: 18, fontFamily: "SpaceGrotesk_700Bold", color: "white", textAlign: "center" },
});
