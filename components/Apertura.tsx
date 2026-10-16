import { useEffect, useRef } from "react";
import { View, StyleSheet } from "react-native";
import Animated, {
  useSharedValue, useAnimatedStyle, useReducedMotion,
  withTiming, withSequence, withDelay, Easing, type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Stop } from "react-native-svg";
import { Colors } from "@/constants/theme";
import { LogoBrillo, EASE_IN_OUT, EASE_OUT } from "@/components/Marca";

/**
 * Apertura de cada arranque en frío (la intro larga, ZyncraIntro, queda para
 * la primera vez). Antes era un fundido de 150 ms del splash: la app "aparecía"
 * sin transición.
 *
 * Reglas:
 * - El primer cuadro es IDÉNTICO al splash nativo (fondo Colors.ink, logo de
 *   96 pt con esquinas de 24 pt, centrado): el padre oculta el splash sin
 *   fundido en onReady.
 * - No bloquea: pointerEvents "none" desde el primer cuadro; la app de debajo
 *   ya está montada y responde. Menos de un segundo en total.
 * - Con "Reducir movimiento", solo un fundido corto.
 * - Solo transform y opacity en el hilo de UI.
 *
 * Coreografía (~800 ms):
 *   0     splash tal cual
 *   0     el logo toma impulso (se encoge un poco)
 *   150   dos ondas con el degradado de la marca salen del logo
 *   150   el logo se acerca (cruza la pantalla) y se desvanece
 *   300   el fondo se abre y deja ver la app
 */

const LOGO   = 96;   // = imageWidth del splash nativo
const RADIUS = 24;   // = esquinas de assets/splash-logo.png
const ONDA   = 150;  // diámetro de la onda al salir del logo

const EASE_IN = Easing.bezier(0.55, 0, 0.85, 0.35);

function Onda({ p }: { p: SharedValue<number> }) {
  const st = useAnimatedStyle(() => ({
    opacity: p.get() === 0 ? 0 : (1 - p.get()) * 0.9,
    transform: [{ scale: 0.7 + p.get() * 5.2 }],
  }));
  return (
    <Animated.View pointerEvents="none" style={[s.onda, st]}>
      <Svg width={ONDA} height={ONDA}>
        <Defs>
          <SvgGradient id="onda" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={Colors.red} />
            <Stop offset="1" stopColor={Colors.blue} />
          </SvgGradient>
        </Defs>
        <Circle cx={ONDA / 2} cy={ONDA / 2} r={ONDA / 2 - 2} stroke="url(#onda)" strokeWidth={1.6} fill="none" />
      </Svg>
    </Animated.View>
  );
}

export default function Apertura({ onDone, onReady }: {
  onDone: () => void;
  /** Primer cuadro pintado: el padre oculta el splash nativo sin fundido. */
  onReady?: () => void;
}) {
  const reduced = useReducedMotion();
  const fondo  = useSharedValue(1);
  const escala = useSharedValue(1);
  const logo   = useSharedValue(1);
  const glow   = useSharedValue(0);
  const onda1  = useSharedValue(0);
  const onda2  = useSharedValue(0);

  // El padre pasa flechas nuevas en cada render: van por ref para no
  // reiniciar la animación.
  const onDoneRef  = useRef(onDone);
  const onReadyRef = useRef(onReady);
  useEffect(() => { onDoneRef.current = onDone; onReadyRef.current = onReady; }, [onDone, onReady]);
  const terminado = useRef(false);
  const terminar = () => {
    if (terminado.current) return;
    terminado.current = true;
    onDoneRef.current();
  };
  // Arranca cuando el logo ya está pintado y el splash se quita: así no se
  // pierde el comienzo debajo del splash.
  const listoEnviado = useRef(false);
  const listo = () => {
    if (listoEnviado.current) return;
    listoEnviado.current = true;
    onReadyRef.current?.();
    animar();
  };

  const animar = () => {
    const fin = (done?: boolean) => {
      "worklet";
      if (done) scheduleOnRN(terminar);
    };
    if (reduced) {
      logo.set(withDelay(40, withTiming(0, { duration: 200 })));
      fondo.set(withDelay(40, withTiming(0, { duration: 260, easing: EASE_OUT }, fin)));
    } else {
      escala.set(withSequence(
        withTiming(0.9, { duration: 150, easing: EASE_IN_OUT }),
        withTiming(2.6, { duration: 440, easing: EASE_IN }),
      ));
      glow.set(withSequence(
        withTiming(1, { duration: 150, easing: EASE_OUT }),
        withTiming(0, { duration: 300, easing: EASE_OUT }),
      ));
      logo.set(withDelay(330, withTiming(0, { duration: 240, easing: EASE_OUT })));
      onda1.set(withDelay(150, withTiming(1, { duration: 640, easing: EASE_OUT })));
      onda2.set(withDelay(260, withTiming(1, { duration: 640, easing: EASE_OUT })));
      fondo.set(withDelay(300, withTiming(0, { duration: 460, easing: EASE_IN_OUT }, fin)));
    }
  };

  // Por si una animación no llega a su callback: nunca se queda encima.
  useEffect(() => {
    const t = setTimeout(terminar, 2500);
    return () => clearTimeout(t);
  }, []);

  const fondoSt = useAnimatedStyle(() => ({ opacity: fondo.get() }));
  const logoSt  = useAnimatedStyle(() => ({ opacity: logo.get(), transform: [{ scale: escala.get() }] }));
  const glowSt  = useAnimatedStyle(() => ({ opacity: glow.get() }));

  return (
    // El splash se quita cuando el logo ya está pintado; si la imagen no avisa
    // (caché, web), a los 250 ms del primer cuadro.
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { zIndex: 999 }]} onLayout={() => setTimeout(listo, 250)}>
      <Animated.View style={[StyleSheet.absoluteFill, s.fondo, fondoSt]} />
      <View style={s.centro}>
        {!reduced && <Onda p={onda1} />}
        {!reduced && <Onda p={onda2} />}
        <Animated.View style={logoSt}>
          <Animated.View style={[s.glow, glowSt]} />
          <LogoBrillo size={LOGO} radius={RADIUS} brilloEn={0} reduced onLoad={listo} />
        </Animated.View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  fondo: { backgroundColor: Colors.ink },   // = backgroundColor del splash nativo
  // Centro exacto de la pantalla, igual que el splash nativo.
  centro: {
    position: "absolute",
    top: "50%", left: "50%",
    width: LOGO, height: LOGO,
    marginTop: -LOGO / 2, marginLeft: -LOGO / 2,
    alignItems: "center", justifyContent: "center",
  },
  onda: {
    position: "absolute",
    width: ONDA, height: ONDA,
    left: (LOGO - ONDA) / 2, top: (LOGO - ONDA) / 2,
  },
  // Sombra pintada una vez; solo cambia su opacidad.
  glow: {
    position: "absolute",
    width: LOGO, height: LOGO, borderRadius: RADIUS,
    backgroundColor: Colors.ink,
    shadowColor: Colors.red,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 30,
    elevation: 20,
  },
});
