import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/lib/theme";
import { MEDIOS } from "@/lib/medios-pago";
import { Fonts, Radius } from "@/constants/theme";

/**
 * "¿Cómo pagó el cliente?": una cuadrícula de 3 columnas del mismo tamaño.
 * Antes eran píldoras que se partían en filas desparejas y la elegida se
 * pintaba de rojo, que en la app se lee como error. Ahora cada método lleva
 * su color y la elegida se marca con borde, fondo suave y un check.
 */
export default function MetodosPago({ value, onChange }: { value: string; onChange: (key: string) => void }) {
  const { t } = useTheme();
  return (
    <View style={s.grid} accessibilityRole="radiogroup">
      {MEDIOS.map(m => {
        const activo = value === m.key;
        return (
          <TouchableOpacity
            key={m.key}
            onPress={() => onChange(m.key)}
            activeOpacity={0.8}
            accessibilityRole="radio"
            accessibilityState={{ checked: activo }}
            accessibilityLabel={m.label}
            style={[
              s.tile,
              { backgroundColor: t.cardSolid, borderColor: t.line },
              activo && { borderColor: m.color, backgroundColor: m.color + "14" },
            ]}
          >
            <View style={[s.icono, { backgroundColor: m.color + (activo ? "2E" : "16") }]}>
              <Ionicons name={m.icon} size={17} color={m.color} />
            </View>
            <Text
              style={[s.label, { color: activo ? t.ink : t.muted }, activo && { fontFamily: Fonts.bold }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              {m.label}
            </Text>
            {activo ? <Ionicons name="checkmark-circle" size={16} color={m.color} style={s.check} /> : null}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  grid:  { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile:  { flexBasis: "30%", flexGrow: 1, alignItems: "center", gap: 6, paddingVertical: 12, paddingHorizontal: 6, borderRadius: Radius.md, borderWidth: 1.5 },
  icono: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 12.5, fontFamily: Fonts.semibold },
  check: { position: "absolute", top: 6, right: 6 },
});
