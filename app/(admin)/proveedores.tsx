import { useEffect, useState, useCallback } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput,
  Modal, KeyboardAvoidingView, Platform, ActivityIndicator, Alert, FlatList,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { Colors, Fonts, Gradients, Radius } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { fmtMoney } from "@/lib/format";
import { ScreenHeader, Card, SegmentedControl, SectionLabel } from "@/components/ui";

type Product = {
  id: string; supplier_id: string; name: string; description: string | null;
  category: string | null; price: number; unit: string; min_order_qty: number;
  stock: number | null; supplier_name?: string;
};
type CartItem = Product & { qty: number };
type MyOrder = {
  id: string; order_number: string; status: string; payment_status: string;
  total: number; created_at: string; supplier_name: string;
};

const STATUS_META: Record<string, { label: string; color: string }> = {
  pending:   { label: "Pendiente",  color: "#f59e0b" },
  confirmed: { label: "Confirmado", color: "#10b981" },
  preparing: { label: "Preparando", color: Colors.blue },
  shipped:   { label: "Enviado",    color: "#8b5cf6" },
  delivered: { label: "Entregado",  color: "#22c55e" },
  cancelled: { label: "Cancelado",  color: Colors.red },
};
const PAY_META: Record<string, { label: string; color: string }> = {
  pending:        { label: "Sin pago",         color: "#f59e0b" },
  proof_uploaded: { label: "Comprobante env.",  color: Colors.blue },
  confirmed:      { label: "Pago confirmado",   color: "#10b981" },
};
const PAYMENT_METHODS = [
  { key: "transferencia", label: "Transferencia" },
  { key: "contra_entrega", label: "Contra entrega" },
];

type Tab = "catalogo" | "pedidos";

export default function ProveedoresScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const { tenantId } = useAuth();
  const { tenant } = useTenant();

  const [tab, setTab] = useState<Tab>("catalogo");
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingCat, setLoadingCat] = useState(true);
  const [search, setSearch] = useState("");

  const [cart, setCart] = useState<CartItem[]>([]);
  const [showCart, setShowCart] = useState(false);

  const [myOrders, setMyOrders] = useState<MyOrder[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);

  const loadCatalog = useCallback(async () => {
    setLoadingCat(true);
    const { data } = await supabase.from("supplier_products")
      .select("*, suppliers(company_name)")
      .eq("is_active", true)
      .order("name");
    setProducts((data ?? []).map((p: any) => ({ ...p, supplier_name: p.suppliers?.company_name ?? "—" })) as Product[]);
    setLoadingCat(false);
  }, []);

  const loadOrders = useCallback(async () => {
    if (!tenantId) return;
    setLoadingOrders(true);
    const { data } = await supabase.from("supplier_orders")
      .select("*, suppliers(company_name)")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
    setMyOrders((data ?? []).map((o: any) => ({ ...o, supplier_name: o.suppliers?.company_name ?? "—" })) as MyOrder[]);
    setLoadingOrders(false);
  }, [tenantId]);

  useEffect(() => { loadCatalog(); }, [loadCatalog]);
  useEffect(() => { if (tab === "pedidos") loadOrders(); }, [tab, loadOrders]);

  // ── Carrito ──
  const addToCart = (p: Product) => {
    setCart(prev => {
      const ex = prev.find(i => i.id === p.id);
      if (ex) return prev.map(i => i.id === p.id ? { ...i, qty: i.qty + (p.min_order_qty || 1) } : i);
      return [...prev, { ...p, qty: p.min_order_qty || 1 }];
    });
  };
  const updateQty = (id: string, qty: number) => {
    if (qty <= 0) { setCart(prev => prev.filter(i => i.id !== id)); return; }
    setCart(prev => prev.map(i => i.id === id ? { ...i, qty } : i));
  };

  const cartCount = cart.reduce((s, i) => s + i.qty, 0);
  const cartTotal = cart.reduce((s, i) => s + i.price * i.qty, 0);

  const filtered = products.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.supplier_name ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.canvas }}>
      <ScreenHeader crumb="Compras" title="Proveedores" subtitle="Catálogo mayorista y pedidos" onBack={() => router.back()} />

      <View style={{ paddingHorizontal: 20, paddingVertical: 12 }}>
        <SegmentedControl<Tab>
          options={[{ value: "catalogo", label: "Catálogo" }, { value: "pedidos", label: "Mis pedidos" }]}
          value={tab}
          onChange={setTab}
        />
      </View>

      {tab === "catalogo" ? (
        <>
          <View style={{ paddingHorizontal: 20, marginBottom: 8 }}>
            <View style={[s.searchWrap, { backgroundColor: t.cardSolid, borderColor: t.line }]}>
              <Ionicons name="search-outline" size={16} color={t.subtle} />
              <TextInput
                style={[s.searchInput, { color: t.ink }]}
                value={search}
                onChangeText={setSearch}
                placeholder="Buscar producto o proveedor..."
                placeholderTextColor={t.subtle}
              />
            </View>
          </View>

          <FlatList
            data={filtered}
            keyExtractor={p => p.id}
            contentContainerStyle={{ padding: 20, paddingTop: 4, paddingBottom: cartCount > 0 ? 100 : 40 }}
            showsVerticalScrollIndicator={false}
            renderItem={({ item: p, index: i }) => {
              const inCart = cart.find(c => c.id === p.id);
              return (
                <Animated.View entering={i < 12 ? FadeInDown.delay(i * 25).duration(280) : undefined}>
                  <Card style={{ marginBottom: 10 }}>
                    <View style={s.prodRow}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[s.prodName, { color: t.ink }]} numberOfLines={1}>{p.name}</Text>
                        <Text style={[s.prodSupplier, { color: t.subtle }]} numberOfLines={1}>{p.supplier_name}</Text>
                        <View style={s.prodMetaRow}>
                          <Text style={[s.prodPrice, { color: Colors.red }]}>{fmtMoney(p.price)}</Text>
                          <Text style={[s.prodUnit, { color: t.subtle }]}>/ {p.unit}</Text>
                          {p.min_order_qty > 1 && (
                            <Text style={[s.prodMin, { color: t.subtle }]}>· mín {p.min_order_qty}</Text>
                          )}
                        </View>
                      </View>
                      {inCart ? (
                        <View style={[s.qtyControl, { borderColor: t.line }]}>
                          <TouchableOpacity onPress={() => updateQty(p.id, inCart.qty - 1)} style={s.qtyBtn}>
                            <Ionicons name="remove" size={16} color={t.ink} />
                          </TouchableOpacity>
                          <Text style={[s.qtyText, { color: t.ink }]}>{inCart.qty}</Text>
                          <TouchableOpacity onPress={() => updateQty(p.id, inCart.qty + 1)} style={s.qtyBtn}>
                            <Ionicons name="add" size={16} color={t.ink} />
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <TouchableOpacity onPress={() => addToCart(p)} activeOpacity={0.85} style={s.addWrap}>
                          <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.addBtn}>
                            <Ionicons name="add" size={18} color="white" />
                          </LinearGradient>
                        </TouchableOpacity>
                      )}
                    </View>
                  </Card>
                </Animated.View>
              );
            }}
            ListEmptyComponent={
              loadingCat ? <ActivityIndicator color={Colors.red} style={{ marginTop: 40 }} /> : (
                <View style={{ padding: 40, alignItems: "center" }}>
                  <Ionicons name="storefront-outline" size={40} color={t.subtle} style={{ marginBottom: 12 }} />
                  <Text style={[s.emptyTitle, { color: t.ink }]}>{search ? "Sin resultados" : "Catálogo vacío"}</Text>
                  <Text style={[s.emptyText, { color: t.muted }]}>
                    {search ? `No encontramos "${search}"` : "Aún no hay proveedores con productos disponibles."}
                  </Text>
                </View>
              )
            }
          />

          {cartCount > 0 && (
            <View style={s.cartBarWrap}>
              <TouchableOpacity onPress={() => setShowCart(true)} activeOpacity={0.9}>
                <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.cartBar}>
                  <View style={s.cartBadge}>
                    <Text style={s.cartBadgeText}>{cartCount}</Text>
                  </View>
                  <Text style={s.cartBarText}>Ver carrito</Text>
                  <Text style={s.cartBarTotal}>{fmtMoney(cartTotal)}</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          )}
        </>
      ) : (
        <FlatList
          data={myOrders}
          keyExtractor={o => o.id}
          contentContainerStyle={{ padding: 20, paddingTop: 4, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item: o, index: i }) => {
            const st = STATUS_META[o.status] ?? STATUS_META.pending;
            const pay = PAY_META[o.payment_status] ?? PAY_META.pending;
            return (
              <Animated.View entering={i < 12 ? FadeInDown.delay(i * 30).duration(300) : undefined}>
                <Card style={{ marginBottom: 10 }}>
                  <View style={{ padding: 14 }}>
                    <View style={s.orderTop}>
                      <Text style={[s.orderNum, { color: t.subtle }]}>#{o.order_number}</Text>
                      <View style={[s.statusPill, { backgroundColor: st.color + "18" }]}>
                        <View style={[s.statusDot, { backgroundColor: st.color }]} />
                        <Text style={[s.statusText, { color: st.color }]}>{st.label}</Text>
                      </View>
                    </View>
                    <Text style={[s.orderSupplier, { color: t.ink }]} numberOfLines={1}>{o.supplier_name}</Text>
                    <View style={s.orderBottom}>
                      <Text style={[s.orderDate, { color: t.subtle }]}>
                        {new Date(o.created_at).toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" })}
                        {"  ·  "}
                        <Text style={{ color: pay.color }}>{pay.label}</Text>
                      </Text>
                      <Text style={[s.orderTotal, { color: t.ink }]}>{fmtMoney(o.total)}</Text>
                    </View>
                  </View>
                </Card>
              </Animated.View>
            );
          }}
          ListEmptyComponent={
            loadingOrders ? <ActivityIndicator color={Colors.red} style={{ marginTop: 40 }} /> : (
              <View style={{ padding: 40, alignItems: "center" }}>
                <Ionicons name="receipt-outline" size={40} color={t.subtle} style={{ marginBottom: 12 }} />
                <Text style={[s.emptyTitle, { color: t.ink }]}>Sin pedidos aún</Text>
                <Text style={[s.emptyText, { color: t.muted }]}>Tus pedidos a proveedores aparecerán aquí.</Text>
              </View>
            )
          }
        />
      )}

      {showCart && tenantId && (
        <CheckoutModal
          cart={cart}
          tenantId={tenantId}
          defaultAddress={tenant?.address ?? ""}
          onClose={() => setShowCart(false)}
          onUpdateQty={updateQty}
          onSuccess={() => { setCart([]); setShowCart(false); setTab("pedidos"); }}
        />
      )}
    </SafeAreaView>
  );
}

// ─── Checkout ──────────────────────────────────────────────────────────────────
function CheckoutModal({ cart, tenantId, defaultAddress, onClose, onUpdateQty, onSuccess }: {
  cart: CartItem[]; tenantId: string; defaultAddress: string;
  onClose: () => void; onUpdateQty: (id: string, qty: number) => void; onSuccess: () => void;
}) {
  const { t } = useTheme();
  const [address, setAddress] = useState(defaultAddress);
  const [notes, setNotes] = useState("");
  const [method, setMethod] = useState("transferencia");
  const [placing, setPlacing] = useState(false);

  // Agrupar por proveedor (un pedido por proveedor)
  const bySupplier = cart.reduce((acc, item) => {
    if (!acc[item.supplier_id]) acc[item.supplier_id] = { name: item.supplier_name ?? "—", items: [] as CartItem[] };
    acc[item.supplier_id].items.push(item);
    return acc;
  }, {} as Record<string, { name: string; items: CartItem[] }>);

  const total = cart.reduce((s, i) => s + i.price * i.qty, 0);

  const placeOrder = async () => {
    if (cart.length === 0) return;
    setPlacing(true);
    try {
      for (const [supplierId, group] of Object.entries(bySupplier)) {
        const subtotal = group.items.reduce((s, i) => s + i.price * i.qty, 0);
        const { data: numData, error: rpcErr } = await supabase.rpc("generate_order_number");
        if (rpcErr) throw new Error("Número de pedido: " + rpcErr.message);

        const { data: newOrder, error: orderErr } = await supabase.from("supplier_orders").insert({
          order_number: numData as string,
          tenant_id: tenantId,
          supplier_id: supplierId,
          subtotal,
          shipping_cost: 0,
          total: subtotal,
          shipping_address: address.trim() || null,
          notes: notes.trim() || null,
          payment_method: method,
          payment_status: "pending",
          status: "pending",
        }).select("id").single();
        if (orderErr) throw new Error("Pedido: " + orderErr.message);

        const items = group.items.map(i => ({
          order_id: newOrder.id,
          product_id: i.id,
          product_name: i.name,
          product_price: i.price,
          quantity: i.qty,
          subtotal: i.price * i.qty,
        }));
        const { error: itemsErr } = await supabase.from("supplier_order_items").insert(items);
        if (itemsErr) throw new Error("Ítems: " + itemsErr.message);
      }
      Alert.alert("¡Pedido enviado!", "El proveedor lo confirmará pronto.");
      onSuccess();
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No se pudo crear el pedido.");
    } finally {
      setPlacing(false);
    }
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: t.canvas }}>
        <View style={[c.header, { backgroundColor: "#0C0C14" }]}>
          <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={c.accent} />
          <View style={c.headerRow}>
            <TouchableOpacity onPress={onClose} style={c.closeBtn}>
              <Ionicons name="close" size={20} color="white" />
            </TouchableOpacity>
            <Text style={c.title}>Confirmar pedido</Text>
            <View style={{ width: 40 }} />
          </View>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }}>
          <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
            {Object.entries(bySupplier).map(([sid, group]) => (
              <View key={sid} style={{ marginBottom: 16 }}>
                <SectionLabel>{group.name}</SectionLabel>
                <Card>
                  {group.items.map((it, idx) => (
                    <View key={it.id} style={[c.cartItem, idx < group.items.length - 1 && { borderBottomWidth: 1, borderBottomColor: t.divider }]}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[c.itemName, { color: t.ink }]} numberOfLines={1}>{it.name}</Text>
                        <Text style={[c.itemPrice, { color: t.subtle }]}>{fmtMoney(it.price)} / {it.unit}</Text>
                      </View>
                      <View style={[c.qtyControl, { borderColor: t.line }]}>
                        <TouchableOpacity onPress={() => onUpdateQty(it.id, it.qty - 1)} style={c.qtyBtn}>
                          <Ionicons name="remove" size={15} color={t.ink} />
                        </TouchableOpacity>
                        <Text style={[c.qtyText, { color: t.ink }]}>{it.qty}</Text>
                        <TouchableOpacity onPress={() => onUpdateQty(it.id, it.qty + 1)} style={c.qtyBtn}>
                          <Ionicons name="add" size={15} color={t.ink} />
                        </TouchableOpacity>
                      </View>
                      <Text style={[c.itemSubtotal, { color: t.ink }]}>{fmtMoney(it.price * it.qty)}</Text>
                    </View>
                  ))}
                </Card>
              </View>
            ))}

            <SectionLabel>Dirección de envío</SectionLabel>
            <TextInput
              style={[c.input, { backgroundColor: t.inputBg, borderColor: t.inputBorder, color: t.ink }]}
              value={address}
              onChangeText={setAddress}
              placeholder="Dirección de entrega"
              placeholderTextColor={t.subtle}
            />

            <SectionLabel>Método de pago</SectionLabel>
            <View style={c.methodRow}>
              {PAYMENT_METHODS.map(pm => (
                <TouchableOpacity
                  key={pm.key}
                  style={[c.methodChip, { borderColor: t.line }, method === pm.key && { backgroundColor: t.ink, borderColor: t.ink }]}
                  onPress={() => setMethod(pm.key)}
                >
                  <Text style={[c.methodText, { color: method === pm.key ? t.cardSolid : t.muted }]}>{pm.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <SectionLabel>Notas (opcional)</SectionLabel>
            <TextInput
              style={[c.input, { backgroundColor: t.inputBg, borderColor: t.inputBorder, color: t.ink, minHeight: 64, textAlignVertical: "top" }]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Instrucciones para el proveedor..."
              placeholderTextColor={t.subtle}
              multiline
            />
          </ScrollView>

          <View style={[c.bottomBar, { backgroundColor: t.canvas, borderTopColor: t.line }]}>
            <View style={{ flex: 1 }}>
              <Text style={[c.totalLabel, { color: t.subtle }]}>Total</Text>
              <Text style={[c.totalValue, { color: t.ink }]}>{fmtMoney(total)}</Text>
            </View>
            <TouchableOpacity onPress={placeOrder} disabled={placing} activeOpacity={0.85} style={c.placeWrap}>
              <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={c.placeBtn}>
                {placing ? <ActivityIndicator color="white" /> : <Text style={c.placeText}>Enviar pedido</Text>}
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  searchWrap:  { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 11 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: Fonts.regular },

  prodRow:     { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  prodName:    { fontSize: 14, fontFamily: Fonts.semibold },
  prodSupplier:{ fontSize: 11.5, fontFamily: Fonts.regular, marginTop: 1 },
  prodMetaRow: { flexDirection: "row", alignItems: "baseline", gap: 4, marginTop: 6 },
  prodPrice:   { fontSize: 14, fontFamily: Fonts.bold },
  prodUnit:    { fontSize: 11, fontFamily: Fonts.regular },
  prodMin:     { fontSize: 11, fontFamily: Fonts.regular },
  addWrap:     { borderRadius: 12, overflow: "hidden" },
  addBtn:      { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  qtyControl:  { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 12 },
  qtyBtn:      { width: 32, height: 36, alignItems: "center", justifyContent: "center" },
  qtyText:     { fontSize: 14, fontFamily: Fonts.bold, minWidth: 24, textAlign: "center" },

  cartBarWrap: { position: "absolute", bottom: 24, left: 20, right: 20 },
  cartBar:     { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 15, paddingHorizontal: 18, borderRadius: Radius.md },
  cartBadge:   { backgroundColor: "rgba(255,255,255,0.25)", borderRadius: 10, minWidth: 24, height: 24, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  cartBadgeText: { fontSize: 12, fontFamily: Fonts.bold, color: "white" },
  cartBarText: { flex: 1, fontSize: 15, fontFamily: Fonts.bold, color: "white" },
  cartBarTotal:{ fontSize: 15, fontFamily: Fonts.bold, color: "white" },

  orderTop:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  orderNum:      { fontSize: 11, fontFamily: Fonts.mono },
  statusPill:    { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 20 },
  statusDot:     { width: 6, height: 6, borderRadius: 3 },
  statusText:    { fontSize: 11, fontFamily: Fonts.semibold },
  orderSupplier: { fontSize: 14, fontFamily: Fonts.semibold },
  orderBottom:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 },
  orderDate:     { fontSize: 12, fontFamily: Fonts.regular },
  orderTotal:    { fontSize: 15, fontFamily: Fonts.bold },

  emptyTitle: { fontSize: 15, fontFamily: Fonts.bold, marginBottom: 6 },
  emptyText:  { fontSize: 13, fontFamily: Fonts.regular, textAlign: "center", lineHeight: 19 },
});

const c = StyleSheet.create({
  header:    { paddingTop: 16, paddingHorizontal: 16, paddingBottom: 18 },
  accent:    { position: "absolute", top: 0, left: 0, right: 0, height: 3 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  closeBtn:  { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,.16)", alignItems: "center", justifyContent: "center" },
  title:     { fontSize: 17, fontFamily: Fonts.bold, color: "white" },

  cartItem:    { flexDirection: "row", alignItems: "center", gap: 10, padding: 12 },
  itemName:    { fontSize: 13, fontFamily: Fonts.semibold },
  itemPrice:   { fontSize: 11, fontFamily: Fonts.regular, marginTop: 1 },
  qtyControl:  { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 10 },
  qtyBtn:      { width: 28, height: 32, alignItems: "center", justifyContent: "center" },
  qtyText:     { fontSize: 13, fontFamily: Fonts.bold, minWidth: 22, textAlign: "center" },
  itemSubtotal:{ fontSize: 13, fontFamily: Fonts.bold, minWidth: 70, textAlign: "right" },

  input:     { borderWidth: 1.5, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontFamily: Fonts.regular, marginBottom: 8 },
  methodRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  methodChip:{ flex: 1, borderWidth: 1.5, borderRadius: Radius.md, paddingVertical: 12, alignItems: "center" },
  methodText:{ fontSize: 13, fontFamily: Fonts.semibold },

  bottomBar: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, borderTopWidth: 1 },
  totalLabel:{ fontSize: 11, fontFamily: Fonts.mono, textTransform: "uppercase", letterSpacing: 0.6 },
  totalValue:{ fontSize: 20, fontFamily: Fonts.bold, letterSpacing: -0.5 },
  placeWrap: { borderRadius: Radius.md, overflow: "hidden" },
  placeBtn:  { paddingVertical: 15, paddingHorizontal: 28, alignItems: "center" },
  placeText: { fontSize: 15, fontFamily: Fonts.bold, color: "white" },
});
