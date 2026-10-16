import { View, ActivityIndicator } from "react-native";
import { Redirect } from "expo-router";
import { Colors } from "@/constants/theme";
import { useTheme } from "./theme";
import { useAuth, RUTA_SIN_ACCESO } from "./auth";
import { inicioAdministradorEquipo } from "./acceso-equipo";
import { useSubscription } from "./subscription";
import AccountBlocked from "@/components/AccountBlocked";

/** Spinner a pantalla completa con el fondo del tema (claro u oscuro). */
export function PantallaCargando() {
  const { t } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.bg }}>
      <ActivityIndicator color={Colors.red} size="large" />
    </View>
  );
}

/**
 * Guard de un área de la app para su layout. Devuelve lo que hay que pintar
 * en lugar del contenido (spinner, redirección o AccountBlocked), o null si
 * se puede entrar.
 *
 *   export default function AdminLayout() {
 *     const bloqueo = useGuardArea("admin");
 *     if (bloqueo) return bloqueo;
 *     return <Stack … />;
 *   }
 *
 * Nunca manda un rol desconocido al login (con sesión válida eso era un
 * callejón sin salida): va a /sin-acceso, que explica y ofrece salidas.
 * Espera a conocer la suscripción antes de montar el área, para no disparar
 * las consultas del Panel de una cuenta suspendida (ARQ-16).
 */
export function useGuardArea(area: "admin" | "dueno" | "staff"): React.ReactElement | null {
  const { session, estado, loading, modulosWeb } = useAuth();
  const { blocked, resuelto } = useSubscription();

  if (loading) return <PantallaCargando />;
  if (!session) return <Redirect href="/(auth)/login" />;

  if (area === "dueno") {
    // /settings/*: solo el dueño, también frente a la administradora del negocio.
    if (estado === "staff") return <Redirect href={modulosWeb ? inicioAdministradorEquipo(modulosWeb) : "/(staff)/agenda"} />;
    if (estado !== "admin") return <Redirect href={RUTA_SIN_ACCESO} />;
  } else if (area === "admin") {
    // La administradora del negocio entra a (admin); qué pantallas, lo decide
    // AuthProvider con sus módulos. /settings sigue siendo solo del dueño.
    if (estado === "staff" && !modulosWeb) return <Redirect href="/(staff)/agenda" />;
    if (estado !== "admin" && estado !== "staff") return <Redirect href={RUTA_SIN_ACCESO} />;
  } else {
    if (estado === "admin") return <Redirect href="/(admin)/(tabs)" />;
    if (estado !== "staff") return <Redirect href={RUTA_SIN_ACCESO} />;
  }

  if (!resuelto) return <PantallaCargando />;
  // Suscripción suspendida o cancelada: se reemplaza TODA el área (también
  // el equipo: si no, el dueño queda fuera y sus colaboradores siguen).
  if (blocked) return <AccountBlocked />;
  return null;
}
