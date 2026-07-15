import { useState, useCallback, useEffect } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Modal, Alert, KeyboardAvoidingView, Platform,
  ActivityIndicator,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Fonts, Gradients, MonoLabel, Radius, Shadow } from "@/constants/theme";
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
  type: "purchase" | "sale" | "adjustment" | "return";
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
  if (p.discount_type === "fixed") return Math.max(0, p.sale_price - p.discount_value);
  return p.sale_price;
}

function genSku() {
  return "SKU-" + Math.random().toString(36).toUpperCase().slice(2, 7);
}

const MOVE_META: Record<string, { label: string; color: string; icon: any }> = {
  purchase:   { label: "Compra",      color: "#10b981", icon: "arrow-down-outline"   },
  sale:       { label: "Venta",       color: "#6366f1", icon: "cart-outline"         },
  adjustment: { label: "Ajuste",      color: "#f59e0b", icon: "options-outline"      },
  return:     { label: "Devolución",  color: "#8E879B", icon: "return-up-back-outline" },
};

// ── Main ──────────────────────────────────────────────────────────────────────

export default function InventarioScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<"productos" | "movimientos">("productos");
  const [products, setProducts]   = useState<Product[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [search, setSearch] = useState("");
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Modal: create/edit product
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<Partial<Product>>({});

  // Modal: adjust stock
  const [showAdjust, setShowAdjust] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState<Product | null>(null);
  const [adjustQty, setAdjustQty] = useState("");
  const [adjustType, setAdjustType] = useState<"purchase" | "adjustment" | "return">("purchase");
  const [adjustNotes, setAdjustNotes] = useState("");

  // ── Fetch tenant id on mount ───────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const { data } = await supabase
        .from("tenants")
        .select("id")
        .eq("owner_id", user.id)
        .single();
      if (data?.id) {
        setTenantId(data.id);
      } else {
        setLoading(false);
      }
    })();
  }, []);

  // ── Load data when tenantId is ready ──────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    const [prodRes, movRes] = await Promise.all([
      supabase
        .from("products")
        .select("id, sku, name, description, cost_price, sale_price, discount_type, discount_value, stock_quantity, low_stock_alert, is_active")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("inventory_movements")
        .select("id, product_id, type, quantity, notes, created_at, products(name, sku)")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    if (prodRes.data) setProducts(prodRes.data as Product[]);
    if (movRes.data)  setMovements(movRes.data as unknown as Movement[]);
    setLoading(false);
  }, [tenantId]);

  useEffect(() => {
    if (tenantId) loadData();
  }, [tenantId, loadData]);

  // ── Stats ──────────────────────────────────────────────────────────────────
  const totalValue = products.reduce((s, p) => s + p.stock_quantity * p.cost_price, 0);
  const lowStock   = products.filter(p => p.stock_quantity > 0 && p.stock_quantity <= p.low_stock_alert).length;
  const outStock   = products.filter(p => p.stock_quantity === 0).length;

  // ── Filtered ───────────────────────────────────────────────────────────────
  const filtered = search
    ? products.filter(p =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.sku.toLowerCase().includes(search.toLowerCase()))
    : products;

  // ── Open product modal ─────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null);
    setForm({ sku: genSku(), name: "", description: "", cost_price: 0, sale_price: 0, discount_type: null, discount_value: 0, stock_quantity: 0, low_stock_alert: 5, is_active: true });
    setShowModal(true);
  };

  const openEdit = (p: Product) => {
    setEditing(p);
    setForm({ ...p });
    setShowModal(true);
  };

  // ── Save product ───────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!form.name?.trim()) { Alert.alert("Requerido", "El nombre del producto es obligatorio"); return; }
    if (!tenantId) return;

    if (editing) {
      const { error } = await supabase
        .from("products")
        .update({
          sku: form.sku,
          name: form.name,
          description: form.description ?? "",
          cost_price: form.cost_price ?? 0,
          sale_price: form.sale_price ?? 0,
          discount_type: form.discount_type ?? null,
          discount_value: form.discount_value ?? 0,
          low_stock_alert: form.low_stock_alert ?? 5,
        })
        .eq("id", editing.id)
        .eq("tenant_id", tenantId);
      if (error) { Alert.alert("Error", error.message); return; }
    } else {
      const initialStock = form.stock_quantity ?? 0;
      const { data: newProd, error } = await supabase
        .from("products")
        .insert({
          tenant_id: tenantId,
          sku: form.sku ?? genSku(),
          name: form.name,
          description: form.description ?? "",
          cost_price: form.cost_price ?? 0,
          sale_price: form.sale_price ?? 0,
          discount_type: form.discount_type ?? null,
          discount_value: form.discount_value ?? 0,
          stock_quantity: initialStock,
          low_stock_alert: form.low_stock_alert ?? 5,
          is_active: true,
        })
        .select("id")
        .single();
      if (error) { Alert.alert("Error", error.message); return; }
      if (newProd && initialStock > 0) {
        await supabase.from("inventory_movements").insert({
          tenant_id: tenantId,
          product_id: newProd.id,
          type: "purchase",
          quantity: initialStock,
          notes: "Stock inicial",
        });
      }
    }
    setShowModal(false);
    await loadData();
  };

  // ── Delete ──────────────────────────────────────────────────────────────────
  const handleDelete = (id: string) => {
    Alert.alert("Eliminar producto", "¿Eliminar este producto del inventario?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Eliminar", style: "destructive", onPress: async () => {
          const { error } = await supabase
            .from("products")
            .update({ is_active: false })
            .eq("id", id)
            .eq("tenant_id", tenantId!);
          if (error) { Alert.alert("Error", error.message); return; }
          await loadData();
        },
      },
    ]);
  };

  // ── Adjust stock ────────────────────────────────────────────────────────────
  const handleAdjust = async () => {
    if (!adjustTarget || !adjustQty || !tenantId) return;
    const qty = parseInt(adjustQty) || 0;
    const isNegative = adjustType === "adjustment" && adjustQty.startsWith("-");
    const actualDelta = isNegative ? -Math.abs(qty) : Math.abs(qty);
    const newStock = Math.max(0, adjustTarget.stock_quantity + actualDelta);

    const { error: movErr } = await supabase.from("inventory_movements").insert({
      tenant_id: tenantId,
      product_id: adjustTarget.id,
      type: adjustType,
      quantity: actualDelta,
      notes: adjustNotes || null,
    });
    if (movErr) { Alert.alert("Error", movErr.message); return; }

    const { error: prodErr } = await supabase
      .from("products")
      .update({ stock_quantity: newStock })
      .eq("id", adjustTarget.id)
      .eq("tenant_id", tenantId);
    if (prodErr) { Alert.alert("Error", prodErr.message); return; }

    setShowAdjust(false);
    setAdjustQty(""); setAdjustNotes("");
    await loadData();
  };

  const openAdjust = (p: Product) => {
    setAdjustTarget(p);
    setAdjustQty(""); setAdjustNotes("");
    setAdjustType("purchase");
    setShowAdjust(true);
  };

  // ── Stock badge ────────────────────────────────────────────────────────────
  const StockBadge = ({ p }: { p: Product }) => {
    const isOut  = p.stock_quantity === 0;
    const isLow  = p.stock_quantity > 0 && p.stock_quantity <= p.low_stock_alert;
    const color  = isOut ? "#ef4444" : isLow ? "#d97706" : "#059669";
    const bg     = isOut ? "rgba(239,68,68,0.1)" : isLow ? "rgba(245,158,11,0.1)" : "rgba(16,185,129,0.09)";
    return (
      <View style={[s.badge, { backgroundColor: bg }]}>
        <View style={[s.badgeDot, { backgroundColor: color }]} />
        <Text style={[s.badgeText, { color }]}>
          {isOut ? "Sin stock" : `${p.stock_quantity} uds`}
        </Text>
      </View>
    );
  };

  // ── Loading screen ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: Colors.cream2, alignItems: "center", justifyContent: "center" }} edges={["top"]}>
        <ActivityIndicator size="large" color={Colors.red} />
      </SafeAreaView>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.cream2 }} edges={["top"]}>

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={Colors.white} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.headerCrumb}>CONTROL DE STOCK</Text>
          <Text style={s.headerTitle}>Inventario</Text>
        </View>
        <TouchableOpacity style={s.addBtn} onPress={openCreate} activeOpacity={0.8}>
          <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.addBtnGrad}>
            <Ionicons name="add" size={18} color="white" />
            <Text style={s.addBtnText}>Nuevo</Text>
          </LinearGradient>
        </TouchableOpacity>
        <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.headerAccent} />
      </View>

      {/* Stats strip */}
      <View style={s.statsStrip}>
        {[
          { label: "Productos", value: String(products.length),     color: Colors.text  },
          { label: "Valor",     value: fmt(totalValue),             color: Colors.text  },
          { label: "Bajo stock",value: String(lowStock),            color: lowStock > 0 ? "#d97706" : "#10b981" },
          { label: "Sin stock", value: String(outStock),            color: outStock > 0 ? "#ef4444" : "#10b981" },
        ].map((stat, i) => (
          <View key={i} style={[s.statItem, i > 0 && s.statBorder]}>
            <Text style={s.statLabel}>{stat.label}</Text>
            <Text style={[s.statValue, { color: stat.color }]}>{stat.value}</Text>
          </View>
        ))}
      </View>

      {/* Search + tabs */}
      <View style={s.controls}>
        {tab === "productos" && (
          <View style={s.searchBox}>
            <Ionicons name="search-outline" size={16} color={Colors.subtle} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Buscar producto o SKU..."
              placeholderTextColor={Colors.subtle}
              style={s.searchInput}
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch("")}>
                <Ionicons name="close-circle" size={16} color={Colors.subtle} />
              </TouchableOpacity>
            )}
          </View>
        )}
        <View style={s.tabPills}>
          {(["productos", "movimientos"] as const).map(t => (
            <TouchableOpacity key={t} style={[s.tabPill, tab === t && s.tabPillActive]} onPress={() => setTab(t)} activeOpacity={0.7}>
              <Text style={[s.tabPillText, tab === t && s.tabPillTextActive]}>
                {t === "productos" ? "Productos" : "Movimientos"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Tab content */}
      {tab === "productos" ? (
        <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={s.listContent} showsVerticalScrollIndicator={false}>
          {filtered.length === 0 ? (
            <View style={s.emptyState}>
              <View style={s.emptyIcon}>
                <Ionicons name="cube-outline" size={28} color={Colors.red} />
              </View>
              <Text style={s.emptyTitle}>{search ? "Sin resultados" : "Sin productos"}</Text>
              <Text style={s.emptySub}>
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
          ) : (
            <View style={[s.card]}>
              {filtered.map((p, i) => (
                <View key={p.id} style={[s.productRow, i < filtered.length - 1 && s.rowBorder]}>
                  {/* Photo placeholder */}
                  <View style={s.productPhoto}>
                    <Ionicons name="cube-outline" size={20} color={Colors.subtle} />
                  </View>
                  {/* Info */}
                  <View style={{ flex: 1 }}>
                    <Text style={s.productName}>{p.name}</Text>
                    <Text style={s.productSku}>{p.sku}</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 }}>
                      <StockBadge p={p} />
                      <Text style={s.productPrice}>{fmt(effectivePrice(p))}</Text>
                      {p.discount_value > 0 && (
                        <Text style={s.productDiscount}>
                          −{p.discount_type === "percent" ? `${p.discount_value}%` : fmt(p.discount_value)}
                        </Text>
                      )}
                    </View>
                  </View>
                  {/* Actions */}
                  <View style={s.productActions}>
                    <TouchableOpacity style={s.actionBtn} onPress={() => openAdjust(p)} activeOpacity={0.7}>
                      <Ionicons name="add-circle-outline" size={18} color={Colors.dim} />
                    </TouchableOpacity>
                    <TouchableOpacity style={s.actionBtn} onPress={() => openEdit(p)} activeOpacity={0.7}>
                      <Ionicons name="create-outline" size={18} color={Colors.dim} />
                    </TouchableOpacity>
                    <TouchableOpacity style={s.actionBtn} onPress={() => handleDelete(p.id)} activeOpacity={0.7}>
                      <Ionicons name="trash-outline" size={18} color="#ef4444" />
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      ) : (
        <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={s.listContent} showsVerticalScrollIndicator={false}>
          <View style={s.card}>
            {movements.length === 0 ? (
              <Text style={s.emptySub}>Sin movimientos registrados.</Text>
            ) : (
              movements.map((m, i) => {
                const meta = MOVE_META[m.type] ?? MOVE_META.adjustment;
                return (
                  <View key={m.id} style={[s.moveRow, i < movements.length - 1 && s.rowBorder]}>
                    <View style={[s.moveIcon, { backgroundColor: meta.color + "15" }]}>
                      <Ionicons name={meta.icon} size={16} color={meta.color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.productName}>{m.products?.name ?? "-"}</Text>
                      <Text style={s.productSku}>{m.products?.sku ?? "-"}</Text>
                      {m.notes ? <Text style={s.moveNotes}>{m.notes}</Text> : null}
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <View style={[s.badge, { backgroundColor: meta.color + "15" }]}>
                        <Text style={[s.badgeText, { color: meta.color }]}>{meta.label}</Text>
                      </View>
                      <Text style={[s.movQty, { color: m.quantity >= 0 ? "#10b981" : "#ef4444" }]}>
                        {m.quantity >= 0 ? "+" : ""}{m.quantity}
                      </Text>
                      <Text style={s.saleDate}>
                        {new Date(m.created_at).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" })}
                      </Text>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        </ScrollView>
      )}

      {/* ── Modal: Create/Edit product ── */}
      <Modal visible={showModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowModal(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: Colors.cream2 }}>
          <KeyboardAvoidingView style={{ flex: 1 }}>
            {/* Modal header */}
            <View style={s.mHeader}>
              <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.mAccent} />
              <View style={[s.mIconBox, { backgroundColor: "rgba(251,15,5,0.12)" }]}>
                <Ionicons name="cube-outline" size={18} color={Colors.red} />
              </View>
              <Text style={s.mTitle}>{editing ? "Editar producto" : "Nuevo producto"}</Text>
              <TouchableOpacity onPress={() => setShowModal(false)} style={s.mClose} activeOpacity={0.7}>
                <Ionicons name="close" size={22} color={Colors.dim} />
              </TouchableOpacity>
            </View>

            <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={s.mScroll} keyboardShouldPersistTaps="handled">
              {/* SKU + Name */}
              <View style={s.mRow}>
                <View style={{ width: 120 }}>
                  <Text style={s.fieldLabel}>SKU / Código</Text>
                  <TextInput
                    value={form.sku ?? ""}
                    onChangeText={v => setForm(f => ({ ...f, sku: v }))}
                    style={[s.input, { fontFamily: Fonts.mono, fontSize: 12 }]}
                    autoCapitalize="characters"
                    placeholderTextColor={Colors.subtle}
                    placeholder="SKU-ABC"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.fieldLabel}>Nombre *</Text>
                  <TextInput
                    value={form.name ?? ""}
                    onChangeText={v => setForm(f => ({ ...f, name: v }))}
                    style={s.input}
                    placeholder="Nombre del producto"
                    placeholderTextColor={Colors.subtle}
                  />
                </View>
              </View>

              {/* Description */}
              <View style={s.mField}>
                <Text style={s.fieldLabel}>Descripción</Text>
                <TextInput
                  value={form.description ?? ""}
                  onChangeText={v => setForm(f => ({ ...f, description: v }))}
                  style={[s.input, { height: 70, textAlignVertical: "top", paddingTop: 10 }]}
                  multiline
                  placeholder="Descripción breve..."
                  placeholderTextColor={Colors.subtle}
                />
              </View>

              {/* Prices */}
              <View style={s.mRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.fieldLabel}>P. Costo *</Text>
                  <TextInput
                    value={form.cost_price ? String(form.cost_price) : ""}
                    onChangeText={v => setForm(f => ({ ...f, cost_price: parseFloat(v) || 0 }))}
                    style={[s.input, { fontFamily: Fonts.mono }]}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={Colors.subtle}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.fieldLabel}>P. Venta *</Text>
                  <TextInput
                    value={form.sale_price ? String(form.sale_price) : ""}
                    onChangeText={v => setForm(f => ({ ...f, sale_price: parseFloat(v) || 0 }))}
                    style={[s.input, { fontFamily: Fonts.mono }]}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={Colors.subtle}
                  />
                </View>
              </View>

              {/* Stock + alert */}
              <View style={s.mRow}>
                {!editing && (
                  <View style={{ flex: 1 }}>
                    <Text style={s.fieldLabel}>Stock inicial</Text>
                    <TextInput
                      value={form.stock_quantity ? String(form.stock_quantity) : ""}
                      onChangeText={v => setForm(f => ({ ...f, stock_quantity: parseInt(v) || 0 }))}
                      style={[s.input, { fontFamily: Fonts.mono }]}
                      keyboardType="numeric"
                      placeholder="0"
                      placeholderTextColor={Colors.subtle}
                    />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={s.fieldLabel}>Alerta mínimo</Text>
                  <TextInput
                    value={form.low_stock_alert ? String(form.low_stock_alert) : ""}
                    onChangeText={v => setForm(f => ({ ...f, low_stock_alert: parseInt(v) || 5 }))}
                    style={[s.input, { fontFamily: Fonts.mono }]}
                    keyboardType="numeric"
                    placeholder="5"
                    placeholderTextColor={Colors.subtle}
                  />
                </View>
              </View>

              {/* Actions */}
              <View style={s.mActions}>
                <TouchableOpacity style={s.mCancelBtn} onPress={() => setShowModal(false)} activeOpacity={0.7}>
                  <Text style={s.mCancelText}>Cancelar</Text>
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
        <SafeAreaView style={{ flex: 1, backgroundColor: Colors.cream2 }}>
          <KeyboardAvoidingView style={{ flex: 1 }}>
            <View style={s.mHeader}>
              <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.mAccent} />
              <View style={[s.mIconBox, { backgroundColor: "rgba(99,102,241,0.12)" }]}>
                <Ionicons name="swap-vertical-outline" size={18} color="#6366f1" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.mTitle}>Ajustar stock</Text>
                {adjustTarget && <Text style={s.mSub}>{adjustTarget.name}</Text>}
              </View>
              <TouchableOpacity onPress={() => setShowAdjust(false)} style={s.mClose} activeOpacity={0.7}>
                <Ionicons name="close" size={22} color={Colors.dim} />
              </TouchableOpacity>
            </View>

            <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={s.mScroll} keyboardShouldPersistTaps="handled">
              {adjustTarget && (
                <View style={s.currentStockBox}>
                  <Text style={s.fieldLabel}>STOCK ACTUAL</Text>
                  <Text style={s.currentStockVal}>{adjustTarget.stock_quantity} uds.</Text>
                </View>
              )}

              {/* Type */}
              <View style={s.mField}>
                <Text style={s.fieldLabel}>Tipo de movimiento</Text>
                <View style={s.adjustTypes}>
                  {(["purchase", "adjustment", "return"] as const).map(t => {
                    const meta = MOVE_META[t];
                    const active = adjustType === t;
                    return (
                      <TouchableOpacity
                        key={t}
                        style={[s.adjustTypeBtn, active && { borderColor: meta.color, backgroundColor: meta.color + "12" }]}
                        onPress={() => setAdjustType(t)}
                        activeOpacity={0.7}
                      >
                        <Ionicons name={meta.icon} size={16} color={active ? meta.color : Colors.dim} />
                        <Text style={[s.adjustTypeTxt, active && { color: meta.color, fontFamily: Fonts.bold }]}>{meta.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* Quantity */}
              <View style={s.mField}>
                <Text style={s.fieldLabel}>
                  {adjustType === "adjustment" ? "Cantidad (+ entrada / − salida)" : "Cantidad a agregar"}
                </Text>
                <TextInput
                  value={adjustQty}
                  onChangeText={setAdjustQty}
                  style={[s.input, { fontFamily: Fonts.mono, fontSize: 16 }]}
                  keyboardType="numeric"
                  placeholder={adjustType === "adjustment" ? "Ej. 10 o -5" : "Ej. 10"}
                  placeholderTextColor={Colors.subtle}
                />
              </View>

              {/* Notes */}
              <View style={s.mField}>
                <Text style={s.fieldLabel}>Notas</Text>
                <TextInput
                  value={adjustNotes}
                  onChangeText={setAdjustNotes}
                  style={s.input}
                  placeholder="Motivo del ajuste..."
                  placeholderTextColor={Colors.subtle}
                />
              </View>

              <View style={s.mActions}>
                <TouchableOpacity style={s.mCancelBtn} onPress={() => setShowAdjust(false)} activeOpacity={0.7}>
                  <Text style={s.mCancelText}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleAdjust} style={{ flex: 1 }} activeOpacity={0.85}>
                  <LinearGradient
                    colors={!adjustQty ? [Colors.border, Colors.border] : Gradients.brand}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                    style={s.mSaveBtn}
                  >
                    <Text style={[s.mSaveText, !adjustQty && { color: Colors.subtle }]}>
                      Registrar movimiento
                    </Text>
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
  header: {
    backgroundColor: Colors.ink, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16,
    flexDirection: "row", alignItems: "center", gap: 12, overflow: "hidden",
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.10)",
    alignItems: "center", justifyContent: "center",
  },
  headerCrumb: { ...MonoLabel, fontSize: 9, color: "rgba(255,255,255,0.45)" },
  headerTitle: { fontSize: 22, fontFamily: Fonts.bold, color: Colors.white, letterSpacing: -0.5, marginTop: 2 },
  headerAccent: { position: "absolute", bottom: 0, left: 0, right: 0, height: 3 },
  addBtn: { borderRadius: 10, overflow: "hidden" },
  addBtnGrad: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 8 },
  addBtnText: { fontSize: 13, fontFamily: Fonts.bold, color: "white" },

  statsStrip: {
    flexDirection: "row", backgroundColor: Colors.white,
    borderBottomWidth: 1, borderColor: Colors.border,
  },
  statItem: { flex: 1, paddingVertical: 12, paddingHorizontal: 8, alignItems: "center" },
  statBorder: { borderLeftWidth: 1, borderColor: Colors.border },
  statLabel: { ...MonoLabel, fontSize: 8.5, marginBottom: 4 },
  statValue: { fontSize: 16, fontFamily: Fonts.bold, fontVariant: ["tabular-nums"] },

  controls: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8, gap: 8 },
  searchBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: Colors.white, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: Fonts.regular, color: Colors.text },
  tabPills: { flexDirection: "row", backgroundColor: "rgba(20,15,30,0.04)", padding: 4, borderRadius: 10, alignSelf: "flex-start", gap: 2 },
  tabPill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 7 },
  tabPillActive: { backgroundColor: Colors.ink },
  tabPillText: { fontSize: 13, fontFamily: Fonts.semibold, color: Colors.dim },
  tabPillTextActive: { color: Colors.white },

  listContent: { padding: 14, paddingBottom: 110 },

  card: {
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.border, ...Shadow.sm,
    overflow: "hidden",
  },
  rowBorder: { borderBottomWidth: 1, borderColor: Colors.border },

  productRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14 },
  productPhoto: {
    width: 44, height: 44, borderRadius: 10,
    backgroundColor: Colors.bgElev,
    alignItems: "center", justifyContent: "center",
  },
  productName: { fontSize: 13, fontFamily: Fonts.semibold, color: Colors.text },
  productSku: { fontSize: 10, fontFamily: Fonts.mono, color: Colors.subtle, marginTop: 2 },
  productPrice: { fontSize: 13, fontFamily: Fonts.bold, color: Colors.text, fontVariant: ["tabular-nums"] },
  productDiscount: { fontSize: 11, fontFamily: Fonts.semibold, color: "#10b981" },
  productActions: { flexDirection: "row", gap: 2 },
  actionBtn: { width: 34, height: 34, borderRadius: 8, alignItems: "center", justifyContent: "center" },

  badge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  badgeDot: { width: 5, height: 5, borderRadius: 3 },
  badgeText: { fontSize: 10.5, fontFamily: Fonts.bold },

  moveRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14 },
  moveIcon: { width: 36, height: 36, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  moveNotes: { fontSize: 11, fontFamily: Fonts.regular, color: Colors.subtle, marginTop: 2 },
  movQty: { fontSize: 14, fontFamily: Fonts.bold, fontVariant: ["tabular-nums"], marginTop: 4 },
  saleDate: { fontSize: 10, fontFamily: Fonts.mono, color: Colors.subtle, marginTop: 2 },

  emptyState: {
    alignItems: "center", paddingVertical: 48, paddingHorizontal: 32,
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.border, ...Shadow.sm,
  },
  emptyIcon: {
    width: 56, height: 56, borderRadius: 16,
    backgroundColor: Colors.red + "10",
    alignItems: "center", justifyContent: "center", marginBottom: 16,
  },
  emptyTitle: { fontSize: 17, fontFamily: Fonts.bold, color: Colors.text, marginBottom: 8 },
  emptySub: { fontSize: 13, fontFamily: Fonts.regular, color: Colors.subtle, textAlign: "center", marginBottom: 24 },
  emptyBtn: { borderRadius: 10, paddingHorizontal: 22, paddingVertical: 11 },
  emptyBtnText: { fontSize: 14, fontFamily: Fonts.bold, color: "white" },

  // Modals
  mHeader: {
    backgroundColor: Colors.ink, flexDirection: "row", alignItems: "center",
    gap: 12, paddingHorizontal: 20, paddingVertical: 16, overflow: "hidden",
  },
  mAccent: { position: "absolute", top: 0, left: 0, right: 0, height: 3 },
  mIconBox: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  mTitle: { fontSize: 17, fontFamily: Fonts.bold, color: Colors.white, flex: 1 },
  mSub: { fontSize: 11, fontFamily: Fonts.regular, color: "rgba(255,255,255,0.5)", marginTop: 1 },
  mClose: { width: 34, height: 34, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.10)", alignItems: "center", justifyContent: "center" },
  mScroll: { padding: 20, paddingBottom: 60 },
  mRow: { flexDirection: "row", gap: 12, marginBottom: 14 },
  mField: { marginBottom: 14 },
  mActions: { flexDirection: "row", gap: 10, marginTop: 8 },
  mCancelBtn: {
    flex: 0.5, borderRadius: 12, borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: Colors.white, alignItems: "center", justifyContent: "center", paddingVertical: 13,
  },
  mCancelText: { fontSize: 14, fontFamily: Fonts.semibold, color: Colors.dim },
  mSaveBtn: { borderRadius: 12, paddingVertical: 13, alignItems: "center", justifyContent: "center" },
  mSaveText: { fontSize: 14, fontFamily: Fonts.bold, color: "white" },

  fieldLabel: {
    fontSize: 10.5, fontFamily: Fonts.mono, color: Colors.subtle,
    textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 7,
  },
  input: {
    backgroundColor: "rgba(20,15,30,0.025)",
    borderWidth: 1.5, borderColor: Colors.border,
    borderRadius: 10, paddingHorizontal: 13, paddingVertical: 11,
    fontSize: 14, fontFamily: Fonts.regular, color: Colors.text,
  },

  currentStockBox: {
    backgroundColor: "rgba(20,15,30,0.03)", borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border,
    padding: 16, marginBottom: 20,
  },
  currentStockVal: {
    fontSize: 28, fontFamily: Fonts.bold, color: Colors.text,
    fontVariant: ["tabular-nums"], marginTop: 4,
  },
  adjustTypes: { flexDirection: "row", gap: 8 },
  adjustTypeBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5,
    paddingVertical: 10, borderRadius: 10,
    borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  adjustTypeTxt: { fontSize: 11, fontFamily: Fonts.semibold, color: Colors.dim },
});
