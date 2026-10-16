import { Tabs } from "expo-router";
import { useStaffPermissions } from "@/lib/permissions";
import { useGuardArea } from "@/lib/guards";
import { useAbrirAgendaAlTocar } from "@/lib/useAvisos";
import BarraPestanas, { type Pestana } from "@/components/BarraPestanas";

const TABS: Pestana[] = [
  { name: "agenda",  label: "Mi agenda", icon: "calendar-outline", iconFocused: "calendar" },
  { name: "clients", label: "Clientes",  icon: "people-outline",   iconFocused: "people" },
  { name: "profile", label: "Mi perfil", icon: "person-outline",   iconFocused: "person" },
];

export default function StaffLayout() {
  const perms = useStaffPermissions();
  // El negocio sin pago al día bloquea también al equipo: si no, el dueño
  // queda fuera pero sus colaboradores siguen agendando y cobrando. Un
  // colaborador desactivado va a /sin-acceso (ver lib/guards.tsx).
  const bloqueo = useGuardArea("staff");
  // Tocar un aviso de cita abre la agenda en el día de esa cita.
  useAbrirAgendaAlTocar(!bloqueo);
  const visibleTabs = perms.clients_tab ? TABS : TABS.filter(t => t.name !== "clients");

  if (bloqueo) return bloqueo;

  return (
    // backBehavior "history": volver desde Mi ficha o la Caja regresa a donde se
    // estaba (Mi perfil, la agenda), no siempre a la primera pestaña.
    <Tabs tabBar={(props) => <BarraPestanas {...props} tabs={visibleTabs} />} screenOptions={{ headerShown: false }} backBehavior="history">
      <Tabs.Screen name="agenda"  options={{ title: "Mi agenda" }} />
      <Tabs.Screen name="clients" options={{ title: "Clientes" }} />
      <Tabs.Screen name="profile" options={{ title: "Mi perfil" }} />
      {/* Subpantalla (no está en TABS): la caja de la administradora, desde la agenda. */}
      <Tabs.Screen name="caja"    options={{ title: "Caja" }} />
      {/* Subpantalla: su nombre y horario, desde Mi perfil (permisos edit_profile / edit_schedule). */}
      <Tabs.Screen name="mi-ficha" options={{ title: "Mi ficha" }} />
    </Tabs>
  );
}
