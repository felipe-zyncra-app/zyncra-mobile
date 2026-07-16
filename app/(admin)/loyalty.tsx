import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Modal, TextInput, KeyboardAvoidingView, Platform, Switch,
  ActivityIndicator, Alert, RefreshControl,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown, FadeInRight } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { Colors, Gradients, Radius, Shadow } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { localDateStr } from "@/lib/format";
import {
  type LoyaltyReward, type LoyaltyRedemption,
  describeReward, getRewardStatus, getClientRewardStatuses,
} from "@/lib/loyalty";

type ClientRow  = { id: string; name: string };
type AptRow     = { client_id: string; appointment_date: string; status: string };
type ServiceRow = { id: string; name: string };

const REWARD_TYPES: { value: LoyaltyReward["reward_type"]; label: string }[] = [
  { value: "free_service",     label: "Servicio gratis" },
  { value: "discount_percent", label: "Descuento %" },
  { value: "discount_fixed",   label: "Descuento $" },
  { value: "other",            label: "Otro" },
];

function RewardModal({ visible, reward, tenantId, services, onClose, onSaved }: {
  visible: boolean; reward: LoyaltyReward | null; tenantId: string;
  services: ServiceRow[]; onClose: () => void; onSaved: () => void;
}) {
  const { t } = useTheme();
  const isEdit = reward !== null;
  const [label, setLabel]       = useState("");
  const [visits, setVisits]     = useState("5");
  const [type, setType]         = useState<LoyaltyReward["reward_type"]>("discount_percent");
  const [value, setValue]       = useState("10");
  const [serviceId, setServiceId] = useState("");
  const [repeats, setRepeats]   = useState(true);
  const [active, setActive]     = useState(true);
  const [saving, setSaving]     = useState(false);

  useEffect(() => {
    if (visible) {
      setLabel(reward?.label ?? "");
      setVisits(reward ? String(reward.visits_required) : "5");
      setType(reward?.reward_type ?? "discount_percent");
      setValue(reward?.reward_value != null ? String(reward.reward_value) : "10");
      setServiceId(reward?.service_id ?? "");
      setRepeats(reward?.repeats ?? true);
      setActive(reward?.active ?? true);
    }
  }, [visible, reward]);

  const needsValue   = type === "discount_percent" || type === "discount_fixed";
  const needsService = type === "free_service";
  const canSave = label.trim().length >= 2 && Number(visits) >= 1
    && (!needsValue || Number(value) > 0)
    && (!needsService || !!serviceId);

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const payload = {
        label: label.trim(),
        visits_required: Number(visits),
        repeats,
        active,
        reward_type: type,
        reward_value: needsValue ? Number(value) : null,
        service_id: needsService ? serviceId : null,
      };
      if (isEdit) {
        await supabase.from("loyalty_rewards").update(payload).eq("id", reward!.id);
      } else {
        await supabase.from("loyalty_rewards").insert({ ...payload, tenant_id: tenantId });
      }
      onSaved(); onClose();
    } finally { setSaving(false); }
  };

  const handleDelete = () => {
    Alert.alert("Eliminar recompensa", `¿Eliminar "${reward?.label}"? El historial de entregas no se borra.`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Eliminar", style: "destructive", onPress: async () => {
        await supabase.from("loyalty_rewards").delete().eq("id", reward!.id);
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
            <Text style={s.mTitle}>{isEdit ? "Editar recompensa" : "Nueva recompensa"}</Text>
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
            <Text style={[s.fLabel, { color: t.muted }]}>Nombre de la recompensa *</Text>
            <TextInput
              style={[s.fInput, { backgroundColor: t.bgAlt, borderColor: t.border, color: t.text }]}
              value={label} onChangeText={setLabel}
              placeholder="Ej: Corte gratis, Cliente frecuente…" placeholderTextColor={t.subtle}
            />

            <Text style={[s.fLabel, { color: t.muted, marginTop: 16 }]}>Visitas requeridas *</Text>
            <TextInput
              style={[s.fInput, { backgroundColor: t.bgAlt, borderColor: t.border, color: t.text }]}
              value={visits} onChangeText={setVisits} keyboardType="numeric"
              placeholder="5" placeholderTextColor={t.subtle}
            />

            <Text style={[s.fLabel, { color: t.muted, marginTop: 16 }]}>Tipo de premio *</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {REWARD_TYPES.map(rt => {
                const on = type === rt.value;
                return (
                  <TouchableOpacity key={rt.value} onPress={() => setType(rt.value)}
                    style={[s.chip, { borderColor: on ? Colors.red : t.border, backgroundColor: on ? Colors.red + "10" : t.bgAlt }]}>
                    <Text style={[s.chipText, { color: on ? Colors.red : t.muted }]}>{rt.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {needsService && (
              <>
                <Text style={[s.fLabel, { color: t.muted, marginTop: 16 }]}>Servicio que se regala *</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {services.map(sv => {
                    const on = serviceId === sv.id;
                    return (
                      <TouchableOpacity key={sv.id} onPress={() => setServiceId(sv.id)}
                        style={[s.chip, { borderColor: on ? Colors.blue : t.border, backgroundColor: on ? Colors.blue + "10" : t.bgAlt }]}>
                        <Text style={[s.chipText, { color: on ? Colors.blue : t.muted }]}>{sv.name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            )}

            {needsValue && (
              <>
                <Text style={[s.fLabel, { color: t.muted, marginTop: 16 }]}>
                  {type === "discount_percent" ? "Porcentaje de descuento *" : "Monto del descuento *"}
                </Text>
                <TextInput
                  style={[s.fInput, { backgroundColor: t.bgAlt, borderColor: t.border, color: t.text }]}
                  value={value} onChangeText={setValue} keyboardType="numeric"
                  placeholder={type === "discount_percent" ? "10" : "20000"} placeholderTextColor={t.subtle}
                />
              </>
            )}

            <View style={[s.switchRow, Shadow.sm, { backgroundColor: t.bgAlt, marginTop: 22 }]}>
              <View style={{ flex: 1 }}>
                <Text style={[s.switchLabel, { color: t.text }]}>Se repite (tarjeta de sellos)</Text>
                <Text style={[s.switchSub, { color: t.muted }]}>Se otorga cada {visits || "N"} visitas; apagado = premio único</Text>
              </View>
              <Switch value={repeats} onValueChange={setRepeats}
                trackColor={{ false: Colors.border, true: Colors.blue + "aa" }}
                thumbColor={repeats ? Colors.blue : Colors.subtle} />
            </View>

            {isEdit && (
              <View style={[s.switchRow, Shadow.sm, { backgroundColor: t.bgAlt, marginTop: 10 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[s.switchLabel, { color: t.text }]}>Recompensa activa</Text>
                  <Text style={[s.switchSub, { color: t.muted }]}>Pausada no suma ni aparece por entregar</Text>
                </View>
                <Switch value={active} onValueChange={setActive}
                  trackColor={{ false: Colors.border, true: Colors.success + "aa" }}
                  thumbColor={active ? Colors.success : Colors.subtle} />
              </View>
            )}
          </ScrollView>
          <View style={[s.bottomBar, { backgroundColor: t.bg, borderTopColor: t.border }]}>
            <TouchableOpacity style={[s.btn, !canSave && { opacity: 0.4 }]} onPress={handleSave} disabled={!canSave || saving} activeOpacity={0.85}>
              <View style={s.btnGrad}>
                {saving ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>{isEdit ? "Guardar cambios" : "Crear recompensa"}</Text>}
              </View>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

export default function LoyaltyScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const { tenantId } = useAuth();
  const [rewards, setRewards] = useState<LoyaltyReward[]>([]);
  const [redemptions, setRedemptions] = useState<LoyaltyRedemption[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [apts, setApts] = useState<AptRow[]>([]);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modal, setModal] = useState<{ visible: boolean; reward: LoyaltyReward | null }>({ visible: false, reward: null });
  const [redeemingKey, setRedeemingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) return;
    const [{ data: rw }, { data: rd }, { data: cl }, { data: ap }, { data: sv }] = await Promise.all([
      supabase.from("loyalty_rewards").select("*").eq("tenant_id", tenantId).order("visits_required"),
      supabase.from("loyalty_redemptions").select("*").eq("tenant_id", tenantId).limit(5000),
      supabase.from("clients").select("id,name").eq("tenant_id", tenantId).order("name").limit(1000),
      supabase.from("appointments").select("client_id,appointment_date,status").eq("tenant_id", tenantId).limit(5000),
      supabase.from("services").select("id,name").eq("tenant_id", tenantId).order("name"),
    ]);
    setRewards((rw ?? []) as LoyaltyReward[]);
    setRedemptions((rd ?? []) as LoyaltyRedemption[]);
    setClients((cl ?? []) as ClientRow[]);
    setApts((ap ?? []) as AptRow[]);
    setServices((sv ?? []) as ServiceRow[]);
    setLoading(false);
  }, [tenantId]);

  useEffect(() => {
    let cancelled = false;
    load().then(() => { if (cancelled) return; });
    return () => { cancelled = true; };
  }, [load]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const serviceName = useCallback((id: string | null) => services.find(sv => sv.id === id)?.name ?? null, [services]);

  const visitsByClient = useMemo(() => {
    const today = localDateStr();
    const map: Record<string, number> = {};
    for (const a of apts) {
      if (!a.client_id || a.status === "cancelled" || a.appointment_date > today) continue;
      map[a.client_id] = (map[a.client_id] ?? 0) + 1;
    }
    return map;
  }, [apts]);

  const activeRewards = useMemo(() => rewards.filter(r => r.active), [rewards]);

  const pending = useMemo(() => {
    if (activeRewards.length === 0) return [];
    const out: { client: ClientRow; reward: LoyaltyReward; visits: number; available: number }[] = [];
    for (const c of clients) {
      const visits = visitsByClient[c.id] ?? 0;
      if (visits === 0) continue;
      const clientRedemptions = redemptions.filter(r => r.client_id === c.id);
      for (const r of activeRewards) {
        const st = getRewardStatus(r, visits, clientRedemptions);
        if (st.available > 0) out.push({ client: c, reward: r, visits, available: st.available });
      }
    }
    return out.sort((a, b) => b.visits - a.visits);
  }, [clients, activeRewards, visitsByClient, redemptions]);

  const closest = useMemo(() => {
    if (activeRewards.length === 0) return [];
    const pendingIds = new Set(pending.map(p => p.client.id));
    const out: { client: ClientRow; nearest: ReturnType<typeof getRewardStatus> }[] = [];
    for (const c of clients) {
      if (pendingIds.has(c.id)) continue;
      const visits = visitsByClient[c.id] ?? 0;
      if (visits === 0) continue;
      const statuses = getClientRewardStatuses(activeRewards, visits, redemptions.filter(r => r.client_id === c.id));
      const nearest = statuses.sort((a, b) => a.remaining - b.remaining)[0];
      if (nearest) out.push({ client: c, nearest });
    }
    return out.sort((a, b) => a.nearest.remaining - b.nearest.remaining).slice(0, 8);
  }, [clients, activeRewards, visitsByClient, redemptions, pending]);

  const handleRedeem = async (clientId: string, reward: LoyaltyReward, visits: number) => {
    if (!tenantId) return;
    const key = `${clientId}:${reward.id}`;
    setRedeemingKey(key);
    const { error } = await supabase.from("loyalty_redemptions").insert({
      tenant_id: tenantId, client_id: clientId, reward_id: reward.id, visits_at_redemption: visits,
    });
    setRedeemingKey(null);
    if (error) { Alert.alert("No se pudo registrar la entrega", "Revisa tu conexión e inténtalo de nuevo."); return; }
    load();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <LinearGradient colors={Gradients.ink} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.header}>
        <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3 }} />
        <View style={s.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="arrow-back" size={20} color="white" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.headerTitle}>Fidelización</Text>
            <Text style={s.headerSub}>{rewards.length} recompensa{rewards.length !== 1 ? "s" : ""} · {pending.length} por entregar</Text>
          </View>
          <TouchableOpacity style={s.addBtn} onPress={() => setModal({ visible: true, reward: null })} activeOpacity={0.8}>
            <Ionicons name="add" size={22} color="white" />
          </TouchableOpacity>
        </View>
      </LinearGradient>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 110 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.red} />}
      >
        {loading ? (
          <ActivityIndicator color={Colors.red} style={{ marginTop: 40 }} />
        ) : rewards.length === 0 ? (
          <Animated.View entering={FadeInDown.duration(400)} style={[s.empty, Shadow.sm, { backgroundColor: t.bgAlt }]}>
            <Ionicons name="gift-outline" size={44} color={t.subtle} style={{ marginBottom: 12 }} />
            <Text style={[s.emptyTitle, { color: t.text }]}>Premia a tus clientes frecuentes</Text>
            <Text style={[s.emptySub, { color: t.muted }]}>
              Ej: “cada 5 cortes, el 6.º gratis”. Toca + para crear tu primera recompensa.
            </Text>
          </Animated.View>
        ) : (
          <>
            {/* Recompensas */}
            {rewards.map((r, i) => (
              <Animated.View key={r.id} entering={i < 8 ? FadeInRight.delay(i * 50).duration(320) : undefined}>
                <TouchableOpacity
                  style={[s.row, Shadow.sm, { backgroundColor: t.bgAlt, opacity: r.active ? 1 : 0.55 }]}
                  onPress={() => setModal({ visible: true, reward: r })}
                  activeOpacity={0.75}
                >
                  <View style={[s.iconBox, { backgroundColor: "#a855f7" + "14" }]}>
                    <Ionicons name="gift-outline" size={18} color="#a855f7" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.name, { color: t.text }]} numberOfLines={1}>{r.label}</Text>
                    <Text style={[s.info, { color: "#a855f7" }]}>{describeReward(r, serviceName(r.service_id))}</Text>
                    <Text style={[s.info, { color: t.muted }]}>
                      {r.visits_required} visitas{r.repeats ? " · se repite" : " · premio único"}{!r.active ? " · pausada" : ""}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={14} color={t.subtle} />
                </TouchableOpacity>
              </Animated.View>
            ))}

            {/* Por entregar */}
            {activeRewards.length > 0 && (
              <>
                <Text style={[s.sectionTitle, { color: t.subtle }]}>🎁 Por entregar ({pending.length})</Text>
                {pending.length === 0 ? (
                  <Text style={[s.sectionEmpty, { color: t.muted }]}>Nadie tiene una recompensa lista todavía.</Text>
                ) : pending.map(p => {
                  const key = `${p.client.id}:${p.reward.id}`;
                  return (
                    <View key={key} style={[s.row, Shadow.sm, { backgroundColor: t.bgAlt, borderWidth: 1, borderColor: "#a855f7" + "40" }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.name, { color: t.text }]} numberOfLines={1}>{p.client.name}</Text>
                        <Text style={[s.info, { color: "#a855f7" }]}>
                          {describeReward(p.reward, serviceName(p.reward.service_id))} · {p.visits} visitas{p.available > 1 ? ` · ×${p.available}` : ""}
                        </Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => handleRedeem(p.client.id, p.reward, p.visits)}
                        disabled={redeemingKey === key}
                        style={[s.redeemBtn, redeemingKey === key && { opacity: 0.6 }]}
                        activeOpacity={0.8}
                      >
                        {redeemingKey === key
                          ? <ActivityIndicator size="small" color="white" />
                          : <Text style={s.redeemText}>Entregar</Text>}
                      </TouchableOpacity>
                    </View>
                  );
                })}

                {/* Más cerca */}
                <Text style={[s.sectionTitle, { color: t.subtle }]}>Más cerca de su recompensa</Text>
                {closest.length === 0 ? (
                  <Text style={[s.sectionEmpty, { color: t.muted }]}>Aún no hay suficientes visitas registradas.</Text>
                ) : closest.map(c => (
                  <View key={c.client.id} style={[s.row, Shadow.sm, { backgroundColor: t.bgAlt, flexDirection: "column", alignItems: "stretch", gap: 8 }]}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <Text style={[s.name, { color: t.text, flexShrink: 1 }]} numberOfLines={1}>{c.client.name}</Text>
                      <Text style={[s.info, { color: t.muted }]}>
                        Falta{c.nearest.remaining !== 1 ? "n" : ""} <Text style={{ color: Colors.blue, fontFamily: "SpaceGrotesk_700Bold" }}>{c.nearest.remaining}</Text> visita{c.nearest.remaining !== 1 ? "s" : ""}
                      </Text>
                    </View>
                    <View style={[s.progressTrack, { backgroundColor: t.border }]}>
                      <View style={[s.progressFill, { width: `${Math.min(100, (c.nearest.progressCurrent / c.nearest.progressTarget) * 100)}%` }]} />
                    </View>
                  </View>
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>

      {tenantId && (
        <RewardModal
          visible={modal.visible}
          reward={modal.reward}
          tenantId={tenantId}
          services={services}
          onClose={() => setModal({ visible: false, reward: null })}
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
  sectionTitle: { fontSize: 12, fontFamily: "SpaceGrotesk_700Bold", textTransform: "uppercase", letterSpacing: 0.8, marginTop: 22, marginBottom: 10 },
  sectionEmpty: { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", marginBottom: 4 },
  row:        { borderRadius: Radius.md, padding: 14, flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  iconBox:    { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  name:       { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold" },
  info:       { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", marginTop: 2 },
  redeemBtn:  { backgroundColor: "#a855f7", borderRadius: Radius.full, paddingVertical: 9, paddingHorizontal: 14 },
  redeemText: { fontSize: 12, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
  progressTrack: { height: 6, borderRadius: 4, overflow: "hidden" },
  progressFill:  { height: "100%", backgroundColor: Colors.blue, borderRadius: 4 },
  empty:      { borderRadius: Radius.xl, padding: 48, alignItems: "center", marginTop: 20 },
  emptyTitle: { fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", marginBottom: 6 },
  emptySub:   { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", textAlign: "center" },
  mHeader:    { paddingTop: 16, paddingHorizontal: 20, paddingBottom: 20 },
  mHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  closeBtn:   { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,.18)", alignItems: "center", justifyContent: "center" },
  mTitle:     { fontSize: 18, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
  bottomBar:  { padding: 20, paddingBottom: 34, borderTopWidth: 1 },
  btn:        { borderRadius: Radius.full, overflow: "hidden" },
  btnGrad:    { paddingVertical: 16, alignItems: "center", backgroundColor: Colors.red },
  btnText:    { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
  fLabel:     { fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 },
  fInput:     { borderWidth: 1.5, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, fontFamily: "SpaceGrotesk_400Regular" },
  chip:       { borderWidth: 1.5, borderRadius: Radius.full, paddingVertical: 8, paddingHorizontal: 14 },
  chipText:   { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold" },
  switchRow:  { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: Radius.md, padding: 14 },
  switchLabel:{ fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold" },
  switchSub:  { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", marginTop: 2 },
});
