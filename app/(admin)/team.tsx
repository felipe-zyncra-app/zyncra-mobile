import { useEffect, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Modal, TextInput, KeyboardAvoidingView, Platform,
  ActivityIndicator, Alert, RefreshControl, Switch, Image,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown, FadeInRight } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { supabase } from "@/lib/supabase";
import { Colors, Gradients, Radius, Shadow } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { Config } from "@/lib/config";
import { useAuth } from "@/lib/auth";
import Avatar from "@/components/Avatar";
import ErrorState from "@/components/ErrorState";
import { ScreenHeader } from "@/components/ui";

type DayConfig = { enabled: boolean; start: string; end: string };
type ProSchedule = { mon: DayConfig; tue: DayConfig; wed: DayConfig; thu: DayConfig; fri: DayConfig; sat: DayConfig; sun: DayConfig };
type Pro = { id: string; name: string; role: string; is_active: boolean; user_id: string | null; email: string | null; photo_url: string | null; schedule?: any };

const DAYS: { key: keyof ProSchedule; label: string }[] = [
  { key: "mon", label: "Lun" }, { key: "tue", label: "Mar" }, { key: "wed", label: "Mié" },
  { key: "thu", label: "Jue" }, { key: "fri", label: "Vie" }, { key: "sat", label: "Sáb" }, { key: "sun", label: "Dom" },
];
const TIME_OPTS = Array.from({ length: 29 }, (_, i) => {
  const total = 480 + i * 30; // 08:00 - 22:00 in 30min steps
  const h = Math.floor(total / 60), m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
});
const DEFAULT_DAY: DayConfig = { enabled: false, start: "09:00", end: "18:00" };
function buildSched(raw: any): ProSchedule {
  const base = { mon: DEFAULT_DAY, tue: DEFAULT_DAY, wed: DEFAULT_DAY, thu: DEFAULT_DAY, fri: { enabled: true, start: "09:00", end: "18:00" }, sat: DEFAULT_DAY, sun: DEFAULT_DAY };
  if (!raw || typeof raw !== "object") return base;
  const merged: any = { ...base };
  for (const k of Object.keys(base)) {
    if (raw[k]) merged[k] = { ...DEFAULT_DAY, ...raw[k] };
  }
  return merged as ProSchedule;
}

function ProModal({ visible, pro, tenantId, onClose, onSaved }: {
  visible: boolean; pro: Pro | null; tenantId: string;
  onClose: () => void; onSaved: () => void;
}) {
  const { t } = useTheme();
  const isEdit = pro !== null;
  const [name, setName]         = useState("");
  const [role, setRole]         = useState("");
  const [active, setActive]     = useState(true);
  const [saving, setSaving]     = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);

  const [accEmail, setAccEmail]     = useState("");
  const [accPass, setAccPass]       = useState("");
  const [accLoading, setAccLoading] = useState(false);
  const [accSuccess, setAccSuccess] = useState(false);
  const [useCustomSched, setUseCustomSched] = useState(false);
  const [proSched, setProSched]     = useState<ProSchedule>(buildSched(null));
  const [bizSched, setBizSched]     = useState<ProSchedule>(buildSched(null));

  useEffect(() => {
    if (visible) {
      setName(pro?.name ?? "");
      setRole(pro?.role ?? "");
      setActive(pro?.is_active ?? true);
      setAccEmail(pro?.email ?? "");
      setAccPass("");
      setAccSuccess(false);
      setPhotoUri(null);
      supabase.from("tenants").select("settings").eq("id", tenantId).single()
        .then(({ data }) => {
          const biz = buildSched((data?.settings as any)?.schedule);
          setBizSched(biz);
          if (pro?.schedule) { setUseCustomSched(true); setProSched(buildSched(pro.schedule)); }
          else { setUseCustomSched(false); setProSched(buildSched(biz)); }
        });
    }
  }, [visible, pro]);

  const pickPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permiso requerido", "Necesitamos acceso a tu galeria.");
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

  const uploadPhoto = (proId: string): Promise<string | null> => {
    if (!photoUri) return Promise.resolve(null);
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", photoUri);
      xhr.responseType = "blob";
      xhr.onload = async () => {
        const blob: Blob = xhr.response;
        const path = `${proId}.jpg`;
        const { error } = await supabase.storage
          .from("professionals")
          .upload(path, blob, { contentType: "image/jpeg", upsert: true });
        if (error) { resolve(null); return; }
        const { data } = supabase.storage.from("professionals").getPublicUrl(path);
        resolve(`${data.publicUrl}?t=${Date.now()}`);
      };
      xhr.onerror = () => resolve(null);
      xhr.send();
    });
  };

  const canSave = name.trim().length >= 2;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(), role: role.trim() || "Profesional", is_active: active,
        schedule: useCustomSched ? proSched : null,
      };
      if (isEdit) {
        if (photoUri) {
          const url = await uploadPhoto(pro!.id);
          if (url) payload.photo_url = url;
        }
        await supabase.from("professionals").update(payload).eq("id", pro!.id);
      } else {
        const { data: inserted } = await supabase
          .from("professionals").insert({ ...payload, tenant_id: tenantId }).select("id").single();
        if (inserted && photoUri) {
          const url = await uploadPhoto(inserted.id);
          if (url) await supabase.from("professionals").update({ photo_url: url }).eq("id", inserted.id);
        }
      }
      onSaved(); onClose();
    } finally { setSaving(false); }
  };

  const handleDelete = () => {
    Alert.alert("Eliminar profesional", `Eliminar a ${pro?.name}?`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Eliminar", style: "destructive", onPress: async () => {
        await supabase.from("professionals").delete().eq("id", pro!.id);
        onSaved(); onClose();
      }},
    ]);
  };

  const handleCreateAccount = async () => {
    if (!accEmail.trim() || accPass.length < 6) {
      Alert.alert("Error", "Ingresa un correo valido y contrasena de al menos 6 caracteres.");
      return;
    }
    setAccLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(Config.edgeFunctions.createStaffUser, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session?.access_token}` },
        body: JSON.stringify({ professional_id: pro!.id, email: accEmail.trim().toLowerCase(), password: accPass }),
      });
      const json = await res.json();
      if (!res.ok) { Alert.alert("Error", json.error ?? "Intenta de nuevo."); }
      else { setAccSuccess(true); onSaved(); }
    } catch {
      Alert.alert("Error", "Sin conexion. Intenta de nuevo.");
    } finally { setAccLoading(false); }
  };

  const hasAccount = !!(pro?.user_id || accSuccess);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <View style={[s.mHeader, { backgroundColor: "#0C0C14" }]}>
          <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3 }} />
          <View style={s.mHeaderRow}>
            <TouchableOpacity onPress={onClose} style={s.closeBtn}>
              <Ionicons name="close" size={20} color="white" />
            </TouchableOpacity>
            <Text style={s.mTitle}>{isEdit ? "Editar profesional" : "Nuevo profesional"}</Text>
            {isEdit
              ? <TouchableOpacity onPress={handleDelete} style={s.closeBtn}>
                  <Ionicons name="trash-outline" size={18} color="white" />
                </TouchableOpacity>
              : <View style={{ width: 40 }} />
            }
          </View>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 120 }}>
            {/* Photo picker */}
            <TouchableOpacity style={s.photoPicker} onPress={pickPhoto} activeOpacity={0.8}>
              {(photoUri || pro?.photo_url) ? (
                <Image source={{ uri: photoUri ?? pro?.photo_url! }} style={s.photoImg} />
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
            <TextInput style={[s.input, { backgroundColor: t.bgAlt, borderColor: t.border, color: t.text }]} value={name} onChangeText={setName} placeholder="Ej: Maria Lopez" placeholderTextColor={t.subtle} autoCapitalize="words" />

            <Text style={[s.fieldLabel, { marginTop: 16, color: t.muted }]}>Cargo / Especialidad</Text>
            <TextInput style={[s.input, { backgroundColor: t.bgAlt, borderColor: t.border, color: t.text }]} value={role} onChangeText={setRole} placeholder="Ej: Estilista, Barbero..." placeholderTextColor={t.subtle} autoCapitalize="words" />

            {isEdit && (
              <View style={[s.switchRow, Shadow.sm, { backgroundColor: t.bgAlt }]}>
                <View>
                  <Text style={[s.switchLabel, { color: t.text }]}>Activo</Text>
                  <Text style={[s.switchSub, { color: t.muted }]}>Recibe citas en la agenda</Text>
                </View>
                <Switch
                  value={active}
                  onValueChange={setActive}
                  trackColor={{ false: Colors.border, true: Colors.success + "aa" }}
                  thumbColor={active ? Colors.success : Colors.subtle}
                />
              </View>
            )}

            {isEdit && (
              <View style={{ marginTop: 28 }}>
                <Text style={[s.fieldLabel, { marginBottom: 12, color: t.muted }]}>Cuenta de acceso</Text>
                {hasAccount ? (
                  <View style={[s.accountCard, { backgroundColor: t.bgAlt, borderColor: Colors.success + "55" }]}>
                    <View style={s.accountCardRow}>
                      <View style={[s.accountIcon, { backgroundColor: Colors.success + "18" }]}>
                        <Ionicons name="shield-checkmark-outline" size={18} color={Colors.success} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.accountCardTitle, { color: Colors.success }]}>Cuenta activa</Text>
                        <Text style={[s.accountCardSub, { color: t.muted }]}>{pro?.email ?? accEmail}</Text>
                      </View>
                    </View>
                  </View>
                ) : (
                  <View style={[s.accountCard, { backgroundColor: t.bgAlt, borderColor: t.border }]}>
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
                    <TextInput style={[s.input, { backgroundColor: t.bgAlt, borderColor: t.border, color: t.text }]} value={accEmail} onChangeText={setAccEmail} placeholder="correo@ejemplo.com" placeholderTextColor={t.subtle} keyboardType="email-address" autoCapitalize="none" />
                    <Text style={[s.fieldLabel, { marginTop: 12, color: t.muted }]}>Contrasena inicial</Text>
                    <TextInput style={[s.input, { backgroundColor: t.bgAlt, borderColor: t.border, color: t.text }]} value={accPass} onChangeText={setAccPass} placeholder="Minimo 6 caracteres" placeholderTextColor={t.subtle} secureTextEntry />
                    <TouchableOpacity style={[s.accBtn, accLoading && { opacity: 0.6 }]} onPress={handleCreateAccount} disabled={accLoading} activeOpacity={0.8}>
                      {accLoading
                        ? <ActivityIndicator color="white" size="small" />
                        : <><Ionicons name="key-outline" size={16} color="white" /><Text style={s.accBtnText}>Crear cuenta de acceso</Text></>
                      }
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}
            {/* Schedule section */}
            <View style={{ marginTop: 28 }}>
              <View style={[s.switchRow, Shadow.sm, { backgroundColor: t.bgAlt }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[s.switchLabel, { color: t.text }]}>Horario propio</Text>
                  <Text style={[s.switchSub, { color: t.muted }]}>Diferente al horario del negocio</Text>
                </View>
                <Switch
                  value={useCustomSched}
                  onValueChange={v => { setUseCustomSched(v); if (!v) setProSched(buildSched(bizSched)); }}
                  trackColor={{ false: Colors.border, true: Colors.blue + "aa" }}
                  thumbColor={useCustomSched ? Colors.blue : Colors.subtle}
                />
              </View>
              {useCustomSched && DAYS.map(({ key, label }) => {
                const day = proSched[key];
                return (
                  <View key={key} style={[s.schedRow, { backgroundColor: t.bgAlt, borderColor: t.border }]}>
                    <TouchableOpacity
                      style={[s.schedDayBtn, day.enabled && { backgroundColor: Colors.blue + "18" }]}
                      onPress={() => setProSched(p => ({ ...p, [key]: { ...p[key], enabled: !p[key].enabled } }))}
                    >
                      <Text style={[s.schedDayLabel, { color: day.enabled ? Colors.blue : t.muted }]}>{label}</Text>
                    </TouchableOpacity>
                    {day.enabled && (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={[s.schedTime, { color: t.text }]}>{day.start}</Text>
                        <Text style={[s.schedTimeSep, { color: t.muted }]}>-</Text>
                        <Text style={[s.schedTime, { color: t.text }]}>{day.end}</Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          </ScrollView>

          <View style={[s.bottomBar, { borderTopColor: t.border, backgroundColor: t.bg }]}>
            <TouchableOpacity style={[s.btn, !canSave && { opacity: 0.4 }]} onPress={handleSave} disabled={!canSave || saving} activeOpacity={0.85}>
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
  const [pros, setPros]             = useState<Pro[]>([]);
  const { tenantId } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]           = useState(false);
  const [modal, setModal]           = useState<{ visible: boolean; pro: Pro | null }>({ visible: false, pro: null });

  const load = async () => {
    if (!tenantId) return;
    setError(false);
    try {
      const { data } = await supabase.from("professionals")
        .select("id, name, role, is_active, user_id, email, photo_url, schedule")
        .eq("tenant_id", tenantId).order("name");
      setPros(data ?? []);
    } catch {
      setError(true);
    }
  };

  useEffect(() => {
    let cancelled = false;
    load().then(() => { if (cancelled) return; });
    return () => { cancelled = true; };
  }, [tenantId]);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  if (error) return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader crumb="Negocio" title="Equipo" onBack={() => router.back()} />
      <ErrorState onRetry={load} />
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader
        crumb="Negocio"
        title="Equipo"
        subtitle={`${pros.length} profesionale${pros.length !== 1 ? "s" : ""}`}
        onBack={() => router.back()}
        rightAction={{ icon: "add", onPress: () => setModal({ visible: true, pro: null }) }}
      />

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 110 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.red} />}
      >
        {pros.length === 0 ? (
          <Animated.View entering={FadeInDown.duration(400)} style={[s.empty, Shadow.sm, { backgroundColor: t.bgAlt }]}>
            <Ionicons name="people-outline" size={44} color={t.subtle} style={{ marginBottom: 12 }} />
            <Text style={[s.emptyTitle, { color: t.text }]}>Sin profesionales</Text>
            <Text style={[s.emptySub, { color: t.muted }]}>Toca + para agregar miembros de tu equipo</Text>
          </Animated.View>
        ) : (
          pros.map((p, i) => (
            <Animated.View key={p.id} entering={i < 10 ? FadeInRight.delay(i * 50).duration(320) : undefined}>
              <TouchableOpacity
                style={[s.row, Shadow.sm, { backgroundColor: t.bgAlt }, !p.is_active && { opacity: 0.55 }]}
                onPress={() => setModal({ visible: true, pro: p })}
                activeOpacity={0.75}
              >
                <Avatar name={p.name} photoUrl={p.photo_url} size={52} color={Colors.red} />
                <View style={{ flex: 1 }}>
                  <Text style={[s.name, { color: t.text }]}>{p.name}</Text>
                  <Text style={[s.role, { color: t.muted }]}>{p.role}</Text>
                  <View style={{ flexDirection: "row", gap: 6, marginTop: 5 }}>
                    {p.user_id && (
                      <View style={s.activeBadge}>
                        <Ionicons name="shield-checkmark" size={10} color={Colors.success} />
                        <Text style={[s.badgeText, { color: Colors.success }]}>Cuenta activa</Text>
                      </View>
                    )}
                    {p.schedule && (
                      <View style={[s.activeBadge, { backgroundColor: Colors.blue + "14" }]}>
                        <Ionicons name="time-outline" size={10} color={Colors.blue} />
                        <Text style={[s.badgeText, { color: Colors.blue }]}>Horario propio</Text>
                      </View>
                    )}
                    {!p.is_active && (
                      <View style={s.inactiveBadge}>
                        <Text style={s.inactiveBadgeText}>Inactivo</Text>
                      </View>
                    )}
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={16} color={t.subtle} />
              </TouchableOpacity>
            </Animated.View>
          ))
        )}
      </ScrollView>

      {tenantId && (
        <ProModal
          visible={modal.visible}
          pro={modal.pro}
          tenantId={tenantId}
          onClose={() => setModal({ visible: false, pro: null })}
          onSaved={load}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header:           { paddingTop: 16, paddingHorizontal: 24, paddingBottom: 20 },
  headerRow:        { flexDirection: "row", alignItems: "center", gap: 12 },
  backBtn:          { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,.18)", alignItems: "center", justifyContent: "center" },
  headerTitle:      { fontSize: 22, fontFamily: "SpaceGrotesk_700Bold", color: "white", letterSpacing: -0.4 },
  headerSub:        { fontSize: 12, color: "rgba(255,255,255,.75)", fontFamily: "SpaceGrotesk_400Regular", marginTop: 2 },
  addBtn:           { width: 38, height: 38, borderRadius: 19, backgroundColor: "rgba(255,255,255,.22)", alignItems: "center", justifyContent: "center" },
  row:              { backgroundColor: Colors.white, borderRadius: Radius.md, padding: 14, flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  name:             { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  role:             { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, marginTop: 2 },
  activeBadge:      { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: Colors.success + "14", borderRadius: Radius.full, paddingHorizontal: 7, paddingVertical: 3 },
  badgeText:        { fontSize: 10, fontFamily: "SpaceGrotesk_600SemiBold" },
  inactiveBadge:    { backgroundColor: Colors.border, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  inactiveBadgeText:{ fontSize: 10, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted },
  empty:            { backgroundColor: Colors.white, borderRadius: Radius.xl, padding: 48, alignItems: "center", marginTop: 20 },
  emptyTitle:       { fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text, marginBottom: 6 },
  emptySub:         { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, textAlign: "center" },
  photoPicker:      { alignSelf: "center", marginBottom: 6 },
  photoImg:         { width: 88, height: 88, borderRadius: 44 },
  photoPlaceholder: { width: 88, height: 88, borderRadius: 44, backgroundColor: Colors.red + "18", borderWidth: 1.5, borderColor: Colors.red + "30", alignItems: "center", justifyContent: "center" },
  photoInitials:    { color: Colors.red, fontSize: 30, fontFamily: "SpaceGrotesk_700Bold" },
  photoEditBadge:   { position: "absolute", bottom: 0, right: 0, width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.red, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: Colors.cream2 },
  photoHint:        { textAlign: "center", fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, marginBottom: 4 },
  mHeader:          { paddingTop: 16, paddingHorizontal: 20, paddingBottom: 20 },
  mHeaderRow:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  closeBtn:         { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,.18)", alignItems: "center", justifyContent: "center" },
  mTitle:           { fontSize: 18, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
  fieldLabel:       { fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", color: Colors.muted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 },
  input:            { backgroundColor: Colors.white, borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, fontFamily: "SpaceGrotesk_400Regular", color: Colors.text },
  switchRow:        { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: Colors.white, borderRadius: Radius.md, padding: 16, marginTop: 16 },
  switchLabel:      { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  switchSub:        { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, marginTop: 2 },
  accountCard:      { backgroundColor: Colors.white, borderRadius: Radius.md, padding: 16, borderWidth: 1.5, borderColor: Colors.border },
  accountCardRow:   { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  accountIcon:      { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  accountCardTitle: { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  accountCardSub:   { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, marginTop: 2 },
  accBtn:           { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: Colors.red, borderRadius: Radius.md, paddingVertical: 13, marginTop: 4 },
  accBtnText:       { fontSize: 14, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
  schedRow:         { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.sm, paddingHorizontal: 10, paddingVertical: 8, marginTop: 6 },
  schedDayBtn:      { width: 40, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  schedDayLabel:    { fontSize: 12, fontFamily: "SpaceGrotesk_700Bold" },
  schedTime:        { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold" },
  schedTimeSep:     { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular" },
  bottomBar:        { padding: 20, paddingBottom: 34, borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.cream2 },
  btn:              { borderRadius: Radius.full, overflow: "hidden" },
  btnGrad:          { paddingVertical: 16, alignItems: "center", backgroundColor: Colors.red },
  btnText:          { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
});
