import { Stack, Redirect } from "expo-router";
import { View, ActivityIndicator } from "react-native";
import { Colors } from "@/constants/theme";
import { useAuth } from "@/lib/auth";

// Stack de la sección admin: (tabs) son las 5 pestañas principales; el
// resto de rutas se apilan encima como sub-pantallas, con el gesto de
// deslizar-atrás nativo de iOS (gestureEnabled por defecto en el Stack).
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
