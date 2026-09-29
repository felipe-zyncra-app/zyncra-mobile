import { useEffect, useMemo, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Modal, TextInput, KeyboardAvoidingView, FlatList,
  ActivityIndicator, Alert, RefreshControl, Switch, Image,
} from "react-native";
import Animated, { FadeInDown, FadeInRight } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { supabase } from "@/lib/supabase";
import { Colors, Radius, Shadow, MonoLabel } from "@/constants/theme";
import { DEFAULT_PERMISSIONS, parsePermissions, type StaffPermissions } from "@/lib/permissions";
import { useTheme } from "@/lib/theme";
import { ScreenHeader } from "@/components/ui";
import ModalHeader from "@/components/ModalHeader";
import { Config, authedFetch } from "@/lib/config";
import { useAuth } from "@/lib/auth";
import { fmt12 } from "@/lib/format";
import { validarCorreo } from "@/lib/contacto";
import { validarContrasena, traducirErrorAuth, AYUDA_CONTRASENA } from "@/lib/cuenta";
import { useRecarga, useGuardRespuestas } from "@/lib/useRecarga";
import { exigirFilas, mensajeError, revisar, traerTodo } from "@/lib/db";
import Avatar from "@/components/Avatar";
import ErrorState from "@/components/ErrorState";
import { cargarListaSedes, sedeDeFila, type SedeLite } from "@/components/SedeChip";
import { useSedeActiva } from "@/lib/active-location";

/**
 * El descanso no se edita aquí, pero viaja intacto: antes se descartaba al
 * leer y al guardar, así que editar el horario propio de un profesional le
 * borraba el descanso (y con él el break_soft) que venía del panel web o del
 * horario del negocio.
 */
type Descanso = { break_start?: string | null; break_end?: string | null; break_soft?: boolean | null };
type DayConfig = { enabled: boolean; start: string; end: string } & Descanso;
type ProSchedule = { mon: DayConfig; tue: DayConfig; wed: DayConfig; thu: DayConfig; fri: DayConfig; sat: DayConfig; sun: DayConfig };
type Pro = {
  id: string; name: string; role: string; is_active: boolean | null; user_id: string | null;
  email: string | null; photo_url: string | null; avatar_url: string | null;
  schedule?: unknown; permissions?: unknown;
  /** Sede donde atiende. null = ficha vieja sin sede (antes del 29-sep): trabaja en todas. */
  location_id?: string | null;
};

const DAYS: { key: keyof ProSchedule; label: string; largo: string }[] = [
  { key: "mon", label: "Lun", largo: "lunes" }, { key: "tue", label: "Mar", largo: "martes" },
  { key: "wed", label: "Mié", largo: "miércoles" }, { key: "thu", label: "Jue", largo: "jueves" },
  { key: "fri", label: "Vie", largo: "viernes" }, { key: "sat", label: "Sáb", largo: "sábado" },
  { key: "sun", label: "Dom", largo: "domingo" },
];
// 05:00 a 23:30 cada media hora (antes estaba declarado y no se usaba: las
// horas del horario propio no se podían cambiar, AJU-17).
const TIME_OPTS = Array.from({ length: 38 }, (_, i) => {
  const total = 300 + i * 30;
  const h = Math.floor(total / 60), m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
});
const DOW_KEYS: (keyof ProSchedule)[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/**
 * Base cuando el negocio no configuró su horario: lunes a sábado 9 a 6.
 * Antes era "solo viernes", y activar el horario propio en uno de los 11
 * negocios sin horario dejaba al profesional disponible solo los viernes.
 */
function horarioBase(): ProSchedule {
  const on: DayConfig = { enabled: true, start: "09:00", end: "18:00" };
  return { mon: on, tue: on, wed: on, thu: on, fri: on, sat: on, sun: { enabled: false, start: "09:00", end: "18:00" } };
}

function buildSched(raw: unknown, base: ProSchedule = horarioBase()): ProSchedule {
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, ({ open?: boolean; enabled?: boolean; start?: string; end?: string } & Descanso) | undefined>;
  const merged: ProSchedule = { ...base };
  // Formato canónico (el que leen la reserva online y la agenda): claves "0".."6" con {open,start,end}
  for (let d = 0; d < 7; d++) {
    const c = r[String(d)];
    if (c) merged[DOW_KEYS[d]] = { enabled: !!(c.open ?? c.enabled), start: c.start ?? "09:00", end: c.end ?? "18:00", ...descansoDe(c) };
  }
  // Formato legado del editor móvil: claves mon..sun con {enabled}
  for (const k of Object.keys(base) as (keyof ProSchedule)[]) {
    const c = r[k];
    if (c) merged[k] = { enabled: !!c.enabled, start: c.start ?? "09:00", end: c.end ?? "18:00", ...descansoDe(c) };
  }
  return merged;
}

function descansoDe(c: Descanso): Descanso {
  if (!c.break_start || !c.break_end) return {};
  return { break_start: c.break_start, break_end: c.break_end, ...(typeof c.break_soft === "boolean" ? { break_soft: c.break_soft } : {}) };
}

// Se guarda siempre en el formato canónico para que la reserva online del web y la agenda lo respeten
function toCanonical(sched: ProSchedule): Record<string, { open: boolean; start: string; end: string } & Descanso> {
  const out: Record<string, { open: boolean; start: string; end: string } & Descanso> = {};
  DOW_KEYS.forEach((k, dow) => {
    out[String(dow)] = { open: sched[k].enabled, start: sched[k].start, end: sched[k].end, ...descansoDe(sched[k]) };
  });
  return out;
}

/** Primer día abierto con la hora de cierre antes (o igual) que la de apertura. */
function diaInvalido(sched: ProSchedule): string | null {
  for (const d of DAYS) {
    const c = sched[d.key];
    if (c.enabled && c.start >= c.end) return d.largo;
  }
  return null;
}

// ── Selector de hora ─────────────────────────────────────────────────────────
function HoraSelector({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const { t } = useTheme();
  const [open, setOpen] = useState(false);
  const opciones = TIME_OPTS.includes(value) ? TIME_OPTS : [...TIME_OPTS, value].sort();
  return (
    <>
      <TouchableOpacity
        style={[hs.btn, { backgroundColor: t.chipBg, borderColor: t.line }]}
        onPress={() => setOpen(true)} activeOpacity={0.7}
        accessibilityRole="button" accessibilityLabel={`${label}: ${fmt12(value)}`}
      >
        <Text style={[hs.valor, { color: t.text }]}>{fmt12(value)}</Text>
        <Ionicons name="chevron-down" size={12} color={t.subtle} />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        {/* accessible={false}: si el fondo tocable agrupara a sus hijos, VoiceOver
            no llegaría a las horas de la lista. Se cierra eligiendo una hora o
            con el gesto de escape. */}
        <TouchableOpacity style={hs.overlay} onPress={() => setOpen(false)} activeOpacity={1} accessible={false}>
          <View
            style={[hs.sheet, { backgroundColor: t.cardSolid }]}
            accessibilityViewIsModal
            onAccessibilityEscape={() => setOpen(false)}
          >
            <Text style={[hs.titulo, { color: t.text }]}>{label}</Text>
            <FlatList
              data={opciones}
              keyExtractor={i => i}
              initialScrollIndex={Math.max(0, opciones.indexOf(value) - 3)}
              getItemLayout={(_, index) => ({ length: 46, offset: 46 * index, index })}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[hs.opcion, item === value && { backgroundColor: Colors.red + "14" }]}
                  onPress={() => { onChange(item); setOpen(false); }}
                  activeOpacity={0.75}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: item === value }}
                  accessibilityLabel={fmt12(item)}
                >
                  <Text style={[hs.opcionTxt, { color: item === value ? Colors.red : t.text }]}>{fmt12(item)}</Text>
                  {item === value && <Ionicons name="checkmark" size={16} color={Colors.red} />}
                </TouchableOpacity>
              )}
              style={{ maxHeight: 330 }}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const hs = StyleSheet.create({
  btn:       { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: Radius.sm, paddingHorizontal: 9, paddingVertical: 6 },
  valor:     { fontSize: 12.5, fontFamily: "SpaceGrotesk_600SemiBold" },
  overlay:   { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet:     { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40 },
  titulo:    { fontSize: 14, fontFamily: "SpaceGrotesk_700Bold", marginBottom: 12, textAlign: "center" },
  opcion:    { height: 46, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, borderRadius: Radius.sm },
  opcionTxt: { fontSize: 15, fontFamily: "SpaceGrotesk_600SemiBold" },
});

// ── Foto ─────────────────────────────────────────────────────────────────────
type Subida = { ok: true; url: string } | { ok: false; mensaje: string };

/**
 * Sube la foto a professionals/<tenantId>/<proId>.jpg. La carpeta del negocio
 * es la que exigen las policies de Storage por negocio (SEG-05 / ESQ-15); la
 * ruta plana de antes dejaba a cualquier cuenta pisar la foto.
 */
function subirFoto(uri: string, tenantId: string, proId: string): Promise<Subida> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", uri);
    xhr.responseType = "blob";
    xhr.onload = async () => {
      try {
        const blob: Blob = xhr.response;
        const path = `${tenantId}/${proId}.jpg`;
        const { error } = await supabase.storage
          .from("professionals")
          .upload(path, blob, { contentType: "image/jpeg", upsert: true });
        if (error) { resolve({ ok: false, mensaje: mensajeError(error, "No se pudo subir la foto") }); return; }
        const { data } = supabase.storage.from("professionals").getPublicUrl(path);
        resolve({ ok: true, url: `${data.publicUrl}?t=${Date.now()}` });
      } catch (e) {
        resolve({ ok: false, mensaje: mensajeError(e, "No se pudo subir la foto") });
      }
    };
    xhr.onerror = () => resolve({ ok: false, mensaje: "No se pudo leer la foto del teléfono." });
    xhr.send();
  });
}

function ProModal({ visible, pro, tenantId, sedes, sedeActiva, onClose, onSaved }: {
  visible: boolean; pro: Pro | null; tenantId: string;
  sedes: readonly SedeLite[]; sedeActiva: string | null;
  onClose: () => void; onSaved: () => Promise<void> | void;
}) {
  const { t } = useTheme();
  const isEdit = pro !== null;
  const activo = pro?.is_active !== false;
  const guardHorario = useGuardRespuestas();
  const [name, setName]         = useState("");
  const [role, setRole]         = useState("");
  const [saving, setSaving]     = useState(false);
  const [cambiandoEstado, setCambiandoEstado] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);

  const [accEmail, setAccEmail]     = useState("");
  const [accPass, setAccPass]       = useState("");
  const [accLoading, setAccLoading] = useState(false);
  const [accSuccess, setAccSuccess] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [useCustomSched, setUseCustomSched] = useState(false);
  const [proSched, setProSched]     = useState<ProSchedule>(horarioBase());
  const [bizSched, setBizSched]     = useState<ProSchedule | null>(null);
  const [bizCargando, setBizCargando] = useState(false);
  const [bizError, setBizError]     = useState(false);
  const [perms, setPerms]           = useState<StaffPermissions>(DEFAULT_PERMISSIONS);
  // Sede donde atiende ("" = sin elegir / sin sede). Con varias sedes la elige
  // el dueño; con una sola va a esa, igual que el panel web.
  const [sedeId, setSedeId]         = useState("");
  const eligeSede = sedes.length > 1;

  useEffect(() => {
    if (!visible) return;
    setName(pro?.name ?? "");
    setRole(pro?.role ?? "");
    setAccEmail(pro?.email ?? "");
    setAccPass("");
    setAccSuccess(false);
    setPhotoUri(null);
    setPerms(parsePermissions(pro?.permissions));
    // El horario propio se fija YA, a partir de la ficha. Antes esperaba a
    // leer el del negocio y, con la red lenta, guardar a tiempo mandaba
    // schedule: null y borraba el horario del profesional (AJU-16).
    const propio = pro?.schedule ? buildSched(pro.schedule) : null;
    setUseCustomSched(!!propio);
    setProSched(propio ?? horarioBase());
    setBizSched(null);
    setBizError(false);
    setBizCargando(true);
    const turno = guardHorario.nuevo();
    supabase.from("tenants").select("settings").eq("id", tenantId).single()
      .then(({ data, error }) => {
        if (!turno.vigente()) return;
        setBizCargando(false);
        if (error) { setBizError(true); return; }
        const raw = (data?.settings as { schedule?: unknown } | null)?.schedule;
        const biz = raw ? buildSched(raw) : null;
        setBizSched(biz);
        if (!propio) setProSched(biz ?? horarioBase());
      });
  }, [visible, pro, tenantId, guardHorario]);

  // Aparte: la sede activa llega después de abrir el modal (se lee del teléfono).
  useEffect(() => {
    if (visible) setSedeId(pro ? (pro.location_id ?? "") : (sedeActiva ?? ""));
  }, [visible, pro, sedeActiva]);

  const pickPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permiso requerido", "Necesitamos acceso a tu galería para elegir la foto.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled) setPhotoUri(result.assets[0].uri);
  };

  const canSave = name.trim().length >= 2;

  const handleSave = async () => {
    if (!canSave) return;
    const malo = useCustomSched ? diaInvalido(proSched) : null;
    if (malo) {
      Alert.alert("Revisa el horario", `El ${malo} la hora de salida debe ser después de la de entrada.`);
      return;
    }
    // Una ficha nueva SIEMPRE lleva sede (auditoría #12 del web, 29-sep): sin
    // location_id desaparecía de la agenda de la sede y de "Sin preferencia"
    // en la reserva, que filtran por sede.
    const sedeNueva: string | null = eligeSede
      ? (sedeId || null)
      : (sedeActiva ?? (sedes.length === 1 ? sedes[0].id : null));
    if (!isEdit && eligeSede && !sedeNueva) {
      Alert.alert("Elige la sede", "Elige la sede donde atiende este profesional.");
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(), role: role.trim() || "Profesional",
        schedule: useCustomSched ? toCanonical(proSched) : null,
        permissions: perms,
      };
      // Al editar solo cambia la sede si el dueño eligió otra (sirve para
      // asignarla a las fichas viejas en NULL).
      if (isEdit ? eligeSede && sedeNueva && sedeNueva !== pro?.location_id : true) payload.location_id = sedeNueva;
      let proId: string;
      if (isEdit) {
        exigirFilas(
          await supabase.from("professionals").update(payload).eq("id", pro!.id).select("id"),
          "No se pudieron guardar los cambios",
        );
        proId = pro!.id;
      } else {
        const fila = revisar(
          await supabase.from("professionals").insert({ ...payload, tenant_id: tenantId, is_active: true }).select("id").single(),
          "No se pudo agregar el profesional",
        );
        proId = (fila as { id: string }).id;
      }

      // La foto va aparte: si falla, lo demás ya quedó guardado y se avisa.
      let avisoFoto: string | null = null;
      if (photoUri) {
        const sub = await subirFoto(photoUri, tenantId, proId);
        if (sub.ok) {
          // Ambas columnas: la app lee photo_url y el portal web avatar_url.
          const r = await supabase.from("professionals").update({ photo_url: sub.url, avatar_url: sub.url }).eq("id", proId).select("id");
          if (r.error || !r.data?.length) avisoFoto = mensajeError(r.error ?? { code: "SIN_FILAS" }, "La foto se subió pero no quedó en la ficha");
        } else {
          avisoFoto = sub.mensaje;
        }
      }
      await onSaved();
      if (avisoFoto) Alert.alert("Guardado sin la foto", avisoFoto);
      onClose();
    } catch (e) {
      // El modal queda abierto con lo escrito: antes se cerraba como si
      // hubiera guardado (AJU-16).
      Alert.alert("No se guardó", mensajeError(e));
    } finally { setSaving(false); }
  };

  /**
   * D1: nunca se borra un profesional desde la app. Borrarlo eliminaba en
   * cascada sus citas, sus comisiones pagadas y su regla (AJU-01). Desactivarlo
   * lo saca de la agenda y de la reserva y le quita el acceso a la app (D5),
   * y se puede revertir.
   */
  const cambiarEstado = async (nuevo: boolean) => {
    if (!pro) return;
    setCambiandoEstado(true);
    try {
      exigirFilas(
        await supabase.from("professionals").update({ is_active: nuevo }).eq("id", pro.id).select("id"),
        nuevo ? "No se pudo reactivar" : "No se pudo desactivar",
      );
      await onSaved();
      onClose();
    } catch (e) {
      Alert.alert(nuevo ? "No se reactivó" : "No se desactivó", mensajeError(e));
    } finally {
      setCambiandoEstado(false);
    }
  };

  const confirmarDesactivar = () => {
    if (!pro) return;
    Alert.alert(
      `Desactivar a ${pro.name}`,
      "Deja de recibir citas, sale de la reserva en línea y pierde el acceso a la app. Sus citas, cobros y comisiones se conservan en los reportes. Puedes reactivarlo cuando quieras.",
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Desactivar", style: "destructive", onPress: () => cambiarEstado(false) },
      ],
    );
  };

  const handleCreateAccount = async () => {
    const correo = validarCorreo(accEmail);
    if (!correo.ok) { Alert.alert("Revisa el correo", correo.error!); return; }
    const errPass = validarContrasena(accPass);
    if (errPass) { Alert.alert("Contraseña", errPass); return; }
    setAccLoading(true);
    try {
      const res = await authedFetch(Config.edgeFunctions.createStaffUser, {
        method: "POST",
        body: JSON.stringify({ professional_id: pro!.id, email: correo.valor, password: accPass }),
      });
      const json = await res.json().catch(() => ({} as { error?: string }));
      if (!res.ok) {
        const msg = String(json?.error ?? "");
        Alert.alert(
          "No se creó la cuenta",
          /already|registered|exists/i.test(msg)
            ? "Ese correo ya tiene una cuenta en Zyncra. Usa otro correo, o escríbenos a soporte para vincular la cuenta existente."
            : "No pudimos crear la cuenta. Inténtalo de nuevo en un momento.",
        );
        return;
      }
      setAccSuccess(true);
      await onSaved();
    } catch (e) {
      Alert.alert("No se creó la cuenta", mensajeError(e));
    } finally { setAccLoading(false); }
  };

  /**
   * El dueño no puede ver ni cambiar la contraseña del colaborador (haría falta
   * una función de servidor con permisos de administrador). Lo que sí puede es
   * mandarle el correo de recuperación, el mismo del "¿Olvidaste tu contraseña?"
   * (AJU-09).
   */
  const enviarRestablecer = async () => {
    const correo = pro?.email;
    if (!correo) return;
    setResetLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(correo, { redirectTo: Config.urls.restablecerContrasena });
      if (error) { Alert.alert("No se envió", traducirErrorAuth(error)); return; }
      Alert.alert("Correo enviado", `Le enviamos a ${correo} un enlace para crear una contraseña nueva. Que revise también el spam.`);
    } catch (e) {
      Alert.alert("No se envió", traducirErrorAuth(e));
    } finally {
      setResetLoading(false);
    }
  };

  const hasAccount = !!(pro?.user_id || accSuccess);
  const ocupado = saving || cambiandoEstado;
  const inputStyle = [s.input, { backgroundColor: t.inputBg, borderColor: t.inputBorder, color: t.text }];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <ModalHeader title={isEdit ? "Editar profesional" : "Nuevo profesional"} onClose={onClose} />

        <KeyboardAvoidingView style={{ flex: 1 }}>
          <ScrollView automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingBottom: 120 }}>
            {isEdit && !activo && (
              <View style={[s.aviso, { backgroundColor: t.chipBg, borderColor: t.line }]}>
                <Ionicons name="person-remove-outline" size={16} color={t.muted} />
                <Text style={[s.avisoTxt, { color: t.muted }]}>
                  Desactivado: no recibe citas, no aparece en la reserva y no puede entrar a la app.
                </Text>
              </View>
            )}

            {/* Photo picker */}
            <TouchableOpacity style={s.photoPicker} onPress={pickPhoto} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel="Cambiar foto">
              {(photoUri || pro?.avatar_url || pro?.photo_url) ? (
                <Image source={{ uri: (photoUri ?? pro?.avatar_url ?? pro?.photo_url)! }} style={s.photoImg} />
              ) : (
                <View style={s.photoPlaceholder}>
                  <Text style={s.photoInitials}>
                    {name.trim() ? name.trim().split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase() : "?"}
                  </Text>
                </View>
              )}
              <View style={[s.photoEditBadge, { borderColor: t.bg }]}>
                <Ionicons name="camera" size={14} color="white" />
              </View>
            </TouchableOpacity>
            <Text style={[s.photoHint, { color: t.muted }]}>Toca para cambiar la foto</Text>

            <Text style={[s.fieldLabel, { marginTop: 20, color: t.muted }]}>Nombre *</Text>
            <TextInput style={inputStyle} value={name} onChangeText={setName} placeholder="Ej: María López" placeholderTextColor={t.subtle} autoCapitalize="words" accessibilityLabel="Nombre" />

            <Text style={[s.fieldLabel, { marginTop: 16, color: t.muted }]}>Cargo / Especialidad</Text>
            <TextInput style={inputStyle} value={role} onChangeText={setRole} placeholder="Ej: Estilista, Barbero..." placeholderTextColor={t.subtle} autoCapitalize="words" accessibilityLabel="Cargo" />

            {eligeSede && (
              <>
                <Text style={[s.fieldLabel, { marginTop: 16, color: t.muted }]}>Sede{isEdit ? "" : " *"}</Text>
                <View style={s.sedeRow}>
                  {sedes.map(l => {
                    const activa = sedeId === l.id;
                    return (
                      <TouchableOpacity
                        key={l.id}
                        style={[s.sedeChip, { borderColor: activa ? Colors.blue : t.lineStrong, backgroundColor: activa ? Colors.blue + "18" : "transparent" }]}
                        onPress={() => setSedeId(l.id)}
                        activeOpacity={0.75}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: activa }}
                      >
                        <Text style={[s.sedeChipText, { color: activa ? Colors.blue : t.text }]}>{l.name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <Text style={[s.switchSub, { color: t.subtle, marginTop: 6 }]}>
                  {isEdit && !pro?.location_id && !sedeId
                    ? "Sin sede asignada: sale en todas. Elige la sede donde atiende."
                    : "Sale en la agenda y en la reserva en línea de esta sede. Sus citas ya agendadas no cambian de sede."}
                </Text>
              </>
            )}

            <View style={{ marginTop: 28 }}>
              <Text style={[s.fieldLabel, { marginBottom: 12, color: t.muted }]}>Cuenta de acceso</Text>
              {!isEdit ? (
                <Text style={[s.accountCardSub, { color: t.muted }]}>
                  Guarda el profesional y luego ábrelo para crearle una cuenta de acceso a la app.
                </Text>
              ) : hasAccount ? (
                <View style={[s.accountCard, { backgroundColor: t.card, borderColor: activo ? Colors.success + "55" : t.cardBorder }]}>
                  <View style={s.accountCardRow}>
                    <View style={[s.accountIcon, { backgroundColor: (activo ? Colors.success : Colors.red) + "18" }]}>
                      <Ionicons name={activo ? "shield-checkmark-outline" : "lock-closed-outline"} size={18} color={activo ? Colors.success : Colors.red} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.accountCardTitle, { color: activo ? Colors.success : Colors.red }]}>
                        {activo ? "Cuenta activa" : "Acceso bloqueado"}
                      </Text>
                      <Text style={[s.accountCardSub, { color: t.muted }]}>{pro?.email ?? accEmail}</Text>
                    </View>
                  </View>
                  {activo && pro?.email ? (
                    <TouchableOpacity
                      style={[s.accBtnSec, { borderColor: t.lineStrong }]} onPress={enviarRestablecer}
                      disabled={resetLoading} activeOpacity={0.8} accessibilityRole="button"
                    >
                      {resetLoading
                        ? <ActivityIndicator size="small" color={t.text} />
                        : <Ionicons name="mail-outline" size={15} color={t.text} />}
                      <Text style={[s.accBtnSecText, { color: t.text }]}>Enviarle correo para cambiar su contraseña</Text>
                    </TouchableOpacity>
                  ) : null}
                  <Text style={[s.accountCardSub, { color: t.subtle, marginTop: 10 }]}>
                    {activo
                      ? "Para quitarle el acceso, desactívalo abajo. Su historial se conserva."
                      : "Reactívalo abajo para devolverle el acceso con la misma cuenta."}
                  </Text>
                </View>
              ) : (
                <View style={[s.accountCard, { backgroundColor: t.card, borderColor: t.cardBorder }]}>
                  <View style={s.accountCardRow}>
                    <View style={[s.accountIcon, { backgroundColor: "#f59e0b18" }]}>
                      <Ionicons name="person-add-outline" size={18} color="#f59e0b" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.accountCardTitle, { color: t.text }]}>Sin cuenta de acceso</Text>
                      <Text style={[s.accountCardSub, { color: t.muted }]}>Crea una cuenta para que pueda ingresar</Text>
                    </View>
                  </View>
                  <Text style={[s.fieldLabel, { marginTop: 16, color: t.muted }]}>Correo</Text>
                  <TextInput style={inputStyle} value={accEmail} onChangeText={setAccEmail} placeholder="correo@ejemplo.com" placeholderTextColor={t.subtle} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} accessibilityLabel="Correo de la cuenta" />
                  <Text style={[s.fieldLabel, { marginTop: 12, color: t.muted }]}>Contraseña inicial</Text>
                  <TextInput style={inputStyle} value={accPass} onChangeText={setAccPass} placeholder={AYUDA_CONTRASENA} placeholderTextColor={t.subtle} secureTextEntry autoCapitalize="none" accessibilityLabel="Contraseña inicial" />
                  <TouchableOpacity style={[s.accBtn, accLoading && { opacity: 0.6 }]} onPress={handleCreateAccount} disabled={accLoading} activeOpacity={0.8} accessibilityRole="button">
                    {accLoading
                      ? <ActivityIndicator color="white" size="small" />
                      : <><Ionicons name="key-outline" size={16} color="white" /><Text style={s.accBtnText}>Crear cuenta de acceso</Text></>
                    }
                  </TouchableOpacity>
                </View>
              )}
            </View>

            {/* Schedule section */}
            <View style={{ marginTop: 28 }}>
              <View style={[s.switchRow, Shadow.sm, { backgroundColor: t.card, borderColor: t.cardBorder }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[s.switchLabel, { color: t.text }]}>Horario propio</Text>
                  <Text style={[s.switchSub, { color: t.muted }]}>
                    {bizCargando ? "Leyendo el horario del negocio…" : "Diferente al horario del negocio"}
                  </Text>
                </View>
                <Switch
                  value={useCustomSched}
                  // Mientras se lee el horario del negocio no se puede activar:
                  // partiría de una base que no es la real.
                  disabled={bizCargando}
                  onValueChange={v => { setUseCustomSched(v); if (v && !pro?.schedule) setProSched(bizSched ?? horarioBase()); }}
                  trackColor={{ false: t.lineStrong, true: Colors.blue + "aa" }}
                  thumbColor={useCustomSched ? Colors.blue : t.subtle}
                  accessibilityLabel="Horario propio"
                />
              </View>
              {useCustomSched && bizError && !pro?.schedule && (
                <Text style={[s.switchSub, { color: t.subtle, marginTop: 8 }]}>
                  No pudimos leer el horario del negocio; partimos de lunes a sábado, 9:00 AM a 6:00 PM.
                </Text>
              )}
              {useCustomSched && DAYS.map(({ key, label, largo }) => {
                const day = proSched[key];
                const malo = day.enabled && day.start >= day.end;
                return (
                  <View key={key} style={[s.schedRow, { backgroundColor: t.card, borderColor: malo ? Colors.red : t.border }]}>
                    <TouchableOpacity
                      style={[s.schedDayBtn, day.enabled && { backgroundColor: Colors.blue + "18" }]}
                      onPress={() => setProSched(p => ({ ...p, [key]: { ...p[key], enabled: !p[key].enabled } }))}
                      accessibilityRole="switch"
                      accessibilityState={{ checked: day.enabled }}
                      accessibilityLabel={`Trabaja el ${largo}`}
                    >
                      <Text style={[s.schedDayLabel, { color: day.enabled ? Colors.blue : t.muted }]}>{label}</Text>
                    </TouchableOpacity>
                    {day.enabled ? (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <HoraSelector label={`Entrada del ${largo}`} value={day.start} onChange={v => setProSched(p => ({ ...p, [key]: { ...p[key], start: v } }))} />
                        <Text style={[s.schedTimeSep, { color: t.muted }]}>a</Text>
                        <HoraSelector label={`Salida del ${largo}`} value={day.end} onChange={v => setProSched(p => ({ ...p, [key]: { ...p[key], end: v } }))} />
                      </View>
                    ) : (
                      <Text style={[s.schedTimeSep, { color: t.subtle }]}>No trabaja</Text>
                    )}
                  </View>
                );
              })}
            </View>

            {/* Permisos: qué puede ver esta cuenta en la app de staff */}
            <View style={{ marginTop: 28 }}>
              <Text style={[MonoLabel, { marginBottom: 10, color: t.subtle }]}>Qué puede ver esta cuenta</Text>
              {([
                { k: "contact" as const, titulo: "Contacto de clientes", sub: "Teléfono, correo y botones de llamar/WhatsApp" },
                { k: "amounts" as const, titulo: "Montos y precios", sub: "Valores de servicios y total gastado por cliente" },
                { k: "clients_tab" as const, titulo: "Pestaña de Clientes", sub: "La lista completa de sus clientes con historial" },
              ]).map((p, i) => (
                <View key={p.k} style={[s.switchRow, Shadow.sm, { backgroundColor: t.card, borderColor: t.cardBorder }, i > 0 && { marginTop: 10 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.switchLabel, { color: t.text }]}>{p.titulo}</Text>
                    <Text style={[s.switchSub, { color: t.muted }]}>{p.sub}</Text>
                  </View>
                  <Switch
                    value={perms[p.k]}
                    onValueChange={v => setPerms(prev => ({ ...prev, [p.k]: v }))}
                    trackColor={{ false: t.lineStrong, true: Colors.blue + "aa" }}
                    thumbColor={perms[p.k] ? Colors.blue : t.subtle}
                    accessibilityLabel={p.titulo}
                  />
                </View>
              ))}
            </View>

            {isEdit && (
              <View style={[s.acciones, { borderTopColor: t.line }]}>
                {activo ? (
                  <TouchableOpacity
                    style={[s.accionBtn, { borderColor: Colors.red + "55" }]} onPress={confirmarDesactivar}
                    disabled={ocupado} activeOpacity={0.75} accessibilityRole="button"
                  >
                    {cambiandoEstado
                      ? <ActivityIndicator size="small" color={Colors.red} />
                      : <Ionicons name="person-remove-outline" size={16} color={Colors.red} />}
                    <Text style={[s.accionTxt, { color: Colors.red }]}>Desactivar profesional</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[s.accionBtn, { borderColor: t.lineStrong }]} onPress={() => cambiarEstado(true)}
                    disabled={ocupado} activeOpacity={0.75} accessibilityRole="button"
                  >
                    {cambiandoEstado
                      ? <ActivityIndicator size="small" color={t.text} />
                      : <Ionicons name="person-add-outline" size={16} color={t.text} />}
                    <Text style={[s.accionTxt, { color: t.text }]}>Reactivar profesional</Text>
                  </TouchableOpacity>
                )}
                <Text style={[s.accionNota, { color: t.subtle }]}>
                  Los profesionales no se eliminan: así sus citas, cobros y comisiones siguen en tus reportes.
                </Text>
              </View>
            )}
          </ScrollView>

          <View style={[s.bottomBar, { borderTopColor: t.border, backgroundColor: t.bg }]}>
            <TouchableOpacity
              style={[s.btn, !canSave && { opacity: 0.4 }]} onPress={handleSave}
              disabled={!canSave || ocupado} activeOpacity={0.85}
              accessibilityRole="button" accessibilityState={{ disabled: !canSave || ocupado, busy: saving }}
            >
              <View style={s.btnGrad}>
                {saving ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>{isEdit ? "Guardar cambios" : "Agregar profesional"}</Text>}
              </View>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}


export default function TeamScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const { tenantId } = useAuth();
  const guard = useGuardRespuestas();
  const [pros, setPros]             = useState<Pro[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]           = useState<unknown>(null);
  const [modal, setModal]           = useState<{ visible: boolean; pro: Pro | null }>({ visible: false, pro: null });
  const { locationId: sedeActiva } = useSedeActiva(tenantId);
  const [sedes, setSedes]           = useState<SedeLite[]>([]);
  useEffect(() => {
    if (!tenantId) return;
    let vigente = true;
    cargarListaSedes(tenantId, sedeActiva).then(l => { if (vigente) setSedes(l); });
    return () => { vigente = false; };
  }, [tenantId, sedeActiva]);

  const { recargar } = useRecarga(async () => {
    if (!tenantId) return;
    const turno = guard.nuevo();
    try {
      const filas = await traerTodo<Pro>((d, h) =>
        supabase.from("professionals")
          .select("id, name, role, is_active, user_id, email, photo_url, avatar_url, schedule, permissions, location_id")
          .eq("tenant_id", tenantId).order("name").order("id").range(d, h),
      { contexto: "No se pudo cargar tu equipo" });
      if (!turno.vigente()) return;
      setPros(filas);
      setError(null);
    } catch (e) {
      if (turno.vigente()) setError(e);
    }
  }, [tenantId], { habilitado: !!tenantId, alCambiarDia: false, alCambiarSede: false });

  const onRefresh = async () => { setRefreshing(true); await recargar(); setRefreshing(false); };

  const activos = useMemo(() => (pros ?? []).filter(p => p.is_active !== false), [pros]);
  const inactivos = useMemo(() => (pros ?? []).filter(p => p.is_active === false), [pros]);

  if (error && !pros) return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader crumb="Negocio" title="Equipo" onBack={() => router.back()} />
      <ErrorState error={error} onRetry={recargar} />
    </SafeAreaView>
  );

  const renderPro = (p: Pro, i: number) => {
    const activo = p.is_active !== false;
    return (
      <Animated.View key={p.id} entering={i < 10 ? FadeInRight.delay(i * 50).duration(320) : undefined}>
        <TouchableOpacity
          style={[s.row, Shadow.sm, { backgroundColor: t.card, borderColor: t.cardBorder }, !activo && { opacity: 0.6 }]}
          onPress={() => setModal({ visible: true, pro: p })}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel={`${p.name}${p.role ? `, ${p.role}` : ""}${activo ? "" : ", desactivado"}`}
        >
          <Avatar name={p.name} photoUrl={p.avatar_url ?? p.photo_url} size={52} color={Colors.red} />
          <View style={{ flex: 1 }}>
            <Text style={[s.name, { color: t.text }]}>{p.name}</Text>
            <Text style={[s.role, { color: t.muted }]}>{p.role}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 5 }}>
              {p.user_id && activo && (
                <View style={s.activeBadge}>
                  <Ionicons name="shield-checkmark" size={10} color={Colors.success} />
                  <Text style={[s.badgeText, { color: Colors.success }]}>Cuenta activa</Text>
                </View>
              )}
              {p.user_id && !activo && (
                <View style={[s.activeBadge, { backgroundColor: Colors.red + "14" }]}>
                  <Ionicons name="lock-closed" size={10} color={Colors.red} />
                  <Text style={[s.badgeText, { color: Colors.red }]}>Sin acceso</Text>
                </View>
              )}
              {sedes.length > 1 && (
                <View style={[s.activeBadge, { backgroundColor: p.location_id ? t.chipBg : "#d9770618" }]}>
                  <Ionicons name="location-outline" size={10} color={p.location_id ? t.muted : "#d97706"} />
                  <Text style={[s.badgeText, { color: p.location_id ? t.muted : "#d97706" }]}>
                    {p.location_id ? sedeDeFila(sedes, p.location_id) : "Sin sede asignada"}
                  </Text>
                </View>
              )}
              {!!p.schedule && (
                <View style={[s.activeBadge, { backgroundColor: Colors.blue + "14" }]}>
                  <Ionicons name="time-outline" size={10} color={Colors.blue} />
                  <Text style={[s.badgeText, { color: Colors.blue }]}>Horario propio</Text>
                </View>
              )}
              {!activo && (
                <View style={[s.inactiveBadge, { backgroundColor: t.chipBg }]}>
                  <Text style={[s.inactiveBadgeText, { color: t.muted }]}>Desactivado</Text>
                </View>
              )}
            </View>
          </View>
          <Ionicons name="chevron-forward" size={16} color={t.subtle} />
        </TouchableOpacity>
      </Animated.View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader
        crumb="Negocio"
        title="Equipo"
        subtitle={pros ? `${activos.length} activo${activos.length !== 1 ? "s" : ""}${inactivos.length ? ` · ${inactivos.length} desactivado${inactivos.length !== 1 ? "s" : ""}` : ""}` : "Cargando…"}
        onBack={() => router.back()}
        rightAction={{ icon: "add", label: "Agregar profesional", onPress: () => setModal({ visible: true, pro: null }) }}
      />

      <ScrollView automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ padding: 20, paddingBottom: 110 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.red} />}
      >
        {error ? (
          <View style={[s.aviso, { backgroundColor: Colors.red + "12", borderColor: Colors.red + "33" }]}>
            <Ionicons name="alert-circle-outline" size={16} color={Colors.red} />
            <Text style={[s.avisoTxt, { color: t.text }]}>{mensajeError(error)}</Text>
          </View>
        ) : null}

        {pros === null ? (
          <ActivityIndicator color={Colors.red} style={{ marginTop: 40 }} />
        ) : pros.length === 0 ? (
          <Animated.View entering={FadeInDown.duration(400)} style={[s.empty, Shadow.sm, { backgroundColor: t.card, borderColor: t.cardBorder }]}>
            <Ionicons name="people-outline" size={44} color={t.subtle} style={{ marginBottom: 12 }} />
            <Text style={[s.emptyTitle, { color: t.text }]}>Sin profesionales</Text>
            <Text style={[s.emptySub, { color: t.muted }]}>Toca + para agregar miembros de tu equipo</Text>
          </Animated.View>
        ) : (
          <>
            {activos.map(renderPro)}
            {inactivos.length > 0 && (
              <>
                <Text style={[MonoLabel, { color: t.subtle, marginTop: 18, marginBottom: 10 }]}>Desactivados</Text>
                {inactivos.map((p, i) => renderPro(p, i + 10))}
              </>
            )}
          </>
        )}
      </ScrollView>

      {tenantId && (
        <ProModal
          visible={modal.visible}
          pro={modal.pro}
          tenantId={tenantId}
          sedes={sedes}
          sedeActiva={sedeActiva}
          onClose={() => setModal({ visible: false, pro: null })}
          onSaved={recargar}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  row:              { borderRadius: Radius.md, borderWidth: 1, padding: 14, flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  name:             { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold" },
  role:             { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", marginTop: 2 },
  activeBadge:      { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: Colors.success + "14", borderRadius: Radius.full, paddingHorizontal: 7, paddingVertical: 3 },
  badgeText:        { fontSize: 10, fontFamily: "SpaceGrotesk_600SemiBold" },
  sedeRow:          { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  sedeChip:         { borderWidth: 1.5, borderRadius: Radius.full, paddingHorizontal: 14, paddingVertical: 8, minHeight: 38, justifyContent: "center" },
  sedeChipText:     { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold" },
  inactiveBadge:    { borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  inactiveBadgeText:{ fontSize: 10, fontFamily: "SpaceGrotesk_600SemiBold" },
  empty:            { borderRadius: Radius.xl, borderWidth: 1, padding: 48, alignItems: "center", marginTop: 20 },
  emptyTitle:       { fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", marginBottom: 6 },
  emptySub:         { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", textAlign: "center" },
  aviso:            { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: Radius.md, padding: 12, marginBottom: 14 },
  avisoTxt:         { flex: 1, fontSize: 12.5, fontFamily: "SpaceGrotesk_400Regular", lineHeight: 17 },
  photoPicker:      { alignSelf: "center", marginBottom: 6 },
  photoImg:         { width: 88, height: 88, borderRadius: 44 },
  photoPlaceholder: { width: 88, height: 88, borderRadius: 44, backgroundColor: Colors.red + "18", borderWidth: 1.5, borderColor: Colors.red + "30", alignItems: "center", justifyContent: "center" },
  photoInitials:    { color: Colors.red, fontSize: 30, fontFamily: "SpaceGrotesk_700Bold" },
  photoEditBadge:   { position: "absolute", bottom: 0, right: 0, width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.red, alignItems: "center", justifyContent: "center", borderWidth: 2 },
  photoHint:        { textAlign: "center", fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", marginBottom: 4 },
  fieldLabel:       { fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 },
  input:            { borderWidth: 1.5, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, fontFamily: "SpaceGrotesk_400Regular" },
  switchRow:        { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: Radius.md, borderWidth: 1, padding: 16, marginTop: 16 },
  switchLabel:      { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold" },
  switchSub:        { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", marginTop: 2 },
  accountCard:      { borderRadius: Radius.md, padding: 16, borderWidth: 1.5 },
  accountCardRow:   { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  accountIcon:      { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  accountCardTitle: { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold" },
  accountCardSub:   { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", marginTop: 2, lineHeight: 17 },
  accBtn:           { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: Colors.red, borderRadius: Radius.md, paddingVertical: 13, marginTop: 14 },
  accBtnText:       { fontSize: 14, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
  accBtnSec:        { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderRadius: Radius.md, paddingVertical: 11, paddingHorizontal: 10, marginTop: 4 },
  accBtnSecText:    { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", flexShrink: 1 },
  schedRow:         { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderRadius: Radius.sm, paddingHorizontal: 10, paddingVertical: 8, marginTop: 6 },
  schedDayBtn:      { width: 44, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  schedDayLabel:    { fontSize: 12, fontFamily: "SpaceGrotesk_700Bold" },
  schedTimeSep:     { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular" },
  acciones:         { borderTopWidth: 1, marginTop: 28, paddingTop: 20 },
  accionBtn:        { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1.5, borderRadius: Radius.md, paddingVertical: 13 },
  accionTxt:        { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold" },
  accionNota:       { fontSize: 11.5, fontFamily: "SpaceGrotesk_400Regular", textAlign: "center", marginTop: 10, lineHeight: 16 },
  bottomBar:        { padding: 20, paddingBottom: 34, borderTopWidth: 1 },
  btn:              { borderRadius: Radius.full, overflow: "hidden" },
  btnGrad:          { paddingVertical: 16, alignItems: "center", backgroundColor: Colors.red },
  btnText:          { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
});
