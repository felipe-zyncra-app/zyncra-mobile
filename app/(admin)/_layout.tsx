import { Tabs, Redirect } from "expo-router";
import { View, ActivityIndicator } from "react-native";
import { Colors } from "@/constants/theme";
import { useAuth } from "@/lib/auth";
import FluidTabBar, { type TabItem } from "@/components/FluidTabBar";

const TABS: TabItem[] = [
  { name: "index",    label: "Panel",    icon: "home-outline",     iconFocused: "home" },
  { name: "agenda",   label: "Agenda",   icon: "calendar-outline", iconFocused: "calendar" },
  { name: "clients",  label: "Clientes", icon: "people-outline",   iconFocused: "people" },
  { name: "pos",      label: "Cobros",   icon: "card-outline",     iconFocused: "card" },
  { name: "settings", label: "Ajustes",  icon: "settings-outline", iconFocused: "settings" },
];

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
      tabBar={(props) => <FluidTabBar {...props} tabs={TABS} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index"         options={{ title: "Panel" }} />
      <Tabs.Screen name="agenda"        options={{ title: "Agenda" }} />
      <Tabs.Screen name="clients"       options={{ title: "Clientes" }} />
      <Tabs.Screen name="pos"           options={{ title: "Cobros" }} />
      <Tabs.Screen name="settings"      options={{ title: "Ajustes" }} />
      <Tabs.Screen name="whatsapp"        options={{ tabBarButton: () => null }} />
      <Tabs.Screen name="reviews-google"  options={{ tabBarButton: () => null }} />
      <Tabs.Screen name="reviews-site"    options={{ tabBarButton: () => null }} />
      <Tabs.Screen name="caja"            options={{ tabBarButton: () => null }} />
      <Tabs.Screen name="commissions"     options={{ tabBarButton: () => null }} />
      <Tabs.Screen name="invoices"        options={{ tabBarButton: () => null }} />
      <Tabs.Screen name="custom-fields"   options={{ tabBarButton: () => null }} />
      <Tabs.Screen name="reports"          options={{ tabBarButton: () => null }} />
      <Tabs.Screen name="pos-history"     options={{ tabBarButton: () => null }} />
      <Tabs.Screen name="finanzas"        options={{ tabBarButton: () => null }} />
      <Tabs.Screen name="inventario"      options={{ tabBarButton: () => null }} />
      <Tabs.Screen name="branding"        options={{ tabBarButton: () => null }} />
      <Tabs.Screen name="upcoming"        options={{ tabBarButton: () => null }} />
    </Tabs>
  );
}
