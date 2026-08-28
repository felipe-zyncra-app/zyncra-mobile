import { Tabs, Redirect } from "expo-router";
import { View, ActivityIndicator } from "react-native";
import { Colors } from "@/constants/theme";
import { useAuth } from "@/lib/auth";
import { useStaffPermissions } from "@/lib/permissions";
import FluidTabBar, { type TabItem } from "@/components/FluidTabBar";

const TABS: TabItem[] = [
  { name: "agenda",  label: "Mi Agenda", icon: "calendar-outline", iconFocused: "calendar" },
  { name: "clients", label: "Clientes",  icon: "people-outline",   iconFocused: "people" },
  { name: "profile", label: "Mi Perfil", icon: "person-outline",   iconFocused: "person" },
];

export default function StaffLayout() {
  const { role, loading } = useAuth();
  const perms = useStaffPermissions();
  const visibleTabs = perms.clients_tab ? TABS : TABS.filter(t => t.name !== "clients");

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: Colors.cream2 }}>
        <ActivityIndicator color={Colors.red} size="large" />
      </View>
    );
  }

  if (role !== "staff") return <Redirect href="/(auth)/login" />;

  return (
    <Tabs tabBar={(props) => <FluidTabBar {...props} tabs={visibleTabs} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="agenda"  options={{ title: "Mi Agenda" }} />
      <Tabs.Screen name="clients" options={{ title: "Clientes" }} />
      <Tabs.Screen name="profile" options={{ title: "Mi Perfil" }} />
    </Tabs>
  );
}
