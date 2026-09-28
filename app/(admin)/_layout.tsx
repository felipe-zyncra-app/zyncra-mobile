import { Stack } from "expo-router";
import { useGuardArea } from "@/lib/guards";

// Stack de la sección admin: (tabs) son las 5 pestañas principales; el
// resto de rutas se apilan encima como sub-pantallas, con el gesto de
// deslizar-atrás nativo de iOS (gestureEnabled por defecto en el Stack).
export default function AdminLayout() {
  // Rol, suscripción y bloqueo: ver lib/guards.tsx. Suscripción suspendida o
  // cancelada reemplaza TODA el área admin; /settings/* tiene el mismo guard
  // en su propio layout (vive fuera de este grupo).
  const bloqueo = useGuardArea("admin");
  if (bloqueo) return bloqueo;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        gestureEnabled: true,
        animation: "slide_from_right",
        fullScreenGestureEnabled: true,
      }}
    >
      <Stack.Screen name="(tabs)" options={{ animation: "fade", gestureEnabled: false }} />
    </Stack>
  );
}
