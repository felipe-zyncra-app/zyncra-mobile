import { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Fonts, Radius } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { MESES, diasDelMes, fmtCumple, type MesDia } from "@/lib/cumpleanos";

const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

/**
 * Cumpleaños en formato calendario: se elige el mes con las flechas y luego
 * el día en la cuadrícula. Sin año (no hace falta para saludar al cliente).
 * Se despliega dentro del formulario en vez de abrir otro Modal encima del
 * pageSheet, que en iOS no se puede apilar bien.
 */
export default function CumpleanosPicker({ value, onChange }: {
  value: MesDia | null;
  onChange: (v: MesDia | null) => void;
}) {
  const { t } = useTheme();
  const [abierto, setAbierto] = useState(false);
  const [mes, setMes] = useState(value?.mes ?? new Date().getMonth() + 1);

  const abrir = () => {
    setMes(value?.mes ?? new Date().getMonth() + 1);
    setAbierto(a => !a);
  };
  const mover = (delta: number) => setMes(m => ((m - 1 + delta + 12) % 12) + 1);
  const dias = Array.from({ length: diasDelMes(mes) }, (_, i) => i + 1);

  return (
    <View>
      <View style={[s.campo, { backgroundColor: t.inputBg, borderColor: abierto ? Colors.red : t.inputBorder }]}>
        <TouchableOpacity
          style={s.campoBtn}
          onPress={abrir}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={value ? `Cumpleaños: ${fmtCumple(value)}. Cambiar` : "Elegir cumpleaños"}
          accessibilityState={{ expanded: abierto }}
        >
          <Ionicons name="calendar-outline" size={17} color={value ? Colors.red : t.subtle} />
          <Text style={[s.campoText, { color: value ? t.text : t.subtle }]}>
            {value ? fmtCumple(value) : "Elegir mes y día"}
          </Text>
        </TouchableOpacity>
        {value ? (
          <TouchableOpacity onPress={() => { onChange(null); setAbierto(false); }} hitSlop={HIT_SLOP}
            accessibilityRole="button" accessibilityLabel="Quitar cumpleaños">
            <Ionicons name="close-circle" size={18} color={t.subtle} />
          </TouchableOpacity>
        ) : (
          <Ionicons name={abierto ? "chevron-up" : "chevron-down"} size={15} color={t.muted} />
        )}
      </View>

      {abierto && (
        <View style={[s.panel, { backgroundColor: t.cardSolid, borderColor: t.line }]}>
          <View style={s.mesRow}>
            <TouchableOpacity onPress={() => mover(-1)} style={[s.flecha, { backgroundColor: t.chipBg }]} hitSlop={HIT_SLOP}
              accessibilityRole="button" accessibilityLabel="Mes anterior">
              <Ionicons name="chevron-back" size={18} color={t.text} />
            </TouchableOpacity>
            <Text style={[s.mesText, { color: t.text }]} accessibilityRole="header">{MESES[mes - 1]}</Text>
            <TouchableOpacity onPress={() => mover(1)} style={[s.flecha, { backgroundColor: t.chipBg }]} hitSlop={HIT_SLOP}
              accessibilityRole="button" accessibilityLabel="Mes siguiente">
              <Ionicons name="chevron-forward" size={18} color={t.text} />
            </TouchableOpacity>
          </View>
          <View style={s.grilla}>
            {dias.map(d => {
              const on = value?.mes === mes && value.dia === d;
              return (
                <View key={d} style={s.celda}>
                  <TouchableOpacity
                    style={[s.dia, on && { backgroundColor: Colors.red }]}
                    onPress={() => { onChange({ mes, dia: d }); setAbierto(false); }}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`${d} de ${MESES[mes - 1].toLowerCase()}`}
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[s.diaText, { color: on ? "white" : t.text }]}>{d}</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  campo:     { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: 14, gap: 10 },
  campoBtn:  { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 13 },
  campoText: { fontSize: 15, fontFamily: Fonts.regular },
  panel:     { marginTop: 8, borderWidth: 1, borderRadius: Radius.lg, padding: 12 },
  mesRow:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  flecha:    { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  mesText:   { fontSize: 16, fontFamily: Fonts.bold },
  grilla:    { flexDirection: "row", flexWrap: "wrap" },
  celda:     { width: `${100 / 7}%`, aspectRatio: 1, padding: 3 },
  dia:       { flex: 1, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  diaText:   { fontSize: 14, fontFamily: Fonts.semibold },
});
