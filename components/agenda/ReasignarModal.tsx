import { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Modal, ActivityIndicator, Alert } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { Colors, Fonts, Gradients, Radius } from "@/constants/theme";
import { useTheme, type ThemeColors } from "@/lib/theme";
import { fmt12 } from "@/lib/format";
import { fmtDia } from "@/lib/tz";
import { ErrorDB, exigirFilas, mensajeError } from "@/lib/db";
import { cambioAvisable, enviarCorreoCita } from "@/lib/correo-cita";
import { useGuardRespuestas } from "@/lib/useRecarga";
import { duracionCita, mensajeErrorCita, type HorarioNegocio, type ProfesionalAgenda } from "@/lib/scheduling";
import { barajar, disponibilidadDe, type Disponibilidad } from "@/lib/asignacion";
import { IconButton } from "@/components/ui";
import { confirmar, type ApptAgenda } from "./tipos";

type Fila = { pro: ProfesionalAgenda; disp: Disponibilidad | null; error?: unknown };

/**
 * Pasar una cita a otro profesional sin tocar la fecha ni la hora (atajo del
 * Detalle de cita; para mover también la hora está "Modificar cita"). Muestra
 * quién está libre a esa hora; con "Al azar" se sortea entre los libres.
 * Solo para citas sin cobro: una cobrada no cambia de profesional.
 */
export default function ReasignarModal({ appt, tenantId, profesionales, horario, onClose, onSaved }: {
  appt: ApptAgenda | null;
  tenantId: string;
  /** Profesionales activos (ya filtrados por sede). */
  profesionales: ProfesionalAgenda[];
  horario: HorarioNegocio | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTheme();
  const s = useMemo(() => crearEstilos(t), [t]);
  const guard = useGuardRespuestas();
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [guardando, setGuardando] = useState<string | null>(null);

  const apptId = appt?.id ?? null;
  const otros = useMemo(
    () => profesionales.filter(p => p.id !== appt?.professional_id),
    [profesionales, appt?.professional_id],
  );

  useEffect(() => {
    if (!appt) return;
    const turno = guard.nuevo();
    setFilas(otros.map(pro => ({ pro, disp: null })));
    const base = {
      tenantId, dia: appt.appointment_date, hora: appt.appointment_time.slice(0, 5),
      duracion: duracionCita(appt), horario, excluirCitaId: appt.id,
    };
    Promise.all(otros.map(async pro => {
      try {
        return { pro, disp: await disponibilidadDe({ ...base, pro }) };
      } catch (e) {
        return { pro, disp: null, error: e };
      }
    })).then(r => { if (turno.vigente()) setFilas(r); });
    // Solo al abrir otra cita: la lista de la agenda se recrea en cada recarga.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apptId]);

  if (!appt) return null;
  const libres = (filas ?? []).filter(f => f.disp?.estado === "libre");
  const cargando = !filas || filas.some(f => !f.disp && !f.error);

  const asignar = async (pro: ProfesionalAgenda, disp: Disponibilidad | null) => {
    if (guardando || !disp || disp.estado === "bloqueado") return;
    if (disp.estado === "aviso") {
      const seguir = await confirmar(`¿Pasar la cita a ${pro.name}?`, disp.motivo, "Pasar igual");
      if (!seguir) return;
    }
    setGuardando(pro.id);
    try {
      // Una cita cobrada no cambia de profesional (regla del negocio). El
      // Detalle ya no deja abrir esto, pero el cobro pudo hacerse desde otro
      // dispositivo mientras la hoja estaba abierta.
      const ventas = await supabase.from("pos_sales").select("id", { count: "exact", head: true }).eq("appointment_id", appt.id);
      if (ventas.error) throw new ErrorDB(ventas.error, "No se pudo revisar el cobro de la cita");
      if ((ventas.count ?? 0) > 0) {
        Alert.alert(
          "Esta cita ya se cobró",
          "Una cita cobrada no puede cambiar de profesional. Para hacerlo, anula primero el cobro desde el historial de ventas.",
        );
        return;
      }

      const payload: { professional_id: string; location_id?: string } = { professional_id: pro.id };
      // Si el profesional es de otra sede, la cita se va con él (como en Modificar cita).
      if (pro.location_id) payload.location_id = pro.location_id;
      exigirFilas(
        await supabase.from("appointments").update(payload).eq("id", appt.id).select("id"),
        "No se pudo cambiar el profesional",
      );
      // Al cliente solo se le avisa de una cita que aún no ha pasado.
      if (appt.status !== "cancelled" && appt.status !== "no_show" && appt.status !== "completed"
        && cambioAvisable(appt, { ...appt, professional_id: pro.id })) {
        void enviarCorreoCita("modification", appt.id);
      }
      onSaved();
      onClose();
    } catch (e) {
      Alert.alert("No se cambió el profesional", mensajeErrorCita(e, "No se pudo cambiar el profesional"));
    } finally {
      setGuardando(null);
    }
  };

  const alAzar = () => {
    const pro = barajar(libres)[0];
    if (pro) void asignar(pro.pro, pro.disp);
  };

  return (
    <Modal visible={!!appt} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <View style={[s.header, { backgroundColor: "#0C0C14" }]}>
          <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3 }} />
          <View style={s.headerRow}>
            <IconButton icon="close" label="Cerrar" onPress={onClose} tone="plain" size={20} color="white" style={s.closeBtn} />
            <Text style={s.headerTitle}>Cambiar profesional</Text>
            <View style={{ width: 40 }} />
          </View>
          <Text style={s.headerSub}>
            {appt.clients?.name ?? "Sin cliente"} · {fmt12(appt.appointment_time.slice(0, 5))} · {fmtDia(appt.appointment_date, "largo")}
          </Text>
          {appt.professionals?.name && <Text style={s.headerPro}>Ahora con {appt.professionals.name}</Text>}
        </View>

        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 10 }}>
          {otros.length === 0 ? (
            <Text style={[s.vacio, { color: t.muted }]}>No hay otros profesionales activos en esta sede.</Text>
          ) : (
            <>
              {otros.length > 1 && (
                <TouchableOpacity
                  style={[s.fila, (cargando || libres.length === 0 || !!guardando) && { opacity: 0.45 }]}
                  onPress={alAzar}
                  disabled={cargando || libres.length === 0 || !!guardando}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  accessibilityLabel="Al azar"
                  accessibilityHint="Se pasa a un profesional libre a esa hora, elegido al azar"
                >
                  <View style={[s.avatar, s.azarAvatar]}><Ionicons name="shuffle" size={18} color={Colors.red} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.nombre}>Al azar</Text>
                    <Text style={[s.sub, { color: t.muted }]}>
                      {cargando ? "Revisando quién está libre…"
                        : libres.length === 0 ? "Nadie más está libre a esa hora"
                        : `Entre ${libres.length} libre${libres.length === 1 ? "" : "s"} a esa hora`}
                    </Text>
                  </View>
                </TouchableOpacity>
              )}
              {(filas ?? []).map(({ pro, disp, error }) => {
                const bloqueado = !disp || disp.estado === "bloqueado";
                const color = !disp ? t.subtle : disp.estado === "libre" ? Colors.success : disp.estado === "aviso" ? "#d97706" : t.subtle;
                const texto = error ? `No se pudo revisar su agenda. ${mensajeError(error)}`
                  : !disp ? "Revisando…"
                  : disp.estado === "libre" ? "Libre a esa hora"
                  : disp.motivo;
                return (
                  <TouchableOpacity
                    key={pro.id}
                    style={[s.fila, bloqueado && { opacity: 0.5 }]}
                    onPress={() => asignar(pro, disp)}
                    disabled={bloqueado || !!guardando}
                    activeOpacity={0.75}
                    accessibilityRole="button"
                    accessibilityLabel={`${pro.name}. ${texto}`}
                    accessibilityState={{ disabled: bloqueado, busy: guardando === pro.id }}
                  >
                    <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.avatar}>
                      <Text style={s.avatarText}>{(pro.name[0] ?? "?").toUpperCase()}</Text>
                    </LinearGradient>
                    <View style={{ flex: 1 }}>
                      <Text style={s.nombre}>{pro.name}</Text>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
                        {disp && <View style={[s.punto, { backgroundColor: color }]} />}
                        <Text style={[s.sub, { color: t.muted, flex: 1 }]}>{texto}</Text>
                      </View>
                    </View>
                    {guardando === pro.id
                      ? <ActivityIndicator size="small" color={Colors.red} />
                      : !bloqueado && <Ionicons name="chevron-forward" size={16} color={t.subtle} />}
                  </TouchableOpacity>
                );
              })}
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function crearEstilos(t: ThemeColors) {
  return StyleSheet.create({
    header:      { paddingTop: 16, paddingHorizontal: 20, paddingBottom: 20 },
    headerRow:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
    closeBtn:    { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,.2)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.3)" },
    headerTitle: { fontSize: 18, fontFamily: Fonts.bold, color: "white" },
    headerSub:   { fontSize: 13, fontFamily: Fonts.regular, color: "rgba(255,255,255,.8)", textAlign: "center" },
    headerPro:   { fontSize: 12, fontFamily: Fonts.semibold, color: "rgba(255,255,255,.65)", fontStyle: "italic", textAlign: "center", marginTop: 4 },
    fila:        { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: t.cardSolid, borderWidth: 1, borderColor: t.line, borderRadius: Radius.lg, padding: 14 },
    avatar:      { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
    azarAvatar:  { backgroundColor: "rgba(251,15,5,0.10)", borderWidth: 1, borderColor: "rgba(251,15,5,0.25)" },
    avatarText:  { color: "white", fontSize: 15, fontFamily: Fonts.bold },
    nombre:      { fontSize: 14, fontFamily: Fonts.semibold, color: t.text },
    sub:         { fontSize: 12, fontFamily: Fonts.regular, lineHeight: 16 },
    punto:       { width: 7, height: 7, borderRadius: 4 },
    vacio:       { fontSize: 13, fontFamily: Fonts.regular, textAlign: "center", marginTop: 30 },
  });
}
