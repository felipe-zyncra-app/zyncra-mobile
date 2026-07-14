import { Tabs, Redirect } from "expo-router";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { Colors, Shadow, Glass } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

const TABS: { name: string; label: string; icon: IoniconName; iconFocused: IoniconName }[] = [
  { name: "index",    label: "Panel",    icon: "home-outline",     iconFocused: "home" },
  { name: "agenda",   label: "Agenda",   icon: "calendar-outline", iconFocused: "calendar" },
  { name: "clients",  label: "Clientes", icon: "people-outline",   iconFocused: "people" },
  { name: "pos",      label: "Cobros",   icon: "card-outline",     iconFocused: "card" },
  { name: "settings", label: "Ajustes",  icon: "settings-outline", iconFocused: "settings" },
];

function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  const currentRouteName = state.routes[state.index].name;
  const isSubScreen = !TABS.some(t => t.name === currentRouteName);
  const { t: theme } = useTheme();
  if (isSubScreen) return null;

  return (
    <View style={s.wrapper}>
      <BlurView tint={theme.blurTint} intensity={Glass.blurStrong.intensity} style={[s.bar, Shadow.md, { backgroundColor: theme.tabBarBg, borderColor: theme.tabBarBorder }]}>
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
              <View style={s.tabInner}>
                {focused ? (
                  <>
                    <View style={s.iconBox}>
                      <Ionicons name={tab.iconFocused} size={20} color="white" />
                    </View>
                    <Text style={s.labelFocused}>{tab.label}</Text>
                  </>
                ) : (
                  <>
                    <View style={s.iconBoxInactive}>
                      <Ionicons name={tab.icon} size={20} color={theme.subtle} />
                    </View>
                    <Text style={[s.label, { color: theme.subtle }]}>{tab.label}</Text>
                  </>
                )}
              </View>
            </TouchableOpacity>
          );
        })}
      </BlurView>
    </View>
  );
}

const s = StyleSheet.create({
  wrapper:         { position: "absolute", bottom: 0, left: 0, right: 0, paddingBottom: 24, paddingHorizontal: 12 },
  bar:             { backgroundColor: "rgba(255,255,255,0.55)", borderRadius: 22, flexDirection: "row", paddingVertical: 10, paddingHorizontal: 4, overflow: "hidden", borderWidth: 1, borderColor: "rgba(255,255,255,0.6)" },
  tab:             { flex: 1, alignItems: "center" },
  tabInner:        { alignItems: "center", gap: 4 },
  iconBox:         { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: Colors.red },
  iconBoxInactive: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  label:           { fontSize: 10, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.subtle, textAlign: "center" },
  labelFocused:    { fontSize: 10, fontFamily: "SpaceGrotesk_700Bold", color: Colors.red, textAlign: "center" },
});

export default function AdminLayout() {
  const { role, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: Colors.cream2 }}>
        <ActivityIndicator color={Colors.red} size="large" />
      </View>
    );
  }

  if (role !== "admin") return <Redirect href="/(auth)/login" />;

  return (
    <Tabs
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index"         options={{ title: "Panel" }} />
      <Tabs.Screen name="agenda"        options={{ title: "Agenda" }} />
      <Tabs.Screen name="clients"       options={{ title: "Clientes" }} />
      <Tabs.Screen name="pos"           options={{ title: "Cobros" }} />
      <Tabs.Screen name="settings"      options={{ title: "Ajustes" }} />
      <Tabs.Screen name="services"      options={{ tabBarButton: () => null }} />
      <Tabs.Screen name="team"          options={{ tabBarButton: () => null }} />
      <Tabs.Screen name="business-info" options={{ tabBarButton: () => null }} />
      <Tabs.Screen name="schedule"      options={{ tabBarButton: () => null }} />
      <Tabs.Screen name="reminders"     options={{ tabBarButton: () => null }} />
      <Tabs.Screen name="profile"         options={{ tabBarButton: () => null }} />
      <Tabs.Screen name="billing"         options={{ tabBarButton: () => null }} />
      <Tabs.Screen name="whatsapp"        options={{ tabBarButton: () => null }} />
      <Tabs.Screen name="reviews-google"  options={{ tabBarButton: () => null }} />
      <Tabs.Screen name="reviews-site"    options={{ tabBarButton: () => null }} />
      <Tabs.Screen name="caja"            options={{ tabBarButton: () => null }} />
      <Tabs.Screen name="commissions"     options={{ tabBarButton: () => null }} />
      <Tabs.Screen name="invoices"        options={{ tabBarButton: () => null }} />
      <Tabs.Screen name="custom-fields"   options={{ tabBarButton: () => null }} />
      <Tabs.Screen name="reports"          options={{ tabBarButton: () => null }} />
      <Tabs.Screen name="pos-history"     options={{ tabBarButton: () => null }} />
      <Tabs.Screen name="push-now"        options={{ tabBarButton: () => null }} />
    </Tabs>
  );
}
