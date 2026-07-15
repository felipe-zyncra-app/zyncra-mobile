import { Tabs } from "expo-router";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Fonts, Gradients, Shadow } from "@/constants/theme";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

const TABS: { name: string; label: string; icon: IoniconName; iconFocused: IoniconName }[] = [
  { name: "index",    label: "Panel",    icon: "home-outline",     iconFocused: "home" },
  { name: "agenda",   label: "Agenda",   icon: "calendar-outline", iconFocused: "calendar" },
  { name: "clients",  label: "Clientes", icon: "people-outline",   iconFocused: "people" },
  { name: "pos",      label: "Cobros",   icon: "card-outline",     iconFocused: "card" },
  { name: "settings", label: "Ajustes",  icon: "settings-outline", iconFocused: "settings" },
];

// Pill de tinta oscura — eco de la sidebar del portal web (#0C0C14):
// ítem activo con fondo blanco al 8%, ícono acento #ff5d54 y barra
// de gradiente (adaptación de .navItem.active de admin.module.css).
function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  return (
    <View style={s.wrapper}>
      <View style={[s.bar, Shadow.md]}>
        {state.routes.filter(r => TABS.some(t => t.name === r.name)).map((route) => {
          const focused = state.routes[state.index].name === route.name;
          const tab = TABS.find(t => t.name === route.name) ?? TABS[0];

          return (
            <TouchableOpacity
              key={route.key}
              style={s.tab}
              onPress={() => navigation.navigate(route.name)}
              activeOpacity={0.7}
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
  accentBar:      { position: "absolute", top: 0, left: "28%" as any, right: "28%" as any, height: 2.5, borderBottomLeftRadius: 3, borderBottomRightRadius: 3 },
  label:          { fontSize: 9.5, fontFamily: Fonts.semibold, textAlign: "center" },
  labelActive:    { color: "white", fontFamily: Fonts.bold },
});

export default function AdminTabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index"    options={{ title: "Panel" }} />
      <Tabs.Screen name="agenda"   options={{ title: "Agenda" }} />
      <Tabs.Screen name="clients"  options={{ title: "Clientes" }} />
      <Tabs.Screen name="pos"      options={{ title: "Cobros" }} />
      <Tabs.Screen name="settings" options={{ title: "Ajustes" }} />
    </Tabs>
  );
}
