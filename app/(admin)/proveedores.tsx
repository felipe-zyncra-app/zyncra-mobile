import { useEffect, useState, useRef } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput,
  Modal, KeyboardAvoidingView, ActivityIndicator, Alert, FlatList,
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
import { diaLocalDe, fmtDia } from "@/lib/tz";
import { ErrorDB, mensajeError, nuevoId, revisar, traerTodo } from "@/lib/db";
import { useGuardRespuestas, useRecarga } from "@/lib/useRecarga";
import ErrorState from "@/components/ErrorState";
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

// Área táctil extra para los botones de solo ícono (CAL-24). En los +/- no se
// pisan: entre los dos está la cantidad (minWidth 22-24 > 8 + 8).
const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

/** Pedido mínimo del producto (al menos 1). */
const minimo = (p: Pick<Product, "min_order_qty">) => Math.max(1, Math.floor(Number(p.min_order_qty) || 1));

function aProducto(p: Record<string, unknown>): Product {
  const sup = p.suppliers as { company_name?: string } | null | undefined;
  return {
    ...(p as unknown as Product),
    price: Number(p.price) || 0,
    min_order_qty: Number(p.min_order_qty) || 1,
    stock: p.stock == null ? null : Number(p.stock),
    unit: (p.unit as string) ?? "und",
    supplier_name: sup?.company_name ?? "—",
  };
}

export default function ProveedoresScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const { tenantId } = useAuth();
  const { tenant, timezone } = useTenant();
  const guardCat = useGuardRespuestas();
  const guardPed = useGuardRespuestas();

  const [tab, setTab] = useState<Tab>("catalogo");
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingCat, setLoadingCat] = useState(true);
  const [errorCat, setErrorCat] = useState<unknown>(null);
  const [search, setSearch] = useState("");

  const [cart, setCart] = useState<CartItem[]>([]);
  const [showCart, setShowCart] = useState(false);

  const [myOrders, setMyOrders] = useState<MyOrder[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [errorOrders, setErrorOrders] = useState<unknown>(null);

  const { recargar: loadCatalog } = useRecarga(async () => {
    const turno = guardCat.nuevo();
    setLoadingCat(true);
    try {
      const data = await traerTodo<Record<string, unknown>>((d, h) => supabase.from("supplier_products")
        .select("*, suppliers(company_name)")
        .eq("is_active", true)
        .order("name").order("id")
        .range(d, h), { contexto: "No se pudo cargar el catálogo" });
      if (!turno.vigente()) return;
      setProducts(data.map(aProducto));
      setErrorCat(null);
    } catch (e) {
      if (turno.vigente()) setErrorCat(e);
    } finally {
      if (turno.vigente()) setLoadingCat(false);
    }
  }, [], { alCambiarDia: false, alCambiarSede: false, frescuraMs: 60_000 });

  const { recargar: loadOrders } = useRecarga(async () => {
    if (!tenantId) return;
    const turno = guardPed.nuevo();
    setLoadingOrders(true);
    try {
      const data = await traerTodo<Record<string, unknown>>((d, h) => supabase.from("supplier_orders")
        .select("id, order_number, status, payment_status, total, created_at, suppliers(company_name)")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false }).order("id")
        .range(d, h), { tope: 2000, contexto: "No se pudieron cargar tus pedidos" });
      if (!turno.vigente()) return;
      setMyOrders(data.map(o => ({
        ...(o as unknown as MyOrder),
        total: Number(o.total) || 0,
        supplier_name: (o.suppliers as { company_name?: string } | null)?.company_name ?? "—",
      })));
      setErrorOrders(null);
    } catch (e) {
      if (turno.vigente()) setErrorOrders(e);
    } finally {
      if (turno.vigente()) setLoadingOrders(false);
    }
  }, [tenantId, tab], { habilitado: !!tenantId && tab === "pedidos", alCambiarDia: false, alCambiarSede: false });

  // ── Carrito ──
  // Respeta el pedido mínimo (antes el "−" bajaba de 12 a 11, 10… y se
  // enviaban 5 unidades a un mayorista que pide 12) y el stock del proveedor.
  const addToCart = (p: Product) => {
    const min = minimo(p);
    const ex = cart.find(i => i.id === p.id);
    const nueva = (ex?.qty ?? 0) + min;
    if (p.stock != null && nueva > p.stock) {
      Alert.alert("Sin stock suficiente", p.stock < min
        ? `El proveedor no tiene las ${min} unidades mínimas de "${p.name}".`
        : `El proveedor solo tiene ${p.stock} unidades de "${p.name}".`);
      return;
    }
    setCart(prev => ex
      ? prev.map(i => i.id === p.id ? { ...i, qty: nueva } : i)
      : [...prev, { ...p, qty: min }]);
  };
  const updateQty = (id: string, qty: number) => {
    const it = cart.find(i => i.id === id);
    if (!it) return;
    const min = minimo(it);
    if (qty < min) {
      // Por debajo del mínimo el mayorista no lo despacha: se quita del carrito.
      setCart(prev => prev.filter(i => i.id !== id));
      return;
    }
    if (it.stock != null && qty > it.stock) {
      Alert.alert("Sin stock suficiente", `El proveedor solo tiene ${it.stock} unidades de "${it.name}".`);
      return;
    }
    setCart(prev => prev.map(i => i.id === id ? { ...i, qty } : i));
  };

  const cartCount = cart.reduce((s, i) => s + i.qty, 0);
  const cartTotal = cart.reduce((s, i) => s + i.price * i.qty, 0);

  const q = search.trim().toLowerCase();
  const filtered = q
    ? products.filter(p => p.name.toLowerCase().includes(q) || (p.supplier_name ?? "").toLowerCase().includes(q))
    : products;

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

          {errorCat && products.length === 0 && !loadingCat ? (
            <ErrorState error={errorCat} onRetry={loadCatalog} />
          ) : (
          <FlatList
            data={filtered}
            keyExtractor={p => p.id}
            contentContainerStyle={{ padding: 20, paddingTop: 4, paddingBottom: cartCount > 0 ? 100 : 40 }}
            showsVerticalScrollIndicator={false}
            renderItem={({ item: p, index: i }) => {
              const inCart = cart.find(c => c.id === p.id);
              const agotado = p.stock != null && p.stock < minimo(p);
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
                          {minimo(p) > 1 && (
                            <Text style={[s.prodMin, { color: t.subtle }]}>· mín {minimo(p)}</Text>
                          )}
                          {agotado && <Text style={[s.prodMin, { color: Colors.red }]}>· agotado</Text>}
                        </View>
                      </View>
                      {inCart ? (
                        <View style={[s.qtyControl, { borderColor: t.line }]}>
                          <TouchableOpacity onPress={() => updateQty(p.id, inCart.qty - 1)} style={s.qtyBtn} hitSlop={HIT_SLOP}
                            accessibilityRole="button" accessibilityLabel={inCart.qty - 1 < minimo(p) ? `Quitar ${p.name}` : `Restar uno de ${p.name}`}>
                            <Ionicons name={inCart.qty - 1 < minimo(p) ? "trash-outline" : "remove"} size={16} color={t.ink} />
                          </TouchableOpacity>
                          <Text style={[s.qtyText, { color: t.ink }]}>{inCart.qty}</Text>
                          <TouchableOpacity onPress={() => updateQty(p.id, inCart.qty + 1)} style={s.qtyBtn} hitSlop={HIT_SLOP}
                            accessibilityRole="button" accessibilityLabel={`Sumar uno de ${p.name}`}>
                            <Ionicons name="add" size={16} color={t.ink} />
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <TouchableOpacity onPress={() => addToCart(p)} disabled={agotado} activeOpacity={0.85} style={[s.addWrap, agotado && { opacity: 0.4 }]}
                          hitSlop={HIT_SLOP} accessibilityRole="button" accessibilityLabel={agotado ? `${p.name} agotado` : `Agregar ${p.name}`}
                          accessibilityState={{ disabled: agotado }}>
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
          )}

          {cartCount > 0 && (
            <View style={s.cartBarWrap}>
              <TouchableOpacity onPress={() => setShowCart(true)} activeOpacity={0.9} accessibilityRole="button">
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
      ) : errorOrders && myOrders.length === 0 && !loadingOrders ? (
        <ErrorState error={errorOrders} onRetry={loadOrders} />
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
                        {fmtDia(diaLocalDe(o.created_at, timezone), "corto")}
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
          onReplaceCart={setCart}
          onSuccess={() => { setCart([]); setShowCart(false); setTab("pedidos"); }}
        />
      )}
    </SafeAreaView>
  );
}

// ─── Checkout ──────────────────────────────────────────────────────────────────
function CheckoutModal({ cart, tenantId, defaultAddress, onClose, onUpdateQty, onReplaceCart, onSuccess }: {
  cart: CartItem[]; tenantId: string; defaultAddress: string;
  onClose: () => void; onUpdateQty: (id: string, qty: number) => void;
  onReplaceCart: (updater: (prev: CartItem[]) => CartItem[]) => void;
  onSuccess: () => void;
}) {
  const { t } = useTheme();
  const [address, setAddress] = useState(defaultAddress);
  const [notes, setNotes] = useState("");
  const [method, setMethod] = useState("transferencia");
  const [placing, setPlacing] = useState(false);
  const [revisando, setRevisando] = useState(false);
  const enCurso = useRef(false);
  // Id del pedido por proveedor, generado en el teléfono: si se pierde la
  // respuesta y se reintenta, se reconoce el pedido ya creado en vez de
  // duplicarlo.
  const idsPedido = useRef<Record<string, string>>({});

  // Agrupar por proveedor (un pedido por proveedor)
  const bySupplier = cart.reduce((acc, item) => {
    if (!acc[item.supplier_id]) acc[item.supplier_id] = { name: item.supplier_name ?? "—", items: [] as CartItem[] };
    acc[item.supplier_id].items.push(item);
    return acc;
  }, {} as Record<string, { name: string; items: CartItem[] }>);

  const total = cart.reduce((s, i) => s + i.price * i.qty, 0);

  /**
   * Relee precio, mínimo, stock y disponibilidad del catálogo. El catálogo
   * se cargó al abrir la pantalla: si el proveedor subió un precio mientras
   * tanto, el pedido salía con el viejo sin avisar. Devuelve true si algo cambió.
   */
  const refrescarPrecios = async (): Promise<boolean> => {
    const ids = cart.map(i => i.id);
    if (ids.length === 0) return false;
    const filas = (revisar(
      await supabase.from("supplier_products").select("id, name, price, min_order_qty, stock, is_active, unit").in("id", ids),
      "No se pudieron revisar los precios del catálogo",
    ) ?? []) as { id: string; name: string; price: number; min_order_qty: number | null; stock: number | null; is_active: boolean | null; unit: string | null }[];
    const porId = new Map(filas.map(f => [f.id, f]));
    const cambios: string[] = [];
    const nuevo: CartItem[] = [];
    for (const it of cart) {
      const f = porId.get(it.id);
      if (!f || f.is_active === false) { cambios.push(`"${it.name}" ya no está disponible`); continue; }
      const precio = Number(f.price) || 0;
      const min = Math.max(1, Number(f.min_order_qty) || 1);
      const stock = f.stock == null ? null : Number(f.stock);
      let qty = Math.max(it.qty, min);
      if (stock != null && qty > stock) qty = stock;
      if (qty < min) { cambios.push(`"${it.name}" no tiene stock suficiente`); continue; }
      if (precio !== it.price) cambios.push(`"${it.name}": ${fmtMoney(it.price)} → ${fmtMoney(precio)}`);
      else if (qty !== it.qty) cambios.push(`"${it.name}": cantidad ajustada a ${qty}`);
      nuevo.push({ ...it, name: f.name ?? it.name, price: precio, min_order_qty: min, stock, unit: f.unit ?? it.unit, qty });
    }
    if (cambios.length > 0) {
      onReplaceCart(() => nuevo);
      Alert.alert("El catálogo cambió", `${cambios.join("\n")}\n\nRevisa el total antes de enviar.`);
      return true;
    }
    return false;
  };

  useEffect(() => {
    let vivo = true;
    setRevisando(true);
    refrescarPrecios()
      .catch(e => { if (vivo) Alert.alert("No se pudieron revisar los precios", mensajeError(e)); })
      .finally(() => { if (vivo) setRevisando(false); });
    return () => { vivo = false; };
    // Solo al abrir el checkout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const placeOrder = async () => {
    if (cart.length === 0 || enCurso.current) return;
    enCurso.current = true;
    setPlacing(true);
    const enviados: string[] = [];
    const nombresEnviados: string[] = [];
    try {
      if (await refrescarPrecios()) return;

      for (const [supplierId, group] of Object.entries(bySupplier)) {
        let orderId = idsPedido.current[supplierId] ?? nuevoId();
        idsPedido.current[supplierId] = orderId;

        // ¿Quedó creado en un intento anterior (respuesta perdida)?
        const previo = await supabase.from("supplier_orders").select("id, status").eq("id", orderId).maybeSingle();
        if (previo.error) throw new ErrorDB(previo.error, `No se pudo revisar el pedido a ${group.name}`);
        let existe = !!previo.data;
        if (previo.data && previo.data.status === "cancelled") {
          orderId = nuevoId();
          idsPedido.current[supplierId] = orderId;
          existe = false;
        }

        if (!existe) {
          const { data: numData, error: rpcErr } = await supabase.rpc("generate_order_number");
          if (rpcErr) throw new ErrorDB(rpcErr, "No se pudo generar el número de pedido");
          // Con la migración el servidor ignora estos montos y los calcula con
          // los precios del catálogo; sin ella hacen falta para que el pedido
          // no quede en $0.
          const subtotal = group.items.reduce((s, i) => s + i.price * i.qty, 0);
          const ins = await supabase.from("supplier_orders").insert({
            id: orderId,
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
          });
          if (ins.error && (ins.error as { code?: string }).code !== "23505") {
            throw new ErrorDB(ins.error, `No se pudo crear el pedido a ${group.name}`);
          }
        }

        // Ítems: solo si el pedido todavía no los tiene (un reintento no los duplica).
        const yaTiene = await supabase.from("supplier_order_items").select("id", { count: "exact", head: true }).eq("order_id", orderId);
        if (yaTiene.error) throw new ErrorDB(yaTiene.error, `No se pudo revisar el pedido a ${group.name}`);
        if ((yaTiene.count ?? 0) === 0) {
          const items = group.items.map(i => ({
            order_id: orderId,
            product_id: i.id,
            product_name: i.name,
            product_price: i.price,
            quantity: i.qty,
            subtotal: i.price * i.qty,
          }));
          const insItems = await supabase.from("supplier_order_items").insert(items);
          if (insItems.error) {
            // Sin ítems el proveedor recibiría un pedido vacío: se cancela
            // (el negocio no puede borrar pedidos) y el reintento crea otro.
            const cancel = await supabase.from("supplier_orders")
              .update({ status: "cancelled", notes: "Cancelado automáticamente: no se pudieron agregar los productos." })
              .eq("id", orderId).select("id");
            if (!cancel.error && (cancel.data ?? []).length > 0) delete idsPedido.current[supplierId];
            throw new ErrorDB(insItems.error, `No se pudo completar el pedido a ${group.name}`);
          }
        }
        enviados.push(supplierId);
        nombresEnviados.push(group.name);
        delete idsPedido.current[supplierId];
      }
      Alert.alert("¡Pedido enviado!", "El proveedor lo confirmará pronto.");
      onSuccess();
    } catch (e) {
      if (enviados.length > 0) {
        // Los que sí salieron se quitan del carrito: reintentar no los repite.
        const listos = new Set(enviados);
        onReplaceCart(prev => prev.filter(i => !listos.has(i.supplier_id)));
        Alert.alert(
          "Pedido enviado a medias",
          `Se enviaron los pedidos a ${nombresEnviados.join(", ")}. ${mensajeError(e)}\n\nLo que falta sigue en el carrito para reintentar.`,
        );
      } else {
        Alert.alert("No se envió el pedido", mensajeError(e));
      }
    } finally {
      enCurso.current = false;
      setPlacing(false);
    }
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: t.canvas }}>
        <View style={[c.header, { backgroundColor: "#0C0C14" }]}>
          <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={c.accent} />
          <View style={c.headerRow}>
            <TouchableOpacity onPress={onClose} style={c.closeBtn} hitSlop={HIT_SLOP} accessibilityRole="button" accessibilityLabel="Cerrar">
              <Ionicons name="close" size={20} color="white" />
            </TouchableOpacity>
            <Text style={c.title}>Confirmar pedido</Text>
            <View style={{ width: 40 }} />
          </View>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }}>
          <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
            {cart.length === 0 ? (
              <Text style={[c.itemPrice, { color: t.muted, textAlign: "center", marginVertical: 30 }]}>El carrito quedó vacío.</Text>
            ) : null}
            {Object.entries(bySupplier).map(([sid, group]) => (
              <View key={sid} style={{ marginBottom: 16 }}>
                <SectionLabel>{group.name}</SectionLabel>
                <Card>
                  {group.items.map((it, idx) => (
                    <View key={it.id} style={[c.cartItem, idx < group.items.length - 1 && { borderBottomWidth: 1, borderBottomColor: t.divider }]}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[c.itemName, { color: t.ink }]} numberOfLines={1}>{it.name}</Text>
                        <Text style={[c.itemPrice, { color: t.subtle }]}>
                          {fmtMoney(it.price)} / {it.unit}{minimo(it) > 1 ? ` · mín ${minimo(it)}` : ""}
                        </Text>
                      </View>
                      <View style={[c.qtyControl, { borderColor: t.line }]}>
                        <TouchableOpacity onPress={() => onUpdateQty(it.id, it.qty - 1)} style={c.qtyBtn} hitSlop={HIT_SLOP}
                          accessibilityRole="button" accessibilityLabel={it.qty - 1 < minimo(it) ? `Quitar ${it.name}` : `Restar uno de ${it.name}`}>
                          <Ionicons name={it.qty - 1 < minimo(it) ? "trash-outline" : "remove"} size={15} color={t.ink} />
                        </TouchableOpacity>
                        <Text style={[c.qtyText, { color: t.ink }]}>{it.qty}</Text>
                        <TouchableOpacity onPress={() => onUpdateQty(it.id, it.qty + 1)} style={c.qtyBtn} hitSlop={HIT_SLOP}
                          accessibilityRole="button" accessibilityLabel={`Sumar uno de ${it.name}`}>
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
                  accessibilityRole="button"
                  accessibilityState={{ selected: method === pm.key }}
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
            <Text style={[c.itemPrice, { color: t.subtle, marginTop: 4 }]}>El total final lo confirma el proveedor (incluye el envío, si aplica).</Text>
          </ScrollView>

          <View style={[c.bottomBar, { backgroundColor: t.canvas, borderTopColor: t.line }]}>
            <View style={{ flex: 1 }}>
              <Text style={[c.totalLabel, { color: t.subtle }]}>Total</Text>
              <Text style={[c.totalValue, { color: t.ink }]}>{fmtMoney(total)}</Text>
            </View>
            <TouchableOpacity onPress={placeOrder} disabled={placing || revisando || cart.length === 0} activeOpacity={0.85}
              style={[c.placeWrap, (placing || revisando || cart.length === 0) && { opacity: 0.6 }]} accessibilityRole="button">
              <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={c.placeBtn}>
                {placing || revisando ? <ActivityIndicator color="white" /> : <Text style={c.placeText}>Enviar pedido</Text>}
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
  prodMetaRow: { flexDirection: "row", alignItems: "baseline", gap: 4, marginTop: 6, flexWrap: "wrap" },
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
