// ─── Zyncra Mobile — kit de UI estilo portal web ─────────────────
// Puerto de las primitivas de ZyncraSas_v1/src/app/admin (page.tsx +
// admin.module.css): tinta sobre lienzo claro, cards sólidas con borde
// hairline, micro-etiquetas en JetBrains Mono, una firma de gradiente
// por vista. Todo theme-aware (claro/oscuro).

import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ViewStyle, StyleProp } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { Fonts, Gradients, CardStyle } from "@/constants/theme";
import { useTheme } from "@/lib/theme";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

// ─── Número que cuenta hasta su valor al montar / cambiar ─────────
export function useCountUp(target: number, dur = 650) {
  const [val, setVal] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    const from = fromRef.current;
    const t0 = Date.now();
    let raf = 0;
    const tick = () => {
      const p = Math.min(1, (Date.now() - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      setVal(from + (target - from) * e);
      if (p < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, dur]);
  return val;
}

// ─── TrendChip ────────────────────────────────────────────────────
export function TrendChip({ trend, label, onDark }: {
  trend: "up" | "down" | "neutral";
  label: string;
  onDark?: boolean;
}) {
  const { t } = useTheme();
  const tone = onDark
    ? trend === "down"
      ? { bg: "rgba(239,68,68,0.2)", color: "#fca5a5" }
      : { bg: "rgba(16,185,129,0.16)", color: "#6ee7b7" }
    : trend === "up"
      ? { bg: "rgba(16,185,129,0.09)", color: "#059669" }
      : trend === "down"
        ? { bg: "rgba(239,68,68,0.08)", color: "#dc2626" }
        : { bg: t.chipBg, color: t.subtle };
  return (
    <View style={[s.trendChip, { backgroundColor: tone.bg }]}>
      {trend !== "neutral" && (
        <Ionicons name={trend === "up" ? "trending-up" : "trending-down"} size={11} color={tone.color} />
      )}
      <Text style={[s.trendChipText, { color: tone.color }]}>{label}</Text>
    </View>
  );
}

// ─── Card + CardHead ──────────────────────────────────────────────
export function Card({ children, style, delay = 0 }: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  delay?: number;
}) {
  const { t } = useTheme();
  return (
    <Animated.View
      entering={FadeInDown.delay(delay).duration(400)}
      style={[CardStyle.base, { backgroundColor: t.cardSolid, borderColor: t.line, overflow: "hidden" }, style]}
    >
      {children}
    </Animated.View>
  );
}

export function CardHead({ title, sub, aside }: {
  title: string;
  sub?: string;
  aside?: React.ReactNode;
}) {
  const { t } = useTheme();
  return (
    <View style={[s.cardHead, { borderBottomColor: t.line }]}>
      <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.cardHeadDot} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[s.cardHeadTitle, { color: t.ink }]}>{title}</Text>
        {sub ? <Text style={[s.cardHeadSub, { color: t.subtle }]}>{sub}</Text> : null}
      </View>
      {aside != null && (
        typeof aside === "string"
          ? <Text style={[s.cardHeadAside, { color: t.subtle }]}>{aside}</Text>
          : <View>{aside}</View>
      )}
    </View>
  );
}

// ─── Etiqueta mono uppercase (statLabel / navGroupLabel del web) ──
export function MonoTag({ children, style, color }: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  color?: string;
}) {
  const { t } = useTheme();
  return (
    <Text style={[s.monoTag, { color: color ?? t.subtle }, style as any]}>{children}</Text>
  );
}

// ─── SectionLabel para listas agrupadas ───────────────────────────
export function SectionLabel({ children }: { children: React.ReactNode }) {
  const { t } = useTheme();
  return <Text style={[s.sectionLabel, { color: t.subtle }]}>{children}</Text>;
}

// ─── ListRow — patrón listItem del web ────────────────────────────
export function ListRow({ icon, color, label, sub, onPress, right, last }: {
  icon: IoniconName;
  color: string;
  label: string;
  sub?: string;
  onPress?: () => void;
  right?: React.ReactNode;
  last?: boolean;
}) {
  const { t } = useTheme();
  return (
    <TouchableOpacity
      style={[s.listRow, !last && { borderBottomWidth: 1, borderBottomColor: t.divider }]}
      onPress={onPress}
      activeOpacity={onPress ? 0.6 : 1}
      disabled={!onPress}
    >
      <View style={[s.listRowIcon, { backgroundColor: color + "14" }]}>
        <Ionicons name={icon} size={17} color={color} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[s.listRowLabel, { color: t.ink }]}>{label}</Text>
        {sub ? <Text style={[s.listRowSub, { color: t.subtle }]}>{sub}</Text> : null}
      </View>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={15} color={t.subtle} /> : null)}
    </TouchableOpacity>
  );
}

// ─── SegmentedControl (SegBtn del web) ────────────────────────────
export function SegmentedControl<T extends string>({ options, value, onChange }: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const { t } = useTheme();
  return (
    <View style={[s.segWrap, { backgroundColor: t.cardSolid, borderColor: t.line }]}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <TouchableOpacity
            key={o.value}
            style={[s.segBtn, active && { backgroundColor: t.ink }]}
            onPress={() => onChange(o.value)}
            activeOpacity={0.7}
          >
            <Text style={[s.segBtnText, { color: active ? t.cardSolid : t.muted }]}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ─── ScreenHeader — header compacto estilo web ────────────────────
// Reemplaza los headers de gradiente a pantalla completa: lienzo claro,
// miga en mono uppercase, título en tinta, borde inferior hairline.
export function ScreenHeader({ title, subtitle, crumb, onBack, rightAction }: {
  title: string;
  subtitle?: string;
  crumb?: string;
  onBack?: () => void;
  rightAction?: { icon: IoniconName; onPress: () => void };
}) {
  const { t } = useTheme();
  return (
    <View style={[s.screenHeader, { borderBottomColor: t.line }]}>
      {onBack && (
        <TouchableOpacity onPress={onBack} style={[s.headerBackBtn, { backgroundColor: t.chipBg }]}>
          <Ionicons name="arrow-back" size={19} color={t.ink} />
        </TouchableOpacity>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        {crumb ? <Text style={[s.headerCrumb, { color: t.subtle }]}>{crumb}</Text> : null}
        <Text style={[s.headerTitle, { color: t.ink }]} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={[s.headerSub, { color: t.muted }]} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {rightAction && (
        <TouchableOpacity
          onPress={rightAction.onPress}
          style={[s.headerActionBtn, { backgroundColor: t.chipBg, borderColor: t.line }]}
          activeOpacity={0.7}
        >
          <Ionicons name={rightAction.icon} size={18} color={t.ink} />
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── Badge de tenant (tenantBadge del web) ────────────────────────
export function TenantBadge({ name }: { name: string }) {
  const { t } = useTheme();
  return (
    <View style={[s.tenantBadge, { backgroundColor: t.chipBg, borderColor: t.line }]}>
      <Text style={[s.tenantBadgeText, { color: t.muted }]} numberOfLines={1}>{name}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  trendChip:     { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 2.5, borderRadius: 6, alignSelf: "flex-start" },
  trendChipText: { fontSize: 10.5, fontFamily: Fonts.mono },

  cardHead:      { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: 1 },
  cardHeadDot:   { width: 7, height: 7, borderRadius: 2.5 },
  cardHeadTitle: { fontSize: 13, fontFamily: Fonts.bold, letterSpacing: -0.1 },
  cardHeadSub:   { fontSize: 10.5, fontFamily: Fonts.regular, marginTop: 1 },
  cardHeadAside: { fontSize: 9.5, fontFamily: Fonts.mono, textTransform: "uppercase", letterSpacing: 0.9 },

  monoTag:       { fontSize: 9.5, fontFamily: Fonts.mono, textTransform: "uppercase", letterSpacing: 1 },
  sectionLabel:  { fontSize: 10, fontFamily: Fonts.mono, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 8, marginTop: 4 },

  listRow:       { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  listRowIcon:   { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  listRowLabel:  { fontSize: 13.5, fontFamily: Fonts.semibold },
  listRowSub:    { fontSize: 11.5, fontFamily: Fonts.regular, marginTop: 1 },

  segWrap:       { flexDirection: "row", gap: 2, padding: 3, borderRadius: 11, borderWidth: 1, alignSelf: "flex-start" },
  segBtn:        { paddingHorizontal: 13, paddingVertical: 6, borderRadius: 8 },
  segBtnText:    { fontSize: 12.5, fontFamily: Fonts.semibold },

  screenHeader:  { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 14, borderBottomWidth: 1 },
  headerBackBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  headerCrumb:   { fontSize: 9, fontFamily: Fonts.mono, textTransform: "uppercase", letterSpacing: 1.4, marginBottom: 2 },
  headerTitle:   { fontSize: 17, fontFamily: Fonts.bold, letterSpacing: -0.3 },
  headerSub:     { fontSize: 11.5, fontFamily: Fonts.regular, marginTop: 1 },
  headerActionBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", borderWidth: 1 },

  tenantBadge:     { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, borderWidth: 1, alignSelf: "flex-start", maxWidth: 180 },
  tenantBadgeText: { fontSize: 12, fontFamily: Fonts.semibold, letterSpacing: -0.1 },
});
