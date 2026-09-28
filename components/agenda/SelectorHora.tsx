import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Fonts, Radius } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { fmt12 } from "@/lib/format";
import { mensajeError } from "@/lib/db";
import { chunk, minsToTime, type Ocupado } from "@/lib/scheduling";
import { OtherTimeField } from "@/components/OtherTimeField";

export type EstadoCupos = "cargando" | "error" | "cerrado" | "listo";

/**
 * Paso "Hora" de Nueva cita y Modificar cita: grilla de cupos libres, "Otra
 * hora", ausencias del día y los estados de carga/error/cerrado. Si la
 * consulta de la agenda falla NO se ofrecen cupos (antes un error de red se
 * leía como "día libre" y se ofrecían todos, AGE-X1).
 */
export default function SelectorHora({
  estado, error, onReintentar, cupos, seleccionada, onSeleccionar, bloqueos,
  avisoHora, mensajeCerrado, horarioPorDefecto, onConfigurarHorario,
}: {
  estado: EstadoCupos;
  error?: unknown;
  onReintentar: () => void;
  cupos: string[];
  seleccionada: string | null;
  onSeleccionar: (hora: string) => void;
  /** Ausencias y cierres del día (se listan para que se entienda el hueco). */
  bloqueos: Ocupado[];
  /** Advertencia para una hora puesta a mano. */
  avisoHora?: string | null;
  mensajeCerrado?: string;
  /** El negocio no ha guardado horario: se usan 8:00 AM–7:00 PM. */
  horarioPorDefecto?: boolean;
  onConfigurarHorario?: () => void;
}) {
  const { t } = useTheme();
  const box = [s.box, { backgroundColor: t.cardSolid, borderColor: t.line }];

  return (
    <View>
      {horarioPorDefecto && (
        <View style={[s.banner, { borderColor: "rgba(217,119,6,0.35)", backgroundColor: "rgba(217,119,6,0.08)" }]}>
          <Ionicons name="time-outline" size={16} color="#d97706" />
          <View style={{ flex: 1 }}>
            <Text style={[s.bannerText, { color: t.text }]}>
              Aún no configuras el horario del negocio. Mientras tanto se ofrecen cupos de 8:00 AM a 7:00 PM, todos los días.
            </Text>
            {onConfigurarHorario && (
              <TouchableOpacity onPress={onConfigurarHorario} accessibilityRole="link" hitSlop={8}>
                <Text style={s.bannerLink}>Configurar horario</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      <Text style={[s.sectionLabel, { color: t.muted }]}>Horas disponibles</Text>

      {estado === "cargando" ? (
        <View style={{ alignItems: "center", paddingVertical: 36 }}>
          <ActivityIndicator color={Colors.red} />
          <Text style={[s.sub, { color: t.muted, marginTop: 10 }]}>Verificando agenda…</Text>
        </View>
      ) : estado === "error" ? (
        <View style={box}>
          <Ionicons name="cloud-offline-outline" size={28} color={t.subtle} style={{ marginBottom: 8 }} />
          <Text style={[s.title, { color: t.text }]}>No se pudo verificar la agenda</Text>
          <Text style={[s.sub, { color: t.muted }]}>{mensajeError(error)}</Text>
          <TouchableOpacity onPress={onReintentar} style={s.retry} accessibilityRole="button">
            <Ionicons name="refresh" size={15} color="white" />
            <Text style={s.retryText}>Reintentar</Text>
          </TouchableOpacity>
        </View>
      ) : estado === "cerrado" ? (
        <View style={box}>
          <Ionicons name="moon-outline" size={28} color={t.subtle} style={{ marginBottom: 8 }} />
          <Text style={[s.title, { color: t.text }]}>Día no laborable</Text>
          <Text style={[s.sub, { color: t.muted }]}>{mensajeCerrado ?? "No se atiende este día según el horario."}</Text>
        </View>
      ) : cupos.length === 0 ? (
        <View style={box}>
          <Ionicons name="calendar-clear-outline" size={28} color={t.subtle} style={{ marginBottom: 8 }} />
          <Text style={[s.title, { color: t.text }]}>Sin cupos libres</Text>
          <Text style={[s.sub, { color: t.muted }]}>No quedan horas libres este día. Prueba otro día u «Otra hora».</Text>
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          {chunk(cupos, 3).map((row, ri) => (
            <View key={ri} style={{ flexDirection: "row", gap: 8 }}>
              {row.map(h => {
                const activo = seleccionada === h;
                return (
                  <TouchableOpacity
                    key={h}
                    style={[s.slot, { backgroundColor: activo ? Colors.red : t.cardSolid, borderColor: activo ? Colors.red : t.line }]}
                    onPress={() => onSeleccionar(h)}
                    activeOpacity={0.75}
                    accessibilityRole="button"
                    accessibilityState={{ selected: activo }}
                  >
                    <Text style={[s.slotText, { color: activo ? "white" : t.text }]}>{fmt12(h)}</Text>
                  </TouchableOpacity>
                );
              })}
              {row.length < 3 && Array.from({ length: 3 - row.length }).map((_, i) => (
                <View key={`pad-${i}`} style={{ flex: 1 }} />
              ))}
            </View>
          ))}
        </View>
      )}

      {estado === "listo" && bloqueos.length > 0 && (
        <View style={{ marginTop: 12, gap: 6 }}>
          {bloqueos.map((b, i) => (
            <View key={b.id ?? i} style={[s.block, { backgroundColor: t.chipBg, borderColor: t.line }]}>
              <Ionicons name="remove-circle-outline" size={14} color={t.subtle} />
              <Text style={[s.blockText, { color: t.muted }]} numberOfLines={2}>
                {b.professionalId ? "Ausencia" : "Negocio cerrado"} · {fmt12(minsToTime(b.inicio))} – {fmt12(minsToTime(b.fin))}
                {b.motivo ? ` · ${b.motivo}` : ""}
              </Text>
            </View>
          ))}
        </View>
      )}

      {(estado === "listo" || estado === "cerrado") && (
        <OtherTimeField
          value={seleccionada}
          inGrid={seleccionada !== null && cupos.includes(seleccionada)}
          onChange={onSeleccionar}
          aviso={avisoHora}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  sectionLabel: { fontSize: 11, fontFamily: Fonts.bold, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10, marginTop: 16 },
  box:        { borderRadius: Radius.lg, borderWidth: 1, padding: 24, alignItems: "center" },
  title:      { fontSize: 15, fontFamily: Fonts.bold, marginBottom: 4, textAlign: "center" },
  sub:        { fontSize: 13, fontFamily: Fonts.regular, textAlign: "center" },
  retry:      { marginTop: 14, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: Colors.red, borderRadius: Radius.md, paddingHorizontal: 16, paddingVertical: 10 },
  retryText:  { color: "white", fontFamily: Fonts.bold, fontSize: 13 },
  slot:       { flex: 1, paddingVertical: 13, borderRadius: Radius.md, borderWidth: 1, alignItems: "center" },
  slotText:   { fontSize: 13, fontFamily: Fonts.semibold },
  block:      { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: Radius.md, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8 },
  blockText:  { flex: 1, fontSize: 12, fontFamily: Fonts.semibold },
  banner:     { flexDirection: "row", gap: 10, borderWidth: 1, borderRadius: Radius.md, padding: 12, marginTop: 12 },
  bannerText: { fontSize: 12.5, fontFamily: Fonts.regular, lineHeight: 18 },
  bannerLink: { fontSize: 12.5, fontFamily: Fonts.bold, color: Colors.red, marginTop: 6 },
});
