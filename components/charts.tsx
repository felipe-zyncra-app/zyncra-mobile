// ─── Zyncra Mobile — chart & data-display kit ─────────────────────
// Puerto a react-native-svg del kit del portal web
// (ZyncraSas_v1/src/app/admin/charts.tsx). SVG hecho a mano, sin
// librerías de charting. Números siempre en JetBrains Mono.

import { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, LayoutChangeEvent } from "react-native";
import Svg, { Path, Defs, LinearGradient as SvgGradient, Stop, Circle, Line as SvgLine, Text as SvgText } from "react-native-svg";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { Colors, Fonts, Gradients } from "@/constants/theme";
import { useTheme } from "@/lib/theme";

const RED = Colors.red;
const BLUE = Colors.blue;

// ─── Helpers ──────────────────────────────────────────────────────
export const fmtCompact = (n: number): string => {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1).replace(".", ",") + " M";
  if (n >= 1_000) return Math.round(n / 1_000) + " k";
  return String(Math.round(n));
};

// Curva suave (Catmull-Rom → Bézier), con control points acotados al plot
function smoothPath(pts: { x: number; y: number }[], yMin: number, yMax: number) {
  if (pts.length < 2) return "";
  const cl = (y: number) => Math.max(yMin, Math.min(yMax, y));
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = cl(p1.y + (p2.y - p0.y) / 6);
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = cl(p2.y - (p3.y - p1.y) / 6);
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

// Medición de ancho del contenedor (reemplaza ResizeObserver del web)
function useWidth() {
  const [w, setW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);
  return { w, onLayout };
}

let uid = 0;
const nextId = () => `zn${++uid}`;

// ─── Empty ────────────────────────────────────────────────────────
export function ChartEmpty({ msg, action }: { msg: string; action?: React.ReactNode }) {
  const { t } = useTheme();
  return (
    <View style={s.empty}>
      <View style={[s.emptyDot, { borderColor: t.lineStrong }]}>
        <Text style={{ color: t.subtle, fontSize: 15 }}>·</Text>
      </View>
      <Text style={[s.emptyMsg, { color: t.subtle }]}>{msg}</Text>
      {action ? <View style={{ marginTop: 12 }}>{action}</View> : null}
    </View>
  );
}

// ─── Sparkline ────────────────────────────────────────────────────
export function Spark({ data, w = 84, h = 30, light = false }: {
  data: number[]; w?: number; h?: number; light?: boolean;
}) {
  const [id] = useState(nextId);
  if (data.length < 2 || data.every(v => v === 0)) return null;
  const max = Math.max(...data, 1);
  const pts = data.map((v, i) => ({ x: (i / (data.length - 1)) * (w - 4) + 2, y: h - 4 - (v / max) * (h - 8) }));
  const line = smoothPath(pts, 2, h - 3);
  const area = `${line} L ${pts[pts.length - 1].x.toFixed(1)} ${h} L ${pts[0].x.toFixed(1)} ${h} Z`;
  return (
    <Svg width={w} height={h}>
      <Defs>
        <SvgGradient id={`${id}s`} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={light ? "#ff6a5e" : RED} />
          <Stop offset="1" stopColor={light ? "#7d92ff" : BLUE} />
        </SvgGradient>
        <SvgGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={light ? "#ffffff" : RED} stopOpacity={light ? 0.22 : 0.13} />
          <Stop offset="1" stopColor={RED} stopOpacity={0} />
        </SvgGradient>
      </Defs>
      <Path d={area} fill={`url(#${id}f)`} />
      <Path d={line} fill="none" stroke={`url(#${id}s)`} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

// ─── Area chart ───────────────────────────────────────────────────
export function AreaChart({ data, fmt, height = 190 }: {
  data: { label: string; value: number }[];
  fmt: (v: number) => string;
  height?: number;
}) {
  const { w, onLayout } = useWidth();
  const { t } = useTheme();
  const [id] = useState(nextId);

  if (data.length === 0) return <ChartEmpty msg="Sin movimientos en este período." />;

  const safe = data.map(d => ({ ...d, value: Number.isFinite(d.value) ? d.value : 0 }));
  const chartData = safe.length === 1 ? [safe[0], { ...safe[0], label: "" }] : safe;
  const allZero = chartData.every(d => d.value === 0);

  const padL = 44, padR = 14, padT = 14, padB = 26;
  const plotW = Math.max(w - padL - padR, 10);
  const plotH = height - padT - padB;
  const max = Math.max(...chartData.map(d => d.value), 1);
  const niceMax = allZero ? 1000 : max * 1.12;

  const pts = chartData.map((d, i) => ({
    x: padL + (i / (chartData.length - 1)) * plotW,
    y: padT + plotH - (d.value / niceMax) * plotH,
  }));
  const line = smoothPath(pts, padT, padT + plotH);
  const area = `${line} L ${pts[pts.length - 1].x.toFixed(1)} ${padT + plotH} L ${pts[0].x.toFixed(1)} ${padT + plotH} Z`;

  const gridYs = [0, 1 / 3, 2 / 3, 1].map(f => padT + plotH * f);
  const gridVals = [1, 2 / 3, 1 / 3, 0].map(f => niceMax * f);
  const labelEvery = Math.ceil(chartData.length / Math.max(Math.floor(plotW / 56), 2));

  return (
    <View onLayout={onLayout} style={{ width: "100%" }}>
      {w > 0 && (
        <Svg width={w} height={height}>
          <Defs>
            <SvgGradient id={`${id}s`} x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={RED} />
              <Stop offset="1" stopColor={BLUE} />
            </SvgGradient>
            <SvgGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={RED} stopOpacity={0.12} />
              <Stop offset="0.55" stopColor={BLUE} stopOpacity={0.05} />
              <Stop offset="1" stopColor={BLUE} stopOpacity={0} />
            </SvgGradient>
          </Defs>

          {gridYs.map((y, i) => (
            <SvgLine key={i} x1={padL} x2={w - padR} y1={y} y2={y} stroke={t.line} strokeWidth={1}
              strokeDasharray={i === gridYs.length - 1 ? undefined : "2 4"} />
          ))}
          {gridYs.map((y, i) => (
            <SvgText key={`v${i}`} x={padL - 8} y={y + 3} textAnchor="end" fontSize={9}
              fill={t.subtle} fontFamily={Fonts.mono}>{fmtCompact(gridVals[i])}</SvgText>
          ))}

          {!allZero && (
            <>
              <Path d={area} fill={`url(#${id}f)`} />
              <Path d={line} fill="none" stroke={`url(#${id}s)`} strokeWidth={2.2} strokeLinecap="round" />
            </>
          )}

          {allZero && (
            <SvgText x={w / 2} y={padT + plotH / 2} textAnchor="middle" fontSize={12}
              fill={t.subtle} fontFamily={Fonts.mono}>Sin ingresos en este periodo</SvgText>
          )}

          {chartData.map((d, i) => (
            i % labelEvery === 0 && d.label ? (
              <SvgText key={`l${i}`} x={pts[i].x} y={height - 8} textAnchor="middle" fontSize={9}
                fill={t.subtle} fontFamily={Fonts.mono}>{d.label}</SvgText>
            ) : null
          ))}
        </Svg>
      )}
    </View>
  );
}

// ─── Barras verticales ────────────────────────────────────────────
export function Bars({ data, height = 150, accent = "brand" }: {
  data: { label: string; value: number }[];
  height?: number;
  accent?: "brand" | "green";
}) {
  const { t } = useTheme();
  if (data.length === 0) return <ChartEmpty msg="Sin datos para este período." />;
  const max = Math.max(...data.map(d => d.value), 1);
  const barH = height - 24;
  const grad: readonly [string, string] = accent === "green" ? ["#34d399", "#0d9488"] : ["#fb0f05", "#0027fe"];

  return (
    <View style={[s.barsWrap, { height }]}>
      {data.map((d, i) => {
        const h = d.value > 0 ? Math.max((d.value / max) * barH, 4) : 2;
        return (
          <Animated.View key={i} entering={FadeIn.delay(i * 30).duration(350)} style={s.barCol}>
            {d.value > 0 ? (
              <LinearGradient colors={grad} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
                style={[s.bar, { height: h }]} />
            ) : (
              <View style={[s.bar, { height: h, backgroundColor: t.trackBg }]} />
            )}
            <Text style={[s.barLabel, { color: t.subtle }]} numberOfLines={1}>{d.label}</Text>
          </Animated.View>
        );
      })}
      <View style={[s.barsBaseline, { backgroundColor: t.line }]} />
    </View>
  );
}

// ─── Donut ────────────────────────────────────────────────────────
export function Donut({ data, fmt, centerLabel = "total", size = 132 }: {
  data: { label: string; value: number; color: string }[];
  fmt: (v: number) => string;
  centerLabel?: string;
  size?: number;
}) {
  const { t } = useTheme();
  const [sel, setSel] = useState<number | null>(null);

  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (total === 0 || data.length === 0) return <ChartEmpty msg="Sin movimientos en este período." />;

  const sw = 16;
  const r = (size - sw) / 2 - 1;
  const C = 2 * Math.PI * r;
  const gap = data.length > 1 ? 2.5 : 0;

  const segs: { start: number; len: number }[] = [];
  for (let i = 0, acc = 0; i < data.length; i++) {
    const frac = data[i].value / total;
    segs.push({ start: acc, len: Math.max(frac * C - gap, 0.5) });
    acc += frac * C;
  }

  const shown = sel !== null ? data[sel] : null;

  return (
    <View style={s.donutWrap}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size} style={{ transform: [{ rotate: "-90deg" }] }}>
          <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={t.trackBg} strokeWidth={sw} />
          {data.map((d, i) => (
            <Circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none"
              stroke={d.color} strokeWidth={sel === i ? sw + 3 : sw}
              strokeDasharray={`${segs[i].len} ${C - segs[i].len}`}
              strokeDashoffset={-segs[i].start}
              opacity={sel !== null && sel !== i ? 0.3 : 1}
              onPress={() => setSel(sel === i ? null : i)} />
          ))}
        </Svg>
        <View style={s.donutCenter} pointerEvents="none">
          <Text style={[s.donutValue, { color: shown ? shown.color : t.ink }]}>
            {fmtCompact(shown ? shown.value : total)}
          </Text>
          <Text style={[s.donutLabel, { color: t.subtle }]} numberOfLines={1}>
            {shown ? shown.label : centerLabel}
          </Text>
        </View>
      </View>

      <View style={s.donutLegend}>
        {data.map((d, i) => (
          <TouchableOpacity key={i} style={[s.legendRow, { opacity: sel !== null && sel !== i ? 0.42 : 1 }]}
            onPress={() => setSel(sel === i ? null : i)} activeOpacity={0.7}>
            <View style={[s.legendDot, { backgroundColor: d.color }]} />
            <Text style={[s.legendLabel, { color: t.muted }]} numberOfLines={1}>{d.label}</Text>
            <Text style={[s.legendPct, { color: t.subtle }]}>{((d.value / total) * 100).toFixed(0)}%</Text>
            <Text style={[s.legendVal, { color: t.ink }]}>{fmt(d.value)}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

// ─── Ranking horizontal ───────────────────────────────────────────
export function RankBars({ items, fmt }: {
  items: { label: string; value: number; sub?: string }[];
  fmt: (v: number) => string;
}) {
  const { t } = useTheme();
  if (items.length === 0) return <ChartEmpty msg="Sin datos en este período." />;
  const max = Math.max(...items.map(i => i.value), 1);
  return (
    <View style={{ gap: 13 }}>
      {items.map((it, i) => (
        <Animated.View key={i} entering={FadeInDown.delay(i * 60).duration(350)} style={s.rankRow}>
          {i === 0 ? (
            <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.rankBadge}>
              <Text style={[s.rankBadgeText, { color: "white" }]}>{i + 1}</Text>
            </LinearGradient>
          ) : (
            <View style={[s.rankBadge, { backgroundColor: t.trackBg }]}>
              <Text style={[s.rankBadgeText, { color: t.subtle }]}>{i + 1}</Text>
            </View>
          )}
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={s.rankHead}>
              <Text style={[s.rankLabel, { color: t.ink }]} numberOfLines={1}>{it.label}</Text>
              <Text style={[s.rankValue, { color: t.muted }]}>
                {fmt(it.value)}{it.sub ? <Text style={{ color: t.subtle, fontFamily: Fonts.regular }}> · {it.sub}</Text> : null}
              </Text>
            </View>
            <View style={[s.rankTrack, { backgroundColor: t.trackBg }]}>
              {i === 0 ? (
                <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={[s.rankFill, { width: `${(it.value / max) * 100}%` }]} />
              ) : (
                <View style={[s.rankFill, { width: `${(it.value / max) * 100}%`, backgroundColor: t.lineStrong }]} />
              )}
            </View>
          </View>
        </Animated.View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  empty:     { paddingVertical: 28, paddingHorizontal: 16, alignItems: "center" },
  emptyDot:  { width: 38, height: 38, borderRadius: 19, borderWidth: 1.5, borderStyle: "dashed", alignItems: "center", justifyContent: "center", marginBottom: 10 },
  emptyMsg:  { fontSize: 12.5, fontFamily: Fonts.regular, textAlign: "center", lineHeight: 19 },

  barsWrap:     { flexDirection: "row", alignItems: "flex-end", gap: 5 },
  barCol:       { flex: 1, alignItems: "center", gap: 6, minWidth: 0, justifyContent: "flex-end" },
  bar:          { width: "100%", maxWidth: 34, borderTopLeftRadius: 5, borderTopRightRadius: 5, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 },
  barLabel:     { fontSize: 9, fontFamily: Fonts.mono, lineHeight: 10 },
  barsBaseline: { position: "absolute", left: 0, right: 0, bottom: 17, height: 1 },

  donutWrap:   { flexDirection: "row", alignItems: "center", gap: 18, flexWrap: "wrap" },
  donutCenter: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  donutValue:  { fontSize: 15, fontFamily: Fonts.mono, letterSpacing: -0.3 },
  donutLabel:  { fontSize: 8.5, fontFamily: Fonts.mono, textTransform: "uppercase", letterSpacing: 0.7, marginTop: 2, maxWidth: 80 },
  donutLegend: { flex: 1, minWidth: 150, gap: 9 },
  legendRow:   { flexDirection: "row", alignItems: "center", gap: 8 },
  legendDot:   { width: 9, height: 9, borderRadius: 3 },
  legendLabel: { fontSize: 12.5, fontFamily: Fonts.regular, flex: 1 },
  legendPct:   { fontSize: 11, fontFamily: Fonts.mono },
  legendVal:   { fontSize: 12, fontFamily: Fonts.mono },

  rankRow:       { flexDirection: "row", alignItems: "center", gap: 11 },
  rankBadge:     { width: 22, height: 22, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  rankBadgeText: { fontSize: 10, fontFamily: Fonts.monoBold },
  rankHead:      { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 4 },
  rankLabel:     { fontSize: 12.5, fontFamily: Fonts.semibold, flexShrink: 1 },
  rankValue:     { fontSize: 11.5, fontFamily: Fonts.mono },
  rankTrack:     { height: 5, borderRadius: 3, overflow: "hidden" },
  rankFill:      { height: "100%", borderRadius: 3 },
});
