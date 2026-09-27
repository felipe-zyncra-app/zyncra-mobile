import { useMemo, useRef, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Clipboard, Linking, Switch, Alert, RefreshControl,
} from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { Colors, Radius, Shadow } from "@/constants/theme";
import ErrorState from "@/components/ErrorState";
import { useTheme, type ThemeColors } from "@/lib/theme";
import { ScreenHeader } from "@/components/ui";
import { Config } from "@/lib/config";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { exigirFilas, mensajeError, revisar, traerTodo } from "@/lib/db";
import { useRecarga, useGuardRespuestas } from "@/lib/useRecarga";
import { diaLocalDe, fmtDia } from "@/lib/tz";

type Tab    = "resumen" | "resenas" | "config";
type Filter = "all" | "pending" | "approved" | "rejected";
type Status = "pending" | "approved" | "rejected";
type Review = { id: string; client_name: string; rating: number; comment: string | null; service: string | null; status: string; created_at: string };

function Stars({ rating, size = 14, vacia }: { rating: number; size?: number; vacia: string }) {
  return (
    <View style={{ flexDirection: "row", gap: 2 }} accessibilityLabel={`${rating} de 5 estrellas`}>
      {[1, 2, 3, 4, 5].map(i => (
        <Ionicons key={i} name={i <= rating ? "star" : "star-outline"} size={size} color={i <= rating ? "#f59e0b" : vacia} />
      ))}
    </View>
  );
}

export default function SiteReviewsScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const s = useMemo(() => crearEstilos(t), [t]);
  const { tenantId } = useAuth();
  const { timezone, ready } = useTenant();
  const guard = useGuardRespuestas();
  const [tab, setTab]                   = useState<Tab>("resumen");
  const [reviews, setReviews]           = useState<Review[]>([]);
  const [loading, setLoading]           = useState(true);
  const [cargado, setCargado]           = useState(false);
  const [error, setError]               = useState<unknown>(null);
  const [refreshing, setRefreshing]     = useState(false);
  const [filter, setFilter]             = useState<Filter>("all");
  const [showOnBooking, setShowOnBooking] = useState(true);
  const [cfgCargada, setCfgCargada]     = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configSaved, setConfigSaved]   = useState(false);
  const [copied, setCopied]             = useState(false);
  const [moderando, setModerando]       = useState<Set<string>>(new Set());
  const configEditada = useRef(false);

  const { recargar } = useRecarga(async () => {
    if (!tenantId) return;
    const turno = guard.nuevo();
    try {
      const [cfgRes, rv] = await Promise.all([
        supabase.from("google_review_settings").select("show_on_booking").eq("tenant_id", tenantId).maybeSingle(),
        traerTodo<Review>((d, h) =>
          supabase.from("site_reviews")
            .select("id, client_name, rating, comment, service, status, created_at")
            .eq("tenant_id", tenantId).order("created_at", { ascending: false }).order("id").range(d, h),
        { contexto: "No se pudieron cargar las reseñas", tope: 5000 }),
      ]);
      const cfg = revisar(cfgRes, "No se pudo cargar la configuración de reseñas") as { show_on_booking: boolean | null } | null;
      if (!turno.vigente()) return;
      if (!configEditada.current) setShowOnBooking(cfg?.show_on_booking ?? true);
      setCfgCargada(true);
      setReviews(rv);
      setError(null);
      setCargado(true);
    } catch (e) {
      if (turno.vigente()) setError(e);
    } finally {
      if (turno.vigente()) setLoading(false);
    }
  }, [tenantId], { timeZone: timezone, habilitado: !!tenantId && ready, alCambiarSede: false, frescuraMs: 20_000 });

  /** Optimista, pero revierte y avisa si falla: antes quedaba "Aprobada" en
   *  pantalla aunque la base la rechazara (COM-17). */
  const updateStatus = async (id: string, status: Status) => {
    if (moderando.has(id)) return;
    const anterior = reviews.find(r => r.id === id)?.status;
    setModerando(prev => new Set(prev).add(id));
    setReviews(prev => prev.map(r => (r.id === id ? { ...r, status } : r)));
    try {
      exigirFilas(
        await supabase.from("site_reviews").update({ status }).eq("id", id).select("id"),
        "No se pudo cambiar el estado de la reseña",
      );
    } catch (e) {
      if (anterior) setReviews(prev => prev.map(r => (r.id === id ? { ...r, status: anterior } : r)));
      Alert.alert("No se guardó", mensajeError(e));
    } finally {
      setModerando(prev => { const n = new Set(prev); n.delete(id); return n; });
    }
  };

  const saveConfig = async () => {
    if (!tenantId || savingConfig) return;
    if (!cfgCargada) {
      Alert.alert("Un momento", "Todavía no se carga tu configuración actual.");
      return;
    }
    setSavingConfig(true);
    try {
      // upsert por tenant_id (UNIQUE): solo toca show_on_booking y no choca
      // si otra pantalla creó la fila mientras tanto.
      revisar(
        await supabase.from("google_review_settings")
          .upsert({ tenant_id: tenantId, show_on_booking: showOnBooking }, { onConflict: "tenant_id" })
          .select("id").single(),
        "No se pudo guardar la preferencia",
      );
      configEditada.current = false;
      setConfigSaved(true);
      setTimeout(() => setConfigSaved(false), 2000);
    } catch (e) {
      Alert.alert("No se guardó", mensajeError(e));
    } finally {
      setSavingConfig(false);
    }
  };

  const onRefresh = async () => { setRefreshing(true); await recargar(); setRefreshing(false); };

  // Stats
  const approved  = reviews.filter(r => r.status === "approved");
  const pending   = reviews.filter(r => r.status === "pending");
  const rejected  = reviews.filter(r => r.status === "rejected");
  const avgRating = approved.length > 0
    ? approved.reduce((sum, r) => sum + r.rating, 0) / approved.length : 0;
  const starDist  = [5, 4, 3, 2, 1].map(n => ({
    star: n, count: approved.filter(r => r.rating === n).length,
  }));
  const maxStar   = Math.max(...starDist.map(d => d.count), 1);

  const filtered  = filter === "all" ? reviews
    : reviews.filter(r => r.status === filter);

  const publicLink = tenantId ? `${Config.urls.review}${tenantId}` : "";
  const fecha = (iso: string) => fmtDia(diaLocalDe(iso, timezone), "corto");

  const TABS: { key: Tab; label: string }[] = [
    { key: "resumen", label: "Resumen" },
    { key: "resenas", label: `Reseñas${pending.length > 0 ? ` (${pending.length})` : ""}` },
    { key: "config",  label: "Configuración" },
  ];

  const FILTERS: { key: Filter; label: string }[] = [
    { key: "all",      label: "Todas" },
    { key: "pending",  label: "Pendientes" },
    { key: "approved", label: "Aprobadas" },
    { key: "rejected", label: "Rechazadas" },
  ];

  const statusColor: Record<string, string> = { pending: "#f59e0b", approved: Colors.success, rejected: Colors.red };
  const statusLabel: Record<string, string> = { pending: "Pendiente", approved: "Aprobada", rejected: "Rechazada" };

  const abrirFormulario = async () => {
    try {
      await Linking.openURL(publicLink);
    } catch {
      Alert.alert("No se pudo abrir el enlace", "Copia el link y ábrelo en el navegador.");
    }
  };

  const refresco = <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.red} />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader
        crumb="Marketing"
        title="Reseñas del negocio"
        subtitle={pending.length > 0 ? `${pending.length} por moderar` : "Gestiona las opiniones de tus clientes"}
        onBack={() => router.back()}
      />

      {/* Tabs */}
      <View style={[s.tabBar, { backgroundColor: t.bgAlt, borderBottomColor: t.border }]}>
        {TABS.map(tb => (
          <TouchableOpacity key={tb.key} style={[s.tabBtn, tab === tb.key && s.tabBtnActive]} onPress={() => setTab(tb.key)} activeOpacity={0.75}
            accessibilityRole="tab" accessibilityState={{ selected: tab === tb.key }}>
            <Text style={[s.tabLabel, tab === tb.key && s.tabLabelActive]}>{tb.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {error && !cargado ? (
        <ErrorState error={error} onRetry={recargar} />
      ) : loading && !cargado ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={Colors.red} size="large" />
        </View>
      ) : (
        <>
          {error ? (
            <TouchableOpacity onPress={recargar} activeOpacity={0.8} style={s.offline}>
              <Ionicons name="cloud-offline-outline" size={13} color={t.muted} />
              <Text style={s.offlineText}>{mensajeError(error)} Toca para reintentar.</Text>
            </TouchableOpacity>
          ) : null}

          {/* ── RESUMEN ── */}
          {tab === "resumen" && (
            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} refreshControl={refresco}>
              {reviews.length === 0 ? (
                <Animated.View entering={FadeInDown.duration(350)} style={[s.emptyCard, Shadow.sm]}>
                  <Text style={{ fontSize: 32, marginBottom: 10 }}>⭐</Text>
                  <Text style={s.emptyTitle}>Sin reseñas aún</Text>
                  <Text style={s.emptySub}>Comparte el link en "Configuración" para empezar a recibir reseñas</Text>
                </Animated.View>
              ) : (
                <Animated.View entering={FadeInDown.duration(350)}>
                  {/* KPI cards */}
                  <View style={s.kpiRow}>
                    <View style={[s.kpiCard, Shadow.sm]}>
                      <Text style={s.kpiValue}>{avgRating > 0 ? avgRating.toFixed(1) : "—"}</Text>
                      <Stars rating={Math.round(avgRating)} size={12} vacia={t.lineStrong} />
                      <Text style={s.kpiLabel}>Promedio</Text>
                      <Text style={s.kpiSub}>{approved.length} aprobadas</Text>
                    </View>
                    <View style={[s.kpiCard, Shadow.sm, pending.length > 0 && { backgroundColor: "rgba(245,158,11,0.10)" }]}>
                      <Text style={[s.kpiValue, pending.length > 0 && { color: "#f59e0b" }]}>{pending.length}</Text>
                      <Text style={s.kpiLabel}>Pendientes</Text>
                      <Text style={s.kpiSub}>requieren revisión</Text>
                    </View>
                    <View style={[s.kpiCard, Shadow.sm]}>
                      <Text style={s.kpiValue}>{reviews.length}</Text>
                      <Text style={s.kpiLabel}>Total</Text>
                      <Text style={s.kpiSub}>{rejected.length} rechazadas</Text>
                    </View>
                  </View>

                  {/* Star distribution */}
                  {approved.length > 0 && (
                    <View style={[s.distCard, Shadow.sm]}>
                      <Text style={s.distTitle}>Distribución de estrellas</Text>
                      {starDist.map(d => (
                        <View key={d.star} style={s.distRow}>
                          <Text style={s.distStar}>{d.star}★</Text>
                          <View style={s.distBarWrap}>
                            <View style={[s.distBar, { width: `${(d.count / maxStar) * 100}%` }]} />
                          </View>
                          <Text style={s.distCount}>{d.count}</Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {/* Featured reviews */}
                  {approved.length > 0 && (
                    <>
                      <Text style={s.sectionLabel}>Reseñas destacadas</Text>
                      {approved.slice(0, 4).map((r, i) => (
                        <Animated.View key={r.id} entering={FadeInDown.delay(i * 60).duration(300)}>
                          <View style={[s.reviewCard, Shadow.sm]}>
                            <View style={s.reviewTop}>
                              <Text style={s.reviewName}>{r.client_name}</Text>
                              <Text style={s.reviewDate}>{fecha(r.created_at)}</Text>
                            </View>
                            <Stars rating={r.rating} vacia={t.lineStrong} />
                            {r.comment ? <Text style={s.reviewComment}>{r.comment}</Text> : null}
                          </View>
                        </Animated.View>
                      ))}
                    </>
                  )}
                </Animated.View>
              )}
            </ScrollView>
          )}

          {/* ── RESEÑAS ── */}
          {tab === "resenas" && (
            <>
              {/* Filter chips */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterStrip} contentContainerStyle={s.filterContent}>
                {FILTERS.map(f => (
                  <TouchableOpacity key={f.key} style={[s.filterChip, filter === f.key && s.filterChipActive]}
                    onPress={() => setFilter(f.key)} activeOpacity={0.75}
                    accessibilityRole="button" accessibilityState={{ selected: filter === f.key }}>
                    <Text style={[s.filterChipText, filter === f.key && s.filterChipTextActive]}>{f.label}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} refreshControl={refresco}>
                {filtered.length === 0 ? (
                  <View style={[s.emptyCard, Shadow.sm, { marginTop: 10 }]}>
                    <Text style={s.emptySub}>Sin reseñas en esta categoría</Text>
                  </View>
                ) : (
                  filtered.map((r, i) => {
                    const ocupado = moderando.has(r.id);
                    return (
                      <Animated.View key={r.id} entering={i < 10 ? FadeInDown.delay(i * 40).duration(280) : undefined}>
                        <View style={[s.reviewCard, Shadow.sm]}>
                          <View style={s.reviewTop}>
                            <View style={{ flex: 1 }}>
                              <Text style={s.reviewName}>{r.client_name}</Text>
                              {r.service ? <Text style={s.reviewService}>{r.service}</Text> : null}
                            </View>
                            <View style={[s.statusBadge, { backgroundColor: (statusColor[r.status] ?? t.muted) + "1f" }]}>
                              <Text style={[s.statusBadgeText, { color: statusColor[r.status] ?? t.muted }]}>
                                {statusLabel[r.status] ?? r.status}
                              </Text>
                            </View>
                          </View>
                          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
                            <Stars rating={r.rating} vacia={t.lineStrong} />
                            <Text style={s.reviewDate}>{fecha(r.created_at)}</Text>
                          </View>
                          {r.comment ? <Text style={s.reviewComment}>{r.comment}</Text> : null}

                          {/* Actions */}
                          <View style={[s.reviewActions, ocupado && { opacity: 0.5 }]}>
                            {ocupado && <ActivityIndicator size="small" color={t.muted} />}
                            {r.status === "pending" && (
                              <>
                                <TouchableOpacity style={[s.modBtn, { borderColor: Colors.red + "50" }]} disabled={ocupado}
                                  onPress={() => updateStatus(r.id, "rejected")} activeOpacity={0.75}>
                                  <Text style={[s.modBtnText, { color: Colors.red }]}>Rechazar</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={[s.modBtn, { backgroundColor: Colors.success, borderColor: Colors.success }]} disabled={ocupado}
                                  onPress={() => updateStatus(r.id, "approved")} activeOpacity={0.75}>
                                  <Text style={[s.modBtnText, { color: "white" }]}>Aprobar</Text>
                                </TouchableOpacity>
                              </>
                            )}
                            {r.status === "approved" && (
                              <TouchableOpacity style={[s.modBtn, { borderColor: Colors.red + "50" }]} disabled={ocupado}
                                onPress={() => updateStatus(r.id, "rejected")} activeOpacity={0.75}>
                                <Text style={[s.modBtnText, { color: Colors.red }]}>Retirar</Text>
                              </TouchableOpacity>
                            )}
                            {r.status === "rejected" && (
                              <TouchableOpacity style={[s.modBtn, { backgroundColor: Colors.success, borderColor: Colors.success }]} disabled={ocupado}
                                onPress={() => updateStatus(r.id, "approved")} activeOpacity={0.75}>
                                <Text style={[s.modBtnText, { color: "white" }]}>Aprobar</Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        </View>
                      </Animated.View>
                    );
                  })
                )}
              </ScrollView>
            </>
          )}

          {/* ── CONFIGURACIÓN ── */}
          {tab === "config" && (
            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
              <Animated.View entering={FadeInDown.duration(350)}>

                {/* Public link */}
                <View style={[s.configCard, Shadow.sm]}>
                  <Text style={s.configCardTitle}>Link público de reseñas</Text>
                  <Text style={s.configCardSub}>Comparte este link con tus clientes. Cada reseña queda pendiente hasta que la apruebes.</Text>
                  <View style={[s.linkRow, { marginTop: 14 }]}>
                    <Text style={s.linkText} numberOfLines={1}>{publicLink}</Text>
                    {/* 36 px de alto: hitSlop para llegar al mínimo táctil de 44 (CAL-24). */}
                    <TouchableOpacity style={s.copyBtn}
                      onPress={() => { Clipboard.setString(publicLink); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      activeOpacity={0.8} accessibilityRole="button" accessibilityLabel="Copiar link">
                      <Ionicons name={copied ? "checkmark" : "copy-outline"} size={16} color={copied ? Colors.success : t.muted} />
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity style={s.openLink} onPress={abrirFormulario} activeOpacity={0.75}>
                    <Text style={s.openLinkText}>Abrir formulario de reseñas →</Text>
                  </TouchableOpacity>
                </View>

                {/* Show on booking */}
                <View style={[s.configCard, Shadow.sm, { marginTop: 16 }]}>
                  <View style={s.switchRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.configCardTitle}>Mostrar en agendamiento</Text>
                      <Text style={s.configCardSub}>Las reseñas aprobadas aparecerán en tu página de reservas</Text>
                    </View>
                    <Switch
                      value={showOnBooking}
                      onValueChange={v => { configEditada.current = true; setShowOnBooking(v); }}
                      trackColor={{ false: t.trackBg, true: Colors.success + "aa" }}
                      thumbColor={showOnBooking ? Colors.success : t.subtle}
                      accessibilityLabel="Mostrar reseñas en la página de reservas"
                    />
                  </View>
                  <TouchableOpacity style={s.saveConfigBtn} onPress={saveConfig} disabled={savingConfig || !cfgCargada} activeOpacity={0.85}>
                    <View style={[s.saveConfigInner, { backgroundColor: configSaved ? Colors.success : Colors.red }, !cfgCargada && { opacity: 0.5 }]}>
                      {savingConfig ? <ActivityIndicator color="white" size="small" />
                        : configSaved
                          ? <><Ionicons name="checkmark-circle" size={16} color="white" /><Text style={s.saveConfigText}>Guardado</Text></>
                          : <Text style={s.saveConfigText}>Guardar preferencias</Text>
                      }
                    </View>
                  </TouchableOpacity>
                </View>

                {/* Tip */}
                <View style={s.tipBox}>
                  <Ionicons name="information-circle-outline" size={16} color="#0ea5e9" />
                  <Text style={s.tipText}>Envía el link a tus clientes por WhatsApp después de cada servicio para obtener más reseñas.</Text>
                </View>
              </Animated.View>
            </ScrollView>
          )}
        </>
      )}
    </SafeAreaView>
  );
}

// Tokens del tema: con Colors.white/text fijos, en modo oscuro las tarjetas
// quedaban blancas con texto oscuro.
function crearEstilos(t: ThemeColors) {
  return StyleSheet.create({
    tabBar:       { flexDirection: "row", borderBottomWidth: 1 },
    tabBtn:       { flex: 1, paddingVertical: 13, alignItems: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
    tabBtnActive: { borderBottomColor: Colors.red },
    tabLabel:     { fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold", color: t.muted },
    tabLabelActive:{ fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", color: Colors.red },

    offline:      { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: t.chipBg, paddingHorizontal: 16, paddingVertical: 8 },
    offlineText:  { flex: 1, fontSize: 11.5, fontFamily: "SpaceGrotesk_400Regular", color: t.muted },

    kpiRow:       { flexDirection: "row", gap: 10, marginBottom: 16 },
    kpiCard:      { flex: 1, backgroundColor: t.cardSolid, borderRadius: Radius.lg, padding: 14, alignItems: "center", gap: 4, borderWidth: 1, borderColor: t.line },
    kpiValue:     { fontSize: 26, fontFamily: "SpaceGrotesk_700Bold", color: t.text },
    kpiLabel:     { fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold", color: t.text },
    kpiSub:       { fontSize: 10, fontFamily: "SpaceGrotesk_400Regular", color: t.subtle, textAlign: "center" },

    distCard:     { backgroundColor: t.cardSolid, borderRadius: Radius.lg, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: t.line },
    distTitle:    { fontSize: 13, fontFamily: "SpaceGrotesk_700Bold", color: t.text, marginBottom: 12 },
    distRow:      { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
    distStar:     { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: t.muted, width: 24 },
    distBarWrap:  { flex: 1, height: 8, backgroundColor: t.trackBg, borderRadius: 4, overflow: "hidden" },
    distBar:      { height: 8, backgroundColor: "#f59e0b", borderRadius: 4 },
    distCount:    { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: t.muted, width: 20, textAlign: "right" },

    sectionLabel: { fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", color: t.subtle, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 },

    reviewCard:   { backgroundColor: t.cardSolid, borderRadius: Radius.lg, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: t.line },
    reviewTop:    { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4, gap: 8 },
    reviewName:   { fontSize: 14, fontFamily: "SpaceGrotesk_700Bold", color: t.text },
    reviewService:{ fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: t.muted, marginTop: 2 },
    reviewDate:   { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", color: t.subtle },
    reviewComment:{ fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: t.muted, lineHeight: 18, marginTop: 8 },
    reviewActions:{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12, justifyContent: "flex-end" },
    statusBadge:  { borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 4 },
    statusBadgeText:{ fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold" },

    modBtn:       { borderRadius: Radius.md, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 8 },
    modBtnText:   { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold" },

    filterStrip:  { backgroundColor: t.bgAlt, borderBottomWidth: 1, borderBottomColor: t.border, maxHeight: 54 },
    filterContent:{ paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
    filterChip:   { borderRadius: Radius.full, paddingHorizontal: 14, paddingVertical: 6, backgroundColor: t.chipBg, borderWidth: 1.5, borderColor: t.line },
    filterChipActive:{ backgroundColor: Colors.red, borderColor: Colors.red },
    filterChipText:{ fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: t.muted },
    filterChipTextActive:{ color: "white" },

    emptyCard:    { backgroundColor: t.cardSolid, borderRadius: Radius.xl, padding: 48, alignItems: "center", marginTop: 20, borderWidth: 1, borderColor: t.line },
    emptyTitle:   { fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", color: t.text, marginBottom: 6 },
    emptySub:     { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: t.muted, textAlign: "center" },

    configCard:   { backgroundColor: t.cardSolid, borderRadius: Radius.lg, padding: 16, borderWidth: 1, borderColor: t.line },
    configCardTitle:{ fontSize: 14, fontFamily: "SpaceGrotesk_700Bold", color: t.text, marginBottom: 6 },
    configCardSub:{ fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: t.muted, lineHeight: 18 },
    linkRow:      { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: t.chipBg, borderRadius: Radius.md, padding: 12 },
    linkText:     { flex: 1, fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: t.muted },
    copyBtn:      { width: 36, height: 36, borderRadius: 8, backgroundColor: t.cardSolid, borderWidth: 1, borderColor: t.line, alignItems: "center", justifyContent: "center" },
    openLink:     { marginTop: 10 },
    openLinkText: { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.red },
    switchRow:    { flexDirection: "row", alignItems: "center", gap: 12 },
    saveConfigBtn:{ borderRadius: Radius.full, overflow: "hidden", marginTop: 16 },
    saveConfigInner:{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, backgroundColor: Colors.red },
    saveConfigText:{ fontSize: 14, fontFamily: "SpaceGrotesk_700Bold", color: "white" },

    tipBox:       { flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: "rgba(14,165,233,0.10)", borderRadius: Radius.md, padding: 14, marginTop: 16, borderWidth: 1, borderColor: "rgba(14,165,233,0.35)" },
    tipText:      { flex: 1, fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: t.text, lineHeight: 18 },
  });
}
