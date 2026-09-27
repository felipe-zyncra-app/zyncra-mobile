// ─── Selector de tema con vista previa ───────────────────────────
// Tres tarjetas del mismo tamaño, cada una con una miniatura de la app
// pintada en ese esquema. "Automático" se parte en dos: mitad clara,
// mitad oscura, porque eso es lo que hace (sigue al teléfono).

import { View, Text, StyleSheet, Pressable } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { Fonts, Gradients } from "@/constants/theme";
import { useTheme, PALETTES, ThemeMode, ThemePreference } from "@/lib/theme";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

const OPTIONS: { value: ThemePreference; label: string; icon: IoniconName }[] = [
  { value: "system", label: "Automático", icon: "phone-portrait-outline" },
  { value: "light",  label: "Claro",      icon: "sunny-outline" },
  { value: "dark",   label: "Oscuro",     icon: "moon-outline" },
];

// Miniatura de una pantalla: título, tarjeta héroe en tinta, dos tarjetas
// y la barra de acento. Ocupa el 100% de su contenedor.
function MiniScreen({ scheme }: { scheme: ThemeMode }) {
  const p = PALETTES[scheme];
  return (
    <View style={[s.mini, { backgroundColor: p.canvas }]}>
      <View style={[s.miniTitle, { backgroundColor: p.ink }]} />
      <View style={s.miniHero}>
        <LinearGradient colors={Gradients.brandH} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.miniHeroBar} />
      </View>
      <View style={s.miniRow}>
        <View style={[s.miniCard, { backgroundColor: p.cardSolid, borderColor: p.line }]} />
        <View style={[s.miniCard, { backgroundColor: p.cardSolid, borderColor: p.line }]} />
      </View>
      <View style={[s.miniLine, { backgroundColor: p.lineStrong }]} />
    </View>
  );
}

function Preview({ value }: { value: ThemePreference }) {
  if (value !== "system") return <MiniScreen scheme={value} />;
  // Cada mitad pinta la pantalla completa (200% de ancho) y recorta su lado,
  // así se lee como UNA pantalla partida y no como dos pantallas angostas.
  return (
    <View style={s.split}>
      <View style={s.half}>
        <View style={[s.halfInner, { left: 0 }]}><MiniScreen scheme="light" /></View>
      </View>
      <View style={s.half}>
        <View style={[s.halfInner, { left: "-100%" }]}><MiniScreen scheme="dark" /></View>
      </View>
    </View>
  );
}

export function ThemePicker() {
  const { mode, preference, t, setPreference } = useTheme();

  const hint =
    preference === "system"
      ? `Sigue el modo de tu teléfono. Ahora se ve ${mode === "dark" ? "oscuro" : "claro"}.`
      : preference === "dark"
        ? "Siempre oscuro, aunque tu teléfono esté en modo claro."
        : "Siempre claro, aunque tu teléfono esté en modo oscuro.";

  return (
    <View style={s.wrap}>
      <View style={s.row} accessibilityRole="radiogroup">
        {OPTIONS.map((o) => {
          const active = o.value === preference;
          return (
            <Pressable
              key={o.value}
              onPress={() => setPreference(o.value)}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              accessibilityLabel={`Tema ${o.label}`}
              style={({ pressed }) => [s.tile, pressed && { opacity: 0.75 }]}
            >
              <View
                style={[
                  s.frame,
                  { borderColor: active ? t.ink : t.line, borderWidth: active ? 2 : 1 },
                ]}
              >
                <Preview value={o.value} />
                {active && (
                  <View style={[s.check, { backgroundColor: t.ink, borderColor: t.cardSolid }]}>
                    <Ionicons name="checkmark" size={11} color={t.cardSolid} />
                  </View>
                )}
              </View>
              <View style={s.labelRow}>
                <Ionicons name={o.icon} size={13} color={active ? t.ink : t.subtle} />
                <Text style={[s.label, { color: active ? t.ink : t.muted, fontFamily: active ? Fonts.bold : Fonts.semibold }]}>
                  {o.label}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      <Text style={[s.hint, { color: t.subtle }]}>{hint}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap:      { padding: 14, paddingBottom: 12 },
  row:       { flexDirection: "row", gap: 10 },
  tile:      { flex: 1, alignItems: "center" },
  frame:     { width: "100%", aspectRatio: 0.82, borderRadius: 14, padding: 3 },
  check:     { position: "absolute", top: -7, right: -7, width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  labelRow:  { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 8 },
  label:     { fontSize: 12.5 },
  hint:      { fontSize: 11.5, fontFamily: Fonts.regular, marginTop: 12, lineHeight: 16 },

  split:     { flex: 1, flexDirection: "row", borderRadius: 10, overflow: "hidden" },
  half:      { flex: 1, overflow: "hidden" },
  halfInner: { position: "absolute", top: 0, bottom: 0, width: "200%" },

  mini:      { flex: 1, borderRadius: 10, padding: 7, gap: 5, overflow: "hidden" },
  miniTitle: { width: "48%", height: 5, borderRadius: 3, opacity: 0.85 },
  miniHero:  { height: 22, borderRadius: 5, backgroundColor: "#0C0C14", overflow: "hidden", justifyContent: "flex-start" },
  miniHeroBar: { height: 2.5 },
  miniRow:   { flexDirection: "row", gap: 4 },
  miniCard:  { flex: 1, height: 17, borderRadius: 4, borderWidth: 1 },
  miniLine:  { width: "62%", height: 3, borderRadius: 2 },
});
