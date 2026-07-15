import { useEffect, useState, useCallback } from "react";
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
import { Colors, Gradients, Radius, Shadow, Glass } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { fmtDateShort } from "@/lib/format";
import { STATUS_META } from "@/constants/status";
import Avatar from "@/components/Avatar";
import { MonoTag } from "@/components/ui";

type Client = { id: string; name: string; phone?: string; email?: string | null; no_shows?: number; created_at?: string };
type Appt = {
  id: string; appointment_date: string; appointment_time: string; status: string; notes?: string;
  services: { name: string; price: number } | null;
};
type CustomField = { id: string; name: string; field_type: string };
type FieldValue  = { field_id: string; value: string | null };

// ─── Edit form modal (pageSheet) ──────────────────────────────────────────────

function EditModal({ visible, client, tenantId, onClose, onSaved }: {
  visible: boolean; client: Client | null; tenantId: string;
  onClose: () => void; onSaved: (c?: Client) => void;
}) {
  const { t } = useTheme();
  const isNew = client === null;
  const [name, setName]   = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setName(client?.name ?? ""); setPhone(client?.phone ?? ""); setEmail(client?.email ?? "");
    }
  }, [visible, client]);

  const canSave = name.trim().length >= 2 && phone.trim().length >= 6;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    const payload = { name: name.trim(), phone: phone.trim(), email: email.trim() || null };
    if (isNew) {
      const { data } = await supabase.from("clients").insert({ ...payload, tenant_id: tenantId }).select().single();
      setSaving(false);
      onSaved(data ?? undefined);
    } else {
      await supabase.from("clients").update(payload).eq("id", client!.id);
      setSaving(false);
      onSaved({ ...client!, ...payload });
    }
    onClose();
  };

  const handleDelete = () => {
    Alert.alert("Eliminar cliente", `¿Eliminar a ${client?.name}?`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Eliminar", style: "destructive", onPress: async () => {
        await supabase.from("clients").delete().eq("id", client!.id);
        onSaved();
        onClose();
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
            <Text style={em.headerTitle}>{isNew ? "Nuevo cliente" : "Editar cliente"}</Text>
            {!isNew ? (
              <TouchableOpacity onPress={handleDelete} style={em.iconBtn}>
                <Ionicons name="trash-outline" size={18} color="white" />
              </TouchableOpacity>
            ) : <View style={{ width: 40 }} />}
          </View>
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 120 }}>
            {[
              { label: "Nombre completo *", val: name, set: setName, ph: "Ej: Juan García", cap: "words" as const },
              { label: "Teléfono *", val: phone, set: setPhone, ph: "3001234567", kb: "phone-pad" as const },
              { label: "Correo electrónico", val: email, set: setEmail, ph: "juan@email.com", kb: "email-address" as const },
            ].map(f => (
              <View key={f.label} style={em.field}>
                <Text style={em.fieldLabel}>{f.label}</Text>
                <TextInput style={em.input} value={f.val} onChangeText={f.set} placeholder={f.ph}
                  placeholderTextColor={Colors.subtle} keyboardType={f.kb ?? "default"}
                  autoCapitalize={f.cap ?? "none"} />
              </View>
            ))}
          </ScrollView>
          <View style={em.bottomBar}>
            <TouchableOpacity style={[em.btn, !canSave && { opacity: 0.4 }]}
              onPress={handleSave} disabled={!canSave || saving} activeOpacity={0.85}>
              <View style={em.btnGrad}>
                {saving ? <ActivityIndicator color="white" /> : <Text style={em.btnText}>{isNew ? "Crear cliente" : "Guardar cambios"}</Text>}
              </View>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Client profile modal (full-screen) ───────────────────────────────────────

function ClientProfileModal({ client: initialClient, tenantId, onClose, onRefresh }: {
  client: Client; tenantId: string; onClose: () => void; onRefresh: () => void;
}) {
  const { t } = useTheme();
  const insets = useSafeAreaInsets();
  const [client, setClient]   = useState<Client>(initialClient);
  const [appts, setAppts]     = useState<Appt[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [fieldValues, setFieldValues]   = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const [apptRes, cfRes, fvRes] = await Promise.all([
      supabase.from("appointments")
        .select("id,appointment_date,appointment_time,status,notes,services(name,price)")
        .eq("client_id", initialClient.id)
        .order("appointment_date", { ascending: false })
        .limit(50),
      supabase.from("custom_fields")
        .select("id,name,field_type")
        .eq("tenant_id", tenantId)
        .eq("applies_to", "client")
        .eq("active", true)
        .order("position"),
      supabase.from("client_field_values")
        .select("field_id,value")
        .eq("client_id", initialClient.id),
    ]);
    setAppts((apptRes.data ?? []) as unknown as Appt[]);
    setCustomFields((cfRes.data ?? []) as CustomField[]);
    const map: Record<string, string> = {};
    (fvRes.data ?? []).forEach((r: any) => { map[r.field_id] = r.value ?? ""; });
    setFieldValues(map);
    setLoading(false);
  }, [initialClient.id, tenantId]);

  useEffect(() => { load(); }, [load]);

  const completed  = appts.filter(a => a.status === "completed");
  const noShows    = appts.filter(a => a.status === "no_show").length;
  const totalSpent = completed.reduce((s, a) => s + Number(a.services?.price ?? 0), 0);
  const since      = client.created_at ? fmtDateShort(client.created_at.slice(0, 10)) : "—";
  const fmtMoney   = (n: number) => n >= 1000 ? `$${(n / 1000).toFixed(0)}k` : `$${n}`;

  const handleEditSaved = (updated?: Client) => {
    if (!updated) { onClose(); onRefresh(); return; }
    setClient(updated);
    onRefresh();
  };

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: Colors.cream2 }}>
        {/* Header */}
        <View style={[p.header, { paddingTop: insets.top + 12, backgroundColor: "#0C0C14" }]}>
          <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3 }} />
          <View style={p.headerRow}>
            <TouchableOpacity onPress={onClose} style={p.iconBtn}>
              <Ionicons name="arrow-back" size={20} color="white" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setEditOpen(true)} style={p.iconBtn}>
              <Ionicons name="create-outline" size={20} color="white" />
            </TouchableOpacity>
          </View>
          <View style={p.identity}>
            <Avatar name={client.name} size={72} />
            <Text style={p.clientName}>{client.name}</Text>
            <Text style={p.clientSince}>Cliente desde {since}</Text>
            <View style={p.actions}>
              {client.phone && (
                <>
                  <TouchableOpacity style={p.actionBtn}
                    onPress={() => Linking.openURL(`tel:${client.phone}`)} activeOpacity={0.8}>
                    <Ionicons name="call-outline" size={16} color="white" />
                    <Text style={p.actionLabel}>Llamar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={p.actionBtn}
                    onPress={() => Linking.openURL(`https://wa.me/${client.phone?.replace(/\D/g, "")}`)} activeOpacity={0.8}>
                    <Ionicons name="logo-whatsapp" size={16} color="white" />
                    <Text style={p.actionLabel}>WhatsApp</Text>
                  </TouchableOpacity>
                </>
              )}
              {client.email && (
                <TouchableOpacity style={p.actionBtn}
                  onPress={() => Linking.openURL(`mailto:${client.email}`)} activeOpacity={0.8}>
                  <Ionicons name="mail-outline" size={16} color="white" />
                  <Text style={p.actionLabel}>Correo</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>

        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }}>
          {/* Stats */}
          <Animated.View entering={FadeInDown.delay(0).duration(300)}>
            <View style={[p.statsCard, Shadow.sm]}>
              {[
                { val: String(appts.length), label: "Citas", color: Colors.text },
                { val: String(completed.length), label: "Completadas", color: Colors.success },
                { val: String(noShows), label: "No asistió", color: noShows > 0 ? Colors.red : Colors.text },
                { val: fmtMoney(totalSpent), label: "Gastado", color: Colors.purple },
              ].map((st, i, arr) => (
                <View key={st.label} style={{ flexDirection: "row", flex: 1 }}>
                  <View style={p.statBox}>
                    <Text style={[p.statVal, { color: st.color }]}>{st.val}</Text>
                    <Text style={p.statLabel}>{st.label}</Text>
                  </View>
                  {i < arr.length - 1 && <View style={p.statDiv} />}
                </View>
              ))}
            </View>
          </Animated.View>

          {/* Contact */}
          {(client.phone || client.email) && (
            <Animated.View entering={FadeInDown.delay(60).duration(300)}>
              <Text style={p.sectionLabel}>Contacto</Text>
              <View style={[p.card, Shadow.sm]}>
                {client.phone && (
                  <View style={p.infoRow}>
                    <View style={[p.infoIcon, { backgroundColor: Colors.success + "15" }]}>
                      <Ionicons name="call-outline" size={15} color={Colors.success} />
                    </View>
                    <Text style={p.infoText}>{client.phone}</Text>
                  </View>
                )}
                {client.phone && client.email && <View style={p.infoDivider} />}
                {client.email && (
                  <View style={p.infoRow}>
                    <View style={[p.infoIcon, { backgroundColor: Colors.blue + "15" }]}>
                      <Ionicons name="mail-outline" size={15} color={Colors.blue} />
                    </View>
                    <Text style={p.infoText}>{client.email}</Text>
                  </View>
                )}
              </View>
            </Animated.View>
          )}

          {/* Custom fields */}
          {customFields.length > 0 && (
            <Animated.View entering={FadeInDown.delay(90).duration(300)}>
              <Text style={p.sectionLabel}>Datos adicionales</Text>
              <View style={[p.card, Shadow.sm]}>
                {customFields.map((f, i) => (
                  <View key={f.id}>
                    {i > 0 && <View style={p.infoDivider} />}
                    <View style={p.infoRow}>
                      <Text style={p.infoLabel}>{f.name}</Text>
                      <Text style={p.infoValue}>{fieldValues[f.id] || "—"}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </Animated.View>
          )}

          {/* History */}
          <Animated.View entering={FadeInDown.delay(120).duration(300)}>
            <Text style={[p.sectionLabel, { marginTop: 24 }]}>
              Historial{appts.length > 0 ? ` · ${appts.length} citas` : ""}
            </Text>

            {loading ? (
              <ActivityIndicator color={Colors.red} style={{ marginTop: 20 }} />
            ) : appts.length === 0 ? (
              <View style={[p.emptyCard, Shadow.sm]}>
                <Ionicons name="calendar-outline" size={36} color={Colors.subtle} style={{ marginBottom: 10 }} />
                <Text style={p.emptyTitle}>Sin citas registradas</Text>
                <Text style={p.emptySub}>Las citas aparecerán aquí</Text>
              </View>
            ) : (
              appts.map((a, i) => {
                const meta = STATUS_META[a.status] ?? STATUS_META.pending;
                const dt   = new Date(a.appointment_date + "T00:00:00");
                return (
                  <Animated.View key={a.id} entering={i < 10 ? FadeInRight.delay(i * 35).duration(260) : undefined}>
                    <View style={[p.apptRow, Shadow.sm]}>
                      <View style={p.dateBlock}>
                        <Text style={p.dateDay}>{dt.getDate()}</Text>
                        <Text style={p.dateMon}>{dt.toLocaleDateString("es-CO", { month: "short" })}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={p.apptService} numberOfLines={1}>{a.services?.name ?? "Servicio"}</Text>
                        <Text style={p.apptTime}>{a.appointment_time?.slice(0, 5) ?? "—"}</Text>
                      </View>
                      <View style={{ alignItems: "flex-end", gap: 5 }}>
                        {a.services?.price ? (
                          <Text style={p.apptPrice}>${Number(a.services.price).toLocaleString("es-CO")}</Text>
                        ) : null}
                        <View style={[p.statusPill, { backgroundColor: meta.bg }]}>
                          <Text style={[p.statusText, { color: meta.color }]}>{meta.label}</Text>
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
          tenantId={tenantId}
          onClose={() => setEditOpen(false)}
          onSaved={handleEditSaved}
        />
      </View>
    </Modal>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function ClientsScreen() {
  const { t } = useTheme();
  const [clients, setClients]       = useState<Client[]>([]);
  const [filtered, setFiltered]     = useState<Client[]>([]);
  const [search, setSearch]         = useState("");
  const { tenantId } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [profileClient, setProfileClient] = useState<Client | null>(null);
  const [newModal, setNewModal]     = useState(false);

  const loadClients = async () => {
    if (!tenantId) return;
    const { data } = await supabase.from("clients")
      .select("id, name, phone, email, no_shows, created_at")
      .eq("tenant_id", tenantId).order("name");
    const c = data ?? [];
    setClients(c);
    setFiltered(c);
  };

  useEffect(() => {
    let cancelled = false;
    loadClients().then(() => { if (cancelled) return; });
    return () => { cancelled = true; };
  }, [tenantId]);

  useEffect(() => {
    const q = search.toLowerCase();
    setFiltered(clients.filter(c =>
      c.name.toLowerCase().includes(q) || (c.phone ?? "").includes(q)
    ));
  }, [search, clients]);

  const onRefresh = async () => { setRefreshing(true); await loadClients(); setRefreshing(false); };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={s.header}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <MonoTag>Clientes</MonoTag>
          <Text style={[s.headerTitle, { color: t.ink }]}>Tu base de clientes</Text>
          <Text style={[s.headerSub, { color: t.muted }]}>
            {clients.length} cliente{clients.length !== 1 ? "s" : ""} registrado{clients.length !== 1 ? "s" : ""}
          </Text>
        </View>
        <TouchableOpacity onPress={() => setNewModal(true)} activeOpacity={0.85} style={s.addBtnWrap}>
          <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.addBtn}>
            <Ionicons name="person-add-outline" size={17} color="white" />
          </LinearGradient>
        </TouchableOpacity>
      </View>

      <View style={[s.searchWrap, { backgroundColor: t.card, borderBottomColor: t.line }]}>
        <Ionicons name="search-outline" size={16} color={Colors.subtle} style={{ marginRight: 8 }} />
        <TextInput
          style={s.search} placeholder="Buscar por nombre o teléfono"
          placeholderTextColor={Colors.subtle} value={search} onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch("")}>
            <Ionicons name="close-circle" size={18} color={Colors.subtle} />
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 110 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.red} />}
        ListEmptyComponent={
          <Animated.View entering={FadeInDown.duration(400)} style={s.empty}>
            <Ionicons name="people-outline" size={44} color={Colors.subtle} style={{ marginBottom: 12 }} />
            <Text style={s.emptyTitle}>{search ? "Sin resultados" : "Sin clientes aún"}</Text>
            <Text style={s.emptySub}>
              {search ? "Prueba otro nombre o teléfono" : "Toca + para agregar tu primer cliente"}
            </Text>
          </Animated.View>
        }
        renderItem={({ item: c, index: i }) => (
          <Animated.View entering={i < 10 ? FadeInRight.delay(i * 50).duration(320) : undefined}>
            <TouchableOpacity
              style={[s.row, Shadow.sm]}
              onPress={() => setProfileClient(c)}
              activeOpacity={0.75}
            >
              <Avatar name={c.name} />
              <View style={{ flex: 1 }}>
                <Text style={s.name} numberOfLines={1}>{c.name}</Text>
                <Text style={s.info} numberOfLines={1}>{c.phone ?? c.email ?? "Sin contacto"}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                {(c.no_shows ?? 0) > 0 ? (
                  <Text style={s.noShows}>{c.no_shows} falta{(c.no_shows ?? 0) > 1 ? "s" : ""}</Text>
                ) : null}
                <Ionicons name="chevron-forward" size={16} color={Colors.subtle} style={{ marginTop: 4 }} />
              </View>
            </TouchableOpacity>
          </Animated.View>
        )}
      />

      {/* Profile modal */}
      {profileClient && tenantId && (
        <ClientProfileModal
          client={profileClient}
          tenantId={tenantId}
          onClose={() => setProfileClient(null)}
          onRefresh={loadClients}
        />
      )}

      {/* New client modal */}
      {tenantId && (
        <EditModal
          visible={newModal}
          client={null}
          tenantId={tenantId}
          onClose={() => setNewModal(false)}
          onSaved={() => loadClients()}
        />
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  header:      { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, paddingTop: 14, paddingHorizontal: 20, paddingBottom: 14 },
  headerTitle: { fontSize: 21, fontFamily: "SpaceGrotesk_700Bold", letterSpacing: -0.5, marginTop: 3 },
  headerSub:   { fontSize: 12.5, fontFamily: "SpaceGrotesk_400Regular", marginTop: 3 },
  addBtnWrap:  { borderRadius: 19, overflow: "hidden" },
  addBtn:      { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  searchWrap:  { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  search:      { flex: 1, fontSize: 14, fontFamily: "SpaceGrotesk_400Regular", color: Colors.text },
  row:         { ...Glass.cardStrong, borderRadius: Radius.md, padding: 14, flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  name:        { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  info:        { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, marginTop: 2 },
  noShows:     { fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.red },
  empty:       { ...Glass.cardStrong, borderRadius: Radius.xl, padding: 48, alignItems: "center", marginTop: 20, ...Shadow.sm },
  emptyTitle:  { fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text, marginBottom: 6 },
  emptySub:    { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, textAlign: "center" },
});

// Profile styles
const p = StyleSheet.create({
  header:      { paddingTop: 16, paddingHorizontal: 20, paddingBottom: 28 },
  headerRow:   { flexDirection: "row", justifyContent: "space-between", marginBottom: 20 },
  iconBtn:     { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,.2)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.3)" },
  identity:    { alignItems: "center", gap: 6 },
  clientName:  { fontSize: 22, fontFamily: "SpaceGrotesk_700Bold", color: "white", letterSpacing: -0.4, marginTop: 6, textAlign: "center" },
  clientSince: { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: "rgba(255,255,255,.75)" },
  actions:     { flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap", justifyContent: "center" },
  actionBtn:   { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,.2)", borderRadius: Radius.full, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: "rgba(255,255,255,0.3)" },
  actionLabel: { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: "white" },

  sectionLabel:{ fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", color: Colors.subtle, textTransform: "uppercase", letterSpacing: 0.9, marginBottom: 10, marginTop: 20 },
  card:        { ...Glass.cardStrong, borderRadius: Radius.lg, padding: 16 },

  statsCard:   { ...Glass.cardStrong, borderRadius: Radius.lg, flexDirection: "row", padding: 16 },
  statBox:     { flex: 1, alignItems: "center", gap: 4 },
  statVal:     { fontSize: 20, fontFamily: "SpaceGrotesk_700Bold" },
  statLabel:   { fontSize: 10, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.subtle, textAlign: "center" },
  statDiv:     { width: 1, backgroundColor: Colors.border, marginVertical: 4 },

  infoRow:     { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 4 },
  infoIcon:    { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  infoText:    { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  infoDivider: { height: 1, backgroundColor: Colors.border, marginVertical: 8 },
  infoLabel:   { flex: 1, fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  infoValue:   { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted },

  emptyCard:   { ...Glass.cardStrong, borderRadius: Radius.xl, padding: 40, alignItems: "center" },
  emptyTitle:  { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text, marginBottom: 6 },
  emptySub:    { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, textAlign: "center" },

  apptRow:     { ...Glass.cardStrong, borderRadius: Radius.md, flexDirection: "row", alignItems: "center", gap: 14, padding: 14, marginBottom: 8 },
  dateBlock:   { width: 40, alignItems: "center", backgroundColor: Colors.cream2, borderRadius: Radius.sm, paddingVertical: 8 },
  dateDay:     { fontSize: 18, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text, lineHeight: 20 },
  dateMon:     { fontSize: 10, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.subtle, textTransform: "uppercase" },
  apptService: { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  apptTime:    { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, marginTop: 2 },
  apptPrice:   { fontSize: 13, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text },
  statusPill:  { borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  statusText:  { fontSize: 10, fontFamily: "SpaceGrotesk_600SemiBold" },
});

// Edit modal styles
const em = StyleSheet.create({
  header:     { paddingTop: 16, paddingHorizontal: 20, paddingBottom: 20 },
  headerRow:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  iconBtn:    { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,.2)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.3)" },
  headerTitle:{ fontSize: 18, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
  field:      { marginBottom: 16 },
  fieldLabel: { fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", color: Colors.muted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 },
  input:      { ...Glass.cardStrong, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, fontFamily: "SpaceGrotesk_400Regular", color: Colors.text },
  bottomBar:  { padding: 20, paddingBottom: 34, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.6)", backgroundColor: "rgba(244,244,249,0.85)" },
  btn:        { borderRadius: Radius.full, overflow: "hidden" },
  btnGrad: { paddingVertical: 16, alignItems: "center", backgroundColor: Colors.red },
  btnText:    { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
});
