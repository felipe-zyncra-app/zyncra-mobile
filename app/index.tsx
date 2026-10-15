import { Redirect } from "expo-router";
import { useAuth, RUTA_SIN_ACCESO } from "@/lib/auth";
import { PantallaCargando } from "@/lib/guards";
import { inicioAdministradorEquipo } from "@/lib/acceso-equipo";

export default function Index() {
  const { session, estado, loading, modulosWeb } = useAuth();

  if (loading) return <PantallaCargando />;
  if (!session) return <Redirect href="/(auth)/login" />;
  if (estado === "staff") return <Redirect href={modulosWeb ? inicioAdministradorEquipo(modulosWeb) : "/(staff)/agenda"} />;
  if (estado === "admin") return <Redirect href="/(admin)/(tabs)" />;
  // Sesión sin rol, colaborador desactivado o sin red: antes caía en (admin)
  // con rol null y rebotaba al login con la sesión abierta.
  return <Redirect href={RUTA_SIN_ACCESO} />;
}
