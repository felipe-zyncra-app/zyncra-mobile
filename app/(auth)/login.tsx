import { useState, useEffect } from "react";
import {
  View, Text, TextInput, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, Pressable,
  Image, Dimensions,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import Animated, {
  FadeInDown, FadeIn, useSharedValue, useAnimatedStyle, withSpring,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { Colors, Radius } from "@/constants/theme";

const { height } = Dimensions.get("window");
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function SolidButton({ label, onPress, loading }: { label: string; onPress: () => void; loading?: boolean }) {
  const scale = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <AnimatedPressable
      style={[anim, btn.solid]}
      onPressIn={() => { scale.value = withSpring(0.97, { stiffness: 400 }); }}
      onPressOut={() => { scale.value = withSpring(1,    { stiffness: 400 }); }}
      onPress={onPress}>
      <Text style={btn.label}>{loading ? "Entrando…" : label}</Text>
    </AnimatedPressable>
  );
}

export default function LoginScreen() {
  const router = useRouter();
  const { role } = useAuth();
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState<string | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [focused,  setFocused]  = useState<string | null>(null);
  const [showPass, setShowPass] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) { setError("Completa todos los campos."); return; }
    setLoading(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) { setLoading(false); setError(err.message); return; }
    // AuthProvider's onAuthStateChange handles role resolution and redirect
  };

  useEffect(() => {
    if (role === "admin") router.replace("/(admin)");
    else if (role === "staff") router.replace("/(staff)/agenda");
  }, [role]);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <StatusBar style="light" />

      <View style={s.bg}>
        {/* Ambient blobs */}
        <View style={[s.blob, { top: -100, left: -70,  backgroundColor: "rgba(251,15,5,0.2)"   }]} />
        <View style={[s.blob, { top: height * 0.3, right: -90, backgroundColor: "rgba(0,39,254,0.16)" }]} />
        <View style={[s.blob, { bottom: -80, left: -50, backgroundColor: "rgba(0,39,254,0.16)" }]} />

        {/* Corner accents */}
        <View style={[s.corner, s.cornerTL]} />
        <View style={[s.corner, s.cornerBR]} />

        <ScrollView
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

            <Text style={s.heading}>Bienvenido de vuelta</Text>
            <Text style={s.sub}>Inicia sesión en tu cuenta</Text>

            {error && (
              <Animated.View entering={FadeInDown.duration(300)} style={s.errorBox}>
                <Ionicons name="alert-circle-outline" size={15} color="#ff6060" style={{ marginRight: 6 }} />
                <Text style={s.errorText}>{error}</Text>
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
                  value={email}
                  onChangeText={setEmail}
                  onFocus={() => setFocused("email")}
                  onBlur={() => setFocused(null)}
                />
              </View>
            </Animated.View>

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
                  value={password}
                  onChangeText={setPassword}
                  onFocus={() => setFocused("password")}
                  onBlur={() => setFocused(null)}
                />
                <Pressable onPress={() => setShowPass(v => !v)} style={{ padding: 4 }}>
                  <Ionicons
                    name={showPass ? "eye-off-outline" : "eye-outline"}
                    size={17}
                    color="rgba(255,255,255,0.35)"
                  />
                </Pressable>
              </View>
            </Animated.View>

            {/* CTA */}
            <Animated.View entering={FadeInDown.delay(440).duration(400)} style={{ marginTop: 8 }}>
              <SolidButton label="Iniciar sesión" onPress={handleLogin} loading={loading} />
            </Animated.View>

            {/* Aviso de acceso B2B (App Store 3.1.3(c)): la app es para negocios con
                cuenta existente. Solo informativo — sin link, precio ni registro. */}
            <Animated.View entering={FadeInDown.delay(520).duration(400)} style={s.accessNote}>
              <Ionicons name="business-outline" size={14} color="rgba(255,255,255,0.35)" style={{ marginTop: 1 }} />
              <Text style={s.accessNoteText}>
                App para negocios con cuenta Zyncra activa. Si trabajas en un negocio que ya usa Zyncra, pide tu acceso al administrador.
              </Text>
            </Animated.View>

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
