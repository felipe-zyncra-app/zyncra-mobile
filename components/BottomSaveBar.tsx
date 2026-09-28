import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { Colors, Radius } from "@/constants/theme";
import { useTheme } from "@/lib/theme";

type Props = {
  label: string;
  saving: boolean;
  disabled?: boolean;
  onPress: () => void;
};

export default function BottomSaveBar({ label, saving, disabled, onPress }: Props) {
  const { t } = useTheme();
  return (
    <View style={[s.bar, { borderTopColor: t.border, backgroundColor: t.bg }]}>
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
  btn:      { borderRadius: Radius.full, overflow: "hidden" },
  btnInner: { paddingVertical: 16, alignItems: "center", backgroundColor: Colors.red },
  btnText:  { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
});
