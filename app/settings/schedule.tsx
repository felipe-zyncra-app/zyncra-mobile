import { useMemo, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Switch, Modal, FlatList, Alert,
} from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { Colors, Fonts, Radius, Shadow } from "@/constants/theme";
import { useTheme, type ThemeColors } from "@/lib/theme";
import { fmt12 } from "@/lib/format";
import { mensajeError, patchTenantSettings, revisar } from "@/lib/db";
import { useGuardRespuestas, useRecarga } from "@/lib/useRecarga";
import { leerHorarioNegocio, normalizeSlotInterval, timeToMins } from "@/lib/scheduling";
import { ScreenHeader } from "@/components/ui";
import ErrorState from "@/components/ErrorState";
import BottomSaveBar from "@/components/BottomSaveBar";

const DAYS = [
  { key: "1", label: "Lunes",     short: "Lun" },
  { key: "2", label: "Martes",    short: "Mar" },
  { key: "3", label: "Miércoles", short: "Mié" },
  { key: "4", label: "Jueves",    short: "Jue" },
  { key: "5", label: "Viernes",   short: "Vie" },
  { key: "6", label: "Sábado",    short: "Sáb" },
  { key: "0", label: "Domingo",   short: "Dom" },
];

/** De 5:00 AM a 11:30 PM cada media hora: hay negocios que abren a las 8:30 o cierran a las 7:30. */
const TIME_OPTIONS = Array.from({ length: 38 }, (_, i) => {
  const m = 5 * 60 + i * 30;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
});

/** Mismos valores que SLOT_INTERVAL_OPTIONS en el web (src/lib/datetime.ts). */
const INTERVAL_OPTIONS = [
  { value: 15,  label: "Cada 15 minutos" },
  { value: 20,  label: "Cada 20 minutos" },
  { value: 30,  label: "Cada 30 minutos" },
  { value: 45,  label: "Cada 45 minutos" },
  { value: 60,  label: "Cada hora" },
  { value: 90,  label: "Cada hora y media" },
  { value: 120, label: "Cada 2 horas" },
];

type DayConfig = {
  open: boolean;
  start: string;
  end: string;
  /** Descanso del día. Ausente o null = sin descanso. */
  break_start?: string | null;
  break_end?: string | null;
  break_soft?: boolean | null;
};
type Schedule = Record<string, DayConfig>;

const DEFAULT_DAY: DayConfig = { open: false, start: "09:00", end: "18:00" };

/** Horario sugerido para quien nunca guardó uno: lunes a sábado, 9 a 6. */
function buildDefault(): Schedule {
  const sc: Schedule = {};
  DAYS.forEach(d => {
    sc[d.key] = { open: d.key !== "0", start: "09:00", end: "18:00" };
  });
  return sc;
}

/** Problemas del horario que impedirían ofrecer cupos coherentes. */
function validar(schedule: Schedule): string[] {
  const out: string[] = [];
  for (const d of DAYS) {
    const c = schedule[d.key];
    if (!c?.open) continue;
    const abre = timeToMins(c.start), cierra = timeToMins(c.end);
    if (cierra <= abre) { out.push(`${d.label}: el cierre debe ser después de la apertura.`); continue; }
    if (c.break_start && c.break_end) {
      const bs = timeToMins(c.break_start), be = timeToMins(c.break_end);
      if (be <= bs) out.push(`${d.label}: el descanso debe terminar después de empezar.`);
      else if (bs < abre || be > cierra) out.push(`${d.label}: el descanso tiene que quedar dentro de la jornada.`);
    }
  }
  return out;
}

function TimePicker({ value, onChange, label, s }: { value: string; onChange: (v: string) => void; label: string; s: Estilos }) {
  const { t } = useTheme();
  const [open, setOpen] = useState(false);
  const opciones = TIME_OPTIONS.includes(value) ? TIME_OPTIONS : [...TIME_OPTIONS, value].sort();
  return (
    <>
      <TouchableOpacity style={s.tpBtn} onPress={() => setOpen(true)} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel={`${label}: ${fmt12(value)}`}>
        <Text style={s.tpLabel}>{label}</Text>
        <Text style={s.tpValue}>{fmt12(value)}</Text>
        <Ionicons name="chevron-down" size={13} color={t.subtle} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={s.overlay} onPress={() => setOpen(false)} activeOpacity={1}>
          <View style={s.sheet}>
            <Text style={s.sheetTitle}>{label}</Text>
            <FlatList
              data={opciones}
              keyExtractor={i => i}
              initialScrollIndex={Math.max(0, opciones.indexOf(value) - 3)}
              getItemLayout={(_, index) => ({ length: 47, offset: 47 * index, index })}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[s.option, item === value && s.optionActive]}
                  onPress={() => { onChange(item); setOpen(false); }}
                  activeOpacity={0.75}
                >
                  <Text style={[s.optionText, item === value && s.optionTextActive]}>{fmt12(item)}</Text>
                  {item === value && <Ionicons name="checkmark" size={16} color={Colors.red} />}
                </TouchableOpacity>
              )}
              showsVerticalScrollIndicator={false}
              style={{ maxHeight: 320 }}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

export default function ScheduleScreen() {
  const router = useRouter();
  const { tenantId } = useAuth();
  const { t } = useTheme();
  const s = useMemo(() => crearEstilos(t), [t]);
  const guard = useGuardRespuestas();
  const [schedule, setSchedule] = useState<Schedule>(buildDefault());
  /** Cada cuánto se abre un cupo (tenants.settings.slot_interval_min). */
  const [slotInterval, setSlotInterval] = useState<number>(30);
  const [intervalOpen, setIntervalOpen] = useState(false);
  const [cargado, setCargado]   = useState(false);
  const [error, setError]       = useState<unknown>(null);
  /** El negocio nunca guardó horario: lo que se ve es una sugerencia. */
  const [sugerido, setSugerido] = useState(false);
  const [editado, setEditado]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);

  const { recargar } = useRecarga(async () => {
    if (!tenantId) return;
    // No pisar lo que el usuario está editando al volver a la app.
    if (editado) return;
    const turno = guard.nuevo();
    try {
      const data = revisar(
        await supabase.from("tenants").select("settings").eq("id", tenantId).single(),
        "No se pudo cargar el horario",
      ) as { settings?: Record<string, unknown> } | null;
      if (!turno.vigente()) return;
      const settings = data?.settings ?? {};
      const horario = leerHorarioNegocio(settings);
      if (horario.porDefecto) {
        setSchedule(buildDefault());
        setSugerido(true);
      } else {
        // Se parte del horario efectivo (incluye el esquema viejo businessHours).
        const sc: Schedule = {};
        for (const d of DAYS) sc[d.key] = { ...horario.dias[d.key] };
        setSchedule(sc);
        setSugerido(false);
      }
      setSlotInterval(normalizeSlotInterval(settings.slot_interval_min));
      setError(null);
      setCargado(true);
    } catch (e) {
      if (turno.vigente()) setError(e);
    }
  }, [tenantId], { habilitado: !!tenantId, alCambiarDia: false, alCambiarSede: false });

  const update = (dayKey: string, patch: Partial<DayConfig>) => {
    setEditado(true);
    setSchedule(prev => ({ ...prev, [dayKey]: { ...(prev[dayKey] ?? DEFAULT_DAY), ...patch } }));
  };

  const handleSave = async () => {
    // Sin la carga inicial no se guarda: lo que se ve sería el horario de
    // ejemplo y pisaría el real (CAL-07 / AGE-18).
    if (!tenantId || !cargado || saving) return;
    const problemas = validar(schedule);
    if (problemas.length > 0) {
      Alert.alert("Revisa el horario", problemas.join("\n"));
      return;
    }
    setSaving(true);
    try {
      // Solo estas dos claves: el resto de tenants.settings (zona horaria,
      // logo, colores…) queda intacto, aunque lo haya cambiado el web.
      await patchTenantSettings(tenantId, { schedule, slot_interval_min: slotInterval });
      setEditado(false);
      setSugerido(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      Alert.alert("No se guardó el horario", mensajeError(e));
    } finally {
      setSaving(false);
    }
  };

  const openCount = DAYS.filter(d => schedule[d.key]?.open).length;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader
        crumb="Negocio"
        title="Horario de atención"
        subtitle={cargado ? `${openCount} día${openCount !== 1 ? "s" : ""} activo${openCount !== 1 ? "s" : ""}` : undefined}
        onBack={() => router.back()}
      />

      {!cargado && error ? (
        <ErrorState error={error} onRetry={recargar} />
      ) : !cargado ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={Colors.red} size="large" />
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 130 }}>
            {sugerido && (
              <View style={s.notice}>
                <Ionicons name="information-circle-outline" size={17} color="#d97706" />
                <Text style={s.noticeText}>
                  Aún no has guardado tu horario. Este es uno sugerido: ajústalo y guárdalo para que la agenda y tu página de reservas lo usen. Mientras tanto se ofrecen cupos de 8:00 AM a 7:00 PM todos los días.
                </Text>
              </View>
            )}

            <Animated.View entering={FadeInDown.duration(350)} style={{ marginBottom: 8 }}>
              <TouchableOpacity style={[s.dayCard, Shadow.sm]} onPress={() => setIntervalOpen(true)} activeOpacity={0.75} accessibilityRole="button">
                <View style={s.dayTop}>
                  <View style={[s.dayPill, s.dayPillOpen]}>
                    <Ionicons name="timer-outline" size={15} color={Colors.success} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.dayName}>Intervalo entre turnos</Text>
                    <Text style={s.intervalSub}>
                      {INTERVAL_OPTIONS.find(o => o.value === slotInterval)?.label ?? `Cada ${slotInterval} minutos`}
                    </Text>
                  </View>
                  <Ionicons name="chevron-down" size={15} color={t.subtle} />
                </View>
                <Text style={s.intervalHint}>
                  Solo se ofrecerán horas separadas por este intervalo, empezando desde la apertura.
                </Text>
              </TouchableOpacity>
            </Animated.View>

            <Modal visible={intervalOpen} transparent animationType="fade" onRequestClose={() => setIntervalOpen(false)}>
              <TouchableOpacity style={s.overlay} onPress={() => setIntervalOpen(false)} activeOpacity={1}>
                <View style={s.sheet}>
                  <Text style={s.sheetTitle}>Intervalo entre turnos</Text>
                  <FlatList
                    data={INTERVAL_OPTIONS}
                    keyExtractor={o => String(o.value)}
                    renderItem={({ item }) => (
                      <TouchableOpacity
                        style={[s.option, item.value === slotInterval && s.optionActive]}
                        onPress={() => { setEditado(true); setSlotInterval(item.value); setIntervalOpen(false); }}>
                        <Text style={[s.optionText, item.value === slotInterval && s.optionTextActive]}>{item.label}</Text>
                        {item.value === slotInterval && <Ionicons name="checkmark" size={17} color={Colors.red} />}
                      </TouchableOpacity>
                    )}
                  />
                </View>
              </TouchableOpacity>
            </Modal>

            <Animated.View entering={FadeInDown.duration(350)} style={{ gap: 8 }}>
              {DAYS.map((day, i) => {
                const cfg = schedule[day.key] ?? DEFAULT_DAY;
                const conDescanso = !!(cfg.break_start && cfg.break_end);
                return (
                  <Animated.View key={day.key} entering={FadeInDown.delay(i * 40).duration(300)}>
                    <View style={[s.dayCard, Shadow.sm, !cfg.open && s.dayCardClosed]}>
                      <View style={s.dayTop}>
                        <View style={[s.dayPill, cfg.open ? s.dayPillOpen : s.dayPillClosed]}>
                          <Text style={[s.dayShort, { color: cfg.open ? Colors.success : t.subtle }]}>
                            {day.short}
                          </Text>
                        </View>
                        <Text style={[s.dayName, !cfg.open && { color: t.muted }]}>{day.label}</Text>
                        <View style={s.switchWrap}>
                          {cfg.open && <Text style={s.openLabel}>Abierto</Text>}
                          <Switch
                            value={cfg.open}
                            onValueChange={v => update(day.key, { open: v })}
                            trackColor={{ false: t.lineStrong, true: Colors.success + "99" }}
                            thumbColor={cfg.open ? Colors.success : t.subtle}
                            accessibilityLabel={`${day.label} abierto`}
                          />
                        </View>
                      </View>

                      {cfg.open && (
                        <View style={s.timeRow}>
                          <TimePicker s={s} label="Apertura" value={cfg.start} onChange={v => update(day.key, { start: v })} />
                          <View style={s.timeSep}>
                            <View style={s.timeLine} />
                            <Ionicons name="arrow-forward" size={12} color={t.subtle} />
                            <View style={s.timeLine} />
                          </View>
                          <TimePicker s={s} label="Cierre" value={cfg.end} onChange={v => update(day.key, { end: v })} />
                        </View>
                      )}

                      {cfg.open && (
                        <View style={s.breakBlock}>
                          <View style={s.breakHead}>
                            <Text style={s.breakLabel}>Descanso</Text>
                            <Switch
                              value={conDescanso}
                              onValueChange={v => update(day.key, v
                                ? { break_start: "12:30", break_end: "13:00" }
                                : { break_start: null, break_end: null, break_soft: null })}
                              trackColor={{ false: t.lineStrong, true: Colors.success + "99" }}
                              thumbColor={conDescanso ? Colors.success : t.subtle}
                              accessibilityLabel={`Descanso el ${day.label.toLowerCase()}`}
                            />
                          </View>
                          {conDescanso && (
                            <View style={s.timeRow}>
                              <TimePicker s={s} label="Desde" value={cfg.break_start!} onChange={v => update(day.key, { break_start: v })} />
                              <View style={s.timeSep}>
                                <View style={s.timeLine} />
                                <Ionicons name="arrow-forward" size={12} color={t.subtle} />
                                <View style={s.timeLine} />
                              </View>
                              <TimePicker s={s} label="Hasta" value={cfg.break_end!} onChange={v => update(day.key, { break_end: v })} />
                            </View>
                          )}
                          {conDescanso && (
                            <View style={[s.breakHead, { marginTop: 10 }]}>
                              <View style={{ flex: 1, paddingRight: 10 }}>
                                <Text style={s.breakLabel}>Solo corta la grilla</Text>
                                <Text style={s.breakHint}>
                                  {cfg.break_soft
                                    ? "Los turnos se reinician al terminar el descanso, pero un servicio largo puede empezar antes y seguir de largo."
                                    : "Ningún servicio puede pisar el descanso."}
                                </Text>
                              </View>
                              <Switch
                                value={!!cfg.break_soft}
                                // null y no false al apagarlo: es el valor por defecto, igual que el panel web.
                                onValueChange={v => update(day.key, { break_soft: v || null })}
                                trackColor={{ false: t.lineStrong, true: Colors.success + "99" }}
                                thumbColor={cfg.break_soft ? Colors.success : t.subtle}
                                accessibilityLabel={`El descanso del ${day.label.toLowerCase()} solo corta la grilla`}
                              />
                            </View>
                          )}
                        </View>
                      )}

                      {!cfg.open && (
                        <Text style={s.closedLabel}>Cerrado este día</Text>
                      )}
                    </View>
                  </Animated.View>
                );
              })}
            </Animated.View>
          </ScrollView>

          {saved && (
            <Animated.View entering={FadeInDown.duration(300)} style={[s.savedToast, Shadow.md]}>
              <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
              <Text style={s.savedText}>Horario guardado</Text>
            </Animated.View>
          )}

          <BottomSaveBar label="Guardar horario" saving={saving} onPress={handleSave} />
        </>
      )}
    </SafeAreaView>
  );
}

type Estilos = ReturnType<typeof crearEstilos>;

function crearEstilos(t: ThemeColors) {
  return StyleSheet.create({
    notice:        { flexDirection: "row", gap: 10, borderWidth: 1, borderColor: "rgba(217,119,6,0.35)", backgroundColor: "rgba(217,119,6,0.08)", borderRadius: Radius.md, padding: 12, marginBottom: 12 },
    noticeText:    { flex: 1, fontSize: 12.5, fontFamily: Fonts.regular, color: t.text, lineHeight: 18 },

    dayCard:       { backgroundColor: t.cardSolid, borderRadius: Radius.lg, padding: 14, borderWidth: 1.5, borderColor: t.line },
    dayCardClosed: { backgroundColor: t.bg, borderColor: t.line },
    dayTop:        { flexDirection: "row", alignItems: "center", gap: 10 },
    dayPill:       { width: 36, height: 36, borderRadius: Radius.md, alignItems: "center", justifyContent: "center" },
    dayPillOpen:   { backgroundColor: Colors.success + "18" },
    dayPillClosed: { backgroundColor: t.chipBg },
    dayShort:      { fontSize: 10, fontFamily: Fonts.bold, textTransform: "uppercase", letterSpacing: 0.5 },
    dayName:       { flex: 1, fontSize: 15, fontFamily: Fonts.semibold, color: t.text },
    switchWrap:    { flexDirection: "row", alignItems: "center", gap: 6 },
    openLabel:     { fontSize: 11, fontFamily: Fonts.semibold, color: Colors.success },

    timeRow:       { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: t.line },
    timeSep:       { alignItems: "center", gap: 2 },
    timeLine:      { width: 1, height: 6, backgroundColor: t.line },
    closedLabel:   { marginTop: 6, fontSize: 12, fontFamily: Fonts.regular, color: t.subtle, paddingLeft: 46 },

    intervalSub:   { fontSize: 12.5, fontFamily: Fonts.semibold, color: Colors.red, marginTop: 2 },
    intervalHint:  { marginTop: 10, fontSize: 11.5, fontFamily: Fonts.regular, color: t.muted, lineHeight: 17 },

    breakBlock:    { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: t.line },
    breakHead:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    breakLabel:    { fontSize: 12.5, fontFamily: Fonts.bold, color: t.muted, textTransform: "uppercase", letterSpacing: 0.6 },
    breakHint:     { fontSize: 11.5, fontFamily: Fonts.regular, color: t.muted, marginTop: 3, lineHeight: 16 },

    savedToast:    { position: "absolute", bottom: 110, left: 20, right: 20, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: t.cardSolid, borderWidth: 1, borderColor: t.line, borderRadius: Radius.lg, padding: 14, zIndex: 10 },
    savedText:     { fontSize: 14, fontFamily: Fonts.semibold, color: Colors.success },

    // Selector de hora
    tpBtn:         { flex: 1, backgroundColor: t.inputBg, borderWidth: 1.5, borderColor: t.inputBorder, borderRadius: Radius.md, paddingHorizontal: 12, paddingVertical: 10, alignItems: "center", gap: 2 },
    tpLabel:       { fontSize: 9, fontFamily: Fonts.bold, color: t.muted, textTransform: "uppercase", letterSpacing: 0.8 },
    tpValue:       { fontSize: 15, fontFamily: Fonts.bold, color: t.text },
    overlay:       { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
    sheet:         { backgroundColor: t.cardSolid, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40 },
    sheetTitle:    { fontSize: 14, fontFamily: Fonts.bold, color: t.text, marginBottom: 14, textAlign: "center" },
    option:        { height: 47, paddingHorizontal: 16, borderRadius: Radius.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    optionActive:  { backgroundColor: Colors.red + "0f" },
    optionText:    { fontSize: 15, fontFamily: Fonts.semibold, color: t.text },
    optionTextActive: { fontFamily: Fonts.bold, color: Colors.red },
  });
}
