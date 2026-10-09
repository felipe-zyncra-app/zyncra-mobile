import { SafeAreaView } from "react-native-safe-area-context";
import CajaScreen from "../(admin)/caja";
import ErrorState from "@/components/ErrorState";
import { PantallaCargando } from "@/lib/guards";
import { useTheme } from "@/lib/theme";
import { useStaffPermissionsEstado } from "@/lib/permissions";

/**
 * Caja de una cuenta del equipo con permissions.manage_pos (la administradora):
 * la misma pantalla del dueño. La RLS ya le dejaba abrir, cerrar y registrar
 * movimientos, pero la app no se la ofrecía. Se entra desde el botón Caja de
 * la agenda; no es pestaña, así que la barra de abajo se oculta.
 */
export default function StaffCajaScreen() {
  const { t } = useTheme();
  const { perms, cargando } = useStaffPermissionsEstado();
  if (cargando) return <PantallaCargando />;
  if (!perms.manage_pos) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <ErrorState
          title="Tu cuenta no maneja la caja"
          message="Pídele al dueño del negocio que, en Equipo → Acceso del panel web, active «Administrador del negocio»."
        />
      </SafeAreaView>
    );
  }
  return <CajaScreen />;
}
