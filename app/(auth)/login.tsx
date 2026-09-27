import { useState, useEffect, useCallback, useRef } from "react";
import {
  View, Text, TextInput, StyleSheet,
  KeyboardAvoidingView, ScrollView, Pressable,
  Image, Dimensions, ActivityIndicator,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import Animated, {
  FadeInDown, FadeIn, useSharedValue, useAnimatedStyle, withSpring,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { useRouter, useFocusEffect } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { Config } from "@/lib/config";
import { validarCorreo } from "@/lib/contacto";
import { traducirErrorAuth } from "@/lib/cuenta";
import { Colors } from "@/constants/theme";

const { height } = Dimensions.get("window");
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Si en este tiempo no se resolvió la cuenta, se suelta el botón con un mensaje. */
const TOPE_ENTRADA_MS = 25_000;

function SolidButton({ label, labelCargando, onPress, loading }: {
  label: string; labelCargando: string; onPress: () => void; loading?: boolean;
}) {
  const scale = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <AnimatedPressable
      style={[anim, btn.solid, loading && { opacity: 0.75 }]}
      onPressIn={() => { if (!loading) scale.value = withSpring(0.97, { stiffness: 400 }); }}
      onPressOut={() => { scale.value = withSpring(1,    { stiffness: 400 }); }}
      onPress={onPress}
      // Mientras carga no se puede volver a enviar (antes permitía varios envíos seguidos).
      disabled={loading}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!loading, busy: !!loading }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {loading && <ActivityIndicator size="small" color="white" />}
        <Text style={btn.label}>{loading ? labelCargando : label}</Text>
      </View>
    </AnimatedPressable>
  );
}

export default function LoginScreen() {
  const router = useRouter();
  const { estado } = useAuth();
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState<string | null>(null);
  const [aviso,    setAviso]    = useState<string | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [focused,  setFocused]  = useState<string | null>(null);
  const [showPass, setShowPass] = useState(false);
  // "¿Olvidaste tu contraseña?" (AJU-09): el mismo correo de recuperación
  // que manda el portal, que abre su página /reset-password.
  const [recuperando, setRecuperando] = useState(false);
  const [enviandoRec, setEnviandoRec] = useState(false);
  const tope = useRef<ReturnType<typeof setTimeout> | null>(null);

  // El registro se abre ENCIMA del login, que sigue montado. Sin saber si
  // está a la vista, el efecto de abajo lo sacaba del registro en cuanto el
  // rol pasaba a admin y el dueño nunca veía "¡Cuenta creada!" (ARQ-17).
  const [enfocada, setEnfocada] = useState(false);
  useFocusEffect(useCallback(() => {
    setEnfocada(true);
    return () => setEnfocada(false);
  }, []));

  const soltar = () => {
    if (tope.current) clearTimeout(tope.current);
    tope.current = null;
    setLoading(false);
  };
  useEffect(() => () => { if (tope.current) clearTimeout(tope.current); }, []);

  const handleLogin = async () => {
    if (loading) return;
    // El autocompletado de iOS deja un espacio al final: sin trim, GoTrue
    // respondía "Invalid login credentials" con la contraseña correcta (AJU-22).
    const correo = email.trim().toLowerCase();
    if (!correo || !password) { setError("Completa todos los campos."); return; }
    setLoading(true);
    setError(null);
    setAviso(null);
    try {
      const { error: err } = await supabase.auth.signInWithPassword({ email: correo, password });
      if (err) { soltar(); setError(traducirErrorAuth(err)); return; }
    } catch (e) {
      soltar();
      setError(traducirErrorAuth(e));
      return;
    }
    // AuthProvider resuelve el rol. El efecto de abajo navega o suelta el
    // botón; si nada responde, el tope evita el "Entrando…" eterno (AJU-06).
    tope.current = setTimeout(() => {
      tope.current = null;
      setLoading(false);
      setError("No pudimos terminar de entrar. Revisa tu conexión e inténtalo de nuevo.");
    }, TOPE_ENTRADA_MS);
  };

  useEffect(() => {
    if (!enfocada) return;
    if (estado === "admin") { soltar(); router.replace("/(admin)/(tabs)"); return; }
    if (estado === "staff") { soltar(); router.replace("/(staff)/agenda"); return; }
    // Sesión sin negocio, colaborador desactivado o sin red: AuthProvider lleva
    // a /sin-acceso, que explica el caso y ofrece salidas. Aquí solo se suelta
    // el botón para que no quede en "Entrando…".
    if (estado === "sin-rol" || estado === "desactivado" || estado === "error") soltar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado, enfocada]);

  const enviarRecuperacion = async () => {
    if (enviandoRec) return;
    const correo = validarCorreo(email);
    if (!correo.ok) { setError(correo.error ?? "Escribe tu correo."); return; }
    setEnviandoRec(true);
    setError(null);
    setAviso(null);
    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(correo.valor!, {
        redirectTo: Config.urls.restablecerContrasena,
      });
      if (err) { setError(traducirErrorAuth(err)); return; }
      // Mismo texto exista o no la cuenta: no se revela qué correos están registrados.
      setAviso(`Si hay una cuenta con ${correo.valor}, te enviamos un enlace para crear una contraseña nueva. Revisa también el spam.`);
      setRecuperando(false);
    } catch (e) {
      setError(traducirErrorAuth(e));
    } finally {
      setEnviandoRec(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }}>
      <StatusBar style="light" />

      <View style={s.bg}>
        {/* Ambient blobs */}
        <View style={[s.blob, { top: -100, left: -70,  backgroundColor: "rgba(251,15,5,0.2)"   }]} />
        <View style={[s.blob, { top: height * 0.3, right: -90, backgroundColor: "rgba(0,39,254,0.16)" }]} />
        <View style={[s.blob, { bottom: -80, left: -50, backgroundColor: "rgba(0,39,254,0.16)" }]} />

        {/* Corner accents */}
        <View style={[s.corner, s.cornerTL]} />
        <View style={[s.corner, s.cornerBR]} />

        <ScrollView automaticallyAdjustKeyboardInsets
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>

          {/* ── Logo section ───────────────────────────────────────── */}
          <Animated.View entering={FadeIn.duration(800)} style={s.logoSection}>
            <View style={s.logoWrap}>
              <Image
                source={require("../../assets/zyncra-logo.png")}
                style={s.logoImg}
                resizeMode="cover"
              />
              <View style={s.logoGlow} />
            </View>
            <Text style={s.appName}>Zyncra</Text>
            <Text style={s.tagline}>GESTIONA TU NEGOCIO INTELIGENTE</Text>
          </Animated.View>

          {/* ── Form card ──────────────────────────────────────────── */}
          <Animated.View
            entering={FadeInDown.delay(180).duration(600).springify()}
            style={s.card}>

            <Text style={s.heading} accessibilityRole="header">
              {recuperando ? "Recupera tu contraseña" : "Bienvenido de vuelta"}
            </Text>
            <Text style={s.sub}>
              {recuperando ? "Te enviaremos un enlace a tu correo" : "Inicia sesión en tu cuenta"}
            </Text>

            {error && (
              <Animated.View entering={FadeInDown.duration(300)} style={s.errorBox} accessibilityRole="alert">
                <Ionicons name="alert-circle-outline" size={15} color="#ff6060" style={{ marginRight: 6 }} />
                <Text style={s.errorText}>{error}</Text>
              </Animated.View>
            )}
            {aviso && (
              <Animated.View entering={FadeInDown.duration(300)} style={s.avisoBox} accessibilityLiveRegion="polite">
                <Ionicons name="mail-outline" size={15} color="#5eead4" style={{ marginRight: 6 }} />
                <Text style={s.avisoText}>{aviso}</Text>
              </Animated.View>
            )}

            {/* Email */}
            <Animated.View entering={FadeInDown.delay(300).duration(400)}>
              <Text style={s.label}>Correo electrónico</Text>
              <View style={[s.inputRow, focused === "email" && s.inputRowFocused]}>
                <Ionicons
                  name="mail-outline" size={17}
                  color={focused === "email" ? Colors.red : "rgba(255,255,255,0.3)"}
                  style={{ marginRight: 10 }}
                />
                <TextInput
                  style={s.input}
                  placeholder="tu@correo.com"
                  placeholderTextColor="rgba(255,255,255,0.22)"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  textContentType="username"
                  accessibilityLabel="Correo electrónico"
                  value={email}
                  onChangeText={setEmail}
                  onFocus={() => setFocused("email")}
                  onBlur={() => setFocused(null)}
                />
              </View>
            </Animated.View>

            {recuperando ? (
              <View style={{ marginTop: 4 }}>
                <SolidButton label="Enviar enlace" labelCargando="Enviando…" onPress={enviarRecuperacion} loading={enviandoRec} />
                <Pressable style={s.forgotLink} onPress={() => { setRecuperando(false); setError(null); }} accessibilityRole="button">
                  <Text style={s.forgotText}>Volver a iniciar sesión</Text>
                </Pressable>
              </View>
            ) : (
            <>
            {/* Password */}
            <Animated.View entering={FadeInDown.delay(370).duration(400)}>
              <Text style={s.label}>Contraseña</Text>
              <View style={[s.inputRow, focused === "password" && s.inputRowFocused]}>
                <Ionicons
                  name="lock-closed-outline" size={17}
                  color={focused === "password" ? Colors.red : "rgba(255,255,255,0.3)"}
                  style={{ marginRight: 10 }}
                />
                <TextInput
                  style={[s.input, { flex: 1 }]}
                  placeholder="Tu contraseña"
                  placeholderTextColor="rgba(255,255,255,0.22)"
                  secureTextEntry={!showPass}
                  autoComplete="password"
                  textContentType="password"
                  accessibilityLabel="Contraseña"
                  onSubmitEditing={handleLogin}
                  value={password}
                  onChangeText={setPassword}
                  onFocus={() => setFocused("password")}
                  onBlur={() => setFocused(null)}
                />
                <Pressable
                  onPress={() => setShowPass(v => !v)} style={{ padding: 4 }} hitSlop={8}
                  accessibilityRole="button" accessibilityLabel={showPass ? "Ocultar contraseña" : "Mostrar contraseña"}>
                  <Ionicons
                    name={showPass ? "eye-off-outline" : "eye-outline"}
                    size={17}
                    color="rgba(255,255,255,0.35)"
                  />
                </Pressable>
              </View>
            </Animated.View>

            <Pressable
              style={s.forgotInline}
              onPress={() => { setRecuperando(true); setError(null); setAviso(null); }}
              hitSlop={8}
              accessibilityRole="button">
              <Text style={s.forgotText}>¿Olvidaste tu contraseña?</Text>
            </Pressable>

            {/* CTA */}
            <Animated.View entering={FadeInDown.delay(440).duration(400)} style={{ marginTop: 8 }}>
              <SolidButton label="Iniciar sesión" labelCargando="Entrando…" onPress={handleLogin} loading={loading} />
            </Animated.View>
            </>
            )}

            {/* Alta de negocio. Recoge datos y crea la cuenta: no muestra planes
                ni precios, y no cobra nada dentro de la app. */}
            <Animated.View entering={FadeInDown.delay(500).duration(400)}>
              <Pressable style={s.registerLink} onPress={() => router.push("/(auth)/register")} accessibilityRole="button">
                <Text style={s.registerLinkText}>
                  ¿No tienes cuenta? <Text style={s.registerLinkStrong}>Regístrate gratis</Text>
                </Text>
              </Pressable>
            </Animated.View>

            {/* Aviso para colaboradores: las cuentas de staff no se crean aquí,
                las da de alta el dueño del negocio desde Ajustes → Equipo. */}
            <Animated.View entering={FadeInDown.delay(560).duration(400)} style={s.accessNote}>
              <Ionicons name="business-outline" size={14} color="rgba(255,255,255,0.35)" style={{ marginTop: 1 }} />
              <Text style={s.accessNoteText}>
                ¿Trabajas en un negocio que ya usa Zyncra? No te registres aquí: pide tu acceso al administrador.
              </Text>
            </Animated.View>

            <Pressable
              style={s.legalLink}
              onPress={() => Linking.openURL(Config.urls.privacidad).catch(() => {})}
              accessibilityRole="link">
              <Text style={s.legalText}>Política de privacidad</Text>
            </Pressable>

          </Animated.View>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

// ── Solid button ───────────────────────────────────────────────────────────────
const btn = StyleSheet.create({
  solid: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    backgroundColor: Colors.red,
  },
  label: {
    color: "white",
    fontSize: 15,
    fontFamily: "SpaceGrotesk_700Bold",
    letterSpacing: 0.3,
  },
});

// ── Screen styles ──────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  bg: {
    flex: 1,
    backgroundColor: "#07071a",
  },
  blob: {
    position: "absolute",
    width: 300, height: 300,
    borderRadius: 150,
  },
  corner: {
    position: "absolute",
    width: 28, height: 28,
    borderColor: "rgba(251,15,5,0.28)",
  },
  cornerTL: {
    top: 52, left: 22,
    borderTopWidth: 1.5, borderLeftWidth: 1.5,
    borderTopLeftRadius: 6,
  },
  cornerBR: {
    bottom: 52, right: 22,
    borderBottomWidth: 1.5, borderRightWidth: 1.5,
    borderBottomRightRadius: 6,
  },
  scroll: {
    flexGrow: 1,
    paddingBottom: 48,
  },

  // Logo
  logoSection: {
    alignItems: "center",
    paddingTop: 88,
    paddingBottom: 52,
  },
  logoWrap: {
    marginBottom: 20,
    shadowColor: "#fb0f05",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 28,
    elevation: 20,
  },
  logoImg: {
    width: 96, height: 96,
    borderRadius: 24,
  },
  logoGlow: {
    position: "absolute",
    top: -10, left: -10, right: -10, bottom: -10,
    borderRadius: 34,
    shadowColor: "#0027fe",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 22,
  },
  appName: {
    fontSize: 30,
    fontFamily: "SpaceGrotesk_700Bold",
    color: "white",
    letterSpacing: -0.8,
    marginBottom: 6,
  },
  tagline: {
    fontSize: 9.5,
    fontFamily: "SpaceGrotesk_600SemiBold",
    color: "rgba(255,255,255,0.32)",
    letterSpacing: 2.2,
    textTransform: "uppercase",
  },

  // Card
  card: {
    marginHorizontal: 20,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
    borderRadius: 26,
    padding: 28,
  },
  heading: {
    fontSize: 22,
    fontFamily: "SpaceGrotesk_700Bold",
    color: "white",
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  sub: {
    fontSize: 14,
    fontFamily: "SpaceGrotesk_400Regular",
    color: "rgba(255,255,255,0.42)",
    marginBottom: 26,
  },
  label: {
    fontSize: 12,
    fontFamily: "SpaceGrotesk_600SemiBold",
    color: "rgba(255,255,255,0.5)",
    marginBottom: 8,
    letterSpacing: 0.3,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.09)",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 18,
  },
  inputRowFocused: {
    borderColor: Colors.red,
    backgroundColor: "rgba(251,15,5,0.07)",
  },
  input: {
    flex: 1,
    fontSize: 14,
    fontFamily: "SpaceGrotesk_400Regular",
    color: "white",
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(251,15,5,0.1)",
    borderWidth: 1,
    borderColor: "rgba(251,15,5,0.28)",
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    flex: 1,
    color: "#ff6060",
    fontSize: 13,
    fontFamily: "SpaceGrotesk_600SemiBold",
  },
  avisoBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "rgba(45,212,191,0.1)",
    borderWidth: 1,
    borderColor: "rgba(45,212,191,0.3)",
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  avisoText: {
    flex: 1,
    color: "#99f6e4",
    fontSize: 13,
    lineHeight: 18,
    fontFamily: "SpaceGrotesk_600SemiBold",
  },
  forgotInline: {
    alignSelf: "flex-end",
    marginTop: -8,
    marginBottom: 14,
    paddingVertical: 4,
  },
  forgotLink: {
    alignItems: "center",
    marginTop: 16,
    paddingVertical: 6,
  },
  forgotText: {
    fontSize: 13,
    fontFamily: "SpaceGrotesk_600SemiBold",
    color: "rgba(255,255,255,0.7)",
  },
  legalLink: {
    alignItems: "center",
    marginTop: 18,
    paddingVertical: 6,
  },
  legalText: {
    fontSize: 12,
    fontFamily: "SpaceGrotesk_400Regular",
    color: "rgba(255,255,255,0.5)",
    textDecorationLine: "underline",
  },
  registerLink: {
    alignItems: "center",
    marginTop: 18,
  },
  registerLinkText: {
    fontSize: 13.5,
    fontFamily: "SpaceGrotesk_400Regular",
    color: "rgba(255,255,255,0.5)",
  },
  registerLinkStrong: {
    fontFamily: "SpaceGrotesk_700Bold",
    color: Colors.red,
  },
  accessNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginTop: 22,
    paddingTop: 18,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  accessNoteText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: "SpaceGrotesk_400Regular",
    color: "rgba(255,255,255,0.38)",
  },
});
