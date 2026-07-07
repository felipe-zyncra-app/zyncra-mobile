import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Dimensions, Image } from "react-native";
import Animated, {
  useSharedValue, useAnimatedStyle,
  withSpring, withTiming, withSequence, withDelay,
  FadeInDown, FadeIn, ZoomIn,
  Easing, runOnJS,
} from "react-native-reanimated";
import { Colors } from "@/constants/theme";

const { width, height } = Dimensions.get("window");
const LETTERS = ["Z", "y", "n", "c", "r", "a"];

// ── Converging blob ───────────────────────────────────────────────────────────
function Blob({ fromX, fromY, color, delay }: { fromX: number; fromY: number; color: string; delay: number }) {
  const tx = useSharedValue(fromX);
  const ty = useSharedValue(fromY);
  const opacity = useSharedValue(0);
  const scale = useSharedValue(1.2);

  useEffect(() => {
    const t = setTimeout(() => {
      opacity.value = withTiming(1, { duration: 350 });
      tx.value = withTiming(0, { duration: 700, easing: Easing.out(Easing.cubic) });
      ty.value = withTiming(0, { duration: 700, easing: Easing.out(Easing.cubic) });
      scale.value = withDelay(500, withTiming(0.1, { duration: 350, easing: Easing.in(Easing.cubic) }));
      opacity.value = withDelay(550, withTiming(0, { duration: 300 }));
    }, delay);
    return () => clearTimeout(t);
  }, []);

  const s = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return (
    <Animated.View style={[s, { position: "absolute", width: 280, height: 280, borderRadius: 140, backgroundColor: color }]} />
  );
}

// ── Radar ring ────────────────────────────────────────────────────────────────
function Ring({ delay, color, size = 90 }: { delay: number; color: string; size?: number }) {
  const scale = useSharedValue(0.5);
  const opacity = useSharedValue(0);

  useEffect(() => {
    const t = setTimeout(() => {
      opacity.value = withSequence(
        withTiming(0.9, { duration: 60 }),
        withTiming(0, { duration: 940, easing: Easing.out(Easing.cubic) })
      );
      scale.value = withTiming(7, { duration: 1000, easing: Easing.out(Easing.cubic) });
    }, delay);
    return () => clearTimeout(t);
  }, []);

  const s = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View style={[s, {
      position: "absolute", width: size, height: size,
      borderRadius: size / 2, borderWidth: 1.5, borderColor: color,
    }]} />
  );
}

// ── Floating particle ─────────────────────────────────────────────────────────
function Particle({ x, y, delay, size, color }: { x: number; y: number; delay: number; size: number; color: string }) {
  const opacity = useSharedValue(0);
  const ty = useSharedValue(0);
  const tx = useSharedValue(0);

  useEffect(() => {
    const t = setTimeout(() => {
      opacity.value = withSequence(
        withTiming(1, { duration: 300 }),
        withDelay(700, withTiming(0, { duration: 500 }))
      );
      ty.value = withTiming(-40, { duration: 1500, easing: Easing.out(Easing.cubic) });
      tx.value = withTiming((Math.random() - 0.5) * 30, { duration: 1500, easing: Easing.inOut(Easing.cubic) });
    }, delay);
    return () => clearTimeout(t);
  }, []);

  const s = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateX: tx.value }, { translateY: ty.value }] }));

  return (
    <Animated.View style={[s, {
      position: "absolute", left: x, top: y,
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: color,
    }]} />
  );
}

// ── Scan line ─────────────────────────────────────────────────────────────────
function ScanLine() {
  const ty = useSharedValue(-height * 0.3);
  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.value = withSequence(
      withTiming(0.15, { duration: 200 }),
      withDelay(1000, withTiming(0, { duration: 400 }))
    );
    ty.value = withTiming(height * 0.3, { duration: 1400, easing: Easing.linear });
  }, []);

  const s = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateY: ty.value }] }));

  return (
    <Animated.View style={[s, {
      position: "absolute", left: 0, right: 0,
      height: 1.5, backgroundColor: "#fb0f05",
      shadowColor: "#fb0f05", shadowOpacity: 1, shadowRadius: 8,
    }]} />
  );
}

// ── Main intro ────────────────────────────────────────────────────────────────
export default function ZyncraIntro({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState(0);

  const exitOpacity = useSharedValue(1);
  const exitScale  = useSharedValue(1);
  const logoGlow   = useSharedValue(0);
  const bgOpacity  = useSharedValue(1);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 60),     // blobs + scan line appear
      setTimeout(() => setPhase(2), 780),    // logo springs in
      setTimeout(() => setPhase(3), 1000),   // ring pulses
      setTimeout(() => setPhase(4), 1200),   // letters cascade
      setTimeout(() => setPhase(5), 1700),   // tagline + particles
      setTimeout(() => {
        setPhase(6);                          // exit
        exitOpacity.value = withTiming(0, { duration: 550, easing: Easing.in(Easing.cubic) });
        exitScale.value   = withTiming(1.08, { duration: 550, easing: Easing.in(Easing.cubic) });
      }, 2400),
      setTimeout(() => runOnJS(onDone)(), 2950),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  // Logo glow heartbeat
  useEffect(() => {
    if (phase >= 2) {
      logoGlow.value = withSequence(
        withTiming(1,   { duration: 250 }),
        withTiming(0.4, { duration: 350 }),
        withTiming(0.9, { duration: 250 }),
        withTiming(0.3, { duration: 600 }),
      );
    }
  }, [phase]);

  const exitStyle = useAnimatedStyle(() => ({
    opacity: exitOpacity.value,
    transform: [{ scale: exitScale.value }],
  }));

  const logoGlowStyle = useAnimatedStyle(() => ({
    shadowOpacity: logoGlow.value * 0.8,
    shadowRadius: 20 + logoGlow.value * 30,
  }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, s.bg, exitStyle]}>

      {/* ── Background ambient light ── */}
      <View style={[s.ambientBlob, { top: -100, left: -60, backgroundColor: "#fb0f0520" }]} />
      <View style={[s.ambientBlob, { bottom: -80, right: -80, backgroundColor: "#0027fe20" }]} />
      <View style={[s.ambientBlob, { top: height * 0.4, right: -100, backgroundColor: "#0027fe18" }]} />

      {/* ── Scan line ── */}
      {phase >= 1 && <ScanLine />}

      {/* ── Converging blobs ── */}
      {phase >= 1 && (
        <>
          <Blob fromX={-width * 0.45} fromY={-height * 0.28} color="rgba(251,15,5,.28)"   delay={0} />
          <Blob fromX={ width * 0.48} fromY={-height * 0.12} color="rgba(155,63,200,.25)" delay={60} />
          <Blob fromX={-width * 0.2}  fromY={ height * 0.38} color="rgba(0,39,254,.22)"   delay={120} />
        </>
      )}

      {/* ── Center stage ── */}
      <View style={s.center}>

        {/* Ring pulses behind logo */}
        {phase >= 3 && <Ring delay={0}   color="#fb0f05" size={92} />}
        {phase >= 3 && <Ring delay={260} color="#0027fe" size={92} />}

        {/* Logo */}
        {phase >= 2 && (
          <Animated.View
            entering={ZoomIn.springify().stiffness(210).damping(13)}
            style={[s.logoWrap, logoGlowStyle]}>
            <View style={s.logoBox}>
              <Image
                source={require("../assets/zyncra-logo.png")}
                style={{ width: 96, height: 96, borderRadius: 22 }}
                resizeMode="cover"
              />
            </View>
          </Animated.View>
        )}

        {/* "Zyncra" letters */}
        {phase >= 4 && (
          <View style={s.wordRow}>
            {LETTERS.map((l, i) => (
              <Animated.Text
                key={i}
                entering={FadeInDown
                  .delay(i * 70)
                  .duration(380)
                  .springify()
                  .stiffness(320)
                  .damping(18)}
                style={[s.letter, i === 0 && s.letterBig]}>
                {l}
              </Animated.Text>
            ))}
          </View>
        )}

        {/* Tagline */}
        {phase >= 5 && (
          <Animated.Text entering={FadeIn.duration(700)} style={s.tagline}>
            Gestiona tu negocio inteligente
          </Animated.Text>
        )}

      </View>

      {/* ── Floating particles ── */}
      {phase >= 5 && (
        <>
          <Particle x={width * 0.18}  y={height * 0.36} delay={0}   size={9}  color="#fb0f05" />
          <Particle x={width * 0.76}  y={height * 0.41} delay={110} size={6}  color="#0027fe" />
          <Particle x={width * 0.12}  y={height * 0.52} delay={55}  size={7}  color="#0027fe" />
          <Particle x={width * 0.82}  y={height * 0.56} delay={180} size={5}  color="#fb0f05" />
          <Particle x={width * 0.48}  y={height * 0.30} delay={80}  size={6}  color="#0027fe" />
          <Particle x={width * 0.62}  y={height * 0.62} delay={150} size={4}  color="#0027fe" />
        </>
      )}

      {/* ── Corner accents ── */}
      <View style={[s.corner, s.cornerTL]} />
      <View style={[s.corner, s.cornerBR]} />

    </Animated.View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  bg: {
    backgroundColor: Colors.ink,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 999,
  },
  ambientBlob: {
    position: "absolute",
    width: 320, height: 320, borderRadius: 160,
  },
  center: {
    alignItems: "center",
    gap: 18,
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
  tagline: {
    fontSize: 12,
    fontFamily: "SpaceGrotesk_600SemiBold",
    color: "rgba(255,255,255,.45)",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginTop: 2,
  },
  corner: {
    position: "absolute",
    width: 28, height: 28,
    borderColor: "rgba(251,15,5,.35)",
  },
  cornerTL: {
    top: 52, left: 24,
    borderTopWidth: 1.5, borderLeftWidth: 1.5,
    borderTopLeftRadius: 6,
  },
  cornerBR: {
    bottom: 52, right: 24,
    borderBottomWidth: 1.5, borderRightWidth: 1.5,
    borderBottomRightRadius: 6,
  },
});
