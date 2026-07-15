import { useCallback, useEffect, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform, ActivityIndicator,
  Modal, Alert,
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
import { ScreenHeader } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { fmtMoneyFull, fmtTime, fmtDateFull } from "@/lib/format";

type Tab      = "caja" | "historial";
type MoveType = "ingreso" | "egreso";

type Session  = { id: string; opening_amount: number; opening_note: string | null; opened_at: string; closed_at: string | null; closing_amount: number | null; closing_note: string | null };
type Movement = { id: string; session_id: string; type: MoveType; amount: number; description: string; category: string | null; created_at: string };

const INGRESO_CATS = ["Servicio", "Producto", "Propina", "Otro"];
const EGRESO_CATS  = ["Arriendo", "Nómina", "Insumos", "Servicios públicos", "Otro"];

export default function CajaScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const { tenantId } = useAuth();
  const [tab, setTab]               = useState<Tab>("caja");

  // Session state
  const [session, setSession]       = useState<Session | null>(null);
  const [movements, setMovements]   = useState<Movement[]>([]);
  const [loading, setLoading]       = useState(true);

  // Open form
  const [openAmt, setOpenAmt]       = useState("");
  const [openNote, setOpenNote]     = useState("");
  const [opening, setOpening]       = useState(false);

  // Movement modal
  const [movModal, setMovModal]     = useState(false);
  const [movType, setMovType]       = useState<MoveType>("ingreso");
  const [movAmt, setMovAmt]         = useState("");
  const [movDesc, setMovDesc]       = useState("");
  const [movCat, setMovCat]         = useState("");
  const [movSaving, setMovSaving]   = useState(false);

  // Close modal
  const [closeModal, setCloseModal] = useState(false);
  const [closeAmt, setCloseAmt]     = useState("");
  const [closeNote, setCloseNote]   = useState("");
  const [closing, setClosing]       = useState(false);

  // History
  const [history, setHistory]       = useState<{ session: Session; ingresos: number; egresos: number }[]>([]);
  const [loadingHist, setLoadingHist] = useState(false);

  const loadSession = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    const { data: s } = await supabase.from("cash_sessions")
      .select("*").eq("tenant_id", tenantId).is("closed_at", null)
      .order("opened_at", { ascending: false }).limit(1).maybeSingle();
    setSession(s ?? null);
    if (s) {
      const { data: mv } = await supabase.from("cash_movements")
        .select("*").eq("session_id", s.id).order("created_at", { ascending: false });
      setMovements((mv ?? []) as Movement[]);
    } else {
      setMovements([]);
    }
    setLoading(false);
  }, [tenantId]);

  const loadHistory = useCallback(async () => {
    if (!tenantId) return;
    setLoadingHist(true);
    const { data: sessions } = await supabase.from("cash_sessions")
      .select("*").eq("tenant_id", tenantId).not("closed_at", "is", null)
      .order("opened_at", { ascending: false }).limit(30);
    const ss = (sessions ?? []) as Session[];
    if (ss.length > 0) {
      const ids = ss.map(s => s.id);
      const { data: mvs } = await supabase.from("cash_movements")
        .select("session_id, type, amount").in("session_id", ids);
      const allMvs = (mvs ?? []) as { session_id: string; type: MoveType; amount: number }[];
      setHistory(ss.map(s => {
        const sm = allMvs.filter(m => m.session_id === s.id);
        const ingresos = sm.filter(m => m.type === "ingreso").reduce((a, m) => a + Number(m.amount), 0);
        const egresos  = sm.filter(m => m.type === "egreso").reduce((a, m) => a + Number(m.amount), 0);
        return { session: s, ingresos, egresos };
      }));
    } else {
      setHistory([]);
    }
    setLoadingHist(false);
  }, [tenantId]);

  useEffect(() => {
    let cancelled = false;
    loadSession().then(() => { if (cancelled) return; });
    return () => { cancelled = true; };
  }, [loadSession]);
  useEffect(() => {
    if (tab !== "historial") return;
    let cancelled = false;
    loadHistory().then(() => { if (cancelled) return; });
    return () => { cancelled = true; };
  }, [tab, loadHistory]);

  const handleOpen = async () => {
    const amt = parseFloat(openAmt.replace(/\./g, "").replace(",", "."));
    if (isNaN(amt) || amt < 0) { Alert.alert("Error", "Ingresa un fondo inicial válido."); return; }
    setOpening(true);
    const { data: s } = await supabase.from("cash_sessions").insert({
      tenant_id: tenantId, opening_amount: amt, opening_note: openNote.trim() || null,
    }).select("*").single();
    if (s) { setSession(s as Session); setMovements([]); setOpenAmt(""); setOpenNote(""); }
    setOpening(false);
  };

  const handleMovement = async () => {
    const amt = parseFloat(movAmt.replace(/\./g, "").replace(",", "."));
    if (!session || isNaN(amt) || amt <= 0) { Alert.alert("Error", "Ingresa un monto válido."); return; }
    if (!movDesc.trim()) { Alert.alert("Error", "La descripción es obligatoria."); return; }
    setMovSaving(true);
    const { data: mv } = await supabase.from("cash_movements").insert({
      session_id: session.id, tenant_id: tenantId,
      type: movType, amount: amt, description: movDesc.trim(),
      category: movCat || null,
    }).select("*").single();
    if (mv) setMovements(prev => [mv as Movement, ...prev]);
    setMovAmt(""); setMovDesc(""); setMovCat("");
    setMovSaving(false);
    setMovModal(false);
  };

  const handleClose = async () => {
    if (!session) return;
    const amt = parseFloat(closeAmt.replace(/\./g, "").replace(",", "."));
    if (isNaN(amt) || amt < 0) { Alert.alert("Error", "Ingresa un monto de cierre válido."); return; }
    setClosing(true);
    await supabase.from("cash_sessions").update({
      closed_at: new Date().toISOString(), closing_amount: amt,
      closing_note: closeNote.trim() || null,
    }).eq("id", session.id);
    setSession(null); setMovements([]); setCloseAmt(""); setCloseNote("");
    setClosing(false);
    setCloseModal(false);
    Alert.alert("Caja cerrada", "La sesión fue cerrada correctamente.");
  };

  // Computed
  const ingresos = movements.filter(m => m.type === "ingreso").reduce((a, m) => a + Number(m.amount), 0);
  const egresos  = movements.filter(m => m.type === "egreso").reduce((a, m) => a + Number(m.amount), 0);
  const balance  = session ? Number(session.opening_amount) + ingresos - egresos : 0;
  const closeBalance = parseFloat(closeAmt.replace(/\./g, "").replace(",", ".")) || 0;
  const diff     = closeBalance - balance;

  const TABS: { key: Tab; label: string }[] = [
    { key: "caja",      label: "Caja" },
    { key: "historial", label: "Historial" },
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader crumb="Ventas" title="Sistema de Caja" subtitle="Control de ingresos y egresos" onBack={() => router.back()} />

      {/* Tabs */}
      <View style={[s.tabBar, { backgroundColor: t.bgAlt, borderBottomColor: t.border }]}>
        {TABS.map(tb => (
          <TouchableOpacity key={tb.key} style={[s.tabBtn, tab === tb.key && s.tabBtnActive]} onPress={() => setTab(tb.key)} activeOpacity={0.75}>
            <Text style={[s.tabLabel, { color: t.muted }, tab === tb.key && s.tabLabelActive]}>{tb.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading && tab === "caja" ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={Colors.red} size="large" />
        </View>
      ) : (
        <>
          {/* ── CAJA ── */}
          {tab === "caja" && !session && (
            <KeyboardAvoidingView style={{ flex: 1 }}>
              <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
                <Animated.View entering={FadeInDown.duration(350)}>
                  <View style={[s.closedCard, Shadow.sm, { backgroundColor: t.bgAlt }]}>
                    <View style={[s.closedIcon, { backgroundColor: t.bg }]}>
                      <Ionicons name="lock-closed-outline" size={32} color={t.muted} />
                    </View>
                    <Text style={[s.closedTitle, { color: t.text }]}>Caja cerrada</Text>
                    <Text style={[s.closedSub, { color: t.muted }]}>Abre la caja para empezar a registrar movimientos</Text>
                  </View>

                  <Text style={[s.label, { color: t.muted }]}>Fondo inicial</Text>
                  <View style={s.amountRow}>
                    <Text style={[s.currencySign, { backgroundColor: t.bgAlt, borderColor: t.border, color: t.muted }]}>$</Text>
                    <TextInput style={[s.input, { flex: 1, borderLeftWidth: 0, borderTopLeftRadius: 0, borderBottomLeftRadius: 0, backgroundColor: t.bgAlt, borderColor: t.border, color: t.text }]}
                      value={openAmt} onChangeText={setOpenAmt} placeholder="Ej: 200000"
                      placeholderTextColor={t.subtle} keyboardType="numeric" />
                  </View>

                  <Text style={[s.label, { color: t.muted }]}>Nota de apertura (opcional)</Text>
                  <TextInput style={[s.input, { backgroundColor: t.bgAlt, borderColor: t.border, color: t.text }]} value={openNote} onChangeText={setOpenNote}
                    placeholder="Ej: Turno mañana" placeholderTextColor={t.subtle} />

                  <TouchableOpacity style={s.btn} onPress={handleOpen} disabled={opening} activeOpacity={0.85}>
                    <View style={s.btnInner}>
                      {opening ? <ActivityIndicator color="white" /> : <><Ionicons name="lock-open-outline" size={16} color="white" /><Text style={s.btnText}>Abrir caja</Text></>}
                    </View>
                  </TouchableOpacity>
                </Animated.View>
              </ScrollView>
            </KeyboardAvoidingView>
          )}

          {tab === "caja" && session && (
            <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
              {/* Status banner */}
              <View style={[s.statusBanner, Shadow.sm]}>
                <View style={s.statusDot} />
                <Text style={s.statusText}>
                  Caja abierta desde las {fmtTime(session.opened_at)}
                  {session.opening_note ? ` · ${session.opening_note}` : ""}
                </Text>
              </View>

              {/* Metrics */}
              <View style={s.metricsGrid}>
                <View style={[s.metricCard, Shadow.sm, { backgroundColor: t.bgAlt }]}>
                  <Text style={[s.metricLabel, { color: t.muted }]}>Fondo inicial</Text>
                  <Text style={[s.metricValue, { color: t.text }]}>{fmtMoneyFull(Number(session.opening_amount))}</Text>
                </View>
                <View style={[s.metricCard, Shadow.sm, { backgroundColor: t.bgAlt }]}>
                  <Text style={[s.metricLabel, { color: t.muted }]}>Ingresos</Text>
                  <Text style={[s.metricValue, { color: Colors.success }]}>{fmtMoneyFull(ingresos)}</Text>
                </View>
                <View style={[s.metricCard, Shadow.sm, { backgroundColor: t.bgAlt }]}>
                  <Text style={[s.metricLabel, { color: t.muted }]}>Egresos</Text>
                  <Text style={[s.metricValue, { color: Colors.red }]}>{fmtMoneyFull(egresos)}</Text>
                </View>
                <View style={[s.metricCard, Shadow.sm, { backgroundColor: t.bgAlt }]}>
                  <Text style={[s.metricLabel, { color: t.muted }]}>Balance</Text>
                  <Text style={[s.metricValue, { color: Colors.purple }]}>{fmtMoneyFull(balance)}</Text>
                </View>
              </View>

              {/* Actions */}
              <View style={{ flexDirection: "row", gap: 10, marginBottom: 20 }}>
                <TouchableOpacity style={[s.actionBtn, { flex: 2, backgroundColor: Colors.success }]}
                  onPress={() => { setMovType("ingreso"); setMovModal(true); }} activeOpacity={0.8}>
                  <Ionicons name="add-circle-outline" size={16} color="white" />
                  <Text style={s.actionBtnText}>Registrar movimiento</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.actionBtn, { flex: 1, backgroundColor: t.bgAlt, borderWidth: 1.5, borderColor: Colors.red }]}
                  onPress={() => setCloseModal(true)} activeOpacity={0.8}>
                  <Text style={[s.actionBtnText, { color: Colors.red }]}>Cerrar caja</Text>
                </TouchableOpacity>
              </View>

              {/* Movements list */}
              <View style={[s.movList, Shadow.sm, { backgroundColor: t.bgAlt }]}>
                <View style={[s.movListHeader, { borderBottomColor: t.border }]}>
                  <Text style={[s.movListTitle, { color: t.text }]}>Movimientos del día</Text>
                  <Text style={[s.movListCount, { color: t.muted }]}>{movements.length}</Text>
                </View>
                {movements.length === 0 ? (
                  <View style={{ padding: 24, alignItems: "center" }}>
                    <Text style={[s.emptyText, { color: t.subtle }]}>Sin movimientos aún</Text>
                  </View>
                ) : (
                  movements.map((m, i) => (
                    <Animated.View key={m.id} entering={i < 10 ? FadeInDown.delay(i * 30).duration(250) : undefined}>
                      <View style={[s.movRow, i > 0 && s.movRowBorder, i > 0 && { borderTopColor: t.border }]}>
                        <View style={[s.movBadge, { backgroundColor: m.type === "ingreso" ? Colors.success + "18" : Colors.red + "18" }]}>
                          <Text style={[s.movBadgeText, { color: m.type === "ingreso" ? Colors.success : Colors.red }]}>
                            {m.type === "ingreso" ? "+" : "−"}
                          </Text>
                        </View>
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={[s.movDesc, { color: t.text }]}>{m.description}</Text>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                            {m.category && (
                              <View style={[s.movCatBadge, { backgroundColor: t.bg }]}>
                                <Text style={[s.movCatText, { color: t.muted }]}>{m.category}</Text>
                              </View>
                            )}
                            <Text style={[s.movTime, { color: t.subtle }]}>{fmtTime(m.created_at)}</Text>
                          </View>
                        </View>
                        <Text style={[s.movAmt, { color: m.type === "ingreso" ? Colors.success : Colors.red }]}>
                          {m.type === "ingreso" ? "+" : "−"}{fmtMoneyFull(Number(m.amount))}
                        </Text>
                      </View>
                    </Animated.View>
                  ))
                )}
              </View>
            </ScrollView>
          )}

          {/* ── HISTORIAL ── */}
          {tab === "historial" && (
            <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
              {loadingHist ? (
                <ActivityIndicator color={Colors.red} style={{ marginTop: 40 }} />
              ) : history.length === 0 ? (
                <Animated.View entering={FadeInDown.duration(350)} style={[s.emptyCard, Shadow.sm, { backgroundColor: t.bgAlt }]}>
                  <Ionicons name="time-outline" size={40} color={t.subtle} style={{ marginBottom: 12 }} />
                  <Text style={[s.emptyTitle, { color: t.text }]}>Sin sesiones cerradas aún</Text>
                </Animated.View>
              ) : (
                history.map((h, i) => {
                  const bal = Number(h.session.opening_amount) + h.ingresos - h.egresos;
                  return (
                    <Animated.View key={h.session.id} entering={i < 10 ? FadeInDown.delay(i * 40).duration(280) : undefined}>
                      <View style={[s.histCard, Shadow.sm, { backgroundColor: t.bgAlt }]}>
                        <View style={s.histCardTop}>
                          <View>
                            <Text style={[s.histDate, { color: t.text }]}>{fmtDateFull(h.session.opened_at)}</Text>
                            <Text style={[s.histTime, { color: t.muted }]}>
                              {fmtTime(h.session.opened_at)} → {h.session.closed_at ? fmtTime(h.session.closed_at) : "—"}
                              {h.session.opening_note ? `  ·  ${h.session.opening_note}` : ""}
                            </Text>
                          </View>
                        </View>
                        <View style={s.histMetrics}>
                          <View style={s.histMetric}>
                            <Text style={[s.histMetricLabel, { color: t.muted }]}>Fondo</Text>
                            <Text style={[s.histMetricValue, { color: t.text }]}>{fmtMoneyFull(Number(h.session.opening_amount))}</Text>
                          </View>
                          <View style={s.histMetric}>
                            <Text style={[s.histMetricLabel, { color: t.muted }]}>Ingresos</Text>
                            <Text style={[s.histMetricValue, { color: Colors.success }]}>{fmtMoneyFull(h.ingresos)}</Text>
                          </View>
                          <View style={s.histMetric}>
                            <Text style={[s.histMetricLabel, { color: t.muted }]}>Egresos</Text>
                            <Text style={[s.histMetricValue, { color: Colors.red }]}>{fmtMoneyFull(h.egresos)}</Text>
                          </View>
                          <View style={s.histMetric}>
                            <Text style={[s.histMetricLabel, { color: t.muted }]}>Balance</Text>
                            <Text style={[s.histMetricValue, { color: Colors.purple }]}>{fmtMoneyFull(bal)}</Text>
                          </View>
                        </View>
                      </View>
                    </Animated.View>
                  );
                })
              )}
            </ScrollView>
          )}
        </>
      )}

      {/* ── MOVEMENT MODAL ── */}
      <Modal visible={movModal} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setMovModal(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
          <KeyboardAvoidingView style={{ flex: 1 }}>
            <View style={[s.modalHeader, { borderBottomColor: t.border }]}>
              <Text style={[s.modalTitle, { color: t.text }]}>Registrar movimiento</Text>
              <TouchableOpacity onPress={() => setMovModal(false)}>
                <Ionicons name="close" size={22} color={t.text} />
              </TouchableOpacity>
            </View>

            <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
              {/* Type toggle */}
              <View style={[s.typeToggle, { backgroundColor: t.bg }]}>
                {(["ingreso", "egreso"] as MoveType[]).map(mt => (
                  <TouchableOpacity key={mt} style={[s.typeBtn, movType === mt && { backgroundColor: mt === "ingreso" ? Colors.success : Colors.red }]}
                    onPress={() => { setMovType(mt); setMovCat(""); }} activeOpacity={0.8}>
                    <Text style={[s.typeBtnText, { color: t.muted }, movType === mt && { color: "white" }]}>
                      {mt === "ingreso" ? "Ingreso" : "Egreso"}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={[s.label, { color: t.muted }]}>Monto *</Text>
              <View style={s.amountRow}>
                <Text style={[s.currencySign, { backgroundColor: t.bgAlt, borderColor: t.border, color: t.muted }]}>$</Text>
                <TextInput style={[s.input, { flex: 1, borderLeftWidth: 0, borderTopLeftRadius: 0, borderBottomLeftRadius: 0, backgroundColor: t.bgAlt, borderColor: t.border, color: t.text }]}
                  value={movAmt} onChangeText={setMovAmt} placeholder="50000"
                  placeholderTextColor={t.subtle} keyboardType="numeric" />
              </View>

              <Text style={[s.label, { color: t.muted }]}>Descripción *</Text>
              <TextInput style={[s.input, { backgroundColor: t.bgAlt, borderColor: t.border, color: t.text }]} value={movDesc} onChangeText={setMovDesc}
                placeholder={movType === "ingreso" ? "Ej: Corte de cabello" : "Ej: Pago de arriendo"}
                placeholderTextColor={t.subtle} />

              <Text style={[s.label, { color: t.muted }]}>Categoría (opcional)</Text>
              <ScrollView automaticallyAdjustKeyboardInsets horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {(movType === "ingreso" ? INGRESO_CATS : EGRESO_CATS).map(cat => (
                    <TouchableOpacity key={cat}
                      style={[s.catChip, { backgroundColor: t.bgAlt, borderColor: t.border }, movCat === cat && { backgroundColor: Colors.purple, borderColor: Colors.purple }]}
                      onPress={() => setMovCat(movCat === cat ? "" : cat)} activeOpacity={0.75}>
                      <Text style={[s.catChipText, { color: t.muted }, movCat === cat && { color: "white" }]}>{cat}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              <TouchableOpacity
                style={[s.btn, { marginTop: 24 }, (!movAmt || !movDesc.trim() || movSaving) && { opacity: 0.4 }]}
                onPress={handleMovement} disabled={!movAmt || !movDesc.trim() || movSaving} activeOpacity={0.85}>
                <View style={[s.btnInner, { backgroundColor: movType === "ingreso" ? Colors.success : Colors.red }]}>
                  {movSaving ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>Registrar {movType}</Text>}
                </View>
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* ── CLOSE MODAL ── */}
      <Modal visible={closeModal} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setCloseModal(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
          <KeyboardAvoidingView style={{ flex: 1 }}>
            <View style={[s.modalHeader, { borderBottomColor: t.border }]}>
              <Text style={[s.modalTitle, { color: t.text }]}>Cerrar caja</Text>
              <TouchableOpacity onPress={() => setCloseModal(false)}>
                <Ionicons name="close" size={22} color={t.text} />
              </TouchableOpacity>
            </View>

            <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
              {/* Summary */}
              <View style={[s.summaryBox, Shadow.sm, { backgroundColor: t.bgAlt }]}>
                {[
                  { label: "Fondo inicial",   value: fmtMoneyFull(session ? Number(session.opening_amount) : 0), color: Colors.text },
                  { label: "Total ingresos",   value: fmtMoneyFull(ingresos), color: Colors.success },
                  { label: "Total egresos",    value: fmtMoneyFull(egresos),  color: Colors.red },
                ].map(r => (
                  <View key={r.label} style={s.summaryRow}>
                    <Text style={[s.summaryLabel, { color: t.muted }]}>{r.label}</Text>
                    <Text style={[s.summaryValue, { color: r.color }]}>{r.value}</Text>
                  </View>
                ))}
                <View style={[s.summaryDivider, { backgroundColor: t.border }]} />
                <View style={s.summaryRow}>
                  <Text style={[s.summaryLabel, { fontFamily: "SpaceGrotesk_700Bold", color: t.text }]}>Balance esperado</Text>
                  <Text style={[s.summaryValue, { color: Colors.purple, fontFamily: "SpaceGrotesk_700Bold" }]}>{fmtMoneyFull(balance)}</Text>
                </View>
              </View>

              <Text style={[s.label, { color: t.muted }]}>Efectivo contado *</Text>
              <View style={s.amountRow}>
                <Text style={[s.currencySign, { backgroundColor: t.bgAlt, borderColor: t.border, color: t.muted }]}>$</Text>
                <TextInput style={[s.input, { flex: 1, borderLeftWidth: 0, borderTopLeftRadius: 0, borderBottomLeftRadius: 0, backgroundColor: t.bgAlt, borderColor: t.border, color: t.text }]}
                  value={closeAmt} onChangeText={setCloseAmt}
                  placeholder="Lo que hay físicamente en caja"
                  placeholderTextColor={t.subtle} keyboardType="numeric" />
              </View>

              {closeAmt.length > 0 && (
                <View style={[s.diffBox, { backgroundColor: diff >= 0 ? Colors.success + "14" : Colors.red + "14" }]}>
                  <Text style={[s.diffLabel, { color: t.text }]}>Diferencia</Text>
                  <Text style={[s.diffValue, { color: diff >= 0 ? Colors.success : Colors.red }]}>
                    {diff >= 0 ? "+" : ""}{fmtMoneyFull(diff)}  ({diff >= 0 ? "sobrante" : "faltante"})
                  </Text>
                </View>
              )}

              <Text style={[s.label, { color: t.muted }]}>Nota de cierre (opcional)</Text>
              <TextInput style={[s.input, { backgroundColor: t.bgAlt, borderColor: t.border, color: t.text }]} value={closeNote} onChangeText={setCloseNote}
                placeholder="Ej: Turno tarde" placeholderTextColor={t.subtle} />

              <TouchableOpacity
                style={[s.btn, { marginTop: 24 }, (!closeAmt || closing) && { opacity: 0.4 }]}
                onPress={handleClose} disabled={!closeAmt || closing} activeOpacity={0.85}>
                <View style={s.btnInner}>
                  {closing ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>Confirmar cierre</Text>}
                </View>
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header:       { paddingTop: 16, paddingHorizontal: 24, paddingBottom: 20 },
  headerRow:    { flexDirection: "row", alignItems: "center", gap: 12 },
  backBtn:      { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,.18)", alignItems: "center", justifyContent: "center" },
  headerTitle:  { fontSize: 20, fontFamily: "SpaceGrotesk_700Bold", color: "white", letterSpacing: -0.3 },
  headerSub:    { fontSize: 12, color: "rgba(255,255,255,.75)", fontFamily: "SpaceGrotesk_400Regular", marginTop: 2 },

  tabBar:       { flexDirection: "row", backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border },
  tabBtn:       { flex: 1, paddingVertical: 13, alignItems: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabBtnActive: { borderBottomColor: Colors.red },
  tabLabel:     { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted },
  tabLabelActive:{ fontSize: 13, fontFamily: "SpaceGrotesk_700Bold", color: Colors.red },

  label:        { fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", color: Colors.muted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8, marginTop: 18 },
  input:        { backgroundColor: Colors.white, borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, fontFamily: "SpaceGrotesk_400Regular", color: Colors.text },
  amountRow:    { flexDirection: "row", alignItems: "center" },
  currencySign: { backgroundColor: Colors.white, borderWidth: 1.5, borderColor: Colors.border, borderTopLeftRadius: Radius.md, borderBottomLeftRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: Colors.muted, borderRightWidth: 0 },

  closedCard:   { backgroundColor: Colors.white, borderRadius: Radius.xl, padding: 32, alignItems: "center", marginBottom: 8 },
  closedIcon:   { width: 64, height: 64, borderRadius: 32, backgroundColor: Colors.cream2, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  closedTitle:  { fontSize: 18, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text, marginBottom: 6 },
  closedSub:    { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, textAlign: "center" },

  statusBanner: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: Colors.success + "14", borderRadius: Radius.md, padding: 14, marginBottom: 16 },
  statusDot:    { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.success },
  statusText:   { flex: 1, fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.success },

  metricsGrid:  { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 },
  metricCard:   { width: "47.5%", backgroundColor: Colors.white, borderRadius: Radius.lg, padding: 14 },
  metricLabel:  { fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted, marginBottom: 6 },
  metricValue:  { fontSize: 18, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text },

  actionBtn:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: Radius.md, paddingVertical: 14 },
  actionBtnText:{ fontSize: 13, fontFamily: "SpaceGrotesk_700Bold", color: "white" },

  movList:      { backgroundColor: Colors.white, borderRadius: Radius.lg, overflow: "hidden" },
  movListHeader:{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 1, borderBottomColor: Colors.border },
  movListTitle: { fontSize: 14, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text },
  movListCount: { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted },
  movRow:       { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  movRowBorder: { borderTopWidth: 1, borderTopColor: Colors.border },
  movBadge:     { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  movBadgeText: { fontSize: 18, fontFamily: "SpaceGrotesk_700Bold" },
  movDesc:      { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  movCatBadge:  { backgroundColor: Colors.cream2, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  movCatText:   { fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted },
  movTime:      { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", color: Colors.subtle },
  movAmt:       { fontSize: 14, fontFamily: "SpaceGrotesk_700Bold" },

  histCard:     { backgroundColor: Colors.white, borderRadius: Radius.lg, padding: 16, marginBottom: 10 },
  histCardTop:  { marginBottom: 12 },
  histDate:     { fontSize: 14, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text },
  histTime:     { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, marginTop: 2 },
  histMetrics:  { flexDirection: "row", justifyContent: "space-between" },
  histMetric:   { alignItems: "center" },
  histMetricLabel:{ fontSize: 10, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted, marginBottom: 4 },
  histMetricValue:{ fontSize: 13, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text },

  emptyCard:    { backgroundColor: Colors.white, borderRadius: Radius.xl, padding: 48, alignItems: "center", marginTop: 20 },
  emptyTitle:   { fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text },
  emptyText:    { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: Colors.subtle },

  btn:          { borderRadius: Radius.full, overflow: "hidden", marginTop: 24 },
  btnInner:     { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 16, backgroundColor: Colors.red },
  btnText:      { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: "white" },

  // Modals
  modalHeader:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 20, borderBottomWidth: 1, borderBottomColor: Colors.border },
  modalTitle:   { fontSize: 17, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text },
  typeToggle:   { flexDirection: "row", backgroundColor: Colors.cream2, borderRadius: Radius.md, padding: 4, marginTop: 4 },
  typeBtn:      { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: Radius.md - 2 },
  typeBtnText:  { fontSize: 13, fontFamily: "SpaceGrotesk_700Bold", color: Colors.muted },
  catChip:      { borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.border, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: Colors.white },
  catChipText:  { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted },
  summaryBox:   { backgroundColor: Colors.white, borderRadius: Radius.lg, padding: 16, marginBottom: 4 },
  summaryRow:   { flexDirection: "row", justifyContent: "space-between", paddingVertical: 10 },
  summaryLabel: { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted },
  summaryValue: { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold" },
  summaryDivider:{ height: 1, backgroundColor: Colors.border },
  diffBox:      { borderRadius: Radius.md, padding: 14, marginTop: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  diffLabel:    { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  diffValue:    { fontSize: 14, fontFamily: "SpaceGrotesk_700Bold" },
});
