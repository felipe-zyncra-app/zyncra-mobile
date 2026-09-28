import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Fonts, Radius } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { esErrorDeRed, mensajeError } from "@/lib/db";

type Props = {
  /** Texto a mostrar. Si viene `error`, se deriva de él. */
  message?: string;
  /** Error de Supabase/fetch: se traduce con mensajeError() y decide el título. */
  error?: unknown;
  /** Título; por defecto "Error de conexión" o "No se pudo cargar". */
  title?: string;
  onRetry?: () => void;
};

/**
 * Estado de error con reintento. Usa los tokens del tema: con colores fijos
 * de claro el título quedaba #14111C sobre #0D0D14 en modo oscuro (1,04:1),
 * invisible (CAL-22).
 */
export default function ErrorState({ message, error, title, onRetry }: Props) {
  const { t } = useTheme();
  const deRed = error === undefined ? true : esErrorDeRed(error);
  const texto = message ?? (error !== undefined ? mensajeError(error) : "No se pudo cargar la información");
  const titulo = title ?? (deRed ? "Error de conexión" : "No se pudo cargar");

  return (
    <View style={s.container} accessibilityRole="alert">
      <Ionicons
        name={deRed ? "cloud-offline-outline" : "alert-circle-outline"}
        size={44}
        color={t.subtle}
        style={{ marginBottom: 12 }}
      />
      <Text style={[s.title, { color: t.text }]}>{titulo}</Text>
      <Text style={[s.message, { color: t.muted }]}>{texto}</Text>
      {onRetry && (
        <TouchableOpacity style={s.btn} onPress={onRetry} activeOpacity={0.8} accessibilityRole="button">
          <Ionicons name="refresh" size={16} color="white" style={{ marginRight: 6 }} />
          <Text style={s.btnText}>Reintentar</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
  title:     { fontSize: 16, fontFamily: Fonts.bold, marginBottom: 6, textAlign: "center" },
  message:   { fontSize: 13, fontFamily: Fonts.regular, textAlign: "center", marginBottom: 20 },
  // El rojo de marca con texto blanco se lee igual en claro y en oscuro.
  btn:       { flexDirection: "row", alignItems: "center", backgroundColor: Colors.red, borderRadius: Radius.md, paddingHorizontal: 20, paddingVertical: 12 },
  btnText:   { fontSize: 14, fontFamily: Fonts.bold, color: "white" },
});
