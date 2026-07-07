import { useCallback, useEffect, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Clipboard, Linking, Switch,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { Colors, Gradients, Radius, Shadow } from "@/constants/theme";
import ErrorState from "@/components/ErrorState";
import { useTheme } from "@/lib/theme";
import { Config } from "@/lib/config";
import { useAuth } from "@/lib/auth";
import { fmtDateFull } from "@/lib/format";

type Tab    = "resumen" | "resenas" | "config";
type Filter = "all" | "pending" | "approved" | "rejected";
type Review = { id: string; client_name: string; rating: number; comment: string | null; service: string | null; status: string; created_at: string };

function Stars({ rating, size = 14 }: { rating: number; size?: number }) {
  return (
    <View style={{ flexDirection: "row", gap: 2 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <Ionicons key={i} name={i <= rating ? "star" : "star-outline"} size={size} color={i <= rating ? "#f59e0b" : "#d1d5db"} />
      ))}
    </View>
  );
}

export default function SiteReviewsScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const { tenantId } = useAuth();
  const [settingsId, setSettingsId]     = useState<string | null>(null);
  const [tab, setTab]                   = useState<Tab>("resumen");
  const [reviews, setReviews]           = useState<Review[]>([]);
  const [loading, setLoading]           = useState(true);
  const [filter, setFilter]             = useState<Filter>("all");
  const [showOnBooking, setShowOnBooking] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configSaved, setConfigSaved]   = useState(false);
  const [copied, setCopied]             = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    (async () => {
      const { data: cfg } = await supabase.from("google_review_settings")
        .select("id, show_on_booking").eq("tenant_id", tenantId).single();
      if (cancelled) return;
      if (cfg) { setSettingsId(cfg.id); setShowOnBooking(cfg.show_on_booking ?? true); }
      const { data: rv } = await supabase.from("site_reviews")
        .select("id, client_name, rating, comment, service, status, created_at")
        .eq("tenant_id", tenantId).order("created_at", { ascending: false });
      if (cancelled) return;
      setReviews((rv ?? []) as Review[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [tenantId]);

  const reload = useCallback(async () => {
    if (!tenantId) return;
    const { data } = await supabase.from("site_reviews")
      .select("id, client_name, rating, comment, service, status, created_at")
      .eq("tenant_id", tenantId).order("created_at", { ascending: false });
    setReviews((data ?? []) as Review[]);
  }, [tenantId]);

  const updateStatus = async (id: string, status: string) => {
    await supabase.from("site_reviews").update({ status }).eq("id", id);
    setReviews(prev => prev.map(r => r.id === id ? { ...r, status } : r));
  };

  const saveConfig = async () => {
    if (!tenantId) return;
    setSavingConfig(true);
    const payload = { show_on_booking: showOnBooking, tenant_id: tenantId };
    if (settingsId) {
      await supabase.from("google_review_settings").update(payload).eq("id", settingsId);
    } else {
      const { data } = await supabase.from("google_review_settings").insert(payload).select("id").single();
      if (data) setSettingsId(data.id);
    }
    setSavingConfig(false);
    setConfigSaved(true);
    setTimeout(() => setConfigSaved(false), 2000);
  };

  // Stats
  const approved  = reviews.filter(r => r.status === "approved");
  const pending   = reviews.filter(r => r.status === "pending");
  const rejected  = reviews.filter(r => r.status === "rejected");
  const avgRating = approved.length > 0
    ? approved.reduce((s, r) => s + r.rating, 0) / approved.length : 0;
  const starDist  = [5, 4, 3, 2, 1].map(n => ({
    star: n, count: approved.filter(r => r.rating === n).length,
  }));
  const maxStar   = Math.max(...starDist.map(d => d.count), 1);

  const filtered  = filter === "all" ? reviews
    : reviews.filter(r => r.status === filter);

  const publicLink = tenantId ? `${Config.urls.review}${tenantId}` : "";

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

  const statusColor  = { pending: "#f59e0b", approved: Colors.success, rejected: Colors.red };
  const statusLabel  = { pending: "Pendiente", approved: "Aprobada", rejected: "Rechazada" };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <LinearGradient colors={Gradients.ink} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.header}>
        <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3 }} />
        <View style={s.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="arrow-back" size={20} color="white" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.headerTitle}>Reseñas del sitio</Text>
            <Text style={s.headerSub}>Gestiona las opiniones de tus clientes</Text>
          </View>
          {pending.length > 0 && (
            <View style={s.pendingBadge}>
              <Text style={s.pendingBadgeText}>{pending.length}</Text>
            </View>
          )}
        </View>
      </LinearGradient>

      {/* Tabs */}
      <View style={[s.tabBar, { backgroundColor: t.bgAlt, borderBottomColor: t.border }]}>
        {TABS.map(tb => (
          <TouchableOpacity key={tb.key} style={[s.tabBtn, tab === tb.key && s.tabBtnActive]} onPress={() => setTab(tb.key)} activeOpacity={0.75}>
            <Text style={[s.tabLabel, { color: t.muted }, tab === tb.key && s.tabLabelActive]}>{tb.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={Colors.red} size="large" />
        </View>
      ) : (
        <>
          {/* ── RESUMEN ── */}
          {tab === "resumen" && (
            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
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
                      <Stars rating={Math.round(avgRating)} size={12} />
                      <Text style={s.kpiLabel}>Promedio</Text>
                      <Text style={s.kpiSub}>{approved.length} aprobadas</Text>
                    </View>
                    <View style={[s.kpiCard, Shadow.sm, pending.length > 0 && { backgroundColor: "#fffbeb" }]}>
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
                            <View style={[s.distBar, { width: `${(d.count / maxStar) * 100}%` as any }]} />
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
                              <Text style={s.reviewDate}>{fmtDateFull(r.created_at)}</Text>
                            </View>
                            <Stars rating={r.rating} />
                            {r.comment && <Text style={s.reviewComment}>{r.comment}</Text>}
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
                    onPress={() => setFilter(f.key)} activeOpacity={0.75}>
                    <Text style={[s.filterChipText, filter === f.key && s.filterChipTextActive]}>{f.label}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
                {filtered.length === 0 ? (
                  <View style={[s.emptyCard, Shadow.sm, { marginTop: 10 }]}>
                    <Text style={s.emptySub}>Sin reseñas en esta categoría</Text>
                  </View>
                ) : (
                  filtered.map((r, i) => (
                    <Animated.View key={r.id} entering={i < 10 ? FadeInDown.delay(i * 40).duration(280) : undefined}>
                      <View style={[s.reviewCard, Shadow.sm]}>
                        <View style={s.reviewTop}>
                          <View style={{ flex: 1 }}>
                            <Text style={s.reviewName}>{r.client_name}</Text>
                            {r.service && <Text style={s.reviewService}>{r.service}</Text>}
                          </View>
                          <View style={[s.statusBadge, { backgroundColor: (statusColor[r.status as keyof typeof statusColor] ?? Colors.muted) + "18" }]}>
                            <Text style={[s.statusBadgeText, { color: statusColor[r.status as keyof typeof statusColor] ?? Colors.muted }]}>
                              {statusLabel[r.status as keyof typeof statusLabel] ?? r.status}
                            </Text>
                          </View>
                        </View>
                        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
                          <Stars rating={r.rating} />
                          <Text style={s.reviewDate}>{fmtDateFull(r.created_at)}</Text>
                        </View>
                        {r.comment && <Text style={s.reviewComment}>{r.comment}</Text>}

                        {/* Actions */}
                        <View style={s.reviewActions}>
                          {r.status === "pending" && (
                            <>
                              <TouchableOpacity style={[s.modBtn, { borderColor: Colors.red + "50" }]}
                                onPress={() => updateStatus(r.id, "rejected")} activeOpacity={0.75}>
                                <Text style={[s.modBtnText, { color: Colors.red }]}>Rechazar</Text>
                              </TouchableOpacity>
                              <TouchableOpacity style={[s.modBtn, { backgroundColor: Colors.success, borderColor: Colors.success }]}
                                onPress={() => updateStatus(r.id, "approved")} activeOpacity={0.75}>
                                <Text style={[s.modBtnText, { color: "white" }]}>Aprobar</Text>
                              </TouchableOpacity>
                            </>
                          )}
                          {r.status === "approved" && (
                            <TouchableOpacity style={[s.modBtn, { borderColor: Colors.red + "50" }]}
                              onPress={() => updateStatus(r.id, "rejected")} activeOpacity={0.75}>
                              <Text style={[s.modBtnText, { color: Colors.red }]}>Retirar</Text>
                            </TouchableOpacity>
                          )}
                          {r.status === "rejected" && (
                            <TouchableOpacity style={[s.modBtn, { backgroundColor: Colors.success, borderColor: Colors.success }]}
                              onPress={() => updateStatus(r.id, "approved")} activeOpacity={0.75}>
                              <Text style={[s.modBtnText, { color: "white" }]}>Aprobar</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                    </Animated.View>
                  ))
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
                    <TouchableOpacity style={s.copyBtn}
                      onPress={() => { Clipboard.setString(publicLink); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                      activeOpacity={0.8}>
                      <Ionicons name={copied ? "checkmark" : "copy-outline"} size={16} color={copied ? Colors.success : Colors.muted} />
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity style={s.openLink} onPress={() => Linking.openURL(publicLink)} activeOpacity={0.75}>
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
                      onValueChange={setShowOnBooking}
                      trackColor={{ false: Colors.border, true: Colors.success + "aa" }}
                      thumbColor={showOnBooking ? Colors.success : Colors.subtle}
                    />
                  </View>
                  <TouchableOpacity style={s.saveConfigBtn} onPress={saveConfig} disabled={savingConfig} activeOpacity={0.85}>
                    <View style={[s.saveConfigInner, { backgroundColor: configSaved ? Colors.success : Colors.red }]}>
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

const s = StyleSheet.create({
  header:       { paddingTop: 16, paddingHorizontal: 24, paddingBottom: 20 },
  headerRow:    { flexDirection: "row", alignItems: "center", gap: 12 },
  backBtn:      { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,.18)", alignItems: "center", justifyContent: "center" },
  headerTitle:  { fontSize: 20, fontFamily: "SpaceGrotesk_700Bold", color: "white", letterSpacing: -0.3 },
  headerSub:    { fontSize: 12, color: "rgba(255,255,255,.75)", fontFamily: "SpaceGrotesk_400Regular", marginTop: 2 },
  pendingBadge: { minWidth: 24, height: 24, borderRadius: 12, backgroundColor: "#f59e0b", alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  pendingBadgeText:{ fontSize: 12, fontFamily: "SpaceGrotesk_700Bold", color: "white" },

  tabBar:       { flexDirection: "row", backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border },
  tabBtn:       { flex: 1, paddingVertical: 13, alignItems: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabBtnActive: { borderBottomColor: Colors.red },
  tabLabel:     { fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted },
  tabLabelActive:{ fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", color: Colors.red },

  kpiRow:       { flexDirection: "row", gap: 10, marginBottom: 16 },
  kpiCard:      { flex: 1, backgroundColor: Colors.white, borderRadius: Radius.lg, padding: 14, alignItems: "center", gap: 4 },
  kpiValue:     { fontSize: 26, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text },
  kpiLabel:     { fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  kpiSub:       { fontSize: 10, fontFamily: "SpaceGrotesk_400Regular", color: Colors.subtle, textAlign: "center" },

  distCard:     { backgroundColor: Colors.white, borderRadius: Radius.lg, padding: 16, marginBottom: 20 },
  distTitle:    { fontSize: 13, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text, marginBottom: 12 },
  distRow:      { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  distStar:     { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted, width: 24 },
  distBarWrap:  { flex: 1, height: 8, backgroundColor: Colors.border, borderRadius: 4, overflow: "hidden" },
  distBar:      { height: 8, backgroundColor: "#f59e0b", borderRadius: 4 },
  distCount:    { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted, width: 20, textAlign: "right" },

  sectionLabel: { fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", color: Colors.subtle, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 },

  reviewCard:   { backgroundColor: Colors.white, borderRadius: Radius.lg, padding: 16, marginBottom: 10 },
  reviewTop:    { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 },
  reviewName:   { fontSize: 14, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text },
  reviewService:{ fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, marginTop: 2 },
  reviewDate:   { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", color: Colors.subtle },
  reviewComment:{ fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, lineHeight: 18, marginTop: 8 },
  reviewActions:{ flexDirection: "row", gap: 10, marginTop: 12, justifyContent: "flex-end" },
  statusBadge:  { borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 4 },
  statusBadgeText:{ fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold" },

  modBtn:       { borderRadius: Radius.md, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 8 },
  modBtnText:   { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold" },

  filterStrip:  { backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border, maxHeight: 54 },
  filterContent:{ paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  filterChip:   { borderRadius: Radius.full, paddingHorizontal: 14, paddingVertical: 6, backgroundColor: Colors.cream2, borderWidth: 1.5, borderColor: Colors.border },
  filterChipActive:{ backgroundColor: Colors.red, borderColor: Colors.red },
  filterChipText:{ fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted },
  filterChipTextActive:{ color: "white" },

  emptyCard:    { backgroundColor: Colors.white, borderRadius: Radius.xl, padding: 48, alignItems: "center", marginTop: 20 },
  emptyTitle:   { fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text, marginBottom: 6 },
  emptySub:     { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, textAlign: "center" },

  configCard:   { backgroundColor: Colors.white, borderRadius: Radius.lg, padding: 16 },
  configCardTitle:{ fontSize: 14, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text, marginBottom: 6 },
  configCardSub:{ fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, lineHeight: 18 },
  linkRow:      { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: Colors.cream2, borderRadius: Radius.md, padding: 12 },
  linkText:     { flex: 1, fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted },
  copyBtn:      { width: 36, height: 36, borderRadius: 8, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, alignItems: "center", justifyContent: "center" },
  openLink:     { marginTop: 10 },
  openLinkText: { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.red },
  switchRow:    { flexDirection: "row", alignItems: "center", gap: 12 },
  saveConfigBtn:{ borderRadius: Radius.full, overflow: "hidden", marginTop: 16 },
  saveConfigInner:{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, backgroundColor: Colors.red },
  saveConfigText:{ fontSize: 14, fontFamily: "SpaceGrotesk_700Bold", color: "white" },

  tipBox:       { flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: "#f0f9ff", borderRadius: Radius.md, padding: 14, marginTop: 16, borderWidth: 1, borderColor: "#bae6fd" },
  tipText:      { flex: 1, fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: "#0369a1", lineHeight: 18 },
});
