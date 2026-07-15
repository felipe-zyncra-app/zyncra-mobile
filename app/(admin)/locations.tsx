import { useEffect, useState, useCallback } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput,
  Modal, KeyboardAvoidingView, Platform, ActivityIndicator, Alert, RefreshControl,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { Colors, Fonts, Gradients, Radius } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { ScreenHeader, Card, SectionLabel } from "@/components/ui";

type Location = {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  is_active: boolean;
  created_at: string;
};

type Form = { name: string; address: string; phone: string };
const EMPTY_FORM: Form = { name: "", address: "", phone: "" };

// ─── Modal crear/editar sede ──────────────────────────────────────────────────
function LocationModal({ location, tenantId, onClose, onSaved }: {
  location: Location | null; tenantId: string;
  onClose: () => void; onSaved: () => void;
}) {
  const { t } = useTheme();
  const isEdit = location !== null;
  const [form, setForm] = useState<Form>(
    location ? { name: location.name, address: location.address ?? "", phone: location.phone ?? "" } : EMPTY_FORM
  );
  const [saving, setSaving] = useState(false);

  const canSave = form.name.trim().length >= 2;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      address: form.address.trim() || null,
      phone: form.phone.trim() || null,
    };
    const { error } = isEdit
      ? await supabase.from("locations").update(payload).eq("id", location!.id)
      : await supabase.from("locations").insert({ ...payload, tenant_id: tenantId });
    setSaving(false);
    if (error) { Alert.alert("Error", error.message); return; }
    onSaved(); onClose();
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: t.canvas }}>
        <View style={[m.header, { backgroundColor: "#0C0C14" }]}>
          <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={m.accent} />
          <View style={m.headerRow}>
            <TouchableOpacity onPress={onClose} style={m.closeBtn}>
              <Ionicons name="close" size={20} color="white" />
            </TouchableOpacity>
            <Text style={m.title}>{isEdit ? "Editar sede" : "Nueva sede"}</Text>
            <View style={{ width: 40 }} />
          </View>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }}>
          <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 20, paddingBottom: 120 }}>
            {([["name", "Nombre de la sede *", "Ej: Sede Norte", "default"], ["address", "Dirección", "Calle 00 # 00-00", "default"], ["phone", "Teléfono", "3001234567", "phone-pad"]] as const).map(([key, label, ph, kb]) => (
              <View key={key} style={{ marginBottom: 16 }}>
                <Text style={[m.fieldLabel, { color: t.subtle }]}>{label}</Text>
                <TextInput
                  style={[m.input, { backgroundColor: t.inputBg, borderColor: t.inputBorder, color: t.ink }]}
                  value={form[key]}
                  onChangeText={v => setForm(prev => ({ ...prev, [key]: v }))}
                  placeholder={ph}
                  placeholderTextColor={t.subtle}
                  keyboardType={kb}
                  autoCapitalize={key === "name" ? "words" : "none"}
                />
              </View>
            ))}
          </ScrollView>
          <View style={[m.bottomBar, { backgroundColor: t.canvas, borderTopColor: t.line }]}>
            <TouchableOpacity style={[m.saveBtn, !canSave && { opacity: 0.4 }]} onPress={handleSave} disabled={!canSave || saving} activeOpacity={0.85}>
              <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={m.saveBtnGrad}>
                {saving ? <ActivityIndicator color="white" /> : <Text style={m.saveBtnText}>{isEdit ? "Guardar cambios" : "Crear sede"}</Text>}
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Pantalla principal ────────────────────────────────────────────────────────
export default function LocationsScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const { tenantId } = useAuth();
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modal, setModal] = useState<{ visible: boolean; location: Location | null }>({ visible: false, location: null });

  const load = useCallback(async () => {
    if (!tenantId) return;
    const { data } = await supabase.from("locations")
      .select("id, name, address, phone, is_active, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true });
    setLocations((data ?? []) as Location[]);
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const activeCount = locations.filter(l => l.is_active).length;

  const toggleActive = async (loc: Location) => {
    if (loc.is_active && activeCount <= 1) {
      Alert.alert("No permitido", "Debe quedar al menos una sede activa.");
      return;
    }
    await supabase.from("locations").update({ is_active: !loc.is_active }).eq("id", loc.id);
    load();
  };

  const handleDelete = (loc: Location) => {
    if (loc.is_active && activeCount <= 1) {
      Alert.alert("No permitido", "No puedes eliminar la única sede activa.");
      return;
    }
    Alert.alert("Eliminar sede", `¿Eliminar "${loc.name}"?`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Eliminar", style: "destructive", onPress: async () => {
        const { error } = await supabase.from("locations").delete().eq("id", loc.id);
        if (error) Alert.alert("Error", error.message);
        load();
      }},
    ]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.canvas }}>
      <ScreenHeader
        crumb="Negocio"
        title="Sedes"
        subtitle={`${activeCount} activa${activeCount !== 1 ? "s" : ""} de ${locations.length}`}
        onBack={() => router.back()}
        rightAction={{ icon: "add", onPress: () => setModal({ visible: true, location: null }) }}
      />

      <ScrollView automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ padding: 20, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.red} />}
      >
        {loading ? (
          <ActivityIndicator color={Colors.red} style={{ marginTop: 40 }} />
        ) : locations.length === 0 ? (
          <View style={{ padding: 40, alignItems: "center" }}>
            <Ionicons name="location-outline" size={40} color={t.subtle} style={{ marginBottom: 12 }} />
            <Text style={[s.emptyTitle, { color: t.ink }]}>Sin sedes registradas</Text>
            <Text style={[s.emptyText, { color: t.muted }]}>Toca + para agregar tu primera sede.</Text>
          </View>
        ) : (
          <>
            <SectionLabel>Sedes del negocio</SectionLabel>
            {locations.map((loc, i) => (
              <Animated.View key={loc.id} entering={FadeInDown.delay(i * 40).duration(320)}>
                <Card style={{ marginBottom: 10 }}>
                  <View style={s.row}>
                    <View style={[s.locIcon, { backgroundColor: loc.is_active ? Colors.red + "12" : t.chipBg }]}>
                      <Ionicons name="location" size={18} color={loc.is_active ? Colors.red : t.subtle} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[s.locName, { color: t.ink }]} numberOfLines={1}>{loc.name}</Text>
                      <Text style={[s.locMeta, { color: t.subtle }]} numberOfLines={1}>
                        {loc.address || "Sin dirección"}{loc.phone ? ` · ${loc.phone}` : ""}
                      </Text>
                    </View>
                    {!loc.is_active && (
                      <View style={[s.inactiveBadge, { backgroundColor: t.chipBg }]}>
                        <Text style={[s.inactiveText, { color: t.subtle }]}>Inactiva</Text>
                      </View>
                    )}
                  </View>
                  <View style={[s.actions, { borderTopColor: t.divider }]}>
                    <TouchableOpacity style={s.actionBtn} onPress={() => setModal({ visible: true, location: loc })}>
                      <Ionicons name="create-outline" size={16} color={t.muted} />
                      <Text style={[s.actionText, { color: t.muted }]}>Editar</Text>
                    </TouchableOpacity>
                    <View style={[s.actionDivider, { backgroundColor: t.divider }]} />
                    <TouchableOpacity style={s.actionBtn} onPress={() => toggleActive(loc)}>
                      <Ionicons name={loc.is_active ? "pause-outline" : "play-outline"} size={16} color={t.muted} />
                      <Text style={[s.actionText, { color: t.muted }]}>{loc.is_active ? "Desactivar" : "Activar"}</Text>
                    </TouchableOpacity>
                    <View style={[s.actionDivider, { backgroundColor: t.divider }]} />
                    <TouchableOpacity style={s.actionBtn} onPress={() => handleDelete(loc)}>
                      <Ionicons name="trash-outline" size={16} color={Colors.red} />
                      <Text style={[s.actionText, { color: Colors.red }]}>Eliminar</Text>
                    </TouchableOpacity>
                  </View>
                </Card>
              </Animated.View>
            ))}
          </>
        )}
      </ScrollView>

      {modal.visible && tenantId && (
        <LocationModal
          location={modal.location}
          tenantId={tenantId}
          onClose={() => setModal({ visible: false, location: null })}
          onSaved={load}
        />
      )}
    </SafeAreaView>
  );
}

const m = StyleSheet.create({
  header:    { paddingTop: 16, paddingHorizontal: 16, paddingBottom: 18 },
  accent:    { position: "absolute", top: 0, left: 0, right: 0, height: 3 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  closeBtn:  { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,.16)", alignItems: "center", justifyContent: "center" },
  title:     { fontSize: 17, fontFamily: Fonts.bold, color: "white" },
  fieldLabel:{ fontSize: 11, fontFamily: Fonts.mono, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 },
  input:     { borderWidth: 1.5, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, fontFamily: Fonts.regular },
  bottomBar: { padding: 16, borderTopWidth: 1 },
  saveBtn:   { borderRadius: Radius.md, overflow: "hidden" },
  saveBtnGrad: { paddingVertical: 15, alignItems: "center" },
  saveBtnText: { fontSize: 15, fontFamily: Fonts.bold, color: "white" },
});

const s = StyleSheet.create({
  emptyTitle: { fontSize: 15, fontFamily: Fonts.bold, marginBottom: 6 },
  emptyText:  { fontSize: 13, fontFamily: Fonts.regular, textAlign: "center" },
  row:        { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  locIcon:    { width: 38, height: 38, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  locName:    { fontSize: 14, fontFamily: Fonts.semibold },
  locMeta:    { fontSize: 12, fontFamily: Fonts.regular, marginTop: 2 },
  inactiveBadge: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 20 },
  inactiveText:  { fontSize: 11, fontFamily: Fonts.semibold },
  actions:    { flexDirection: "row", alignItems: "center", borderTopWidth: 1 },
  actionBtn:  { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 11 },
  actionText: { fontSize: 12, fontFamily: Fonts.semibold },
  actionDivider: { width: 1, height: 20 },
});
