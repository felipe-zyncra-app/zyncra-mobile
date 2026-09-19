import { useEffect, useState, useCallback, useMemo } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput,
  Modal, KeyboardAvoidingView, Platform, ActivityIndicator, Alert, FlatList,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { Colors, Fonts, Gradients, Radius } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { ScreenHeader, Card, CardHead, MonoTag, SectionLabel } from "@/components/ui";
import Avatar from "@/components/Avatar";

type Vertical = "odontologia" | "estetica" | "general";
const VERTICALS: { key: Vertical; label: string; desc: string }[] = [
  { key: "general",     label: "Salud general",     desc: "Ficha y evoluciones" },
  { key: "odontologia", label: "Odontología",       desc: "Práctica dental" },
  { key: "estetica",    label: "Medicina estética", desc: "Procedimientos" },
];

type ClientRow = { id: string; name: string; phone: string | null; email: string | null };
type RecordRow = {
  id: string; client_id: string; updated_at: string;
  document_type: string | null; document_number: string | null;
  birth_date: string | null; gender: string | null; occupation: string | null;
  address: string | null; city: string | null; eps: string | null;
  emergency_contact_name: string | null; emergency_contact_phone: string | null;
  blood_type: string | null; allergies: string | null; medications: string | null;
  medical_history: string | null; family_history: string | null; habits: string | null;
};
type Vitals = { ta?: string; fc?: string; fr?: string; temp?: string; peso?: string; talla?: string };
type EntryRow = {
  id: string; record_id: string; entry_type: string;
  professional_id: string | null;
  subjective: string | null; objective: string | null;
  assessment: string | null; plan: string | null;
  vitals: Vitals | null; status: string; signed_name: string | null;
  signed_at: string | null; created_at: string;
};

const ENTRY_TYPES: { key: string; label: string }[] = [
  { key: "evolucion",    label: "Evolución" },
  { key: "procedimiento", label: "Procedimiento" },
  { key: "control",      label: "Control" },
  { key: "adicion",      label: "Adición" },
];

const FICHA_FIELDS: { key: keyof RecordRow; label: string; kb?: "default" | "numeric" | "phone-pad"; multiline?: boolean }[] = [
  { key: "document_type",           label: "Tipo de documento" },
  { key: "document_number",         label: "Número de documento" },
  { key: "birth_date",              label: "Fecha de nacimiento (YYYY-MM-DD)" },
  { key: "gender",                  label: "Género" },
  { key: "occupation",              label: "Ocupación" },
  { key: "address",                 label: "Dirección" },
  { key: "city",                    label: "Ciudad" },
  { key: "eps",                     label: "EPS / Aseguradora" },
  { key: "blood_type",              label: "Tipo de sangre" },
  { key: "emergency_contact_name",  label: "Contacto de emergencia" },
  { key: "emergency_contact_phone", label: "Teléfono de emergencia", kb: "phone-pad" },
  { key: "allergies",               label: "Alergias", multiline: true },
  { key: "medications",             label: "Medicamentos actuales", multiline: true },
  { key: "medical_history",         label: "Antecedentes médicos", multiline: true },
  { key: "family_history",          label: "Antecedentes familiares", multiline: true },
  { key: "habits",                  label: "Hábitos", multiline: true },
];

const VITAL_FIELDS: { key: keyof Vitals; label: string }[] = [
  { key: "ta", label: "TA" }, { key: "fc", label: "FC" }, { key: "fr", label: "FR" },
  { key: "temp", label: "Temp" }, { key: "peso", label: "Peso" }, { key: "talla", label: "Talla" },
];

// ─── Detalle de paciente (ficha + evoluciones) ────────────────────────────────
function PatientModal({ client, tenantId, vertical, onClose, onSaved }: {
  client: ClientRow; tenantId: string; vertical: Vertical;
  onClose: () => void; onSaved: () => void;
}) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<"ficha" | "evolucion">("evolucion");
  const [record, setRecord] = useState<RecordRow | null>(null);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingFicha, setSavingFicha] = useState(false);
  const [ficha, setFicha] = useState<Partial<RecordRow>>({});

  // Formulario de nueva evolución
  const [entryType, setEntryType] = useState("evolucion");
  const [soap, setSoap] = useState({ subjective: "", objective: "", assessment: "", plan: "" });
  const [vitals, setVitals] = useState<Vitals>({});
  const [savingEntry, setSavingEntry] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: rec } = await supabase.from("clinical_records")
      .select("*").eq("tenant_id", tenantId).eq("client_id", client.id).limit(1).maybeSingle();
    setRecord(rec ?? null);
    setFicha(rec ?? {});
    if (rec) {
      const { data: ents } = await supabase.from("clinical_entries")
        .select("*").eq("record_id", rec.id).order("created_at", { ascending: false }).limit(300);
      setEntries((ents ?? []) as EntryRow[]);
      setTab("evolucion");
    } else {
      setEntries([]);
      setTab("ficha");
    }
    setLoading(false);
  }, [client.id, tenantId]);

  useEffect(() => { load(); }, [load]);

  const saveFicha = async () => {
    setSavingFicha(true);
    const payload: Record<string, unknown> = { tenant_id: tenantId, client_id: client.id };
    FICHA_FIELDS.forEach(f => { payload[f.key] = (ficha[f.key] as string)?.trim?.() || null; });
    if (record) {
      const { error } = await supabase.from("clinical_records").update(payload).eq("id", record.id);
      if (!error) { setRecord({ ...record, ...payload } as RecordRow); Alert.alert("Ficha actualizada"); }
      else Alert.alert("Error", error.message);
    } else {
      const { data, error } = await supabase.from("clinical_records").insert(payload).select("*").single();
      if (!error && data) { setRecord(data as RecordRow); setTab("evolucion"); onSaved(); }
      else Alert.alert("Error", error?.message ?? "No se pudo crear la ficha");
    }
    setSavingFicha(false);
  };

  const entryHasContent = () => Object.values(soap).some(s => s.trim());

  const saveEntry = async (sign: boolean) => {
    if (!record) return;
    if (!entryHasContent()) { Alert.alert("Nota vacía", "Escribe al menos una sección (S/O/A/P)."); return; }
    const doSave = async () => {
      setSavingEntry(true);
      const payload: Record<string, unknown> = {
        tenant_id: tenantId, record_id: record.id, entry_type: entryType,
        subjective: soap.subjective.trim() || null,
        objective: soap.objective.trim() || null,
        assessment: soap.assessment.trim() || null,
        plan: soap.plan.trim() || null,
        vitals: Object.values(vitals).some(v => v) ? vitals : null,
      };
      if (sign) {
        const { data: u } = await supabase.auth.getUser();
        payload.status = "signed";
        payload.signed_at = new Date().toISOString();
        payload.signed_by = u.user?.id ?? null;
        payload.signed_name = u.user?.email ?? "Profesional";
      }
      const { error } = await supabase.from("clinical_entries").insert(payload);
      setSavingEntry(false);
      if (error) { Alert.alert("Error", error.message); return; }
      setSoap({ subjective: "", objective: "", assessment: "", plan: "" });
      setVitals({});
      await load();
      onSaved();
    };
    if (sign) {
      Alert.alert("Firmar evolución", "Una entrada firmada queda bloqueada y no puede editarse ni eliminarse. ¿Continuar?", [
        { text: "Cancelar", style: "cancel" },
        { text: "Firmar", style: "destructive", onPress: doSave },
      ]);
    } else {
      doSave();
    }
  };

  const deleteDraft = (id: string) => {
    Alert.alert("Eliminar borrador", "¿Eliminar esta evolución?", [
      { text: "Cancelar", style: "cancel" },
      { text: "Eliminar", style: "destructive", onPress: async () => {
        await supabase.from("clinical_entries").delete().eq("id", id);
        setEntries(prev => prev.filter(e => e.id !== id));
      }},
    ]);
  };

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: t.canvas }}>
        <View style={[dm.header, { backgroundColor: "#0C0C14", paddingTop: insets.top + 10 }]}>
          <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={dm.accent} />
          <View style={dm.headerRow}>
            <TouchableOpacity onPress={onClose} style={dm.iconBtn}>
              <Ionicons name="arrow-back" size={20} color="white" />
            </TouchableOpacity>
            <View style={{ alignItems: "center", flex: 1 }}>
              <Text style={dm.title} numberOfLines={1}>{client.name}</Text>
              <Text style={dm.subtitle}>Historia clínica</Text>
            </View>
            <View style={{ width: 40 }} />
          </View>
          <View style={dm.tabs}>
            {(["ficha", "evolucion"] as const).map(tb => (
              <TouchableOpacity key={tb} style={[dm.tab, tab === tb && dm.tabActive]} onPress={() => setTab(tb)}>
                <Text style={[dm.tabText, tab === tb && dm.tabTextActive]}>
                  {tb === "ficha" ? "Ficha" : "Evoluciones"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {loading ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator color={Colors.red} size="large" />
          </View>
        ) : (
          <KeyboardAvoidingView style={{ flex: 1 }}>
            <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 20, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
              {tab === "ficha" ? (
                <>
                  <SectionLabel>Datos del paciente</SectionLabel>
                  <Card>
                    <View style={{ padding: 16, gap: 14 }}>
                      {FICHA_FIELDS.map(f => (
                        <View key={f.key}>
                          <Text style={[dm.fieldLabel, { color: t.subtle }]}>{f.label}</Text>
                          <TextInput
                            style={[dm.input, { backgroundColor: t.inputBg, borderColor: t.inputBorder, color: t.ink }, f.multiline && { minHeight: 64, textAlignVertical: "top" }]}
                            value={(ficha[f.key] as string) ?? ""}
                            onChangeText={v => setFicha(prev => ({ ...prev, [f.key]: v }))}
                            placeholder="—"
                            placeholderTextColor={t.subtle}
                            keyboardType={f.kb ?? "default"}
                            multiline={f.multiline}
                          />
                        </View>
                      ))}
                    </View>
                  </Card>
                  <TouchableOpacity onPress={saveFicha} disabled={savingFicha} activeOpacity={0.85} style={{ marginTop: 16, borderRadius: Radius.md, overflow: "hidden" }}>
                    <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={dm.saveBtn}>
                      {savingFicha ? <ActivityIndicator color="white" /> : (
                        <Text style={dm.saveBtnText}>{record ? "Guardar ficha" : "Crear historia clínica"}</Text>
                      )}
                    </LinearGradient>
                  </TouchableOpacity>
                </>
              ) : !record ? (
                <Card>
                  <View style={{ padding: 28, alignItems: "center" }}>
                    <Ionicons name="document-text-outline" size={32} color={t.subtle} />
                    <Text style={[dm.emptyText, { color: t.muted }]}>Primero crea la ficha del paciente en la pestaña "Ficha".</Text>
                  </View>
                </Card>
              ) : (
                <>
                  {/* Nueva evolución */}
                  <SectionLabel>Nueva evolución</SectionLabel>
                  <Card>
                    <View style={{ padding: 16, gap: 14 }}>
                      <View style={dm.typeRow}>
                        {ENTRY_TYPES.map(et => (
                          <TouchableOpacity
                            key={et.key}
                            style={[dm.typeChip, { borderColor: t.line }, entryType === et.key && { backgroundColor: t.ink, borderColor: t.ink }]}
                            onPress={() => setEntryType(et.key)}
                          >
                            <Text style={[dm.typeChipText, { color: entryType === et.key ? t.cardSolid : t.muted }]}>{et.label}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>

                      {([["subjective", "Subjetivo (S)"], ["objective", "Objetivo (O)"], ["assessment", "Análisis (A)"], ["plan", "Plan (P)"]] as const).map(([key, label]) => (
                        <View key={key}>
                          <Text style={[dm.fieldLabel, { color: t.subtle }]}>{label}</Text>
                          <TextInput
                            style={[dm.input, { backgroundColor: t.inputBg, borderColor: t.inputBorder, color: t.ink, minHeight: 64, textAlignVertical: "top" }]}
                            value={soap[key]}
                            onChangeText={v => setSoap(prev => ({ ...prev, [key]: v }))}
                            placeholder="—"
                            placeholderTextColor={t.subtle}
                            multiline
                          />
                        </View>
                      ))}

                      <Text style={[dm.fieldLabel, { color: t.subtle }]}>Signos vitales</Text>
                      <View style={dm.vitalsRow}>
                        {VITAL_FIELDS.map(v => (
                          <View key={v.key} style={dm.vitalBox}>
                            <Text style={[dm.vitalLabel, { color: t.subtle }]}>{v.label}</Text>
                            <TextInput
                              style={[dm.vitalInput, { backgroundColor: t.inputBg, borderColor: t.inputBorder, color: t.ink }]}
                              value={vitals[v.key] ?? ""}
                              onChangeText={val => setVitals(prev => ({ ...prev, [v.key]: val }))}
                              placeholder="—"
                              placeholderTextColor={t.subtle}
                            />
                          </View>
                        ))}
                      </View>

                      <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
                        <TouchableOpacity onPress={() => saveEntry(false)} disabled={savingEntry} activeOpacity={0.8} style={[dm.draftBtn, { borderColor: t.lineStrong }]}>
                          <Text style={[dm.draftBtnText, { color: t.ink }]}>Guardar borrador</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => saveEntry(true)} disabled={savingEntry} activeOpacity={0.85} style={{ flex: 1, borderRadius: Radius.md, overflow: "hidden" }}>
                          <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={dm.signBtn}>
                            {savingEntry ? <ActivityIndicator color="white" /> : <Text style={dm.signBtnText}>Firmar y guardar</Text>}
                          </LinearGradient>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </Card>

                  {/* Historial de evoluciones */}
                  {entries.length > 0 && (
                    <View style={{ marginTop: 20 }}>
                      <SectionLabel>Historial ({entries.length})</SectionLabel>
                      {entries.map(en => (
                        <Card key={en.id} style={{ marginBottom: 10 }}>
                          <View style={{ padding: 14 }}>
                            <View style={dm.entryTop}>
                              <View style={[dm.entryTypeBadge, { backgroundColor: Colors.blue + "14" }]}>
                                <Text style={[dm.entryTypeText, { color: Colors.blue }]}>
                                  {ENTRY_TYPES.find(x => x.key === en.entry_type)?.label ?? en.entry_type}
                                </Text>
                              </View>
                              {en.status === "signed" ? (
                                <View style={dm.signedBadge}>
                                  <Ionicons name="lock-closed" size={10} color={Colors.success} />
                                  <Text style={[dm.signedText, { color: Colors.success }]}>Firmada</Text>
                                </View>
                              ) : (
                                <TouchableOpacity onPress={() => deleteDraft(en.id)}>
                                  <Text style={[dm.deleteText, { color: Colors.red }]}>Eliminar</Text>
                                </TouchableOpacity>
                              )}
                            </View>
                            <Text style={[dm.entryDate, { color: t.subtle }]}>
                              {new Date(en.created_at).toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                              {en.signed_name ? ` · ${en.signed_name}` : ""}
                            </Text>
                            {([["subjective", "S"], ["objective", "O"], ["assessment", "A"], ["plan", "P"]] as const).map(([key, tag]) =>
                              en[key] ? (
                                <View key={key} style={dm.soapLine}>
                                  <Text style={[dm.soapTag, { color: Colors.red }]}>{tag}</Text>
                                  <Text style={[dm.soapText, { color: t.muted }]}>{en[key]}</Text>
                                </View>
                              ) : null
                            )}
                            {en.vitals && Object.values(en.vitals).some(v => v) && (
                              <Text style={[dm.vitalsSummary, { color: t.subtle }]}>
                                {VITAL_FIELDS.filter(v => en.vitals?.[v.key]).map(v => `${v.label} ${en.vitals?.[v.key]}`).join("  ·  ")}
                              </Text>
                            )}
                          </View>
                        </Card>
                      ))}
                    </View>
                  )}
                </>
              )}
            </ScrollView>
          </KeyboardAvoidingView>
        )}
      </View>
    </Modal>
  );
}

// ─── Lista de pacientes ────────────────────────────────────────────────────────
export default function ClinicalScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const { tenantId } = useAuth();
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [records, setRecords] = useState<Map<string, RecordRow>>(new Map());
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [monthEntries, setMonthEntries] = useState(0);
  const [vertical, setVertical] = useState<Vertical>("general");
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ClientRow | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) return;
    const [{ data: cls }, { data: recs }, { data: tenant }] = await Promise.all([
      supabase.from("clients").select("id,name,phone,email").eq("tenant_id", tenantId).order("name").limit(500),
      supabase.from("clinical_records").select("*").eq("tenant_id", tenantId).limit(1000),
      supabase.from("tenants").select("settings").eq("id", tenantId).limit(1).maybeSingle(),
    ]);
    setClients((cls ?? []) as ClientRow[]);
    const recMap = new Map<string, RecordRow>();
    (recs ?? []).forEach((r: any) => recMap.set(r.client_id, r));
    setRecords(recMap);

    const s = (tenant?.settings ?? {}) as Record<string, unknown>;
    setSettings(s);
    if (s.vertical === "odontologia" || s.vertical === "estetica" || s.vertical === "general") setVertical(s.vertical);

    if (recs && recs.length > 0) {
      const { data: ents } = await supabase.from("clinical_entries")
        .select("record_id,created_at").eq("tenant_id", tenantId).limit(5000);
      const c = new Map<string, number>();
      const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
      let month = 0;
      (ents ?? []).forEach((e: any) => {
        c.set(e.record_id, (c.get(e.record_id) ?? 0) + 1);
        if (new Date(e.created_at) >= monthStart) month++;
      });
      setCounts(c);
      setMonthEntries(month);
    } else {
      setCounts(new Map());
      setMonthEntries(0);
    }
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  const saveVertical = async (v: Vertical) => {
    if (!tenantId) return;
    setVertical(v);
    const next = { ...settings, vertical: v };
    await supabase.from("tenants").update({ settings: next }).eq("id", tenantId);
    setSettings(next);
  };

  const filtered = useMemo(() => clients.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) || (c.phone ?? "").includes(search)
  ), [clients, search]);

  const withRecord = clients.filter(c => records.has(c.id)).length;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.canvas }}>
      <ScreenHeader
        crumb="Clientes"
        title="Historias clínicas"
        subtitle={`${withRecord} paciente${withRecord !== 1 ? "s" : ""} con historia abierta`}
        onBack={() => router.back()}
      />

      <FlatList
        data={filtered}
        keyExtractor={c => c.id}
        contentContainerStyle={{ padding: 20, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={{ marginBottom: 16 }}>
            {/* Tipo de práctica */}
            <SectionLabel>Tipo de práctica</SectionLabel>
            <View style={dm.vertRow}>
              {VERTICALS.map(v => {
                const active = vertical === v.key;
                return (
                  <TouchableOpacity
                    key={v.key}
                    style={[dm.vertChip, { backgroundColor: active ? Colors.blue + "10" : t.cardSolid, borderColor: active ? Colors.blue : t.line }]}
                    onPress={() => saveVertical(v.key)}
                    activeOpacity={0.8}
                  >
                    <Text style={[dm.vertLabel, { color: active ? Colors.blue : t.ink }]} numberOfLines={2}>{v.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Métricas */}
            {!loading && clients.length > 0 && (
              <View style={dm.metricsRow}>
                {[
                  { label: "Con historia", value: withRecord, color: Colors.success },
                  { label: "Sin historia", value: clients.length - withRecord, color: t.subtle },
                  { label: "Evol. este mes", value: monthEntries, color: Colors.blue },
                ].map(m => (
                  <View key={m.label} style={[dm.metricCard, { backgroundColor: t.cardSolid, borderColor: t.line }]}>
                    <Text style={[dm.metricValue, { color: t.ink }]}>{m.value}</Text>
                    <Text style={[dm.metricLabel, { color: m.color }]}>{m.label}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Buscador */}
            <View style={[dm.searchWrap, { backgroundColor: t.cardSolid, borderColor: t.line }]}>
              <Ionicons name="search-outline" size={16} color={t.subtle} />
              <TextInput
                style={[dm.searchInput, { color: t.ink }]}
                value={search}
                onChangeText={setSearch}
                placeholder="Buscar paciente..."
                placeholderTextColor={t.subtle}
              />
            </View>
          </View>
        }
        renderItem={({ item: c, index: i }) => {
          const rec = records.get(c.id);
          const count = rec ? (counts.get(rec.id) ?? 0) : 0;
          return (
            <Animated.View entering={i < 12 ? FadeInDown.delay(i * 30).duration(300) : undefined}>
              <TouchableOpacity
                style={[dm.row, { backgroundColor: t.cardSolid, borderColor: t.line }]}
                onPress={() => setSelected(c)}
                activeOpacity={0.7}
              >
                <Avatar name={c.name} size={38} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[dm.rowName, { color: t.ink }]} numberOfLines={1}>{c.name}</Text>
                  <Text style={[dm.rowPhone, { color: t.subtle }]} numberOfLines={1}>{c.phone ?? "Sin teléfono"}</Text>
                </View>
                {rec ? (
                  <View style={[dm.recBadge, { backgroundColor: Colors.success + "12" }]}>
                    <View style={[dm.recDot, { backgroundColor: Colors.success }]} />
                    <Text style={[dm.recBadgeText, { color: "#0d9668" }]}>{count} evol.</Text>
                  </View>
                ) : (
                  <View style={dm.newBadgeWrap}>
                    <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={dm.newBadge}>
                      <Text style={dm.newBadgeText}>Crear</Text>
                    </LinearGradient>
                  </View>
                )}
              </TouchableOpacity>
            </Animated.View>
          );
        }}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={Colors.red} style={{ marginTop: 40 }} />
          ) : (
            <View style={{ padding: 40, alignItems: "center" }}>
              <Ionicons name="pulse-outline" size={40} color={t.subtle} style={{ marginBottom: 12 }} />
              <Text style={[dm.emptyTitle, { color: t.ink }]}>{search ? "Sin resultados" : "Aún no hay pacientes"}</Text>
              <Text style={[dm.emptyText, { color: t.muted }]}>
                {search ? `No encontramos "${search}"` : "Tus clientes del CRM aparecen aquí para abrirles historia clínica."}
              </Text>
            </View>
          )
        }
      />

      {selected && tenantId && (
        <PatientModal
          client={selected}
          tenantId={tenantId}
          vertical={vertical}
          onClose={() => setSelected(null)}
          onSaved={load}
        />
      )}
    </SafeAreaView>
  );
}

const dm = StyleSheet.create({
  // Modal header
  header:    { paddingTop: 12, paddingHorizontal: 16, paddingBottom: 0 },
  accent:    { position: "absolute", top: 0, left: 0, right: 0, height: 3 },
  headerRow: { flexDirection: "row", alignItems: "center" },
  iconBtn:   { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,.16)", alignItems: "center", justifyContent: "center" },
  title:     { fontSize: 16, fontFamily: Fonts.bold, color: "white" },
  subtitle:  { fontSize: 11, fontFamily: Fonts.regular, color: "rgba(255,255,255,.6)", marginTop: 1 },
  tabs:      { flexDirection: "row", gap: 6, marginTop: 14 },
  tab:       { flex: 1, paddingVertical: 10, alignItems: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabActive: { borderBottomColor: "#ff5d54" },
  tabText:   { fontSize: 13, fontFamily: Fonts.semibold, color: "rgba(255,255,255,.55)" },
  tabTextActive: { color: "white" },

  fieldLabel: { fontSize: 11, fontFamily: Fonts.mono, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 },
  input:      { borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, fontFamily: Fonts.regular },
  saveBtn:    { paddingVertical: 15, alignItems: "center" },
  saveBtnText:{ fontSize: 14, fontFamily: Fonts.bold, color: "white" },

  typeRow:    { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  typeChip:   { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  typeChipText: { fontSize: 12, fontFamily: Fonts.semibold },

  vitalsRow:  { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  vitalBox:   { width: "31%", flexGrow: 1 },
  vitalLabel: { fontSize: 10, fontFamily: Fonts.mono, textTransform: "uppercase", marginBottom: 4 },
  vitalInput: { borderWidth: 1, borderRadius: Radius.sm, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, fontFamily: Fonts.mono },

  draftBtn:     { flex: 1, borderWidth: 1.5, borderRadius: Radius.md, paddingVertical: 13, alignItems: "center" },
  draftBtnText: { fontSize: 13, fontFamily: Fonts.semibold },
  signBtn:      { paddingVertical: 14, alignItems: "center" },
  signBtnText:  { fontSize: 13, fontFamily: Fonts.bold, color: "white" },

  entryTop:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  entryTypeBadge: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 20 },
  entryTypeText:  { fontSize: 11, fontFamily: Fonts.semibold },
  signedBadge:    { flexDirection: "row", alignItems: "center", gap: 4 },
  signedText:     { fontSize: 11, fontFamily: Fonts.semibold },
  deleteText:     { fontSize: 12, fontFamily: Fonts.semibold },
  entryDate:      { fontSize: 11, fontFamily: Fonts.mono, marginTop: 6, marginBottom: 8 },
  soapLine:       { flexDirection: "row", gap: 8, marginBottom: 4 },
  soapTag:        { fontSize: 12, fontFamily: Fonts.monoBold, width: 14 },
  soapText:       { fontSize: 13, fontFamily: Fonts.regular, flex: 1, lineHeight: 18 },
  vitalsSummary:  { fontSize: 11, fontFamily: Fonts.mono, marginTop: 8 },

  emptyTitle: { fontSize: 15, fontFamily: Fonts.bold, marginBottom: 6 },
  emptyText:  { fontSize: 13, fontFamily: Fonts.regular, textAlign: "center", lineHeight: 19, marginTop: 10 },

  // Lista
  vertRow:    { flexDirection: "row", gap: 8, marginBottom: 18 },
  vertChip:   { flex: 1, borderWidth: 1.5, borderRadius: Radius.md, paddingVertical: 12, paddingHorizontal: 8, minHeight: 52, alignItems: "center", justifyContent: "center" },
  vertLabel:  { fontSize: 12.5, fontFamily: Fonts.bold, textAlign: "center", lineHeight: 16 },
  metricsRow: { flexDirection: "row", gap: 10, marginBottom: 18 },
  metricCard: { flex: 1, borderWidth: 1, borderRadius: Radius.md, padding: 13 },
  metricValue:{ fontSize: 22, fontFamily: Fonts.bold, letterSpacing: -0.6 },
  metricLabel:{ fontSize: 11, fontFamily: Fonts.semibold, marginTop: 5 },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 11 },
  searchInput:{ flex: 1, fontSize: 14, fontFamily: Fonts.regular },

  row:        { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: Radius.md, padding: 12, marginBottom: 10 },
  rowName:    { fontSize: 14, fontFamily: Fonts.semibold },
  rowPhone:   { fontSize: 12, fontFamily: Fonts.regular, marginTop: 1 },
  recBadge:   { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  recDot:     { width: 6, height: 6, borderRadius: 3 },
  recBadgeText: { fontSize: 11, fontFamily: Fonts.bold },
  newBadgeWrap: { borderRadius: 10, overflow: "hidden" },
  newBadge:   { paddingHorizontal: 14, paddingVertical: 7 },
  newBadgeText: { fontSize: 12, fontFamily: Fonts.bold, color: "white" },
});
