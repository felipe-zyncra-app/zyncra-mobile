import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/lib/theme";
import { fmt12 } from "@/lib/format";
import { diaLocalDe, horaLocalDe, fmtDia, esHoy } from "@/lib/tz";
import { Colors, Fonts, Radius } from "@/constants/theme";

export type EstadoDeCaja = { abierta: true; desde: string } | { abierta: false };

/**
 * Estado de la caja arriba de Cobros. Sin caja abierta no se puede cobrar
 * (recordSale lo exige, igual que el POS web), y antes eso solo se descubría
 * al final, con el cobro ya armado.
 */
export default function EstadoCaja({ caja, timezone, onPress }: {
  caja: EstadoDeCaja;
  timezone: string;
  onPress: () => void;
}) {
  const { t, mode } = useTheme();

  if (!caja.abierta) {
    const ambar = mode === "dark" ? "#fbbf24" : "#b45309";
    return (
      <View style={[s.cerrada, { borderColor: ambar + "55", backgroundColor: ambar + "12" }]}>
        <Ionicons name="lock-closed-outline" size={17} color={ambar} />
        <View style={{ flex: 1 }}>
          <Text style={[s.titulo, { color: t.ink }]}>La caja está cerrada</Text>
          <Text style={[s.sub, { color: t.muted }]}>Ábrela para poder cobrar.</Text>
        </View>
        <TouchableOpacity onPress={onPress} style={[s.btn, { backgroundColor: ambar }]} activeOpacity={0.85} accessibilityRole="button">
          <Text style={s.btnTxt}>Abrir caja</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return <CajaAbierta desde={caja.desde} timezone={timezone} onPress={onPress} />;
}

/**
 * Caja abierta: una etiqueta pequeña en el encabezado (lo normal no necesita
 * una franja entera). Con la hora de apertura, y la fecha si viene de otro día.
 */
export function CajaAbierta({ desde, timezone, onPress }: { desde: string; timezone: string; onPress: () => void }) {
  const { t } = useTheme();
  const dia = diaLocalDe(desde, timezone);
  const hora = fmt12(horaLocalDe(desde, timezone));
  const deHoy = esHoy(dia, timezone);
  const cuando = deHoy ? hora : `${fmtDia(dia, "semana-dia-mes")}, ${hora}`;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      hitSlop={8}
      style={[s.abierta, { backgroundColor: Colors.success + "14" }]}
      accessibilityRole="button"
      accessibilityLabel={`Caja abierta desde ${cuando}. Ver caja`}
    >
      <View style={s.punto} />
      <Text style={[s.abiertaTxt, { color: t.text }]} numberOfLines={1}>{deHoy ? "Caja abierta" : `Caja abierta desde ${fmtDia(dia, "dia-mes")}`}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  cerrada:    { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: Radius.lg, padding: 12 },
  titulo:     { fontSize: 13.5, fontFamily: Fonts.bold },
  sub:        { fontSize: 12, fontFamily: Fonts.regular, marginTop: 1 },
  btn:        { borderRadius: Radius.full, paddingHorizontal: 14, paddingVertical: 9 },
  btnTxt:     { fontSize: 12.5, fontFamily: Fonts.bold, color: "white" },
  abierta:    { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: Radius.full, paddingVertical: 4, paddingHorizontal: 9 },
  punto:      { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.success },
  abiertaTxt: { fontSize: 11.5, fontFamily: Fonts.semibold },
});
