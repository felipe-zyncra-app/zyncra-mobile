import { useEffect, useRef, useState } from "react";
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Fonts, Radius, Shadow } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { STATUS_META } from "@/constants/status";
import { minutosDelDia } from "@/lib/tz";
import { fmt12 } from "@/lib/format";
import { duracionServicio, rangoLineaDeTiempo, timeToMins, type DayHours } from "@/lib/scheduling";
import { proColor, type ApptAgenda, type BloqueoAgenda, type VentaCita } from "./tipos";

const SLOT_MINS  = 30;
const ROW_H      = 60;
const TIME_COL_W = 56;
const POR_COBRAR = "#d97706";

type Colocada = { appt: ApptAgenda; start: number; dur: number; lane: number; lanes: number };

/**
 * Reparte las citas que se solapan en "carriles" (como Google Calendar y el
 * calendario de la web): se agrupan en racimos de citas encadenadas y cada
 * racimo se divide en tantas columnas como haga falta.
 */
function layoutLanes(appts: ApptAgenda[]): Colocada[] {
  const items = appts
    .map(a => {
      const start = timeToMins(a.appointment_time.slice(0, 5));
      const dur   = Math.max(duracionServicio(a.services), 10);
      return { appt: a, start, end: start + dur, dur };
    })
    .sort((x, y) => x.start - y.start || x.end - y.end);

  const out: Colocada[] = [];
  let cluster: typeof items = [];
  let clusterEnd = -1;
  const flush = () => {
    if (cluster.length === 0) return;
    const laneEnds: number[] = [];
    const assigned = cluster.map(it => {
      let lane = laneEnds.findIndex(e => e <= it.start);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(it.end); }
      else laneEnds[lane] = it.end;
      return { ...it, lane };
    });
    for (const a of assigned) out.push({ appt: a.appt, start: a.start, dur: a.dur, lane: a.lane, lanes: laneEnds.length });
    cluster = []; clusterEnd = -1;
  };
  for (const it of items) {
    if (cluster.length > 0 && it.start >= clusterEnd) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  flush();
  return out;
}

/**
 * Línea de tiempo de un día de la Agenda.
 *  · La franja se calcula con el horario del día y las citas (antes era
 *    8:00–21:00 fijo y las citas fuera de ahí no se veían, CAL-09 / AGE-06).
 *  · Pinta las ausencias y cierres de blocked_slots (AGE-05).
 *  · La línea de "ahora" usa la hora del negocio y solo aparece hoy.
 *  · Una cita completada sin cobro se marca "Por cobrar" (D10).
 */
export default function DayCalendar({
  dia, hoy, timezone, citas, bloqueos, profesionales, horarios, ventas, cruzadas,
  onPressAppt, onAddPress, showPro, refreshing, onRefresh,
}: {
  dia: string;
  hoy: string;
  timezone: string;
  citas: ApptAgenda[];
  bloqueos: BloqueoAgenda[];
  profesionales: { id: string; name: string }[];
  /** Horarios efectivos del día (negocio y profesionales visibles) para la franja. */
  horarios: (DayHours | null)[];
  /** Cobros por cita; null = no se sabe (no se marca "Por cobrar"). */
  ventas: Map<string, VentaCita> | null;
  /** Citas que se cruzan con otra del mismo profesional. */
  cruzadas: Set<string>;
  onPressAppt: (a: ApptAgenda) => void;
  onAddPress: () => void;
  showPro: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const { t } = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const [gridW, setGridW] = useState(0);
  const esHoy = dia === hoy;

  // La línea de "ahora" avanza sola mientras se mira el día de hoy.
  const [nowMins, setNowMins] = useState(() => minutosDelDia(new Date(), timezone));
  useEffect(() => {
    if (!esHoy) return;
    setNowMins(minutosDelDia(new Date(), timezone));
    const id = setInterval(() => setNowMins(minutosDelDia(new Date(), timezone)), 60_000);
    return () => clearInterval(id);
  }, [esHoy, timezone]);

  const placed = layoutLanes(citas);
  // Los bloqueos no estiran la franja (un cierre de día completo la llevaría
  // a 24 h): se recortan a ella.
  const rango = rangoLineaDeTiempo(horarios, placed.map(p => ({ inicio: p.start, fin: p.start + p.dur })));
  const START_MINS = rango.inicio;
  const END_MINS = rango.fin;
  const yDe = (mins: number) => ((mins - START_MINS) / SLOT_MINS) * ROW_H;
  const nowY = yDe(nowMins);

  const slots: number[] = [];
  for (let m = START_MINS; m < END_MINS; m += SLOT_MINS) slots.push(m);
  const totalH = slots.length * ROW_H;

  useEffect(() => {
    const primera = placed.length ? Math.min(...placed.map(p => p.start)) : null;
    const objetivo = esHoy && nowMins >= START_MINS && nowMins < END_MINS
      ? nowY - 120
      : primera != null ? yDe(primera) - 40 : 0;
    const timer = setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, objetivo), animated: false }), 100);
    return () => clearTimeout(timer);
    // Solo al montar: la pantalla monta un calendario nuevo por día.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const areaW = Math.max(0, gridW - TIME_COL_W - 4 - 8);
  const nombrePro = (id: string | null) => profesionales.find(p => p.id === id)?.name.split(" ")[0] ?? null;

  return (
    <ScrollView
      ref={scrollRef}
      style={{ flex: 1 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.red} />}
      contentContainerStyle={{ paddingBottom: 110 }}
    >
      <View style={{ height: totalH, position: "relative" }} onLayout={e => setGridW(e.nativeEvent.layout.width)}>

        {/* Grid lines */}
        {slots.map((slotMins, i) => {
          const isHour = slotMins % 60 === 0;
          const h      = Math.floor(slotMins / 60);
          const hLabel = `${h % 12 || 12} ${h >= 12 ? "PM" : "AM"}`;
          const isNow  = esHoy && nowMins >= slotMins && nowMins < slotMins + SLOT_MINS;
          return (
            <View key={slotMins} style={{ position: "absolute", top: i * ROW_H, left: 0, right: 0, height: ROW_H, flexDirection: "row" }}>
              <View style={{ width: TIME_COL_W, paddingTop: 8, paddingRight: 12, alignItems: "flex-end" }}>
                {isHour && (
                  <Text style={{ fontSize: 11, fontFamily: Fonts.semibold, color: isNow ? Colors.red : t.subtle }}>
                    {hLabel}
                  </Text>
                )}
              </View>
              <View style={{ flex: 1, borderTopWidth: isHour ? 1 : StyleSheet.hairlineWidth, borderTopColor: isHour ? t.border : t.divider }} />
            </View>
          );
        })}

        {/* Ausencias y cierres (blocked_slots): detrás de las citas */}
        {bloqueos.map(b => {
          const ini = Math.max(timeToMins(b.start_time), START_MINS);
          const fin = Math.min(timeToMins(b.end_time), END_MINS);
          if (fin <= ini) return null;
          const quien = b.professional_id ? nombrePro(b.professional_id) : null;
          const etiqueta = b.professional_id ? `Ausencia${quien ? ` · ${quien}` : ""}` : "Negocio cerrado";
          return (
            <View
              key={`blk-${b.id}`}
              pointerEvents="none"
              accessibilityLabel={`${etiqueta} de ${fmt12(b.start_time)} a ${fmt12(b.end_time)}`}
              style={[dg.blocked, {
                top: yDe(ini) + 1, height: Math.max(yDe(fin) - yDe(ini) - 2, 14),
                left: TIME_COL_W + 4, right: 8,
                backgroundColor: t.chipBg, borderColor: t.lineStrong,
              }]}
            >
              <Text style={[dg.blockedText, { color: t.subtle }]} numberOfLines={1}>
                {etiqueta}{b.reason ? ` · ${b.reason}` : ""}
              </Text>
            </View>
          );
        })}

        {/* Current time indicator */}
        {esHoy && nowMins >= START_MINS && nowMins < END_MINS && (
          <View pointerEvents="none" style={{ position: "absolute", top: nowY, left: 0, right: 0, zIndex: 10, flexDirection: "row", alignItems: "center" }}>
            <View style={{ width: TIME_COL_W, alignItems: "flex-end", paddingRight: 6 }}>
              <View style={dg.nowDot} />
            </View>
            <View style={dg.nowLine} />
          </View>
        )}

        {/* Appointment blocks — en carriles cuando se solapan */}
        {placed.map(({ appt, start: startMins, dur: duration, lane, lanes }) => {
          const top      = yDe(startMins) + 2;
          const height   = Math.max((duration / SLOT_MINS) * ROW_H - 4, ROW_H - 6);
          const porCobrar = appt.status === "completed" && !appt.imported && !!ventas && !ventas.has(appt.id);
          const color    = porCobrar ? POR_COBRAR : STATUS_META[appt.status]?.color ?? Colors.subtle;
          const label    = porCobrar ? "Por cobrar" : STATUS_META[appt.status]?.label ?? appt.status;
          const cruzada  = cruzadas.has(appt.id);
          const pColor   = appt.professionals ? proColor(appt.professionals.id, profesionales) : Colors.subtle;
          const laneGap  = 4;
          const laneW    = lanes > 1 ? (areaW - laneGap * (lanes - 1)) / lanes : areaW;
          const left     = TIME_COL_W + 4 + lane * (laneW + laneGap);
          const narrow   = lanes > 1;
          return (
            <TouchableOpacity
              key={appt.id}
              style={[dg.block, Shadow.sm, {
                top, left, width: gridW ? laneW : undefined, right: gridW ? undefined : 8, height,
                backgroundColor: t.card, borderColor: cruzada ? POR_COBRAR : color + "50", borderWidth: cruzada ? 1.5 : 1,
              }]}
              onPress={() => onPressAppt(appt)}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={`${fmt12(appt.appointment_time)}, ${appt.clients?.name ?? "Sin cliente"}, ${appt.services?.name ?? ""}, ${label}${cruzada ? ", se cruza con otra cita" : ""}`}
            >
              <View style={[dg.blockAccent, { backgroundColor: color }]} />
              <View style={{ flex: 1, paddingHorizontal: narrow ? 6 : 8, paddingVertical: 5, gap: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  {cruzada && <Ionicons name="warning" size={11} color={POR_COBRAR} />}
                  <Text style={[dg.blockClient, { color: t.text, flexShrink: 1 }]} numberOfLines={1}>{appt.clients?.name ?? "Sin cliente"}</Text>
                </View>
                {height >= 40 && <Text style={[dg.blockService, { color: t.muted }]} numberOfLines={1}>{appt.services?.name ?? ""}</Text>}
                {height >= 60 && showPro && appt.professionals && (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 1 }}>
                    <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: pColor }} />
                    <Text style={[dg.blockPro, { color: pColor }]} numberOfLines={1}>{appt.professionals.name.split(" ")[0]}</Text>
                  </View>
                )}
              </View>
              {/* Con varios carriles no cabe la etiqueta de estado: el color del borde y la franja ya lo dicen */}
              {!narrow && (
                <View style={[dg.blockBadge, { backgroundColor: color + "20" }]}>
                  <Text style={[dg.blockBadgeText, { color }]}>{label}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}

        {/* Empty state — tocable: abre el modal de nueva cita */}
        {citas.length === 0 && (
          <Animated.View
            entering={FadeInDown.duration(400)}
            style={{ position: "absolute", top: Math.min(Math.max(8, esHoy ? nowY - 50 : 8), Math.max(8, totalH - 160)), left: TIME_COL_W + 8, right: 8 }}
          >
            <TouchableOpacity
              style={[dg.emptyCard, { backgroundColor: t.card, borderColor: t.cardBorder }]}
              onPress={onAddPress}
              activeOpacity={0.75}
              accessibilityRole="button"
            >
              <Ionicons name="calendar-outline" size={30} color={t.subtle} />
              <Text style={[dg.emptyTitle, { color: t.text }]}>Sin citas este día</Text>
              <Text style={[dg.emptySub, { color: t.muted }]}>Toca para agendar</Text>
            </TouchableOpacity>
          </Animated.View>
        )}
      </View>
    </ScrollView>
  );
}

const dg = StyleSheet.create({
  nowDot:        { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.red },
  nowLine:       { flex: 1, height: 2, backgroundColor: Colors.red, opacity: 0.75 },
  block:         { position: "absolute", borderRadius: 10, flexDirection: "row", overflow: "hidden" },
  blockAccent:   { width: 4 },
  blockClient:   { fontSize: 12, fontFamily: Fonts.semibold },
  blockService:  { fontSize: 10, fontFamily: Fonts.regular },
  blockPro:      { fontSize: 9,  fontFamily: Fonts.semibold },
  blockBadge:    { paddingHorizontal: 6, paddingVertical: 4, alignSelf: "center", marginRight: 6, borderRadius: 6 },
  blockBadgeText:{ fontSize: 9, fontFamily: Fonts.bold },
  blocked:       { position: "absolute", borderRadius: 8, borderWidth: 1, borderStyle: "dashed", paddingHorizontal: 8, paddingVertical: 3 },
  blockedText:   { fontSize: 10, fontFamily: Fonts.semibold },
  emptyCard:     { borderRadius: Radius.xl, borderWidth: 1, padding: 28, alignItems: "center", gap: 8 },
  emptyTitle:    { fontSize: 14, fontFamily: Fonts.bold },
  emptySub:      { fontSize: 12, fontFamily: Fonts.regular, textAlign: "center" },
});
