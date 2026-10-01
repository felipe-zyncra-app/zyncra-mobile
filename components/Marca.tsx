import { useEffect } from "react";
import { View, StyleSheet, Image, type ViewStyle, type StyleProp } from "react-native";
import Animated, {
  useSharedValue, useAnimatedStyle, useAnimatedProps,
  withTiming, withDelay, withRepeat, withSequence,
  Easing, cancelAnimation,
} from "react-native-reanimated";
import Svg, { Circle, Defs, LinearGradient as SvgGradient, RadialGradient, Stop } from "react-native-svg";
import { LinearGradient } from "expo-linear-gradient";
import { Colors, Gradients } from "@/constants/theme";

/**
 * Piezas de marca que comparten la intro de apertura (ZyncraIntro) y el login,
 * para que el paso de una a otra se sienta como la misma escena.
 *
 * Todo corre en el hilo de UI y solo anima transform y opacity (el anillo
 * anima strokeDashoffset, una sola figura SVG). Las sombras y los degradados
 * se pintan una vez; lo que cambia es la opacidad de su capa.
 */

export const EASE_OUT    = Easing.bezier(0.23, 1, 0.32, 1);
export const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1);

const LOGO_SRC = require("../assets/splash-logo.png");

// ── Luces de fondo ──────────────────────────────────────────────────────────

function Luz({ color, size, style, deriva, periodo, reduced }: {
  color: string; size: number; style: StyleProp<ViewStyle>;
  deriva: { x: number; y: number }; periodo: number; reduced: boolean;
}) {
  const t = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    t.set(withRepeat(withTiming(1, { duration: periodo, easing: EASE_IN_OUT }), -1, true));
    return () => cancelAnimation(t);
  }, [reduced, periodo, t]);
  const st = useAnimatedStyle(() => ({
    transform: [{ translateX: t.get() * deriva.x }, { translateY: t.get() * deriva.y }, { scale: 1 + t.get() * 0.08 }],
  }));
  const id = `luz-${color.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <Animated.View pointerEvents="none" style={[{ position: "absolute", width: size, height: size }, style, st]}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={color} stopOpacity={0.55} />
            <Stop offset="0.55" stopColor={color} stopOpacity={0.14} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

/**
 * Dos luces de color de la marca que derivan muy despacio. Son el "aire" de la
 * pantalla: sin ellas el fondo oscuro se ve plano. Con Reducir movimiento se
 * quedan quietas.
 */
export function Aurora({ reduced, intensidad = 1 }: { reduced: boolean; intensidad?: number }) {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: intensidad, overflow: "hidden" }]}>
      <Luz color={Colors.red}  size={520} style={{ top: -220, left: -200 }}   deriva={{ x: 46, y: 30 }}  periodo={9000}  reduced={reduced} />
      <Luz color={Colors.blue} size={560} style={{ bottom: -240, right: -220 }} deriva={{ x: -40, y: -36 }} periodo={11000} reduced={reduced} />
    </View>
  );
}

// ── Logo con brillo ─────────────────────────────────────────────────────────

/**
 * El logo con un barrido de luz que lo cruza en diagonal una vez, a los
 * `brilloEn` ms. La banda vive dentro de la caja del logo (overflow hidden),
 * así que el brillo respeta las esquinas.
 */
export function LogoBrillo({ size, radius, brilloEn, reduced }: {
  size: number; radius: number; brilloEn: number; reduced: boolean;
}) {
  const x = useSharedValue(-1);
  useEffect(() => {
    if (reduced) return;
    x.set(withDelay(brilloEn, withTiming(1, { duration: 820, easing: EASE_IN_OUT })));
  }, [reduced, brilloEn, x]);
  const banda = useAnimatedStyle(() => ({
    transform: [{ translateX: x.get() * size * 1.5 }, { rotate: "22deg" }],
  }));
  return (
    <View style={{ width: size, height: size, borderRadius: radius, overflow: "hidden" }}>
      <Image source={LOGO_SRC} style={{ width: size, height: size }} resizeMode="cover" />
      {!reduced && (
        <Animated.View pointerEvents="none" style={[s.bandaWrap, { width: size * 0.55, height: size * 2, top: -size / 2, left: size / 2 - (size * 0.55) / 2 }, banda]}>
          <LinearGradient
            colors={["rgba(255,255,255,0)", "rgba(255,255,255,0.55)", "rgba(255,255,255,0)"]}
            start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      )}
    </View>
  );
}

// ── Anillo que se dibuja ────────────────────────────────────────────────────

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * Anillo con el degradado de la marca que se dibuja alrededor del logo, con un
 * punto de luz que va en la punta del trazo. Un solo valor (`p`, 0→1) mueve el
 * trazo y el punto, así nunca se separan.
 */
export function AnilloTrazo({ size, grosor = 2, empiezaEn, dura, reduced }: {
  size: number; grosor?: number; empiezaEn: number; dura: number; reduced: boolean;
}) {
  const r = size / 2 - grosor - 3;
  const C = 2 * Math.PI * r;
  const p = useSharedValue(reduced ? 1 : 0);
  // Arranca invisible: el primer cuadro de la intro tiene que ser el splash
  // tal cual, sin la guía del anillo ni el punto de luz.
  const visible = useSharedValue(0);
  const salida = useSharedValue(1);

  useEffect(() => {
    if (reduced) return;
    visible.set(withDelay(empiezaEn, withTiming(1, { duration: 140, easing: EASE_OUT })));
    p.set(withDelay(empiezaEn, withTiming(1, { duration: dura, easing: EASE_IN_OUT })));
    // Al cerrarse, el anillo se abre y se apaga: deja al logo solo.
    salida.set(withDelay(empiezaEn + dura + 80, withTiming(0, { duration: 520, easing: EASE_OUT })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  const trazo = useAnimatedProps(() => ({ strokeDashoffset: C * (1 - p.get()) }));
  const giro  = useAnimatedStyle(() => ({ transform: [{ rotate: `${p.get() * 360}deg` }] }));
  const caja  = useAnimatedStyle(() => ({
    opacity: visible.get() * salida.get(),
    transform: [{ scale: 1 + (1 - salida.get()) * 0.22 }],
  }));

  if (reduced) return null;
  return (
    <Animated.View pointerEvents="none" style={[{ position: "absolute", width: size, height: size }, caja]}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: "-90deg" }] }}>
        <Defs>
          <SvgGradient id="anillo" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={Colors.red} />
            <Stop offset="1" stopColor={Colors.blue} />
          </SvgGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.06)" strokeWidth={grosor} fill="none" />
        <AnimatedCircle
          cx={size / 2} cy={size / 2} r={r}
          stroke="url(#anillo)" strokeWidth={grosor} strokeLinecap="round" fill="none"
          strokeDasharray={`${C} ${C}`}
          animatedProps={trazo}
        />
      </Svg>
      {/* Punto de luz en la punta del trazo */}
      <Animated.View style={[StyleSheet.absoluteFill, giro]}>
        <View style={[s.chispa, { left: size / 2 - 4, top: size / 2 - r - 4 }]} />
      </Animated.View>
    </Animated.View>
  );
}

// ── Palabra con máscara ─────────────────────────────────────────────────────

const LETRAS = ["Z", "y", "n", "c", "r", "a"];
const ALTO_LINEA = 46;

function Letra({ ch, delay, grande, reduced }: { ch: string; delay: number; grande: boolean; reduced: boolean }) {
  const y = useSharedValue(reduced ? 0 : 1);
  const o = useSharedValue(0);
  useEffect(() => {
    o.set(withDelay(delay, withTiming(1, { duration: reduced ? 280 : 200, easing: EASE_OUT })));
    if (!reduced) y.set(withDelay(delay, withTiming(0, { duration: 620, easing: EASE_OUT })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const st = useAnimatedStyle(() => ({ opacity: o.get(), transform: [{ translateY: y.get() * ALTO_LINEA }] }));
  return <Animated.Text style={[s.letra, grande && s.letraGrande, st]}>{ch}</Animated.Text>;
}

/**
 * "Zyncra" que sube letra por letra desde detrás de una máscara: cada letra
 * arranca una línea más abajo, fuera de la caja recortada, y sube a su sitio.
 */
export function PalabraZyncra({ empiezaEn, reduced, escalonado = 42 }: {
  empiezaEn: number; reduced: boolean; escalonado?: number;
}) {
  return (
    <View
      style={s.mascara}
      accessible
      accessibilityRole="header"
      accessibilityLabel="Zyncra">
      {LETRAS.map((l, i) => (
        <Letra key={i} ch={l} grande={i === 0} reduced={reduced}
          delay={empiezaEn + (reduced ? 0 : i * escalonado)} />
      ))}
    </View>
  );
}

// ── Línea de marca ──────────────────────────────────────────────────────────

/** Línea con el degradado de la marca que se abre desde el centro. */
export function LineaMarca({ ancho, empiezaEn, reduced }: { ancho: number; empiezaEn: number; reduced: boolean }) {
  const k = useSharedValue(reduced ? 1 : 0);
  const o = useSharedValue(reduced ? 0 : 1);
  useEffect(() => {
    if (reduced) { o.set(withDelay(empiezaEn, withTiming(1, { duration: 280 }))); return; }
    k.set(withDelay(empiezaEn, withTiming(1, { duration: 640, easing: EASE_OUT })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // scaleX no deforma nada aquí: la línea mide 2 pt y no tiene esquinas.
  const st = useAnimatedStyle(() => ({ opacity: o.get(), transform: [{ scaleX: k.get() }] }));
  return (
    <Animated.View style={[{ width: ancho, height: 2 }, st]}>
      <LinearGradient
        colors={["rgba(251,15,5,0)", Gradients.brand[0], Gradients.brand[1], "rgba(0,39,254,0)"]}
        locations={[0, 0.3, 0.7, 1]}
        start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}

/** Aparición suave con un leve ascenso, para textos de apoyo. */
export function Aparece({ empiezaEn, reduced, children, style, sube = 8, dura = 520 }: {
  empiezaEn: number; reduced: boolean; children: React.ReactNode; style?: StyleProp<ViewStyle>;
  sube?: number; dura?: number;
}) {
  const o = useSharedValue(0);
  const y = useSharedValue(reduced ? 0 : sube);
  useEffect(() => {
    o.set(withDelay(empiezaEn, withTiming(1, { duration: reduced ? 280 : dura, easing: EASE_OUT })));
    if (!reduced) y.set(withDelay(empiezaEn, withTiming(0, { duration: dura, easing: EASE_OUT })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const st = useAnimatedStyle(() => ({ opacity: o.get(), transform: [{ translateY: y.get() }] }));
  return <Animated.View style={[style, st]}>{children}</Animated.View>;
}

/** Sacudida corta (error). Devuelve el estilo y la función que la dispara. */
export function useSacudida(reduced: boolean) {
  const x = useSharedValue(0);
  const st = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));
  const sacudir = () => {
    if (reduced) return;
    x.set(withSequence(
      withTiming(-9, { duration: 50, easing: EASE_OUT }),
      withTiming(8,  { duration: 70, easing: EASE_IN_OUT }),
      withTiming(-5, { duration: 70, easing: EASE_IN_OUT }),
      withTiming(3,  { duration: 60, easing: EASE_IN_OUT }),
      withTiming(0,  { duration: 60, easing: EASE_OUT }),
    ));
  };
  return { estilo: st, sacudir };
}

const s = StyleSheet.create({
  bandaWrap: { position: "absolute" },
  chispa: {
    position: "absolute",
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: "white",
    shadowColor: "white", shadowOpacity: 0.9, shadowRadius: 8, shadowOffset: { width: 0, height: 0 },
  },
  mascara: {
    height: ALTO_LINEA,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "flex-end",
    paddingBottom: 4,
  },
  letra: {
    fontSize: 34,
    lineHeight: 40,
    fontFamily: "SpaceGrotesk_700Bold",
    color: "white",
    letterSpacing: -0.6,
  },
  letraGrande: { fontSize: 38, lineHeight: 42 },
});
