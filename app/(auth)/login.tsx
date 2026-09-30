import { useState, useEffect, useCallback, useRef } from "react";
import {
  View, Text, TextInput, StyleSheet,
  KeyboardAvoidingView, ScrollView, Pressable,
  ActivityIndicator,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import Animated, {
  FadeInDown, useSharedValue, useAnimatedStyle, withTiming, withRepeat,
  useReducedMotion, cancelAnimation, interpolateColor,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { useRouter, useFocusEffect } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { Config } from "@/lib/config";
import { validarCorreo } from "@/lib/contacto";
import { traducirErrorAuth } from "@/lib/cuenta";
import { Colors, Gradients } from "@/constants/theme";
import {
  Aurora, AnilloTrazo, Aparece, LogoBrillo, PalabraZyncra, useSacudida, EASE_OUT,
} from "@/components/Marca";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Coreografía de entrada (ms). La intro de la primera apertura termina con un
// fundido hacia aquí, así que la marca "sigue" en el mismo sitio de la escena.
const E = {
  anillo: 80, brillo: 460, palabra: 220, lema: 480,
  tarjeta: 380, campos: 520, paso: 60,
};

/** Si en este tiempo no se resolvió la cuenta, se suelta el botón con un mensaje. */
const TOPE_ENTRADA_MS = 25_000;

/**
 * Botón principal con el degradado de la marca. Se hunde al apoyar el dedo
 * (no al soltarlo) y, mientras espera la respuesta, un brillo lo recorre en
 * bucle para que se note que está trabajando.
 */
function SolidButton({ label, labelCargando, onPress, loading, reduced }: {
  label: string; labelCargando: string; onPress: () => void; loading?: boolean; reduced: boolean;
}) {
  const scale = useSharedValue(1);
  const brillo = useSharedValue(-1);
  const [ancho, setAncho] = useState(0);

  useEffect(() => {
    if (!loading || reduced) { cancelAnimation(brillo); brillo.set(-1); return; }
    brillo.set(-1);
    brillo.set(withRepeat(withTiming(1, { duration: 1100, easing: EASE_OUT }), -1, false));
    return () => cancelAnimation(brillo);
  }, [loading, reduced, brillo]);

  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  const banda = useAnimatedStyle(() => ({ transform: [{ translateX: brillo.get() * ancho }, { rotate: "18deg" }] }));

  return (
    <AnimatedPressable
      style={[anim, btn.solid, loading && { opacity: 0.85 }]}
      onLayout={e => setAncho(e.nativeEvent.layout.width)}
      onPressIn={() => { if (!loading) scale.set(withTiming(0.97, { duration: 110, easing: EASE_OUT })); }}
      onPressOut={() => { scale.set(withTiming(1, { duration: 160, easing: EASE_OUT })); }}
      onPress={onPress}
      // Mientras carga no se puede volver a enviar (antes permitía varios envíos seguidos).
      disabled={loading}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!loading, busy: !!loading }}>
      <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
      {loading && !reduced && (
        <Animated.View pointerEvents="none" style={[btn.banda, banda]}>
          <LinearGradient
            colors={["rgba(255,255,255,0)", "rgba(255,255,255,0.35)", "rgba(255,255,255,0)"]}
            start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      )}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {loading && <ActivityIndicator size="small" color="white" />}
        <Text style={btn.label}>{loading ? labelCargando : label}</Text>
      </View>
    </AnimatedPressable>
  );
}

/**
 * Caja de un campo: al enfocarlo, el borde y el fondo pasan a la marca con
 * una transición (no de golpe), y se enciende un halo pintado una vez.
 */
function CajaCampo({ activo, children }: { activo: boolean; children: React.ReactNode }) {
  const k = useSharedValue(activo ? 1 : 0);
  useEffect(() => {
    k.set(withTiming(activo ? 1 : 0, { duration: 180, easing: EASE_OUT }));
  }, [activo, k]);
  const haloSt = useAnimatedStyle(() => ({ opacity: k.get() }));
  const cajaSt = useAnimatedStyle(() => ({
    borderColor: interpolateColor(k.get(), [0, 1], ["rgba(255,255,255,0.09)", Colors.red]),
    backgroundColor: interpolateColor(k.get(), [0, 1], ["rgba(255,255,255,0.07)", "rgba(251,15,5,0.07)"]),
  }));
  return (
    <View style={{ marginBottom: 18 }}>
      <Animated.View pointerEvents="none" style={[s.halo, haloSt]} />
      <Animated.View style={[s.inputRow, cajaSt]}>
        {children}
      </Animated.View>
    </View>
  );
}

export default function LoginScreen() {
  const router = useRouter();
  const { estado } = useAuth();
  const reduced = useReducedMotion();
  const { estilo: sacudidaSt, sacudir } = useSacudida(reduced);
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

  // Cada error nuevo sacude la tarjeta: dice "no" sin tener que leer.
  useEffect(() => { if (error) sacudir(); }, [error]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const campoEn = (i: number) => E.campos + i * E.paso;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }}>
      <StatusBar style="light" />

      <View style={s.bg}>
        <Aurora reduced={reduced} intensidad={0.85} />

        <ScrollView automaticallyAdjustKeyboardInsets
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>

          {/* ── Logo section ───────────────────────────────────────── */}
          <View style={s.logoSection}>
            <View style={s.logoWrap}>
              <AnilloTrazo size={150} empiezaEn={E.anillo} dura={760} reduced={reduced} />
              <View style={s.logoGlow} />
              <LogoBrillo size={88} radius={22} brilloEn={E.brillo} reduced={reduced} />
            </View>
            <PalabraZyncra empiezaEn={E.palabra} reduced={reduced} escalonado={36} />
            <Aparece empiezaEn={E.lema} reduced={reduced} sube={6}>
              <Text style={s.tagline}>GESTIONA TU NEGOCIO INTELIGENTE</Text>
            </Aparece>
          </View>

          {/* ── Form card ──────────────────────────────────────────── */}
          <Aparece empiezaEn={E.tarjeta} reduced={reduced} sube={28} dura={680}>
          <Animated.View style={[s.card, sacudidaSt]}>
            {/* Filo de luz con el degradado de la marca */}
            <LinearGradient
              pointerEvents="none"
              colors={["rgba(251,15,5,0)", "rgba(251,15,5,0.85)", "rgba(0,39,254,0.85)", "rgba(0,39,254,0)"]}
              locations={[0, 0.3, 0.7, 1]}
              start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
              style={s.cardFilo}
            />

            <Text style={s.heading} accessibilityRole="header">
              {recuperando ? "Recupera tu contraseña" : "Bienvenido de vuelta"}
            </Text>
            <Text style={s.sub}>
              {recuperando ? "Te enviaremos un enlace a tu correo" : "Inicia sesión en tu cuenta"}
            </Text>

            {error && (
              <Animated.View entering={FadeInDown.duration(260).easing(EASE_OUT)} style={s.errorBox} accessibilityRole="alert">
                <Ionicons name="alert-circle-outline" size={15} color="#ff6060" style={{ marginRight: 6 }} />
                <Text style={s.errorText}>{error}</Text>
              </Animated.View>
            )}
            {aviso && (
              <Animated.View entering={FadeInDown.duration(260).easing(EASE_OUT)} style={s.avisoBox} accessibilityLiveRegion="polite">
                <Ionicons name="mail-outline" size={15} color="#5eead4" style={{ marginRight: 6 }} />
                <Text style={s.avisoText}>{aviso}</Text>
              </Animated.View>
            )}

            {/* Email */}
            <Aparece empiezaEn={campoEn(0)} reduced={reduced}>
              <Text style={[s.label, focused === "email" && s.labelFocused]}>Correo electrónico</Text>
              <CajaCampo activo={focused === "email"}>
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
              </CajaCampo>
            </Aparece>

            {recuperando ? (
              <View style={{ marginTop: 4 }}>
                <SolidButton label="Enviar enlace" labelCargando="Enviando…" onPress={enviarRecuperacion} loading={enviandoRec} reduced={reduced} />
                <Pressable style={s.forgotLink} onPress={() => { setRecuperando(false); setError(null); }} accessibilityRole="button">
                  <Text style={s.forgotText}>Volver a iniciar sesión</Text>
                </Pressable>
              </View>
            ) : (
            <>
            {/* Password */}
            <Aparece empiezaEn={campoEn(1)} reduced={reduced}>
              <Text style={[s.label, focused === "password" && s.labelFocused]}>Contraseña</Text>
              <CajaCampo activo={focused === "password"}>
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
              </CajaCampo>
            </Aparece>

            <Pressable
              style={s.forgotInline}
              onPress={() => { setRecuperando(true); setError(null); setAviso(null); }}
              hitSlop={8}
              accessibilityRole="button">
              <Text style={s.forgotText}>¿Olvidaste tu contraseña?</Text>
            </Pressable>

            {/* CTA */}
            <Aparece empiezaEn={campoEn(2)} reduced={reduced} style={{ marginTop: 8 }}>
              <SolidButton label="Iniciar sesión" labelCargando="Entrando…" onPress={handleLogin} loading={loading} reduced={reduced} />
            </Aparece>
            </>
            )}

            {/* Alta de negocio. Recoge datos y crea la cuenta: no muestra planes
                ni precios, y no cobra nada dentro de la app. */}
            <Aparece empiezaEn={campoEn(3)} reduced={reduced}>
              <Pressable style={s.registerLink} onPress={() => router.push("/(auth)/register")} accessibilityRole="button">
                <Text style={s.registerLinkText}>
                  ¿No tienes cuenta? <Text style={s.registerLinkStrong}>Regístrate gratis</Text>
                </Text>
              </Pressable>
            </Aparece>

            {/* Aviso para colaboradores: las cuentas de staff no se crean aquí,
                las da de alta el dueño del negocio desde Ajustes → Equipo. */}
            <Aparece empiezaEn={campoEn(4)} reduced={reduced} style={s.accessNote}>
              <Ionicons name="business-outline" size={14} color="rgba(255,255,255,0.35)" style={{ marginTop: 1 }} />
              <Text style={s.accessNoteText}>
                ¿Trabajas en un negocio que ya usa Zyncra? No te registres aquí: pide tu acceso al administrador.
              </Text>
            </Aparece>

            <Pressable
              style={s.legalLink}
              onPress={() => Linking.openURL(Config.urls.privacidad).catch(() => {})}
              accessibilityRole="link">
              <Text style={s.legalText}>Política de privacidad</Text>
            </Pressable>

          </Animated.View>
          </Aparece>
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
    overflow: "hidden",
    backgroundColor: Colors.red,
    shadowColor: Colors.red,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
  },
  banda: {
    position: "absolute",
    top: -20, bottom: -20, left: 0,
    width: 70,
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
  scroll: {
    flexGrow: 1,
    paddingBottom: 48,
  },

  // Logo
  logoSection: {
    alignItems: "center",
    paddingTop: 72,
    paddingBottom: 40,
  },
  // Caja del tamaño del anillo, con el logo centrado.
  logoWrap: {
    width: 150, height: 150,
    alignItems: "center", justifyContent: "center",
    marginBottom: 2,
  },
  // Halo pintado una vez detrás del logo.
  logoGlow: {
    position: "absolute",
    width: 88, height: 88, borderRadius: 22,
    backgroundColor: "#07071a",
    shadowColor: Colors.red,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 30,
    elevation: 20,
  },
  tagline: {
    marginTop: 6,
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
    overflow: "hidden",
  },
  cardFilo: {
    position: "absolute",
    top: 0, left: 24, right: 24,
    height: 1,
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
  labelFocused: { color: "rgba(255,255,255,0.85)" },
  // Halo del campo enfocado: sombra pintada una vez, solo cambia su opacidad.
  halo: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: 14,
    backgroundColor: "#07071a",
    shadowColor: Colors.red,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 14,
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
