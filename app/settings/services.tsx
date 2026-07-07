import { useEffect, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Modal, TextInput, KeyboardAvoidingView, Platform,
  ActivityIndicator, Alert, RefreshControl,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown, FadeInRight } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { Colors, Gradients, Radius, Shadow } from "@/constants/theme";
import ErrorState from "@/components/ErrorState";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";

type Service = {
  id: string;
  name: string;
  price: number;
  duration_min: number;
  description?: string;
  tags?: string[] | null;
  apptCount?: number;
};

function Field({ label, value, onChangeText, placeholder, keyboardType, multiline }: {
  label: string; value: string; onChangeText: (t: string) => void;
  placeholder: string; keyboardType?: "numeric" | "default"; multiline?: boolean;
}) {
  const { t } = useTheme();
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={[f.label, { color: t.muted }]}>{label}</Text>
      <TextInput
        style={[f.input, { backgroundColor: t.bgAlt, borderColor: t.border, color: t.text }, multiline && { height: 80, textAlignVertical: "top" }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.subtle}
        keyboardType={keyboardType ?? "default"}
        multiline={multiline}
        autoCapitalize={keyboardType === "numeric" ? "none" : "sentences"}
      />
    </View>
  );
}

const f = StyleSheet.create({
  label: { fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", color: Colors.muted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 },
  input: { backgroundColor: Colors.white, borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, fontFamily: "SpaceGrotesk_400Regular", color: Colors.text },
});

function ServiceModal({ visible, service, tenantId, onClose, onSaved }: {
  visible: boolean; service: Service | null; tenantId: string;
  onClose: () => void; onSaved: () => void;
}) {
  const { t } = useTheme();
  const isEdit = service !== null;
  const [name, setName]         = useState("");
  const [price, setPrice]       = useState("");
  const [duration, setDuration] = useState("");
  const [desc, setDesc]         = useState("");
  const [tagInput, setTagInput] = useState("");
  const [saving, setSaving]     = useState(false);

  useEffect(() => {
    if (visible) {
      setName(service?.name ?? "");
      setPrice(service?.price != null ? String(service.price) : "");
      setDuration(service?.duration_min != null ? String(service.duration_min) : "");
      setDesc(service?.description ?? "");
      setTagInput(service?.tags?.join(", ") ?? "");
    }
  }, [visible, service]);

  const canSave = name.trim().length >= 2 && Number(price) > 0;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const parsedTags = tagInput.split(",").map(t => t.trim()).filter(Boolean);
      const payload = {
        name: name.trim(),
        price: Number(price),
        duration_min: Number(duration) || 30,
        description: desc.trim() || null,
        tags: parsedTags.length > 0 ? parsedTags : null,
      };
      if (isEdit) {
        await supabase.from("services").update(payload).eq("id", service!.id);
      } else {
        await supabase.from("services").insert({ ...payload, tenant_id: tenantId, duration_minutes: Number(duration) || 30 });
      }
      onSaved(); onClose();
    } finally { setSaving(false); }
  };

  const handleDelete = () => {
    Alert.alert("Eliminar servicio", `¿Eliminar "${service?.name}"?`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Eliminar", style: "destructive", onPress: async () => {
        await supabase.from("services").delete().eq("id", service!.id);
        onSaved(); onClose();
      }},
    ]);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.mHeader}>
          <View style={s.mHeaderRow}>
            <TouchableOpacity onPress={onClose} style={s.closeBtn}>
              <Ionicons name="close" size={20} color="white" />
            </TouchableOpacity>
            <Text style={s.mTitle}>{isEdit ? "Editar servicio" : "Nuevo servicio"}</Text>
            {isEdit
              ? <TouchableOpacity onPress={handleDelete} style={s.closeBtn}>
                  <Ionicons name="trash-outline" size={18} color="white" />
                </TouchableOpacity>
              : <View style={{ width: 40 }} />
            }
          </View>
        </LinearGradient>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 120 }}>
            <Field label="Nombre del servicio *" value={name} onChangeText={setName} placeholder="Ej: Corte de cabello" />
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Field label="Precio *" value={price} onChangeText={setPrice} placeholder="0" keyboardType="numeric" />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Duración (min)" value={duration} onChangeText={setDuration} placeholder="30" keyboardType="numeric" />
              </View>
            </View>
            <Field label="Descripción" value={desc} onChangeText={setDesc} placeholder="Opcional..." multiline />
            <Field label="Etiquetas (separadas por coma)" value={tagInput} onChangeText={setTagInput} placeholder="Ej: cabello, tintura, express" />
          </ScrollView>
          <View style={[s.bottomBar, { backgroundColor: t.bg, borderTopColor: t.border }]}>
            <TouchableOpacity style={[s.btn, !canSave && { opacity: 0.4 }]} onPress={handleSave} disabled={!canSave || saving} activeOpacity={0.85}>
              <View style={s.btnGrad}>
                {saving ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>{isEdit ? "Guardar cambios" : "Crear servicio"}</Text>}
              </View>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

export default function ServicesScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const [services, setServices]   = useState<Service[]>([]);
  const { tenantId } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [modal, setModal]         = useState<{ visible: boolean; service: Service | null }>({ visible: false, service: null });

  const load = async () => {
    if (!tenantId) return;
    const [{ data: svcs }, { data: appts }] = await Promise.all([
      supabase.from("services").select("id, name, price, duration_min, description, tags").eq("tenant_id", tenantId).order("name"),
      supabase.from("appointments").select("service_id").eq("tenant_id", tenantId).in("status", ["completed", "confirmed"]).limit(5000),
    ]);
    const countMap: Record<string, number> = {};
    (appts ?? []).forEach((a: any) => { if (a.service_id) countMap[a.service_id] = (countMap[a.service_id] ?? 0) + 1; });
    setServices((svcs ?? []).map(s => ({ ...s, apptCount: countMap[s.id] ?? 0 })));
  };

  useEffect(() => {
    let cancelled = false;
    load().then(() => { if (cancelled) return; });
    return () => { cancelled = true; };
  }, [tenantId]);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <LinearGradient colors={Gradients.ink} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.header}>
        <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3 }} />
        <View style={s.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="arrow-back" size={20} color="white" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.headerTitle}>Servicios</Text>
            <Text style={s.headerSub}>{services.length} en tu catálogo</Text>
          </View>
          <TouchableOpacity style={s.addBtn} onPress={() => setModal({ visible: true, service: null })} activeOpacity={0.8}>
            <Ionicons name="add" size={22} color="white" />
          </TouchableOpacity>
        </View>
      </LinearGradient>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 110 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.red} />}
      >
        {services.length === 0 ? (
          <Animated.View entering={FadeInDown.duration(400)} style={[s.empty, Shadow.sm, { backgroundColor: t.bgAlt }]}>
            <Ionicons name="pricetags-outline" size={44} color={t.subtle} style={{ marginBottom: 12 }} />
            <Text style={[s.emptyTitle, { color: t.text }]}>Sin servicios</Text>
            <Text style={[s.emptySub, { color: t.muted }]}>Toca + para agregar tu primer servicio</Text>
          </Animated.View>
        ) : (
          services.map((svc, i) => (
            <Animated.View key={svc.id} entering={i < 10 ? FadeInRight.delay(i * 50).duration(320) : undefined}>
              <TouchableOpacity
                style={[s.row, Shadow.sm, { backgroundColor: t.bgAlt }]}
                onPress={() => setModal({ visible: true, service: svc })}
                activeOpacity={0.75}
              >
                <View style={[s.iconBox, { backgroundColor: Colors.purple + "12" }]}>
                  <Ionicons name="pricetags-outline" size={18} color={Colors.purple} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.name, { color: t.text }]} numberOfLines={1}>{svc.name}</Text>
                  <Text style={[s.info, { color: t.muted }]}>{svc.duration_min} min{svc.apptCount ? ` · ${svc.apptCount} citas` : ""}</Text>
                  {svc.tags && svc.tags.length > 0 && (
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 5 }}>
                      {svc.tags.slice(0, 3).map(tag => (
                        <View key={tag} style={s.tag}>
                          <Text style={s.tagTxt}>{tag}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={[s.price, { color: t.text }]}>${Math.round(svc.price).toLocaleString("es-CO")}</Text>
                  <Ionicons name="chevron-forward" size={14} color={t.subtle} style={{ marginTop: 4 }} />
                </View>
              </TouchableOpacity>
            </Animated.View>
          ))
        )}
      </ScrollView>

      {tenantId && (
        <ServiceModal
          visible={modal.visible}
          service={modal.service}
          tenantId={tenantId}
          onClose={() => setModal({ visible: false, service: null })}
          onSaved={load}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header:     { paddingTop: 16, paddingHorizontal: 24, paddingBottom: 20 },
  headerRow:  { flexDirection: "row", alignItems: "center", gap: 12 },
  backBtn:    { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,.18)", alignItems: "center", justifyContent: "center" },
  headerTitle:{ fontSize: 22, fontFamily: "SpaceGrotesk_700Bold", color: "white", letterSpacing: -0.4 },
  headerSub:  { fontSize: 12, color: "rgba(255,255,255,.75)", fontFamily: "SpaceGrotesk_400Regular", marginTop: 2 },
  addBtn:     { width: 38, height: 38, borderRadius: 19, backgroundColor: "rgba(255,255,255,.22)", alignItems: "center", justifyContent: "center" },
  row:        { backgroundColor: Colors.white, borderRadius: Radius.md, padding: 14, flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  iconBox:    { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  name:       { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  info:       { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, marginTop: 2 },
  price:      { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text },
  tag:        { backgroundColor: Colors.blue + "10", borderRadius: Radius.full, paddingHorizontal: 7, paddingVertical: 2 },
  tagTxt:     { fontSize: 10, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.blue },
  empty:      { backgroundColor: Colors.white, borderRadius: Radius.xl, padding: 48, alignItems: "center", marginTop: 20 },
  emptyTitle: { fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text, marginBottom: 6 },
  emptySub:   { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, textAlign: "center" },
  mHeader:    { paddingTop: 16, paddingHorizontal: 20, paddingBottom: 20 },
  mHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  closeBtn:   { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,.18)", alignItems: "center", justifyContent: "center" },
  mTitle:     { fontSize: 18, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
  bottomBar:  { padding: 20, paddingBottom: 34, borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.cream2 },
  btn:        { borderRadius: Radius.full, overflow: "hidden" },
  btnGrad: { paddingVertical: 16, alignItems: "center", backgroundColor: Colors.red },
  btnText:    { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
});
