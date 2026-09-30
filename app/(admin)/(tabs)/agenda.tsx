import { useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, Alert,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { supabase } from "@/lib/supabase";
import { enviarCorreoCita } from "@/lib/correo-cita";
import { Colors, Fonts, Gradients, Radius } from "@/constants/theme";
import { useTheme, type ThemeColors } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { getActiveLocationId } from "@/lib/active-location";
import { exigirFilas, mensajeError, revisar, traerPorIds, traerTodo } from "@/lib/db";
import { fmtDia, hoyNegocio, inicioDeSemana } from "@/lib/tz";
import { useGuardRespuestas, useRecarga } from "@/lib/useRecarga";
import { reprogramarRecordatorioCita } from "@/lib/notifications";
import {
  bloqueosQueAplican, citasQueSeCruzan, duracionServicio, effectiveDayHours, leerHorarioNegocio,
  profesionalesDeLaSede, timeToMins, verificarCupo,
  type HorarioNegocio, type ProfesionalAgenda,
} from "@/lib/scheduling";
import { MonoTag } from "@/components/ui";
import ErrorState from "@/components/ErrorState";
import NewApptModal from "@/components/NewApptModal";
import ChargeSheet, { type LinkedAppt } from "@/components/ChargeSheet";
import SemanaStrip from "@/components/agenda/SemanaStrip";
import DayCalendar from "@/components/agenda/DayCalendar";
import ApptDetailModal from "@/components/agenda/ApptDetailModal";
import EditApptModal from "@/components/agenda/EditApptModal";
import { proColor, proInitials, type ApptAgenda, type BloqueoAgenda, type VentaCita } from "@/components/agenda/tipos";

/** Área táctil extra de los botones pequeños del encabezado (CAL-24). */
const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

// ─── Professional filter chip ─────────────────────────────────────────────────

function ProChip({ label, initials, color, active, onPress }: {
  label: string; initials?: string; color?: string; active: boolean; onPress: () => void;
}) {
  const { t } = useTheme();
  const c = color ?? Colors.red;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      style={[pc.chip, { backgroundColor: active ? c : t.cardSolid, borderColor: active ? c : t.line }]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      {initials ? (
        <View style={[pc.avatar, { backgroundColor: active ? "rgba(255,255,255,.25)" : c + "18" }]}>
          <Text style={[pc.avatarText, { color: active ? "white" : c }]}>{initials}</Text>
        </View>
      ) : (
        <Ionicons name="people-outline" size={13} color={active ? "white" : t.muted} />
      )}
      <Text style={[pc.label, { color: active ? "white" : t.muted }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const pc = StyleSheet.create({
  chip:       { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: Radius.full, paddingVertical: 7, paddingHorizontal: 12, borderWidth: 1, minHeight: 34 },
  avatar:     { width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 9, fontFamily: Fonts.bold },
  label:      { fontSize: 12, fontFamily: Fonts.semibold },
});

// ─── Datos del día ────────────────────────────────────────────────────────────

type DatosDia = {
  dia: string;
  citas: ApptAgenda[];
  bloqueos: BloqueoAgenda[];
  profesionales: ProfesionalAgenda[];
  horario: HorarioNegocio;
  /** Cobros por cita del día; null si no se pudieron leer (no se marca "por cobrar"). */
  ventas: Map<string, VentaCita> | null;
  /**
   * Sede que se está mirando, solo si el negocio tiene más de una: la agenda
   * se filtra por ella y sin el nombre a la vista parecía que faltaban citas
   * (ARQ-10). null con una sola sede o si no se pudo leer.
   */
  sede: { id: string; nombre: string } | null;
};

/**
 * Todo lo que necesita un día de la Agenda. Lanza ErrorDB si falla la parte
 * esencial: antes un corte de red se veía como "Sin citas este día" y el
 * dueño creía tener el día libre (AGE-X1).
 */
async function cargarDia(tenantId: string, dia: string): Promise<DatosDia> {
  // Misma sede que el panel web: allí la agenda se filtra por la sede seleccionada.
  const loc = await getActiveLocationId(tenantId);
  const [citas, prosRes, bloqRes, tenRes, sedesRes] = await Promise.all([
    traerTodo<ApptAgenda>((desde, hasta) => {
      let q = supabase.from("appointments")
        .select("id, appointment_date, appointment_time, status, service_id, client_id, professional_id, location_id, clients(name, phone), services(name, price, duration_minutes, duration_min), professionals(id, name), appointment_services(price)")
        .eq("tenant_id", tenantId)
        .eq("appointment_date", dia);
      if (loc) q = q.eq("location_id", loc);
      return q.order("appointment_time").order("id").range(desde, hasta) as unknown as PromiseLike<{ data: ApptAgenda[] | null; error: unknown }>;
    }, { contexto: "No se pudieron cargar las citas" }),
    supabase.from("professionals").select("id, name, role, schedule, location_id")
      .eq("tenant_id", tenantId).eq("is_active", true).order("name"),
    supabase.from("blocked_slots").select("id, start_time, end_time, professional_id, reason")
      .eq("tenant_id", tenantId).eq("blocked_date", dia).order("start_time"),
    supabase.from("tenants").select("settings").eq("id", tenantId).single(),
    // Mismo criterio que lib/active-location (sedes activas, la principal primero).
    supabase.from("locations").select("id, name").eq("tenant_id", tenantId).eq("is_active", true).order("created_at"),
  ]);
  const pros = (revisar(prosRes, "No se pudo cargar el equipo") ?? []) as ProfesionalAgenda[];
  const bloqueos = (revisar(bloqRes, "No se pudieron cargar las ausencias") ?? []) as BloqueoAgenda[];
  const tenant = revisar(tenRes, "No se pudo cargar el horario del negocio") as { settings?: unknown } | null;

  // Cobros de las citas del día, para distinguir "completada" de "por cobrar".
  let ventas: Map<string, VentaCita> | null = null;
  try {
    const filas = await traerPorIds<{ id: string; appointment_id: string | null; total: number }>(
      citas.map(c => c.id),
      (lote, desde, hasta) => supabase.from("pos_sales").select("id, appointment_id, total")
        .in("appointment_id", lote).order("id").range(desde, hasta),
    );
    ventas = new Map(filas.filter(v => v.appointment_id).map(v => [v.appointment_id!, { id: v.id, total: Number(v.total) || 0 }]));
  } catch {
    ventas = null;
  }

  // El nombre de la sede es solo informativo: si falla, la agenda se muestra igual.
  const sedes = (sedesRes.error ? [] : sedesRes.data ?? []) as { id: string; name: string | null }[];
  const activa = sedes.length > 1 ? sedes.find(x => x.id === loc) : undefined;

  return {
    dia,
    citas,
    bloqueos,
    profesionales: profesionalesDeLaSede(pros, loc),
    horario: leerHorarioNegocio(tenant?.settings),
    ventas,
    sede: activa ? { id: activa.id, nombre: activa.name?.trim() || "Sede sin nombre" } : null,
  };
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function AgendaScreen() {
  const { t } = useTheme();
  const s = useMemo(() => crearEstilos(t), [t]);
  const router = useRouter();
  const { tenantId } = useAuth();
  const { timezone, ready, tenant } = useTenant();
  const guard = useGuardRespuestas();

  const [selected, setSelected]       = useState(() => hoyNegocio(timezone));
  const [semana, setSemana]           = useState(() => inicioDeSemana(hoyNegocio(timezone)));
  const [datos, setDatos]             = useState<DatosDia | null>(null);
  const [error, setError]             = useState<unknown>(null);
  const [errorDia, setErrorDia]       = useState<string | null>(null);
  const [filterProId, setFilterProId] = useState<string | null>(null);
  const [refreshing, setRefreshing]   = useState(false);
  const [showNew, setShowNew]         = useState(false);
  const [detailAppt, setDetailAppt]   = useState<ApptAgenda | null>(null);
  const [editAppt, setEditAppt]       = useState<ApptAgenda | null>(null);
  const [chargeAppt, setChargeAppt]   = useState<LinkedAppt | null>(null);

  const { hoy, recargar } = useRecarga(async () => {
    if (!tenantId) return;
    // Solo la respuesta del último día pedido se pinta: antes, al tocar lunes
    // y martes seguidos, la respuesta tardía del lunes quedaba bajo el
    // encabezado del martes y se cobraba la cita equivocada (AGE-13 / ARQ-08).
    const turno = guard.nuevo();
    const dia = selected;
    try {
      const d = await cargarDia(tenantId, dia);
      if (!turno.vigente()) return;
      setDatos(d);
      setError(null);
      setErrorDia(null);
    } catch (e) {
      if (!turno.vigente()) return;
      setError(e);
      setErrorDia(dia);
    }
  }, [tenantId, timezone, selected], { timeZone: timezone, habilitado: !!tenantId && ready });

  // Si se estaba mirando "hoy" y cambia el día del negocio (medianoche, o
  // llegó la zona real del negocio), se sigue en el nuevo hoy.
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

  const irADia = (dia: string) => {
    setSelected(dia);
    setSemana(inicioDeSemana(dia));
  };

  // Datos del día seleccionado (nunca los de otro día bajo este encabezado).
  const vigentes = datos && datos.dia === selected ? datos : null;

  // Desde la campana del Panel: /agenda?fecha=YYYY-MM-DD&cita=<id> abre ese
  // día y, cuando carga, el detalle de la cita. Los parámetros se consumen
  // (se borran) para que volver a tocar el mismo aviso funcione otra vez.
  const params = useLocalSearchParams<{ fecha?: string; cita?: string }>();
  // La navegación de ESTA pantalla: router.setParams tocaría la ruta enfocada.
  const navigation = useNavigation<{ setParams: (p: { fecha?: string; cita?: string }) => void }>();
  const citaPorAbrir = useRef<{ dia: string; id: string } | null>(null);
  useEffect(() => {
    const fecha = typeof params.fecha === "string" ? params.fecha : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return;
    const cita = typeof params.cita === "string" ? params.cita : "";
    citaPorAbrir.current = cita ? { dia: fecha, id: cita } : null;
    setSelected(fecha);
    setSemana(inicioDeSemana(fecha));
    navigation.setParams({ fecha: undefined, cita: undefined });
  }, [params.fecha, params.cita, navigation]);
  useEffect(() => {
    const pedida = citaPorAbrir.current;
    if (!pedida || !vigentes || vigentes.dia !== pedida.dia) return;
    citaPorAbrir.current = null;
    // Si la cita no está (otra sede), se queda en el día.
    const cita = vigentes.citas.find(c => c.id === pedida.id);
    if (cita) setDetailAppt(cita);
  }, [vigentes]);
  const profesionales = vigentes?.profesionales ?? datos?.profesionales ?? [];
  const citas = vigentes?.citas ?? [];
  const visibles = filterProId ? citas.filter(a => a.professional_id === filterProId) : citas;
  const bloqueosVisibles = vigentes
    ? (filterProId
        ? bloqueosQueAplican(vigentes.bloqueos, filterProId)
        : vigentes.bloqueos.filter(b => !b.professional_id || profesionales.some(p => p.id === b.professional_id)))
    : [];
  const horariosDelDia = vigentes
    ? [
        effectiveDayHours(selected, vigentes.horario, null),
        ...(filterProId ? profesionales.filter(p => p.id === filterProId) : profesionales)
          .map(p => effectiveDayHours(selected, vigentes.horario, p.schedule)),
      ]
    : [];
  const cruzadas = citasQueSeCruzan(visibles.map(a => {
    const inicio = timeToMins(a.appointment_time.slice(0, 5));
    return { id: a.id, professionalId: a.professional_id, inicio, fin: inicio + duracionServicio(a.services), status: a.status };
  }));
  const activas = citas.filter(a => a.status !== "cancelled");

  // ── Cambio manual de estado ─────────────────────────────────────────────────
  const handleStatusChange = async (appt: ApptAgenda, status: string) => {
    if (!tenantId || status === appt.status) return;
    // Completar = cobrar: la única vía a "completada" es el cobro (D10).
    if (status === "completed") return;

    // Revalidar en la base que la cita no tenga cobro: el detalle pudo quedar
    // viejo (otro dispositivo o el web la cobraron mientras tanto).
    const venta = await supabase.from("pos_sales").select("id").eq("appointment_id", appt.id).limit(1);
    if (venta.error) {
      Alert.alert("No se pudo cambiar el estado", mensajeError(venta.error, "No se pudo revisar el cobro de la cita"));
      return;
    }
    if ((venta.data ?? []).length > 0) {
      Alert.alert(
        "Esta cita ya se cobró",
        "Para cambiar su estado, anula primero el cobro desde el historial de ventas.",
        [{ text: "Cancelar", style: "cancel" }, { text: "Ir al historial", onPress: () => router.push("/(admin)/pos-history") }],
      );
      return;
    }

    // Reactivar una cancelada o no-show: su hora pudo ocuparse (AGE-15).
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
          Alert.alert("Ese horario ya no está libre", `${v.motivo} Modifica la cita para elegir otra hora.`);
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

    // Correo de cancelación al cliente, como el calendario web. No se espera.
    if (status === "cancelled" && appt.status !== "cancelled") void enviarCorreoCita("cancellation", appt.id);

    // Recordatorio solo DESPUÉS de que el cambio se guardó: se cancela si ya
    // no está vigente (cancelada, no asistió) y se reprograma si se reactivó.
    reprogramarRecordatorioCita(tenantId, {
      id: appt.id,
      date: appt.appointment_date,
      time: appt.appointment_time,
      clientName: appt.clients?.name ?? null,
      serviceName: appt.services?.name ?? null,
      status,
    }, timezone).catch(() => {});

    await recargar();
  };

  const abrirCobro = (a: ApptAgenda) => {
    setChargeAppt({
      id: a.id, clientId: a.client_id, clientName: a.clients?.name ?? null, clientPhone: a.clients?.phone ?? null,
      serviceId: a.service_id, serviceName: a.services?.name ?? null, servicePrice: Number(a.services?.price ?? 0),
      locationId: a.location_id ?? null, time: a.appointment_time,
    });
    setDetailAppt(null);
  };

  const cargandoDia = !vigentes && !(error && errorDia === selected);
  // La sede no depende del día: mientras carga otro día se sigue mostrando.
  const sede = (vigentes ?? datos)?.sede ?? null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      {/* ── Header compacto ── */}
      <View style={s.header}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <MonoTag>Agenda</MonoTag>
          <Text style={[s.headerTitle, { color: t.ink }]}>{fmtDia(selected, "largo")}</Text>
          <Text style={[s.headerSub, { color: t.muted }]}>
            {vigentes ? (
              <>
                {activas.length} cita{activas.length !== 1 ? "s" : ""} · {citas.filter(a => a.status === "confirmed").length} confirmadas
                {cruzadas.size > 0
                  ? <Text style={{ color: "#d97706" }}> · {cruzadas.size} se cruzan</Text>
                  : null}
              </>
            ) : " "}
          </Text>
          {sede && (
            <TouchableOpacity
              onPress={() => router.push("/settings/locations")}
              style={[s.sedeChip, { borderColor: t.line, backgroundColor: t.cardSolid }]}
              activeOpacity={0.75}
              hitSlop={HIT_SLOP}
              accessibilityRole="button"
              accessibilityLabel={`Sede ${sede.nombre}. Cambiar de sede`}
            >
              <Ionicons name="location-outline" size={12} color={t.muted} />
              <Text style={[s.sedeText, { color: t.text }]} numberOfLines={1}>{sede.nombre}</Text>
              <Ionicons name="chevron-forward" size={12} color={t.subtle} />
            </TouchableOpacity>
          )}
        </View>
        {selected !== hoy && (
          <TouchableOpacity onPress={() => irADia(hoy)} style={[s.todayBtn, { borderColor: t.line, backgroundColor: t.cardSolid }]} accessibilityRole="button">
            <Text style={[s.todayText, { color: t.text }]}>Hoy</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={() => setShowNew(true)} activeOpacity={0.85} style={s.addBtnWrap} hitSlop={HIT_SLOP} accessibilityRole="button" accessibilityLabel="Nueva cita">
          <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.addBtn}>
            <Ionicons name="add" size={20} color="white" />
          </LinearGradient>
        </TouchableOpacity>
      </View>

      {/* ── Week strip ── */}
      <SemanaStrip
        semana={semana}
        seleccionado={selected}
        hoy={hoy}
        onSeleccionar={setSelected}
        onCambiarSemana={setSemana}
      />

      {/* ── Professional filter ── */}
      {profesionales.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.filterRow}
          style={[s.filterStrip, { borderBottomColor: t.line }]}
        >
          <ProChip label="Todos" active={filterProId === null} onPress={() => setFilterProId(null)} />
          {profesionales.map(p => (
            <ProChip
              key={p.id}
              label={p.name.split(" ")[0]}
              initials={proInitials(p.name)}
              color={proColor(p.id, profesionales)}
              active={filterProId === p.id}
              onPress={() => setFilterProId(prev => prev === p.id ? null : p.id)}
            />
          ))}
        </ScrollView>
      )}

      {vigentes?.horario.porDefecto && (
        <TouchableOpacity
          onPress={() => router.push("/settings/schedule")}
          style={[s.banner, { borderColor: "rgba(217,119,6,0.35)", backgroundColor: "rgba(217,119,6,0.08)" }]}
          accessibilityRole="link"
        >
          <Ionicons name="time-outline" size={15} color="#d97706" />
          <Text style={[s.bannerText, { color: t.text }]}>
            Aún no configuras tu horario: se ofrecen cupos de 8:00 AM a 7:00 PM. <Text style={{ color: Colors.red, fontFamily: Fonts.bold }}>Configurar</Text>
          </Text>
        </TouchableOpacity>
      )}

      {/* ── Timeline ── */}
      {tenantId && (
        <NewApptModal
          visible={showNew}
          onClose={() => setShowNew(false)}
          tenantId={tenantId}
          initialDate={selected}
          onSuccess={() => { recargar(); }}
        />
      )}

      <ApptDetailModal
        appt={detailAppt}
        onClose={() => setDetailAppt(null)}
        onCambiarEstado={handleStatusChange}
        onEditar={() => { setEditAppt(detailAppt); setDetailAppt(null); }}
        onCobrar={() => { if (detailAppt) abrirCobro(detailAppt); }}
        onIrAlHistorial={() => router.push("/(admin)/pos-history")}
      />

      {tenantId && (
        <ChargeSheet
          visible={!!chargeAppt}
          tenantId={tenantId}
          target={chargeAppt ? { kind: "appointment", appt: chargeAppt } : null}
          onClose={() => setChargeAppt(null)}
          onSaved={() => { recargar(); }}
          businessName={tenant?.name ?? null}
        />
      )}

      {tenantId && (
        <EditApptModal
          appt={editAppt}
          tenantId={tenantId}
          professionals={profesionales}
          onClose={() => setEditAppt(null)}
          onSaved={() => { setEditAppt(null); recargar(); }}
        />
      )}

      {error && errorDia === selected && !vigentes ? (
        // Falló la carga del día que se está mirando y no hay datos de ese día.
        <ErrorState error={error} onRetry={recargar} />
      ) : cargandoDia ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={Colors.red} />
        </View>
      ) : vigentes ? (
        <>
          {error && errorDia === selected && (
            // Falló una recarga del mismo día: se conserva lo que había y se avisa.
            <TouchableOpacity onPress={recargar} style={[s.banner, { borderColor: "rgba(251,15,5,0.3)", backgroundColor: "rgba(251,15,5,0.06)" }]} accessibilityRole="button">
              <Ionicons name="cloud-offline-outline" size={15} color={Colors.red} />
              <Text style={[s.bannerText, { color: t.text }]}>
                No se pudo actualizar la agenda. {mensajeError(error)} <Text style={{ color: Colors.red, fontFamily: Fonts.bold }}>Reintentar</Text>
              </Text>
            </TouchableOpacity>
          )}
          <DayCalendar
            key={selected}
            dia={selected}
            hoy={hoy}
            timezone={timezone}
            citas={visibles}
            bloqueos={bloqueosVisibles}
            profesionales={profesionales}
            horarios={horariosDelDia}
            ventas={vigentes.ventas}
            cruzadas={cruzadas}
            onPressAppt={setDetailAppt}
            onAddPress={() => setShowNew(true)}
            showPro={filterProId === null}
            refreshing={refreshing}
            onRefresh={onRefresh}
          />
        </>
      ) : null}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function crearEstilos(t: ThemeColors) {
  return StyleSheet.create({
    header:      { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10, paddingTop: 14, paddingHorizontal: 20, paddingBottom: 14 },
    headerTitle: { fontSize: 21, fontFamily: Fonts.bold, letterSpacing: -0.5, textTransform: "capitalize", marginTop: 3 },
    headerSub:   { fontSize: 12.5, fontFamily: Fonts.regular, marginTop: 3 },
    todayBtn:    { height: 38, paddingHorizontal: 14, borderRadius: 19, borderWidth: 1, alignItems: "center", justifyContent: "center" },
    todayText:   { fontSize: 13, fontFamily: Fonts.bold },
    addBtnWrap:  { borderRadius: 19, overflow: "hidden" },
    addBtn:      { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
    filterStrip: { backgroundColor: t.bg, borderBottomWidth: 1, maxHeight: 56 },
    filterRow:   { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
    banner:      { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginTop: 10, borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: 12, paddingVertical: 9 },
    bannerText:  { flex: 1, fontSize: 12, fontFamily: Fonts.regular, lineHeight: 17 },
    sedeChip:    { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", maxWidth: "100%", borderWidth: 1, borderRadius: Radius.full, paddingHorizontal: 9, paddingVertical: 4, marginTop: 7 },
    sedeText:    { flexShrink: 1, fontSize: 11.5, fontFamily: Fonts.semibold },
  });
}
