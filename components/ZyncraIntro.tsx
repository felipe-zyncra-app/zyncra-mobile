import { useEffect, useRef } from "react";
import { View, StyleSheet, Image, Pressable } from "react-native";
import Animated, {
  useSharedValue, useAnimatedStyle, useReducedMotion,
  withTiming, withSequence, withDelay,
  FadeInDown, FadeIn,
  Easing,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { LinearGradient } from "expo-linear-gradient";
import { Colors, Gradients } from "@/constants/theme";

/**
 * Intro de marca de la PRIMERA apertura (la decide useIntroPrimeraVez en
 * app/_layout.tsx; las demás aperturas solo ven el splash nativo).
 *
 * Por qué así (2026-09-29):
 * - El primer cuadro es IDÉNTICO al splash nativo (app.json → expo-splash-screen:
 *   fondo Colors.ink y assets/splash-logo.png de 96 pt con esquinas de 24 pt,
 *   centrado en la pantalla). Antes el logo entraba con ZoomIn desde la nada
 *   sobre un splash por defecto: se veía el salto de nativo a JS.
 * - Se puede saltar con un toque: es una intro, no un bloqueo.
 * - Con "Reducir movimiento" solo hay fundidos (sin subir el logo, ni pulso,
 *   ni barrido) y dura menos.
 * - Solo transform y opacity en el hilo de UI. El brillo del logo es una capa
 *   con la sombra ya pintada a la que solo se le anima la opacidad; animar
 *   shadowRadius/shadowOpacity repinta la sombra en cada cuadro.
 * - Curvas de salida fuertes, nunca ease-in: la salida anterior arrancaba
 *   lenta justo cuando el usuario quiere entrar.
 */

const EASE_OUT    = Easing.bezier(0.23, 1, 0.32, 1);
const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1);

const LETTERS = ["Z", "y", "n", "c", "r", "a"];
const LOGO    = 96;   // = imageWidth del splash nativo
const RADIUS  = 24;   // = esquinas de assets/splash-logo.png (24/96)
const LIFT    = 44;   // cuánto sube el logo para dejar sitio a la marca
const BAR_W   = 148;

// Coreografía (ms). Todo arranca desde el cuadro del splash, sin tiempo muerto.
const T = {
  ring:    120,   // pulso único + brillo
  lift:    180,   // el logo sube
  word:    400,   // letras en cascada
  stagger: 35,
  bar:     700,   // barrido del gradiente de marca
  tagline: 840,
  exit:    1480,  // fundido de salida
  exitMs:  280,
  skipMs:  180,   // salida al tocar
  safety:  3500,  // por si una animación no llega a su callback
};

// Con "Reducir movimiento": marca y lema aparecen juntos y se sale antes.
const T_REDUCED = { word: 120, exit: 1000 };

function LandingRing() {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.set(withDelay(T.ring, withSequence(
      withTiming(0.6, { duration: 80 }),
      withTiming(0, { duration: 720, easing: EASE_OUT }),
    )));
    scale.set(withDelay(T.ring, withTiming(2.6, { duration: 800, easing: EASE_OUT })));
  }, [opacity, scale]);

  const st = useAnimatedStyle(() => ({
    opacity: opacity.get(),
    transform: [{ scale: scale.get() }],
  }));

  return <Animated.View pointerEvents="none" style={[s.ring, st]} />;
}

export default function ZyncraIntro({ onDone, onReady }: {
  onDone: () => void;
  /** Primer cuadro pintado: el padre oculta el splash nativo sin fundido. */
  onReady?: () => void;
}) {
  const reduced = useReducedMotion();

  const exitOpacity = useSharedValue(1);
  const exitScale   = useSharedValue(1);
  const lift        = useSharedValue(0);
  const glow        = useSharedValue(0);
  const barX        = useSharedValue(-BAR_W);

  // El padre pasa flechas nuevas en cada render; como dependencias del efecto
  // reiniciarían la coreografía.
  const onDoneRef  = useRef(onDone);
  const onReadyRef = useRef(onReady);
  useEffect(() => { onDoneRef.current = onDone; onReadyRef.current = onReady; }, [onDone, onReady]);

  const finished = useRef(false);
  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    onDoneRef.current();
  };
  const readySent = useRef(false);
  const ready = () => {
    if (readySent.current) return;
    readySent.current = true;
    onReadyRef.current?.();
  };

  useEffect(() => {
    const exitAt = reduced ? T_REDUCED.exit : T.exit;
    if (!reduced) {
      glow.set(withDelay(T.ring, withSequence(
        withTiming(1,    { duration: 240, easing: EASE_OUT }),
        withTiming(0.35, { duration: 600, easing: EASE_OUT }),
      )));
      lift.set(withDelay(T.lift, withTiming(-LIFT, { duration: 560, easing: EASE_IN_OUT })));
      barX.set(withDelay(T.bar, withTiming(0, { duration: 420, easing: EASE_OUT })));
      exitScale.set(withDelay(exitAt, withTiming(1.03, { duration: T.exitMs, easing: EASE_OUT })));
    } else {
      barX.set(0);
    }
    exitOpacity.set(withDelay(exitAt, withTiming(0, { duration: T.exitMs, easing: EASE_OUT }, done => {
      "worklet";
      if (done) scheduleOnRN(finish);
    })));

    const t = setTimeout(finish, T.safety);
    return () => clearTimeout(t);
    // Una sola vez al montar: reduced no cambia durante la intro.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Un toque salta la intro: reemplazar la animación de salida cancela la
  // programada.
  const skip = () => {
    exitOpacity.set(withTiming(0, { duration: T.skipMs, easing: EASE_OUT }, done => {
      "worklet";
      if (done) scheduleOnRN(finish);
    }));
  };

  const rootStyle = useAnimatedStyle(() => ({
    opacity: exitOpacity.get(),
    transform: [{ scale: exitScale.get() }],
  }));
  const logoStyle = useAnimatedStyle(() => ({ transform: [{ translateY: lift.get() }] }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.get() }));
  const barStyle  = useAnimatedStyle(() => ({ transform: [{ translateX: barX.get() }] }));

  const wordAt = reduced ? T_REDUCED.word : T.word;
  // La marca queda justo debajo del logo ya subido; sin movimiento, debajo del
  // logo en su sitio.
  const wordTop = LOGO / 2 + (reduced ? 18 : 18 - LIFT);

  return (
    <Animated.View style={[StyleSheet.absoluteFill, s.bg, rootStyle]} onLayout={ready}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={skip}
        accessibilityRole="button"
        accessibilityLabel="Saltar la introducción"
      >
        {/* Luz ambiental estática: profundidad sin movimiento */}
        <View pointerEvents="none" style={[s.ambientBlob, { top: -110, left: -70, backgroundColor: "rgba(251,15,5,0.10)" }]} />
        <View pointerEvents="none" style={[s.ambientBlob, { bottom: -90, right: -90, backgroundColor: "rgba(0,39,254,0.12)" }]} />

        {/* Logo: mismo tamaño y posición que el splash nativo */}
        <Animated.View pointerEvents="none" style={[s.logoAnchor, logoStyle]}>
          {!reduced && <LandingRing />}
          <Animated.View style={[s.glow, glowStyle]} />
          <View style={s.logoBox}>
            <Image source={require("../assets/splash-logo.png")} style={s.logoImg} resizeMode="cover" />
          </View>
        </Animated.View>

        {/* Marca, barrido y lema */}
        <View pointerEvents="none" style={[s.wordBlock, { marginTop: wordTop }]}>
          <View style={s.wordRow}>
            {LETTERS.map((l, i) => (
              <Animated.Text
                key={i}
                entering={reduced
                  ? FadeIn.delay(wordAt).duration(260).easing(EASE_OUT)
                  : FadeInDown.withInitialValues({ transform: [{ translateY: 10 }] })
                      .delay(wordAt + i * T.stagger).duration(380).easing(EASE_OUT)}
                style={[s.letter, i === 0 && s.letterBig]}>
                {l}
              </Animated.Text>
            ))}
          </View>

          <View style={s.barTrack}>
            <Animated.View style={barStyle}>
              <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.barFill} />
            </Animated.View>
          </View>

          <Animated.Text
            entering={FadeIn.delay(reduced ? T_REDUCED.word : T.tagline).duration(reduced ? 260 : 360).easing(EASE_OUT)}
            style={s.tagline}>
            Gestiona tu negocio inteligente
          </Animated.Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  bg: {
    backgroundColor: Colors.ink,   // = backgroundColor del splash nativo
    zIndex: 999,
  },
  ambientBlob: {
    position: "absolute",
    width: 340, height: 340, borderRadius: 170,
  },
  // Centro exacto de la pantalla, igual que el splash nativo.
  logoAnchor: {
    position: "absolute",
    top: "50%", left: "50%",
    width: LOGO, height: LOGO,
    marginTop: -LOGO / 2, marginLeft: -LOGO / 2,
    alignItems: "center", justifyContent: "center",
  },
  ring: {
    position: "absolute",
    width: LOGO, height: LOGO, borderRadius: LOGO / 2,
    borderWidth: 1.5, borderColor: "rgba(251,15,5,0.55)",
  },
  // Sombra pintada una vez; solo cambia su opacidad.
  glow: {
    position: "absolute",
    width: LOGO, height: LOGO, borderRadius: RADIUS,
    backgroundColor: Colors.ink,
    shadowColor: Colors.red,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 34,
    elevation: 24,
  },
  logoBox: {
    width: LOGO, height: LOGO, borderRadius: RADIUS,
    overflow: "hidden",
  },
  logoImg: { width: LOGO, height: LOGO },
  wordBlock: {
    position: "absolute",
    top: "50%", left: 0, right: 0,
    alignItems: "center",
    gap: 14,
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
  },
});
