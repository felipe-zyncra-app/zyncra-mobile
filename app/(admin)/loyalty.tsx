import { useEffect, useMemo, useRef, useState } from "react";
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
import { useTenant } from "@/lib/tenant";
import ErrorState from "@/components/ErrorState";
import {
  type LoyaltyReward,
  describeReward, entregarRecompensa, getRewardStatus, getClientRewardStatuses,
} from "@/lib/loyalty";
import { exigirFilas, mensajeError, revisar, traerPorIds, traerTodo, traerTodoDetalle } from "@/lib/db";
import { useGuardRespuestas, useRecarga } from "@/lib/useRecarga";

type ServiceRow = { id: string; name: string };
type Entrega = { id: string; client_id: string; reward_id: string };
type Respuesta<T> = PromiseLike<{ data: T[] | null; error: unknown }>;

const REWARD_TYPES: { value: LoyaltyReward["reward_type"]; label: string }[] = [
  { value: "free_service",     label: "Servicio gratis" },
  { value: "discount_percent", label: "Descuento %" },
  { value: "discount_fixed",   label: "Descuento $" },
  { value: "other",            label: "Otro" },
];

const POR_ENTREGAR_VISIBLES = 30;
// Área táctil extra para los botones de solo ícono (CAL-24).
const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

function confirmar(titulo: string, mensaje: string, boton: string, destructivo = false): Promise<boolean> {
  return new Promise(resolve => {
    Alert.alert(titulo, mensaje, [
      { text: "Cancelar", style: "cancel", onPress: () => resolve(false) },
      { text: boton, style: destructivo ? "destructive" : "default", onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}

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
  const [deleting, setDeleting] = useState(false);

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
  const visitasNum = /^\d+$/.test(visits.trim()) ? Number(visits.trim()) : NaN;
  const valorNum = Number(value.replace(",", "."));
  // visits_required es entero en la base: 2.5 pasaba la validación y el
  // insert fallaba en silencio. Un descuento de 150% también se aceptaba.
  const problema =
    label.trim().length < 2 ? "Escribe un nombre de al menos 2 letras."
    : !Number.isInteger(visitasNum) || visitasNum < 1 || visitasNum > 1000 ? "Las visitas requeridas deben ser un número entero entre 1 y 1000."
    : needsValue && (!Number.isFinite(valorNum) || valorNum <= 0) ? "El descuento debe ser mayor que 0."
    : type === "discount_percent" && valorNum > 100 ? "El porcentaje no puede pasar de 100%."
    : needsService && !serviceId ? "Elige el servicio que se regala."
    : null;
  const canSave = !problema;

  const handleSave = async () => {
    if (saving) return;
    if (problema) { Alert.alert("Revisa los datos", problema); return; }
    setSaving(true);
    try {
      const payload = {
        label: label.trim(),
        visits_required: visitasNum,
        repeats,
        active,
        reward_type: type,
        reward_value: needsValue ? valorNum : null,
        service_id: needsService ? serviceId : null,
      };
      if (isEdit) {
        exigirFilas(await supabase.from("loyalty_rewards").update(payload).eq("id", reward!.id).select("id"), "No se pudo guardar la recompensa");
      } else {
        revisar(await supabase.from("loyalty_rewards").insert({ ...payload, tenant_id: tenantId }).select("id").single(), "No se pudo crear la recompensa");
      }
      onSaved(); onClose();
    } catch (e) {
      Alert.alert("No se guardó", mensajeError(e));
    } finally { setSaving(false); }
  };

  // Una recompensa con entregas NO se borra: la FK en cascada se llevaba todo
  // su historial y, si se volvía a crear, el premio salía otra vez "por
  // entregar" a quienes ya lo habían recibido. Se desactiva.
  const handleDelete = async () => {
    if (!reward || deleting) return;
    setDeleting(true);
    try {
      const res = await supabase.from("loyalty_redemptions").select("id", { count: "exact", head: true }).eq("reward_id", reward.id);
      if (res.error) throw res.error;
      const entregas = res.count ?? 0;
      if (entregas > 0) {
        const ok = await confirmar(
          "Desactivar recompensa",
          `"${reward.label}" tiene ${entregas} entrega${entregas === 1 ? "" : "s"} registrada${entregas === 1 ? "" : "s"}. Para no perder ese historial se desactiva en vez de eliminarse: deja de aparecer por entregar y la puedes reactivar cuando quieras.`,
          "Desactivar",
        );
        if (!ok) return;
        exigirFilas(await supabase.from("loyalty_rewards").update({ active: false }).eq("id", reward.id).select("id"), "No se pudo desactivar la recompensa");
      } else {
        const ok = await confirmar("Eliminar recompensa", `¿Eliminar "${reward.label}"? Todavía no tiene entregas registradas.`, "Eliminar", true);
        if (!ok) return;
        exigirFilas(await supabase.from("loyalty_rewards").delete().eq("id", reward.id).select("id"), "No se pudo eliminar la recompensa");
      }
      onSaved(); onClose();
    } catch (e) {
      Alert.alert("No se pudo completar", mensajeError(e));
    } finally {
      setDeleting(false);
    }
  };

  const input = [s.fInput, { backgroundColor: t.inputBg, borderColor: t.inputBorder, color: t.text }];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.mHeader}>
          <View style={s.mHeaderRow}>
            <TouchableOpacity onPress={onClose} style={s.closeBtn} hitSlop={HIT_SLOP} accessibilityRole="button" accessibilityLabel="Cerrar">
              <Ionicons name="close" size={20} color="white" />
            </TouchableOpacity>
            <Text style={s.mTitle}>{isEdit ? "Editar recompensa" : "Nueva recompensa"}</Text>
            {isEdit
              ? <TouchableOpacity onPress={handleDelete} disabled={deleting} style={s.closeBtn} hitSlop={HIT_SLOP} accessibilityRole="button" accessibilityLabel="Eliminar recompensa" accessibilityState={{ disabled: deleting, busy: deleting }}>
                  {deleting ? <ActivityIndicator size="small" color="white" /> : <Ionicons name="trash-outline" size={18} color="white" />}
                </TouchableOpacity>
              : <View style={{ width: 40 }} />
            }
          </View>
        </LinearGradient>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
            <Text style={[s.fLabel, { color: t.muted }]}>Nombre de la recompensa *</Text>
            <TextInput
              style={input}
              value={label} onChangeText={setLabel}
              placeholder="Ej: Corte gratis, Cliente frecuente…" placeholderTextColor={t.subtle}
            />

            <Text style={[s.fLabel, { color: t.muted, marginTop: 16 }]}>Visitas requeridas *</Text>
            <TextInput
              style={input}
              value={visits} onChangeText={setVisits} keyboardType="number-pad"
              placeholder="5" placeholderTextColor={t.subtle}
            />
            <Text style={[s.hint, { color: t.subtle }]}>Cuenta como visita cada cita completada.</Text>

            <Text style={[s.fLabel, { color: t.muted, marginTop: 16 }]}>Tipo de premio *</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {REWARD_TYPES.map(rt => {
                const on = type === rt.value;
                return (
                  <TouchableOpacity key={rt.value} onPress={() => setType(rt.value)}
                    style={[s.chip, { borderColor: on ? Colors.red : t.border, backgroundColor: on ? Colors.red + "10" : t.bgAlt }]}
                    accessibilityRole="button" accessibilityState={{ selected: on }}>
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
                        style={[s.chip, { borderColor: on ? Colors.blue : t.border, backgroundColor: on ? Colors.blue + "10" : t.bgAlt }]}
                        accessibilityRole="button" accessibilityState={{ selected: on }}>
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
                  {type === "discount_percent" ? "Porcentaje de descuento (1 a 100) *" : "Monto del descuento *"}
                </Text>
                <TextInput
                  style={input}
                  value={value} onChangeText={setValue} keyboardType="decimal-pad"
                  placeholder={type === "discount_percent" ? "10" : "20000"} placeholderTextColor={t.subtle}
                />
              </>
            )}

            <View style={[s.switchRow, Shadow.sm, { backgroundColor: t.bgAlt, marginTop: 22 }]}>
              <View style={{ flex: 1 }}>
                <Text style={[s.switchLabel, { color: t.text }]}>Se repite (tarjeta de sellos)</Text>
                <Text style={[s.switchSub, { color: t.muted }]}>Se otorga cada {Number.isInteger(visitasNum) ? visitasNum : "N"} visitas; apagado = premio único</Text>
              </View>
              <Switch value={repeats} onValueChange={setRepeats}
                trackColor={{ false: t.trackBg, true: Colors.blue + "aa" }}
                thumbColor={repeats ? Colors.blue : t.subtle} />
            </View>

            {isEdit && (
              <View style={[s.switchRow, Shadow.sm, { backgroundColor: t.bgAlt, marginTop: 10 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[s.switchLabel, { color: t.text }]}>Recompensa activa</Text>
                  <Text style={[s.switchSub, { color: t.muted }]}>Pausada no aparece por entregar</Text>
                </View>
                <Switch value={active} onValueChange={setActive}
                  trackColor={{ false: t.trackBg, true: Colors.success + "aa" }}
                  thumbColor={active ? Colors.success : t.subtle} />
              </View>
            )}
            {problema && label.length > 0 ? <Text style={[s.problema]}>{problema}</Text> : null}
          </ScrollView>
          <View style={[s.bottomBar, { backgroundColor: t.bg, borderTopColor: t.border }]}>
            <TouchableOpacity style={[s.btn, (!canSave || saving) && { opacity: 0.4 }]} onPress={handleSave} disabled={saving} activeOpacity={0.85} accessibilityRole="button">
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

type Pendiente = { clientId: string; reward: LoyaltyReward; visits: number; available: number };
type Cercano = { clientId: string; nearest: ReturnType<typeof getRewardStatus> };

export default function LoyaltyScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const { tenantId } = useAuth();
  const { timezone, ready } = useTenant();
  const guard = useGuardRespuestas();
  const [rewards, setRewards] = useState<LoyaltyReward[]>([]);
  const [redemptions, setRedemptions] = useState<Entrega[]>([]);
  const [visitsByClient, setVisitsByClient] = useState<Record<string, number>>({});
  const [nombres, setNombres] = useState<Record<string, string>>({});
  const [truncado, setTruncado] = useState(false);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [modal, setModal] = useState<{ visible: boolean; reward: LoyaltyReward | null }>({ visible: false, reward: null });
  const [redeemingKey, setRedeemingKey] = useState<string | null>(null);
  const [verTodos, setVerTodos] = useState(false);
  const redeemingRef = useRef(false);

  // Todo paginado (el servidor corta en 1000 filas y limit(5000) no lo
  // supera): con 3.000 citas las visitas salían de 1000 filas arbitrarias y
  // las entregas que quedaban fuera volvían a salir "por entregar".
  // Visita = cita completada: se filtra en el servidor, así que las
  // inasistencias y las citas de hoy que aún no pasan ya no cuentan.
  const { recargar } = useRecarga(async () => {
    if (!tenantId) return;
    const turno = guard.nuevo();
    setLoading(true);
    try {
      const [rwRes, svRes, entregas, citas] = await Promise.all([
        supabase.from("loyalty_rewards").select("*").eq("tenant_id", tenantId).order("visits_required").order("id"),
        supabase.from("services").select("id,name").eq("tenant_id", tenantId).order("name"),
        traerTodo<Entrega>((d, h) => supabase.from("loyalty_redemptions")
          .select("id,client_id,reward_id").eq("tenant_id", tenantId)
          .order("redeemed_at").order("id").range(d, h) as unknown as Respuesta<Entrega>,
          { tope: 50_000, contexto: "No se pudieron cargar las entregas" }),
        traerTodoDetalle<{ id: string; client_id: string }>((d, h) => supabase.from("appointments")
          .select("id,client_id").eq("tenant_id", tenantId).eq("status", "completed")
          .not("client_id", "is", null)
          .order("id").range(d, h) as unknown as Respuesta<{ id: string; client_id: string }>,
          { tope: 50_000, contexto: "No se pudieron contar las visitas" }),
      ]);
      const recompensas = (revisar(rwRes, "No se pudieron cargar las recompensas") ?? []) as LoyaltyReward[];
      const servicios = (revisar(svRes, "No se pudieron cargar los servicios") ?? []) as ServiceRow[];
      const visitas: Record<string, number> = {};
      for (const a of citas.filas) visitas[a.client_id] = (visitas[a.client_id] ?? 0) + 1;

      // Nombres solo de los clientes que se van a mostrar (por entregar y los
      // más cercanos), no de toda la base.
      const activos = recompensas.filter(r => r.active);
      const porCliente = agruparEntregas(entregas);
      const { pendientes, cercanos } = calcular(activos, visitas, porCliente);
      const ids = [...new Set([...pendientes.map(p => p.clientId), ...cercanos.map(c => c.clientId)])];
      const clientes = await traerPorIds<{ id: string; name: string }>(ids, (lote, d, h) => supabase.from("clients")
        .select("id,name").in("id", lote).order("id").range(d, h) as unknown as Respuesta<{ id: string; name: string }>,
        { contexto: "No se pudieron cargar los clientes" });

      if (!turno.vigente()) return;
      setRewards(recompensas);
      setServices(servicios);
      setRedemptions(entregas);
      setVisitsByClient(visitas);
      setTruncado(citas.truncado);
      setNombres(Object.fromEntries(clientes.map(c => [c.id, c.name])));
      setError(null);
    } catch (e) {
      if (turno.vigente()) setError(e);
    } finally {
      if (turno.vigente()) setLoading(false);
    }
  }, [tenantId, timezone], { timeZone: timezone, habilitado: !!tenantId && ready, alCambiarSede: false });

  const onRefresh = async () => { setRefreshing(true); await recargar(); setRefreshing(false); };

  const serviceName = (id: string | null) => services.find(sv => sv.id === id)?.name ?? null;
  const activeRewards = useMemo(() => rewards.filter(r => r.active), [rewards]);
  const { pendientes: pending, cercanos: closest } = useMemo(
    () => calcular(activeRewards, visitsByClient, agruparEntregas(redemptions)),
    [activeRewards, visitsByClient, redemptions],
  );

  const handleRedeem = async (p: Pendiente) => {
    if (!tenantId || redeemingRef.current) return;
    const key = `${p.clientId}:${p.reward.id}`;
    redeemingRef.current = true;
    setRedeemingKey(key);
    try {
      // Revalida con datos frescos del servidor y usa un id fijo por entrega:
      // un doble toque o dos dispositivos ya no registran dos entregas.
      const r = await entregarRecompensa({ tenantId, clientId: p.clientId, reward: p.reward });
      if (!r.ok) Alert.alert("No se registró la entrega", r.mensaje);
      await recargar();
    } catch (e) {
      Alert.alert("No se pudo registrar la entrega", mensajeError(e));
    } finally {
      redeemingRef.current = false;
      setRedeemingKey(null);
    }
  };

  const nombre = (id: string) => nombres[id] ?? "Cliente";
  const visiblesPendientes = verTodos ? pending : pending.slice(0, POR_ENTREGAR_VISIBLES);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <LinearGradient colors={Gradients.ink} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.header}>
        <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3 }} />
        <View style={s.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn} hitSlop={HIT_SLOP} accessibilityRole="button" accessibilityLabel="Volver">
            <Ionicons name="arrow-back" size={20} color="white" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.headerTitle}>Fidelización</Text>
            <Text style={s.headerSub}>{rewards.length} recompensa{rewards.length !== 1 ? "s" : ""} · {pending.length} por entregar</Text>
          </View>
          <TouchableOpacity style={s.addBtn} onPress={() => setModal({ visible: true, reward: null })} activeOpacity={0.8} hitSlop={HIT_SLOP} accessibilityRole="button" accessibilityLabel="Nueva recompensa">
            <Ionicons name="add" size={22} color="white" />
          </TouchableOpacity>
        </View>
      </LinearGradient>

      {error && rewards.length === 0 && !loading ? (
        <ErrorState error={error} onRetry={recargar} />
      ) : (
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 110 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.red} />}
      >
        {error ? (
          <TouchableOpacity onPress={recargar} style={s.errorBanner} accessibilityRole="button">
            <Text style={[s.errorText, { color: t.text }]}>{mensajeError(error)} Toca para reintentar.</Text>
          </TouchableOpacity>
        ) : null}
        {truncado ? (
          <Text style={[s.sectionEmpty, { color: t.muted }]}>El negocio tiene demasiadas citas para contarlas aquí; algunas visitas pueden faltar.</Text>
        ) : null}

        {loading && rewards.length === 0 ? (
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
                  accessibilityRole="button"
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
                <Text style={[s.sectionTitle, { color: t.subtle }]}>Por entregar ({pending.length})</Text>
                {pending.length === 0 ? (
                  <Text style={[s.sectionEmpty, { color: t.muted }]}>Nadie tiene una recompensa lista todavía.</Text>
                ) : visiblesPendientes.map(p => {
                  const key = `${p.clientId}:${p.reward.id}`;
                  const ocupado = !!redeemingKey || loading;
                  return (
                    <View key={key} style={[s.row, Shadow.sm, { backgroundColor: t.bgAlt, borderWidth: 1, borderColor: "#a855f7" + "40" }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.name, { color: t.text }]} numberOfLines={1}>{nombre(p.clientId)}</Text>
                        <Text style={[s.info, { color: "#a855f7" }]}>
                          {describeReward(p.reward, serviceName(p.reward.service_id))} · {p.visits} visitas{p.available > 1 ? ` · ×${p.available}` : ""}
                        </Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => handleRedeem(p)}
                        disabled={ocupado}
                        style={[s.redeemBtn, ocupado && { opacity: 0.6 }]}
                        activeOpacity={0.8}
                        accessibilityRole="button"
                        accessibilityLabel={`Entregar ${p.reward.label} a ${nombre(p.clientId)}`}
                      >
                        {redeemingKey === key
                          ? <ActivityIndicator size="small" color="white" />
                          : <Text style={s.redeemText}>Entregar</Text>}
                      </TouchableOpacity>
                    </View>
                  );
                })}
                {!verTodos && pending.length > POR_ENTREGAR_VISIBLES && (
                  <TouchableOpacity onPress={() => setVerTodos(true)} style={[s.moreBtn, { borderColor: t.border }]} accessibilityRole="button">
                    <Text style={[s.moreText, { color: t.text }]}>Ver los {pending.length} por entregar</Text>
                  </TouchableOpacity>
                )}

                {/* Más cerca */}
                <Text style={[s.sectionTitle, { color: t.subtle }]}>Más cerca de su recompensa</Text>
                {closest.length === 0 ? (
                  <Text style={[s.sectionEmpty, { color: t.muted }]}>Aún no hay suficientes visitas registradas.</Text>
                ) : closest.map(c => (
                  <View key={c.clientId} style={[s.row, Shadow.sm, { backgroundColor: t.bgAlt, flexDirection: "column", alignItems: "stretch", gap: 8 }]}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <Text style={[s.name, { color: t.text, flexShrink: 1 }]} numberOfLines={1}>{nombre(c.clientId)}</Text>
                      <Text style={[s.info, { color: t.muted }]}>
                        Falta{c.nearest.remaining !== 1 ? "n" : ""} <Text style={{ color: Colors.blue, fontFamily: "SpaceGrotesk_700Bold" }}>{c.nearest.remaining}</Text> visita{c.nearest.remaining !== 1 ? "s" : ""}
                      </Text>
                    </View>
                    <View style={[s.progressTrack, { backgroundColor: t.trackBg }]}>
                      <View style={[s.progressFill, { width: `${Math.min(100, (c.nearest.progressCurrent / c.nearest.progressTarget) * 100)}%` }]} />
                    </View>
                  </View>
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>
      )}

      {tenantId && (
        <RewardModal
          visible={modal.visible}
          reward={modal.reward}
          tenantId={tenantId}
          services={services}
          onClose={() => setModal({ visible: false, reward: null })}
          onSaved={() => { recargar(); }}
        />
      )}
    </SafeAreaView>
  );
}

function agruparEntregas(entregas: Entrega[]): Map<string, Entrega[]> {
  const m = new Map<string, Entrega[]>();
  for (const e of entregas) {
    const arr = m.get(e.client_id);
    if (arr) arr.push(e); else m.set(e.client_id, [e]);
  }
  return m;
}

function calcular(activas: LoyaltyReward[], visitas: Record<string, number>, entregas: Map<string, Entrega[]>): { pendientes: Pendiente[]; cercanos: Cercano[] } {
  if (activas.length === 0) return { pendientes: [], cercanos: [] };
  const pendientes: Pendiente[] = [];
  const cercanos: Cercano[] = [];
  for (const [clientId, v] of Object.entries(visitas)) {
    if (v <= 0) continue;
    const propias = entregas.get(clientId) ?? [];
    let tienePendiente = false;
    for (const r of activas) {
      const st = getRewardStatus(r, v, propias);
      if (st.available > 0) { pendientes.push({ clientId, reward: r, visits: v, available: st.available }); tienePendiente = true; }
    }
    if (!tienePendiente) {
      const nearest = getClientRewardStatuses(activas, v, propias).sort((a, b) => a.remaining - b.remaining)[0];
      if (nearest) cercanos.push({ clientId, nearest });
    }
  }
  pendientes.sort((a, b) => b.visits - a.visits);
  cercanos.sort((a, b) => a.nearest.remaining - b.nearest.remaining);
  return { pendientes, cercanos: cercanos.slice(0, 8) };
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
  errorBanner: { borderWidth: 1, borderColor: Colors.red + "40", backgroundColor: Colors.red + "10", borderRadius: Radius.md, padding: 12, marginBottom: 12 },
  errorText:  { fontSize: 12.5, fontFamily: "SpaceGrotesk_600SemiBold" },
  row:        { borderRadius: Radius.md, padding: 14, flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  iconBox:    { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  name:       { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold" },
  info:       { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", marginTop: 2 },
  redeemBtn:  { backgroundColor: "#a855f7", borderRadius: Radius.full, paddingVertical: 9, paddingHorizontal: 14 },
  redeemText: { fontSize: 12, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
  moreBtn:    { borderWidth: 1, borderRadius: Radius.md, paddingVertical: 12, alignItems: "center", marginBottom: 6 },
  moreText:   { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold" },
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
  hint:       { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", marginTop: 6 },
  problema:   { fontSize: 12.5, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.red, marginTop: 14 },
  chip:       { borderWidth: 1.5, borderRadius: Radius.full, paddingVertical: 8, paddingHorizontal: 14 },
  chipText:   { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold" },
  switchRow:  { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: Radius.md, padding: 14 },
  switchLabel:{ fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold" },
  switchSub:  { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", marginTop: 2 },
});
