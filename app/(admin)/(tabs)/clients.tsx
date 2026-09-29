import { useEffect, useState, useCallback, useRef } from "react";
import {
  View, Text, ScrollView, FlatList, StyleSheet, TextInput,
  TouchableOpacity, RefreshControl, Modal, KeyboardAvoidingView,
  Platform, ActivityIndicator, Alert, Linking,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown, FadeInRight } from "react-native-reanimated";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { Colors, Gradients, Radius, Shadow } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { useTenant } from "@/lib/tenant";
import { diaLocalDe, fmtDia, hoyNegocio, sumarDias } from "@/lib/tz";
import { useAuth } from "@/lib/auth";
import { enlaceTel, enlaceWhatsApp, fmtMoney, fmtMoneyFull, fmtTelefono } from "@/lib/format";
import { STATUS_META } from "@/constants/status";
import Avatar from "@/components/Avatar";
import ErrorState from "@/components/ErrorState";
import { MonoTag } from "@/components/ui";
import {
  type LoyaltyReward,
  contarVisitas, describeReward, entregarRecompensa, getClientRewardStatuses,
} from "@/lib/loyalty";
import { COUNTRIES, DEFAULT_COUNTRY_ISO, countryByIso, flagEmoji, separarTelefono, telefonoParaGuardar } from "@/lib/countries";
import { buscarClientePorTelefono } from "@/lib/useClientSearch";
import { validarCorreoCliente } from "@/lib/contacto";
import { useListaClientes } from "@/lib/useListaClientes";
import { ErrorDB, exigirFilas, mensajeError, revisar, traerTodo } from "@/lib/db";
import { useGuardRespuestas } from "@/lib/useRecarga";

type Client = {
  id: string; name: string; phone?: string | null; phone_country_code?: string | null; email?: string | null; no_shows?: number | null;
  created_at?: string | null; notes?: string | null; birthday?: string | null;
  address?: string | null; document?: string | null;
};
// appointments NO tiene columna notes: pedirla hacía fallar toda la consulta y
// la ficha salía con 0 citas y sin fidelización (ESQ-07). Las notas del
// cliente están en clients.notes.
type Appt = {
  id: string; appointment_date: string; appointment_time: string | null; status: string | null;
  services: { name: string; price: number } | null;
};

// El embed services(...) se tipa como arreglo aunque la relación es de uno.
type RespuestaFilas<T> = PromiseLike<{ data: T[] | null; error: unknown }>;

const CLIENT_COLS = "id, name, phone, phone_country_code, email, no_shows, created_at, notes, birthday, address, document";
const HISTORIAL_POR_TANDA = 30;
// Área táctil extra para los botones de solo ícono (CAL-24): 36-40 pt + 8 por lado.
const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

// Segmentos — misma idea que el CRM del panel web, con el "hoy" del NEGOCIO
// (antes era el del teléfono) y sin contar inasistencias como visita.
type Segment = { key: "nuevo" | "recurrente" | "riesgo" | "perdido"; label: string; color: string };
function computeSegment(appts: Appt[], hoy: string): Segment {
  const d30 = sumarDias(hoy, -30);
  const d60 = sumarDias(hoy, -60);
  const past = appts.filter(a => a.status !== "cancelled" && a.status !== "no_show" && a.appointment_date <= hoy);
  const last = past.reduce<string | null>((acc, a) => (!acc || a.appointment_date > acc ? a.appointment_date : acc), null);
  if (!last) return { key: "nuevo", label: "Nuevo", color: Colors.blue };
  if (last >= d30) return { key: "recurrente", label: "Recurrente", color: Colors.success };
  if (last >= d60) return { key: "riesgo", label: "En riesgo", color: "#f59e0b" };
  return { key: "perdido", label: "Perdido", color: Colors.red };
}
type CustomField = { id: string; name: string; field_type: string };

/** 'YYYY-MM-DD' que existe en el calendario (la regex sola dejaba pasar 1995-02-31). */
function esFechaReal(dia: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Alert con Cancelar / botón, como promesa. */
function confirmar(titulo: string, mensaje: string, boton: string, destructivo = false): Promise<boolean> {
  return new Promise(resolve => {
    Alert.alert(titulo, mensaje, [
      { text: "Cancelar", style: "cancel", onPress: () => resolve(false) },
      { text: boton, style: destructivo ? "destructive" : "default", onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}

function valorCampo(tipo: string, valor: string | undefined): string {
  if (!valor) return "—";
  if (tipo === "boolean") return valor === "true" ? "Sí" : valor === "false" ? "No" : valor;
  if (tipo === "date" && /^\d{4}-\d{2}-\d{2}$/.test(valor)) return fmtDia(valor, "corto");
  return valor;
}

// ─── Edit form modal (pageSheet) ──────────────────────────────────────────────

function EditModal({ visible, client, tenantId, onClose, onSaved, onDeleted, onAbrirExistente }: {
  visible: boolean; client: Client | null; tenantId: string;
  onClose: () => void; onSaved: (c: Client) => void;
  onDeleted?: () => void;
  /** Al detectar un teléfono repetido: abrir la ficha que ya existe. */
  onAbrirExistente?: (id: string) => void;
}) {
  const { t } = useTheme();
  const { timezone } = useTenant();
  const isNew = client === null;
  const [name, setName]   = useState("");
  const [phone, setPhone] = useState("");
  const [iso2, setIso2] = useState(DEFAULT_COUNTRY_ISO);
  const [countryPicker, setCountryPicker] = useState(false);
  const [email, setEmail] = useState("");
  const [birthday, setBirthday] = useState("");
  const [address, setAddress] = useState("");
  const [document, setDocument] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [borrando, setBorrando] = useState(false);
  // Candado síncrono: `saving` tarda un render y un doble toque alcanzaba a
  // insertar dos veces (el segundo chocaba con el UNIQUE y avisaba "ya está
  // registrado" aunque el primero sí había creado el cliente).
  const ocupado = useRef(false);

  useEffect(() => {
    if (visible) {
      const sep = client?.phone
        ? separarTelefono(client.phone, client.phone_country_code)
        : { iso2: DEFAULT_COUNTRY_ISO, national: "" };
      setName(client?.name ?? ""); setPhone(sep.national); setIso2(sep.iso2); setEmail(client?.email ?? "");
      setBirthday(client?.birthday ?? ""); setNotes(client?.notes ?? "");
      setAddress(client?.address ?? ""); setDocument(client?.document ?? "");
    }
  }, [visible, client]);

  const country = countryByIso(iso2);
  const canSave = name.trim().length >= 2 && phone.replace(/\D/g, "").length >= 6;

  const avisarDuplicado = (dup: { id: string; name: string } | null) => {
    const texto = dup
      ? `Ya existe ${dup.name} con ese número. Cada teléfono solo puede tener una ficha en el negocio.`
      : "Ya existe un cliente con ese teléfono en el negocio.";
    Alert.alert(
      "Ese teléfono ya está registrado",
      texto,
      dup && onAbrirExistente
        ? [
            { text: "Cancelar", style: "cancel" },
            { text: "Abrir ficha", onPress: () => { onClose(); onAbrirExistente(dup.id); } },
          ]
        : [{ text: "Entendido" }],
    );
  };

  const handleSave = async () => {
    if (!canSave || ocupado.current) return;
    ocupado.current = true;
    try {
      await guardar();
    } finally {
      ocupado.current = false;
    }
  };

  const guardar = async () => {
    const bday = birthday.trim();
    if (bday && (!esFechaReal(bday) || bday > hoyNegocio(timezone))) {
      Alert.alert("Cumpleaños inválido", "Usa el formato AAAA-MM-DD con una fecha real, por ejemplo 1995-06-24.");
      return;
    }
    const mail = email.trim().toLowerCase();
    if (mail && !validarCorreoCliente(mail).ok) {
      Alert.alert("Correo inválido", "Revisa el correo (ej: nombre@gmail.com) o déjalo vacío.");
      return;
    }
    const tel = telefonoParaGuardar(iso2, phone);
    if (!tel) { Alert.alert("Falta el teléfono", "Escribe el celular del cliente."); return; }
    if (!tel.valido) {
      const seguir = await confirmar(
        "¿El número está bien?",
        `${phone.trim()} no parece un número válido de ${country.name}. Revísalo o, si el cliente es de otro país, cambia el indicativo.`,
        "Guardar así",
      );
      if (!seguir) return;
    }

    setSaving(true);
    try {
      const telefonoAnterior = (client?.phone ?? "").replace(/\D/g, "");
      if (isNew || tel.phone !== telefonoAnterior) {
        const dup = await buscarClientePorTelefono(tenantId, tel.phone, tel.countryCode, client?.id);
        if (dup) { avisarDuplicado(dup); return; }
      }
      const payload = {
        name: name.trim(), phone: tel.phone, phone_country_code: tel.countryCode,
        email: mail || null, birthday: bday || null, notes: notes.trim() || null,
        address: address.trim() || null, document: document.trim() || null,
      };
      if (isNew) {
        const res = await supabase.from("clients").insert({ ...payload, tenant_id: tenantId }).select(CLIENT_COLS).single();
        const creado = revisar(res, "No se pudo crear el cliente") as Client;
        onSaved(creado);
      } else {
        const filas = exigirFilas(
          await supabase.from("clients").update(payload).eq("id", client!.id).select(CLIENT_COLS),
          "No se pudo guardar el cliente",
        );
        onSaved(filas[0] as Client);
      }
      onClose();
    } catch (e) {
      const code = (e as { code?: string })?.code ?? "";
      if (code === "23505") {
        // Carrera con la reserva pública o formato que no calzó con las variantes.
        const dup = await buscarClientePorTelefono(tenantId, tel.phone, tel.countryCode, client?.id).catch(() => null);
        avisarDuplicado(dup);
      } else {
        Alert.alert("No se guardó", mensajeError(e, isNew ? "No se pudo crear el cliente" : "No se pudo guardar el cliente"));
      }
    } finally {
      setSaving(false);
    }
  };

  // D1: un cliente con citas, cobros, separados o historia clínica NO se borra
  // (la FK en cascada se llevaba todo, y la historia clínica se conserva por
  // ley: Res. 1995/1999). Solo se borra una ficha sin historial, con doble
  // confirmación. La migración lo bloquea también en el servidor.
  const handleDelete = async () => {
    if (!client || borrando) return;
    setBorrando(true);
    try {
      const contar = (tabla: string) =>
        supabase.from(tabla).select("id", { count: "exact", head: true }).eq("client_id", client.id);
      const [citas, cobros, separados, historia] = await Promise.all([
        contar("appointments"), contar("pos_sales"), contar("client_layaways"), contar("clinical_records"),
      ]);
      for (const r of [citas, cobros, separados, historia]) {
        if (r.error) throw new ErrorDB(r.error, "No se pudo revisar el historial del cliente, así que no se eliminó");
      }
      const partes: string[] = [];
      if ((citas.count ?? 0) > 0) partes.push(`${citas.count} cita${citas.count === 1 ? "" : "s"}`);
      if ((cobros.count ?? 0) > 0) partes.push(`${cobros.count} cobro${cobros.count === 1 ? "" : "s"}`);
      if ((separados.count ?? 0) > 0) partes.push(`${separados.count} separado${separados.count === 1 ? "" : "s"}`);
      if ((historia.count ?? 0) > 0) partes.push("historia clínica");
      if (partes.length > 0) {
        Alert.alert(
          "No se puede eliminar",
          `${client.name} tiene ${partes.join(", ")}. Ese historial se conserva${(historia.count ?? 0) > 0 ? " (la historia clínica se guarda por obligación legal)" : ""}.\n\nSi ya no es cliente, basta con no volver a agendarle. Para corregir sus datos, edita la ficha.`,
        );
        return;
      }
      const paso1 = await confirmar("Eliminar cliente", `${client.name} no tiene citas, cobros ni historia clínica. ¿Eliminar su ficha?`, "Continuar", true);
      if (!paso1) return;
      const paso2 = await confirmar(
        "Esta acción no se puede deshacer",
        `Se borrarán los datos de contacto, las notas y los campos personalizados de ${client.name}.`,
        "Eliminar definitivamente",
        true,
      );
      if (!paso2) return;
      exigirFilas(await supabase.from("clients").delete().eq("id", client.id).select("id"), "No se pudo eliminar el cliente");
      onClose();
      onDeleted?.();
    } catch (e) {
      Alert.alert("No se eliminó", mensajeError(e));
    } finally {
      setBorrando(false);
    }
  };

  const inputStyle = [em.input, { backgroundColor: t.inputBg, borderColor: t.inputBorder, color: t.ink }];
  const labelStyle = [em.fieldLabel, { color: t.muted }];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <View style={[em.header, { backgroundColor: "#0C0C14" }]}>
          <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3 }} />
          <View style={em.headerRow}>
            <TouchableOpacity onPress={onClose} style={em.iconBtn} hitSlop={HIT_SLOP} accessibilityRole="button" accessibilityLabel="Cerrar">
              <Ionicons name="close" size={20} color="white" />
            </TouchableOpacity>
            <Text style={em.headerTitle}>{isNew ? "Nuevo cliente" : "Editar cliente"}</Text>
            {!isNew ? (
              <TouchableOpacity onPress={handleDelete} disabled={borrando} style={em.iconBtn} hitSlop={HIT_SLOP} accessibilityRole="button" accessibilityLabel="Eliminar cliente" accessibilityState={{ disabled: borrando, busy: borrando }}>
                {borrando ? <ActivityIndicator size="small" color="white" /> : <Ionicons name="trash-outline" size={18} color="white" />}
              </TouchableOpacity>
            ) : <View style={{ width: 40 }} />}
          </View>
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
            <View style={em.field}>
              <Text style={labelStyle}>Nombre completo *</Text>
              <TextInput style={inputStyle} value={name} onChangeText={setName} placeholder="Ej: Juan García"
                placeholderTextColor={t.subtle} autoCapitalize="words" />
            </View>
            <View style={em.field}>
              <Text style={labelStyle}>Teléfono * <Text style={[em.fieldLabelNote, { color: t.subtle }]}>(sin indicativo)</Text></Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TouchableOpacity
                  style={[em.countryBtn, { backgroundColor: t.inputBg, borderColor: t.inputBorder }]}
                  onPress={() => setCountryPicker(true)} activeOpacity={0.8}
                  accessibilityRole="button" accessibilityLabel={`Indicativo: ${country.name} +${country.dial}`}
                >
                  <Text style={[em.countryBtnText, { color: t.ink }]}>{flagEmoji(country.iso2)} +{country.dial}</Text>
                  <Ionicons name="chevron-down" size={13} color={t.muted} />
                </TouchableOpacity>
                <TextInput style={[...inputStyle, { flex: 1 }]} value={phone} onChangeText={setPhone} placeholder="3001234567"
                  placeholderTextColor={t.subtle} keyboardType="phone-pad" />
              </View>
            </View>
            <View style={em.field}>
              <Text style={labelStyle}>Correo electrónico</Text>
              <TextInput style={inputStyle} value={email} onChangeText={setEmail} placeholder="juan@email.com"
                placeholderTextColor={t.subtle} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
            </View>
            <View style={em.field}>
              <Text style={labelStyle}>Documento (cédula, opcional)</Text>
              <TextInput style={inputStyle} value={document} onChangeText={setDocument} placeholder="1016953423"
                placeholderTextColor={t.subtle} keyboardType="numbers-and-punctuation" />
            </View>
            <View style={em.field}>
              <Text style={labelStyle}>Dirección</Text>
              <TextInput style={inputStyle} value={address} onChangeText={setAddress} placeholder="Calle 10 # 5-20"
                placeholderTextColor={t.subtle} />
            </View>
            <View style={em.field}>
              <Text style={labelStyle}>Cumpleaños (AAAA-MM-DD)</Text>
              <TextInput style={inputStyle} value={birthday} onChangeText={setBirthday} placeholder="1995-06-24"
                placeholderTextColor={t.subtle} keyboardType="numbers-and-punctuation" />
            </View>
            <View style={em.field}>
              <Text style={labelStyle}>Notas internas</Text>
              <TextInput
                style={[...inputStyle, { height: 90, textAlignVertical: "top" }]}
                value={notes} onChangeText={setNotes} multiline
                placeholder="Preferencias, alergias, cómo le gusta el corte…"
                placeholderTextColor={t.subtle}
              />
            </View>
          </ScrollView>
          <View style={[em.bottomBar, { backgroundColor: t.bottomBar, borderTopColor: t.bottomBorder }]}>
            <TouchableOpacity style={[em.btn, (!canSave || saving) && { opacity: 0.4 }]}
              onPress={handleSave} disabled={!canSave || saving} activeOpacity={0.85}
              accessibilityRole="button" accessibilityState={{ disabled: !canSave || saving }}>
              <View style={em.btnGrad}>
                {saving ? <ActivityIndicator color="white" /> : <Text style={em.btnText}>{isNew ? "Crear cliente" : "Guardar cambios"}</Text>}
              </View>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* Country picker */}
      <Modal visible={countryPicker} animationType="slide" transparent onRequestClose={() => setCountryPicker(false)}>
        <View style={m.overlay}>
          <View style={[m.sheet, { maxHeight: "70%", backgroundColor: t.cardSolid }]}>
            <View style={[m.handle, { backgroundColor: t.lineStrong }]} />
            <Text style={[m.title, { color: t.ink }]}>Indicativo de país</Text>
            <FlatList
              data={COUNTRIES}
              keyExtractor={c => c.iso2}
              ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: t.line }} />}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={m.clientRow}
                  onPress={() => { setIso2(item.iso2); setCountryPicker(false); }}
                  accessibilityRole="button"
                >
                  <Text style={{ fontSize: 20 }}>{flagEmoji(item.iso2)}</Text>
                  <Text style={[m.clientName, { color: t.ink }]}>{item.name} <Text style={{ color: t.subtle }}>+{item.dial}</Text></Text>
                  {iso2 === item.iso2 && <Ionicons name="checkmark" size={18} color={Colors.red} />}
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>
    </Modal>
  );
}

// ─── Client profile modal (full-screen) ───────────────────────────────────────

type Perfil = {
  appts: Appt[];
  customFields: CustomField[];
  fieldValues: Record<string, string>;
  posTotal: number;
  rewards: LoyaltyReward[];
  redemptions: { id: string; reward_id: string }[];
  serviceNames: Record<string, string>;
};

function ClientProfileModal({ client: initialClient, tenantId, onClose, onChanged, onAbrirOtro }: {
  client: Client; tenantId: string; onClose: () => void; onChanged: () => void;
  onAbrirOtro: (id: string) => void;
}) {
  const { t } = useTheme();
  const { timezone } = useTenant();
  const insets = useSafeAreaInsets();
  const guard = useGuardRespuestas();
  const [client, setClient]   = useState<Client>(initialClient);
  const [perfil, setPerfil]   = useState<Perfil | null>(null);
  const [error, setError]     = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [mostrar, setMostrar] = useState(HISTORIAL_POR_TANDA);
  const [redeeming, setRedeeming] = useState<string | null>(null);
  const redeemingRef = useRef(false);

  const load = useCallback(async () => {
    const turno = guard.nuevo();
    setLoading(true);
    try {
      const id = initialClient.id;
      const [appts, cfRes, fvRes, ventas, rwRes, rdRes] = await Promise.all([
        // Todas las citas (paginado): con limit(200) las visitas de la ficha
        // no cuadraban con las de Fidelización.
        traerTodo<Appt>((d, h) => supabase.from("appointments")
          .select("id,appointment_date,appointment_time,status,services(name,price)")
          .eq("client_id", id)
          .order("appointment_date", { ascending: false })
          .order("appointment_time", { ascending: false })
          .order("id")
          .range(d, h) as unknown as RespuestaFilas<Appt>, { tope: 5000, contexto: "No se pudo cargar el historial del cliente" }),
        supabase.from("custom_fields")
          .select("id,name,field_type")
          .eq("tenant_id", tenantId)
          .eq("applies_to", "client")
          .eq("active", true)
          .order("position"),
        supabase.from("client_field_values").select("field_id,value").eq("client_id", id),
        traerTodo<{ id: string; total: number }>((d, h) => supabase.from("pos_sales")
          .select("id,total").eq("client_id", id).order("created_at").order("id").range(d, h),
          { contexto: "No se pudieron cargar los cobros del cliente" }),
        supabase.from("loyalty_rewards").select("*").eq("tenant_id", tenantId).eq("active", true).order("visits_required"),
        supabase.from("loyalty_redemptions").select("id,reward_id").eq("client_id", id),
      ]);
      const customFields = (revisar(cfRes, "No se pudieron cargar los campos personalizados") ?? []) as CustomField[];
      const fieldValues: Record<string, string> = {};
      ((revisar(fvRes, "No se pudieron cargar los campos personalizados") ?? []) as { field_id: string; value: string | null }[])
        .forEach(r => { fieldValues[r.field_id] = r.value ?? ""; });
      const rewards = (revisar(rwRes, "No se pudo cargar la fidelización") ?? []) as LoyaltyReward[];
      const redemptions = (revisar(rdRes, "No se pudo cargar la fidelización") ?? []) as { id: string; reward_id: string }[];
      const svcIds = [...new Set(rewards.map(r => r.service_id).filter((x): x is string => !!x))];
      let serviceNames: Record<string, string> = {};
      if (svcIds.length > 0) {
        const sv = revisar(await supabase.from("services").select("id,name").in("id", svcIds), "No se pudo cargar la fidelización") ?? [];
        serviceNames = Object.fromEntries((sv as { id: string; name: string }[]).map(s => [s.id, s.name]));
      }
      if (!turno.vigente()) return;
      setPerfil({
        appts,
        customFields,
        fieldValues,
        posTotal: ventas.reduce((s, r) => s + (Number(r.total) || 0), 0),
        rewards,
        redemptions,
        serviceNames,
      });
      setError(null);
    } catch (e) {
      if (turno.vigente()) setError(e);
    } finally {
      if (turno.vigente()) setLoading(false);
    }
  }, [initialClient.id, tenantId, guard]);

  useEffect(() => { load(); }, [load]);

  const appts      = perfil?.appts ?? [];
  const hoy        = hoyNegocio(timezone);
  const completed  = appts.filter(a => a.status === "completed");
  const noShows    = appts.filter(a => a.status === "no_show").length;
  // D10: gastado = solo lo cobrado (pos_sales). Una cita completada sin cobro
  // no es plata recibida.
  const totalSpent = perfil?.posTotal ?? 0;
  const since      = client.created_at ? fmtDia(diaLocalDe(client.created_at, timezone), "corto") : "—";
  const segment    = computeSegment(appts, hoy);

  // Fidelización: visita = cita completada (lib/loyalty), igual que la RPC del servidor.
  const visits = contarVisitas(appts);
  const loyaltyStatuses = getClientRewardStatuses(perfil?.rewards ?? [], visits, perfil?.redemptions ?? []);
  const loyaltyAvailable = loyaltyStatuses.filter(st => st.available > 0);
  const loyaltyNext = loyaltyStatuses.filter(st => st.available === 0).sort((a, b) => a.remaining - b.remaining)[0] ?? null;

  const handleRedeem = async (reward: LoyaltyReward) => {
    if (redeemingRef.current) return;
    redeemingRef.current = true;
    setRedeeming(reward.id);
    try {
      const r = await entregarRecompensa({ tenantId, clientId: client.id, reward });
      if (!r.ok) Alert.alert("No se registró la entrega", r.mensaje);
      // El botón sigue deshabilitado hasta que termine la recarga: antes volvía
      // a activarse con el premio todavía visible y un segundo toque duplicaba.
      await load();
    } catch (e) {
      Alert.alert("No se pudo registrar la entrega", mensajeError(e));
    } finally {
      redeemingRef.current = false;
      setRedeeming(null);
    }
  };

  const llamar = () => {
    const url = enlaceTel(client.phone, { indicativo: client.phone_country_code });
    if (!url) return;
    Linking.openURL(url).catch(() => Alert.alert("No se pudo abrir el marcador"));
  };
  const abrirWhatsApp = () => {
    const url = enlaceWhatsApp(client.phone, { indicativo: client.phone_country_code });
    if (!url) {
      Alert.alert("Número inválido", "El teléfono de este cliente no parece un número de WhatsApp válido. Revísalo en Editar.");
      return;
    }
    Linking.openURL(url).catch(() => Alert.alert("No se pudo abrir WhatsApp"));
  };

  const handleEditSaved = (updated: Client) => {
    setClient(updated);
    onChanged();
  };

  const card = [p.card, Shadow.sm, { backgroundColor: t.cardSolid, borderColor: t.line }];
  const sectionLabel = [p.sectionLabel, { color: t.subtle }];

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        {/* Header */}
        <View style={[p.header, { paddingTop: insets.top + 12, backgroundColor: "#0C0C14" }]}>
          <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3 }} />
          <View style={p.headerRow}>
            <TouchableOpacity onPress={onClose} style={p.iconBtn} hitSlop={HIT_SLOP} accessibilityRole="button" accessibilityLabel="Volver">
              <Ionicons name="arrow-back" size={20} color="white" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setEditOpen(true)} style={p.iconBtn} hitSlop={HIT_SLOP} accessibilityRole="button" accessibilityLabel="Editar cliente">
              <Ionicons name="create-outline" size={20} color="white" />
            </TouchableOpacity>
          </View>
          <View style={p.identity}>
            <Avatar name={client.name} size={72} />
            <Text style={p.clientName}>{client.name}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={p.clientSince}>Cliente desde {since}</Text>
              {perfil && (
                <View style={[p.segmentPill, { backgroundColor: segment.color + "28", borderColor: segment.color + "55" }]}>
                  <Text style={[p.segmentText, { color: "white" }]}>{visits >= 5 ? "VIP · " : ""}{segment.label}</Text>
                </View>
              )}
            </View>
            <View style={p.actions}>
              {client.phone ? (
                <>
                  <TouchableOpacity style={p.actionBtn} onPress={llamar} activeOpacity={0.8} accessibilityRole="button">
                    <Ionicons name="call-outline" size={16} color="white" />
                    <Text style={p.actionLabel}>Llamar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={p.actionBtn} onPress={abrirWhatsApp} activeOpacity={0.8} accessibilityRole="button">
                    <Ionicons name="logo-whatsapp" size={16} color="white" />
                    <Text style={p.actionLabel}>WhatsApp</Text>
                  </TouchableOpacity>
                </>
              ) : null}
              {client.email ? (
                <TouchableOpacity style={p.actionBtn}
                  onPress={() => Linking.openURL(`mailto:${client.email}`).catch(() => Alert.alert("No se pudo abrir el correo"))}
                  activeOpacity={0.8} accessibilityRole="button">
                  <Ionicons name="mail-outline" size={16} color="white" />
                  <Text style={p.actionLabel}>Correo</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        </View>

        {error && !perfil ? (
          <ErrorState error={error} onRetry={load} />
        ) : (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }}>
          {error ? (
            <TouchableOpacity onPress={load} style={[p.errorBanner, { borderColor: Colors.red + "40" }]} accessibilityRole="button">
              <Ionicons name="alert-circle-outline" size={16} color={Colors.red} />
              <Text style={[p.errorBannerText, { color: t.ink }]}>{mensajeError(error)} Toca para reintentar.</Text>
            </TouchableOpacity>
          ) : null}

          {/* Stats */}
          <Animated.View entering={FadeInDown.delay(0).duration(300)}>
            <View style={[p.statsCard, Shadow.sm, { backgroundColor: t.cardSolid, borderColor: t.line }]}>
              {[
                { val: String(appts.length), label: "Citas", color: t.ink },
                { val: String(completed.length), label: "Completadas", color: Colors.success },
                { val: String(noShows), label: "No asistió", color: noShows > 0 ? Colors.red : t.ink },
                { val: fmtMoney(totalSpent), label: "Pagado", color: Colors.purple },
              ].map((st, i, arr) => (
                <View key={st.label} style={{ flexDirection: "row", flex: 1 }}>
                  <View style={p.statBox}>
                    <Text style={[p.statVal, { color: st.color }]} numberOfLines={1} adjustsFontSizeToFit>{loading && !perfil ? "—" : st.val}</Text>
                    <Text style={[p.statLabel, { color: t.subtle }]}>{st.label}</Text>
                  </View>
                  {i < arr.length - 1 && <View style={[p.statDiv, { backgroundColor: t.line }]} />}
                </View>
              ))}
            </View>
          </Animated.View>

          {/* Fidelización */}
          {(perfil?.rewards.length ?? 0) > 0 && (
            <Animated.View entering={FadeInDown.delay(30).duration(300)}>
              <Text style={sectionLabel}>Fidelización · {visits} visita{visits !== 1 ? "s" : ""}</Text>
              {loyaltyAvailable.length > 0 ? (
                loyaltyAvailable.map(st => (
                  <View key={st.reward.id} style={[...card, { flexDirection: "row", alignItems: "center", gap: 12, borderColor: "#a855f7" + "45", marginBottom: 8 }]}>
                    <View style={[p.infoIcon, { backgroundColor: "#a855f7" + "18" }]}>
                      <Ionicons name="gift-outline" size={15} color="#a855f7" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[p.infoText, { color: t.ink }]} numberOfLines={1}>{st.reward.label}</Text>
                      <Text style={{ fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: "#a855f7", marginTop: 2 }}>
                        {describeReward(st.reward, perfil?.serviceNames[st.reward.service_id ?? ""] ?? null)}{st.available > 1 ? ` · ×${st.available}` : ""}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => handleRedeem(st.reward)}
                      disabled={!!redeeming || loading}
                      style={{ backgroundColor: "#a855f7", borderRadius: Radius.full, paddingVertical: 9, paddingHorizontal: 14, opacity: redeeming || loading ? 0.6 : 1 }}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                      accessibilityLabel={`Entregar ${st.reward.label}`}
                    >
                      {redeeming === st.reward.id ? <ActivityIndicator size="small" color="white" /> : (
                        <Text style={{ fontSize: 12, fontFamily: "SpaceGrotesk_700Bold", color: "white" }}>Entregar</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                ))
              ) : loyaltyNext ? (
                <View style={card}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <Text style={[p.infoText, { color: t.ink, flexShrink: 1 }]} numberOfLines={1}>{loyaltyNext.reward.label}</Text>
                    <Text style={{ fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: t.muted }}>
                      Falta{loyaltyNext.remaining !== 1 ? "n" : ""} <Text style={{ color: Colors.blue, fontFamily: "SpaceGrotesk_700Bold" }}>{loyaltyNext.remaining}</Text> visita{loyaltyNext.remaining !== 1 ? "s" : ""}
                    </Text>
                  </View>
                  <View style={{ height: 6, borderRadius: 4, backgroundColor: t.trackBg, overflow: "hidden" }}>
                    <View style={{ height: "100%", width: `${Math.min(100, (loyaltyNext.progressCurrent / loyaltyNext.progressTarget) * 100)}%`, backgroundColor: Colors.blue, borderRadius: 4 }} />
                  </View>
                </View>
              ) : (
                <View style={card}>
                  <Text style={{ fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: t.muted }}>Sin visitas suficientes todavía.</Text>
                </View>
              )}
            </Animated.View>
          )}

          {/* Notas internas */}
          {client.notes ? (
            <Animated.View entering={FadeInDown.delay(45).duration(300)}>
              <Text style={sectionLabel}>Notas internas</Text>
              <View style={card}>
                <Text style={{ fontSize: 13.5, fontFamily: "SpaceGrotesk_400Regular", color: t.ink, lineHeight: 20 }}>{client.notes}</Text>
              </View>
            </Animated.View>
          ) : null}

          {/* Contact */}
          {(client.phone || client.email || client.document || client.address || client.birthday) ? (
            <Animated.View entering={FadeInDown.delay(60).duration(300)}>
              <Text style={sectionLabel}>Contacto</Text>
              <View style={card}>
                {[
                  client.phone ? { key: "tel", icon: "call-outline" as const, color: Colors.success, text: fmtTelefono(client.phone, { indicativo: client.phone_country_code }) } : null,
                  client.email ? { key: "mail", icon: "mail-outline" as const, color: Colors.blue, text: client.email } : null,
                  client.document ? { key: "doc", icon: "card-outline" as const, color: Colors.purple, text: `Documento ${client.document}` } : null,
                  client.address ? { key: "dir", icon: "location-outline" as const, color: Colors.red, text: client.address } : null,
                  client.birthday ? { key: "cumple", icon: "balloon-outline" as const, color: "#f59e0b", text: `Cumple el ${fmtDia(client.birthday, "dia-mes")}` } : null,
                ].filter((x): x is NonNullable<typeof x> => !!x).map((row, i) => (
                  <View key={row.key}>
                    {i > 0 && <View style={[p.infoDivider, { backgroundColor: t.line }]} />}
                    <View style={p.infoRow}>
                      <View style={[p.infoIcon, { backgroundColor: row.color + "18" }]}>
                        <Ionicons name={row.icon} size={15} color={row.color} />
                      </View>
                      <Text style={[p.infoText, { color: t.ink, flex: 1 }]}>{row.text}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </Animated.View>
          ) : null}

          {/* Custom fields */}
          {(perfil?.customFields.length ?? 0) > 0 && (
            <Animated.View entering={FadeInDown.delay(90).duration(300)}>
              <Text style={sectionLabel}>Datos adicionales</Text>
              <View style={card}>
                {perfil!.customFields.map((f, i) => (
                  <View key={f.id}>
                    {i > 0 && <View style={[p.infoDivider, { backgroundColor: t.line }]} />}
                    <View style={p.infoRow}>
                      <Text style={[p.infoLabel, { color: t.ink }]}>{f.name}</Text>
                      <Text style={[p.infoValue, { color: t.muted }]}>{valorCampo(f.field_type, perfil!.fieldValues[f.id])}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </Animated.View>
          )}

          {/* History */}
          <Animated.View entering={FadeInDown.delay(120).duration(300)}>
            <Text style={[...sectionLabel, { marginTop: 24 }]}>
              Historial{appts.length > 0 ? ` · ${appts.length} citas` : ""}
            </Text>

            {loading && !perfil ? (
              <ActivityIndicator color={Colors.red} style={{ marginTop: 20 }} />
            ) : appts.length === 0 ? (
              <View style={[p.emptyCard, Shadow.sm, { backgroundColor: t.cardSolid, borderColor: t.line }]}>
                <Ionicons name="calendar-outline" size={36} color={t.subtle} style={{ marginBottom: 10 }} />
                <Text style={[p.emptyTitle, { color: t.ink }]}>Sin citas registradas</Text>
                <Text style={[p.emptySub, { color: t.muted }]}>Las citas aparecerán aquí</Text>
              </View>
            ) : (
              <>
                {appts.slice(0, mostrar).map((a, i) => {
                  const meta = STATUS_META[a.status ?? "pending"] ?? STATUS_META.pending;
                  const [diaTxt, mesTxt] = fmtDia(a.appointment_date, "dia-mes").split(" ");
                  return (
                    <Animated.View key={a.id} entering={i < 10 ? FadeInRight.delay(i * 35).duration(260) : undefined}>
                      <View style={[p.apptRow, Shadow.sm, { backgroundColor: t.cardSolid, borderColor: t.line }]}>
                        <View style={[p.dateBlock, { backgroundColor: t.chipBg }]}>
                          <Text style={[p.dateDay, { color: t.ink }]}>{diaTxt}</Text>
                          <Text style={[p.dateMon, { color: t.subtle }]}>{mesTxt}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[p.apptService, { color: t.ink }]} numberOfLines={1}>{a.services?.name ?? "Servicio"}</Text>
                          <Text style={[p.apptTime, { color: t.muted }]}>
                            {a.appointment_date.slice(0, 4) !== hoy.slice(0, 4) ? `${a.appointment_date.slice(0, 4)} · ` : ""}{a.appointment_time?.slice(0, 5) ?? "—"}
                          </Text>
                        </View>
                        <View style={{ alignItems: "flex-end", gap: 5 }}>
                          {a.services?.price ? (
                            <Text style={[p.apptPrice, { color: t.ink }]}>{fmtMoneyFull(Number(a.services.price))}</Text>
                          ) : null}
                          <View style={[p.statusPill, { backgroundColor: meta.bg }]}>
                            <Text style={[p.statusText, { color: meta.color }]}>{meta.label}</Text>
                          </View>
                        </View>
                      </View>
                    </Animated.View>
                  );
                })}
                {appts.length > mostrar && (
                  <TouchableOpacity onPress={() => setMostrar(n => n + HISTORIAL_POR_TANDA)} style={[p.moreBtn, { borderColor: t.line }]} accessibilityRole="button">
                    <Text style={[p.moreBtnText, { color: t.ink }]}>Ver más citas ({appts.length - mostrar})</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </Animated.View>
        </ScrollView>
        )}

        <EditModal
          visible={editOpen}
          client={client}
          tenantId={tenantId}
          onClose={() => setEditOpen(false)}
          onSaved={handleEditSaved}
          onDeleted={() => { onClose(); onChanged(); }}
          onAbrirExistente={id => { onClose(); onAbrirOtro(id); }}
        />
      </View>
    </Modal>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function ClientsScreen() {
  const { t } = useTheme();
  const { tenantId } = useAuth();
  const { timezone } = useTenant();
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [profileClient, setProfileClient] = useState<Client | null>(null);
  const [newModal, setNewModal] = useState(false);

  // Paginada y con búsqueda en el servidor (antes: todo de una vez, cortado
  // en 1000 filas, y búsqueda solo sobre lo cargado). Se recarga al volver a
  // la pestaña: un cliente creado desde "Nueva cita" ya aparece.
  const lista = useListaClientes<Client>({
    tenantId,
    busqueda: search,
    columnas: CLIENT_COLS,
    porPagina: 50,
    timeZone: timezone,
  });

  const abrirPorId = async (id: string) => {
    const { data, error } = await supabase.from("clients").select(CLIENT_COLS).eq("id", id).maybeSingle();
    if (error || !data) {
      Alert.alert("No se pudo abrir el cliente", error ? mensajeError(error) : "El cliente ya no existe.");
      return;
    }
    setProfileClient(data as Client);
  };

  const onRefresh = async () => { setRefreshing(true); await lista.recargar(); setRefreshing(false); };

  const subtitulo = lista.total == null
    ? (lista.cargando ? "Cargando…" : " ")
    : lista.buscando
      ? `${lista.total} resultado${lista.total !== 1 ? "s" : ""}`
      : `${lista.total} cliente${lista.total !== 1 ? "s" : ""} registrado${lista.total !== 1 ? "s" : ""}`;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={s.header}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <MonoTag>Clientes</MonoTag>
          <Text style={[s.headerTitle, { color: t.ink }]}>Tu base de clientes</Text>
          <Text style={[s.headerSub, { color: t.muted }]}>{subtitulo}</Text>
        </View>
        <TouchableOpacity onPress={() => setNewModal(true)} activeOpacity={0.85} style={s.addBtnWrap}
          hitSlop={HIT_SLOP} accessibilityRole="button" accessibilityLabel="Nuevo cliente">
          <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.addBtn}>
            <Ionicons name="person-add-outline" size={17} color="white" />
          </LinearGradient>
        </TouchableOpacity>
      </View>

      <View style={[s.searchWrap, { backgroundColor: t.cardSolid, borderBottomColor: t.line }]}>
        <Ionicons name="search-outline" size={16} color={t.subtle} style={{ marginRight: 8 }} />
        <TextInput
          style={[s.search, { color: t.ink }]} placeholder="Buscar por nombre o teléfono"
          placeholderTextColor={t.subtle} value={search} onChangeText={setSearch}
          autoCorrect={false}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch("")} hitSlop={HIT_SLOP} accessibilityRole="button" accessibilityLabel="Borrar búsqueda">
            <Ionicons name="close-circle" size={18} color={t.subtle} />
          </TouchableOpacity>
        )}
      </View>

      {lista.error && lista.filas.length === 0 && !lista.cargando ? (
        <ErrorState error={lista.error} onRetry={lista.recargar} />
      ) : (
        <FlatList
          data={lista.filas}
          keyExtractor={(item) => item.id}
          style={{ flex: 1 }}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 110 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.red} />}
          onEndReached={lista.cargarMas}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            lista.cargandoMas ? <ActivityIndicator color={Colors.red} style={{ marginVertical: 16 }} />
            : lista.error && lista.filas.length > 0 ? (
              <TouchableOpacity onPress={lista.cargarMas} style={{ padding: 16, alignItems: "center" }} accessibilityRole="button">
                <Text style={{ color: Colors.red, fontFamily: "SpaceGrotesk_600SemiBold", fontSize: 13, textAlign: "center" }}>
                  {mensajeError(lista.error)} Toca para reintentar.
                </Text>
              </TouchableOpacity>
            ) : null
          }
          ListEmptyComponent={
            lista.cargando ? (
              <ActivityIndicator color={Colors.red} style={{ marginTop: 40 }} />
            ) : (
              <Animated.View entering={FadeInDown.duration(400)} style={[s.empty, { backgroundColor: t.cardSolid, borderColor: t.line }]}>
                <Ionicons name="people-outline" size={44} color={t.subtle} style={{ marginBottom: 12 }} />
                <Text style={[s.emptyTitle, { color: t.ink }]}>{search ? "Sin resultados" : "Sin clientes aún"}</Text>
                <Text style={[s.emptySub, { color: t.muted }]}>
                  {search ? (search.trim().length < 2 ? "Escribe al menos 2 letras" : "Prueba otro nombre o teléfono") : "Toca + para agregar tu primer cliente"}
                </Text>
              </Animated.View>
            )
          }
          renderItem={({ item: c, index: i }) => (
            <Animated.View entering={i < 10 ? FadeInRight.delay(i * 50).duration(320) : undefined}>
              <TouchableOpacity
                style={[s.row, Shadow.sm, { backgroundColor: t.cardSolid, borderColor: t.line }]}
                onPress={() => setProfileClient(c)}
                activeOpacity={0.75}
                accessibilityRole="button"
              >
                <Avatar name={c.name} />
                <View style={{ flex: 1 }}>
                  <Text style={[s.name, { color: t.ink }]} numberOfLines={1}>{c.name}</Text>
                  <Text style={[s.info, { color: t.muted }]} numberOfLines={1}>
                    {c.phone ? fmtTelefono(c.phone, { indicativo: c.phone_country_code }) : c.email ?? "Sin contacto"}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  {(c.no_shows ?? 0) > 0 ? (
                    <Text style={s.noShows}>{c.no_shows} falta{(c.no_shows ?? 0) > 1 ? "s" : ""}</Text>
                  ) : null}
                  <Ionicons name="chevron-forward" size={16} color={t.subtle} style={{ marginTop: 4 }} />
                </View>
              </TouchableOpacity>
            </Animated.View>
          )}
        />
      )}

      {/* Profile modal */}
      {profileClient && tenantId && (
        <ClientProfileModal
          key={profileClient.id}
          client={profileClient}
          tenantId={tenantId}
          onClose={() => setProfileClient(null)}
          onChanged={() => { lista.recargar(); }}
          onAbrirOtro={id => { abrirPorId(id); }}
        />
      )}

      {/* New client modal */}
      {tenantId && (
        <EditModal
          visible={newModal}
          client={null}
          tenantId={tenantId}
          onClose={() => setNewModal(false)}
          onSaved={() => { lista.recargar(); }}
          onAbrirExistente={id => { abrirPorId(id); }}
        />
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
// Sin colores de claro fijos: fondo, texto y bordes van en línea con los
// tokens de useTheme().t para que el modo oscuro no quede con parches blancos.

const s = StyleSheet.create({
  header:      { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, paddingTop: 14, paddingHorizontal: 20, paddingBottom: 14 },
  headerTitle: { fontSize: 21, fontFamily: "SpaceGrotesk_700Bold", letterSpacing: -0.5, marginTop: 3 },
  headerSub:   { fontSize: 12.5, fontFamily: "SpaceGrotesk_400Regular", marginTop: 3 },
  addBtnWrap:  { borderRadius: 19, overflow: "hidden" },
  addBtn:      { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  searchWrap:  { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  search:      { flex: 1, fontSize: 14, fontFamily: "SpaceGrotesk_400Regular" },
  row:         { borderWidth: 1, borderRadius: Radius.md, padding: 14, flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  name:        { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold" },
  info:        { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", marginTop: 2 },
  noShows:     { fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.red },
  empty:       { borderWidth: 1, borderRadius: Radius.xl, padding: 48, alignItems: "center", marginTop: 20, ...Shadow.sm },
  emptyTitle:  { fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", marginBottom: 6 },
  emptySub:    { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", textAlign: "center" },
});

// Profile styles
const p = StyleSheet.create({
  header:      { paddingTop: 16, paddingHorizontal: 20, paddingBottom: 28 },
  headerRow:   { flexDirection: "row", justifyContent: "space-between", marginBottom: 20 },
  iconBtn:     { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,.2)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.3)" },
  identity:    { alignItems: "center", gap: 6 },
  clientName:  { fontSize: 22, fontFamily: "SpaceGrotesk_700Bold", color: "white", letterSpacing: -0.4, marginTop: 6, textAlign: "center" },
  clientSince: { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: "rgba(255,255,255,.75)" },
  segmentPill: { borderRadius: Radius.full, paddingHorizontal: 9, paddingVertical: 3, borderWidth: 1 },
  segmentText: { fontSize: 10, fontFamily: "SpaceGrotesk_700Bold", letterSpacing: 0.3 },
  actions:     { flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap", justifyContent: "center" },
  actionBtn:   { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,.2)", borderRadius: Radius.full, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: "rgba(255,255,255,0.3)" },
  actionLabel: { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: "white" },

  errorBanner: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: Radius.md, padding: 12, marginBottom: 12, backgroundColor: Colors.red + "10" },
  errorBannerText: { flex: 1, fontSize: 12.5, fontFamily: "SpaceGrotesk_600SemiBold" },

  sectionLabel:{ fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", textTransform: "uppercase", letterSpacing: 0.9, marginBottom: 10, marginTop: 20 },
  card:        { borderWidth: 1, borderRadius: Radius.lg, padding: 16 },

  statsCard:   { borderWidth: 1, borderRadius: Radius.lg, flexDirection: "row", padding: 16 },
  statBox:     { flex: 1, alignItems: "center", gap: 4, paddingHorizontal: 2 },
  statVal:     { fontSize: 20, fontFamily: "SpaceGrotesk_700Bold" },
  statLabel:   { fontSize: 10, fontFamily: "SpaceGrotesk_600SemiBold", textAlign: "center" },
  statDiv:     { width: 1, marginVertical: 4 },

  infoRow:     { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 4 },
  infoIcon:    { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  infoText:    { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold" },
  infoDivider: { height: 1, marginVertical: 8 },
  infoLabel:   { flex: 1, fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold" },
  infoValue:   { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", flexShrink: 1, textAlign: "right" },

  emptyCard:   { borderWidth: 1, borderRadius: Radius.xl, padding: 40, alignItems: "center" },
  emptyTitle:  { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", marginBottom: 6 },
  emptySub:    { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", textAlign: "center" },

  apptRow:     { borderWidth: 1, borderRadius: Radius.md, flexDirection: "row", alignItems: "center", gap: 14, padding: 14, marginBottom: 8 },
  dateBlock:   { width: 40, alignItems: "center", borderRadius: Radius.sm, paddingVertical: 8 },
  dateDay:     { fontSize: 18, fontFamily: "SpaceGrotesk_700Bold", lineHeight: 20 },
  dateMon:     { fontSize: 10, fontFamily: "SpaceGrotesk_600SemiBold", textTransform: "uppercase" },
  apptService: { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold" },
  apptTime:    { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", marginTop: 2 },
  apptPrice:   { fontSize: 13, fontFamily: "SpaceGrotesk_700Bold" },
  statusPill:  { borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  statusText:  { fontSize: 10, fontFamily: "SpaceGrotesk_600SemiBold" },
  moreBtn:     { borderWidth: 1, borderRadius: Radius.md, paddingVertical: 12, alignItems: "center", marginTop: 4 },
  moreBtnText: { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold" },
});

// Edit modal styles
const em = StyleSheet.create({
  header:     { paddingTop: 16, paddingHorizontal: 20, paddingBottom: 20 },
  headerRow:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  iconBtn:    { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,.2)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.3)" },
  headerTitle:{ fontSize: 18, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
  field:      { marginBottom: 16 },
  fieldLabel: { fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 },
  fieldLabelNote: { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", textTransform: "none", letterSpacing: 0 },
  input:      { borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, fontFamily: "SpaceGrotesk_400Regular" },
  countryBtn:     { borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: 12, paddingVertical: 13, flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 },
  countryBtnText: { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold" },
  bottomBar:  { padding: 20, paddingBottom: 34, borderTopWidth: 1 },
  btn:        { borderRadius: Radius.full, overflow: "hidden" },
  btnGrad:    { paddingVertical: 16, alignItems: "center", backgroundColor: Colors.red },
  btnText:    { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
});

// Country picker sheet styles
const m = StyleSheet.create({
  overlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet:      { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, gap: 14 },
  handle:     { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 8 },
  title:      { fontSize: 18, fontFamily: "SpaceGrotesk_700Bold" },
  clientRow:  { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
  clientName: { flex: 1, fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold" },
});
