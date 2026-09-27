import { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl, Modal, Alert, ActivityIndicator } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown, FadeInRight } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { Colors, Fonts, Gradients, Radius, Shadow } from "@/constants/theme";
import { useTheme, type ThemeColors } from "@/lib/theme";
import { IconButton, MonoTag } from "@/components/ui";
import { STATUS_OPTIONS, STATUS_META } from "@/constants/status";
import { duracionServicio, verificarCupo } from "@/lib/scheduling";
import { fmt12, fmtTelefono } from "@/lib/format";
import { exigirFilas, mensajeError, traerTodo } from "@/lib/db";
import { fmtDia, hoyNegocio, inicioDeSemana } from "@/lib/tz";
import { useGuardRespuestas, useRecarga } from "@/lib/useRecarga";
import ErrorState from "@/components/ErrorState";
import SubscriptionBanner from "@/components/SubscriptionBanner";
import SemanaStrip from "@/components/agenda/SemanaStrip";
import { RESTRICTIVE_PERMISSIONS, parsePermissions, useStaffPermissions } from "@/lib/permissions";

type Appt = {
  id: string;
  appointment_date: string;
  appointment_time: string;
  status: string;
  professional_id: string | null;
  clients: { name: string; phone?: string | null } | null;
  services: { name: string; price?: number | null; duration_minutes?: number | null; duration_min?: number | null } | null;
  professionals: { name: string } | null;
};

/** Estados que el staff puede poner a mano. "Completada" solo llega cobrando (D10). */
const OPCIONES_STAFF = STATUS_OPTIONS.filter(o => o.status !== "completed");

function ApptDetailModal({ appt, verPro, onClose, onStatusChange }: {
  appt: Appt | null;
  verPro: boolean;
  onClose: () => void;
  onStatusChange: (appt: Appt, status: string) => void;
}) {
  // Hooks antes del return condicional (regla de hooks: el orden no puede variar entre renders)
  const { t } = useTheme();
  const s = useMemo(() => crearEstilosModal(t), [t]);
  const perms = useStaffPermissions();
  if (!appt) return null;
  const time = appt.appointment_time.substring(0, 5);
  const completada = appt.status === "completed";

  const alPulsar = (status: string) => {
    if (status === appt.status) return;
    if (completada) {
      // Una cita completada puede tener un cobro en caja: devolverla a
      // Confirmada o cancelarla descuadraba la caja y abría un segundo cobro.
      Alert.alert(
        "Esta cita ya se completó",
        "Si hay que cambiarla, el dueño debe anular primero el cobro desde el historial de ventas.",
      );
      return;
    }
    onStatusChange(appt, status);
    onClose();
  };

  return (
    <Modal visible={!!appt} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <View style={[s.header, { backgroundColor: "#0C0C14" }]}>
          <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3 }} />
          <View style={s.headerRow}>
            <IconButton icon="close" label="Cerrar" onPress={onClose} tone="plain" size={20} color="white" style={s.closeBtn} />
            <Text style={s.headerTitle}>Detalle de cita</Text>
            <View style={{ width: 40 }} />
          </View>
          <View style={{ alignItems: "center", marginTop: 8 }}>
            <Text style={s.clientName}>{appt.clients?.name ?? "Sin cliente"}</Text>
            <Text style={s.serviceName}>{appt.services?.name ?? "Sin servicio"}</Text>
            {verPro && appt.professionals?.name && <Text style={s.serviceName}>con {appt.professionals.name}</Text>}
            <View style={s.timeBadge}>
              <Ionicons name="time-outline" size={14} color="rgba(255,255,255,.9)" />
              <Text style={s.timeText}>{fmt12(time)} · {fmtDia(appt.appointment_date, "semana-dia")}</Text>
            </View>
          </View>
        </View>

        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
          <Text style={s.sectionLabel}>Estado de la cita</Text>
          {completada ? (
            <View style={[s.note, { borderColor: "rgba(16,185,129,0.3)", backgroundColor: "rgba(16,185,129,0.08)" }]}>
              <Ionicons name="checkmark-done-circle-outline" size={16} color={Colors.success} />
              <Text style={[s.noteText, { color: t.text }]}>
                Completada. Si hay que cambiarla, el dueño debe anular primero el cobro desde el historial de ventas.
              </Text>
            </View>
          ) : (
            <>
              <View style={s.statusGrid}>
                {OPCIONES_STAFF.map(opt => {
                  const active = appt.status === opt.status;
                  return (
                    <TouchableOpacity
                      key={opt.status}
                      style={[s.statusBtn, active && { borderColor: opt.color, backgroundColor: opt.color + "14" }]}
                      onPress={() => alPulsar(opt.status)}
                      activeOpacity={0.75}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <Ionicons name={opt.icon} size={18} color={active ? opt.color : t.muted} />
                      <Text style={[s.statusLabel, active && { color: opt.color }]}>{opt.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View style={[s.note, { borderColor: t.line, backgroundColor: t.cardSolid }]}>
                <Ionicons name="card-outline" size={16} color={t.muted} />
                <Text style={[s.noteText, { color: t.muted }]}>
                  La cita queda «Completada» cuando se cobra en la caja. Así el ingreso y la caja cuadran.
                </Text>
              </View>
            </>
          )}

          {perms.contact && appt.clients?.phone && (
            <View style={[s.infoCard, Shadow.sm]}>
              <Ionicons name="call-outline" size={16} color={t.muted} />
              <Text style={s.infoText}>{fmtTelefono(appt.clients.phone)}</Text>
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function crearEstilosModal(t: ThemeColors) {
  return StyleSheet.create({
    header:      { paddingTop: 16, paddingHorizontal: 20, paddingBottom: 24 },
    headerRow:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    closeBtn:    { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,.18)", alignItems: "center", justifyContent: "center" },
    headerTitle: { fontSize: 18, fontFamily: Fonts.bold, color: "white" },
    clientName:  { fontSize: 22, fontFamily: Fonts.bold, color: "white", letterSpacing: -0.5, marginBottom: 4 },
    serviceName: { fontSize: 14, fontFamily: Fonts.regular, color: "rgba(255,255,255,.8)" },
    timeBadge:   { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,.18)", borderRadius: Radius.full, paddingHorizontal: 14, paddingVertical: 6, marginTop: 10 },
    timeText:    { fontSize: 14, fontFamily: Fonts.bold, color: "white" },
    sectionLabel:{ fontSize: 11, fontFamily: Fonts.bold, color: t.muted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 12 },
    statusGrid:  { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 14 },
    statusBtn:   { flex: 1, minWidth: "45%", flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: t.cardSolid, borderRadius: Radius.md, padding: 14, borderWidth: 1.5, borderColor: t.line },
    statusLabel: { fontSize: 13, fontFamily: Fonts.semibold, color: t.muted },
    note:        { flexDirection: "row", alignItems: "flex-start", gap: 8, borderWidth: 1, borderRadius: Radius.md, padding: 12, marginBottom: 20 },
    noteText:    { flex: 1, fontSize: 12.5, fontFamily: Fonts.regular, lineHeight: 18 },
    infoCard:    { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: t.cardSolid, borderRadius: Radius.md, padding: 14, borderWidth: 1, borderColor: t.line },
    infoText:    { fontSize: 14, fontFamily: Fonts.regular, color: t.text },
  });
}

type DatosDia = { dia: string; citas: Appt[]; agendaCompleta: boolean };

export default function StaffAgendaScreen() {
  const { tenantId, professionalId, reintentar } = useAuth();
  const { timezone, ready } = useTenant();
  const { t } = useTheme();
  const s = useMemo(() => crearEstilos(t), [t]);
  const guard = useGuardRespuestas();

  const [selected, setSelected]         = useState(() => hoyNegocio(timezone));
  const [semana, setSemana]             = useState(() => inicioDeSemana(hoyNegocio(timezone)));
  const [datos, setDatos]               = useState<DatosDia | null>(null);
  const [selectedAppt, setSelectedAppt] = useState<Appt | null>(null);
  const [refreshing, setRefreshing]     = useState(false);
  const [error, setError]               = useState<unknown>(null);

  const { hoy, recargar } = useRecarga(async () => {
    if (!tenantId || !professionalId) return;
    const turno = guard.nuevo();
    const dia = selected;
    try {
      // Con permissions.full_agenda (recepción) la RLS deja ver toda la agenda
      // del negocio: antes el móvil filtraba siempre por el profesional y la
      // recepcionista veía su agenda vacía (ARQ-13).
      const permsRes = await supabase.from("professionals").select("permissions").eq("id", professionalId).maybeSingle();
      // Sin poder leerlos, los restrictivos (ARQ-12).
      const permisos = permsRes.error || !permsRes.data
        ? RESTRICTIVE_PERMISSIONS
        : parsePermissions(permsRes.data.permissions);
      const agendaCompleta = permisos.full_agenda;
      // El teléfono del cliente solo se descarga con el permiso de contacto:
      // antes llegaba siempre y la pantalla solo lo ocultaba.
      const clientes = permisos.contact ? "clients(name, phone)" : "clients(name)";

      const citas = await traerTodo<Appt>((desde, hasta) => {
        let q = supabase.from("appointments")
          .select(`id, appointment_date, appointment_time, status, professional_id, ${clientes}, services(name, price, duration_minutes, duration_min), professionals(name)`)
          .eq("appointment_date", dia);
        q = agendaCompleta ? q.eq("tenant_id", tenantId) : q.eq("professional_id", professionalId);
        return q.order("appointment_time").order("id").range(desde, hasta) as unknown as PromiseLike<{ data: Appt[] | null; error: unknown }>;
      }, { contexto: "No se pudo cargar tu agenda" });
      if (!turno.vigente()) return;
      setDatos({ dia, citas, agendaCompleta });
      setError(null);
    } catch (e) {
      if (turno.vigente()) setError(e);
    }
  }, [tenantId, professionalId, timezone, selected], { timeZone: timezone, habilitado: !!tenantId && !!professionalId && ready });

  // Si se estaba mirando "hoy" y cambia el día del negocio, se sigue en el nuevo hoy.
  const hoyPrevio = useRef(hoy);
  useEffect(() => {
    const antes = hoyPrevio.current;
    hoyPrevio.current = hoy;
    if (antes !== hoy && selected === antes) {
      setSelected(hoy);
      setSemana(inicioDeSemana(hoy));
    }
  }, [hoy, selected]);

  const onRefresh = async () => { setRefreshing(true); await recargar(); setRefreshing(false); };

  const handleStatusChange = async (appt: Appt, status: string) => {
    if (!tenantId || status === appt.status) return;
    if (status === "completed" || appt.status === "completed") return;   // ver ApptDetailModal
    // Reactivar una cancelada o no-show: su hora pudo ocuparse.
    const reactivar = (appt.status === "cancelled" || appt.status === "no_show") && (status === "pending" || status === "confirmed");
    if (reactivar && appt.professional_id) {
      try {
        const v = await verificarCupo({
          tenantId,
          professionalId: appt.professional_id,
          dia: appt.appointment_date,
          hora: appt.appointment_time.slice(0, 5),
          duracion: duracionServicio(appt.services),
          excluirCitaId: appt.id,
        });
        if (!v.ok) {
          Alert.alert("Ese horario ya no está libre", v.motivo);
          return;
        }
      } catch (e) {
        Alert.alert("No se pudo cambiar el estado", mensajeError(e));
        return;
      }
    }
    try {
      exigirFilas(
        await supabase.from("appointments").update({ status }).eq("id", appt.id).select("id"),
        "No se pudo cambiar el estado de la cita",
      );
    } catch (e) {
      Alert.alert("No se pudo cambiar el estado", mensajeError(e));
      return;
    }
    await recargar();
  };

  const vigentes = datos && datos.dia === selected ? datos : null;
  const appts = vigentes?.citas ?? [];

  const cuerpo = () => {
    if (!professionalId) {
      return (
        <ErrorState
          title="No encontramos tu perfil"
          message="Tu cuenta no está vinculada a un profesional activo de este negocio. Reintenta o pídele al dueño que revise tu acceso."
          onRetry={reintentar}
        />
      );
    }
    if (error && !vigentes) return <ErrorState error={error} onRetry={recargar} />;
    if (!vigentes) {
      return (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={Colors.red} />
        </View>
      );
    }
    return (
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.red} />}
      >
        {!!error && (
          <TouchableOpacity onPress={recargar} style={[s.banner, { borderColor: "rgba(251,15,5,0.3)", backgroundColor: "rgba(251,15,5,0.06)" }]} accessibilityRole="button">
            <Ionicons name="cloud-offline-outline" size={15} color={Colors.red} />
            <Text style={[s.bannerText, { color: t.text }]}>No se pudo actualizar. {mensajeError(error)} Toca para reintentar.</Text>
          </TouchableOpacity>
        )}
        {appts.length === 0 ? (
          <Animated.View entering={FadeInDown.delay(100).duration(400)} style={[s.empty, Shadow.sm]}>
            <Ionicons name="calendar-outline" size={40} color={t.subtle} style={{ marginBottom: 12 }} />
            <Text style={s.emptyTitle}>Sin citas este día</Text>
            <Text style={s.emptySub}>
              {vigentes.agendaCompleta
                ? "No hay citas agendadas en el negocio para este día."
                : selected === hoy ? "No tienes citas programadas para hoy." : "No tienes citas programadas para este día."}
            </Text>
          </Animated.View>
        ) : (
          appts.map((a, i) => {
            const meta = STATUS_META[a.status];
            return (
              <Animated.View key={a.id} entering={i < 10 ? FadeInRight.delay(i * 70).duration(320) : undefined}>
                <TouchableOpacity
                  style={[s.row, Shadow.sm]}
                  onPress={() => setSelectedAppt(a)}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={`${fmt12(a.appointment_time)}, ${a.clients?.name ?? "Sin cliente"}, ${meta?.label ?? a.status}`}
                >
                  <View style={[s.timePill, { backgroundColor: Colors.red + "12" }]}>
                    <Text style={[s.timeText, { color: Colors.red }]}>{fmt12(a.appointment_time)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.clientName} numberOfLines={1}>{a.clients?.name ?? "Sin cliente"}</Text>
                    <Text style={s.serviceName} numberOfLines={1}>
                      {a.services?.name ?? "Sin servicio"}
                      {vigentes.agendaCompleta && a.professionals?.name ? ` · ${a.professionals.name.split(" ")[0]}` : ""}
                    </Text>
                  </View>
                  <View style={[s.badge, { backgroundColor: meta?.bg ?? t.chipBg }]}>
                    <Text style={[s.badgeText, { color: meta?.color ?? t.subtle }]}>{meta?.label ?? a.status}</Text>
                  </View>
                </TouchableOpacity>
              </Animated.View>
            );
          })
        )}
      </ScrollView>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={s.header}>
        <Animated.View entering={FadeInDown.duration(400)} style={{ flex: 1 }}>
          <MonoTag>{vigentes?.agendaCompleta ? "Agenda del negocio" : "Mi Agenda"}</MonoTag>
          <Text style={[s.headerTitle, { color: t.ink }]} numberOfLines={1}>{fmtDia(selected, "largo")}</Text>
        </Animated.View>
        {selected !== hoy && (
          <TouchableOpacity
            onPress={() => { setSelected(hoy); setSemana(inicioDeSemana(hoy)); }}
            style={[s.todayBtn, { borderColor: t.line, backgroundColor: t.cardSolid }]}
            accessibilityRole="button"
          >
            <Text style={[s.todayText, { color: t.text }]}>Hoy</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* El equipo también se entera: si el negocio no paga, se les bloquea */}
      <SubscriptionBanner style={{ marginHorizontal: 20, marginBottom: 12 }} />

      <SemanaStrip
        semana={semana}
        seleccionado={selected}
        hoy={hoy}
        onSeleccionar={setSelected}
        onCambiarSemana={setSemana}
      />

      {cuerpo()}

      <ApptDetailModal
        appt={selectedAppt}
        verPro={!!vigentes?.agendaCompleta}
        onClose={() => setSelectedAppt(null)}
        onStatusChange={handleStatusChange}
      />
    </SafeAreaView>
  );
}

function crearEstilos(t: ThemeColors) {
  return StyleSheet.create({
    header:       { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingTop: 14, paddingHorizontal: 20, paddingBottom: 14 },
    headerTitle:  { fontSize: 21, fontFamily: Fonts.bold, letterSpacing: -0.5, marginTop: 3, textTransform: "capitalize" },
    todayBtn:     { height: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, alignItems: "center", justifyContent: "center" },
    todayText:    { fontSize: 13, fontFamily: Fonts.bold },
    row:          { backgroundColor: t.cardSolid, borderRadius: Radius.md, padding: 14, flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10, borderWidth: 1, borderColor: t.line },
    timePill:     { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
    timeText:     { fontSize: 12.5, fontFamily: Fonts.bold },
    clientName:   { fontSize: 14, fontFamily: Fonts.semibold, color: t.text },
    serviceName:  { fontSize: 12, fontFamily: Fonts.regular, color: t.muted, marginTop: 2 },
    badge:        { borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 5 },
    badgeText:    { fontSize: 11, fontFamily: Fonts.semibold },
    empty:        { backgroundColor: t.cardSolid, borderRadius: Radius.xl, padding: 40, alignItems: "center", marginTop: 20, borderWidth: 1, borderColor: t.line },
    emptyTitle:   { fontSize: 16, fontFamily: Fonts.bold, color: t.text, marginBottom: 6 },
    emptySub:     { fontSize: 13, fontFamily: Fonts.regular, color: t.muted, textAlign: "center" },
    banner:       { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 12 },
    bannerText:   { flex: 1, fontSize: 12, fontFamily: Fonts.regular, lineHeight: 17 },
  });
}
