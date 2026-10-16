import { Tabs } from "expo-router";
import { View } from "react-native";
import HannaFab from "@/components/HannaFab";
import BarraPestanas, { type Pestana } from "@/components/BarraPestanas";
import { useAuth } from "@/lib/auth";
import { pantallaPermitida } from "@/lib/acceso-equipo";

const TABS: Pestana[] = [
  { name: "index",    label: "Panel",    icon: "home-outline",     iconFocused: "home" },
  { name: "agenda",   label: "Agenda",   icon: "calendar-outline", iconFocused: "calendar" },
  { name: "clients",  label: "Clientes", icon: "people-outline",   iconFocused: "people" },
  { name: "pos",      label: "Cobros",   icon: "card-outline",     iconFocused: "card" },
  { name: "settings", label: "Ajustes",  icon: "settings-outline", iconFocused: "settings" },
];

export default function AdminTabsLayout() {
  const { role, modulosWeb } = useAuth();
  // La administradora del negocio ve solo las pestañas de sus módulos, y
  // Ajustes es su perfil (la configuración del negocio es del dueño).
  const visibles: Pestana[] = TABS
    .filter(t => !modulosWeb || pantallaPermitida(t.name, modulosWeb))
    .map(t => (modulosWeb && t.name === "settings"
      ? { ...t, label: "Mi perfil", icon: "person-outline", iconFocused: "person" }
      : t));
  return (
    <View style={{ flex: 1 }}>
      <Tabs
        tabBar={(props) => <BarraPestanas {...props} tabs={visibles} />}
        screenOptions={{ headerShown: false }}
      >
        <Tabs.Screen name="index"    options={{ title: "Panel" }} />
        <Tabs.Screen name="agenda"   options={{ title: "Agenda" }} />
        <Tabs.Screen name="clients"  options={{ title: "Clientes" }} />
        <Tabs.Screen name="pos"      options={{ title: "Cobros" }} />
        <Tabs.Screen name="settings" options={{ title: "Ajustes" }} />
      </Tabs>
      {/* Copiloto Hanna — flotante sobre todas las pestañas. Solo el dueño:
          la ruta de Hanna resuelve el negocio por el dueño (igual que el portal). */}
      {role === "admin" && <HannaFab />}
    </View>
  );
}
