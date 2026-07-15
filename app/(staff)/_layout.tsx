import { Tabs, Redirect } from "expo-router";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Colors, Fonts, Gradients, Shadow } from "@/constants/theme";
import { useAuth } from "@/lib/auth";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

const TABS: { name: string; label: string; icon: IoniconName; iconFocused: IoniconName }[] = [
  { name: "agenda",  label: "Mi Agenda", icon: "calendar-outline", iconFocused: "calendar" },
  { name: "clients", label: "Clientes",  icon: "people-outline",   iconFocused: "people" },
  { name: "profile", label: "Mi Perfil", icon: "person-outline",   iconFocused: "person" },
];

// Pill de tinta oscura — mismo patrón que la tab bar de admin (eco de la
// sidebar del portal web #0C0C14).
function StaffTabBar({ state, navigation }: BottomTabBarProps) {
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

export default function StaffLayout() {
  const { role, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: Colors.cream2 }}>
        <ActivityIndicator color={Colors.red} size="large" />
      </View>
    );
  }

  if (role !== "staff") return <Redirect href="/(auth)/login" />;

  return (
    <Tabs tabBar={(props) => <StaffTabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="agenda"  options={{ title: "Mi Agenda" }} />
      <Tabs.Screen name="clients" options={{ title: "Clientes" }} />
      <Tabs.Screen name="profile" options={{ title: "Mi Perfil" }} />
    </Tabs>
  );
}
