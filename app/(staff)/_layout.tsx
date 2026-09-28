import { Tabs } from "expo-router";
import { useStaffPermissions } from "@/lib/permissions";
import { useGuardArea } from "@/lib/guards";
import FluidTabBar, { type TabItem } from "@/components/FluidTabBar";

const TABS: TabItem[] = [
  { name: "agenda",  label: "Mi Agenda", icon: "calendar-outline", iconFocused: "calendar" },
  { name: "clients", label: "Clientes",  icon: "people-outline",   iconFocused: "people" },
  { name: "profile", label: "Mi Perfil", icon: "person-outline",   iconFocused: "person" },
];

export default function StaffLayout() {
  const perms = useStaffPermissions();
  // El negocio sin pago al día bloquea también al equipo: si no, el dueño
  // queda fuera pero sus colaboradores siguen agendando y cobrando. Un
  // colaborador desactivado va a /sin-acceso (ver lib/guards.tsx).
  const bloqueo = useGuardArea("staff");
  const visibleTabs = perms.clients_tab ? TABS : TABS.filter(t => t.name !== "clients");

  if (bloqueo) return bloqueo;

  return (
    <Tabs tabBar={(props) => <FluidTabBar {...props} tabs={visibleTabs} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="agenda"  options={{ title: "Mi Agenda" }} />
      <Tabs.Screen name="clients" options={{ title: "Clientes" }} />
      <Tabs.Screen name="profile" options={{ title: "Mi Perfil" }} />
    </Tabs>
  );
}
