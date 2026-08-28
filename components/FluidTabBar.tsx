import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from "react-native-reanimated";
import { Colors, Shadow, Glass } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];
export type TabItem = { name: string; label: string; icon: IoniconName; iconFocused: IoniconName };

const PILL = 36;
const BAR_PAD_H = 4; // paddingHorizontal de la barra — la píldora se posiciona relativo a esto
const SLIDE = { stiffness: 260, damping: 22, mass: 0.9 };

// Tab bar compartida (admin y staff): la píldora roja se desliza con física de
// resorte hasta el tab activo en vez de saltar de golpe.
export default function FluidTabBar({ state, navigation, tabs }: BottomTabBarProps & { tabs: TabItem[] }) {
  const { t: theme } = useTheme();
  const [innerW, setInnerW] = useState(0);
  const x     = useSharedValue(0);
  const pulse = useSharedValue(1);
  const measured = useRef(false);

  const routes = state.routes.filter(r => tabs.some(t => t.name === r.name));
  const currentRouteName = state.routes[state.index].name;
  const onTab = tabs.some(t => t.name === currentRouteName);
  const activeIdx = Math.max(0, routes.findIndex(r => r.name === currentRouteName));
  const tabW = routes.length > 0 ? (innerW - BAR_PAD_H * 2) / routes.length : 0;
  const targetX = BAR_PAD_H + activeIdx * tabW + (tabW - PILL) / 2;

  useEffect(() => {
    if (!onTab || innerW <= 0) return;
    if (!measured.current) {
      // Primera medición: posicionar sin animar para que no cruce la barra al abrir
      measured.current = true;
      x.value = targetX;
      return;
    }
    x.value = withSpring(targetX, SLIDE);
    pulse.value = 0.82;
    pulse.value = withSpring(1, { stiffness: 320, damping: 15 });
  }, [targetX, innerW, onTab]);

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { scale: pulse.value }],
  }));

  if (!onTab) return null; // subpantalla: la barra se oculta

  return (
    <View style={s.wrapper}>
      <BlurView
        tint={theme.blurTint}
        intensity={Glass.blurStrong.intensity}
        style={[s.bar, Shadow.md, { backgroundColor: theme.tabBarBg, borderColor: theme.tabBarBorder }]}
        onLayout={e => setInnerW(e.nativeEvent.layout.width)}
      >
        {innerW > 0 && <Animated.View style={[pillStyle, s.pill]} />}

        {routes.map(route => {
          const focused = currentRouteName === route.name;
          const tab = tabs.find(t => t.name === route.name) ?? tabs[0];
          return (
            <TouchableOpacity
              key={route.key}
              style={s.tab}
              onPress={() => navigation.navigate(route.name)}
              activeOpacity={0.7}
            >
              <View style={s.tabInner}>
                <View style={s.iconSlot}>
                  <Ionicons name={focused ? tab.iconFocused : tab.icon} size={20} color={focused ? "white" : theme.subtle} />
                </View>
                <Text style={[s.label, focused ? s.labelFocused : { color: theme.subtle }]}>{tab.label}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </BlurView>
    </View>
  );
}

const s = StyleSheet.create({
  wrapper:      { position: "absolute", bottom: 0, left: 0, right: 0, paddingBottom: 24, paddingHorizontal: 12 },
  bar:          { borderRadius: 22, flexDirection: "row", paddingVertical: 10, paddingHorizontal: BAR_PAD_H, overflow: "hidden", borderWidth: 1 },
  pill:         { position: "absolute", top: 10, left: 0, width: PILL, height: PILL, borderRadius: 12, backgroundColor: Colors.red },
  tab:          { flex: 1, alignItems: "center" },
  tabInner:     { alignItems: "center", gap: 4 },
  iconSlot:     { width: PILL, height: PILL, alignItems: "center", justifyContent: "center" },
  label:        { fontSize: 10, fontFamily: "SpaceGrotesk_600SemiBold", textAlign: "center" },
  labelFocused: { fontSize: 10, fontFamily: "SpaceGrotesk_700Bold", color: Colors.red, textAlign: "center" },
});
