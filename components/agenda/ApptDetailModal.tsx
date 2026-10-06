import { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Modal, ActivityIndicator, Alert } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { Colors, Fonts, Gradients, Radius } from "@/constants/theme";
import { useTheme, type ThemeColors } from "@/lib/theme";
import { STATUS_OPTIONS } from "@/constants/status";
import { fmt12, fmtMoneyFull } from "@/lib/format";
import { fmtDia } from "@/lib/tz";
import { mensajeError } from "@/lib/db";
import { precioDeLista } from "@/lib/ingresos";
import { useGuardRespuestas } from "@/lib/useRecarga";
import { IconButton } from "@/components/ui";
import type { ApptAgenda, VentaCita } from "./tipos";

type EstadoVenta =
  | { tipo: "cargando" }
  | { tipo: "error"; error: unknown }
  | { tipo: "listo"; ventas: VentaCita[] };

/**
 * Detalle de una cita en la Agenda del dueño.
 *
 * El estado de la cita y el dinero van juntos (D10):
 *  · "Completada" sobre una cita sin cobro abre el cobro (antes solo cambiaba
 *    el estado y el Panel contaba el precio de lista como ingreso sin que
 *    entrara un peso a caja, DIN-05 / AGE-07 / CAL-X1);
 *  · una cita ya cobrada no se puede devolver a Pendiente/Confirmada ni
 *    cancelar: hay que anular el cobro desde el historial (si no, el cobro
 *    quedaba en caja, el Panel lo dejaba de contar y aparecía "Cobrar" otra vez);
 *  · una cita completada sin cobro se muestra "por cobrar".
 */
export default function ApptDetailModal({ appt, onClose, onCambiarEstado, onEditar, onCobrar, onIrAlHistorial }: {
  appt: ApptAgenda | null;
  onClose: () => void;
  onCambiarEstado: (appt: ApptAgenda, status: string) => void;
  onEditar: () => void;
  onCobrar: () => void;
  onIrAlHistorial: () => void;
}) {
  const { t } = useTheme();
  const s = useMemo(() => crearEstilos(t), [t]);
  const guard = useGuardRespuestas();
  // El estado del cobro va con el id de la cita a la que corresponde: al abrir
  // otra cita, el primer render no puede mostrar (ni dejar tocar) el cobro de
  // la anterior mientras llega la consulta nueva.
  const [ventaDe, setVentaDe] = useState<{ apptId: string; estado: EstadoVenta } | null>(null);
  const [intento, setIntento] = useState(0);

  const apptId = appt?.id ?? null;
  useEffect(() => {
    if (!apptId) return;
    const turno = guard.nuevo();
    setVentaDe({ apptId, estado: { tipo: "cargando" } });
    supabase.from("pos_sales").select("id, total").eq("appointment_id", apptId)
      .then(({ data, error }) => {
        if (!turno.vigente()) return;
        setVentaDe({
          apptId,
          estado: error
            ? { tipo: "error", error }
            : { tipo: "listo", ventas: (data ?? []).map(v => ({ id: v.id as string, total: Number(v.total) || 0 })) },
        });
      });
  }, [apptId, intento, guard]);

  if (!appt) return null;
  const venta: EstadoVenta = ventaDe && ventaDe.apptId === appt.id ? ventaDe.estado : { tipo: "cargando" };
  const time = appt.appointment_time.substring(0, 5);
  const listo = venta.tipo === "listo";
  const cobrada = listo && venta.ventas.length > 0;
  const totalCobrado = listo ? venta.ventas.reduce((a, v) => a + v.total, 0) : 0;
  // Historial migrado de otro sistema: se atendió y se cobró allá. No está por
  // cobrar ni es ingreso de Zyncra, así que no se ofrece cobrarla.
  const historial = appt.status === "completed" && !!appt.imported;
  const porCobrar = listo && !cobrada && appt.status === "completed" && !historial;
  const puedeCobrar = listo && !cobrada && (appt.status === "pending" || appt.status === "confirmed" || porCobrar);
  // Servicio principal + adicionales (appointment_services): lo mismo que
  // precarga la hoja de cobro. Antes decía "Cobrar $20.000" y la hoja abría
  // con $25.000 porque sumaba el adicional (DIN-23).
  const precio = precioDeLista(appt);
  const adicionales = appt.appointment_services?.length ?? 0;

  const alPulsar = (status: string) => {
    if (status === appt.status || !listo) return;
    if (cobrada) {
      Alert.alert(
        "Esta cita ya se cobró",
        "Para cambiar su estado, anula primero el cobro desde el historial de ventas. Así la caja y los informes siguen cuadrando.",
        [
          { text: "Cancelar", style: "cancel" },
          { text: "Ir al historial", onPress: () => { onClose(); onIrAlHistorial(); } },
        ],
      );
      return;
    }
    // Completar = cobrar (aunque sea un cobro de $0 por cortesía).
    if (status === "completed") { onCobrar(); return; }
    onCambiarEstado(appt, status);
    onClose();
  };

  // Mover una cita cobrada (otra fecha, profesional o servicio) deja la venta
  // con los datos viejos y el Panel pasa a atribuir el cobro al día nuevo.
  // Misma regla que el estado: primero se anula el cobro.
  const alEditar = () => {
    if (!listo) return;
    if (cobrada) {
      Alert.alert(
        "Esta cita ya se cobró",
        "Para modificarla, anula primero el cobro desde el historial de ventas. Así la caja y los informes siguen cuadrando.",
        [
          { text: "Cancelar", style: "cancel" },
          { text: "Ir al historial", onPress: () => { onClose(); onIrAlHistorial(); } },
        ],
      );
      return;
    }
    onEditar();
  };

  return (
    <Modal visible={!!appt} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <View style={[s.header, { backgroundColor: "#0C0C14" }]}>
          <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3 }} />
          <View style={s.headerRow}>
            <IconButton icon="close" label="Cerrar" onPress={onClose} tone="plain" size={20} color="white" style={s.closeBtn} />
            <Text style={s.headerTitle}>Detalle de cita</Text>
            <IconButton icon="create-outline" label="Modificar cita" onPress={alEditar} tone="plain" size={20} color="white" style={s.closeBtn} />
          </View>
          <View style={s.summaryBox}>
            <Text style={s.clientName}>{appt.clients?.name ?? "Sin cliente"}</Text>
            <Text style={s.meta}>
              {appt.services?.name ?? "Sin servicio"}
              {adicionales > 0 ? ` + ${adicionales} adicional${adicionales > 1 ? "es" : ""}` : ""}
            </Text>
            <Text style={s.meta}>{fmt12(time)} · {fmtDia(appt.appointment_date, "largo")}</Text>
            {appt.professionals?.name && (
              <Text style={s.proMeta}>por {appt.professionals.name}</Text>
            )}
            {precio > 0 && <Text style={s.price}>{fmtMoneyFull(precio)}</Text>}
          </View>
        </View>

        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          {venta.tipo === "cargando" && (
            <View style={[s.infoRow, { borderColor: t.line, backgroundColor: t.cardSolid }]}>
              <ActivityIndicator size="small" color={Colors.red} />
              <Text style={[s.infoText, { color: t.muted }]}>Revisando si la cita ya se cobró…</Text>
            </View>
          )}
          {venta.tipo === "error" && (
            <View style={[s.infoRow, { borderColor: "rgba(251,15,5,0.3)", backgroundColor: "rgba(251,15,5,0.06)" }]}>
              <Ionicons name="alert-circle-outline" size={16} color={Colors.red} />
              <Text style={[s.infoText, { color: t.text, flex: 1 }]}>
                No se pudo revisar el cobro de la cita. {mensajeError(venta.error)}
              </Text>
              <TouchableOpacity onPress={() => setIntento(i => i + 1)} accessibilityRole="button" hitSlop={8}>
                <Text style={s.link}>Reintentar</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Cobrar: la acción principal de una cita pendiente, confirmada o
              completada sin cobro. Al cobrar queda Completada. */}
          {puedeCobrar && (
            <TouchableOpacity onPress={onCobrar} activeOpacity={0.85} style={{ marginBottom: 22, borderRadius: Radius.lg, overflow: "hidden" }} accessibilityRole="button">
              <LinearGradient colors={porCobrar ? ["#d97706", "#f59e0b"] : ["#10b981", "#0ea5e9"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.cobrarCard}>
                <View style={s.cobrarIcon}><Ionicons name="card-outline" size={20} color="white" /></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.cobrarTitle}>
                    Cobrar esta cita{precio > 0 ? ` · ${fmtMoneyFull(precio)}` : ""}
                  </Text>
                  <Text style={s.cobrarSub}>
                    {porCobrar
                      ? "Está completada pero sin cobro registrado: aún no cuenta como ingreso."
                      : "Con el servicio y el cliente ya cargados. Al cobrar queda Completada."}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.85)" />
              </LinearGradient>
            </TouchableOpacity>
          )}
          {historial && listo && !cobrada && (
            <View style={[s.infoRow, { marginBottom: 22 }]}>
              <Ionicons name="time-outline" size={16} color={t.subtle} />
              <Text style={[s.infoText, { color: t.text, flex: 1 }]}>
                Cita del historial migrado: se atendió y se cobró en el sistema anterior. Cuenta como visita del cliente; no entra en Por cobrar ni en los ingresos.
              </Text>
            </View>
          )}
          {cobrada && (
            <View style={s.cobradaRow}>
              <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
              <View style={{ flex: 1 }}>
                <Text style={[s.cobradaText, { color: t.text }]}>Cita cobrada · {fmtMoneyFull(totalCobrado)}. Quedó en la caja.</Text>
                <TouchableOpacity onPress={() => { onClose(); onIrAlHistorial(); }} accessibilityRole="link" hitSlop={6}>
                  <Text style={[s.link, { marginTop: 4 }]}>Anular el cobro desde el historial</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          <Text style={[s.sectionLabel, { color: t.muted }]}>Estado de la cita</Text>
          <View style={{ gap: 10 }}>
            {STATUS_OPTIONS.map(opt => {
              const isActive = appt.status === opt.status;
              const bloqueado = !listo || (cobrada && !isActive);
              const esCompletar = opt.status === "completed" && !isActive && !cobrada;
              return (
                <TouchableOpacity
                  key={opt.status}
                  style={[s.statusBtn, isActive && { borderColor: opt.color }, bloqueado && { opacity: 0.45 }]}
                  onPress={() => alPulsar(opt.status)}
                  activeOpacity={0.75}
                  disabled={!listo}
                  accessibilityRole="button"
                  accessibilityLabel={porCobrar && isActive ? "Completada, por cobrar" : opt.label}
                  accessibilityHint={esCompletar ? "Abre el cobro de la cita" : cobrada && !isActive ? "Bloqueado: la cita ya se cobró" : undefined}
                  accessibilityState={{ selected: isActive, disabled: bloqueado }}
                >
                  {isActive && (
                    <View style={[StyleSheet.absoluteFill, { borderRadius: Radius.md, backgroundColor: opt.color + "14" }]} />
                  )}
                  <View style={[s.statusIcon, { backgroundColor: opt.color + "18" }]}>
                    <Ionicons name={opt.icon} size={18} color={opt.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.statusLabel, isActive && { color: opt.color }]}>
                      {porCobrar && isActive ? "Completada · por cobrar" : opt.label}
                    </Text>
                    {esCompletar && <Text style={[s.statusSub, { color: t.subtle }]}>Se completa al cobrarla</Text>}
                  </View>
                  {isActive
                    ? <Ionicons name="checkmark-circle" size={18} color={opt.color} />
                    : cobrada ? <Ionicons name="lock-closed-outline" size={15} color={t.subtle} /> : null}
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function crearEstilos(t: ThemeColors) {
  return StyleSheet.create({
    header:      { paddingTop: 16, paddingHorizontal: 20, paddingBottom: 24 },
    headerRow:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 },
    closeBtn:    { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,.2)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.3)" },
    headerTitle: { fontSize: 18, fontFamily: Fonts.bold, color: "white" },
    summaryBox:  { backgroundColor: "rgba(255,255,255,.12)", borderRadius: Radius.lg, padding: 16, alignItems: "center", gap: 4, borderWidth: 1, borderColor: "rgba(255,255,255,0.2)" },
    clientName:  { fontSize: 18, fontFamily: Fonts.bold, color: "white" },
    meta:        { fontSize: 13, fontFamily: Fonts.regular, color: "rgba(255,255,255,.8)" },
    proMeta:     { fontSize: 12, fontFamily: Fonts.semibold, color: "rgba(255,255,255,.65)", fontStyle: "italic" },
    price:       { fontSize: 22, fontFamily: Fonts.bold, color: "white", marginTop: 4 },
    sectionLabel:{ fontSize: 11, fontFamily: Fonts.bold, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 14 },
    statusBtn:   { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: t.cardSolid, borderWidth: 1, borderColor: t.line, borderRadius: Radius.md, padding: 14, overflow: "hidden" },
    statusIcon:  { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
    statusLabel: { fontSize: 14, fontFamily: Fonts.semibold, color: t.text },
    statusSub:   { fontSize: 11, fontFamily: Fonts.regular, marginTop: 2 },
    infoRow:     { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: Radius.md, padding: 12, marginBottom: 18 },
    infoText:    { fontSize: 12.5, fontFamily: Fonts.regular },
    link:        { fontSize: 12.5, fontFamily: Fonts.bold, color: Colors.red },
    cobrarCard:  { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
    cobrarIcon:  { width: 40, height: 40, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" },
    cobrarTitle: { fontSize: 15, fontFamily: Fonts.bold, color: "white", letterSpacing: -0.2 },
    cobrarSub:   { fontSize: 11.5, fontFamily: Fonts.regular, color: "rgba(255,255,255,0.92)", marginTop: 3, lineHeight: 16 },
    cobradaRow:  { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, borderRadius: Radius.md, backgroundColor: "rgba(16,185,129,0.10)", borderWidth: 1, borderColor: "rgba(16,185,129,0.3)", marginBottom: 22 },
    cobradaText: { fontSize: 13, fontFamily: Fonts.semibold },
  });
}
