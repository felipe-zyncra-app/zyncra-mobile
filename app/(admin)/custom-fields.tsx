import { useEffect, useState, useCallback } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Alert, TextInput, Modal, Switch, FlatList, ActivityIndicator,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { Colors, Gradients, Radius, Shadow } from "@/constants/theme";
import ErrorState from "@/components/ErrorState";
import { ScreenHeader } from "@/components/ui";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];
type FieldType  = "text" | "number" | "date" | "select" | "boolean";
type AppliesTo = "client" | "appointment";

interface CustomField {
  id: string;
  name: string;
  field_key: string;
  field_type: FieldType;
  applies_to: AppliesTo;
  required: boolean;
  options: string[];
  position: number;
  active: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TYPE_META: Record<FieldType, { label: string; icon: IoniconName; color: string }> = {
  text:    { label: "Texto libre",        icon: "text-outline",          color: Colors.blue },
  number:  { label: "Número",             icon: "calculator-outline",    color: "#f59e0b" },
  date:    { label: "Fecha",              icon: "calendar-outline",      color: Colors.success },
  select:  { label: "Lista desplegable",  icon: "list-outline",          color: "#8b5cf6" },
  boolean: { label: "Sí / No",            icon: "checkmark-circle-outline", color: Colors.red },
};

function slugify(name: string) {
  return name.toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

// ─── Main ──────────────────────────────────────────────────────────────────────

export default function CustomFieldsScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const [tab, setTab]         = useState(0);
  const { tenantId } = useAuth();

  // Fields tab
  const [fields, setFields]   = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal
  const [modal, setModal]     = useState(false);
  const [editing, setEditing] = useState<CustomField | null>(null);
  const [formName, setFormName]             = useState("");
  const [formType, setFormType]             = useState<FieldType>("text");
  const [formAppliesTo, setFormAppliesTo]   = useState<AppliesTo>("client");
  const [formRequired, setFormRequired]     = useState(false);
  const [formOptions, setFormOptions]       = useState("");
  const [formActive, setFormActive]         = useState(true);
  const [saving, setSaving]   = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Values tab
  const [clients, setClients]           = useState<{ id: string; name: string }[]>([]);
  const [selectedClient, setSelectedClient] = useState<string>("");
  const [clientValues, setClientValues] = useState<Record<string, string>>({});
  const [loadingValues, setLoadingValues] = useState(false);
  const [savingValues, setSavingValues] = useState(false);
  const [savedValues, setSavedValues]   = useState(false);
  const [clientPicker, setClientPicker] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    Promise.all([loadFields(), loadClients()]).then(() => { if (cancelled) return; });
    return () => { cancelled = true; };
  }, [tenantId]);

  const loadFields = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    const { data } = await supabase.from("custom_fields")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("position");
    setFields((data ?? []).map((f: any) => ({
      ...f,
      options: Array.isArray(f.options) ? f.options : [],
    })));
    setLoading(false);
  }, [tenantId]);

  const loadClients = useCallback(async () => {
    if (!tenantId) return;
    const { data } = await supabase.from("clients")
      .select("id, name").eq("tenant_id", tenantId).order("name");
    setClients(data ?? []);
  }, [tenantId]);

  const loadClientValues = async (clientId: string) => {
    setLoadingValues(true);
    setSavedValues(false);
    const { data } = await supabase.from("client_field_values")
      .select("field_id, value").eq("client_id", clientId);
    const map: Record<string, string> = {};
    (data ?? []).forEach((r: any) => { map[r.field_id] = r.value ?? ""; });
    setClientValues(map);
    setLoadingValues(false);
  };

  const saveClientValues = async () => {
    if (!selectedClient || !tenantId) return;
    setSavingValues(true);
    const clientFields = fields.filter(f => f.applies_to === "client" && f.active);
    const upserts = clientFields.map(f => ({
      tenant_id: tenantId,
      client_id: selectedClient,
      field_id:  f.id,
      field_key: f.field_key,
      value:     clientValues[f.id] ?? null,
    }));
    await supabase.from("client_field_values").upsert(upserts, { onConflict: "client_id,field_id" });
    setSavingValues(false);
    setSavedValues(true);
    setTimeout(() => setSavedValues(false), 2500);
  };

  const openCreate = () => {
    setEditing(null);
    setFormName(""); setFormType("text"); setFormAppliesTo("client");
    setFormRequired(false); setFormOptions(""); setFormActive(true);
    setModalError(null);
    setModal(true);
  };

  const openEdit = (f: CustomField) => {
    setEditing(f);
    setFormName(f.name); setFormType(f.field_type); setFormAppliesTo(f.applies_to);
    setFormRequired(f.required); setFormOptions(f.options.join("\n")); setFormActive(f.active);
    setModalError(null);
    setModal(true);
  };

  const saveField = async () => {
    if (!formName.trim()) { setModalError("El nombre es obligatorio."); return; }
    setSaving(true);
    const payload = {
      tenant_id:   tenantId,
      name:        formName.trim(),
      field_key:   slugify(formName),
      field_type:  formType,
      applies_to:  formAppliesTo,
      required:    formRequired,
      options:     formType === "select"
        ? formOptions.split("\n").map(o => o.trim()).filter(Boolean)
        : [],
      active:      formActive,
      position:    editing ? editing.position : fields.length,
    };
    if (editing) {
      await supabase.from("custom_fields").update(payload).eq("id", editing.id);
    } else {
      await supabase.from("custom_fields").insert(payload);
    }
    setSaving(false);
    setModal(false);
    loadFields();
  };

  const toggleActive = async (f: CustomField) => {
    await supabase.from("custom_fields").update({ active: !f.active }).eq("id", f.id);
    loadFields();
  };

  const deleteField = (f: CustomField) => {
    Alert.alert("Eliminar campo", `¿Eliminar "${f.name}"? Se borrarán todos sus valores.`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Eliminar", style: "destructive", onPress: async () => {
        await supabase.from("custom_fields").delete().eq("id", f.id);
        loadFields();
      }},
    ]);
  };

  const moveField = async (f: CustomField, dir: -1 | 1) => {
    const idx = fields.findIndex(x => x.id === f.id);
    const other = fields[idx + dir];
    if (!other) return;
    await Promise.all([
      supabase.from("custom_fields").update({ position: other.position }).eq("id", f.id),
      supabase.from("custom_fields").update({ position: f.position }).eq("id", other.id),
    ]);
    loadFields();
  };

  const clientFields = fields.filter(f => f.applies_to === "client" && f.active);
  const selectedClientName = clients.find(c => c.id === selectedClient)?.name ?? "";

  // ── Render Fields tab ─────────────────────────────────────────────────────

  const renderFields = () => (
    <View style={{ flex: 1 }}>
      <TouchableOpacity style={s.addBtn} onPress={openCreate}>
        <Ionicons name="add-circle-outline" size={18} color={Colors.red} />
        <Text style={s.addBtnTxt}>Nuevo campo</Text>
      </TouchableOpacity>

      {loading ? (
        <ActivityIndicator color={Colors.red} style={{ marginTop: 32 }} />
      ) : fields.length === 0 ? (
        <View style={s.emptyBox}>
          <Ionicons name="list-outline" size={40} color={Colors.subtle} />
          <Text style={s.emptyTitle}>Sin campos aún</Text>
          <Text style={s.emptyTxt}>Crea campos personalizados para clientes y citas</Text>
        </View>
      ) : (
        <FlatList
          data={fields}
          keyExtractor={f => f.id}
          contentContainerStyle={{ padding: 20, paddingTop: 0, paddingBottom: 110 }}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          renderItem={({ item: f, index: i }) => {
            const meta = TYPE_META[f.field_type];
            return (
              <Animated.View entering={i < 10 ? FadeInDown.delay(i * 60).duration(350) : undefined}>
                <View style={[s.fieldCard, Shadow.sm, !f.active && { opacity: 0.55 }]}>
                  <View style={[s.fieldIcon, { backgroundColor: meta.color + "18" }]}>
                    <Ionicons name={meta.icon} size={18} color={meta.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                      <Text style={s.fieldName}>{f.name}</Text>
                      <View style={[s.badge, { backgroundColor: f.applies_to === "client" ? Colors.blue + "14" : "#f59e0b14" }]}>
                        <Text style={[s.badgeTxt, { color: f.applies_to === "client" ? Colors.blue : "#f59e0b" }]}>
                          {f.applies_to === "client" ? "Cliente" : "Cita"}
                        </Text>
                      </View>
                      {f.required && (
                        <View style={[s.badge, { backgroundColor: Colors.red + "12" }]}>
                          <Text style={[s.badgeTxt, { color: Colors.red }]}>Obligatorio</Text>
                        </View>
                      )}
                      {!f.active && (
                        <View style={[s.badge, { backgroundColor: Colors.border }]}>
                          <Text style={[s.badgeTxt, { color: Colors.subtle }]}>Inactivo</Text>
                        </View>
                      )}
                    </View>
                    <Text style={s.fieldSub}>
                      {meta.label}
                      {f.field_type === "select" && f.options.length > 0 ? ` · ${f.options.slice(0, 3).join(", ")}${f.options.length > 3 ? "…" : ""}` : ""}
                    </Text>
                  </View>
                  <View style={s.fieldActions}>
                    <TouchableOpacity onPress={() => moveField(f, -1)} disabled={i === 0} style={[s.iconBtn, i === 0 && { opacity: 0.3 }]}>
                      <Ionicons name="chevron-up" size={14} color={Colors.muted} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => moveField(f, 1)} disabled={i === fields.length - 1} style={[s.iconBtn, i === fields.length - 1 && { opacity: 0.3 }]}>
                      <Ionicons name="chevron-down" size={14} color={Colors.muted} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => openEdit(f)} style={s.iconBtn}>
                      <Ionicons name="pencil-outline" size={14} color={Colors.blue} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => toggleActive(f)} style={s.iconBtn}>
                      <Ionicons name={f.active ? "eye-outline" : "eye-off-outline"} size={14} color={f.active ? Colors.success : Colors.subtle} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => deleteField(f)} style={s.iconBtn}>
                      <Ionicons name="trash-outline" size={14} color={Colors.red} />
                    </TouchableOpacity>
                  </View>
                </View>
              </Animated.View>
            );
          }}
        />
      )}
    </View>
  );

  // ── Render Values tab ─────────────────────────────────────────────────────

  const renderValues = () => (
    <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 20, paddingBottom: 110 }}>
      <TouchableOpacity style={[s.clientSelector, Shadow.sm]} onPress={() => setClientPicker(true)}>
        <Ionicons name="person-outline" size={18} color={Colors.muted} />
        <Text style={[s.clientSelectorTxt, selectedClient && { color: Colors.text }]}>
          {selectedClient ? selectedClientName : "Seleccionar cliente"}
        </Text>
        <Ionicons name="chevron-down" size={16} color={Colors.subtle} />
      </TouchableOpacity>

      {selectedClient && (
        <View>
          {loadingValues ? (
            <ActivityIndicator color={Colors.red} style={{ marginTop: 32 }} />
          ) : clientFields.length === 0 ? (
            <View style={s.emptyBox}>
              <Text style={s.emptyTxt}>No hay campos de tipo "Cliente" activos.</Text>
            </View>
          ) : (
            <View style={[s.valuesCard, Shadow.sm]}>
              {clientFields.map((f, i) => (
                <View key={f.id}>
                  {i > 0 && <View style={s.divider} />}
                  <View style={s.valueRow}>
                    <Text style={s.valueLabel}>
                      {f.name}
                      {f.required ? <Text style={{ color: Colors.red }}> *</Text> : null}
                    </Text>
                    <Text style={s.valueSub}>{TYPE_META[f.field_type].label}</Text>
                    {f.field_type === "boolean" ? (
                      <Switch
                        value={clientValues[f.id] === "true"}
                        onValueChange={v => setClientValues(prev => ({ ...prev, [f.id]: v ? "true" : "false" }))}
                        trackColor={{ true: Colors.red, false: Colors.border }}
                        thumbColor="white"
                      />
                    ) : f.field_type === "select" ? (
                      <ScrollView automaticallyAdjustKeyboardInsets horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                        <View style={{ flexDirection: "row", gap: 8 }}>
                          {f.options.map(opt => (
                            <TouchableOpacity
                              key={opt}
                              style={[s.optionChip, clientValues[f.id] === opt && s.optionChipActive]}
                              onPress={() => setClientValues(prev => ({ ...prev, [f.id]: opt }))}
                            >
                              <Text style={[s.optionChipTxt, clientValues[f.id] === opt && s.optionChipTxtActive]}>
                                {opt}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </ScrollView>
                    ) : (
                      <TextInput
                        style={s.valueInput}
                        value={clientValues[f.id] ?? ""}
                        onChangeText={v => setClientValues(prev => ({ ...prev, [f.id]: v }))}
                        keyboardType={f.field_type === "number" ? "numeric" : "default"}
                        placeholder={f.field_type === "date" ? "YYYY-MM-DD" : "—"}
                        placeholderTextColor={t.subtle}
                      />
                    )}
                  </View>
                </View>
              ))}
            </View>
          )}

          {clientFields.length > 0 && (
            <TouchableOpacity style={s.saveValuesBtn} onPress={saveClientValues} disabled={savingValues}>
              {savingValues
                ? <ActivityIndicator color="white" size="small" />
                : <Text style={s.saveValuesBtnTxt}>{savedValues ? "¡Guardado!" : "Guardar valores"}</Text>}
            </TouchableOpacity>
          )}
        </View>
      )}
    </ScrollView>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader crumb="Negocio" title="Campos Personalizados" subtitle="Datos adicionales para clientes y citas" onBack={() => router.back()} />

      {/* Tab bar */}
      <View style={[s.tabBar, { backgroundColor: t.bgAlt, borderBottomColor: t.border }]}>
        {["Campos", "Valores por cliente"].map((label, i) => (
          <TouchableOpacity key={i} style={s.tabItem} onPress={() => setTab(i)}>
            <Text style={[s.tabTxt, { color: t.muted }, tab === i && s.tabTxtActive]}>{label}</Text>
            {tab === i && <View style={s.tabUnderline} />}
          </TouchableOpacity>
        ))}
      </View>

      {tab === 0 ? renderFields() : renderValues()}

      {/* Create/Edit Modal */}
      <Modal visible={modal} animationType="slide" transparent>
        <View style={m.overlay}>
          <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={m.sheetScroll} keyboardShouldPersistTaps="handled">
            <View style={m.sheet}>
              <View style={m.handle} />
              <Text style={m.title}>{editing ? "Editar campo" : "Nuevo campo personalizado"}</Text>

              <Text style={m.label}>Nombre del campo</Text>
              <TextInput
                style={m.input}
                value={formName}
                onChangeText={setFormName}
                placeholder="Ej: Tipo de cabello, Alergia..."
                placeholderTextColor={t.subtle}
              />
              {formName.length > 0 && (
                <Text style={m.keyHint}>Clave: {slugify(formName)}</Text>
              )}

              <Text style={m.label}>Tipo de campo</Text>
              <View style={m.typeGrid}>
                {(Object.entries(TYPE_META) as [FieldType, typeof TYPE_META.text][]).map(([t, meta]) => (
                  <TouchableOpacity
                    key={t}
                    style={[m.typeBtn, formType === t && { borderColor: meta.color, backgroundColor: meta.color + "12" }]}
                    onPress={() => setFormType(t)}
                  >
                    <Ionicons name={meta.icon} size={16} color={formType === t ? meta.color : Colors.subtle} />
                    <Text style={[m.typeTxt, formType === t && { color: meta.color, fontFamily: "SpaceGrotesk_700Bold" }]}>
                      {meta.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={m.label}>Aplica a</Text>
              <View style={m.toggleRow}>
                {(["client", "appointment"] as const).map(v => (
                  <TouchableOpacity
                    key={v}
                    style={[m.toggleBtn, formAppliesTo === v && m.toggleBtnActive]}
                    onPress={() => setFormAppliesTo(v)}
                  >
                    <Text style={[m.toggleTxt, formAppliesTo === v && m.toggleTxtActive]}>
                      {v === "client" ? "Cliente" : "Cita"}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {formType === "select" && (
                <>
                  <Text style={m.label}>Opciones (una por línea)</Text>
                  <TextInput
                    style={[m.input, { minHeight: 80, textAlignVertical: "top" }]}
                    value={formOptions}
                    onChangeText={setFormOptions}
                    multiline
                    placeholder={"Liso\nRizado\nOndulado\nAfro"}
                    placeholderTextColor={t.subtle}
                  />
                </>
              )}

              <View style={m.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={m.switchLabel}>Campo obligatorio</Text>
                  <Text style={m.switchSub}>El cliente debe completarlo</Text>
                </View>
                <Switch
                  value={formRequired}
                  onValueChange={setFormRequired}
                  trackColor={{ true: Colors.red, false: Colors.border }}
                  thumbColor="white"
                />
              </View>

              <View style={m.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={m.switchLabel}>Campo activo</Text>
                  <Text style={m.switchSub}>Visible en formularios</Text>
                </View>
                <Switch
                  value={formActive}
                  onValueChange={setFormActive}
                  trackColor={{ true: Colors.success, false: Colors.border }}
                  thumbColor="white"
                />
              </View>

              {modalError && (
                <View style={m.error}>
                  <Text style={m.errorTxt}>{modalError}</Text>
                </View>
              )}

              <View style={m.actions}>
                <TouchableOpacity style={m.cancelBtn} onPress={() => setModal(false)}>
                  <Text style={m.cancelTxt}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={m.saveBtn} onPress={saveField} disabled={saving}>
                  {saving
                    ? <ActivityIndicator color="white" size="small" />
                    : <Text style={m.saveTxt}>{editing ? "Guardar" : "Crear campo"}</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Client Picker Modal */}
      <Modal visible={clientPicker} animationType="slide" transparent>
        <View style={m.overlay}>
          <View style={[m.sheet, { maxHeight: "70%" }]}>
            <View style={m.handle} />
            <Text style={m.title}>Seleccionar cliente</Text>
            <FlatList
              data={clients}
              keyExtractor={c => c.id}
              ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: Colors.border }} />}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={m.clientRow}
                  onPress={() => {
                    setSelectedClient(item.id);
                    loadClientValues(item.id);
                    setClientPicker(false);
                  }}
                >
                  <View style={m.clientAvatar}>
                    <Text style={m.clientAvatarTxt}>{item.name[0]}</Text>
                  </View>
                  <Text style={m.clientName}>{item.name}</Text>
                  {selectedClient === item.id && <Ionicons name="checkmark" size={18} color={Colors.red} />}
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  header:       { paddingTop: 16, paddingHorizontal: 24, paddingBottom: 20 },
  headerRow:    { flexDirection: "row", alignItems: "center", gap: 14 },
  backBtn:      { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" },
  headerTitle:  { fontSize: 20, fontFamily: "SpaceGrotesk_700Bold", color: "white", letterSpacing: -0.5 },
  headerSub:    { fontSize: 12, color: "rgba(255,255,255,.75)", fontFamily: "SpaceGrotesk_400Regular", marginTop: 2 },

  tabBar:       { flexDirection: "row", backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border },
  tabItem:      { flex: 1, alignItems: "center", paddingVertical: 12 },
  tabTxt:       { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted },
  tabTxtActive: { color: Colors.red, fontFamily: "SpaceGrotesk_700Bold" },
  tabUnderline: { position: "absolute", bottom: 0, left: 12, right: 12, height: 2, backgroundColor: Colors.red, borderRadius: 1 },

  addBtn:    { flexDirection: "row", alignItems: "center", gap: 8, margin: 20, marginBottom: 12, paddingVertical: 12, paddingHorizontal: 16, backgroundColor: Colors.red + "10", borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.red + "30", alignSelf: "flex-start" },
  addBtnTxt: { fontSize: 14, fontFamily: "SpaceGrotesk_700Bold", color: Colors.red },

  fieldCard:    { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.lg, padding: 14 },
  fieldIcon:    { width: 38, height: 38, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  fieldName:    { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  fieldSub:     { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, marginTop: 3 },
  fieldActions: { flexDirection: "row", gap: 4 },
  iconBtn:      { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: Colors.cream2 },

  badge:    { paddingVertical: 2, paddingHorizontal: 7, borderRadius: Radius.full },
  badgeTxt: { fontSize: 10, fontFamily: "SpaceGrotesk_700Bold" },

  emptyBox:   { alignItems: "center", justifyContent: "center", paddingVertical: 60, gap: 12 },
  emptyTitle: { fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text },
  emptyTxt:   { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, textAlign: "center" },

  clientSelector:    { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: Colors.white, borderRadius: Radius.lg, padding: 16, marginBottom: 16 },
  clientSelectorTxt: { flex: 1, fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.subtle },

  valuesCard: { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.lg, overflow: "hidden", marginBottom: 16 },
  divider:    { height: 1, backgroundColor: Colors.border, marginHorizontal: 16 },
  valueRow:   { padding: 16 },
  valueLabel: { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  valueSub:   { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, marginBottom: 8 },
  valueInput: { backgroundColor: Colors.cream2, borderRadius: Radius.md, padding: 12, fontSize: 14, fontFamily: "SpaceGrotesk_400Regular", color: Colors.text, marginTop: 4 },

  optionChip:       { paddingVertical: 6, paddingHorizontal: 14, borderRadius: Radius.full, backgroundColor: Colors.cream2, borderWidth: 1, borderColor: Colors.border },
  optionChipActive: { backgroundColor: Colors.red, borderColor: Colors.red },
  optionChipTxt:    { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted },
  optionChipTxtActive: { color: Colors.white, fontFamily: "SpaceGrotesk_700Bold" },

  saveValuesBtn:    { backgroundColor: Colors.red, borderRadius: Radius.lg, padding: 16, alignItems: "center" },
  saveValuesBtnTxt: { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
});

const m = StyleSheet.create({
  overlay:     { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheetScroll: { justifyContent: "flex-end", flexGrow: 1 },
  sheet:       { backgroundColor: Colors.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, gap: 14 },
  handle:      { width: 40, height: 4, backgroundColor: Colors.border, borderRadius: 2, alignSelf: "center", marginBottom: 8 },
  title:       { fontSize: 18, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text },
  label:       { fontSize: 11, fontFamily: "JetBrainsMono_500Medium", color: Colors.muted, textTransform: "uppercase", letterSpacing: 0.5 },
  keyHint:     { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", color: Colors.subtle, marginTop: -10 },
  input:       { backgroundColor: Colors.cream2, borderRadius: Radius.md, padding: 14, fontSize: 14, fontFamily: "SpaceGrotesk_400Regular", color: Colors.text },

  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  typeBtn:  { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.cream2 },
  typeTxt:  { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.subtle },

  toggleRow:      { flexDirection: "row", gap: 10 },
  toggleBtn:      { flex: 1, padding: 11, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, alignItems: "center", backgroundColor: Colors.cream2 },
  toggleBtnActive:{ backgroundColor: Colors.red, borderColor: Colors.red },
  toggleTxt:      { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted },
  toggleTxtActive:{ color: Colors.white, fontFamily: "SpaceGrotesk_700Bold" },

  switchRow:   { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: Colors.border },
  switchLabel: { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  switchSub:   { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, marginTop: 2 },

  error:    { backgroundColor: Colors.red + "12", borderRadius: Radius.md, padding: 12 },
  errorTxt: { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.red },

  actions:   { flexDirection: "row", gap: 12, marginTop: 4 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, alignItems: "center" },
  cancelTxt: { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted },
  saveBtn:   { flex: 1, padding: 14, borderRadius: Radius.md, backgroundColor: Colors.red, alignItems: "center" },
  saveTxt:   { fontSize: 14, fontFamily: "SpaceGrotesk_700Bold", color: "white" },

  clientRow:       { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
  clientAvatar:    { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.blue, alignItems: "center", justifyContent: "center" },
  clientAvatarTxt: { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
  clientName:      { flex: 1, fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
});
