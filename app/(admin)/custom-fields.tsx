import { useState, useRef } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Alert, TextInput, Modal, Switch, FlatList, ActivityIndicator,
} from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { Colors, Radius, Shadow } from "@/constants/theme";
import ErrorState from "@/components/ErrorState";
import { ScreenHeader, IconButton } from "@/components/ui";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { exigirFilas, mensajeError, revisar } from "@/lib/db";
import { useGuardRespuestas, useRecarga } from "@/lib/useRecarga";
import { useListaClientes } from "@/lib/useListaClientes";

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

function esFechaReal(dia: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function confirmar(titulo: string, mensaje: string, boton: string, destructivo = false): Promise<boolean> {
  return new Promise(resolve => {
    Alert.alert(titulo, mensaje, [
      { text: "Cancelar", style: "cancel", onPress: () => resolve(false) },
      { text: boton, style: destructivo ? "destructive" : "default", onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}

/**
 * Valida y normaliza los valores según el tipo de cada campo. Antes se
 * guardaba 'abc' en un campo Número, fechas imposibles y los obligatorios
 * vacíos. Devuelve el mensaje del primer error o los valores listos.
 */
function validarValores(campos: CustomField[], valores: Record<string, string>): { error: string } | { listos: Record<string, string | null> } {
  const listos: Record<string, string | null> = {};
  for (const f of campos) {
    const v = (valores[f.id] ?? "").trim();
    if (!v) {
      if (f.required && f.field_type !== "boolean") return { error: `"${f.name}" es obligatorio.` };
      listos[f.id] = f.field_type === "boolean" && f.required ? "false" : null;
      continue;
    }
    switch (f.field_type) {
      case "number": {
        const n = v.replace(",", ".");
        if (!/^-?\d+(\.\d+)?$/.test(n)) return { error: `"${f.name}" debe ser un número (ej: 12 o 4.5).` };
        listos[f.id] = n;
        break;
      }
      case "date":
        if (!esFechaReal(v)) return { error: `"${f.name}" debe ser una fecha real en formato AAAA-MM-DD.` };
        listos[f.id] = v;
        break;
      case "select":
        if (!f.options.includes(v)) return { error: `La opción elegida en "${f.name}" ya no existe. Elige otra.` };
        listos[f.id] = v;
        break;
      case "boolean":
        listos[f.id] = v === "true" ? "true" : "false";
        break;
      default:
        listos[f.id] = v;
    }
  }
  return { listos };
}

// ─── Main ──────────────────────────────────────────────────────────────────────

export default function CustomFieldsScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const [tab, setTab]         = useState(0);
  const { tenantId } = useAuth();
  const { timezone } = useTenant();

  // Fields tab
  const [fields, setFields]   = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorFields, setErrorFields] = useState<unknown>(null);
  const guardFields = useGuardRespuestas();

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
  const [selectedClient, setSelectedClient] = useState<{ id: string; name: string } | null>(null);
  const [clientValues, setClientValues] = useState<Record<string, string>>({});
  // De qué cliente son los valores cargados: con la red lenta, elegir A y
  // luego B podía dejar los datos de A bajo el nombre de B y guardarlos en B.
  const [valoresDe, setValoresDe] = useState<string | null>(null);
  const [loadingValues, setLoadingValues] = useState(false);
  const [errorValues, setErrorValues] = useState<unknown>(null);
  const [savingValues, setSavingValues] = useState(false);
  const [savedValues, setSavedValues]   = useState(false);
  const [clientPicker, setClientPicker] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const guardValores = useGuardRespuestas();
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Selector de clientes: paginado y con búsqueda en el servidor (antes traía
  // todos sin límite ni buscador y se cortaba en 1000).
  const picker = useListaClientes<{ id: string; name: string }>({
    tenantId,
    busqueda: pickerSearch,
    columnas: "id, name",
    porPagina: 50,
    habilitado: clientPicker,
    timeZone: timezone,
  });

  const { recargar: loadFields } = useRecarga(async () => {
    if (!tenantId) return;
    const turno = guardFields.nuevo();
    setLoading(true);
    try {
      const data = revisar(
        await supabase.from("custom_fields").select("*").eq("tenant_id", tenantId).order("position").order("id"),
        "No se pudieron cargar los campos",
      ) ?? [];
      if (!turno.vigente()) return;
      setFields((data as (Omit<CustomField, "options"> & { options: unknown })[]).map(f => ({
        ...f,
        options: Array.isArray(f.options) ? (f.options as unknown[]).map(String) : [],
      })));
      setErrorFields(null);
    } catch (e) {
      if (turno.vigente()) setErrorFields(e);
    } finally {
      if (turno.vigente()) setLoading(false);
    }
  }, [tenantId], { timeZone: timezone, habilitado: !!tenantId, alCambiarDia: false, alCambiarSede: false });

  const loadClientValues = async (clientId: string) => {
    const turno = guardValores.nuevo();
    setLoadingValues(true);
    setSavedValues(false);
    setValoresDe(null);
    setClientValues({});
    try {
      const data = revisar(
        await supabase.from("client_field_values").select("field_id, value").eq("client_id", clientId),
        "No se pudieron cargar los valores del cliente",
      ) ?? [];
      if (!turno.vigente()) return;
      const map: Record<string, string> = {};
      (data as { field_id: string; value: string | null }[]).forEach(r => { map[r.field_id] = r.value ?? ""; });
      setClientValues(map);
      setValoresDe(clientId);
      setErrorValues(null);
    } catch (e) {
      if (turno.vigente()) setErrorValues(e);
    } finally {
      if (turno.vigente()) setLoadingValues(false);
    }
  };

  const clientFields = fields.filter(f => f.applies_to === "client" && f.active);
  const valoresListos = !!selectedClient && valoresDe === selectedClient.id && !loadingValues;

  const saveClientValues = async () => {
    if (!selectedClient || !tenantId || !valoresListos || savingValues) return;
    const clientId = selectedClient.id;
    const v = validarValores(clientFields, clientValues);
    if ("error" in v) { Alert.alert("Revisa los datos", v.error); return; }
    setSavingValues(true);
    try {
      const upserts = clientFields.map(f => ({
        tenant_id: tenantId,
        client_id: clientId,
        field_id:  f.id,
        field_key: f.field_key,
        value:     v.listos[f.id] ?? null,
      }));
      revisar(
        await supabase.from("client_field_values").upsert(upserts, { onConflict: "client_id,field_id" }).select("id"),
        "No se pudieron guardar los valores",
      );
      setSavedValues(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSavedValues(false), 2500);
    } catch (e) {
      // Antes el botón decía "¡Guardado!" aunque fallara.
      Alert.alert("No se guardó", mensajeError(e));
    } finally {
      setSavingValues(false);
    }
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
    if (saving) return;
    if (!formName.trim()) { setModalError("El nombre es obligatorio."); return; }
    // La clave se fija al crear y NO cambia al editar: los valores ya guardados
    // la llevan copiada (client_field_values.field_key) y quedaban huérfanos.
    const fieldKey = editing ? editing.field_key : slugify(formName);
    if (!fieldKey) { setModalError("El nombre debe tener al menos una letra o número."); return; }
    const opciones = formType === "select"
      ? [...new Set(formOptions.split("\n").map(o => o.trim()).filter(Boolean))]
      : [];
    if (formType === "select" && opciones.length === 0) { setModalError("Agrega al menos una opción a la lista."); return; }

    setSaving(true);
    setModalError(null);
    try {
      if (editing && editing.field_type !== formType) {
        const usados = await supabase.from("client_field_values")
          .select("id", { count: "exact", head: true }).eq("field_id", editing.id).not("value", "is", null);
        if (usados.error) throw usados.error;
        if ((usados.count ?? 0) > 0) {
          const seguir = await confirmar(
            "Cambiar el tipo del campo",
            `"${editing.name}" ya tiene ${usados.count} valor${usados.count === 1 ? "" : "es"} guardado${usados.count === 1 ? "" : "s"} como ${TYPE_META[editing.field_type].label.toLowerCase()}. Al pasarlo a ${TYPE_META[formType].label.toLowerCase()} esos valores pueden verse mal o dejar de ser válidos. Si necesitas otro tipo, es mejor crear un campo nuevo.`,
            "Cambiar igual",
            true,
          );
          if (!seguir) return;
        }
      }
      const payload = {
        tenant_id:   tenantId,
        name:        formName.trim(),
        field_key:   fieldKey,
        field_type:  formType,
        applies_to:  formAppliesTo,
        required:    formRequired,
        options:     opciones,
        active:      formActive,
        position:    editing ? editing.position : (fields.reduce((mx, f) => Math.max(mx, f.position), -1) + 1),
      };
      if (editing) {
        exigirFilas(await supabase.from("custom_fields").update(payload).eq("id", editing.id).select("id"), "No se pudo guardar el campo");
      } else {
        revisar(await supabase.from("custom_fields").insert(payload).select("id").single(), "No se pudo crear el campo");
      }
      setModal(false);
      await loadFields();
    } catch (e) {
      const code = (e as { code?: string })?.code ?? "";
      setModalError(code === "23505"
        ? `Ya existe un campo con la clave "${fieldKey}". Usa otro nombre.`
        : mensajeError(e, "No se pudo guardar el campo"));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (f: CustomField) => {
    try {
      exigirFilas(await supabase.from("custom_fields").update({ active: !f.active }).eq("id", f.id).select("id"), "No se pudo cambiar el campo");
    } catch (e) {
      Alert.alert("No se guardó", mensajeError(e));
    }
    await loadFields();
  };

  const deleteField = (f: CustomField) => {
    Alert.alert("Eliminar campo", `¿Eliminar "${f.name}"? Se borrarán todos sus valores guardados en los clientes. Si solo quieres ocultarlo, usa el ojo para desactivarlo.`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Eliminar", style: "destructive", onPress: async () => {
        try {
          exigirFilas(await supabase.from("custom_fields").delete().eq("id", f.id).select("id"), "No se pudo eliminar el campo");
        } catch (e) {
          Alert.alert("No se eliminó", mensajeError(e));
        }
        await loadFields();
      }},
    ]);
  };

  const moveField = async (f: CustomField, dir: -1 | 1) => {
    const idx = fields.findIndex(x => x.id === f.id);
    const other = fields[idx + dir];
    if (!other) return;
    // Si dos campos tienen la misma posición, intercambiarlas no movería nada.
    const posF = other.position === f.position ? f.position + dir : other.position;
    try {
      exigirFilas(await supabase.from("custom_fields").update({ position: posF }).eq("id", f.id).select("id"), "No se pudo mover el campo");
      exigirFilas(await supabase.from("custom_fields").update({ position: f.position }).eq("id", other.id).select("id"), "No se pudo mover el campo");
    } catch (e) {
      Alert.alert("No se movió", mensajeError(e));
    }
    await loadFields();
  };

  // ── Render Fields tab ─────────────────────────────────────────────────────

  const renderFields = () => (
    <View style={{ flex: 1 }}>
      <TouchableOpacity style={s.addBtn} onPress={openCreate} accessibilityRole="button">
        <Ionicons name="add-circle-outline" size={18} color={Colors.red} />
        <Text style={s.addBtnTxt}>Nuevo campo</Text>
      </TouchableOpacity>

      {loading && fields.length === 0 ? (
        <ActivityIndicator color={Colors.red} style={{ marginTop: 32 }} />
      ) : errorFields && fields.length === 0 ? (
        <ErrorState error={errorFields} onRetry={loadFields} />
      ) : fields.length === 0 ? (
        <View style={s.emptyBox}>
          <Ionicons name="list-outline" size={40} color={t.subtle} />
          <Text style={[s.emptyTitle, { color: t.ink }]}>Sin campos aún</Text>
          <Text style={[s.emptyTxt, { color: t.muted }]}>Crea campos personalizados para clientes y citas</Text>
        </View>
      ) : (
        <FlatList
          data={fields}
          keyExtractor={f => f.id}
          contentContainerStyle={{ padding: 20, paddingTop: 0, paddingBottom: 110 }}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          renderItem={({ item: f, index: i }) => {
            const meta = TYPE_META[f.field_type] ?? TYPE_META.text;
            return (
              <Animated.View entering={i < 10 ? FadeInDown.delay(i * 60).duration(350) : undefined}>
                <View style={[s.fieldCard, Shadow.sm, { backgroundColor: t.cardSolid, borderColor: t.line }, !f.active && { opacity: 0.55 }]}>
                  <View style={[s.fieldIcon, { backgroundColor: meta.color + "18" }]}>
                    <Ionicons name={meta.icon} size={18} color={meta.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                      <Text style={[s.fieldName, { color: t.ink }]}>{f.name}</Text>
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
                        <View style={[s.badge, { backgroundColor: t.chipBg }]}>
                          <Text style={[s.badgeTxt, { color: t.subtle }]}>Inactivo</Text>
                        </View>
                      )}
                    </View>
                    <Text style={[s.fieldSub, { color: t.muted }]}>
                      {meta.label}
                      {f.field_type === "select" && f.options.length > 0 ? ` · ${f.options.slice(0, 3).join(", ")}${f.options.length > 3 ? "…" : ""}` : ""}
                    </Text>
                  </View>
                  <View style={s.fieldActions}>
                    <IconButton icon="chevron-up" label={`Subir ${f.name}`} onPress={() => moveField(f, -1)} disabled={i === 0} size={14} color={t.muted} style={s.iconBtn} />
                    <IconButton icon="chevron-down" label={`Bajar ${f.name}`} onPress={() => moveField(f, 1)} disabled={i === fields.length - 1} size={14} color={t.muted} style={s.iconBtn} />
                    <IconButton icon="pencil-outline" label={`Editar ${f.name}`} onPress={() => openEdit(f)} size={14} color={Colors.blue} style={s.iconBtn} />
                    <IconButton icon={f.active ? "eye-outline" : "eye-off-outline"} label={f.active ? `Desactivar ${f.name}` : `Activar ${f.name}`} onPress={() => toggleActive(f)} size={14} color={f.active ? Colors.success : t.subtle} style={s.iconBtn} />
                    <IconButton icon="trash-outline" label={`Eliminar ${f.name}`} onPress={() => deleteField(f)} size={14} color={Colors.red} style={s.iconBtn} />
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

  const inputBg = { backgroundColor: t.inputBg, borderColor: t.inputBorder, color: t.ink };

  const renderValues = () => (
    <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 20, paddingBottom: 110 }} keyboardShouldPersistTaps="handled">
      <TouchableOpacity style={[s.clientSelector, Shadow.sm, { backgroundColor: t.cardSolid, borderColor: t.line }]} onPress={() => setClientPicker(true)} accessibilityRole="button">
        <Ionicons name="person-outline" size={18} color={t.muted} />
        <Text style={[s.clientSelectorTxt, { color: selectedClient ? t.ink : t.subtle }]}>
          {selectedClient ? selectedClient.name : "Seleccionar cliente"}
        </Text>
        <Ionicons name="chevron-down" size={16} color={t.subtle} />
      </TouchableOpacity>

      {selectedClient && (
        <View>
          {loadingValues ? (
            <ActivityIndicator color={Colors.red} style={{ marginTop: 32 }} />
          ) : errorValues && !valoresListos ? (
            <ErrorState error={errorValues} onRetry={() => loadClientValues(selectedClient.id)} />
          ) : clientFields.length === 0 ? (
            <View style={s.emptyBox}>
              <Text style={[s.emptyTxt, { color: t.muted }]}>No hay campos de tipo &quot;Cliente&quot; activos.</Text>
            </View>
          ) : (
            <View style={[s.valuesCard, Shadow.sm, { backgroundColor: t.cardSolid, borderColor: t.line }]}>
              {clientFields.map((f, i) => (
                <View key={f.id}>
                  {i > 0 && <View style={[s.divider, { backgroundColor: t.line }]} />}
                  <View style={s.valueRow}>
                    <Text style={[s.valueLabel, { color: t.ink }]}>
                      {f.name}
                      {f.required ? <Text style={{ color: Colors.red }}> *</Text> : null}
                    </Text>
                    <Text style={[s.valueSub, { color: t.muted }]}>{TYPE_META[f.field_type]?.label ?? f.field_type}</Text>
                    {f.field_type === "boolean" ? (
                      <Switch
                        value={clientValues[f.id] === "true"}
                        onValueChange={v => setClientValues(prev => ({ ...prev, [f.id]: v ? "true" : "false" }))}
                        trackColor={{ true: Colors.red, false: t.trackBg }}
                        thumbColor="white"
                      />
                    ) : f.field_type === "select" ? (
                      <ScrollView automaticallyAdjustKeyboardInsets horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                        <View style={{ flexDirection: "row", gap: 8 }}>
                          {f.options.map(opt => {
                            const on = clientValues[f.id] === opt;
                            return (
                              <TouchableOpacity
                                key={opt}
                                style={[s.optionChip, { backgroundColor: t.chipBg, borderColor: t.line }, on && s.optionChipActive]}
                                onPress={() => setClientValues(prev => ({ ...prev, [f.id]: prev[f.id] === opt ? "" : opt }))}
                                accessibilityRole="button"
                                accessibilityState={{ selected: on }}
                              >
                                <Text style={[s.optionChipTxt, { color: t.muted }, on && s.optionChipTxtActive]}>
                                  {opt}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </ScrollView>
                    ) : (
                      <TextInput
                        style={[s.valueInput, inputBg]}
                        value={clientValues[f.id] ?? ""}
                        onChangeText={v => setClientValues(prev => ({ ...prev, [f.id]: v }))}
                        keyboardType={f.field_type === "number" ? "decimal-pad" : f.field_type === "date" ? "numbers-and-punctuation" : "default"}
                        placeholder={f.field_type === "date" ? "AAAA-MM-DD" : "—"}
                        placeholderTextColor={t.subtle}
                      />
                    )}
                  </View>
                </View>
              ))}
            </View>
          )}

          {clientFields.length > 0 && valoresListos && (
            <TouchableOpacity style={[s.saveValuesBtn, savingValues && { opacity: 0.7 }]} onPress={saveClientValues} disabled={savingValues} accessibilityRole="button">
              {savingValues
                ? <ActivityIndicator color="white" size="small" />
                : <Text style={s.saveValuesBtnTxt}>{savedValues ? "¡Guardado!" : "Guardar valores"}</Text>}
            </TouchableOpacity>
          )}
        </View>
      )}
    </ScrollView>
  );

  const sheet = { backgroundColor: t.cardSolid };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader crumb="Clientes" title="Campos Personalizados" subtitle="Datos adicionales para clientes y citas" onBack={() => router.back()} />

      {/* Tab bar */}
      <View style={[s.tabBar, { backgroundColor: t.bgAlt, borderBottomColor: t.border }]}>
        {["Campos", "Valores por cliente"].map((label, i) => (
          <TouchableOpacity key={i} style={s.tabItem} onPress={() => setTab(i)} accessibilityRole="tab" accessibilityState={{ selected: tab === i }}>
            <Text style={[s.tabTxt, { color: t.muted }, tab === i && s.tabTxtActive]}>{label}</Text>
            {tab === i && <View style={s.tabUnderline} />}
          </TouchableOpacity>
        ))}
      </View>

      {tab === 0 ? renderFields() : renderValues()}

      {/* Create/Edit Modal */}
      <Modal visible={modal} animationType="slide" transparent onRequestClose={() => setModal(false)}>
        <View style={m.overlay}>
          <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={m.sheetScroll} keyboardShouldPersistTaps="handled">
            <View style={[m.sheet, sheet]}>
              <View style={[m.handle, { backgroundColor: t.lineStrong }]} />
              <Text style={[m.title, { color: t.ink }]}>{editing ? "Editar campo" : "Nuevo campo personalizado"}</Text>

              <Text style={[m.label, { color: t.muted }]}>Nombre del campo</Text>
              <TextInput
                style={[m.input, inputBg]}
                value={formName}
                onChangeText={setFormName}
                placeholder="Ej: Tipo de cabello, Alergia..."
                placeholderTextColor={t.subtle}
              />
              {(editing || formName.length > 0) && (
                <Text style={[m.keyHint, { color: t.subtle }]}>
                  Clave: {editing ? editing.field_key : slugify(formName)}{editing ? " (no cambia al renombrar)" : ""}
                </Text>
              )}

              <Text style={[m.label, { color: t.muted }]}>Tipo de campo</Text>
              <View style={m.typeGrid}>
                {(Object.entries(TYPE_META) as [FieldType, typeof TYPE_META.text][]).map(([tipo, meta]) => (
                  <TouchableOpacity
                    key={tipo}
                    style={[m.typeBtn, { backgroundColor: t.chipBg, borderColor: t.line }, formType === tipo && { borderColor: meta.color, backgroundColor: meta.color + "12" }]}
                    onPress={() => setFormType(tipo)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: formType === tipo }}
                  >
                    <Ionicons name={meta.icon} size={16} color={formType === tipo ? meta.color : t.subtle} />
                    <Text style={[m.typeTxt, { color: t.subtle }, formType === tipo && { color: meta.color, fontFamily: "SpaceGrotesk_700Bold" }]}>
                      {meta.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={[m.label, { color: t.muted }]}>Aplica a</Text>
              <View style={m.toggleRow}>
                {(["client", "appointment"] as const).map(v => (
                  <TouchableOpacity
                    key={v}
                    style={[m.toggleBtn, { backgroundColor: t.chipBg, borderColor: t.line }, formAppliesTo === v && m.toggleBtnActive]}
                    onPress={() => setFormAppliesTo(v)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: formAppliesTo === v }}
                  >
                    <Text style={[m.toggleTxt, { color: t.muted }, formAppliesTo === v && m.toggleTxtActive]}>
                      {v === "client" ? "Cliente" : "Cita"}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {formType === "select" && (
                <>
                  <Text style={[m.label, { color: t.muted }]}>Opciones (una por línea)</Text>
                  <TextInput
                    style={[m.input, inputBg, { minHeight: 80, textAlignVertical: "top" }]}
                    value={formOptions}
                    onChangeText={setFormOptions}
                    multiline
                    placeholder={"Liso\nRizado\nOndulado\nAfro"}
                    placeholderTextColor={t.subtle}
                  />
                </>
              )}

              <View style={[m.switchRow, { borderTopColor: t.line }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[m.switchLabel, { color: t.ink }]}>Campo obligatorio</Text>
                  <Text style={[m.switchSub, { color: t.muted }]}>Hay que completarlo para guardar</Text>
                </View>
                <Switch
                  value={formRequired}
                  onValueChange={setFormRequired}
                  trackColor={{ true: Colors.red, false: t.trackBg }}
                  thumbColor="white"
                />
              </View>

              <View style={[m.switchRow, { borderTopColor: t.line }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[m.switchLabel, { color: t.ink }]}>Campo activo</Text>
                  <Text style={[m.switchSub, { color: t.muted }]}>Visible en formularios</Text>
                </View>
                <Switch
                  value={formActive}
                  onValueChange={setFormActive}
                  trackColor={{ true: Colors.success, false: t.trackBg }}
                  thumbColor="white"
                />
              </View>

              {modalError && (
                <View style={m.error}>
                  <Text style={m.errorTxt}>{modalError}</Text>
                </View>
              )}

              <View style={m.actions}>
                <TouchableOpacity style={[m.cancelBtn, { borderColor: t.line }]} onPress={() => setModal(false)} accessibilityRole="button">
                  <Text style={[m.cancelTxt, { color: t.muted }]}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[m.saveBtn, saving && { opacity: 0.7 }]} onPress={saveField} disabled={saving} accessibilityRole="button">
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
      <Modal visible={clientPicker} animationType="slide" transparent onRequestClose={() => setClientPicker(false)}>
        <View style={m.overlay}>
          <View style={[m.sheet, sheet, { maxHeight: "80%" }]}>
            <View style={[m.handle, { backgroundColor: t.lineStrong }]} />
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={[m.title, { color: t.ink }]}>Seleccionar cliente</Text>
              <IconButton icon="close" label="Cerrar" onPress={() => setClientPicker(false)} />
            </View>
            <View style={[m.searchBox, { backgroundColor: t.inputBg, borderColor: t.inputBorder }]}>
              <Ionicons name="search-outline" size={16} color={t.subtle} />
              <TextInput
                style={[m.searchInput, { color: t.ink }]}
                value={pickerSearch}
                onChangeText={setPickerSearch}
                placeholder="Buscar por nombre o teléfono"
                placeholderTextColor={t.subtle}
                autoCorrect={false}
              />
            </View>
            {picker.error && picker.filas.length === 0 && !picker.cargando ? (
              <ErrorState error={picker.error} onRetry={picker.recargar} />
            ) : (
              <FlatList
                data={picker.filas}
                keyExtractor={c => c.id}
                keyboardShouldPersistTaps="handled"
                onEndReached={picker.cargarMas}
                onEndReachedThreshold={0.5}
                ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: t.line }} />}
                ListEmptyComponent={picker.cargando
                  ? <ActivityIndicator color={Colors.red} style={{ marginVertical: 24 }} />
                  : <Text style={[s.emptyTxt, { color: t.muted, paddingVertical: 24 }]}>{pickerSearch ? "Sin resultados" : "Sin clientes aún"}</Text>}
                ListFooterComponent={picker.cargandoMas ? <ActivityIndicator color={Colors.red} style={{ marginVertical: 12 }} /> : null}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={m.clientRow}
                    onPress={() => {
                      setSelectedClient({ id: item.id, name: item.name });
                      loadClientValues(item.id);
                      setClientPicker(false);
                    }}
                    accessibilityRole="button"
                  >
                    <View style={m.clientAvatar}>
                      <Text style={m.clientAvatarTxt}>{(item.name?.[0] ?? "?").toUpperCase()}</Text>
                    </View>
                    <Text style={[m.clientName, { color: t.ink }]}>{item.name}</Text>
                    {selectedClient?.id === item.id && <Ionicons name="checkmark" size={18} color={Colors.red} />}
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
// Los colores de fondo, texto y borde van en línea con useTheme().t.

const s = StyleSheet.create({
  tabBar:       { flexDirection: "row", borderBottomWidth: 1 },
  tabItem:      { flex: 1, alignItems: "center", paddingVertical: 12 },
  tabTxt:       { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold" },
  tabTxtActive: { color: Colors.red, fontFamily: "SpaceGrotesk_700Bold" },
  tabUnderline: { position: "absolute", bottom: 0, left: 12, right: 12, height: 2, backgroundColor: Colors.red, borderRadius: 1 },

  addBtn:    { flexDirection: "row", alignItems: "center", gap: 8, margin: 20, marginBottom: 12, paddingVertical: 12, paddingHorizontal: 16, backgroundColor: Colors.red + "10", borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.red + "30", alignSelf: "flex-start" },
  addBtnTxt: { fontSize: 14, fontFamily: "SpaceGrotesk_700Bold", color: Colors.red },

  fieldCard:    { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: Radius.lg, padding: 14 },
  fieldIcon:    { width: 38, height: 38, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  fieldName:    { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold" },
  fieldSub:     { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", marginTop: 3 },
  // gap 8 = el hitSlop de IconButton (CAL-24): con gap 2 el área extra de cada
  // botón tapaba 6 pt del vecino y tocar el borde de "Editar" cambiaba el
  // campo a inactivo sin preguntar.
  fieldActions: { flexDirection: "row", gap: 8 },
  iconBtn:      { width: 28, height: 28, borderRadius: 8 },

  badge:    { paddingVertical: 2, paddingHorizontal: 7, borderRadius: Radius.full },
  badgeTxt: { fontSize: 10, fontFamily: "SpaceGrotesk_700Bold" },

  emptyBox:   { alignItems: "center", justifyContent: "center", paddingVertical: 60, gap: 12 },
  emptyTitle: { fontSize: 16, fontFamily: "SpaceGrotesk_700Bold" },
  emptyTxt:   { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", textAlign: "center" },

  clientSelector:    { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: Radius.lg, padding: 16, marginBottom: 16 },
  clientSelectorTxt: { flex: 1, fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold" },

  valuesCard: { borderWidth: 1, borderRadius: Radius.lg, overflow: "hidden", marginBottom: 16 },
  divider:    { height: 1, marginHorizontal: 16 },
  valueRow:   { padding: 16 },
  valueLabel: { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold" },
  valueSub:   { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", marginBottom: 8 },
  valueInput: { borderWidth: 1, borderRadius: Radius.md, padding: 12, fontSize: 14, fontFamily: "SpaceGrotesk_400Regular", marginTop: 4 },

  optionChip:       { paddingVertical: 6, paddingHorizontal: 14, borderRadius: Radius.full, borderWidth: 1 },
  optionChipActive: { backgroundColor: Colors.red, borderColor: Colors.red },
  optionChipTxt:    { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold" },
  optionChipTxtActive: { color: "white", fontFamily: "SpaceGrotesk_700Bold" },

  saveValuesBtn:    { backgroundColor: Colors.red, borderRadius: Radius.lg, padding: 16, alignItems: "center" },
  saveValuesBtnTxt: { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
});

const m = StyleSheet.create({
  overlay:     { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheetScroll: { justifyContent: "flex-end", flexGrow: 1 },
  sheet:       { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, gap: 14 },
  handle:      { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 8 },
  title:       { fontSize: 18, fontFamily: "SpaceGrotesk_700Bold" },
  label:       { fontSize: 11, fontFamily: "JetBrainsMono_500Medium", textTransform: "uppercase", letterSpacing: 0.5 },
  keyHint:     { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", marginTop: -10 },
  input:       { borderWidth: 1, borderRadius: Radius.md, padding: 14, fontSize: 14, fontFamily: "SpaceGrotesk_400Regular" },
  searchBox:   { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: 12, paddingVertical: 10 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "SpaceGrotesk_400Regular" },

  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  typeBtn:  { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: Radius.md, borderWidth: 1.5 },
  typeTxt:  { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold" },

  toggleRow:      { flexDirection: "row", gap: 10 },
  toggleBtn:      { flex: 1, padding: 11, borderRadius: Radius.md, borderWidth: 1, alignItems: "center" },
  toggleBtnActive:{ backgroundColor: Colors.red, borderColor: Colors.red },
  toggleTxt:      { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold" },
  toggleTxtActive:{ color: "white", fontFamily: "SpaceGrotesk_700Bold" },

  switchRow:   { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8, borderTopWidth: 1 },
  switchLabel: { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold" },
  switchSub:   { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", marginTop: 2 },

  error:    { backgroundColor: Colors.red + "12", borderRadius: Radius.md, padding: 12 },
  errorTxt: { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.red },

  actions:   { flexDirection: "row", gap: 12, marginTop: 4 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: Radius.md, borderWidth: 1, alignItems: "center" },
  cancelTxt: { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold" },
  saveBtn:   { flex: 1, padding: 14, borderRadius: Radius.md, backgroundColor: Colors.red, alignItems: "center" },
  saveTxt:   { fontSize: 14, fontFamily: "SpaceGrotesk_700Bold", color: "white" },

  clientRow:       { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
  clientAvatar:    { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.blue, alignItems: "center", justifyContent: "center" },
  clientAvatarTxt: { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
  clientName:      { flex: 1, fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold" },
});
