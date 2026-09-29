import { Stack } from "expo-router";
import { useGuardArea } from "@/lib/guards";
import { useAbrirAvisosAlTocar } from "@/lib/useAvisos";

// Stack de la sección admin: (tabs) son las 5 pestañas principales; el
// resto de rutas se apilan encima como sub-pantallas, con el gesto de
// deslizar-atrás nativo de iOS (gestureEnabled por defecto en el Stack).
// notificaciones (la campana del Panel) no necesita opciones propias.
export default function AdminLayout() {
  // Rol, suscripción y bloqueo: ver lib/guards.tsx. Suscripción suspendida o
  // cancelada reemplaza TODA el área admin; /settings/* tiene el mismo guard
  // en su propio layout (vive fuera de este grupo).
  const bloqueo = useGuardArea("admin");
  // Tocar una notificación (push del portal o aviso local) abre la campana,
  // también en arranque en frío. Solo el dueño y con el área abierta.
  useAbrirAvisosAlTocar(!bloqueo);
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
