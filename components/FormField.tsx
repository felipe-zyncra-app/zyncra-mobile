import { View, Text, TextInput, StyleSheet } from "react-native";
import { Colors, Radius } from "@/constants/theme";
import { useTheme } from "@/lib/theme";

type Props = {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
  keyboardType?: "phone-pad" | "email-address" | "numeric" | "number-pad" | "decimal-pad" | "default";
  multiline?: boolean;
  /** Mensaje de validación bajo el campo (borde rojo). */
  error?: string;
  /** Texto de ayuda bajo el campo cuando no hay error. */
  hint?: string;
  secureTextEntry?: boolean;
  editable?: boolean;
  maxLength?: number;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
};

export default function FormField({
  label, value, onChangeText, placeholder, keyboardType, multiline,
  error, hint, secureTextEntry, editable = true, maxLength, autoCapitalize,
}: Props) {
  const { t } = useTheme();
  const sinMayusculas = keyboardType === "phone-pad" || keyboardType === "email-address"
    || keyboardType === "numeric" || keyboardType === "number-pad" || keyboardType === "decimal-pad";
  return (
    <View style={s.field}>
      <Text style={[s.label, { color: t.muted }]}>{label}</Text>
      <TextInput
        style={[
          s.input,
          { backgroundColor: t.inputBg, borderColor: error ? Colors.red : t.inputBorder, color: editable ? t.text : t.muted },
          multiline && { height: 80, textAlignVertical: "top" },
        ]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.subtle}
        keyboardType={keyboardType ?? "default"}
        multiline={multiline}
        secureTextEntry={secureTextEntry}
        editable={editable}
        maxLength={maxLength}
        autoCapitalize={autoCapitalize ?? (sinMayusculas ? "none" : "sentences")}
        autoCorrect={keyboardType === "email-address" ? false : undefined}
        accessibilityLabel={label}
        accessibilityHint={error ?? hint}
      />
      {error ? (
        <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text>
      ) : hint ? (
        <Text style={[s.hint, { color: t.subtle }]}>{hint}</Text>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  field: { marginBottom: 16 },
  label: { fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 },
  input: { borderWidth: 1.5, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, fontFamily: "SpaceGrotesk_400Regular" },
  error: { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.red, marginTop: 6 },
  hint:  { fontSize: 11.5, fontFamily: "SpaceGrotesk_400Regular", marginTop: 6, lineHeight: 16 },
});
