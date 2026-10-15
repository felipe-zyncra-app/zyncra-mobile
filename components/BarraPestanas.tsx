import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Fonts, Gradients, Shadow } from "@/constants/theme";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];
export type Pestana = { name: string; label: string; icon: IoniconName; iconFocused: IoniconName };

/**
 * Barra de pestañas de la app: píldora de tinta oscura, eco de la barra
 * lateral del portal web (#0C0C14), con el ítem activo en blanco al 8 %,
 * ícono acento #ff5d54 y la barra de degradado de la marca (adaptación de
 * .navItem.active de admin.module.css).
 *
 * Una sola para el dueño y para el equipo: antes el equipo tenía otra
 * (vidrio claro con una píldora roja) y las dos apps no parecían la misma.
 * En una sub-pantalla que no es pestaña (Caja, Mi ficha) se oculta.
 */
export default function BarraPestanas({ state, navigation, tabs }: BottomTabBarProps & { tabs: Pestana[] }) {
  const actual = state.routes[state.index]?.name;
  if (!tabs.some(t => t.name === actual)) return null;

  return (
    <View style={s.wrapper}>
      <View style={[s.bar, Shadow.md]} accessibilityRole="tablist">
        {state.routes.filter(r => tabs.some(t => t.name === r.name)).map(route => {
          const focused = actual === route.name;
          const tab = tabs.find(t => t.name === route.name) ?? tabs[0];
          return (
            <TouchableOpacity
              key={route.key}
              style={s.tab}
              onPress={() => navigation.navigate(route.name)}
              activeOpacity={0.7}
              // Con el lector de pantalla se anuncia como pestaña y cuál está
              // activa (CAL-24).
              accessibilityRole="tab"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected: focused }}
            >
              <View style={[s.tabInner, focused && s.tabInnerActive]}>
                {focused && (
                  <LinearGradient
                    colors={Gradients.brand}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                    style={s.accentBar}
                  />
                )}
                <Ionicons
                  name={focused ? tab.iconFocused : tab.icon}
                  size={19}
                  color={focused ? "#ff5d54" : "rgba(255,255,255,0.52)"}
                />
                <Text style={[s.label, focused ? s.labelActive : { color: "rgba(255,255,255,0.52)" }]}>
                  {tab.label}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrapper:        { position: "absolute", bottom: 0, left: 0, right: 0, paddingBottom: 24, paddingHorizontal: 12 },
  bar:            { backgroundColor: "#0C0C14", borderRadius: 22, flexDirection: "row", paddingVertical: 8, paddingHorizontal: 6, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  tab:            { flex: 1, alignItems: "center" },
  tabInner:       { alignItems: "center", gap: 3, paddingVertical: 7, paddingHorizontal: 10, borderRadius: 12, overflow: "hidden" },
  tabInnerActive: { backgroundColor: "rgba(255,255,255,0.08)" },
  accentBar:      { position: "absolute", top: 0, left: "28%", right: "28%", height: 2.5, borderBottomLeftRadius: 3, borderBottomRightRadius: 3 },
  label:          { fontSize: 9.5, fontFamily: Fonts.semibold, textAlign: "center" },
  labelActive:    { color: "white", fontFamily: Fonts.bold },
});
