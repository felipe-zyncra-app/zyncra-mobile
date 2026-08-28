import { useEffect } from "react";
import { View, StyleSheet, Dimensions, Image } from "react-native";
import Animated, {
  useSharedValue, useAnimatedStyle,
  withTiming, withSequence, withDelay,
  FadeInDown, FadeIn, ZoomIn,
  Easing,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { Colors, Gradients } from "@/constants/theme";

const { height } = Dimensions.get("window");
const LETTERS = ["Z", "y", "n", "c", "r", "a"];
const BAR_W = 148;

// Coreografía (ms) — corta y sin tiempo muerto: el logo entra casi de inmediato
const T = {
  logo:    80,    // logo entra con spring
  ring:    340,   // pulso único al "aterrizar" el logo
  word:    380,   // letras en cascada
  bar:     760,   // barrido del gradiente de marca bajo el wordmark
  tagline: 980,   // tagline
  exit:    1780,  // fade de salida
  done:    2200,  // onDone
};

// Pulso único que se expande detrás del logo cuando aterriza
function LandingRing() {
  const scale = useSharedValue(0.6);
  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.value = withDelay(T.ring, withSequence(
      withTiming(0.7, { duration: 80 }),
      withTiming(0, { duration: 820, easing: Easing.out(Easing.cubic) }),
    ));
    scale.value = withDelay(T.ring, withTiming(3.4, { duration: 900, easing: Easing.out(Easing.cubic) }));
  }, []);

  const st = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={[st, {
      position: "absolute", width: 96, height: 96,
      borderRadius: 48, borderWidth: 1.5, borderColor: "rgba(251,15,5,0.55)",
    }]} />
  );
}

export default function ZyncraIntro({ onDone }: { onDone: () => void }) {
  const exitOpacity = useSharedValue(1);
  const exitScale   = useSharedValue(1);
  const logoGlow    = useSharedValue(0);
  const barX        = useSharedValue(-BAR_W);

  useEffect(() => {
    // Un solo pulso de glow al aterrizar el logo, luego reposo tenue
    logoGlow.value = withDelay(T.ring, withSequence(
      withTiming(0.9,  { duration: 280 }),
      withTiming(0.25, { duration: 650 }),
    ));
    // Barrido del gradiente de marca (izquierda → derecha)
    barX.value = withDelay(T.bar, withTiming(0, { duration: 460, easing: Easing.out(Easing.cubic) }));
    // Salida: el overlay se desvanece con un leve acercamiento
    exitOpacity.value = withDelay(T.exit, withTiming(0, { duration: 420, easing: Easing.in(Easing.cubic) }));
    exitScale.value   = withDelay(T.exit, withTiming(1.05, { duration: 420, easing: Easing.in(Easing.cubic) }));

    const t = setTimeout(onDone, T.done);
    return () => clearTimeout(t);
  }, []);

  const exitStyle = useAnimatedStyle(() => ({
    opacity: exitOpacity.value,
    transform: [{ scale: exitScale.value }],
  }));

  const logoGlowStyle = useAnimatedStyle(() => ({
    shadowOpacity: logoGlow.value * 0.8,
    shadowRadius: 20 + logoGlow.value * 26,
  }));

  const barStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: barX.value }],
  }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, s.bg, exitStyle]}>

      {/* Luz ambiental estática — apenas perceptible, da profundidad sin ruido */}
      <View style={[s.ambientBlob, { top: -110, left: -70, backgroundColor: "rgba(251,15,5,0.10)" }]} />
      <View style={[s.ambientBlob, { bottom: -90, right: -90, backgroundColor: "rgba(0,39,254,0.12)" }]} />

      <View style={s.center}>

        <LandingRing />

        {/* Logo */}
        <Animated.View
          entering={ZoomIn.delay(T.logo).springify().stiffness(200).damping(14)}
          style={[s.logoWrap, logoGlowStyle]}>
          <View style={s.logoBox}>
            <Image
              source={require("../assets/zyncra-logo.png")}
              style={{ width: 96, height: 96, borderRadius: 22 }}
              resizeMode="cover"
            />
          </View>
        </Animated.View>

        {/* Wordmark en cascada */}
        <View style={s.wordRow}>
          {LETTERS.map((l, i) => (
            <Animated.Text
              key={i}
              entering={FadeInDown
                .delay(T.word + i * 45)
                .springify()
                .stiffness(300)
                .damping(20)}
              style={[s.letter, i === 0 && s.letterBig]}>
              {l}
            </Animated.Text>
          ))}
        </View>

        {/* Firma de gradiente de la marca — barrido de izquierda a derecha */}
        <View style={s.barTrack}>
          <Animated.View style={barStyle}>
            <LinearGradient
              colors={Gradients.brand}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={s.barFill}
            />
          </Animated.View>
        </View>

        {/* Tagline */}
        <Animated.Text entering={FadeIn.delay(T.tagline).duration(520)} style={s.tagline}>
          Gestiona tu negocio inteligente
        </Animated.Text>

      </View>

    </Animated.View>
  );
}

const s = StyleSheet.create({
  bg: {
    backgroundColor: Colors.ink,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 999,
  },
  ambientBlob: {
    position: "absolute",
    width: 340, height: 340, borderRadius: 170,
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    marginTop: -height * 0.02,
  },
  logoWrap: {
    shadowColor: "#fb0f05",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 20,
    elevation: 20,
    borderRadius: 30,
  },
  logoBox: {
    width: 96, height: 96, borderRadius: 24,
    overflow: "hidden",
  },
  wordRow: {
    flexDirection: "row",
    alignItems: "baseline",
    marginTop: 4,
  },
  letter: {
    fontSize: 32,
    fontFamily: "SpaceGrotesk_700Bold",
    color: "white",
    letterSpacing: 0.5,
  },
  letterBig: {
    fontSize: 36,
    fontFamily: "SpaceGrotesk_700Bold",
    color: "white",
  },
  barTrack: {
    width: BAR_W,
    height: 3,
    borderRadius: 2,
    overflow: "hidden",
  },
  barFill: {
    width: BAR_W,
    height: 3,
    borderRadius: 2,
  },
  tagline: {
    fontSize: 12,
    fontFamily: "SpaceGrotesk_600SemiBold",
    color: "rgba(255,255,255,0.45)",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginTop: 2,
  },
});
