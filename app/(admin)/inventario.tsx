import { useState, useCallback, useEffect } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Modal, Alert, KeyboardAvoidingView, Platform,
  ActivityIndicator,
} from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Fonts, Gradients, MonoLabel, Radius, Shadow } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { supabase } from "@/lib/supabase";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Product {
  id: string;
  sku: string;
  name: string;
  description: string;
  cost_price: number;
  sale_price: number;
  discount_type: "percent" | "fixed" | null;
  discount_value: number;
  stock_quantity: number;
  low_stock_alert: number;
  is_active: boolean;
}

interface Movement {
  id: string;
  product_id: string;
  type: "purchase" | "sale" | "adjustment" | "return" | "courtesy";
  quantity: number;
  notes: string | null;
  created_at: string;
  products?: { name: string; sku: string };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n);
}

function effectivePrice(p: Product): number {
  if (!p.discount_value) return p.sale_price;
  if (p.discount_type === "percent") return p.sale_price * (1 - p.discount_value / 100);
  if (p.discount_type === "fixed")   return Math.max(0, p.sale_price - p.discount_value);
  return p.sale_price;
}

function genSku() {
  return "SKU-" + Math.random().toString(36).toUpperCase().slice(2, 7);
}

const MOVE_META: Record<string, { label: string; color: string; icon: any }> = {
  purchase:   { label: "Compra",     color: "#10b981", icon: "arrow-down-outline"    },
  sale:       { label: "Venta",      color: "#6366f1", icon: "cart-outline"          },
  adjustment: { label: "Ajuste",     color: "#f59e0b", icon: "options-outline"       },
  return:     { label: "Devolución", color: "#8E879B", icon: "return-up-back-outline"},
  courtesy:   { label: "Cortesía",   color: "#ec4899", icon: "gift-outline"          },
};

// ── Main ──────────────────────────────────────────────────────────────────────

export default function InventarioScreen() {
  const router = useRouter();
  const { t, mode } = useTheme();

  const [tab, setTab]           = useState<"productos" | "movimientos">("productos");
  const [products, setProducts]  = useState<Product[]>([]);
  const [movements, setMovements]= useState<Movement[]>([]);
  const [search, setSearch]      = useState("");
  const [tenantId, setTenantId]  = useState<string | null>(null);
  const [loading, setLoading]    = useState(true);

  const [showModal, setShowModal]   = useState(false);
  const [editing, setEditing]       = useState<Product | null>(null);
  const [form, setForm]             = useState<Partial<Product>>({});

  const [showAdjust, setShowAdjust]       = useState(false);
  const [adjustTarget, setAdjustTarget]   = useState<Product | null>(null);
  const [adjustQty, setAdjustQty]         = useState("");
  const [adjustType, setAdjustType]       = useState<"purchase" | "adjustment" | "return" | "courtesy">("purchase");
  const [adjustNotes, setAdjustNotes]     = useState("");

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const { data } = await supabase.from("tenants").select("id").eq("owner_id", user.id).single();
      if (data?.id) setTenantId(data.id);
      else          setLoading(false);
    })();
  }, []);

  const loadData = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    const [prodRes, movRes] = await Promise.all([
      supabase
        .from("products")
        .select("id, sku, name, description, cost_price, sale_price, discount_type, discount_value, stock_quantity, low_stock_alert, is_active")
        .eq("tenant_id", tenantId).eq("is_active", true).order("name"),
      supabase
        .from("inventory_movements")
        .select("id, product_id, type, quantity, notes, created_at, products(name, sku)")
        .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(100),
    ]);
    if (prodRes.data) setProducts(prodRes.data as Product[]);
    if (movRes.data)  setMovements(movRes.data as unknown as Movement[]);
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { if (tenantId) loadData(); }, [tenantId, loadData]);

  const totalValue = products.reduce((s, p) => s + p.stock_quantity * p.cost_price, 0);
  const lowStock   = products.filter(p => p.stock_quantity > 0 && p.stock_quantity <= p.low_stock_alert).length;
  const outStock   = products.filter(p => p.stock_quantity === 0).length;

  const filtered = search
    ? products.filter(p =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.sku.toLowerCase().includes(search.toLowerCase()))
    : products;

  const openCreate = () => {
    setEditing(null);
    setForm({ sku: genSku(), name: "", description: "", cost_price: 0, sale_price: 0, discount_type: null, discount_value: 0, stock_quantity: 0, low_stock_alert: 5, is_active: true });
    setShowModal(true);
  };

  const openEdit = (p: Product) => { setEditing(p); setForm({ ...p }); setShowModal(true); };

  const handleSave = async () => {
    if (!form.name?.trim()) { Alert.alert("Requerido", "El nombre del producto es obligatorio"); return; }
    if (!tenantId) return;

    if (editing) {
      const { error } = await supabase.from("products").update({
        sku: form.sku, name: form.name, description: form.description ?? "",
        cost_price: form.cost_price ?? 0, sale_price: form.sale_price ?? 0,
        discount_type: form.discount_type ?? null, discount_value: form.discount_value ?? 0,
        low_stock_alert: form.low_stock_alert ?? 5,
      }).eq("id", editing.id).eq("tenant_id", tenantId);
      if (error) { Alert.alert("Error", error.message); return; }
    } else {
      const initialStock = form.stock_quantity ?? 0;
      const { data: newProd, error } = await supabase.from("products").insert({
        tenant_id: tenantId, sku: form.sku ?? genSku(), name: form.name,
        description: form.description ?? "", cost_price: form.cost_price ?? 0,
        sale_price: form.sale_price ?? 0, discount_type: form.discount_type ?? null,
        discount_value: form.discount_value ?? 0, stock_quantity: initialStock,
        low_stock_alert: form.low_stock_alert ?? 5, is_active: true,
      }).select("id").single();
      if (error) { Alert.alert("Error", error.message); return; }
      if (newProd && initialStock > 0) {
        await supabase.from("inventory_movements").insert({
          tenant_id: tenantId, product_id: newProd.id,
          type: "purchase", quantity: initialStock, notes: "Stock inicial",
        });
      }
    }
    setShowModal(false);
    await loadData();
  };

  const handleDelete = (id: string) => {
    Alert.alert("Eliminar producto", "¿Eliminar este producto del inventario?", [
      { text: "Cancelar", style: "cancel" },
      { text: "Eliminar", style: "destructive", onPress: async () => {
        const { error } = await supabase.from("products").update({ is_active: false }).eq("id", id).eq("tenant_id", tenantId!);
        if (error) { Alert.alert("Error", error.message); return; }
        await loadData();
      }},
    ]);
  };

  const handleAdjust = async () => {
    if (!adjustTarget || !adjustQty || !tenantId) return;
    const qty = parseInt(adjustQty) || 0;
    // Salidas (restan stock): cortesía siempre resta; ajuste resta si el usuario escribió "-".
    const isNegative = adjustType === "courtesy" || (adjustType === "adjustment" && adjustQty.startsWith("-"));
    const actualDelta = isNegative ? -Math.abs(qty) : Math.abs(qty);
    const newStock = Math.max(0, adjustTarget.stock_quantity + actualDelta);

    const { error: movErr } = await supabase.from("inventory_movements").insert({
      tenant_id: tenantId, product_id: adjustTarget.id,
      type: adjustType, quantity: actualDelta, notes: adjustNotes || null,
    });
    if (movErr) { Alert.alert("Error", movErr.message); return; }

    const { error: prodErr } = await supabase.from("products")
      .update({ stock_quantity: newStock }).eq("id", adjustTarget.id).eq("tenant_id", tenantId);
    if (prodErr) { Alert.alert("Error", prodErr.message); return; }

    setShowAdjust(false); setAdjustQty(""); setAdjustNotes("");
    await loadData();
  };

  const openAdjust = (p: Product) => {
    setAdjustTarget(p); setAdjustQty(""); setAdjustNotes(""); setAdjustType("purchase"); setShowAdjust(true);
  };

  const StockBadge = ({ p }: { p: Product }) => {
    const isOut = p.stock_quantity === 0;
    const isLow = p.stock_quantity > 0 && p.stock_quantity <= p.low_stock_alert;
    const color = isOut ? "#ef4444" : isLow ? "#d97706" : "#059669";
    const bg    = isOut ? "rgba(239,68,68,0.12)" : isLow ? "rgba(245,158,11,0.12)" : "rgba(16,185,129,0.10)";
    return (
      <View style={[s.badge, { backgroundColor: bg }]}>
        <View style={[s.badgeDot, { backgroundColor: color }]} />
        <Text style={[s.badgeText, { color }]}>{isOut ? "Sin stock" : `${p.stock_quantity} uds`}</Text>
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg, alignItems: "center", justifyContent: "center" }} edges={["top"]}>
        <ActivityIndicator size="large" color={Colors.red} />
        <Text style={{ marginTop: 12, fontSize: 13, fontFamily: Fonts.regular, color: t.subtle }}>Cargando inventario…</Text>
      </SafeAreaView>
    );
  }

  // ── Shared input style (needs theme at render time) ────────────────────────
  const inputStyle = [s.inputBase, { backgroundColor: t.inputBg, borderColor: t.inputBorder, color: t.text }];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={["top"]}>

      {/* Header */}
      <LinearGradient colors={Gradients.ink} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.header}>
        <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3 }} />
        <View style={s.headerBlob1} />
        <View style={s.headerBlob2} />
        <View style={s.headerTopRow}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={20} color="white" />
          </TouchableOpacity>
          <View style={s.headerIconBox}>
            <Ionicons name="cube-outline" size={15} color="white" />
          </View>
          <Text style={s.headerLabel}>CONTROL DE STOCK</Text>
          <TouchableOpacity style={s.addBtn} onPress={openCreate} activeOpacity={0.8}>
            <Ionicons name="add" size={16} color="white" />
            <Text style={s.addBtnText}>Nuevo</Text>
          </TouchableOpacity>
        </View>
        <Text style={s.headerTitle}>Inventario</Text>
      </LinearGradient>

      {/* Stats strip */}
      <Animated.View entering={FadeInDown.duration(300)}>
        <View style={[s.statsStrip, { backgroundColor: t.bgAlt, borderBottomColor: t.border }]}>
          {[
            { label: "Productos",  value: String(products.length), color: t.text                                    },
            { label: "Valor",      value: fmt(totalValue),         color: t.text                                    },
            { label: "Bajo stock", value: String(lowStock),        color: lowStock > 0 ? "#d97706" : "#10b981"      },
            { label: "Sin stock",  value: String(outStock),        color: outStock > 0 ? "#ef4444" : "#10b981"      },
          ].map((stat, i) => (
            <View key={i} style={[s.statItem, i > 0 && { borderLeftWidth: 1, borderColor: t.border }]}>
              <Text style={[s.statLabel, { color: t.subtle }]}>{stat.label}</Text>
              <Text style={[s.statValue, { color: stat.color }]}>{stat.value}</Text>
            </View>
          ))}
        </View>
      </Animated.View>

      {/* Search + tab pills */}
      <Animated.View entering={FadeInDown.delay(50).duration(300)}>
        <View style={s.controls}>
          {tab === "productos" && (
            <View style={[s.searchBox, { backgroundColor: t.bgAlt, borderColor: t.border }]}>
              <Ionicons name="search-outline" size={16} color={t.subtle} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Buscar producto o SKU..."
                placeholderTextColor={t.subtle}
                style={[s.searchInput, { color: t.text }]}
              />
              {search.length > 0 && (
                <TouchableOpacity onPress={() => setSearch("")}>
                  <Ionicons name="close-circle" size={16} color={t.subtle} />
                </TouchableOpacity>
              )}
            </View>
          )}
          <View style={[s.tabPills, { backgroundColor: t.border }]}>
            {(["productos", "movimientos"] as const).map(tb => (
              <TouchableOpacity
                key={tb}
                style={[s.tabPill, tab === tb && { backgroundColor: mode === "dark" ? Colors.red : Colors.ink }]}
                onPress={() => setTab(tb)}
                activeOpacity={0.7}
              >
                <Text style={[s.tabPillText, { color: tab === tb ? Colors.white : t.muted }]}>
                  {tb === "productos" ? "Productos" : "Movimientos"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Animated.View>

      {/* Tab content */}
      {tab === "productos" ? (
        <ScrollView contentContainerStyle={s.listContent} showsVerticalScrollIndicator={false}>
          {filtered.length === 0 ? (
            <Animated.View entering={FadeInDown.delay(80).duration(300)}>
              <View style={[s.emptyState, { backgroundColor: t.bgAlt, borderColor: t.border }]}>
                <View style={[s.emptyIcon, { backgroundColor: Colors.red + "12" }]}>
                  <Ionicons name="cube-outline" size={28} color={Colors.red} />
                </View>
                <Text style={[s.emptyTitle, { color: t.text }]}>{search ? "Sin resultados" : "Sin productos"}</Text>
                <Text style={[s.emptySub, { color: t.muted }]}>
                  {search ? `No hay productos con "${search}"` : "Agrega tu primer producto para llevar el control del inventario."}
                </Text>
                {!search && (
                  <TouchableOpacity onPress={openCreate} activeOpacity={0.85}>
                    <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.emptyBtn}>
                      <Text style={s.emptyBtnText}>+ Crear primer producto</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                )}
              </View>
            </Animated.View>
          ) : (
            <Animated.View entering={FadeInDown.delay(80).duration(300)}>
              <View style={[s.card, { backgroundColor: t.bgAlt, borderColor: t.border }]}>
                {filtered.map((p, i) => (
                  <View key={p.id} style={[s.productRow, i < filtered.length - 1 && { borderBottomWidth: 1, borderColor: t.border }]}>
                    <View style={[s.productPhoto, { backgroundColor: t.bg }]}>
                      <Ionicons name="cube-outline" size={20} color={t.subtle} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.productName, { color: t.text }]}>{p.name}</Text>
                      <Text style={[s.productSku, { color: t.subtle }]}>{p.sku}</Text>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 }}>
                        <StockBadge p={p} />
                        <Text style={[s.productPrice, { color: t.text }]}>{fmt(effectivePrice(p))}</Text>
                        {p.discount_value > 0 && (
                          <Text style={s.productDiscount}>
                            −{p.discount_type === "percent" ? `${p.discount_value}%` : fmt(p.discount_value)}
                          </Text>
                        )}
                      </View>
                    </View>
                    <View style={s.productActions}>
                      <TouchableOpacity style={s.actionBtn} onPress={() => openAdjust(p)} activeOpacity={0.7}>
                        <Ionicons name="add-circle-outline" size={18} color={t.muted} />
                      </TouchableOpacity>
                      <TouchableOpacity style={s.actionBtn} onPress={() => openEdit(p)} activeOpacity={0.7}>
                        <Ionicons name="create-outline" size={18} color={t.muted} />
                      </TouchableOpacity>
                      <TouchableOpacity style={s.actionBtn} onPress={() => handleDelete(p.id)} activeOpacity={0.7}>
                        <Ionicons name="trash-outline" size={18} color="#ef4444" />
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            </Animated.View>
          )}
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={s.listContent} showsVerticalScrollIndicator={false}>
          <Animated.View entering={FadeInDown.delay(80).duration(300)}>
            <View style={[s.card, { backgroundColor: t.bgAlt, borderColor: t.border }]}>
              {movements.length === 0 ? (
                <Text style={[s.emptySub, { color: t.muted, textAlign: "center", paddingVertical: 20 }]}>Sin movimientos registrados.</Text>
              ) : movements.map((m, i) => {
                const meta = MOVE_META[m.type] ?? MOVE_META.adjustment;
                return (
                  <View key={m.id} style={[s.moveRow, i < movements.length - 1 && { borderBottomWidth: 1, borderColor: t.border }]}>
                    <View style={[s.moveIcon, { backgroundColor: meta.color + "18" }]}>
                      <Ionicons name={meta.icon} size={16} color={meta.color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.productName, { color: t.text }]}>{m.products?.name ?? "-"}</Text>
                      <Text style={[s.productSku, { color: t.subtle }]}>{m.products?.sku ?? "-"}</Text>
                      {m.notes ? <Text style={[s.moveNotes, { color: t.muted }]}>{m.notes}</Text> : null}
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <View style={[s.badge, { backgroundColor: meta.color + "18" }]}>
                        <Text style={[s.badgeText, { color: meta.color }]}>{meta.label}</Text>
                      </View>
                      <Text style={[s.movQty, { color: m.quantity >= 0 ? "#10b981" : "#ef4444" }]}>
                        {m.quantity >= 0 ? "+" : ""}{m.quantity}
                      </Text>
                      <Text style={[s.saleDate, { color: t.subtle }]}>
                        {new Date(m.created_at).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" })}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </Animated.View>
        </ScrollView>
      )}

      {/* ── Modal: Create/Edit product ── */}
      <Modal visible={showModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowModal(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
            <LinearGradient colors={Gradients.ink} style={s.mHeader}>
              <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.mAccent} />
              <View style={[s.mIconBox, { backgroundColor: "rgba(251,15,5,0.18)" }]}>
                <Ionicons name="cube-outline" size={18} color={Colors.red} />
              </View>
              <Text style={s.mTitle}>{editing ? "Editar producto" : "Nuevo producto"}</Text>
              <TouchableOpacity onPress={() => setShowModal(false)} style={s.mClose} activeOpacity={0.7}>
                <Ionicons name="close" size={22} color="rgba(255,255,255,0.7)" />
              </TouchableOpacity>
            </LinearGradient>

            <ScrollView contentContainerStyle={s.mScroll} keyboardShouldPersistTaps="handled">
              <View style={s.mRow}>
                <View style={{ width: 120 }}>
                  <Text style={[s.fieldLabel, { color: t.subtle }]}>SKU / Código</Text>
                  <TextInput value={form.sku ?? ""} onChangeText={v => setForm(f => ({ ...f, sku: v }))}
                    style={[...inputStyle, { fontFamily: Fonts.mono, fontSize: 12 }]}
                    autoCapitalize="characters" placeholderTextColor={t.subtle} placeholder="SKU-ABC" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.fieldLabel, { color: t.subtle }]}>Nombre *</Text>
                  <TextInput value={form.name ?? ""} onChangeText={v => setForm(f => ({ ...f, name: v }))}
                    style={inputStyle} placeholder="Nombre del producto" placeholderTextColor={t.subtle} />
                </View>
              </View>

              <View style={s.mField}>
                <Text style={[s.fieldLabel, { color: t.subtle }]}>Descripción</Text>
                <TextInput value={form.description ?? ""} onChangeText={v => setForm(f => ({ ...f, description: v }))}
                  style={[...inputStyle, { height: 70, textAlignVertical: "top", paddingTop: 10 }]}
                  multiline placeholder="Descripción breve..." placeholderTextColor={t.subtle} />
              </View>

              <View style={s.mRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[s.fieldLabel, { color: t.subtle }]}>P. Costo *</Text>
                  <TextInput value={form.cost_price ? String(form.cost_price) : ""}
                    onChangeText={v => setForm(f => ({ ...f, cost_price: parseFloat(v) || 0 }))}
                    style={[...inputStyle, { fontFamily: Fonts.mono }]}
                    keyboardType="numeric" placeholder="0" placeholderTextColor={t.subtle} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.fieldLabel, { color: t.subtle }]}>P. Venta *</Text>
                  <TextInput value={form.sale_price ? String(form.sale_price) : ""}
                    onChangeText={v => setForm(f => ({ ...f, sale_price: parseFloat(v) || 0 }))}
                    style={[...inputStyle, { fontFamily: Fonts.mono }]}
                    keyboardType="numeric" placeholder="0" placeholderTextColor={t.subtle} />
                </View>
              </View>

              <View style={s.mRow}>
                {!editing && (
                  <View style={{ flex: 1 }}>
                    <Text style={[s.fieldLabel, { color: t.subtle }]}>Stock inicial</Text>
                    <TextInput value={form.stock_quantity ? String(form.stock_quantity) : ""}
                      onChangeText={v => setForm(f => ({ ...f, stock_quantity: parseInt(v) || 0 }))}
                      style={[...inputStyle, { fontFamily: Fonts.mono }]}
                      keyboardType="numeric" placeholder="0" placeholderTextColor={t.subtle} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={[s.fieldLabel, { color: t.subtle }]}>Alerta mínimo</Text>
                  <TextInput value={form.low_stock_alert ? String(form.low_stock_alert) : ""}
                    onChangeText={v => setForm(f => ({ ...f, low_stock_alert: parseInt(v) || 5 }))}
                    style={[...inputStyle, { fontFamily: Fonts.mono }]}
                    keyboardType="numeric" placeholder="5" placeholderTextColor={t.subtle} />
                </View>
              </View>

              <View style={s.mActions}>
                <TouchableOpacity style={[s.mCancelBtn, { backgroundColor: t.bgAlt, borderColor: t.border }]} onPress={() => setShowModal(false)} activeOpacity={0.7}>
                  <Text style={[s.mCancelText, { color: t.muted }]}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleSave} style={{ flex: 1 }} activeOpacity={0.85}>
                  <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.mSaveBtn}>
                    <Text style={s.mSaveText}>{editing ? "Guardar cambios" : "Crear producto"}</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* ── Modal: Adjust stock ── */}
      <Modal visible={showAdjust} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowAdjust(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
            <LinearGradient colors={Gradients.ink} style={s.mHeader}>
              <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.mAccent} />
              <View style={[s.mIconBox, { backgroundColor: "rgba(99,102,241,0.20)" }]}>
                <Ionicons name="swap-vertical-outline" size={18} color="#6366f1" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.mTitle}>Ajustar stock</Text>
                {adjustTarget && <Text style={s.mSub}>{adjustTarget.name}</Text>}
              </View>
              <TouchableOpacity onPress={() => setShowAdjust(false)} style={s.mClose} activeOpacity={0.7}>
                <Ionicons name="close" size={22} color="rgba(255,255,255,0.7)" />
              </TouchableOpacity>
            </LinearGradient>

            <ScrollView contentContainerStyle={s.mScroll} keyboardShouldPersistTaps="handled">
              {adjustTarget && (
                <View style={[s.currentStockBox, { backgroundColor: t.card, borderColor: t.border }]}>
                  <Text style={[s.fieldLabel, { color: t.subtle }]}>STOCK ACTUAL</Text>
                  <Text style={[s.currentStockVal, { color: t.text }]}>{adjustTarget.stock_quantity} uds.</Text>
                </View>
              )}

              <View style={s.mField}>
                <Text style={[s.fieldLabel, { color: t.subtle }]}>Tipo de movimiento</Text>
                <View style={s.adjustTypes}>
                  {(["purchase", "adjustment", "return", "courtesy"] as const).map(tb => {
                    const meta = MOVE_META[tb];
                    const active = adjustType === tb;
                    return (
                      <TouchableOpacity key={tb} activeOpacity={0.7}
                        style={[s.adjustTypeBtn, { backgroundColor: t.bgAlt, borderColor: t.border },
                          active && { borderColor: meta.color, backgroundColor: meta.color + "15" }]}
                        onPress={() => setAdjustType(tb)}>
                        <Ionicons name={meta.icon} size={16} color={active ? meta.color : t.muted} />
                        <Text style={[s.adjustTypeTxt, { color: active ? meta.color : t.muted },
                          active && { fontFamily: Fonts.bold }]}>{meta.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={s.mField}>
                <Text style={[s.fieldLabel, { color: t.subtle }]}>
                  {adjustType === "adjustment" ? "Cantidad (+ entrada / − salida)" : adjustType === "courtesy" ? "Cantidad a entregar (cortesía)" : "Cantidad a agregar"}
                </Text>
                <TextInput value={adjustQty} onChangeText={setAdjustQty}
                  style={[...inputStyle, { fontFamily: Fonts.mono, fontSize: 16 }]}
                  keyboardType="numeric"
                  placeholder={adjustType === "adjustment" ? "Ej. 10 o -5" : adjustType === "courtesy" ? "Ej. 2" : "Ej. 10"}
                  placeholderTextColor={t.subtle} />
              </View>

              <View style={s.mField}>
                <Text style={[s.fieldLabel, { color: t.subtle }]}>Notas</Text>
                <TextInput value={adjustNotes} onChangeText={setAdjustNotes}
                  style={inputStyle} placeholder="Motivo del ajuste..." placeholderTextColor={t.subtle} />
              </View>

              <View style={s.mActions}>
                <TouchableOpacity style={[s.mCancelBtn, { backgroundColor: t.bgAlt, borderColor: t.border }]} onPress={() => setShowAdjust(false)} activeOpacity={0.7}>
                  <Text style={[s.mCancelText, { color: t.muted }]}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleAdjust} style={{ flex: 1 }} activeOpacity={0.85}>
                  <LinearGradient
                    colors={!adjustQty ? ["rgba(20,15,30,0.10)", "rgba(20,15,30,0.10)"] : Gradients.brand}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.mSaveBtn}>
                    <Text style={[s.mSaveText, !adjustQty && { color: t.subtle }]}>Registrar movimiento</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  header:       { paddingTop: 14, paddingHorizontal: 20, paddingBottom: 16, overflow: "hidden" },
  headerBlob1:  { position: "absolute", width: 200, height: 200, borderRadius: 100, backgroundColor: "rgba(255,255,255,.06)", top: -80, right: -40 },
  headerBlob2:  { position: "absolute", width: 100, height: 100, borderRadius: 50,  backgroundColor: "rgba(0,0,0,.05)", bottom: -30, left: -20 },
  headerTopRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14, zIndex: 1 },
  backBtn:      { width: 32, height: 32, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.2)" },
  headerIconBox:{ width: 32, height: 32, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.2)" },
  headerLabel:  { fontSize: 14, fontFamily: Fonts.semibold, color: "rgba(255,255,255,.8)", flex: 1 },
  headerTitle:  { fontSize: 22, fontFamily: Fonts.bold, color: "white", letterSpacing: -0.5, marginBottom: 4, zIndex: 1 },
  addBtn:       { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(255,255,255,0.18)", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: "rgba(255,255,255,0.25)" },
  addBtnText:   { fontSize: 13, fontFamily: Fonts.bold, color: "white" },

  statsStrip: { flexDirection: "row", borderBottomWidth: 1 },
  statItem:   { flex: 1, paddingVertical: 12, paddingHorizontal: 8, alignItems: "center" },
  statLabel:  { ...MonoLabel, fontSize: 8.5, marginBottom: 4 },
  statValue:  { fontSize: 16, fontFamily: Fonts.bold, fontVariant: ["tabular-nums"] },

  controls:   { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8, gap: 8 },
  searchBox:  { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: Radius.md, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  searchInput:{ flex: 1, fontSize: 14, fontFamily: Fonts.regular },
  tabPills:   { flexDirection: "row", padding: 4, borderRadius: 10, alignSelf: "flex-start", gap: 2 },
  tabPill:    { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 7 },
  tabPillText:{ fontSize: 13, fontFamily: Fonts.semibold },

  listContent: { padding: 14, paddingBottom: 110 },

  card:         { borderRadius: Radius.lg, borderWidth: 1, ...Shadow.sm, overflow: "hidden" },
  productRow:   { flexDirection: "row", alignItems: "center", gap: 10, padding: 14 },
  productPhoto: { width: 44, height: 44, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  productName:  { fontSize: 13, fontFamily: Fonts.semibold },
  productSku:   { fontSize: 10, fontFamily: Fonts.mono, marginTop: 2 },
  productPrice: { fontSize: 13, fontFamily: Fonts.bold, fontVariant: ["tabular-nums"] },
  productDiscount: { fontSize: 11, fontFamily: Fonts.semibold, color: "#10b981" },
  productActions:  { flexDirection: "row", gap: 2 },
  actionBtn:    { width: 34, height: 34, borderRadius: 8, alignItems: "center", justifyContent: "center" },

  badge:     { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  badgeDot:  { width: 5, height: 5, borderRadius: 3 },
  badgeText: { fontSize: 10.5, fontFamily: Fonts.bold },

  moveRow:   { flexDirection: "row", alignItems: "center", gap: 10, padding: 14 },
  moveIcon:  { width: 36, height: 36, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  moveNotes: { fontSize: 11, fontFamily: Fonts.regular, marginTop: 2 },
  movQty:    { fontSize: 14, fontFamily: Fonts.bold, fontVariant: ["tabular-nums"], marginTop: 4 },
  saleDate:  { fontSize: 10, fontFamily: Fonts.mono, marginTop: 2 },

  emptyState: { alignItems: "center", paddingVertical: 48, paddingHorizontal: 32, borderRadius: Radius.lg, borderWidth: 1, ...Shadow.sm },
  emptyIcon:  { width: 56, height: 56, borderRadius: 16, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  emptyTitle: { fontSize: 17, fontFamily: Fonts.bold, marginBottom: 8 },
  emptySub:   { fontSize: 13, fontFamily: Fonts.regular, textAlign: "center", marginBottom: 24 },
  emptyBtn:   { borderRadius: 10, paddingHorizontal: 22, paddingVertical: 11 },
  emptyBtnText:{ fontSize: 14, fontFamily: Fonts.bold, color: "white" },

  mHeader:  { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 16, overflow: "hidden" },
  mAccent:  { position: "absolute", top: 0, left: 0, right: 0, height: 3 },
  mIconBox: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  mTitle:   { fontSize: 17, fontFamily: Fonts.bold, color: Colors.white, flex: 1 },
  mSub:     { fontSize: 11, fontFamily: Fonts.regular, color: "rgba(255,255,255,0.5)", marginTop: 1 },
  mClose:   { width: 34, height: 34, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center" },
  mScroll:  { padding: 20, paddingBottom: 60 },
  mRow:     { flexDirection: "row", gap: 12, marginBottom: 14 },
  mField:   { marginBottom: 14 },
  mActions: { flexDirection: "row", gap: 10, marginTop: 8 },
  mCancelBtn:  { flex: 0.5, borderRadius: 12, borderWidth: 1.5, alignItems: "center", justifyContent: "center", paddingVertical: 13 },
  mCancelText: { fontSize: 14, fontFamily: Fonts.semibold },
  mSaveBtn:    { borderRadius: 12, paddingVertical: 13, alignItems: "center", justifyContent: "center" },
  mSaveText:   { fontSize: 14, fontFamily: Fonts.bold, color: "white" },

  fieldLabel: { fontSize: 10.5, fontFamily: Fonts.mono, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 7 },
  inputBase:  { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 13, paddingVertical: 11, fontSize: 14, fontFamily: Fonts.regular },

  currentStockBox: { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 20 },
  currentStockVal: { fontSize: 28, fontFamily: Fonts.bold, fontVariant: ["tabular-nums"], marginTop: 4 },
  adjustTypes:     { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  adjustTypeBtn:   { flexGrow: 1, flexBasis: "45%", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5 },
  adjustTypeTxt:   { fontSize: 11, fontFamily: Fonts.semibold },
});
