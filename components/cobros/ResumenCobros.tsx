import { View, Text, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { fmtMoneyFull } from "@/lib/format";
import { Fonts, Gradients, Radius, Shadow } from "@/constants/theme";

export type MedioResumen = { key: string; label: string; color: string; total: number };

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/**
 * Lo cobrado en el día, lo que falta cobrar de ESE día y cómo se pagó, en una
 * sola tarjeta. Antes eran el recuadro del encabezado, la tarjeta oscura y la
 * del desglose, con la misma cifra dos veces.
 */
export default function ResumenCobros({ cobrado, cobros, porCobrar, citasPorCobrar, esHoy, medios }: {
  cobrado: number;
  cobros: number;
  porCobrar: number;
  citasPorCobrar: number;
  esHoy: boolean;
  medios: MedioResumen[];
}) {
  const suma = medios.reduce((acc, m) => acc + Math.max(0, m.total), 0);
  return (
    <View style={[s.card, Shadow.md]}>
      <LinearGradient colors={Gradients.ink} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.grad}>
        <View style={s.fila}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.label}>Cobrado</Text>
            <Text style={s.valor} numberOfLines={1} adjustsFontSizeToFit>{fmtMoneyFull(cobrado)}</Text>
            <Text style={s.sub}>{plural(cobros, "cobro", "cobros")}</Text>
          </View>
          <View style={s.porCobrar}>
            <Text style={s.label}>{esHoy ? "Por cobrar hoy" : "Por cobrar"}</Text>
            <Text style={[s.valorChico, porCobrar === 0 && { color: "rgba(255,255,255,.55)" }]} numberOfLines={1} adjustsFontSizeToFit>
              {porCobrar > 0 ? fmtMoneyFull(porCobrar) : "Nada"}
            </Text>
            <Text style={s.sub}>{plural(citasPorCobrar, "cita", "citas")}</Text>
          </View>
        </View>

        {suma > 0 ? (
          <View style={{ marginTop: 14 }}>
            <View style={s.barra} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {medios.filter(m => m.total > 0).map(m => (
                <View key={m.key} style={{ flex: m.total / suma, backgroundColor: m.color }} />
              ))}
            </View>
            <View style={s.leyenda}>
              {medios.map(m => (
                <View key={m.key} style={s.item}>
                  <View style={[s.punto, { backgroundColor: m.color }]} />
                  <Text style={s.itemTxt} numberOfLines={1}>
                    {m.label} <Text style={s.itemValor}>{fmtMoneyFull(m.total)}</Text>
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </LinearGradient>
    </View>
  );
}

const s = StyleSheet.create({
  card:       { borderRadius: Radius.xl, overflow: "hidden" },
  grad:       { padding: 16, paddingHorizontal: 18 },
  fila:       { flexDirection: "row", alignItems: "flex-start", gap: 14 },
  label:      { fontSize: 11, fontFamily: Fonts.semibold, color: "rgba(255,255,255,.62)", textTransform: "uppercase", letterSpacing: 0.6 },
  valor:      { fontSize: 29, fontFamily: Fonts.bold, color: "white", letterSpacing: -1, marginTop: 4 },
  valorChico: { fontSize: 19, fontFamily: Fonts.bold, color: "white", marginTop: 6 },
  sub:        { fontSize: 11.5, fontFamily: Fonts.regular, color: "rgba(255,255,255,.55)", marginTop: 3 },
  porCobrar:  { minWidth: 118, maxWidth: "46%", backgroundColor: "rgba(255,255,255,.08)", borderColor: "rgba(255,255,255,.14)", borderWidth: 1, borderRadius: Radius.lg, paddingVertical: 10, paddingHorizontal: 12 },
  barra:      { flexDirection: "row", height: 8, borderRadius: 4, overflow: "hidden", gap: 2 },
  leyenda:    { flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 6, marginTop: 10 },
  item:       { flexDirection: "row", alignItems: "center", gap: 6 },
  punto:      { width: 8, height: 8, borderRadius: 4 },
  itemTxt:    { fontSize: 12, fontFamily: Fonts.regular, color: "rgba(255,255,255,.72)" },
  itemValor:  { fontFamily: Fonts.bold, color: "white" },
});
