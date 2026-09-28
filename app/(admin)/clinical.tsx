import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput,
  Modal, KeyboardAvoidingView, ActivityIndicator, Alert, FlatList,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { Colors, Fonts, Gradients, Radius } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { ScreenHeader, Card, SectionLabel } from "@/components/ui";
import Avatar from "@/components/Avatar";
import ErrorState from "@/components/ErrorState";
import { exigirFilas, mensajeError, patchTenantSettings, revisar, traerPorIds, traerTodo, ErrorDB } from "@/lib/db";
import { diaLocalDe, fmtDia, horaLocalDe, hoyNegocio, inicioDeMes, inicioDelDiaUTC } from "@/lib/tz";
import { fmt12, fmtTelefono } from "@/lib/format";
import { useListaClientes } from "@/lib/useListaClientes";
import { useGuardRespuestas, useRecarga } from "@/lib/useRecarga";

type Vertical = "odontologia" | "estetica" | "general";
const VERTICALS: { key: Vertical; label: string; desc: string }[] = [
  { key: "general",     label: "Salud general",     desc: "Ficha y evoluciones" },
  { key: "odontologia", label: "Odontología",       desc: "Práctica dental" },
  { key: "estetica",    label: "Medicina estética", desc: "Procedimientos" },
];

type ClientRow = { id: string; name: string; phone: string | null; phone_country_code?: string | null; email: string | null };
type RecordRow = {
  id: string; client_id: string; updated_at: string;
  document_type: string | null; document_number: string | null;
  birth_date: string | null; gender: string | null; occupation: string | null;
  address: string | null; city: string | null; eps: string | null;
  emergency_contact_name: string | null; emergency_contact_phone: string | null;
  blood_type: string | null; allergies: string | null; medications: string | null;
  medical_history: string | null; family_history: string | null; habits: string | null;
};
/** Lo mínimo para la lista: nada de alergias ni diagnósticos en memoria (CAL-21 / SEG-15). */
type RecordLite = { id: string; client_id: string; updated_at: string };
type Vitals = { ta?: string; fc?: string; fr?: string; temp?: string; peso?: string; talla?: string };
type EntryRow = {
  id: string; record_id: string; entry_type: string;
  professional_id: string | null;
  subjective: string | null; objective: string | null;
  assessment: string | null; plan: string | null;
  vitals: Vitals | null; status: string; signed_name: string | null;
  signed_at: string | null; created_at: string;
};
type Profesional = { id: string; name: string };

// Área táctil extra para los botones pequeños (CAL-24).
const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

const ENTRY_TYPES: { key: string; label: string }[] = [
  { key: "evolucion",    label: "Evolución" },
  { key: "procedimiento", label: "Procedimiento" },
  { key: "control",      label: "Control" },
  { key: "adicion",      label: "Adición" },
];

const FICHA_FIELDS: { key: keyof RecordRow; label: string; kb?: "default" | "numeric" | "phone-pad"; multiline?: boolean }[] = [
  { key: "document_type",           label: "Tipo de documento" },
  { key: "document_number",         label: "Número de documento" },
  { key: "birth_date",              label: "Fecha de nacimiento (AAAA-MM-DD)" },
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

type Respuesta<T> = PromiseLike<{ data: T[] | null; error: unknown }>;

function esFechaReal(dia: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/**
 * Rastro de accesos a la historia clínica (Res. 1995/1999, Ley 1581), igual
 * que logAction del portal: 'view', 'create_record', 'update_record',
 * 'create_entry', 'sign_entry', 'delete_entry'. Antes el móvil no dejaba
 * ninguno. No bloquea al profesional si falla (se avisa en consola): la
 * atención no puede esperar a que el log responda.
 */
async function registrarAcceso(tenantId: string, userId: string | null, recordId: string | null, action: string, detail?: string) {
  const { error } = await supabase.from("clinical_access_logs").insert({
    tenant_id: tenantId, record_id: recordId, user_id: userId, action, detail: detail ?? "app móvil",
  });
  if (error) console.warn(`[clinical] no se registró el acceso "${action}":`, error.message);
}

// ─── Detalle de paciente (ficha + evoluciones) ────────────────────────────────
function PatientModal({ client, tenantId, onClose, onSaved }: {
  client: ClientRow; tenantId: string;
  onClose: () => void; onSaved: () => void;
}) {
  const { t } = useTheme();
  const { user } = useAuth();
  const { timezone } = useTenant();
  const insets = useSafeAreaInsets();
  const guard = useGuardRespuestas();
  const [tab, setTab] = useState<"ficha" | "evolucion">("evolucion");
  const [record, setRecord] = useState<RecordRow | null>(null);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [profesionales, setProfesionales] = useState<Profesional[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [savingFicha, setSavingFicha] = useState(false);
  const [ficha, setFicha] = useState<Partial<RecordRow>>({});
  const vistaRegistrada = useRef<string | null>(null);

  // Formulario de nueva evolución
  const [entryType, setEntryType] = useState("evolucion");
  const [entryPro, setEntryPro] = useState<string | null>(null);
  const [soap, setSoap] = useState({ subjective: "", objective: "", assessment: "", plan: "" });
  const [vitals, setVitals] = useState<Vitals>({});
  const [savingEntry, setSavingEntry] = useState(false);
  const savingEntryRef = useRef(false);

  const load = useCallback(async () => {
    const turno = guard.nuevo();
    setLoading(true);
    try {
      const [recRes, prosRes] = await Promise.all([
        supabase.from("clinical_records")
          .select("*").eq("tenant_id", tenantId).eq("client_id", client.id).limit(1).maybeSingle(),
        supabase.from("professionals").select("id, name").eq("tenant_id", tenantId).eq("is_active", true).order("name"),
      ]);
      const rec = revisar(recRes, "No se pudo cargar la historia clínica") as RecordRow | null;
      const pros = (revisar(prosRes, "No se pudo cargar el equipo") ?? []) as Profesional[];
      let ents: EntryRow[] = [];
      if (rec) {
        ents = await traerTodo<EntryRow>((d, h) => supabase.from("clinical_entries")
          .select("*").eq("record_id", rec.id)
          .order("created_at", { ascending: false }).order("id")
          .range(d, h) as unknown as Respuesta<EntryRow>, { tope: 3000, contexto: "No se pudieron cargar las evoluciones" });
      }
      if (!turno.vigente()) return;
      setRecord(rec ?? null);
      setFicha(rec ?? {});
      setEntries(ents);
      setProfesionales(pros);
      if (pros.length === 1) setEntryPro(prev => prev ?? pros[0].id);
      setTab(rec ? "evolucion" : "ficha");
      setError(null);
      if (rec && vistaRegistrada.current !== rec.id) {
        vistaRegistrada.current = rec.id;
        registrarAcceso(tenantId, user?.id ?? null, rec.id, "view");
      }
    } catch (e) {
      if (turno.vigente()) setError(e);
    } finally {
      if (turno.vigente()) setLoading(false);
    }
  }, [client.id, tenantId, user?.id, guard]);

  useEffect(() => { load(); }, [load]);

  const saveFicha = async () => {
    if (savingFicha) return;
    const nacimiento = ((ficha.birth_date as string) ?? "").trim();
    if (nacimiento && (!esFechaReal(nacimiento) || nacimiento > hoyNegocio(timezone))) {
      Alert.alert("Fecha inválida", "La fecha de nacimiento debe ser real y en formato AAAA-MM-DD (ej: 1990-04-15).");
      return;
    }
    setSavingFicha(true);
    try {
      const payload: Record<string, unknown> = { tenant_id: tenantId, client_id: client.id };
      FICHA_FIELDS.forEach(f => { payload[f.key] = (ficha[f.key] as string)?.trim?.() || null; });
      if (record) {
        const filas = exigirFilas(
          await supabase.from("clinical_records").update(payload).eq("id", record.id).select("*"),
          "No se pudo guardar la ficha",
        );
        setRecord(filas[0] as RecordRow);
        registrarAcceso(tenantId, user?.id ?? null, record.id, "update_record");
        Alert.alert("Ficha actualizada");
      } else {
        const data = revisar(
          await supabase.from("clinical_records").insert(payload).select("*").single(),
          "No se pudo crear la historia clínica",
        ) as RecordRow;
        setRecord(data);
        setTab("evolucion");
        vistaRegistrada.current = data.id;
        registrarAcceso(tenantId, user?.id ?? null, data.id, "create_record");
        onSaved();
      }
    } catch (e) {
      Alert.alert("No se guardó", mensajeError(e));
    } finally {
      setSavingFicha(false);
    }
  };

  const entryHasContent = () => Object.values(soap).some(s => s.trim());

  const saveEntry = async (sign: boolean) => {
    if (!record || savingEntryRef.current) return;
    if (!entryHasContent()) { Alert.alert("Nota vacía", "Escribe al menos una sección (S/O/A/P)."); return; }
    const pro = profesionales.find(p => p.id === entryPro) ?? null;
    if (sign && profesionales.length > 0 && !pro) {
      Alert.alert("¿Quién firma?", "Elige el profesional que atendió: la firma queda a su nombre.");
      return;
    }
    const firmante = pro?.name ?? user?.email ?? "Profesional";
    const doSave = async () => {
      savingEntryRef.current = true;
      setSavingEntry(true);
      try {
        const payload: Record<string, unknown> = {
          tenant_id: tenantId, record_id: record.id, entry_type: entryType,
          professional_id: pro?.id ?? null,
          subjective: soap.subjective.trim() || null,
          objective: soap.objective.trim() || null,
          assessment: soap.assessment.trim() || null,
          plan: soap.plan.trim() || null,
          vitals: Object.values(vitals).some(v => v) ? vitals : null,
        };
        if (sign) {
          payload.status = "signed";
          // Con la migración, el servidor pisa signed_at con now() y signed_by
          // con el usuario real (el reloj del teléfono se puede manipular).
          payload.signed_at = new Date().toISOString();
          payload.signed_by = user?.id ?? null;
          payload.signed_name = firmante;
        }
        revisar(await supabase.from("clinical_entries").insert(payload).select("id").single(), "No se pudo guardar la evolución");
        registrarAcceso(tenantId, user?.id ?? null, record.id, sign ? "sign_entry" : "create_entry");
        setSoap({ subjective: "", objective: "", assessment: "", plan: "" });
        setVitals({});
        await load();
        onSaved();
      } catch (e) {
        Alert.alert("No se guardó", mensajeError(e));
      } finally {
        savingEntryRef.current = false;
        setSavingEntry(false);
      }
    };
    if (sign) {
      Alert.alert("Firmar evolución", `Vas a firmar como "${firmante}". Una entrada firmada queda bloqueada y no puede editarse ni eliminarse. ¿Continuar?`, [
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
        try {
          exigirFilas(await supabase.from("clinical_entries").delete().eq("id", id).select("id"), "No se pudo eliminar el borrador");
          registrarAcceso(tenantId, user?.id ?? null, record?.id ?? null, "delete_entry");
          setEntries(prev => prev.filter(e => e.id !== id));
        } catch (e) {
          Alert.alert("No se eliminó", mensajeError(e));
        }
      }},
    ]);
  };

  const fechaEntrada = (iso: string) => `${fmtDia(diaLocalDe(iso, timezone), "corto")} · ${fmt12(horaLocalDe(iso, timezone))}`;

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: t.canvas }}>
        <View style={[dm.header, { backgroundColor: "#0C0C14", paddingTop: insets.top + 10 }]}>
          <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={dm.accent} />
          <View style={dm.headerRow}>
            <TouchableOpacity onPress={onClose} style={dm.iconBtn} hitSlop={HIT_SLOP} accessibilityRole="button" accessibilityLabel="Volver">
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
              <TouchableOpacity key={tb} style={[dm.tab, tab === tb && dm.tabActive]} onPress={() => setTab(tb)} accessibilityRole="tab" accessibilityState={{ selected: tab === tb }}>
                <Text style={[dm.tabText, tab === tb && dm.tabTextActive]}>
                  {tb === "ficha" ? "Ficha" : "Evoluciones"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {loading && !record && entries.length === 0 && !error ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator color={Colors.red} size="large" />
          </View>
        ) : error ? (
          <ErrorState error={error} onRetry={load} />
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
                  <TouchableOpacity onPress={saveFicha} disabled={savingFicha} activeOpacity={0.85} style={{ marginTop: 16, borderRadius: Radius.md, overflow: "hidden" }} accessibilityRole="button">
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
                    <Text style={[dm.emptyText, { color: t.muted }]}>Primero crea la ficha del paciente en la pestaña &quot;Ficha&quot;.</Text>
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
                            accessibilityRole="button"
                            accessibilityState={{ selected: entryType === et.key }}
                          >
                            <Text style={[dm.typeChipText, { color: entryType === et.key ? t.cardSolid : t.muted }]}>{et.label}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>

                      {profesionales.length > 0 && (
                        <View>
                          <Text style={[dm.fieldLabel, { color: t.subtle }]}>Profesional que atiende</Text>
                          <View style={dm.typeRow}>
                            {profesionales.map(p => (
                              <TouchableOpacity
                                key={p.id}
                                style={[dm.typeChip, { borderColor: t.line }, entryPro === p.id && { backgroundColor: Colors.blue, borderColor: Colors.blue }]}
                                onPress={() => setEntryPro(prev => prev === p.id ? null : p.id)}
                                accessibilityRole="button"
                                accessibilityState={{ selected: entryPro === p.id }}
                              >
                                <Text style={[dm.typeChipText, { color: entryPro === p.id ? "white" : t.muted }]}>{p.name}</Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                        </View>
                      )}

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
                        <TouchableOpacity onPress={() => saveEntry(false)} disabled={savingEntry} activeOpacity={0.8} style={[dm.draftBtn, { borderColor: t.lineStrong }, savingEntry && { opacity: 0.5 }]} accessibilityRole="button">
                          <Text style={[dm.draftBtnText, { color: t.ink }]}>Guardar borrador</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => saveEntry(true)} disabled={savingEntry} activeOpacity={0.85} style={{ flex: 1, borderRadius: Radius.md, overflow: "hidden" }} accessibilityRole="button">
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
                                <TouchableOpacity onPress={() => deleteDraft(en.id)} hitSlop={HIT_SLOP} accessibilityRole="button" accessibilityLabel="Eliminar borrador">
                                  <Text style={[dm.deleteText, { color: Colors.red }]}>Eliminar</Text>
                                </TouchableOpacity>
                              )}
                            </View>
                            <Text style={[dm.entryDate, { color: t.subtle }]}>
                              {fechaEntrada(en.signed_at ?? en.created_at)}
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
type Metricas = { clientes: number; conHistoria: number; evolMes: number };

export default function ClinicalScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const { tenantId } = useAuth();
  const { timezone, ready } = useTenant();
  const guard = useGuardRespuestas();
  const guardFichas = useGuardRespuestas();
  const [search, setSearch] = useState("");
  const [records, setRecords] = useState<Map<string, RecordLite>>(new Map());
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [metricas, setMetricas] = useState<Metricas | null>(null);
  const [errorMetricas, setErrorMetricas] = useState<unknown>(null);
  const [vertical, setVertical] = useState<Vertical>("general");
  // null = todavía no se sabe (o falló la lectura): los chips no se pueden tocar.
  const [verticalListo, setVerticalListo] = useState(false);
  const [guardandoVertical, setGuardandoVertical] = useState(false);
  const [selected, setSelected] = useState<ClientRow | null>(null);

  // Pacientes: paginado y con búsqueda en el servidor (antes limit 500 y
  // búsqueda local: el paciente 501 no existía para el móvil).
  const lista = useListaClientes<ClientRow>({
    tenantId,
    busqueda: search,
    columnas: "id, name, phone, phone_country_code, email",
    porPagina: 50,
    timeZone: timezone,
  });

  // Métricas con conteos del servidor, no sobre listas truncadas, y "este mes"
  // desde el día 1 en la zona del negocio.
  const { recargar: recargarMetricas } = useRecarga(async () => {
    if (!tenantId) return;
    const turno = guard.nuevo();
    try {
      const desdeMes = inicioDelDiaUTC(inicioDeMes(hoyNegocio(timezone)), timezone);
      const [cli, rec, ent, ten] = await Promise.all([
        supabase.from("clients").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
        supabase.from("clinical_records").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
        supabase.from("clinical_entries").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).gte("created_at", desdeMes),
        supabase.from("tenants").select("settings").eq("id", tenantId).single(),
      ]);
      for (const r of [cli, rec, ent]) if (r.error) throw new ErrorDB(r.error, "No se pudieron calcular las métricas");
      if (!turno.vigente()) return;
      setMetricas({ clientes: cli.count ?? 0, conHistoria: rec.count ?? 0, evolMes: ent.count ?? 0 });
      setErrorMetricas(null);
      if (ten.error) {
        setVerticalListo(false);
      } else {
        const s = (ten.data?.settings ?? {}) as Record<string, unknown>;
        if (s.vertical === "odontologia" || s.vertical === "estetica" || s.vertical === "general") setVertical(s.vertical);
        setVerticalListo(true);
      }
      // Al volver a la pantalla, las fichas pudieron cambiar desde el portal.
      cargarFichas();
    } catch (e) {
      if (turno.vigente()) setErrorMetricas(e);
    }
  }, [tenantId, timezone], { timeZone: timezone, habilitado: !!tenantId && ready, alCambiarSede: false });

  // Fichas y conteo de evoluciones SOLO de los pacientes visibles: la lista ya
  // no descarga select('*') de todas las historias del negocio.
  const idsVisibles = useMemo(() => lista.filas.map(c => c.id), [lista.filas]);
  const claveIds = idsVisibles.join(",");
  const cargarFichas = useCallback(async () => {
    if (!tenantId || idsVisibles.length === 0) { setRecords(new Map()); setCounts(new Map()); return; }
    const turno = guardFichas.nuevo();
    try {
      const recs = await traerPorIds<RecordLite>(idsVisibles, (lote, d, h) => supabase.from("clinical_records")
        .select("id, client_id, updated_at").eq("tenant_id", tenantId).in("client_id", lote)
        .order("id").range(d, h) as unknown as Respuesta<RecordLite>, { contexto: "No se pudieron cargar las historias" });
      const ents = await traerPorIds<{ id: string; record_id: string }>(recs.map(r => r.id), (lote, d, h) => supabase.from("clinical_entries")
        .select("id, record_id").in("record_id", lote)
        .order("id").range(d, h) as unknown as Respuesta<{ id: string; record_id: string }>, { contexto: "No se pudieron contar las evoluciones" });
      if (!turno.vigente()) return;
      const recMap = new Map<string, RecordLite>();
      recs.forEach(r => recMap.set(r.client_id, r));
      const c = new Map<string, number>();
      ents.forEach(e => c.set(e.record_id, (c.get(e.record_id) ?? 0) + 1));
      setRecords(recMap);
      setCounts(c);
    } catch (e) {
      if (turno.vigente()) setErrorMetricas(e);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, claveIds, guardFichas]);
  useEffect(() => { cargarFichas(); }, [cargarFichas]);

  const recargarTodo = async () => {
    await Promise.all([lista.recargar(), recargarMetricas()]);
    await cargarFichas();
  };

  // D7: se escribe SOLO la clave "vertical" (patchTenantSettings: RPC atómica
  // o leer-fresco-y-fusionar). Antes se escribía una copia de settings tomada
  // al abrir la pantalla, o {} si aún no había cargado, y se borraban el
  // horario, la zona horaria y el resto de ajustes que usa la reserva pública.
  const saveVertical = async (v: Vertical) => {
    if (!tenantId || !verticalListo || guardandoVertical || v === vertical) return;
    const anterior = vertical;
    setVertical(v);
    setGuardandoVertical(true);
    try {
      await patchTenantSettings(tenantId, { vertical: v });
    } catch (e) {
      setVertical(anterior);
      Alert.alert("No se guardó el tipo de práctica", mensajeError(e));
    } finally {
      setGuardandoVertical(false);
    }
  };

  const withRecord = metricas?.conHistoria ?? 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.canvas }}>
      <ScreenHeader
        crumb="Clientes"
        title="Historias clínicas"
        subtitle={metricas ? `${withRecord} paciente${withRecord !== 1 ? "s" : ""} con historia abierta` : "Cargando…"}
        onBack={() => router.back()}
      />

      {lista.error && lista.filas.length === 0 && !lista.cargando ? (
        <ErrorState error={lista.error} onRetry={recargarTodo} />
      ) : (
      <FlatList
        data={lista.filas}
        keyExtractor={c => c.id}
        contentContainerStyle={{ padding: 20, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onEndReached={lista.cargarMas}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={
          <View style={{ marginBottom: 16 }}>
            {/* Tipo de práctica */}
            <SectionLabel>Tipo de práctica</SectionLabel>
            <View style={dm.vertRow}>
              {VERTICALS.map(v => {
                const active = vertical === v.key;
                const bloqueado = !verticalListo || guardandoVertical;
                return (
                  <TouchableOpacity
                    key={v.key}
                    style={[dm.vertChip, { backgroundColor: active ? Colors.blue + "10" : t.cardSolid, borderColor: active ? Colors.blue : t.line }, bloqueado && !active && { opacity: 0.5 }]}
                    onPress={() => saveVertical(v.key)}
                    disabled={bloqueado}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active, disabled: bloqueado }}
                  >
                    <Text style={[dm.vertLabel, { color: active ? Colors.blue : t.ink }]} numberOfLines={2}>{v.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {errorMetricas ? (
              <TouchableOpacity onPress={recargarTodo} style={[dm.errorBanner, { borderColor: Colors.red + "40" }]} accessibilityRole="button">
                <Text style={[dm.errorBannerText, { color: t.ink }]}>{mensajeError(errorMetricas)} Toca para reintentar.</Text>
              </TouchableOpacity>
            ) : null}

            {/* Métricas */}
            {metricas && metricas.clientes > 0 && (
              <View style={dm.metricsRow}>
                {[
                  { label: "Con historia", value: metricas.conHistoria, color: Colors.success },
                  { label: "Sin historia", value: Math.max(0, metricas.clientes - metricas.conHistoria), color: t.subtle },
                  { label: "Evol. este mes", value: metricas.evolMes, color: Colors.blue },
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
                placeholder="Buscar paciente por nombre o teléfono..."
                placeholderTextColor={t.subtle}
                autoCorrect={false}
              />
              {lista.cargando && search.trim().length >= 2 ? <ActivityIndicator size="small" color={t.subtle} /> : null}
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
                accessibilityRole="button"
              >
                <Avatar name={c.name} size={38} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[dm.rowName, { color: t.ink }]} numberOfLines={1}>{c.name}</Text>
                  <Text style={[dm.rowPhone, { color: t.subtle }]} numberOfLines={1}>
                    {c.phone ? fmtTelefono(c.phone, { indicativo: c.phone_country_code }) : "Sin teléfono"}
                  </Text>
                </View>
                {rec ? (
                  <View style={[dm.recBadge, { backgroundColor: Colors.success + "12" }]}>
                    <View style={[dm.recDot, { backgroundColor: Colors.success }]} />
                    <Text style={[dm.recBadgeText, { color: Colors.success }]}>{count} evol.</Text>
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
        ListFooterComponent={
          lista.cargandoMas ? <ActivityIndicator color={Colors.red} style={{ marginVertical: 16 }} />
          : lista.error && lista.filas.length > 0 ? (
            <TouchableOpacity onPress={lista.cargarMas} style={[dm.errorBanner, { borderColor: Colors.red + "40" }]} accessibilityRole="button">
              <Text style={[dm.errorBannerText, { color: t.ink }]}>{mensajeError(lista.error)} Toca para reintentar.</Text>
            </TouchableOpacity>
          ) : null
        }
        ListEmptyComponent={
          lista.cargando ? (
            <ActivityIndicator color={Colors.red} style={{ marginTop: 40 }} />
          ) : (
            <View style={{ padding: 40, alignItems: "center" }}>
              <Ionicons name="pulse-outline" size={40} color={t.subtle} style={{ marginBottom: 12 }} />
              <Text style={[dm.emptyTitle, { color: t.ink }]}>{search ? "Sin resultados" : "Aún no hay pacientes"}</Text>
              <Text style={[dm.emptyText, { color: t.muted }]}>
                {search ? (search.trim().length < 2 ? "Escribe al menos 2 letras." : `No encontramos "${search}"`) : "Tus clientes del CRM aparecen aquí para abrirles historia clínica."}
              </Text>
            </View>
          )
        }
      />
      )}

      {selected && tenantId && (
        <PatientModal
          key={selected.id}
          client={selected}
          tenantId={tenantId}
          onClose={() => setSelected(null)}
          onSaved={() => { recargarMetricas(); cargarFichas(); }}
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

  errorBanner:     { borderWidth: 1, borderRadius: Radius.md, padding: 12, marginBottom: 14, backgroundColor: Colors.red + "10" },
  errorBannerText: { fontSize: 12.5, fontFamily: Fonts.semibold },

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
