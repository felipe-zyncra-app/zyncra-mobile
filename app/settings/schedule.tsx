import { useEffect, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Switch, Modal, FlatList,
} from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { Colors, Radius, Shadow } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { fmt12Hour } from "@/lib/format";
import { ScreenHeader } from "@/components/ui";
import BottomSaveBar from "@/components/BottomSaveBar";

const DAYS = [
  { key: "1", label: "Lunes",     short: "Lun" },
  { key: "2", label: "Martes",    short: "Mar" },
  { key: "3", label: "Miercoles", short: "Mie" },
  { key: "4", label: "Jueves",    short: "Jue" },
  { key: "5", label: "Viernes",   short: "Vie" },
  { key: "6", label: "Sabado",    short: "Sab" },
  { key: "0", label: "Domingo",   short: "Dom" },
];

const TIME_OPTIONS = [
  "06:00","07:00","08:00","09:00","10:00","11:00","12:00",
  "13:00","14:00","15:00","16:00","17:00","18:00","19:00",
  "20:00","21:00","22:00","23:00",
];

type DayConfig = { open: boolean; start: string; end: string };
type Schedule  = Record<string, DayConfig>;

const DEFAULT_DAY: DayConfig = { open: false, start: "09:00", end: "18:00" };

function buildDefault(): Schedule {
  const sc: Schedule = {};
  DAYS.forEach(d => {
    sc[d.key] = { open: d.key !== "0", start: "09:00", end: "18:00" };
  });
  return sc;
}

function TimePicker({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TouchableOpacity style={tp.btn} onPress={() => setOpen(true)} activeOpacity={0.7}>
        <Text style={tp.labelTxt}>{label}</Text>
        <Text style={tp.valueTxt}>{fmt12Hour(value)}</Text>
        <Ionicons name="chevron-down" size={13} color={Colors.subtle} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={tp.overlay} onPress={() => setOpen(false)} activeOpacity={1}>
          <View style={tp.sheet}>
            <Text style={tp.sheetTitle}>{label}</Text>
            <FlatList
              data={TIME_OPTIONS}
              keyExtractor={i => i}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[tp.option, item === value && tp.optionActive]}
                  onPress={() => { onChange(item); setOpen(false); }}
                  activeOpacity={0.75}
                >
                  <Text style={[tp.optionText, item === value && tp.optionTextActive]}>{fmt12Hour(item)}</Text>
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

const tp = StyleSheet.create({
  btn:           { flex: 1, backgroundColor: Colors.cream2, borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md, paddingHorizontal: 12, paddingVertical: 10, alignItems: "center", gap: 2 },
  labelTxt:      { fontSize: 9, fontFamily: "SpaceGrotesk_700Bold", color: Colors.muted, textTransform: "uppercase", letterSpacing: 0.8 },
  valueTxt:      { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text },
  overlay:       { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet:         { backgroundColor: Colors.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40 },
  sheetTitle:    { fontSize: 14, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text, marginBottom: 14, textAlign: "center" },
  option:        { paddingVertical: 13, paddingHorizontal: 16, borderRadius: Radius.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  optionActive:  { backgroundColor: Colors.red + "0f" },
  optionText:    { fontSize: 15, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  optionTextActive: { fontFamily: "SpaceGrotesk_700Bold", color: Colors.red },
});

export default function ScheduleScreen() {
  const router = useRouter();
  const { tenantId } = useAuth();
  const { t } = useTheme();
  const [schedule, setSchedule] = useState<Schedule>(buildDefault());
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    supabase.from("tenants").select("settings").eq("id", tenantId).single()
      .then(({ data }) => {
        if (cancelled) return;
        if (data) {
          const stored = (data.settings as any)?.schedule;
          if (stored) setSchedule({ ...buildDefault(), ...stored });
        }
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [tenantId]);

  const update = (dayKey: string, patch: Partial<DayConfig>) => {
    setSchedule(prev => ({ ...prev, [dayKey]: { ...(prev[dayKey] ?? DEFAULT_DAY), ...patch } }));
  };

  const handleSave = async () => {
    if (!tenantId) return;
    setSaving(true);
    const { data: current } = await supabase.from("tenants").select("settings").eq("id", tenantId).single();
    const settings = { ...(current?.settings ?? {}), schedule };
    await supabase.from("tenants").update({ settings }).eq("id", tenantId);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const openCount = DAYS.filter(d => schedule[d.key]?.open).length;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader
        crumb="Negocio"
        title="Horario de atencion"
        subtitle={`${openCount} dia${openCount !== 1 ? "s" : ""} activo${openCount !== 1 ? "s" : ""}`}
        onBack={() => router.back()}
      />

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={Colors.red} size="large" />
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 130 }}>
            <Animated.View entering={FadeInDown.duration(350)} style={{ gap: 8 }}>
              {DAYS.map((day, i) => {
                const cfg = schedule[day.key] ?? DEFAULT_DAY;
                return (
                  <Animated.View key={day.key} entering={FadeInDown.delay(i * 40).duration(300)}>
                    <View style={[sc.dayCard, Shadow.sm, !cfg.open && sc.dayCardClosed]}>
                      <View style={sc.dayTop}>
                        <View style={[sc.dayPill, cfg.open ? sc.dayPillOpen : sc.dayPillClosed]}>
                          <Text style={[sc.dayShort, cfg.open ? sc.dayShortOpen : sc.dayShortClosed]}>
                            {day.short}
                          </Text>
                        </View>
                        <Text style={[sc.dayName, !cfg.open && sc.dayNameClosed]}>{day.label}</Text>
                        <View style={sc.switchWrap}>
                          {cfg.open && <Text style={sc.openLabel}>Abierto</Text>}
                          <Switch
                            value={cfg.open}
                            onValueChange={v => update(day.key, { open: v })}
                            trackColor={{ false: Colors.border, true: Colors.success + "99" }}
                            thumbColor={cfg.open ? Colors.success : Colors.subtle}
                          />
                        </View>
                      </View>

                      {cfg.open && (
                        <View style={sc.timeRow}>
                          <TimePicker label="Apertura" value={cfg.start} onChange={v => update(day.key, { start: v })} />
                          <View style={sc.timeSep}>
                            <View style={sc.timeLine} />
                            <Ionicons name="arrow-forward" size={12} color={Colors.subtle} />
                            <View style={sc.timeLine} />
                          </View>
                          <TimePicker label="Cierre" value={cfg.end} onChange={v => update(day.key, { end: v })} />
                        </View>
                      )}

                      {!cfg.open && (
                        <Text style={sc.closedLabel}>Cerrado este dia</Text>
                      )}
                    </View>
                  </Animated.View>
                );
              })}
            </Animated.View>
          </ScrollView>

          {saved && (
            <Animated.View entering={FadeInDown.duration(300)} style={[sc.savedToast, Shadow.md]}>
              <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
              <Text style={sc.savedText}>Horario guardado</Text>
            </Animated.View>
          )}

          <BottomSaveBar label="Guardar horario" saving={saving} onPress={handleSave} />
        </>
      )}
    </SafeAreaView>
  );
}

const sc = StyleSheet.create({
  dayCard:       { backgroundColor: Colors.white, borderRadius: Radius.lg, padding: 14, borderWidth: 1.5, borderColor: "transparent" },
  dayCardClosed: { backgroundColor: Colors.cream2, borderColor: Colors.border },
  dayTop:        { flexDirection: "row", alignItems: "center", gap: 10 },
  dayPill:       { width: 36, height: 36, borderRadius: Radius.md, alignItems: "center", justifyContent: "center" },
  dayPillOpen:   { backgroundColor: Colors.success + "18" },
  dayPillClosed: { backgroundColor: Colors.border },
  dayShort:      { fontSize: 10, fontFamily: "SpaceGrotesk_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
  dayShortOpen:  { color: Colors.success },
  dayShortClosed:{ color: Colors.subtle },
  dayName:       { flex: 1, fontSize: 15, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  dayNameClosed: { color: Colors.muted },
  switchWrap:    { flexDirection: "row", alignItems: "center", gap: 6 },
  openLabel:     { fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.success },

  timeRow:       { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: Colors.border },
  timeSep:       { alignItems: "center", gap: 2 },
  timeLine:      { width: 1, height: 6, backgroundColor: Colors.border },
  closedLabel:   { marginTop: 6, fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: Colors.subtle, paddingLeft: 46 },

  savedToast:    { position: "absolute", bottom: 110, left: 20, right: 20, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: Colors.white, borderRadius: Radius.lg, padding: 14, zIndex: 10 },
  savedText:     { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.success },
});
