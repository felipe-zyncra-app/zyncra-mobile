import { useEffect, useState } from "react";
import { Modal, View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { Colors, Fonts } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { fmtMoneyFull } from "@/lib/format";
import { IconButton, MonoTag } from "@/components/ui";
import { leerResumen, type ResumenProfesional } from "@/lib/nomina";
import { etiquetaTramo } from "./comun";
import { LineasNomina } from "./DetalleLineas";
import { Aviso, AvatarNomina, DesglosePendiente, Productividad } from "./ResumenPiezas";
import { mensajeNomina, textoSinCerrar } from "./ResumenTextos";

/**
 * Detalle de un profesional en el periodo (dueño): productividad, cita por
 * cita y lo pendiente. El resumen del equipo llega sin líneas; aquí se piden
 * con profesional_id.
 */
export default function DetalleProfesional({ tenantId, p, desde, hasta, onClose }: {
  tenantId: string;
  p: ResumenProfesional;
  desde: string;
  hasta: string;
  onClose: () => void;
}) {
  const { t } = useTheme();
  const [full, setFull] = useState<ResumenProfesional | null>(p.lineas.length > 0 ? p : null);
  const [error, setError] = useState<unknown>(null);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let vivo = true;
    setError(null);
    leerResumen({ tenantId, desde, hasta, profesionalId: p.professional_id })
      .then(r => {
        if (!vivo) return;
        // Si ya no aparece (p. ej. se desactivó y quedó sin nada), sin líneas.
        setFull(r.profesionales.find(x => x.professional_id === p.professional_id) ?? { ...p, lineas: [] });
      })
      .catch(e => { if (vivo) setError(e); });
    return () => { vivo = false; };
  }, [tenantId, desde, hasta, p, intento]);

  const actual = full ?? p;

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Cerrar detalle" />
        <View style={[s.sheet, { backgroundColor: t.cardSolid, borderColor: t.line }]}>
          <View style={[s.handle, { backgroundColor: t.lineStrong }]} />
          <View style={s.cabeza}>
            <AvatarNomina nombre={p.nombre} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[s.nombre, { color: t.ink }]} numberOfLines={1} accessibilityRole="header">{p.nombre}</Text>
              <Text style={[s.rango, { color: t.muted }]}>
                {etiquetaTramo({ desde, hasta })}{p.activo ? "" : " · Inactivo"}
              </Text>
            </View>
            <IconButton icon="close" label="Cerrar" onPress={onClose} />
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: 12, gap: 16 }} showsVerticalScrollIndicator={false}>
            <Productividad p={actual} />
            {actual.comisionLiquidada > 0 ? (
              <Text style={[s.nota, { color: t.muted }]}>
                Ya se liquidaron {fmtMoneyFull(actual.comisionLiquidada)} de comisión de este periodo.
              </Text>
            ) : null}
            {actual.citasSinCerrar > 0 ? (
              <Aviso tono="aviso" texto={textoSinCerrar(actual.citasSinCerrar)} />
            ) : null}

            {error ? (
              <Aviso
                tono="error"
                titulo="No se pudo cargar el detalle"
                texto={mensajeNomina(error)}
                accion={{ label: "Reintentar", onPress: () => setIntento(n => n + 1) }}
              />
            ) : null}
            {!full && !error ? (
              <ActivityIndicator color={Colors.red} style={{ paddingVertical: 24 }} />
            ) : full ? (
              <LineasNomina lineas={full.lineas} />
            ) : null}

            <View>
              <MonoTag style={{ marginBottom: 4 }}>Pendiente por pagar</MonoTag>
              <DesglosePendiente pend={actual.pendiente} />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet:   { maxHeight: "92%", borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 30 },
  handle:  { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 12 },
  cabeza:  { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
  nombre:  { fontSize: 17, fontFamily: Fonts.bold },
  rango:   { fontSize: 12, fontFamily: Fonts.regular, marginTop: 1 },
  nota:    { fontSize: 12, fontFamily: Fonts.regular, lineHeight: 17 },
});
