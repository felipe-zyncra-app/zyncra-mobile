import { View, Text, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Colors, Fonts } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { useAvisos, RUTA_AVISOS } from "@/lib/useAvisos";
import { IconButton } from "@/components/ui";

/**
 * Campana del Panel (al lado del nombre del negocio). El número rojo son los
 * avisos sin leer de ESTE teléfono; tocarla abre app/(admin)/notificaciones.
 * Solo se pinta en el Panel del dueño.
 */
export default function CampanaAvisos() {
  const router = useRouter();
  const { t } = useTheme();
  const { noLeidos } = useAvisos();
  const texto = noLeidos > 99 ? "99+" : String(noLeidos);

  return (
    <View>
      <IconButton
        icon={noLeidos > 0 ? "notifications" : "notifications-outline"}
        label={noLeidos > 0 ? `Notificaciones, ${noLeidos} sin leer` : "Notificaciones"}
        onPress={() => router.push(RUTA_AVISOS)}
        style={[s.boton, { borderColor: t.line }]}
      />
      {noLeidos > 0 ? (
        // El borde del color del lienzo recorta el contador sobre la campana.
        // Oculto al lector de pantalla: la etiqueta del botón ya dice cuántos.
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[s.contador, { borderColor: t.canvas }]}
        >
          <Text style={s.contadorTexto} numberOfLines={1}>{texto}</Text>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  boton:         { borderWidth: 1 },
  contador:      { position: "absolute", top: -4, right: -4, minWidth: 19, height: 19, borderRadius: 10, borderWidth: 2, paddingHorizontal: 3, alignItems: "center", justifyContent: "center", backgroundColor: Colors.red },
  // Blanco sobre el rojo de marca: se lee igual en claro y en oscuro.
  contadorTexto: { fontSize: 9.5, fontFamily: Fonts.bold, color: "white", lineHeight: 12 },
});
