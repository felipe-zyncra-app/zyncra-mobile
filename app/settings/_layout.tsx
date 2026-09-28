import { Stack } from "expo-router";
import { useGuardArea } from "@/lib/guards";

export default function SettingsStackLayout() {
  // /settings/* vive fuera de (admin): sin este guard, un colaborador abría
  // zyncra://settings/team y una cuenta suspendida seguía editando servicios,
  // horario y equipo encima de AccountBlocked (ARQ-06 / SEG-20).
  const bloqueo = useGuardArea("admin");
  if (bloqueo) return bloqueo;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        gestureEnabled: true,
        animation: "slide_from_right",
      }}
    />
  );
}
