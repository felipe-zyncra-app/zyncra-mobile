import { Text, TouchableOpacity, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { useTheme } from "@/lib/theme";
import { Fonts } from "@/constants/theme";

/**
 * Qué sede está mirando una pantalla de dinero (ARQ-10 / DIN-12).
 *
 * Con varias sedes, las cifras de una sola parecían las del negocio entero y
 * la misma cifra salía distinta entre pantallas sin ninguna explicación. Estas
 * piezas rotulan la sede (o "Todas las sedes") con la misma regla que el Panel
 * y Reportes: solo se nombra si el negocio tiene más de una; con una sola, la
 * sede ES el negocio.
 *
 * La lista es solo para rotular: si no se puede leer queda vacía y la
 * pantalla sigue funcionando sin el rótulo.
 */

export type SedeLite = { id: string; name: string };

export const TODAS_LAS_SEDES = "Todas las sedes";

/** Sedes activas del negocio. Vacío si no tiene sede activa o si la consulta falla. */
export async function cargarListaSedes(tenantId: string, activa: string | null): Promise<SedeLite[]> {
  if (!activa) return [];
  const { data, error } = await supabase.from("locations")
    .select("id, name").eq("tenant_id", tenantId).eq("is_active", true).order("created_at");
  return error ? [] : ((data ?? []) as SedeLite[]);
}

/** Nombre de la sede activa, solo si hay más de una; null = no hace falta rotular. */
export function nombreSede(lista: readonly SedeLite[], activa: string | null): string | null {
  if (!activa || lista.length < 2) return null;
  return lista.find(x => x.id === activa)?.name ?? "Sede activa";
}

/** Nombre recortado para botones con poco ancho (el selector "sede / todas"). */
export function nombreCorto(nombre: string, max = 20): string {
  return nombre.length > max ? `${nombre.slice(0, max - 1).trimEnd()}…` : nombre;
}

/** Nombre de la sede de una fila (cobro, caja…); "Sin sede" si se guardó sin location_id. */
export function sedeDeFila(lista: readonly SedeLite[], locationId: string | null | undefined): string {
  if (!locationId) return "Sin sede";
  return lista.find(x => x.id === locationId)?.name ?? "Otra sede";
}

/**
 * Chip con la sede activa que lleva al selector de Ajustes → Sedes. No pinta
 * nada si `nombre` es null (negocio con una sola sede o sin sedes).
 * `sobreColor`: para encabezados con gradiente (texto blanco).
 */
export default function SedeChip({ nombre, sobreColor = false }: { nombre: string | null; sobreColor?: boolean }) {
  const router = useRouter();
  const { t } = useTheme();
  if (!nombre) return null;
  const color = sobreColor ? "white" : t.muted;
  return (
    <TouchableOpacity
      onPress={() => router.push("/settings/locations" as never)}
      activeOpacity={0.7}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={[
        s.chip,
        sobreColor
          ? { backgroundColor: "rgba(255,255,255,.14)", borderColor: "rgba(255,255,255,0.25)" }
          : { backgroundColor: t.chipBg, borderColor: t.line },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Sede activa: ${nombre}. Cambiar de sede`}
    >
      <Ionicons name="location-outline" size={12} color={color} />
      <Text style={[s.text, { color }]} numberOfLines={1}>{nombre}</Text>
      <Ionicons name="chevron-down" size={12} color={sobreColor ? "rgba(255,255,255,.7)" : t.subtle} />
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  chip: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", maxWidth: "100%", borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  text: { fontSize: 11.5, fontFamily: Fonts.semibold, flexShrink: 1 },
});
