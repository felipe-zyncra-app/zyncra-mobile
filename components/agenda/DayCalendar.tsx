import { useEffect, useRef, useState } from "react";
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Pressable, RefreshControl } from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Fonts, Radius } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { STATUS_META, colorDeEstadoLegible } from "@/constants/status";
import { minutosDelDia } from "@/lib/tz";
import { fmt12 } from "@/lib/format";
import { duracionCita, rangoLineaDeTiempo, timeToMins, type DayHours } from "@/lib/scheduling";
import { nombreDeCita } from "@/lib/adicionales";
import { type ApptAgenda, type BloqueoAgenda, type VentaCita } from "./tipos";

const SLOT_MINS  = 30;
const ROW_H      = 56;
const TIME_COL_W = 52;
const COL_MIN_W  = 100;   // columna por profesional: tres caben en un teléfono de 390 pt; con más, se desliza
const COL_GAP    = 6;
const HEADER_H   = 50;
const POR_COBRAR = "#d97706";

/** Columna que recoge las citas de profesionales que no tienen columna (inactivos, otra sede). */
export const COLUMNA_OTROS = "__otros";

/** Una columna de la vista por profesional (como la vista "Profesional" del calendario web). */
export type ColumnaAgenda = {
  id: string;
  nombre: string;
  iniciales: string;
  color: string;
  /** Horario efectivo del día: fuera de él la columna se sombrea. */
  horario: DayHours | null;
};

type Colocada = { appt: ApptAgenda; start: number; dur: number; lane: number; lanes: number };

const inactiva = (a: ApptAgenda) => a.status === "cancelled";

/**
 * Reparte las citas que se solapan en "carriles" (como Google Calendar y el
 * calendario de la web): se agrupan en racimos de citas encadenadas y cada
 * racimo se divide en tantas columnas como haga falta. Las canceladas no
 * piden carril: van detrás, a todo el ancho, y no le quitan espacio a la cita
 * que ocupó su hora.
 */
function layoutLanes(appts: ApptAgenda[]): Colocada[] {
  const medir = (a: ApptAgenda) => {
    const start = timeToMins(a.appointment_time.slice(0, 5));
    const dur   = Math.max(duracionCita(a), 10);
    return { appt: a, start, end: start + dur, dur };
  };
  const items = appts.filter(a => !inactiva(a)).map(medir)
    .sort((x, y) => x.start - y.start || x.end - y.end);

  const out: Colocada[] = appts.filter(inactiva).map(a => ({ ...medir(a), lane: 0, lanes: 1 }));
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

/** 'HH:MM' de unos minutos del día. */
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
/** "10:30" → "10:30 AM"; en punto, "10 AM". */
function horaCorta(m: number): string {
  const h = Math.floor(m / 60), min = m % 60;
  return `${h % 12 || 12}${min ? `:${String(min).padStart(2, "0")}` : ""} ${h >= 12 ? "PM" : "AM"}`;
}
/** 45 → "45 min", 90 → "1 h 30". */
const fmtDur = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ""}`);

/** Tramos sin atención de un horario dentro de la franja visible: antes de abrir, descanso y después de cerrar. */
function tramosCerrados(h: DayHours | null, inicio: number, fin: number): { ini: number; fin: number; motivo: string }[] {
  if (!h) return [];
  if (!h.open) return [{ ini: inicio, fin, motivo: "No atiende" }];
  const out: { ini: number; fin: number; motivo: string }[] = [];
  const abre = timeToMins(h.start), cierra = timeToMins(h.end);
  if (abre > inicio) out.push({ ini: inicio, fin: Math.min(abre, fin), motivo: "" });
  if (h.break_start && h.break_end) {
    const bi = Math.max(timeToMins(h.break_start), inicio), bf = Math.min(timeToMins(h.break_end), fin);
    if (bf > bi) out.push({ ini: bi, fin: bf, motivo: "Descanso" });
  }
  if (cierra < fin) out.push({ ini: Math.max(cierra, inicio), fin, motivo: "" });
  return out.filter(x => x.fin > x.ini);
}

/**
 * Línea de tiempo de un día de la Agenda.
 *  · Con `columnas` (vista "Todos"), una columna por profesional con su
 *    nombre arriba, como la vista por profesional del web; si no caben, se
 *    deslizan de lado y el encabezado las sigue. Sin columnas, una sola.
 *  · Las citas se pintan como en el web: fondo del color del estado, la hora
 *    arriba, cliente, servicio y duración. Una completada sin cobro se marca
 *    "Por cobrar" (D10); las canceladas quedan atenuadas y detrás.
 *  · La franja sale del horario del día y de las citas (CAL-09 / AGE-06); lo
 *    que está fuera del horario de cada profesional se sombrea.
 *  · Ausencias y cierres de blocked_slots (AGE-05).
 *  · La línea de "ahora" usa la hora del negocio, solo hoy, con la hora a la vista.
 *  · Tocar un hueco libre agenda ahí (onPressHueco), como el clic del web.
 */
export default function DayCalendar({
  dia, hoy, timezone, citas, bloqueos, columnas, horarioUnico, horarios, ventas, cruzadas,
  onPressAppt, onAddPress, onPressHueco, onElegirColumna, showPro, refreshing, onRefresh,
}: {
  dia: string;
  hoy: string;
  timezone: string;
  citas: ApptAgenda[];
  bloqueos: BloqueoAgenda[];
  /** Vista por profesional; null = una sola columna con todas las citas. */
  columnas: ColumnaAgenda[] | null;
  /** Horario que sombrea la columna única (el del profesional filtrado o el del negocio). */
  horarioUnico?: DayHours | null;
  /** Horarios efectivos del día (negocio y profesionales visibles) para la franja. */
  horarios: (DayHours | null)[];
  /** Cobros por cita; null = no se sabe (no se marca "Por cobrar"). */
  ventas: Map<string, VentaCita> | null;
  /** Citas que se cruzan con otra del mismo profesional. */
  cruzadas: Set<string>;
  onPressAppt: (a: ApptAgenda) => void;
  onAddPress: () => void;
  /** Tocar un hueco: hora 'HH:MM' y profesional de la columna (null en la columna única). */
  onPressHueco?: (hora: string, proId: string | null) => void;
  /** Tocar el nombre de una columna: ver solo a ese profesional. */
  onElegirColumna?: (proId: string) => void;
  /** Mostrar el profesional dentro de cada cita (columna única con varios profesionales). */
  showPro: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const { t, mode } = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const cabeceraRef = useRef<ScrollView>(null);
  const [gridW, setGridW] = useState(0);
  const esHoy = dia === hoy;
  const esPasado = dia < hoy;

  // La línea de "ahora" avanza sola mientras se mira el día de hoy.
  const [nowMins, setNowMins] = useState(() => minutosDelDia(new Date(), timezone));
  useEffect(() => {
    if (!esHoy) return;
    setNowMins(minutosDelDia(new Date(), timezone));
    const id = setInterval(() => setNowMins(minutosDelDia(new Date(), timezone)), 60_000);
    return () => clearInterval(id);
  }, [esHoy, timezone]);

  const todas = layoutLanes(citas);
  // Los bloqueos no estiran la franja (un cierre de día completo la llevaría
  // a 24 h): se recortan a ella.
  const rango = rangoLineaDeTiempo(horarios, todas.map(p => ({ inicio: p.start, fin: p.start + p.dur })));
  const START_MINS = rango.inicio;
  const END_MINS = rango.fin;
  const yDe = (mins: number) => ((mins - START_MINS) / SLOT_MINS) * ROW_H;
  const nowY = yDe(nowMins);
  const ahoraVisible = esHoy && nowMins >= START_MINS && nowMins < END_MINS;

  const slots: number[] = [];
  for (let m = START_MINS; m < END_MINS; m += SLOT_MINS) slots.push(m);
  const totalH = slots.length * ROW_H;

  // Columnas: todas caben en el ancho, o se deslizan con un mínimo legible.
  const cols: (ColumnaAgenda | null)[] = columnas && columnas.length > 0 ? columnas : [null];
  const areaW = Math.max(0, gridW - TIME_COL_W - 8);
  const colW = cols.length === 1 ? areaW : Math.max(COL_MIN_W, (areaW - COL_GAP * (cols.length - 1)) / cols.length);
  const contenidoW = colW * cols.length + COL_GAP * (cols.length - 1);
  const desliza = contenidoW > areaW + 1;

  useEffect(() => {
    const primera = todas.length ? Math.min(...todas.map(p => p.start)) : null;
    const objetivo = ahoraVisible ? nowY - 140 : primera != null ? yDe(primera) - 40 : 0;
    const timer = setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, objetivo), animated: false }), 100);
    return () => clearTimeout(timer);
    // Solo al montar: la pantalla monta un calendario nuevo por día.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const conColumna = new Set((columnas ?? []).map(c => c.id));
  const esDe = (col: ColumnaAgenda, a: ApptAgenda) =>
    col.id === COLUMNA_OTROS ? !a.professional_id || !conColumna.has(a.professional_id) : a.professional_id === col.id;
  const citasDe = (col: ColumnaAgenda | null) =>
    col ? layoutLanes(citas.filter(a => esDe(col, a))) : todas;
  const bloqueosDe = (col: ColumnaAgenda | null) =>
    col ? bloqueos.filter(b => !b.professional_id || b.professional_id === col.id) : bloqueos;
  const nombreCorto = (col: ColumnaAgenda | null, id: string | null) =>
    col ? null : citas.find(c => c.professional_id === id)?.professionals?.name.split(" ")[0] ?? null;

  const renderCita = ({ appt, start, dur, lane, lanes }: Colocada, ancho: number) => {
    const porCobrar = appt.status === "completed" && !appt.imported && !!ventas && !ventas.has(appt.id);
    const meta      = STATUS_META[appt.status];
    const color     = colorDeEstadoLegible(porCobrar ? POR_COBRAR : meta?.color ?? Colors.subtle, mode);
    const tinte     = porCobrar ? "rgba(245,158,11,0.14)" : meta?.bg ?? "rgba(115,108,130,0.12)";
    const label     = porCobrar ? "Por cobrar" : meta?.label ?? appt.status;
    const cruzada   = cruzadas.has(appt.id);
    const noVino    = appt.status === "no_show";
    const cancelada = inactiva(appt);
    const laneW     = lanes > 1 ? (ancho - 3 * (lanes - 1)) / lanes : ancho;
    const top       = yDe(start) + 1;
    const height    = Math.max((dur / SLOT_MINS) * ROW_H - 2, 26);
    const compacta  = height < 48;
    const holgada   = height >= 76;
    const pro       = appt.professionals;
    const icono = noVino ? "alert-circle" : porCobrar ? "card" : cruzada ? "warning" : null;
    return (
      <Animated.View
        key={appt.id}
        entering={FadeIn.duration(260)}
        style={{ position: "absolute", top, height, left: lane * (laneW + 3), width: laneW, zIndex: cancelada ? 1 : 3, opacity: cancelada ? 0.5 : 1 }}
      >
        <TouchableOpacity
          onPress={() => onPressAppt(appt)}
          activeOpacity={0.8}
          style={[dg.block, {
            backgroundColor: t.cardSolid,
            borderColor: cruzada ? POR_COBRAR : color + (mode === "dark" ? "70" : "55"),
            borderWidth: cruzada ? 1.5 : 1,
          }]}
          accessibilityRole="button"
          accessibilityLabel={`${fmt12(appt.appointment_time)}, ${appt.clients?.name ?? "Sin cliente"}, ${nombreDeCita(appt) ?? ""}${appt.is_warranty ? ", garantía" : ""}, ${fmtDur(dur)}, ${label}${pro ? `, con ${pro.name}` : ""}${cruzada ? ", se cruza con otra cita" : ""}`}
        >
          <View style={[StyleSheet.absoluteFill, { backgroundColor: tinte }]} />
          <View style={[dg.blockAccent, { backgroundColor: color }]} />
          <View style={{ flex: 1, minWidth: 0, paddingLeft: 7, paddingRight: 5, paddingVertical: compacta ? 3 : 5 }}>
            <View style={dg.filaHora}>
              <Text style={[dg.hora, { color }]} numberOfLines={1}>{fmt12(appt.appointment_time)}</Text>
              {icono && <Ionicons name={icono} size={11} color={noVino ? Colors.red : POR_COBRAR} />}
              {compacta && (
                <Text style={[dg.cliente, { color: t.text, flex: 1, textDecorationLine: cancelada ? "line-through" : "none" }]} numberOfLines={1}>
                  {appt.clients?.name ?? "Sin cliente"}
                </Text>
              )}
            </View>
            {!compacta && (
              <Text style={[dg.cliente, { color: t.text, textDecorationLine: cancelada ? "line-through" : "none" }]} numberOfLines={height >= 96 && laneW > 140 ? 2 : 1}>
                {appt.clients?.name ?? "Sin cliente"}
              </Text>
            )}
            {!compacta && (
              <Text style={[dg.servicio, { color: t.muted }]} numberOfLines={1}>
                {appt.is_warranty ? <Text style={{ color: "#7c3aed" }}>🛡 Garantía · </Text> : null}
                {nombreDeCita(appt) ?? "Servicio"}{holgada || laneW > 150 ? ` · ${fmtDur(dur)}` : ""}
              </Text>
            )}
            {holgada && showPro && pro && (
              <View style={dg.filaPro}>
                <View style={[dg.puntoPro, { backgroundColor: color }]} />
                <Text style={[dg.pro, { color: t.muted }]} numberOfLines={1}>{pro.name.split(" ")[0]}</Text>
              </View>
            )}
            {holgada && laneW > 120 && (porCobrar || noVino || cancelada) && (
              <Text style={[dg.estado, { color }]} numberOfLines={1}>{label}</Text>
            )}
          </View>
        </TouchableOpacity>
      </Animated.View>
    );
  };

  const renderColumna = (col: ColumnaAgenda | null, idx: number) => {
    const horario = col ? col.horario : horarioUnico ?? null;
    const cerrados = tramosCerrados(horario, START_MINS, END_MINS);
    const sombra = mode === "dark" ? "rgba(255,255,255,0.035)" : "rgba(20,15,30,0.035)";
    return (
      <View key={col?.id ?? "unica"} style={{ width: colW, height: totalH, marginLeft: idx === 0 ? 0 : COL_GAP }}>
        {/* Fuera de horario y descanso: sombreado, detrás de todo */}
        {cerrados.map((c, i) => (
          <View key={`cerr-${i}`} pointerEvents="none" style={[dg.cerrado, { top: yDe(c.ini), height: yDe(c.fin) - yDe(c.ini), backgroundColor: sombra }]}>
            {!!c.motivo && yDe(c.fin) - yDe(c.ini) >= 28 && <Text style={[dg.cerradoTxt, { color: t.subtle }]}>{c.motivo}</Text>}
          </View>
        ))}

        {/* Huecos: tocar uno agenda a esa hora */}
        {onPressHueco && !esPasado && slots.map(m => {
          const pasado = esHoy && m + SLOT_MINS <= nowMins;
          // Fuera del horario o en el descanso no se ofrece: el web tampoco deja agendar ahí.
          const cerrado = cerrados.some(c => m >= c.ini && m + SLOT_MINS <= c.fin);
          if (pasado || cerrado) return null;
          return (
            <Pressable
              key={`h-${m}`}
              onPress={() => onPressHueco(hhmm(m), col && col.id !== COLUMNA_OTROS ? col.id : null)}
              accessibilityRole="button"
              accessibilityLabel={`Agendar a las ${horaCorta(m)}${col ? ` con ${col.nombre}` : ""}`}
              style={({ pressed }) => [dg.hueco, { top: yDe(m), height: ROW_H }, pressed && { backgroundColor: Colors.blue + "12", borderColor: Colors.blue + "55" }]}
            >
              {({ pressed }) => pressed ? (
                <Text style={[dg.huecoTxt, { color: Colors.blue }]}>+ {horaCorta(m)}</Text>
              ) : null}
            </Pressable>
          );
        })}

        {/* Ausencias y cierres (blocked_slots): detrás de las citas */}
        {bloqueosDe(col).map(b => {
          const ini = Math.max(timeToMins(b.start_time), START_MINS);
          const fin = Math.min(timeToMins(b.end_time), END_MINS);
          if (fin <= ini) return null;
          const quien = b.professional_id ? nombreCorto(col, b.professional_id) : null;
          const etiqueta = b.professional_id ? `Ausencia${quien ? ` · ${quien}` : ""}` : "Negocio cerrado";
          return (
            <View
              key={`blk-${b.id}`}
              pointerEvents="none"
              accessibilityLabel={`${etiqueta} de ${fmt12(b.start_time)} a ${fmt12(b.end_time)}`}
              style={[dg.blocked, {
                top: yDe(ini) + 1, height: Math.max(yDe(fin) - yDe(ini) - 2, 16),
                backgroundColor: t.chipBg, borderColor: t.lineStrong,
              }]}
            >
              <Ionicons name="remove-circle-outline" size={11} color={t.subtle} />
              <Text style={[dg.blockedText, { color: t.subtle }]} numberOfLines={1}>
                {etiqueta}{b.reason ? ` · ${b.reason}` : ""}
              </Text>
            </View>
          );
        })}

        {citasDe(col).map(p => renderCita(p, colW))}
      </View>
    );
  };

  const vacia = citas.length === 0;

  return (
    <View style={{ flex: 1 }} onLayout={e => setGridW(e.nativeEvent.layout.width)}>
      {/* Encabezado de columnas: quién es cada una. Sigue al deslizamiento lateral. */}
      {columnas && columnas.length > 0 && (
        <View style={[dg.cabecera, { borderBottomColor: t.line, backgroundColor: t.bg }]}>
          <View style={{ width: TIME_COL_W + 4 }} />
          <ScrollView ref={cabeceraRef} horizontal scrollEnabled={false} showsHorizontalScrollIndicator={false} style={{ flex: 1 }}
            contentContainerStyle={{ width: desliza ? contenidoW : undefined, flexGrow: desliza ? 0 : 1, paddingRight: 4 }}>
            {columnas.map((c, i) => {
              const n = citas.filter(a => esDe(c, a) && !inactiva(a)).length;
              return (
                <TouchableOpacity
                  key={c.id}
                  onPress={() => onElegirColumna?.(c.id)}
                  activeOpacity={0.7}
                  style={[dg.cabCol, { width: colW, marginLeft: i === 0 ? 0 : COL_GAP }]}
                  accessibilityRole="button"
                  accessibilityLabel={`${c.nombre}, ${n} cita${n === 1 ? "" : "s"}. Ver solo su agenda`}
                >
                  <View style={[dg.cabAvatar, { backgroundColor: c.color + "1f", borderColor: c.color + "55" }]}>
                    <Text style={[dg.cabIniciales, { color: c.color }]}>{c.iniciales}</Text>
                  </View>
                  <View style={{ flexShrink: 1, minWidth: 0 }}>
                    <Text style={[dg.cabNombre, { color: t.ink }]} numberOfLines={1}>{c.nombre.split(" ")[0]}</Text>
                    <Text style={[dg.cabSub, { color: c.horario && !c.horario.open ? t.subtle : t.muted }]} numberOfLines={1}>
                      {c.horario && !c.horario.open ? "No atiende" : `${n} cita${n === 1 ? "" : "s"}`}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.red} />}
        contentContainerStyle={{ paddingBottom: 120, paddingTop: 8 }}
      >
        <View style={{ height: totalH, flexDirection: "row" }}>
          {/* Horas */}
          <View style={{ width: TIME_COL_W, height: totalH }}>
            {slots.map((m, i) => m % 60 === 0 && (
              <Text key={m} style={[dg.horaEje, { top: i * ROW_H - 7, color: t.subtle }]}>{horaCorta(m)}</Text>
            ))}
          </View>

          <View style={{ flex: 1, marginLeft: 4, marginRight: 4, height: totalH }}>
            {/* Líneas de la grilla, a todo el ancho */}
            {slots.map((m, i) => (
              <View key={m} pointerEvents="none" style={{
                position: "absolute", top: i * ROW_H, left: 0, right: 0,
                borderTopWidth: m % 60 === 0 ? 1 : StyleSheet.hairlineWidth,
                borderTopColor: m % 60 === 0 ? t.border : t.divider,
              }} />
            ))}

            <ScrollView
              horizontal
              scrollEnabled={desliza}
              showsHorizontalScrollIndicator={false}
              scrollEventThrottle={16}
              onScroll={e => cabeceraRef.current?.scrollTo({ x: e.nativeEvent.contentOffset.x, animated: false })}
              contentContainerStyle={{ width: desliza ? contenidoW : undefined, flexGrow: desliza ? 0 : 1 }}
            >
              <View style={{ flexDirection: "row", height: totalH }}>
                {cols.map((c, i) => renderColumna(c, i))}
              </View>
            </ScrollView>
          </View>

          {/* Ahora: línea y hora sobre el eje */}
          {ahoraVisible && (
            <View pointerEvents="none" style={[dg.ahora, { top: nowY - 9 }]}>
              <View style={[dg.ahoraPill, { backgroundColor: Colors.red }]}>
                <Text style={dg.ahoraTxt}>{horaCorta(nowMins)}</Text>
              </View>
              <View style={dg.ahoraLinea} />
            </View>
          )}
        </View>

        {/* Día sin citas — tocable: abre el modal de nueva cita */}
        {vacia && (
          <Animated.View
            entering={FadeInDown.duration(400)}
            style={{ position: "absolute", top: Math.min(Math.max(16, ahoraVisible ? nowY - 40 : 16), Math.max(16, totalH - 170)), left: TIME_COL_W + 16, right: 12 }}
          >
            <TouchableOpacity
              style={[dg.emptyCard, { backgroundColor: t.cardSolid, borderColor: t.line }]}
              onPress={onAddPress}
              activeOpacity={0.8}
              accessibilityRole="button"
            >
              <View style={[dg.emptyIcon, { backgroundColor: Colors.blue + "12" }]}>
                <Ionicons name="calendar-outline" size={22} color={Colors.blue} />
              </View>
              <Text style={[dg.emptyTitle, { color: t.ink }]}>Sin citas este día</Text>
              <Text style={[dg.emptySub, { color: t.muted }]}>
                {esPasado ? "No hubo citas." : "Toca un espacio de la agenda o aquí para agendar."}
              </Text>
            </TouchableOpacity>
          </Animated.View>
        )}
      </ScrollView>
    </View>
  );
}

const dg = StyleSheet.create({
  cabecera:     { flexDirection: "row", alignItems: "center", height: HEADER_H, borderBottomWidth: 1 },
  cabCol:       { flexDirection: "row", alignItems: "center", gap: 7, height: HEADER_H, paddingHorizontal: 4 },
  cabAvatar:    { width: 28, height: 28, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  cabIniciales: { fontSize: 10, fontFamily: Fonts.bold },
  cabNombre:    { fontSize: 12.5, fontFamily: Fonts.bold },
  cabSub:       { fontSize: 10.5, fontFamily: Fonts.regular, marginTop: 1 },
  horaEje:      { position: "absolute", right: 8, fontSize: 10.5, fontFamily: Fonts.semibold },
  ahora:        { position: "absolute", left: 0, right: 0, flexDirection: "row", alignItems: "center", zIndex: 20 },
  ahoraPill:    { width: TIME_COL_W - 2, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  ahoraTxt:     { color: "white", fontSize: 9.5, fontFamily: Fonts.bold },
  ahoraLinea:   { flex: 1, height: 2, backgroundColor: Colors.red, borderRadius: 1 },
  block:        { flex: 1, borderRadius: 9, flexDirection: "row", overflow: "hidden" },
  blockAccent:  { width: 3 },
  filaHora:     { flexDirection: "row", alignItems: "center", gap: 4 },
  hora:         { fontSize: 10, fontFamily: Fonts.monoBold, letterSpacing: -0.2 },
  cliente:      { fontSize: 12.5, fontFamily: Fonts.bold, marginTop: 1, letterSpacing: -0.1 },
  servicio:     { fontSize: 11, fontFamily: Fonts.regular, marginTop: 1 },
  filaPro:      { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 },
  puntoPro:     { width: 5, height: 5, borderRadius: 3 },
  pro:          { fontSize: 10.5, fontFamily: Fonts.semibold },
  estado:       { fontSize: 10, fontFamily: Fonts.bold, marginTop: 3 },
  cerrado:      { position: "absolute", left: 0, right: 0, alignItems: "center", justifyContent: "center" },
  cerradoTxt:   { fontSize: 10, fontFamily: Fonts.semibold, letterSpacing: 0.3 },
  hueco:        { position: "absolute", left: 0, right: 0, borderRadius: 8, borderWidth: 1, borderColor: "transparent", justifyContent: "center", paddingHorizontal: 8 },
  huecoTxt:     { fontSize: 11, fontFamily: Fonts.bold },
  blocked:      { position: "absolute", left: 0, right: 0, borderRadius: 8, borderWidth: 1, borderStyle: "dashed", paddingHorizontal: 7, paddingVertical: 3, flexDirection: "row", alignItems: "flex-start", gap: 4, zIndex: 2 },
  blockedText:  { flex: 1, fontSize: 10, fontFamily: Fonts.semibold },
  emptyCard:    { borderRadius: Radius.xl, borderWidth: 1, paddingVertical: 22, paddingHorizontal: 20, alignItems: "center", gap: 6 },
  emptyIcon:    { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  emptyTitle:   { fontSize: 14.5, fontFamily: Fonts.bold },
  emptySub:     { fontSize: 12, fontFamily: Fonts.regular, textAlign: "center", lineHeight: 17 },
});
