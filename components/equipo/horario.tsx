import { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Modal, FlatList } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Radius } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { fmt12 } from "@/lib/format";

/*
 * Horario semanal de un profesional: lo edita el dueño en Ajustes → Equipo y,
 * con el permiso edit_schedule, el propio colaborador en Mi perfil → Mi horario.
 */

/**
 * El descanso no se edita aquí, pero viaja intacto: antes se descartaba al
 * leer y al guardar, así que editar el horario propio de un profesional le
 * borraba el descanso (y con él el break_soft) que venía del panel web o del
 * horario del negocio.
 */
export type Descanso = { break_start?: string | null; break_end?: string | null; break_soft?: boolean | null };
export type DayConfig = { enabled: boolean; start: string; end: string } & Descanso;
export type ProSchedule = { mon: DayConfig; tue: DayConfig; wed: DayConfig; thu: DayConfig; fri: DayConfig; sat: DayConfig; sun: DayConfig };

export const DAYS: { key: keyof ProSchedule; label: string; largo: string }[] = [
  { key: "mon", label: "Lun", largo: "lunes" }, { key: "tue", label: "Mar", largo: "martes" },
  { key: "wed", label: "Mié", largo: "miércoles" }, { key: "thu", label: "Jue", largo: "jueves" },
  { key: "fri", label: "Vie", largo: "viernes" }, { key: "sat", label: "Sáb", largo: "sábado" },
  { key: "sun", label: "Dom", largo: "domingo" },
];
// 05:00 a 23:30 cada media hora (antes estaba declarado y no se usaba: las
// horas del horario propio no se podían cambiar, AJU-17).
export const TIME_OPTS = Array.from({ length: 38 }, (_, i) => {
  const total = 300 + i * 30;
  const h = Math.floor(total / 60), m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
});
export const DOW_KEYS: (keyof ProSchedule)[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/**
 * Base cuando el negocio no configuró su horario: lunes a sábado 9 a 6.
 * Antes era "solo viernes", y activar el horario propio en uno de los 11
 * negocios sin horario dejaba al profesional disponible solo los viernes.
 */
export function horarioBase(): ProSchedule {
  const on: DayConfig = { enabled: true, start: "09:00", end: "18:00" };
  return { mon: on, tue: on, wed: on, thu: on, fri: on, sat: on, sun: { enabled: false, start: "09:00", end: "18:00" } };
}

export function buildSched(raw: unknown, base: ProSchedule = horarioBase()): ProSchedule {
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, ({ open?: boolean; enabled?: boolean; start?: string; end?: string } & Descanso) | undefined>;
  const merged: ProSchedule = { ...base };
  // Formato canónico (el que leen la reserva online y la agenda): claves "0".."6" con {open,start,end}
  for (let d = 0; d < 7; d++) {
    const c = r[String(d)];
    if (c) merged[DOW_KEYS[d]] = { enabled: !!(c.open ?? c.enabled), start: c.start ?? "09:00", end: c.end ?? "18:00", ...descansoDe(c) };
  }
  // Formato legado del editor móvil: claves mon..sun con {enabled}
  for (const k of Object.keys(base) as (keyof ProSchedule)[]) {
    const c = r[k];
    if (c) merged[k] = { enabled: !!c.enabled, start: c.start ?? "09:00", end: c.end ?? "18:00", ...descansoDe(c) };
  }
  return merged;
}

export function descansoDe(c: Descanso): Descanso {
  if (!c.break_start || !c.break_end) return {};
  return { break_start: c.break_start, break_end: c.break_end, ...(typeof c.break_soft === "boolean" ? { break_soft: c.break_soft } : {}) };
}

// Se guarda siempre en el formato canónico para que la reserva online del web y la agenda lo respeten
export function toCanonical(sched: ProSchedule): Record<string, { open: boolean; start: string; end: string } & Descanso> {
  const out: Record<string, { open: boolean; start: string; end: string } & Descanso> = {};
  DOW_KEYS.forEach((k, dow) => {
    out[String(dow)] = { open: sched[k].enabled, start: sched[k].start, end: sched[k].end, ...descansoDe(sched[k]) };
  });
  return out;
}

/** Primer día abierto con la hora de cierre antes (o igual) que la de apertura. */
export function diaInvalido(sched: ProSchedule): string | null {
  for (const d of DAYS) {
    const c = sched[d.key];
    if (c.enabled && c.start >= c.end) return d.largo;
  }
  return null;
}

// ── Selector de hora ─────────────────────────────────────────────────────────
export function HoraSelector({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const { t } = useTheme();
  const [open, setOpen] = useState(false);
  const opciones = TIME_OPTS.includes(value) ? TIME_OPTS : [...TIME_OPTS, value].sort();
  return (
    <>
      <TouchableOpacity
        style={[hs.btn, { backgroundColor: t.chipBg, borderColor: t.line }]}
        onPress={() => setOpen(true)} activeOpacity={0.7}
        accessibilityRole="button" accessibilityLabel={`${label}: ${fmt12(value)}`}
      >
        <Text style={[hs.valor, { color: t.text }]}>{fmt12(value)}</Text>
        <Ionicons name="chevron-down" size={12} color={t.subtle} />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        {/* accessible={false}: si el fondo tocable agrupara a sus hijos, VoiceOver
            no llegaría a las horas de la lista. Se cierra eligiendo una hora o
            con el gesto de escape. */}
        <TouchableOpacity style={hs.overlay} onPress={() => setOpen(false)} activeOpacity={1} accessible={false}>
          <View
            style={[hs.sheet, { backgroundColor: t.cardSolid }]}
            accessibilityViewIsModal
            onAccessibilityEscape={() => setOpen(false)}
          >
            <Text style={[hs.titulo, { color: t.text }]}>{label}</Text>
            <FlatList
              data={opciones}
              keyExtractor={i => i}
              initialScrollIndex={Math.max(0, opciones.indexOf(value) - 3)}
              getItemLayout={(_, index) => ({ length: 46, offset: 46 * index, index })}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[hs.opcion, item === value && { backgroundColor: Colors.red + "14" }]}
                  onPress={() => { onChange(item); setOpen(false); }}
                  activeOpacity={0.75}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: item === value }}
                  accessibilityLabel={fmt12(item)}
                >
                  <Text style={[hs.opcionTxt, { color: item === value ? Colors.red : t.text }]}>{fmt12(item)}</Text>
                  {item === value && <Ionicons name="checkmark" size={16} color={Colors.red} />}
                </TouchableOpacity>
              )}
              style={{ maxHeight: 330 }}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const hs = StyleSheet.create({
  btn:       { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: Radius.sm, paddingHorizontal: 9, paddingVertical: 6 },
  valor:     { fontSize: 12.5, fontFamily: "SpaceGrotesk_600SemiBold" },
  overlay:   { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet:     { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40 },
  titulo:    { fontSize: 14, fontFamily: "SpaceGrotesk_700Bold", marginBottom: 12, textAlign: "center" },
  opcion:    { height: 46, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, borderRadius: Radius.sm },
  opcionTxt: { fontSize: 15, fontFamily: "SpaceGrotesk_600SemiBold" },
});

