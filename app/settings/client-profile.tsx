import { useEffect, useState, useCallback } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Linking, Alert, Modal,
  TextInput, KeyboardAvoidingView, Platform, Switch,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown, FadeInRight } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { Colors, Gradients, Radius, Shadow } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { STATUS_META } from "@/constants/status";
import { fmtDateShort } from "@/lib/format";
import Avatar from "@/components/Avatar";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

type Client = {
  id: string; name: string; phone?: string; email?: string | null;
  no_shows?: number; created_at?: string; tenant_id?: string;
};

type Appt = {
  id: string; date: string; time: string; status: string;
  notes?: string;
  services: { name: string; price: number } | null;
};

type CustomField = {
  id: string; name: string; field_key: string;
  type: "text" | "number" | "date" | "select" | "boolean";
  options?: string[] | null; required: boolean;
};

type FieldValue = { field_id: string; value: string };

const FIELD_ICON: Record<string, IoniconName> = {
  text:    "text-outline",
  number:  "calculator-outline",
  date:    "calendar-outline",
  select:  "list-outline",
  boolean: "checkmark-circle-outline",
};


function StatBox({ value, label, color = Colors.text }: { value: string; label: string; color?: string }) {
  return (
    <View style={s.statBox}>
      <Text style={[s.statVal, { color }]}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

// ─── Edit modal ───────────────────────────────────────────────────────────────

function EditModal({ visible, client, onClose, onSaved }: {
  visible: boolean; client: Client | null; onClose: () => void; onSaved: (c: Client) => void;
}) {
  const { t } = useTheme();
  const [name, setName]   = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible && client) {
      setName(client.name); setPhone(client.phone ?? ""); setEmail(client.email ?? "");
    }
  }, [visible, client]);

  const canSave = name.trim().length >= 2 && phone.trim().length >= 6;

  const handleSave = async () => {
    if (!client || !canSave) return;
    setSaving(true);
    const payload = { name: name.trim(), phone: phone.trim(), email: email.trim() || null };
    await supabase.from("clients").update(payload).eq("id", client.id);
    setSaving(false);
    onSaved({ ...client, ...payload });
    onClose();
  };

  const handleDelete = () => {
    if (!client) return;
    Alert.alert("Eliminar cliente", `¿Eliminar a ${client.name}? Esta acción no se puede deshacer.`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Eliminar", style: "destructive", onPress: async () => {
        await supabase.from("clients").delete().eq("id", client.id);
        onClose();
        onSaved({ ...client, name: "__deleted__" });
      }},
    ]);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <View style={[em.header, { backgroundColor: "#0C0C14" }]}>
          <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3 }} />
          <View style={em.headerRow}>
            <TouchableOpacity onPress={onClose} style={em.iconBtn}>
              <Ionicons name="close" size={20} color="white" />
            </TouchableOpacity>
            <Text style={em.headerTitle}>Editar cliente</Text>
            <TouchableOpacity onPress={handleDelete} style={em.iconBtn}>
              <Ionicons name="trash-outline" size={18} color="white" />
            </TouchableOpacity>
          </View>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }}>
          <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 20, paddingBottom: 120 }}>
            {[
              { label: "Nombre completo *", value: name, set: setName, placeholder: "Ej: Juan García", cap: "words" as const },
              { label: "Teléfono *", value: phone, set: setPhone, placeholder: "3001234567", kb: "phone-pad" as const },
              { label: "Correo electrónico", value: email, set: setEmail, placeholder: "juan@email.com", kb: "email-address" as const },
            ].map(f => (
              <View key={f.label} style={em.field}>
                <Text style={em.fieldLabel}>{f.label}</Text>
                <TextInput
                  style={em.input} value={f.value} onChangeText={f.set}
                  placeholder={f.placeholder} placeholderTextColor={Colors.subtle}
                  keyboardType={f.kb ?? "default"} autoCapitalize={f.cap ?? "none"}
                />
              </View>
            ))}
          </ScrollView>

          <View style={em.bottomBar}>
            <TouchableOpacity
              style={[em.btn, !canSave && { opacity: 0.4 }]}
              onPress={handleSave} disabled={!canSave || saving} activeOpacity={0.85}
            >
              <View style={em.btnGrad}>
                {saving ? <ActivityIndicator color="white" /> : <Text style={em.btnText}>Guardar cambios</Text>}
              </View>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Custom fields edit modal ─────────────────────────────────────────────────

function FieldsModal({ visible, fields, values, clientId, onClose, onSaved }: {
  visible: boolean;
  fields: CustomField[];
  values: FieldValue[];
  clientId: string;
  onClose: () => void;
  onSaved: (newVals: FieldValue[]) => void;
}) {
  const { t } = useTheme();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      const initial: Record<string, string> = {};
      values.forEach(v => { initial[v.field_id] = v.value; });
      setDraft(initial);
    }
  }, [visible, values]);

  const handleSave = async () => {
    setSaving(true);
    const upserts = fields
      .filter(f => draft[f.id] !== undefined && draft[f.id] !== "")
      .map(f => ({ client_id: clientId, field_id: f.id, value: draft[f.id] }));

    if (upserts.length > 0) {
      await supabase.from("client_field_values").upsert(upserts, { onConflict: "client_id,field_id" });
    }

    const clearedIds = fields.filter(f => draft[f.id] === "").map(f => f.id);
    if (clearedIds.length > 0) {
      await supabase.from("client_field_values").delete().eq("client_id", clientId).in("field_id", clearedIds);
    }

    setSaving(false);
    const updated = fields
      .map(f => ({ field_id: f.id, value: draft[f.id] ?? "" }))
      .filter(v => v.value !== "");
    onSaved(updated);
    onClose();
  };

  const set = (fieldId: string, val: string) => setDraft(d => ({ ...d, [fieldId]: val }));

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <View style={[fm.header, { backgroundColor: "#0C0C14" }]}>
          <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3 }} />
          <View style={fm.headerRow}>
            <TouchableOpacity onPress={onClose} style={fm.iconBtn}>
              <Ionicons name="close" size={20} color="white" />
            </TouchableOpacity>
            <Text style={fm.headerTitle}>Campos personalizados</Text>
            <View style={{ width: 40 }} />
          </View>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }}>
          <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 20, paddingBottom: 120 }}>
            {fields.map(field => (
              <View key={field.id} style={fm.field}>
                <Text style={fm.fieldLabel}>{field.name}{field.required ? " *" : ""}</Text>

                {field.type === "boolean" ? (
                  <View style={fm.boolRow}>
                    <Switch
                      value={draft[field.id] === "true"}
                      onValueChange={v => set(field.id, v ? "true" : "false")}
                      trackColor={{ false: Colors.border, true: Colors.red + "80" }}
                      thumbColor={draft[field.id] === "true" ? Colors.red : Colors.subtle}
                    />
                    <Text style={fm.boolLabel}>{draft[field.id] === "true" ? "Sí" : "No"}</Text>
                  </View>

                ) : field.type === "select" && field.options ? (
                  <ScrollView automaticallyAdjustKeyboardInsets horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 4 }}>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      {field.options.map(opt => {
                        const active = draft[field.id] === opt;
                        return (
                          <TouchableOpacity
                            key={opt}
                            style={[fm.chip, active && fm.chipActive]}
                            onPress={() => set(field.id, active ? "" : opt)}
                            activeOpacity={0.75}
                          >
                            <Text style={[fm.chipText, active && { color: "white" }]}>{opt}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </ScrollView>

                ) : (
                  <TextInput
                    style={fm.input}
                    value={draft[field.id] ?? ""}
                    onChangeText={v => set(field.id, v)}
                    placeholder={field.type === "number" ? "0" : field.type === "date" ? "YYYY-MM-DD" : "—"}
                    placeholderTextColor={Colors.subtle}
                    keyboardType={field.type === "number" ? "numeric" : "default"}
                  />
                )}
              </View>
            ))}
          </ScrollView>

          <View style={fm.bottomBar}>
            <TouchableOpacity style={[fm.btn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving} activeOpacity={0.85}>
              <View style={fm.btnGrad}>
                {saving ? <ActivityIndicator color="white" /> : <Text style={fm.btnText}>Guardar</Text>}
              </View>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function ClientProfileScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [client, setClient]           = useState<Client | null>(null);
  const [appts, setAppts]             = useState<Appt[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [fieldValues, setFieldValues]  = useState<FieldValue[]>([]);
  const [loading, setLoading]          = useState(true);
  const [editOpen, setEditOpen]        = useState(false);
  const [fieldsOpen, setFieldsOpen]    = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const [{ data: c }, { data: a }] = await Promise.all([
      supabase.from("clients").select("id,name,phone,email,no_shows,created_at,tenant_id").eq("id", id).single(),
      supabase.from("appointments")
        .select("id,date,time,status,notes,services(name,price)")
        .eq("client_id", id)
        .order("date", { ascending: false })
        .limit(30),
    ]);
    if (c) setClient(c);
    setAppts((a ?? []) as unknown as Appt[]);

    if (c?.tenant_id) {
      const [{ data: cf }, { data: fv }] = await Promise.all([
        supabase.from("custom_fields")
          .select("id,name,field_key,type,options,required")
          .eq("tenant_id", c.tenant_id)
          .in("applies_to", ["cliente", "ambos"])
          .eq("active", true)
          .order("order_index"),
        supabase.from("client_field_values")
          .select("field_id,value")
          .eq("client_id", id),
      ]);
      setCustomFields((cf ?? []) as CustomField[]);
      setFieldValues((fv ?? []) as FieldValue[]);
    }

    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handleEditSaved = (updated: Client) => {
    if (updated.name === "__deleted__") { router.back(); return; }
    setClient(updated);
  };

  if (loading || !client) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={Colors.red} size="large" />
      </SafeAreaView>
    );
  }

  const completed  = appts.filter(a => a.status === "completed");
  const noShows    = appts.filter(a => a.status === "no_show").length;
  const totalSpent = completed.reduce((s, a) => s + Number(a.services?.price ?? 0), 0);
  const since      = client.created_at ? fmtDateShort(client.created_at.slice(0, 10)) : "—";

  const fmtMoney = (n: number) =>
    n >= 1000 ? `$${(n / 1000).toFixed(0)}k` : `$${n}`;

  const displayValue = (field: CustomField) => {
    const val = fieldValues.find(v => v.field_id === field.id)?.value;
    if (!val) return "—";
    if (field.type === "boolean") return val === "true" ? "Sí" : "No";
    return val;
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      {/* Header */}
      <View style={[s.header, { backgroundColor: "#0C0C14" }]}>
        <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3 }} />
        <View style={s.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={s.iconBtn}>
            <Ionicons name="arrow-back" size={20} color="white" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setEditOpen(true)} style={s.iconBtn}>
            <Ionicons name="create-outline" size={20} color="white" />
          </TouchableOpacity>
        </View>

        {/* Identity */}
        <View style={s.identity}>
          <Avatar name={client.name} size={72} />
          <Text style={s.clientName}>{client.name}</Text>
          <Text style={s.clientSince}>Cliente desde {since}</Text>

          {/* Quick actions */}
          <View style={s.actions}>
            {client.phone && (
              <>
                <TouchableOpacity
                  style={s.actionBtn}
                  onPress={() => Linking.openURL(`tel:${client.phone}`)}
                  activeOpacity={0.8}
                >
                  <Ionicons name="call-outline" size={18} color="white" />
                  <Text style={s.actionLabel}>Llamar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={s.actionBtn}
                  onPress={() => Linking.openURL(`https://wa.me/${client.phone?.replace(/\D/g, "")}`)}
                  activeOpacity={0.8}
                >
                  <Ionicons name="logo-whatsapp" size={18} color="white" />
                  <Text style={s.actionLabel}>WhatsApp</Text>
                </TouchableOpacity>
              </>
            )}
            {client.email && (
              <TouchableOpacity
                style={s.actionBtn}
                onPress={() => Linking.openURL(`mailto:${client.email}`)}
                activeOpacity={0.8}
              >
                <Ionicons name="mail-outline" size={18} color="white" />
                <Text style={s.actionLabel}>Correo</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>

      <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 20, paddingBottom: 100 }}>
        {/* Stats */}
        <Animated.View entering={FadeInDown.delay(0).duration(340)}>
          <View style={[s.statsCard, Shadow.sm]}>
            <StatBox value={String(appts.length)} label="Citas totales" />
            <View style={s.statDivider} />
            <StatBox value={String(completed.length)} label="Completadas" color={Colors.success} />
            <View style={s.statDivider} />
            <StatBox value={String(noShows)} label="No asistió" color={noShows > 0 ? Colors.red : Colors.text} />
            <View style={s.statDivider} />
            <StatBox value={fmtMoney(totalSpent)} label="Gastado" color={Colors.purple} />
          </View>
        </Animated.View>

        {/* Contact info */}
        <Animated.View entering={FadeInDown.delay(60).duration(340)}>
          <Text style={s.sectionLabel}>Contacto</Text>
          <View style={[s.card, Shadow.sm]}>
            {client.phone && (
              <View style={s.infoRow}>
                <View style={[s.infoIcon, { backgroundColor: Colors.success + "15" }]}>
                  <Ionicons name="call-outline" size={15} color={Colors.success} />
                </View>
                <Text style={s.infoText}>{client.phone}</Text>
              </View>
            )}
            {client.phone && client.email && <View style={s.infoDivider} />}
            {client.email && (
              <View style={s.infoRow}>
                <View style={[s.infoIcon, { backgroundColor: Colors.blue + "15" }]}>
                  <Ionicons name="mail-outline" size={15} color={Colors.blue} />
                </View>
                <Text style={s.infoText}>{client.email}</Text>
              </View>
            )}
            {!client.phone && !client.email && (
              <Text style={{ color: Colors.subtle, fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", padding: 4 }}>
                Sin datos de contacto
              </Text>
            )}
          </View>
        </Animated.View>

        {/* Custom fields */}
        {customFields.length > 0 && (
          <Animated.View entering={FadeInDown.delay(120).duration(340)}>
            <View style={s.sectionRow}>
              <Text style={s.sectionLabel}>Campos personalizados</Text>
              <TouchableOpacity onPress={() => setFieldsOpen(true)} style={s.editBtn}>
                <Ionicons name="create-outline" size={12} color={Colors.blue} />
                <Text style={s.editBtnText}>Editar</Text>
              </TouchableOpacity>
            </View>
            <View style={[s.card, Shadow.sm]}>
              {customFields.map((field, i) => {
                const val = displayValue(field);
                const hasVal = val !== "—";
                return (
                  <View key={field.id}>
                    {i > 0 && <View style={s.infoDivider} />}
                    <View style={s.infoRow}>
                      <View style={[s.infoIcon, { backgroundColor: Colors.purple + "15" }]}>
                        <Ionicons name={FIELD_ICON[field.type] ?? "text-outline"} size={15} color={Colors.purple} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.fieldName}>{field.name}</Text>
                        <Text style={[s.fieldVal, !hasVal && { color: Colors.subtle }]}>{val}</Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          </Animated.View>
        )}

        {/* Appointment history */}
        <Animated.View entering={FadeInDown.delay(180).duration(340)}>
          <Text style={[s.sectionLabel, { marginTop: 24 }]}>
            Historial de citas
            {appts.length > 0 && <Text style={{ color: Colors.subtle }}> · {appts.length}</Text>}
          </Text>

          {appts.length === 0 ? (
            <View style={[s.emptyCard, Shadow.sm]}>
              <Ionicons name="calendar-outline" size={36} color={Colors.subtle} style={{ marginBottom: 10 }} />
              <Text style={s.emptyTitle}>Sin citas registradas</Text>
              <Text style={s.emptySub}>Las citas de este cliente aparecerán aquí</Text>
            </View>
          ) : (
            appts.map((a, i) => {
              const meta = STATUS_META[a.status] ?? STATUS_META.pending;
              return (
                <Animated.View key={a.id} entering={i < 10 ? FadeInRight.delay(i * 40).duration(280) : undefined}>
                  <View style={[s.apptRow, Shadow.sm]}>
                    {/* Date block */}
                    <View style={s.dateBlock}>
                      <Text style={s.dateDay}>{new Date(a.date + "T00:00:00").getDate()}</Text>
                      <Text style={s.dateMon}>{new Date(a.date + "T00:00:00").toLocaleDateString("es-CO", { month: "short" })}</Text>
                    </View>

                    {/* Info */}
                    <View style={{ flex: 1 }}>
                      <Text style={s.apptService} numberOfLines={1}>
                        {a.services?.name ?? "Servicio"}
                      </Text>
                      <Text style={s.apptTime}>{a.time?.slice(0, 5) ?? "—"}</Text>
                    </View>

                    {/* Right */}
                    <View style={{ alignItems: "flex-end", gap: 6 }}>
                      {a.services?.price ? (
                        <Text style={s.apptPrice}>${Number(a.services.price).toLocaleString("es-CO")}</Text>
                      ) : null}
                      <View style={[s.statusPill, { backgroundColor: meta.bg }]}>
                        <Text style={[s.statusText, { color: meta.color }]}>{meta.label}</Text>
                      </View>
                    </View>
                  </View>
                </Animated.View>
              );
            })
          )}
        </Animated.View>
      </ScrollView>

      <EditModal
        visible={editOpen}
        client={client}
        onClose={() => setEditOpen(false)}
        onSaved={handleEditSaved}
      />

      <FieldsModal
        visible={fieldsOpen}
        fields={customFields}
        values={fieldValues}
        clientId={client.id}
        onClose={() => setFieldsOpen(false)}
        onSaved={newVals => setFieldValues(newVals)}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  header:       { paddingTop: 16, paddingHorizontal: 20, paddingBottom: 28 },
  headerRow:    { flexDirection: "row", justifyContent: "space-between", marginBottom: 20 },
  iconBtn:      { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,.18)", alignItems: "center", justifyContent: "center" },

  identity:     { alignItems: "center", gap: 8 },
  clientName:   { fontSize: 22, fontFamily: "SpaceGrotesk_700Bold", color: "white", letterSpacing: -0.4, textAlign: "center", marginTop: 4 },
  clientSince:  { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: "rgba(255,255,255,.75)" },

  actions:      { flexDirection: "row", gap: 10, marginTop: 8 },
  actionBtn:    { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,.2)", borderRadius: Radius.full, paddingHorizontal: 16, paddingVertical: 9 },
  actionLabel:  { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: "white" },

  sectionLabel: { fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", color: Colors.subtle, textTransform: "uppercase", letterSpacing: 0.9, marginBottom: 10, marginTop: 20 },
  sectionRow:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 20, marginBottom: 10 },
  editBtn:      { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: Colors.blue + "12", borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 5 },
  editBtnText:  { fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.blue },

  statsCard:    { backgroundColor: Colors.white, borderRadius: Radius.lg, flexDirection: "row", padding: 16 },
  statBox:      { flex: 1, alignItems: "center", gap: 4 },
  statVal:      { fontSize: 20, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text },
  statLabel:    { fontSize: 10, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.subtle, textAlign: "center" },
  statDivider:  { width: 1, backgroundColor: Colors.border, marginVertical: 4 },

  card:         { backgroundColor: Colors.white, borderRadius: Radius.lg, padding: 16 },
  infoRow:      { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 4 },
  infoIcon:     { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  infoText:     { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  infoDivider:  { height: 1, backgroundColor: Colors.border, marginVertical: 8 },
  fieldName:    { fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted },
  fieldVal:     { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text, marginTop: 2 },

  emptyCard:    { backgroundColor: Colors.white, borderRadius: Radius.xl, padding: 40, alignItems: "center" },
  emptyTitle:   { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text, marginBottom: 6 },
  emptySub:     { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, textAlign: "center" },

  apptRow:      { backgroundColor: Colors.white, borderRadius: Radius.md, flexDirection: "row", alignItems: "center", gap: 14, padding: 14, marginBottom: 8 },
  dateBlock:    { width: 40, alignItems: "center", backgroundColor: Colors.cream2, borderRadius: Radius.sm, paddingVertical: 8 },
  dateDay:      { fontSize: 18, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text, lineHeight: 20 },
  dateMon:      { fontSize: 10, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.subtle, textTransform: "uppercase" },
  apptService:  { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  apptTime:     { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, marginTop: 2 },
  apptPrice:    { fontSize: 13, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text },
  statusPill:   { borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  statusText:   { fontSize: 10, fontFamily: "SpaceGrotesk_600SemiBold" },
});

const em = StyleSheet.create({
  header:     { paddingTop: 16, paddingHorizontal: 20, paddingBottom: 20 },
  headerRow:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  iconBtn:    { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,.18)", alignItems: "center", justifyContent: "center" },
  headerTitle:{ fontSize: 18, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
  field:      { marginBottom: 16 },
  fieldLabel: { fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", color: Colors.muted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 },
  input:      { backgroundColor: Colors.white, borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, fontFamily: "SpaceGrotesk_400Regular", color: Colors.text },
  bottomBar:  { padding: 20, paddingBottom: 34, borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.cream2 },
  btn:        { borderRadius: Radius.full, overflow: "hidden" },
  btnGrad:    { paddingVertical: 16, alignItems: "center", backgroundColor: Colors.red },
  btnText:    { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
});

const fm = StyleSheet.create({
  header:     { paddingTop: 16, paddingHorizontal: 20, paddingBottom: 20 },
  headerRow:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  iconBtn:    { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,.18)", alignItems: "center", justifyContent: "center" },
  headerTitle:{ fontSize: 18, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
  field:      { marginBottom: 20 },
  fieldLabel: { fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", color: Colors.muted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 },
  input:      { backgroundColor: Colors.white, borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, fontFamily: "SpaceGrotesk_400Regular", color: Colors.text },
  boolRow:    { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: Colors.white, borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 12 },
  boolLabel:  { fontSize: 15, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  chip:       { borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.full, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: Colors.white },
  chipActive: { backgroundColor: Colors.red, borderColor: Colors.red },
  chipText:   { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  bottomBar:  { padding: 20, paddingBottom: 34, borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.cream2 },
  btn:        { borderRadius: Radius.full, overflow: "hidden" },
  btnGrad:    { paddingVertical: 16, alignItems: "center", backgroundColor: Colors.red },
  btnText:    { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
});
