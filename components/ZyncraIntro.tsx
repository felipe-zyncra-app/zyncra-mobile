import { useEffect, useRef } from "react";
import { View, StyleSheet, Pressable } from "react-native";
import Animated, {
  useSharedValue, useAnimatedStyle, useReducedMotion,
  withTiming, withSequence, withDelay,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { Colors } from "@/constants/theme";
import {
  Aurora, AnilloTrazo, Aparece, LineaMarca, LogoBrillo, PalabraZyncra,
  EASE_IN_OUT, EASE_OUT,
} from "@/components/Marca";

/**
 * Intro de marca de la PRIMERA apertura (la decide useIntroPrimeraVez en
 * app/_layout.tsx; las demás aperturas solo ven el splash nativo).
 *
 * Reglas que no se tocan (2026-09-29, se mantienen en la versión de 2026-09-30):
 * - El primer cuadro es IDÉNTICO al splash nativo (app.json → expo-splash-screen:
 *   fondo Colors.ink y assets/splash-logo.png de 96 pt con esquinas de 24 pt,
 *   centrado). El padre oculta el splash sin fundido en onReady.
 * - Se puede saltar con un toque: es una intro, no un bloqueo.
 * - Con "Reducir movimiento" solo hay fundidos y dura menos.
 * - Solo transform y opacity en el hilo de UI (el anillo anima
 *   strokeDashoffset de una sola figura). Las sombras están pintadas y solo
 *   cambia la opacidad de su capa.
 *
 * Coreografía (2026-09-30), unos 2,4 s en total:
 *   0     splash tal cual
 *   0     el logo toma impulso (se encoge un poco) y
 *   170   vuelve a su tamaño mientras un anillo con el degradado de la marca
 *         se dibuja a su alrededor, con un punto de luz en la punta, y se
 *         encienden las luces de fondo
 *   520   un barrido de luz cruza el logo
 *   700   el logo sube y, cuando ya dejó sitio (1000), "Zyncra" sube letra
 *         por letra desde una máscara (antes de eso se montaba sobre el logo)
 *   1340  la línea de marca se abre desde el centro, y luego el lema
 *   2150  salida: el conjunto se acerca y se funde hacia la app
 */

const LOGO    = 96;   // = imageWidth del splash nativo
const RADIUS  = 24;   // = esquinas de assets/splash-logo.png (24/96)
const ANILLO  = 164;
const LIFT    = 52;   // cuánto sube el logo para dejar sitio a la marca

const T = {
  impulso:  0,
  anillo:   170,
  anilloMs: 900,
  brillo:   520,
  lift:     700,
  liftMs:   520,
  palabra:  1000,
  linea:    1340,
  lema:     1460,
  salida:   2150,
  salidaMs: 380,
  saltoMs:  200,   // salida al tocar
  seguro:   4500,  // por si una animación no llega a su callback
};

// Con "Reducir movimiento": todo aparece junto y se sale antes.
const T_REDUCIDO = { palabra: 120, salida: 1150, salidaMs: 260 };

export default function ZyncraIntro({ onDone, onReady }: {
  onDone: () => void;
  /** Primer cuadro pintado: el padre oculta el splash nativo sin fundido. */
  onReady?: () => void;
}) {
  const reduced = useReducedMotion();

  const salida  = useSharedValue(1);   // opacidad de toda la intro
  const acerca  = useSharedValue(1);   // escala de salida
  const escala  = useSharedValue(1);   // impulso del logo
  const lift    = useSharedValue(0);
  const glow    = useSharedValue(0);
  const fondo   = useSharedValue(0);   // luces de fondo

  // El padre pasa flechas nuevas en cada render; como dependencias del efecto
  // reiniciarían la coreografía.
  const onDoneRef  = useRef(onDone);
  const onReadyRef = useRef(onReady);
  useEffect(() => { onDoneRef.current = onDone; onReadyRef.current = onReady; }, [onDone, onReady]);

  const terminado = useRef(false);
  const terminar = () => {
    if (terminado.current) return;
    terminado.current = true;
    onDoneRef.current();
  };
  const listoEnviado = useRef(false);
  const listo = () => {
    if (listoEnviado.current) return;
    listoEnviado.current = true;
    onReadyRef.current?.();
  };

  useEffect(() => {
    const salidaEn = reduced ? T_REDUCIDO.salida : T.salida;
    const salidaMs = reduced ? T_REDUCIDO.salidaMs : T.salidaMs;
    if (!reduced) {
      escala.set(withSequence(
        withTiming(0.93, { duration: 170, easing: EASE_IN_OUT }),
        withTiming(1,    { duration: 620, easing: EASE_OUT }),
      ));
      glow.set(withDelay(T.anillo, withSequence(
        withTiming(1,    { duration: 320, easing: EASE_OUT }),
        withTiming(0.45, { duration: 900, easing: EASE_OUT }),
      )));
      fondo.set(withDelay(T.anillo, withTiming(1, { duration: 1100, easing: EASE_OUT })));
      lift.set(withDelay(T.lift, withTiming(-LIFT, { duration: T.liftMs, easing: EASE_IN_OUT })));
      acerca.set(withDelay(salidaEn, withTiming(1.06, { duration: salidaMs, easing: EASE_OUT })));
    } else {
      fondo.set(withTiming(1, { duration: 400 }));
    }
    salida.set(withDelay(salidaEn, withTiming(0, { duration: salidaMs, easing: EASE_OUT }, done => {
      "worklet";
      if (done) scheduleOnRN(terminar);
    })));

    const t = setTimeout(terminar, T.seguro);
    return () => clearTimeout(t);
    // Una sola vez al montar: reduced no cambia durante la intro.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Un toque salta la intro: reemplazar la animación de salida cancela la
  // programada.
  const saltar = () => {
    salida.set(withTiming(0, { duration: T.saltoMs, easing: EASE_OUT }, done => {
      "worklet";
      if (done) scheduleOnRN(terminar);
    }));
  };

  const raizSt  = useAnimatedStyle(() => ({ opacity: salida.get() }));
  const escenaSt = useAnimatedStyle(() => ({ transform: [{ scale: acerca.get() }] }));
  const fondoSt = useAnimatedStyle(() => ({ opacity: fondo.get() }));
  const logoSt  = useAnimatedStyle(() => ({ transform: [{ translateY: lift.get() }, { scale: escala.get() }] }));
  const glowSt  = useAnimatedStyle(() => ({ opacity: glow.get() }));

  const palabraEn = reduced ? T_REDUCIDO.palabra : T.palabra;
  // La marca queda justo debajo del logo ya subido; sin movimiento, debajo
  // del logo en su sitio.
  const bloqueTop = LOGO / 2 + (reduced ? 22 : 22 - LIFT);

  return (
    <Animated.View style={[StyleSheet.absoluteFill, s.bg, raizSt]} onLayout={listo}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={saltar}
        accessibilityRole="button"
        accessibilityLabel="Saltar la introducción"
      >
        <Animated.View style={[StyleSheet.absoluteFill, fondoSt]}>
          <Aurora reduced={reduced} />
        </Animated.View>

        <Animated.View style={[StyleSheet.absoluteFill, escenaSt]}>
          {/* Logo: mismo tamaño y posición que el splash nativo */}
          <Animated.View pointerEvents="none" style={[s.logoAnchor, logoSt]}>
            <AnilloTrazo size={ANILLO} empiezaEn={T.anillo} dura={T.anilloMs} reduced={reduced} />
            <Animated.View style={[s.glow, glowSt]} />
            <LogoBrillo size={LOGO} radius={RADIUS} brilloEn={T.brillo} reduced={reduced} />
          </Animated.View>

          {/* Marca, línea y lema */}
          <View pointerEvents="none" style={[s.bloque, { marginTop: bloqueTop }]}>
            <PalabraZyncra empiezaEn={palabraEn} reduced={reduced} />
            <LineaMarca ancho={168} empiezaEn={reduced ? palabraEn : T.linea} reduced={reduced} />
            <Aparece empiezaEn={reduced ? palabraEn : T.lema} reduced={reduced}>
              <Animated.Text style={s.lema}>Gestiona tu negocio inteligente</Animated.Text>
            </Aparece>
          </View>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  bg: {
    backgroundColor: Colors.ink,   // = backgroundColor del splash nativo
    zIndex: 999,
  },
  // Centro exacto de la pantalla, igual que el splash nativo.
  logoAnchor: {
    position: "absolute",
    top: "50%", left: "50%",
    width: LOGO, height: LOGO,
    marginTop: -LOGO / 2, marginLeft: -LOGO / 2,
    alignItems: "center", justifyContent: "center",
  },
  // Sombra pintada una vez; solo cambia su opacidad.
  glow: {
    position: "absolute",
    width: LOGO, height: LOGO, borderRadius: RADIUS,
    backgroundColor: Colors.ink,
    shadowColor: Colors.red,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 36,
    elevation: 24,
  },
  bloque: {
    position: "absolute",
    top: "50%", left: 0, right: 0,
    alignItems: "center",
    gap: 12,
  },
  lema: {
    fontSize: 11.5,
    fontFamily: "SpaceGrotesk_600SemiBold",
    color: "rgba(255,255,255,0.5)",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
});
