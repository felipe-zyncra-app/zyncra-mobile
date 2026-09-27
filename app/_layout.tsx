import { useEffect, useState } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useFonts, SpaceGrotesk_400Regular, SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold } from "@expo-google-fonts/space-grotesk";
import { JetBrainsMono_500Medium, JetBrainsMono_700Bold } from "@expo-google-fonts/jetbrains-mono";
import { InstrumentSerif_400Regular, InstrumentSerif_400Regular_Italic } from "@expo-google-fonts/instrument-serif";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { View, StyleSheet } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ThemeProvider, useTheme } from "@/lib/theme";
import { AuthProvider, useAuth } from "@/lib/auth";
import { TenantProvider } from "@/lib/tenant";
import { SubscriptionProvider } from "@/lib/subscription";
import { PantallaCargando } from "@/lib/guards";
import ZyncraIntro from "@/components/ZyncraIntro";
import { liberarPushPendiente, registrarPushDelDispositivo, scheduleDailyBriefing } from "@/lib/notifications";

const CLAVE_INTRO = "zyncra_intro_vista";

/**
 * Lo que depende de QUIÉN tiene la sesión. Antes el token push se registraba
 * al montar la raíz, sobre la intro y antes del login: savePushToken salía sin
 * usuario y un dueño recién registrado no recibía "Nueva cita" hasta matar la
 * app (ARQ-04 / COM-07). Ahora corre cada vez que cambia la cuenta, y el
 * permiso se pide en contexto, ya dentro de la app.
 */
function EfectosDeSesion() {
  const { estado, tenantId, user } = useAuth();
  const userId = user?.id ?? null;

  useEffect(() => {
    if (estado === "admin" && tenantId) {
      // El portal manda los push a tenants.push_token: solo el dueño lo registra.
      registrarPushDelDispositivo(tenantId).catch(() => {});
      scheduleDailyBriefing().catch(() => {});
    } else if (estado === "staff") {
      // El staff no registra push, pero si el teléfono quedó anotado en el
      // negocio de un dueño que salió sin red, aquí se libera (SEG-14).
      liberarPushPendiente().catch(() => {});
      scheduleDailyBriefing().catch(() => {});
    }
  }, [estado, tenantId, userId]);

  return null;
}

/**
 * Intro de marca solo en la PRIMERA apertura. Antes eran 2,2 s en cada
 * arranque en frío, con un overlay que bloqueaba los toques, en una app de
 * caja que se abre decenas de veces al día (ARQ-18).
 */
function useIntroPrimeraVez(): { estado: "pendiente" | "mostrar" | "no"; terminar: () => void } {
  const [estado, setEstado] = useState<"pendiente" | "mostrar" | "no">("pendiente");
  useEffect(() => {
    let vigente = true;
    AsyncStorage.getItem(CLAVE_INTRO)
      .then(v => { if (vigente) setEstado(v ? "no" : "mostrar"); })
      .catch(() => { if (vigente) setEstado("no"); });
    return () => { vigente = false; };
  }, []);
  const terminar = () => {
    setEstado("no");
    AsyncStorage.setItem(CLAVE_INTRO, "1").catch(() => {});
  };
  return { estado, terminar };
}

function AppContent() {
  const { t } = useTheme();
  const intro = useIntroPrimeraVez();

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: t.bg }}>
      <StatusBar style={intro.estado === "mostrar" ? "light" : t.statusBar} />
      <EfectosDeSesion />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }}>
        <Stack.Screen name="(admin)" options={{ animation: "fade", gestureEnabled: false }} />
        <Stack.Screen name="(auth)"  options={{ animation: "fade", gestureEnabled: false }} />
        <Stack.Screen name="(staff)" options={{ animation: "fade", gestureEnabled: false }} />
        <Stack.Screen name="sin-acceso" options={{ animation: "fade", gestureEnabled: false }} />
      </Stack>
      {/* Mientras se lee la marca de la intro (unos ms) se tapa con el fondo
          para no mostrar un cuadro de la app y luego la intro encima. */}
      {intro.estado === "pendiente" && <View style={[StyleSheet.absoluteFill, { backgroundColor: t.bg }]} />}
      {intro.estado === "mostrar" && <ZyncraIntro onDone={intro.terminar} />}
    </GestureHandlerRootView>
  );
}

function Raiz() {
  const [fontsLoaded] = useFonts({
    SpaceGrotesk_400Regular,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
    JetBrainsMono_500Medium,
    JetBrainsMono_700Bold,
    InstrumentSerif_400Regular,
    InstrumentSerif_400Regular_Italic,
  });

  // Fondo del tema (antes #F4F4F9 fijo: un destello blanco en modo oscuro).
  if (!fontsLoaded) return <PantallaCargando />;

  return (
    <AuthProvider>
      <TenantProvider>
        <SubscriptionProvider>
          <AppContent />
        </SubscriptionProvider>
      </TenantProvider>
    </AuthProvider>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <Raiz />
    </ThemeProvider>
  );
}
