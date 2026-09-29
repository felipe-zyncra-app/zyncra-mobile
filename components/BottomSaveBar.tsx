import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { Colors, Radius } from "@/constants/theme";
import { useTheme } from "@/lib/theme";

type Props = {
  label: string;
  saving: boolean;
  disabled?: boolean;
  onPress: () => void;
  /** Una línea sobre el botón, p. ej. por qué está apagado. */
  hint?: string | null;
};

export default function BottomSaveBar({ label, saving, disabled, onPress, hint }: Props) {
  const { t } = useTheme();
  return (
    <View style={[s.bar, hint ? s.barConHint : null, { borderTopColor: t.border, backgroundColor: t.bg }]}>
      {hint ? <Text style={[s.hint, { color: t.muted }]} accessibilityLiveRegion="polite">{hint}</Text> : null}
      <TouchableOpacity
        style={[s.btn, disabled && { opacity: 0.4 }]}
        onPress={onPress}
        disabled={disabled || saving}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: !!disabled || saving, busy: saving }}
      >
        <View style={s.btnInner}>
          {saving ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>{label}</Text>}
        </View>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  bar:      { padding: 20, paddingBottom: 34, borderTopWidth: 1 },
  barConHint: { paddingTop: 12 },
  hint:     { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", textAlign: "center", marginBottom: 10 },
  btn:      { borderRadius: Radius.full, overflow: "hidden" },
  btnInner: { paddingVertical: 16, alignItems: "center", backgroundColor: Colors.red },
  btnText:  { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
});
