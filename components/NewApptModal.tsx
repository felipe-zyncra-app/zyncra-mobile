import { useState, useEffect, useMemo, useRef } from "react";
import {
  Modal, View, Text, TouchableOpacity, StyleSheet,
  ScrollView, TextInput, ActivityIndicator,
  KeyboardAvoidingView, Platform, Alert,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useRouter } from "expo-router";
import { supabase } from "@/lib/supabase";
import { Colors, Fonts, Gradients, Radius, Shadow } from "@/constants/theme";
import { useTheme, type ThemeColors } from "@/lib/theme";
import { useTenant } from "@/lib/tenant";
import { reprogramarRecordatorioCita } from "@/lib/notifications";
import {
  avisosDeHorario, cargarCatalogoAgenda, effectiveDayHours, esHorarioOcupado, filtrarServicios, mensajeErrorCita,
  minsToTime, profesionalesDeLaSede, servicioPorCodigo, timeToMins, verificarCupo,
  type CatalogoAgenda, type ProfesionalAgenda, type ServicioAgenda,
} from "@/lib/scheduling";
import { buscarClientePorTelefono, useClientSearch } from "@/lib/useClientSearch";
import { DEFAULT_COUNTRY_ISO, telefonoParaGuardar } from "@/lib/countries";
import { correoClienteObligatorio, validarCorreoCliente } from "@/lib/contacto";
import { fmt12, fmtMoneyFull, fmtTelefono, localDateStr } from "@/lib/format";
import { getActiveLocationId } from "@/lib/active-location";
import { ErrorDB, exigirFilas, mensajeError, nuevoId, revisar } from "@/lib/db";
import { fmtDia, hoyNegocio, inicioDeSemana, minutosDelDia } from "@/lib/tz";
import { useGuardRespuestas, useHoyNegocio } from "@/lib/useRecarga";
import ErrorState from "@/components/ErrorState";
import { IconButton } from "@/components/ui";
import SemanaStrip from "@/components/agenda/SemanaStrip";
import SelectorHora from "@/components/agenda/SelectorHora";
import { useCuposDelDia } from "@/components/agenda/useCupos";
import { confirmar } from "@/components/agenda/tipos";

type Client   = { id: string; name: string; phone: string };
type ApptField = { id: string; name: string; field_key: string; field_type: string; options: string[]; required: boolean };

interface Props {
  visible: boolean;
  onClose: () => void;
  tenantId: string;
  /**
   * Día con el que abre: 'YYYY-MM-DD' del negocio (preferido) o un Date de
   * picker / fechaDeDia(dia), del que se toma su fecha de calendario. Un día
   * pasado abre en hoy (AGE-25).
   */
  initialDate?: Date | string;
  onSuccess: () => void;
}

/** Área táctil extra de los botones pequeños (CAL-24). */
const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

const STEP_LABELS = [
  "Paso 1 · Profesional",
  "Paso 2 · Cliente",
  "Paso 3 · Servicio",
  "Paso 4 · Fecha y hora",
];

export default function NewApptModal({ visible, onClose, tenantId, initialDate, onSuccess }: Props) {
  const router = useRouter();
  const { t } = useTheme();
  const s = useMemo(() => crearEstilos(t), [t]);
  const { timezone } = useTenant();
  const hoy = useHoyNegocio(timezone);
  const guard = useGuardRespuestas();

  const [step, setStep]               = useState(0);
  const [loading, setLoading]         = useState(false);
  const [loadError, setLoadError]     = useState<unknown>(null);
  const [saving, setSaving]           = useState(false);

  const [catalogo, setCatalogo]       = useState<CatalogoAgenda | null>(null);
  const [sede, setSede]               = useState<string | null>(null);
  const [clients, setClients]         = useState<Client[]>([]);

  const [selectedPro, setSelectedPro]         = useState<ProfesionalAgenda | null>(null);
  const [clientSearch, setClientSearch]       = useState("");
  const [serviceQuery, setServiceQuery]       = useState("");
  const [isNewClient, setIsNewClient]         = useState(false);
  const [newClientName, setNewClientName]     = useState("");
  const [newClientPhone, setNewClientPhone]   = useState("");
  const [newClientEmail, setNewClientEmail]   = useState("");
  // Correo obligatorio al crear cliente (ver correoClienteObligatorio). Se
  // relee al abrir; si esa lectura falla se queda con lo último conocido.
  const [emailRequired, setEmailRequired]     = useState(true);
  const [apptFields, setApptFields]           = useState<ApptField[]>([]);
  const [fieldsError, setFieldsError]         = useState<unknown>(null);
  const [fieldValues, setFieldValues]         = useState<Record<string, string>>({});
  const [selectedClient, setSelectedClient]   = useState<Client | null>(null);
  const [selectedService, setSelectedService] = useState<ServicioAgenda | null>(null);
  const [selectedDay, setSelectedDay]         = useState(() => hoyNegocio(timezone));
  const [semana, setSemana]                   = useState(() => inicioDeSemana(hoyNegocio(timezone)));
  const [selectedTime, setSelectedTime]       = useState<string | null>(null);

  // Id de la cita generado al abrir: si el insert llegó pero la respuesta se
  // perdió, el reintento choca con su propia fila (23505) y se reconoce como
  // guardada en vez de duplicarla.
  const apptIdRef = useRef<string>(nuevoId());

  const cargar = async () => {
    const turno = guard.nuevo();
    setLoading(true);
    setLoadError(null);
    try {
      const [cat, loc, clis, ten] = await Promise.all([
        cargarCatalogoAgenda(tenantId),
        getActiveLocationId(tenantId),
        supabase.from("clients").select("id, name, phone").eq("tenant_id", tenantId).order("name").order("id").limit(150),
        supabase.from("tenants").select("settings").eq("id", tenantId).maybeSingle(),
      ]);
      const lista = revisar(clis, "No se pudieron cargar los clientes") ?? [];
      if (!turno.vigente()) return;
      if (!ten.error) {
        setEmailRequired(correoClienteObligatorio((ten.data as { settings?: Record<string, unknown> | null } | null)?.settings));
      }
      setCatalogo(cat);
      setSede(loc);
      setClients(lista.map((c: { id: string; name: string; phone: string | null }) => ({ ...c, phone: c.phone ?? "" })));
    } catch (e) {
      if (turno.vigente()) setLoadError(e);
    } finally {
      if (turno.vigente()) setLoading(false);
    }
  };

  useEffect(() => {
    if (!visible) return;
    const hoyAhora = hoyNegocio(timezone);
    // Un Date llega de un picker o de fechaDeDia(dia) (mediodía LOCAL de ese
    // día): se lee su fecha de calendario. Pasarlo por la zona del negocio lo
    // corría un día cuando el teléfono y el negocio están a 12 h o más.
    let base = typeof initialDate === "string" ? initialDate
      : initialDate instanceof Date && !Number.isNaN(initialDate.getTime()) ? localDateStr(initialDate)
      : hoyAhora;
    if (!base || base < hoyAhora) base = hoyAhora;
    apptIdRef.current = nuevoId();
    setStep(0);
    setSelectedPro(null);
    setSelectedClient(null);
    setSelectedService(null);
    setSelectedTime(null);
    setClientSearch("");
    setServiceQuery("");
    setNewClientName("");
    setNewClientPhone("");
    setNewClientEmail("");
    setIsNewClient(false);
    setFieldValues({});
    setSelectedDay(base);
    setSemana(inicioDeSemana(base));
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Campos personalizados del servicio (los mismos que captura la reserva online del web)
  const guardCampos = useGuardRespuestas();
  const servicioId = selectedService?.id ?? null;
  useEffect(() => {
    if (!servicioId) { setApptFields([]); setFieldValues({}); setFieldsError(null); return; }
    const turno = guardCampos.nuevo();
    supabase.from("custom_fields")
      .select("id, name, field_key, field_type, options, required")
      .eq("service_id", servicioId)
      .eq("active", true)
      .order("position")
      .then(({ data, error }) => {
        if (!turno.vigente()) return;
        if (error) { setFieldsError(error); setApptFields([]); return; }
        setFieldsError(null);
        setApptFields((data ?? []).map((f: any) => ({ ...f, options: Array.isArray(f.options) ? f.options : [] })));
        setFieldValues({});
      });
  }, [servicioId, guardCampos]);

  const profesionales = useMemo(
    () => profesionalesDeLaSede(catalogo?.profesionales ?? [], sede),
    [catalogo, sede],
  );
  const servicios = useMemo(() => (catalogo?.servicios ?? []).filter(x => x.activo), [catalogo]);
  const serviciosVisibles = useMemo(() => {
    const lista = filtrarServicios(servicios, serviceQuery);
    // El elegido no desaparece aunque el texto ya no lo nombre.
    return selectedService && !lista.some(x => x.id === selectedService.id) ? [selectedService, ...lista] : lista;
  }, [servicios, serviceQuery, selectedService]);
  const buscarServicio = (v: string) => {
    setServiceQuery(v);
    // Un código exacto (el que se le asigna en el admin) elige el servicio solo.
    const exacto = servicioPorCodigo(servicios, v);
    if (exacto) setSelectedService(exacto);
  };

  const cupos = useCuposDelDia({
    tenantId,
    profesional: selectedPro,
    duracion: selectedService?.duracion ?? null,
    dia: selectedDay,
    horario: catalogo?.horario ?? null,
    intervalo: catalogo?.intervalo ?? 30,
    habilitado: visible && step === 3,
    // Si un intento anterior sí guardó (se perdió la respuesta), su propia
    // fila no debe ocupar el cupo que se va a reintentar.
    excluirCitaId: apptIdRef.current,
    hoy,
    timezone,
  });

  // Al cambiar de día o recargar, la hora elegida deja de valer.
  useEffect(() => { setSelectedTime(null); }, [selectedDay, selectedPro?.id, selectedService?.id]);

  // Con búsqueda activa se consulta el servidor: la lista local solo tiene 150 clientes
  const serverClients = useClientSearch(tenantId, clientSearch);
  const filteredClients = serverClients ?? clients.filter(c =>
    c.name.toLowerCase().includes(clientSearch.toLowerCase()) ||
    c.phone.includes(clientSearch)
  );

  // Teléfono del cliente nuevo: obligatorio (clients.phone es NOT NULL y
  // UNIQUE por negocio, ESQ-13). Se normaliza igual que la pestaña Clientes.
  // Sin selector de país aquí: Colombia por defecto, y "+52…" respeta el país escrito.
  const telNuevo = newClientPhone.trim() ? telefonoParaGuardar(DEFAULT_COUNTRY_ISO, newClientPhone) : null;
  const telNuevoValido = !!telNuevo?.valido;
  // Correo del cliente nuevo: si se escribe, siempre tiene que ser válido;
  // vacío solo vale donde es opcional.
  const correoNuevo = newClientEmail.trim();
  const correoNuevoValido = correoNuevo ? validarCorreoCliente(correoNuevo).ok : !emailRequired;

  const clientName = isNewClient ? newClientName.trim() : (selectedClient?.name ?? "");
  const canStep0   = selectedPro !== null;
  const canStep1   = isNewClient ? newClientName.trim().length >= 2 && telNuevoValido && correoNuevoValido : selectedClient !== null;
  const canStep2   = selectedService !== null;
  const requiredFieldsOk = apptFields.every(f => !f.required || (fieldValues[f.id] ?? "").trim().length > 0);
  const canSave    = selectedTime !== null && requiredFieldsOk && selectedDay >= hoy;
  const stepCanProceed = [canStep0, canStep1, canStep2, canSave];

  const horaFueraDeGrilla = selectedTime !== null && !cupos.cupos.includes(selectedTime);
  const avisosHora = (() => {
    if (!selectedTime || !selectedService || !horaFueraDeGrilla) return [];
    const avisos = avisosDeHorario(cupos.horarioDia, selectedTime, selectedService.duracion);
    if (selectedDay === hoy && timeToMins(selectedTime) < minutosDelDia(new Date(), timezone)) {
      avisos.push("Esa hora de hoy ya pasó.");
    }
    return avisos;
  })();

  /**
   * Cliente nuevo → id. Reutiliza el que ya tenga ese teléfono (con
   * confirmación) en vez de insertar otro: clients.phone es UNIQUE por negocio.
   * Devuelve null si el usuario no confirma o si ya se le explicó el problema.
   */
  const resolverClienteNuevo = async (): Promise<Client | null> => {
    const tel = telefonoParaGuardar(DEFAULT_COUNTRY_ISO, newClientPhone);
    if (!tel) {
      Alert.alert("Falta el teléfono", "Escribe el teléfono del cliente para crearlo.");
      return null;
    }
    if (!tel.valido) {
      Alert.alert("Teléfono no válido", "Revisa el número. Si es de otro país, escríbelo con el indicativo (por ejemplo +52…).");
      return null;
    }
    // Vacío se guarda como NULL, nunca "": el cron y la confirmación miran
    // `email` a secas y un "" no debe contar como correo.
    let email: string | null = null;
    if (newClientEmail.trim()) {
      const check = validarCorreoCliente(newClientEmail);
      if (!check.ok) {
        Alert.alert("Correo no válido", emailRequired
          ? "Revisa el correo: no parece válido (ej. nombre@gmail.com)."
          : "Revisa el correo (ej. nombre@gmail.com) o déjalo vacío: es opcional.");
        return null;
      }
      email = check.valor ?? null;
    } else if (emailRequired) {
      Alert.alert("Falta el correo", "Escribe el correo del cliente: ahí le llegan la confirmación y el recordatorio.");
      return null;
    }
    const ofrecerExistente = async (c: Client) => {
      const usar = await confirmar(
        "Ese teléfono ya está registrado",
        `Pertenece a ${c.name}. ¿Agendar la cita a su nombre?`,
        `Usar ${c.name.split(" ")[0]}`,
      );
      return usar ? c : null;
    };
    const existente = await buscarClientePorTelefono(tenantId, tel.phone, tel.countryCode);
    if (existente) return ofrecerExistente(existente);

    const { data, error } = await supabase
      .from("clients")
      .insert({ tenant_id: tenantId, name: newClientName.trim(), phone: tel.phone, phone_country_code: tel.countryCode, email })
      .select("id, name, phone")
      .single();
    if (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") {
        // Otra persona lo creó entre la búsqueda y el insert.
        const otra = await buscarClientePorTelefono(tenantId, tel.phone, tel.countryCode);
        if (otra) return ofrecerExistente(otra);
        // Chocó con un formato del número que la búsqueda no cubre: antes
        // salía un mensaje genérico que parecía de conexión.
        Alert.alert("Ese teléfono ya está registrado", "Ya hay un cliente con ese número. Búscalo en «Existente».");
        return null;
      }
      if (code === "23502") {
        Alert.alert("Falta el teléfono", "Escribe el teléfono del cliente para crearlo.");
        return null;
      }
      throw new ErrorDB(error, "No se pudo crear el cliente");
    }
    return data as Client;
  };

  const handleSave = async () => {
    if (!canSave || !selectedService || !selectedPro || !selectedTime || saving) return;
    if (selectedDay < hoy) {
      Alert.alert("Fecha pasada", "No se pueden agendar citas en días que ya pasaron.");
      return;
    }
    if (avisosHora.length > 0) {
      const seguir = await confirmar("¿Agendar a esta hora?", avisosHora.join("\n"), "Agendar igual");
      if (!seguir) return;
    }
    setSaving(true);
    try {
      const apptId = apptIdRef.current;
      // Justo antes de guardar: el cupo pudo ocuparse (otra cita o una
      // ausencia cargada en el web) mientras se completaba el formulario.
      // Se excluye la propia cita: si un intento anterior llegó a guardarse y
      // solo se perdió la respuesta, el reintento no debe chocar consigo mismo.
      let v;
      try {
        v = await verificarCupo({
          tenantId, professionalId: selectedPro.id, dia: selectedDay, hora: selectedTime, duracion: selectedService.duracion,
          excluirCitaId: apptId,
        });
      } catch (e) {
        Alert.alert("No se pudo verificar el horario", mensajeError(e));
        return;
      }
      if (!v.ok) {
        Alert.alert("Horario no disponible", v.motivo);
        cupos.recargar();
        return;
      }

      let clientId = selectedClient?.id ?? null;
      // Nombre real del cliente de la cita (si se reutilizó uno existente por
      // su teléfono, es el suyo y no el que se escribió).
      let nombreCliente = clientName;
      if (isNewClient) {
        let cli: Client | null;
        try {
          cli = await resolverClienteNuevo();
        } catch (e) {
          Alert.alert("No se pudo crear el cliente", mensajeError(e));
          return;
        }
        if (!cli) return;
        // Si la cita falla después, el reintento usa este cliente y no crea
        // otro con el mismo teléfono (AGE-17).
        setSelectedClient(cli);
        setIsNewClient(false);
        clientId = cli.id;
        nombreCliente = cli.name;
      }

      // Lo que el usuario eligió (también sirve para corregir la fila de un
      // intento anterior). Tipado con columnas reales: con el cliente tipado
      // (CAL-26) un nombre mal escrito no compila.
      // La sede es la del profesional elegido; si no tiene, la activa. Con la
      // sede activa a secas, un profesional de otra sede quedaba con la cita
      // en la sede equivocada (AGE-16).
      const locationId = selectedPro.location_id ?? sede;
      const elegido: {
        service_id: string; professional_id: string; appointment_date: string; appointment_time: string;
        client_id?: string; location_id?: string;
      } = {
        service_id:       selectedService.id,
        professional_id:  selectedPro.id,
        appointment_date: selectedDay,
        appointment_time: `${selectedTime}:00`,
      };
      if (clientId) elegido.client_id = clientId;
      if (locationId) elegido.location_id = locationId;
      const payload = { ...elegido, id: apptId, tenant_id: tenantId, status: "pending" };

      const { error: apptError } = await supabase.from("appointments").insert(payload);
      if (apptError) {
        let yaGuardada = false;
        if (esHorarioOcupado(apptError)) {
          const { data: propia } = await supabase.from("appointments").select("id").eq("id", apptId).maybeSingle();
          yaGuardada = !!propia;
        }
        if (!yaGuardada) {
          Alert.alert("No se pudo guardar la cita", mensajeErrorCita(apptError));
          if (esHorarioOcupado(apptError)) cupos.recargar();
          return;
        }
        // La fila de un intento anterior ya existe, pero el usuario pudo
        // cambiar la hora, el día o el servicio antes de reintentar: se deja
        // con lo que eligió ahora (el cupo nuevo ya se verificó arriba).
        try {
          exigirFilas(
            await supabase.from("appointments").update(elegido).eq("id", apptId).select("id"),
            "No se pudo guardar la cita",
          );
        } catch (e) {
          Alert.alert("No se pudo guardar la cita", mensajeErrorCita(e));
          if (esHorarioOcupado(e)) cupos.recargar();
          return;
        }
      }

      // Valores de los campos del servicio — mismo destino que la reserva online (client_field_values)
      if (clientId && apptFields.length > 0) {
        const upserts = apptFields
          .filter(f => (fieldValues[f.id] ?? "").trim())
          .map(f => ({ tenant_id: tenantId, client_id: clientId, field_id: f.id, field_key: f.field_key, value: fieldValues[f.id].trim() }));
        if (upserts.length > 0) {
          const { error } = await supabase.from("client_field_values").upsert(upserts, { onConflict: "client_id,field_id" });
          if (error) {
            Alert.alert("Cita guardada", `La cita quedó agendada, pero no se guardaron los datos adicionales. ${mensajeError(error)}`);
          }
        }
      }

      // Aviso en el teléfono del dueño, en la hora del negocio.
      reprogramarRecordatorioCita(tenantId, {
        id: apptId,
        date: selectedDay,
        time: `${selectedTime}:00`,
        clientName: nombreCliente || "Cliente",
        serviceName: selectedService.name,
        status: "pending",
      }, timezone).catch(() => {});

      onSuccess();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const irAConfigurarHorario = () => {
    onClose();
    router.push("/settings/schedule");
  };

  const diaCerrado = (d: string) =>
    !!selectedPro && !!catalogo && !effectiveDayHours(d, catalogo.horario, selectedPro.schedule).open;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>

        {/* Header */}
        <View style={[s.header, { backgroundColor: "#0C0C14" }]}>
          <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3 }} />
          <View style={s.headerRow}>
            <IconButton
              icon={step === 0 ? "close" : "arrow-back"}
              label={step === 0 ? "Cerrar" : "Paso anterior"}
              onPress={step === 0 ? onClose : () => setStep(p => p - 1)}
              tone="plain"
              size={20}
              color="white"
              style={s.backBtn}
            />
            <View style={{ alignItems: "center" }}>
              <Text style={s.headerTitle}>Nueva cita</Text>
              <Text style={s.headerSub}>{STEP_LABELS[step]}</Text>
            </View>
            <View style={{ width: 40 }} />
          </View>
          <View style={s.progressRow}>
            {STEP_LABELS.map((_, i) => (
              <View key={i} style={[s.progressDot, step >= i && s.progressActive]} />
            ))}
          </View>
        </View>

        {loading ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator color={Colors.red} size="large" />
          </View>
        ) : loadError ? (
          <ErrorState error={loadError} onRetry={cargar} />
        ) : (
          <>
            {/* ── STEP 0: PROFESSIONAL ── */}
            {step === 0 && (
              <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 120 }}>
                {profesionales.length === 0 ? (
                  <View style={[s.card, { alignItems: "center", paddingVertical: 40 }, Shadow.sm]}>
                    <Text style={{ fontSize: 36, marginBottom: 12 }}>👷</Text>
                    <Text style={s.emptyTitle}>Sin profesionales</Text>
                    <Text style={s.emptySub}>Agrega el equipo en Ajustes → Equipo de trabajo</Text>
                  </View>
                ) : (
                  profesionales.map((pro, i) => (
                    <Animated.View key={pro.id} entering={i < 10 ? FadeInDown.delay(i * 55).duration(300) : undefined}>
                      <TouchableOpacity
                        style={[s.proCard, Shadow.sm, selectedPro?.id === pro.id && s.cardActive]}
                        onPress={() => setSelectedPro(pro)}
                        activeOpacity={0.75}
                        accessibilityRole="button"
                        accessibilityState={{ selected: selectedPro?.id === pro.id }}
                      >
                        <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.proAvatar}>
                          <Text style={s.proAvatarText}>{(pro.name[0] ?? "?").toUpperCase()}</Text>
                        </LinearGradient>
                        <View style={{ flex: 1 }}>
                          <Text style={[s.proName, selectedPro?.id === pro.id && { color: Colors.red }]}>{pro.name}</Text>
                          {!!pro.role && <Text style={s.proRole}>{pro.role}</Text>}
                        </View>
                        {selectedPro?.id === pro.id && (
                          <View style={s.check}><Text style={{ color: "white", fontSize: 11 }}>✓</Text></View>
                        )}
                      </TouchableOpacity>
                    </Animated.View>
                  ))
                )}
              </ScrollView>
            )}

            {/* ── STEP 1: CLIENT ── */}
            {step === 1 && (
              <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
                <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
                  <View style={[s.toggleRow, Shadow.sm]}>
                    <TouchableOpacity style={[s.toggleBtn, !isNewClient && s.toggleActive]} onPress={() => setIsNewClient(false)} activeOpacity={0.8} accessibilityRole="button" accessibilityState={{ selected: !isNewClient }}>
                      <Text style={[s.toggleText, !isNewClient && s.toggleTextActive]}>Existente</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[s.toggleBtn, isNewClient && s.toggleActive]} onPress={() => setIsNewClient(true)} activeOpacity={0.8} accessibilityRole="button" accessibilityState={{ selected: isNewClient }}>
                      <Text style={[s.toggleText, isNewClient && s.toggleTextActive]}>Nuevo cliente</Text>
                    </TouchableOpacity>
                  </View>

                  {isNewClient ? (
                    <View style={[s.card, Shadow.sm]}>
                      <Text style={s.fieldLabel}>Nombre</Text>
                      <TextInput
                        style={s.input}
                        value={newClientName}
                        onChangeText={setNewClientName}
                        placeholder="Ej: Juan García"
                        placeholderTextColor={t.subtle}
                        autoFocus
                      />
                      <Text style={[s.fieldLabel, { marginTop: 14 }]}>Teléfono</Text>
                      <TextInput
                        style={[s.input, !!newClientPhone.trim() && !telNuevoValido && { borderColor: Colors.red }]}
                        value={newClientPhone}
                        onChangeText={setNewClientPhone}
                        placeholder="Ej: 300 123 4567"
                        placeholderTextColor={t.subtle}
                        keyboardType="phone-pad"
                      />
                      <Text style={[s.hint, !!newClientPhone.trim() && !telNuevoValido && { color: Colors.red }]}>
                        {newClientPhone.trim() && !telNuevoValido
                          ? "Número no válido. Si es de otro país, escríbelo con el indicativo (+52…)."
                          : telNuevoValido
                            ? `Se guardará como ${fmtTelefono(telNuevo!.phone, { indicativo: telNuevo!.countryCode })}`
                            : "Obligatorio: con él se identifica al cliente y se le envían los recordatorios."}
                      </Text>
                      <Text style={[s.fieldLabel, { marginTop: 14 }]}>{emailRequired ? "Correo" : "Correo (opcional)"}</Text>
                      <TextInput
                        style={[s.input, !!correoNuevo && !correoNuevoValido && { borderColor: Colors.red }]}
                        value={newClientEmail}
                        onChangeText={setNewClientEmail}
                        placeholder="Ej: juan@gmail.com"
                        placeholderTextColor={t.subtle}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                      {!!correoNuevo && !correoNuevoValido ? (
                        <Text style={[s.hint, { color: Colors.red }]}>
                          {emailRequired ? "Correo no válido (ej. nombre@gmail.com)." : "Correo no válido. Corrígelo o déjalo vacío."}
                        </Text>
                      ) : null}
                    </View>
                  ) : (
                    <>
                      <View style={[s.searchBar, Shadow.sm]}>
                        <Text style={{ fontSize: 15, color: t.subtle }}>🔍</Text>
                        <TextInput
                          style={s.searchInput}
                          value={clientSearch}
                          onChangeText={setClientSearch}
                          placeholder="Buscar por nombre o teléfono..."
                          placeholderTextColor={t.subtle}
                        />
                        {clientSearch.length > 0 && (
                          <TouchableOpacity onPress={() => setClientSearch("")} accessibilityRole="button" accessibilityLabel="Borrar búsqueda" hitSlop={HIT_SLOP}>
                            <Text style={{ color: t.subtle, fontSize: 16 }}>✕</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                      {filteredClients.length === 0 ? (
                        <View style={[s.card, { alignItems: "center", paddingVertical: 36 }, Shadow.sm]}>
                          <Text style={{ fontSize: 36, marginBottom: 10 }}>👤</Text>
                          <Text style={s.emptyTitle}>Sin clientes</Text>
                          <Text style={s.emptySub}>Cambia a "Nuevo cliente" para continuar</Text>
                        </View>
                      ) : (
                        filteredClients.map(c => (
                          <TouchableOpacity
                            key={c.id}
                            style={[s.clientRow, Shadow.sm, selectedClient?.id === c.id && s.cardActive]}
                            onPress={() => setSelectedClient(c)}
                            activeOpacity={0.75}
                            accessibilityRole="button"
                            accessibilityState={{ selected: selectedClient?.id === c.id }}
                          >
                            <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.avatarGrad}>
                              <Text style={s.avatarText}>{(c.name[0] ?? "?").toUpperCase()}</Text>
                            </LinearGradient>
                            <View style={{ flex: 1 }}>
                              <Text style={s.clientName}>{c.name}</Text>
                              <Text style={s.clientPhone}>{fmtTelefono(c.phone)}</Text>
                            </View>
                            {selectedClient?.id === c.id && (
                              <View style={s.check}><Text style={{ color: "white", fontSize: 11 }}>✓</Text></View>
                            )}
                          </TouchableOpacity>
                        ))
                      )}
                    </>
                  )}
                </ScrollView>
              </KeyboardAvoidingView>
            )}

            {/* ── STEP 2: SERVICE ── */}
            {step === 2 && (
              <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 120 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
                {servicios.length > 0 && (
                  <View style={[s.searchBar, Shadow.sm]}>
                    <Text style={{ fontSize: 15, color: t.subtle }}>🔍</Text>
                    <TextInput
                      style={s.searchInput}
                      value={serviceQuery}
                      onChangeText={buscarServicio}
                      placeholder="Código o nombre (ej. 101)"
                      placeholderTextColor={t.subtle}
                      autoCorrect={false}
                      autoCapitalize="none"
                      returnKeyType="search"
                      accessibilityLabel="Buscar servicio por código o nombre"
                    />
                    {serviceQuery.length > 0 && (
                      <TouchableOpacity onPress={() => setServiceQuery("")} accessibilityRole="button" accessibilityLabel="Borrar búsqueda" hitSlop={HIT_SLOP}>
                        <Text style={{ color: t.subtle, fontSize: 16 }}>✕</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
                {servicios.length > 0 && serviciosVisibles.length === 0 && (
                  <View style={[s.card, { alignItems: "center", paddingVertical: 32 }, Shadow.sm]}>
                    <Text style={s.emptyTitle}>Ningún servicio coincide</Text>
                    <Text style={s.emptySub}>Revisa el código o busca por nombre</Text>
                  </View>
                )}
                {servicios.length === 0 ? (
                  <View style={[s.card, { alignItems: "center", paddingVertical: 40 }, Shadow.sm]}>
                    <Text style={{ fontSize: 40, marginBottom: 12 }}>✂️</Text>
                    <Text style={s.emptyTitle}>Sin servicios</Text>
                    <Text style={s.emptySub}>Agrega servicios desde Ajustes para poder agendar</Text>
                  </View>
                ) : (
                  serviciosVisibles.map((svc, i) => (
                    <Animated.View key={svc.id} entering={i < 10 ? FadeInDown.delay(i * 55).duration(300) : undefined}>
                      <TouchableOpacity
                        style={[s.svcCard, Shadow.sm, selectedService?.id === svc.id && s.cardActive]}
                        onPress={() => setSelectedService(svc)}
                        activeOpacity={0.75}
                        accessibilityRole="button"
                        accessibilityState={{ selected: selectedService?.id === svc.id }}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={[s.svcName, selectedService?.id === svc.id && { color: Colors.red }]}>
                            {svc.code ? <Text style={s.svcCode}>{svc.code} · </Text> : null}{svc.name}
                          </Text>
                          <Text style={s.svcMeta}>⏱ {svc.duracion} min</Text>
                        </View>
                        <View style={{ alignItems: "flex-end", gap: 6 }}>
                          <Text style={s.svcPrice}>{fmtMoneyFull(svc.price)}</Text>
                          {selectedService?.id === svc.id && (
                            <View style={s.check}><Text style={{ color: "white", fontSize: 11 }}>✓</Text></View>
                          )}
                        </View>
                      </TouchableOpacity>
                    </Animated.View>
                  ))
                )}
              </ScrollView>
            )}

            {/* ── STEP 3: DATE + AVAILABLE SLOTS ── */}
            {step === 3 && (
              <ScrollView contentContainerStyle={{ paddingBottom: 130 }} keyboardShouldPersistTaps="handled">
                <SemanaStrip
                  semana={semana}
                  seleccionado={selectedDay}
                  hoy={hoy}
                  onSeleccionar={setSelectedDay}
                  onCambiarSemana={setSemana}
                  deshabilitado={d => d < hoy || diaCerrado(d)}
                  cerrado={d => d >= hoy && diaCerrado(d)}
                />

                <View style={{ paddingHorizontal: 20, marginTop: 16 }}>
                  {selectedService && (
                    <View style={s.durationNote}>
                      <Text style={s.durationNoteText}>
                        {fmtDia(selectedDay, "largo")}  ·  {selectedService.name}  ·  ⏱ {selectedService.duracion} min
                      </Text>
                    </View>
                  )}

                  <SelectorHora
                    estado={cupos.estado}
                    error={cupos.error}
                    onReintentar={cupos.recargar}
                    cupos={cupos.cupos}
                    ocupados={cupos.ocupados}
                    seleccionada={selectedTime}
                    onSeleccionar={setSelectedTime}
                    bloqueos={cupos.bloqueos}
                    avisoHora={avisosHora.length ? avisosHora.join(" ") : null}
                    mensajeCerrado={selectedPro?.schedule ? `${selectedPro.name} no atiende este día.` : "El negocio no atiende este día."}
                    horarioPorDefecto={catalogo?.horario.porDefecto}
                    onConfigurarHorario={irAConfigurarHorario}
                  />

                  {!!fieldsError && (
                    <Text style={[s.hint, { color: Colors.red, marginTop: 12 }]}>
                      No se pudieron cargar los datos adicionales del servicio. {mensajeError(fieldsError)}
                    </Text>
                  )}

                  {apptFields.length > 0 && selectedTime !== null && (
                    <View style={[s.card, Shadow.sm, { marginTop: 18 }]}>
                      <Text style={s.fieldLabel}>Datos de la cita</Text>
                      {apptFields.map(f => (
                        <View key={f.id} style={{ marginTop: 10 }}>
                          <Text style={s.svcMeta}>{f.name}{f.required ? " *" : ""}</Text>
                          {f.field_type === "select" && f.options.length > 0 ? (
                            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
                              {f.options.map(opt => {
                                const on = fieldValues[f.id] === opt;
                                return (
                                  <TouchableOpacity
                                    key={opt}
                                    style={[s.optChip, on && { backgroundColor: Colors.red, borderColor: Colors.red }]}
                                    onPress={() => setFieldValues(v => ({ ...v, [f.id]: v[f.id] === opt ? "" : opt }))}
                                    activeOpacity={0.75}
                                  >
                                    <Text style={[s.optChipText, on && { color: "white" }]}>{opt}</Text>
                                  </TouchableOpacity>
                                );
                              })}
                            </View>
                          ) : (
                            <TextInput
                              style={[s.input, { marginTop: 6 }]}
                              value={fieldValues[f.id] ?? ""}
                              onChangeText={txt => setFieldValues(v => ({ ...v, [f.id]: txt }))}
                              placeholder={f.name}
                              placeholderTextColor={t.subtle}
                              keyboardType={f.field_type === "number" ? "numeric" : "default"}
                            />
                          )}
                        </View>
                      ))}
                    </View>
                  )}

                  {canSave && selectedService && selectedPro && (
                    <Animated.View entering={FadeInDown.duration(300)} style={[s.summary, Shadow.md]}>
                      <Text style={s.summaryTitle}>Resumen de la cita</Text>
                      <SummaryRow s={s} label="Profesional" value={selectedPro.name} />
                      <SummaryRow s={s} label="Cliente"     value={clientName} />
                      <SummaryRow s={s} label="Servicio"    value={selectedService.name} />
                      <SummaryRow s={s} label="Duración"    value={`${selectedService.duracion} min`} />
                      <SummaryRow s={s} label="Fecha"       value={fmtDia(selectedDay, "largo")} />
                      <SummaryRow s={s} label="Hora"        value={`${fmt12(selectedTime!)} – ${fmt12(minsToTime(timeToMins(selectedTime!) + selectedService.duracion))}`} />
                      <SummaryRow s={s} label="Valor"       value={fmtMoneyFull(selectedService.price)} highlight />
                    </Animated.View>
                  )}
                </View>
              </ScrollView>
            )}

            {/* Bottom bar */}
            <View style={s.bottomBar}>
              {step < 3 ? (
                <TouchableOpacity
                  style={[s.btn, !stepCanProceed[step] && { opacity: 0.4 }]}
                  onPress={() => setStep(p => p + 1)}
                  disabled={!stepCanProceed[step]}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                >
                  <View style={s.btnGrad}>
                    <Text style={s.btnText}>Siguiente →</Text>
                  </View>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[s.btn, (!canSave || saving) && { opacity: 0.4 }]}
                  onPress={handleSave}
                  disabled={!canSave || saving}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                >
                  <View style={s.btnGrad}>
                    {saving
                      ? <ActivityIndicator color="white" />
                      : <Text style={s.btnText}>✓  Confirmar cita</Text>
                    }
                  </View>
                </TouchableOpacity>
              )}
            </View>
          </>
        )}
      </SafeAreaView>
    </Modal>
  );
}

function SummaryRow({ s, label, value, highlight }: { s: Estilos; label: string; value: string; highlight?: boolean }) {
  return (
    <View style={s.summaryRow}>
      <Text style={s.summaryLabel}>{label}</Text>
      <Text style={[s.summaryValue, highlight && { color: Colors.red, fontFamily: Fonts.bold }]}>{value}</Text>
    </View>
  );
}

type Estilos = ReturnType<typeof crearEstilos>;

function crearEstilos(t: ThemeColors) {
  const card = { backgroundColor: t.cardSolid, borderWidth: 1, borderColor: t.line };
  return StyleSheet.create({
    header:        { paddingTop: 16, paddingHorizontal: 20, paddingBottom: 18 },
    headerRow:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
    backBtn:       { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,.2)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.3)" },
    headerTitle:   { fontSize: 18, fontFamily: Fonts.bold, color: "white" },
    headerSub:     { fontSize: 12, color: "rgba(255,255,255,.75)", fontFamily: Fonts.regular, marginTop: 2 },
    progressRow:   { flexDirection: "row", gap: 6 },
    progressDot:   { height: 4, flex: 1, borderRadius: 2, backgroundColor: "rgba(255,255,255,.25)" },
    progressActive:{ backgroundColor: "rgba(255,255,255,.95)" },

    cardActive:    { borderColor: Colors.red, backgroundColor: "rgba(251,15,5,0.08)" },

    // Professional picker
    proCard:       { flexDirection: "row", alignItems: "center", ...card, borderRadius: Radius.lg, padding: 14, marginBottom: 10, gap: 14 },
    proAvatar:     { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
    proAvatarText: { color: "white", fontSize: 16, fontFamily: Fonts.bold },
    proName:       { fontSize: 14, fontFamily: Fonts.semibold, color: t.text, marginBottom: 2 },
    proRole:       { fontSize: 12, fontFamily: Fonts.regular, color: t.muted },

    // Client picker
    toggleRow:       { flexDirection: "row", ...card, borderRadius: Radius.lg, padding: 4, marginBottom: 16 },
    toggleBtn:       { flex: 1, paddingVertical: 10, borderRadius: Radius.md, alignItems: "center" },
    toggleActive:    { backgroundColor: Colors.red },
    toggleText:      { fontSize: 13, fontFamily: Fonts.semibold, color: t.muted },
    toggleTextActive:{ color: "white" },

    card:       { ...card, borderRadius: Radius.lg, padding: 16, marginBottom: 12 },
    fieldLabel: { fontSize: 11, fontFamily: Fonts.bold, color: t.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.6 },
    input:      { fontSize: 15, fontFamily: Fonts.semibold, color: t.text, backgroundColor: t.inputBg, borderWidth: 1.5, borderColor: t.inputBorder, borderRadius: Radius.md, padding: 12 },
    hint:       { fontSize: 11.5, fontFamily: Fonts.regular, color: t.subtle, marginTop: 6, lineHeight: 16 },

    svcCode:     { fontFamily: Fonts.bold, color: t.muted },
    searchBar:   { flexDirection: "row", alignItems: "center", ...card, borderRadius: Radius.lg, paddingHorizontal: 14, paddingVertical: 11, marginBottom: 12, gap: 8 },
    searchInput: { flex: 1, fontSize: 14, fontFamily: Fonts.regular, color: t.text },

    clientRow:       { flexDirection: "row", alignItems: "center", ...card, borderRadius: Radius.lg, padding: 12, marginBottom: 8, gap: 12 },
    avatarGrad:      { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
    avatarText:      { color: "white", fontSize: 15, fontFamily: Fonts.bold },
    clientName:      { fontSize: 14, fontFamily: Fonts.semibold, color: t.text },
    clientPhone:     { fontSize: 12, fontFamily: Fonts.regular, color: t.muted, marginTop: 2 },
    check:           { width: 22, height: 22, borderRadius: 11, backgroundColor: Colors.red, alignItems: "center", justifyContent: "center" },

    // Service picker
    svcCard:       { flexDirection: "row", alignItems: "center", ...card, borderRadius: Radius.lg, padding: 16, marginBottom: 10 },
    svcName:       { fontSize: 14, fontFamily: Fonts.semibold, color: t.text, marginBottom: 4 },
    svcMeta:       { fontSize: 12, fontFamily: Fonts.regular, color: t.muted },
    svcPrice:      { fontSize: 14, fontFamily: Fonts.bold, color: t.text },

    // Date + time
    durationNote:     { backgroundColor: Colors.red + "10", borderRadius: Radius.md, padding: 12 },
    durationNoteText: { fontSize: 13, fontFamily: Fonts.semibold, color: Colors.red },

    optChip:      { paddingVertical: 10, paddingHorizontal: 14, borderRadius: Radius.md, borderWidth: 1, borderColor: t.line, backgroundColor: t.cardSolid },
    optChipText:  { fontSize: 13, fontFamily: Fonts.semibold, color: t.text },

    // Summary
    summary:      { ...card, borderRadius: Radius.xl, padding: 20, marginTop: 22 },
    summaryTitle: { fontSize: 14, fontFamily: Fonts.bold, color: t.text, marginBottom: 14 },
    summaryRow:   { flexDirection: "row", justifyContent: "space-between", gap: 12, marginBottom: 10 },
    summaryLabel: { fontSize: 13, fontFamily: Fonts.regular, color: t.muted },
    summaryValue: { flexShrink: 1, textAlign: "right", fontSize: 13, fontFamily: Fonts.semibold, color: t.text },

    // Bottom
    bottomBar: { position: "absolute", bottom: 0, left: 0, right: 0, padding: 20, paddingBottom: 34, backgroundColor: t.bottomBar, borderTopWidth: 1, borderTopColor: t.bottomBorder },
    btn:       { borderRadius: Radius.full, overflow: "hidden" },
    btnGrad:   { paddingVertical: 16, alignItems: "center", backgroundColor: Colors.red },
    btnText:   { fontSize: 15, fontFamily: Fonts.bold, color: "white", letterSpacing: 0.3 },

    emptyTitle: { fontSize: 15, fontFamily: Fonts.bold, color: t.text, marginBottom: 6 },
    emptySub:   { fontSize: 13, fontFamily: Fonts.regular, color: t.muted, textAlign: "center" },
  });
}
