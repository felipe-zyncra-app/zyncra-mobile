import { View, Text, StyleSheet, TouchableOpacity, type StyleProp, type ViewStyle } from "react-native";
import { Colors, Fonts } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { IconButton } from "@/components/ui";
import { diaDeSemana, fmtDia, sumarDias } from "@/lib/tz";
import { semanaDe } from "@/lib/scheduling";

// 1 = lunes … 7 = domingo (diaDeSemana)
const NOMBRES = ["", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

/**
 * Tira de lunes a domingo de la Agenda, la Agenda del staff y los pasos de
 * fecha de Nueva cita / Modificar cita. Una sola copia: las cuatro tenían la
 * suya y el domingo saltaba a la semana siguiente (AGE-02 / TZ-X1).
 *
 * Trabaja con días del negocio ('YYYY-MM-DD'); `hoy` sale de la zona del
 * negocio, no del teléfono.
 */
export default function SemanaStrip({
  semana, seleccionado, hoy, onSeleccionar, onCambiarSemana, deshabilitado, cerrado, style,
}: {
  /** Cualquier día de la semana a mostrar (normalmente su lunes). */
  semana: string;
  seleccionado: string;
  hoy: string;
  onSeleccionar: (dia: string) => void;
  /** Recibe el lunes de la semana nueva. */
  onCambiarSemana: (lunes: string) => void;
  /** Días que no se pueden elegir (pasados, cerrados). */
  deshabilitado?: (dia: string) => boolean;
  /** Días a marcar con una rayita de "cerrado". */
  cerrado?: (dia: string) => boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useTheme();
  const dias = semanaDe(semana);
  return (
    <View style={[s.strip, { backgroundColor: t.cardSolid, borderColor: t.line }, style]}>
      <IconButton
        icon="chevron-back"
        label="Semana anterior"
        tone="plain"
        color={t.subtle}
        onPress={() => onCambiarSemana(sumarDias(dias[0], -7))}
        style={s.arrow}
      />
      {dias.map(d => {
        const off = deshabilitado?.(d) ?? false;
        const esSel = d === seleccionado;
        const esHoy = d === hoy;
        const marcaCerrado = cerrado?.(d) ?? false;
        return (
          <TouchableOpacity
            key={d}
            style={[s.dayCol, off && { opacity: 0.3 }]}
            onPress={() => { if (!off) onSeleccionar(d); }}
            disabled={off}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`${fmtDia(d, "largo")}${esHoy ? ", hoy" : ""}${marcaCerrado ? ", cerrado" : ""}`}
            accessibilityState={{ selected: esSel, disabled: off }}
          >
            <Text style={[s.dayName, { color: esSel ? Colors.red : esHoy ? Colors.red : t.subtle }, esSel && { fontFamily: Fonts.bold }]}>
              {NOMBRES[diaDeSemana(d)]}
            </Text>
            <View style={[s.dayNum, esSel && { backgroundColor: Colors.red }, !esSel && esHoy && { backgroundColor: Colors.red + "18" }]}>
              <Text style={[s.dayNumText, { color: esSel ? "white" : esHoy ? Colors.red : t.text }]}>
                {Number(d.slice(8, 10))}
              </Text>
            </View>
            <View style={[s.closedBar, { backgroundColor: marcaCerrado ? t.subtle : "transparent" }]} />
          </TouchableOpacity>
        );
      })}
      <IconButton
        icon="chevron-forward"
        label="Semana siguiente"
        tone="plain"
        color={t.subtle}
        onPress={() => onCambiarSemana(sumarDias(dias[0], 7))}
        style={s.arrow}
      />
    </View>
  );
}

const s = StyleSheet.create({
  strip:      { flexDirection: "row", alignItems: "center", paddingVertical: 10, paddingHorizontal: 2, borderTopWidth: 1, borderBottomWidth: 1 },
  arrow:      { width: 30, height: 36 },
  dayCol:     { flex: 1, alignItems: "center", gap: 5, minHeight: 44 },
  dayName:    { fontSize: 10, fontFamily: Fonts.semibold, textTransform: "uppercase" },
  dayNum:     { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  dayNumText: { fontSize: 13, fontFamily: Fonts.semibold },
  closedBar:  { width: 14, height: 2, borderRadius: 1 },
});
