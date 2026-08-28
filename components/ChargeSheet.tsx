import { useEffect, useMemo, useState } from "react";
import {
  View, Text, Modal, ScrollView, StyleSheet, TouchableOpacity, TextInput,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert, Switch,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { useTheme } from "@/lib/theme";
import { useClientSearch, type ClientLite } from "@/lib/useClientSearch";
import { recordSale, type SaleItemInput } from "@/lib/record-sale";
import { fmtMoneyFull, fmt12 } from "@/lib/format";
import { Colors, Fonts, Radius, Glass } from "@/constants/theme";
import ModalHeader from "@/components/ModalHeader";
import BottomSaveBar from "@/components/BottomSaveBar";

/**
 * Hoja de cobro del móvil — paridad con el POS web (src/app/admin/pos):
 * carrito con varios servicios (incluye los servicios adicionales de la cita),
 * productos con stock (descuenta inventario), ítem libre, descuento % o fijo,
 * pago con un método o dividido en varios, y cliente para ventas directas.
 * Antes el móvil solo cobraba el precio base del servicio de la cita con un
 * único método, y la venta directa era un concepto de texto.
 *
 * Sirve tanto para cobrar una cita como para una venta directa (target).
 */

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

export const PAY_METHODS: { key: string; label: string; icon: IoniconName; color: string }[] = [
  { key: "efectivo",      label: "Efectivo",      icon: "cash-outline",           color: Colors.success },
  { key: "tarjeta",       label: "Tarjeta",        icon: "card-outline",           color: Colors.blue },
  { key: "transferencia", label: "Transferencia",  icon: "phone-portrait-outline", color: Colors.purple },
  { key: "nequi",         label: "Nequi",          icon: "logo-whatsapp",          color: "#00b5a5" },
  { key: "daviplata",     label: "Daviplata",      icon: "phone-portrait-outline", color: "#f59e0b" },
  { key: "qr",            label: "QR",             icon: "qr-code-outline",        color: "#8b5cf6" },
];

/** Venta con pago dividido: payment_method = "mixto" y el detalle en `payments`. */
export const MIXTO_METHOD = { key: "mixto", label: "Dividido", icon: "layers-outline" as IoniconName, color: Colors.ink };

export function methodCfg(key: string | null | undefined) {
  if (key === "mixto") return MIXTO_METHOD;
  return PAY_METHODS.find(m => m.key === key);
}

export type LinkedAppt = {
  id: string;
  clientId: string | null;
  clientName: string | null;
  serviceId: string | null;
  serviceName: string | null;
  servicePrice: number;
  locationId: string | null;
  time: string;
};

export type ChargeTarget =
  | { kind: "appointment"; appt: LinkedAppt }
  | { kind: "direct" };

type Service = { id: string; name: string; price: number };
type Product = {
  id: string; name: string; sale_price: number; cost_price: number | null;
  discount_type: string | null; discount_value: number | null; stock_quantity: number;
};
type CartItem = {
  key: string;
  serviceId: string | null;
  productId: string | null;
  itemType: "service" | "product" | "free";
  name: string;
  price: number;
  qty: number;
  unitCost?: number | null;
  /** Stock disponible (productos): tope de cantidad en el carrito. */
  maxQty?: number;
};
type SplitLine = { method: string; amount: string };

// Espejo de productEffectivePrice del POS web y effectivePrice de inventario.tsx
function productPrice(p: Product): number {
  const d = Number(p.discount_value ?? 0);
  if (!d || d <= 0) return Number(p.sale_price);
  if (p.discount_type === "percent") return Number(p.sale_price) * (1 - d / 100);
  return Math.max(0, Number(p.sale_price) - d);
}

const parseAmount = (s: string) => parseFloat(s.replace(/\./g, "").replace(",", ".")) || 0;

interface Props {
  visible: boolean;
  tenantId: string;
  target: ChargeTarget | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function ChargeSheet({ visible, tenantId, target, onClose, onSaved }: Props) {
  const router = useRouter();
  const { t } = useTheme();

  // Catálogo
  const [services, setServices] = useState<Service[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [tab, setTab]           = useState<"servicios" | "productos" | "libre">("servicios");
  const [search, setSearch]     = useState("");
  const [freeName, setFreeName]   = useState("");
  const [freePrice, setFreePrice] = useState("");

  // Venta
  const [cart, setCart]       = useState<CartItem[]>([]);
  const [client, setClient]   = useState<ClientLite | null>(null);
  const [clientQ, setClientQ] = useState("");
  const clientResults = useClientSearch(tenantId, clientQ);
  const [discountType, setDiscountType]   = useState<"percentage" | "fixed">("percentage");
  const [discountValue, setDiscountValue] = useState("");
  const [method, setMethod]   = useState("efectivo");
  const [split, setSplit]     = useState(false);
  const [splitLines, setSplitLines] = useState<SplitLine[]>([{ method: "efectivo", amount: "" }, { method: "nequi", amount: "" }]);
  const [note, setNote]       = useState("");
  const [saving, setSaving]   = useState(false);

  // Catálogo del negocio (mismos campos que el POS web)
  useEffect(() => {
    if (!visible || !tenantId) return;
    let cancelled = false;
    Promise.all([
      supabase.from("services").select("id, name, price").eq("tenant_id", tenantId).order("name"),
      supabase.from("products")
        .select("id, name, sale_price, cost_price, discount_type, discount_value, stock_quantity")
        .eq("tenant_id", tenantId).eq("is_active", true).order("name"),
    ]).then(([{ data: svc }, { data: prod }]) => {
      if (cancelled) return;
      setServices(((svc ?? []) as any[]).map(s => ({ id: s.id, name: s.name, price: Number(s.price) })));
      setProducts((prod ?? []) as Product[]);
    });
    return () => { cancelled = true; };
  }, [visible, tenantId]);

  // Estado inicial por apertura: la cita precarga su servicio principal, sus
  // servicios adicionales (appointment_services, igual que el POS web) y el cliente.
  useEffect(() => {
    if (!visible) return;
    setCart([]); setClient(null); setClientQ(""); setDiscountType("percentage"); setDiscountValue("");
    setMethod("efectivo"); setSplit(false);
    setSplitLines([{ method: "efectivo", amount: "" }, { method: "nequi", amount: "" }]);
    setNote(""); setSearch(""); setTab("servicios"); setFreeName(""); setFreePrice("");
    if (target?.kind !== "appointment") return;
    const a = target.appt;
    if (a.clientId) setClient({ id: a.clientId, name: a.clientName ?? "Cliente", phone: "" });
    if (a.serviceId || a.serviceName) {
      setCart([{ key: a.serviceId ?? "main", serviceId: a.serviceId, productId: null, itemType: "service", name: a.serviceName ?? "Servicio", price: a.servicePrice, qty: 1 }]);
    }
    let cancelled = false;
    supabase.from("appointment_services").select("service_id, name, price").eq("appointment_id", a.id)
      .then(({ data }) => {
        if (cancelled || !data?.length) return;
        setCart(prev => [
          ...prev,
          ...(data as any[]).map((ex, i) => ({
            key: `${ex.service_id ?? "extra"}-${i}`, serviceId: ex.service_id ?? null, productId: null,
            itemType: "service" as const, name: ex.name, price: Number(ex.price), qty: 1,
          })),
        ]);
      });
    return () => { cancelled = true; };
  }, [visible, target]);

  // ── Carrito ──
  const addService = (svc: Service) => setCart(prev => {
    const ex = prev.find(i => i.serviceId === svc.id);
    if (ex) return prev.map(i => i.serviceId === svc.id ? { ...i, qty: i.qty + 1 } : i);
    return [...prev, { key: `svc-${svc.id}`, serviceId: svc.id, productId: null, itemType: "service", name: svc.name, price: svc.price, qty: 1 }];
  });
  const addProduct = (p: Product) => {
    if (p.stock_quantity <= 0) { Alert.alert("Sin stock", `${p.name} no tiene unidades disponibles.`); return; }
    setCart(prev => {
      const ex = prev.find(i => i.productId === p.id);
      if (ex) return ex.qty >= p.stock_quantity ? prev : prev.map(i => i.productId === p.id ? { ...i, qty: i.qty + 1 } : i);
      return [...prev, {
        key: `prod-${p.id}`, serviceId: null, productId: p.id, itemType: "product",
        name: p.name, price: productPrice(p), qty: 1, unitCost: p.cost_price, maxQty: p.stock_quantity,
      }];
    });
  };
  const addFree = () => {
    const price = parseAmount(freePrice);
    if (freeName.trim().length < 2 || price <= 0) return;
    setCart(prev => [...prev, { key: `free-${Date.now()}`, serviceId: null, productId: null, itemType: "free", name: freeName.trim(), price, qty: 1 }]);
    setFreeName(""); setFreePrice("");
  };
  const changeQty = (key: string, delta: number) => setCart(prev => prev
    .map(i => i.key === key ? { ...i, qty: Math.min(i.qty + delta, i.maxQty ?? Infinity) } : i)
    .filter(i => i.qty > 0));

  // ── Totales (misma fórmula que el POS web) ──
  const subtotal    = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const discountVal = parseAmount(discountValue);
  const discountAmt = discountType === "percentage"
    ? (subtotal * Math.min(discountVal, 100)) / 100
    : Math.min(discountVal, subtotal);
  const total = Math.max(Math.round(subtotal - discountAmt), 0);

  const splitSum       = split ? splitLines.reduce((s, l) => s + parseAmount(l.amount), 0) : 0;
  const splitRemaining = Math.round(total - splitSum);
  const splitValid     = !split || (Math.abs(splitRemaining) < 1 && splitLines.every(l => parseAmount(l.amount) > 0));

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (tab === "servicios") return services.filter(s => !q || s.name.toLowerCase().includes(q)).slice(0, 40);
    if (tab === "productos") return products.filter(p => !q || p.name.toLowerCase().includes(q)).slice(0, 40);
    return [];
  }, [tab, search, services, products]);

  const canCharge = cart.length > 0 && total >= 0 && splitValid && !saving;

  // ── Cobrar ──
  const handleCharge = async () => {
    if (!canCharge || !target) return;
    setSaving(true);
    try {
      const names = cart.map(i => (i.qty > 1 ? `${i.qty}× ${i.name}` : i.name)).join(" + ");
      const items: SaleItemInput[] = cart.map(i => ({
        name: i.name, price: i.price, quantity: i.qty,
        service_id: i.serviceId, product_id: i.productId,
        item_type: i.itemType === "product" ? "product" : "service",
        unit_cost: i.unitCost ?? null,
      }));
      const res = await recordSale({
        tenantId,
        total,
        subtotal,
        discountType: discountAmt > 0 ? discountType : null,
        discountValue: discountAmt > 0 ? discountVal : 0,
        paymentMethod: split ? "mixto" : method,
        payments: split ? splitLines.map(l => ({ method: l.method, amount: Math.round(parseAmount(l.amount)) })) : null,
        items,
        clientId: client?.id ?? null,
        appointmentId: target.kind === "appointment" ? target.appt.id : null,
        locationId: target.kind === "appointment" ? target.appt.locationId : undefined,
        note: note.trim() || names,
        description: `Venta POS${client ? ` · ${client.name}` : ""} · ${names}`,
      });
      if (!res.ok) {
        if (res.error === "NO_CASH_SESSION") {
          Alert.alert(
            "La caja está cerrada",
            "Abre la caja de esta sede antes de cobrar. Así el cobro queda en el arqueo del día, igual que en el panel web.",
            [
              { text: "Ahora no", style: "cancel" },
              { text: "Abrir caja", onPress: () => { onClose(); router.push("/(admin)/caja"); } },
            ],
          );
          return;
        }
        Alert.alert(
          "No se pudo registrar el cobro",
          res.error === "APPOINTMENT_FAILED"
            ? "El cobro quedó en caja, pero la cita no se marcó como completada. Revísala en la agenda."
            : "Revisa tu conexión e inténtalo de nuevo.",
        );
        if (res.error === "APPOINTMENT_FAILED") { onSaved(); onClose(); }
        return;
      }
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const appt = target?.kind === "appointment" ? target.appt : null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <ModalHeader title={appt ? "Cobrar cita" : "Venta directa"} onClose={onClose} />

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 18 }} keyboardShouldPersistTaps="handled">

            {/* Cita enlazada */}
            {appt && (
              <View style={[s.receipt, { backgroundColor: t.card, borderColor: t.border }]}>
                <View style={s.receiptRow}>
                  <Text style={[s.receiptLabel, { color: t.muted }]}>Cliente</Text>
                  <Text style={[s.receiptVal, { color: t.text }]}>{appt.clientName ?? "Sin cliente"}</Text>
                </View>
                <View style={[s.divider, { backgroundColor: t.border }]} />
                <View style={s.receiptRow}>
                  <Text style={[s.receiptLabel, { color: t.muted }]}>Hora</Text>
                  <Text style={[s.receiptVal, { color: t.text }]}>{fmt12(appt.time.slice(0, 5))}</Text>
                </View>
              </View>
            )}

            {/* Cliente (venta directa) */}
            {!appt && (
              <View>
                <Text style={[s.label, { color: t.muted }]}>Cliente (opcional)</Text>
                {client ? (
                  <View style={[s.clientChip, { backgroundColor: t.card, borderColor: t.border }]}>
                    <Ionicons name="person-circle-outline" size={18} color={Colors.red} />
                    <Text style={[s.clientChipText, { color: t.text }]} numberOfLines={1}>{client.name}</Text>
                    <TouchableOpacity onPress={() => setClient(null)} hitSlop={8}>
                      <Ionicons name="close-circle" size={18} color={t.subtle} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <>
                    <TextInput
                      style={[s.input, { backgroundColor: t.card, borderColor: t.border, color: t.text }]}
                      value={clientQ} onChangeText={setClientQ}
                      placeholder="Buscar por nombre o teléfono" placeholderTextColor={t.subtle}
                    />
                    {(clientResults ?? []).slice(0, 5).map(c => (
                      <TouchableOpacity key={c.id} style={[s.resultRow, { borderColor: t.border }]} onPress={() => { setClient(c); setClientQ(""); }}>
                        <Text style={[s.resultName, { color: t.text }]}>{c.name}</Text>
                        {c.phone ? <Text style={[s.resultSub, { color: t.muted }]}>{c.phone}</Text> : null}
                      </TouchableOpacity>
                    ))}
                  </>
                )}
              </View>
            )}

            {/* Carrito */}
            <View>
              <Text style={[s.label, { color: t.muted }]}>Carrito</Text>
              {cart.length === 0 ? (
                <View style={[s.emptyCart, { borderColor: t.border }]}>
                  <Text style={{ fontFamily: Fonts.regular, fontSize: 13, color: t.subtle }}>Agrega servicios, productos o un ítem libre</Text>
                </View>
              ) : cart.map(i => (
                <View key={i.key} style={[s.cartRow, { backgroundColor: t.card, borderColor: t.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.cartName, { color: t.text }]} numberOfLines={1}>{i.name}</Text>
                    <Text style={[s.cartSub, { color: t.muted }]}>
                      {fmtMoneyFull(i.price)}{i.itemType === "product" ? " · producto" : ""}
                    </Text>
                  </View>
                  <View style={s.qtyBox}>
                    <TouchableOpacity onPress={() => changeQty(i.key, -1)} style={s.qtyBtn} hitSlop={6}>
                      <Ionicons name={i.qty === 1 ? "trash-outline" : "remove"} size={15} color={Colors.red} />
                    </TouchableOpacity>
                    <Text style={[s.qtyText, { color: t.text }]}>{i.qty}</Text>
                    <TouchableOpacity onPress={() => changeQty(i.key, 1)} style={s.qtyBtn} hitSlop={6}
                      disabled={i.maxQty != null && i.qty >= i.maxQty}>
                      <Ionicons name="add" size={15} color={i.maxQty != null && i.qty >= i.maxQty ? t.subtle : Colors.text} />
                    </TouchableOpacity>
                  </View>
                  <Text style={[s.cartLineTotal, { color: t.text }]}>{fmtMoneyFull(i.price * i.qty)}</Text>
                </View>
              ))}
            </View>

            {/* Agregar al carrito */}
            <View>
              <Text style={[s.label, { color: t.muted }]}>Agregar</Text>
              <View style={s.tabs}>
                {([["servicios", "Servicios"], ["productos", "Productos"], ["libre", "Ítem libre"]] as const).map(([key, lbl]) => (
                  <TouchableOpacity key={key} onPress={() => { setTab(key); setSearch(""); }}
                    style={[s.tab, { borderColor: t.border, backgroundColor: t.card }, tab === key && s.tabActive]}>
                    <Text style={[s.tabText, { color: t.muted }, tab === key && { color: "white" }]}>{lbl}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {tab !== "libre" ? (
                <>
                  <TextInput
                    style={[s.input, { backgroundColor: t.card, borderColor: t.border, color: t.text }]}
                    value={search} onChangeText={setSearch}
                    placeholder={tab === "servicios" ? "Buscar servicio" : "Buscar producto"} placeholderTextColor={t.subtle}
                  />
                  {filtered.length === 0 ? (
                    <Text style={{ fontFamily: Fonts.regular, fontSize: 12, color: t.subtle, paddingVertical: 8 }}>
                      {tab === "servicios" ? "Sin servicios" : "Sin productos activos"}
                    </Text>
                  ) : (filtered as any[]).map(item => {
                    const isProd = tab === "productos";
                    const price  = isProd ? productPrice(item as Product) : (item as Service).price;
                    const stock  = isProd ? (item as Product).stock_quantity : null;
                    const out    = isProd && (stock ?? 0) <= 0;
                    return (
                      <TouchableOpacity key={item.id} onPress={() => isProd ? addProduct(item as Product) : addService(item as Service)}
                        style={[s.resultRow, { borderColor: t.border }, out && { opacity: 0.45 }]} activeOpacity={0.75}>
                        <View style={{ flex: 1 }}>
                          <Text style={[s.resultName, { color: t.text }]} numberOfLines={1}>{item.name}</Text>
                          {isProd && <Text style={[s.resultSub, { color: out ? Colors.red : t.muted }]}>{out ? "Sin stock" : `${stock} disponibles`}</Text>}
                        </View>
                        <Text style={[s.resultPrice, { color: t.text }]}>{fmtMoneyFull(price)}</Text>
                        <Ionicons name="add-circle" size={22} color={out ? t.subtle : Colors.red} />
                      </TouchableOpacity>
                    );
                  })}
                </>
              ) : (
                <View style={{ gap: 10 }}>
                  <TextInput style={[s.input, { backgroundColor: t.card, borderColor: t.border, color: t.text }]}
                    value={freeName} onChangeText={setFreeName} placeholder="Concepto (ej: Propina, Tratamiento)" placeholderTextColor={t.subtle} />
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <TextInput style={[s.input, { flex: 1, backgroundColor: t.card, borderColor: t.border, color: t.text }]}
                      value={freePrice} onChangeText={setFreePrice} placeholder="Precio" placeholderTextColor={t.subtle} keyboardType="numeric" />
                    <TouchableOpacity onPress={addFree} style={[s.addFreeBtn, (freeName.trim().length < 2 || parseAmount(freePrice) <= 0) && { opacity: 0.4 }]}
                      disabled={freeName.trim().length < 2 || parseAmount(freePrice) <= 0}>
                      <Ionicons name="add" size={18} color="white" />
                      <Text style={s.addFreeText}>Agregar</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>

            {/* Descuento */}
            <View>
              <Text style={[s.label, { color: t.muted }]}>Descuento (opcional)</Text>
              <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                <View style={[s.segment, { borderColor: t.border, backgroundColor: t.card }]}>
                  {(["percentage", "fixed"] as const).map(k => (
                    <TouchableOpacity key={k} onPress={() => setDiscountType(k)} style={[s.segmentBtn, discountType === k && s.segmentBtnActive]}>
                      <Text style={[s.segmentText, { color: t.muted }, discountType === k && { color: "white" }]}>{k === "percentage" ? "%" : "$"}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput style={[s.input, { flex: 1, marginBottom: 0, backgroundColor: t.card, borderColor: t.border, color: t.text }]}
                  value={discountValue} onChangeText={setDiscountValue} placeholder={discountType === "percentage" ? "0 %" : "$ 0"}
                  placeholderTextColor={t.subtle} keyboardType="numeric" />
                {discountAmt > 0 && <Text style={{ fontFamily: Fonts.bold, fontSize: 13, color: Colors.success }}>−{fmtMoneyFull(discountAmt)}</Text>}
              </View>
            </View>

            {/* Pago */}
            <View>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <Text style={[s.label, { color: t.muted, marginBottom: 0 }]}>¿Cómo pagó el cliente?</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={{ fontFamily: Fonts.semibold, fontSize: 12, color: t.muted }}>Dividir pago</Text>
                  <Switch value={split} onValueChange={setSplit} trackColor={{ false: "rgba(20,15,30,0.12)", true: Colors.red + "60" }} thumbColor={split ? Colors.red : "#f4f3f4"} />
                </View>
              </View>
              {!split ? (
                <View style={s.methodGrid}>
                  {PAY_METHODS.map(m => {
                    const active = method === m.key;
                    return (
                      <TouchableOpacity key={m.key} onPress={() => setMethod(m.key)} activeOpacity={0.8}
                        style={[s.methodChip, { backgroundColor: t.card, borderColor: t.border }, active && { backgroundColor: Colors.red, borderColor: Colors.red }]}>
                        <Ionicons name={m.icon} size={15} color={active ? "white" : m.color} />
                        <Text style={[s.methodText, { color: t.text }, active && { color: "white" }]}>{m.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : (
                <View style={{ gap: 10 }}>
                  {splitLines.map((l, idx) => (
                    <View key={idx} style={[s.splitRow, { backgroundColor: t.card, borderColor: t.border }]}>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} style={{ flex: 1 }}>
                        {PAY_METHODS.map(m => {
                          const active = l.method === m.key;
                          return (
                            <TouchableOpacity key={m.key} onPress={() => setSplitLines(prev => prev.map((x, i) => i === idx ? { ...x, method: m.key } : x))}
                              style={[s.miniChip, { borderColor: t.border }, active && { backgroundColor: m.color, borderColor: m.color }]}>
                              <Text style={[s.miniChipText, { color: t.muted }, active && { color: "white" }]}>{m.label}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </ScrollView>
                      <TextInput style={[s.splitInput, { borderColor: t.border, color: t.text }]} value={l.amount}
                        onChangeText={v => setSplitLines(prev => prev.map((x, i) => i === idx ? { ...x, amount: v } : x))}
                        placeholder="$ 0" placeholderTextColor={t.subtle} keyboardType="numeric" />
                      {splitLines.length > 2 && (
                        <TouchableOpacity onPress={() => setSplitLines(prev => prev.filter((_, i) => i !== idx))} hitSlop={6}>
                          <Ionicons name="close-circle" size={18} color={t.subtle} />
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <TouchableOpacity onPress={() => setSplitLines(prev => [...prev, { method: "tarjeta", amount: "" }])} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <Ionicons name="add-circle-outline" size={16} color={Colors.red} />
                      <Text style={{ fontFamily: Fonts.semibold, fontSize: 12, color: Colors.red }}>Otro método</Text>
                    </TouchableOpacity>
                    <Text style={{ fontFamily: Fonts.bold, fontSize: 12, color: Math.abs(splitRemaining) < 1 ? Colors.success : Colors.red }}>
                      {Math.abs(splitRemaining) < 1 ? "Cuadra ✓" : splitRemaining > 0 ? `Faltan ${fmtMoneyFull(splitRemaining)}` : `Sobran ${fmtMoneyFull(-splitRemaining)}`}
                    </Text>
                  </View>
                </View>
              )}
            </View>

            {/* Nota */}
            <View>
              <Text style={[s.label, { color: t.muted }]}>Nota (opcional)</Text>
              <TextInput style={[s.input, { backgroundColor: t.card, borderColor: t.border, color: t.text }]}
                value={note} onChangeText={setNote} placeholder="Ej: pagó con billete de 100" placeholderTextColor={t.subtle} />
            </View>

            {/* Totales */}
            <View style={[s.totals, { backgroundColor: t.card, borderColor: t.border }]}>
              <View style={s.totalRow}><Text style={[s.totalLabel, { color: t.muted }]}>Subtotal</Text><Text style={[s.totalVal, { color: t.text }]}>{fmtMoneyFull(subtotal)}</Text></View>
              {discountAmt > 0 && <View style={s.totalRow}><Text style={[s.totalLabel, { color: t.muted }]}>Descuento</Text><Text style={[s.totalVal, { color: Colors.success }]}>−{fmtMoneyFull(discountAmt)}</Text></View>}
              <View style={[s.divider, { backgroundColor: t.border }]} />
              <View style={s.totalRow}><Text style={[s.totalLabel, { color: t.text, fontFamily: Fonts.bold, fontSize: 15 }]}>Total</Text><Text style={[s.grandTotal, { color: t.text }]}>{fmtMoneyFull(total)}</Text></View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>

        <BottomSaveBar
          label={total > 0 ? `Cobrar ${fmtMoneyFull(total)}` : "Registrar cobro"}
          saving={saving}
          disabled={!canCharge}
          onPress={handleCharge}
        />
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  label:         { fontSize: 11, fontFamily: Fonts.bold, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 },
  input:         { borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontFamily: Fonts.regular, marginBottom: 8 },
  receipt:       { borderWidth: 1, borderRadius: Radius.lg, paddingHorizontal: 16, paddingVertical: 4 },
  receiptRow:    { flexDirection: "row", justifyContent: "space-between", paddingVertical: 11 },
  receiptLabel:  { fontSize: 13, fontFamily: Fonts.regular },
  receiptVal:    { fontSize: 13, fontFamily: Fonts.semibold },
  divider:       { height: 1 },
  clientChip:    { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: 12, paddingVertical: 10 },
  clientChipText:{ flex: 1, fontSize: 14, fontFamily: Fonts.semibold },
  resultRow:     { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11, borderBottomWidth: 1 },
  resultName:    { fontSize: 14, fontFamily: Fonts.semibold },
  resultSub:     { fontSize: 11, fontFamily: Fonts.regular, marginTop: 1 },
  resultPrice:   { fontSize: 13, fontFamily: Fonts.bold },
  emptyCart:     { borderWidth: 1, borderStyle: "dashed", borderRadius: Radius.md, padding: 16, alignItems: "center" },
  cartRow:       { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: Radius.md, padding: 12, marginBottom: 8 },
  cartName:      { fontSize: 14, fontFamily: Fonts.semibold },
  cartSub:       { fontSize: 11, fontFamily: Fonts.regular, marginTop: 1 },
  qtyBox:        { flexDirection: "row", alignItems: "center", gap: 6 },
  qtyBtn:        { width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(20,15,30,0.05)", alignItems: "center", justifyContent: "center" },
  qtyText:       { fontSize: 14, fontFamily: Fonts.bold, minWidth: 18, textAlign: "center" },
  cartLineTotal: { fontSize: 13, fontFamily: Fonts.bold, minWidth: 74, textAlign: "right" },
  tabs:          { flexDirection: "row", gap: 8, marginBottom: 10 },
  tab:           { flex: 1, borderWidth: 1, borderRadius: Radius.full, paddingVertical: 8, alignItems: "center" },
  tabActive:     { backgroundColor: Colors.red, borderColor: Colors.red },
  tabText:       { fontSize: 12, fontFamily: Fonts.semibold },
  addFreeBtn:    { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: Colors.red, borderRadius: Radius.md, paddingHorizontal: 14, height: 46 },
  addFreeText:   { fontSize: 13, fontFamily: Fonts.bold, color: "white" },
  segment:       { flexDirection: "row", borderWidth: 1, borderRadius: Radius.md, overflow: "hidden" },
  segmentBtn:    { paddingHorizontal: 16, paddingVertical: 12 },
  segmentBtnActive: { backgroundColor: Colors.red },
  segmentText:   { fontSize: 14, fontFamily: Fonts.bold },
  methodGrid:    { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  methodChip:    { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: Radius.full, paddingHorizontal: 12, paddingVertical: 9 },
  methodText:    { fontSize: 13, fontFamily: Fonts.semibold },
  splitRow:      { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: Radius.md, padding: 8 },
  miniChip:      { borderWidth: 1, borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 6 },
  miniChipText:  { fontSize: 11, fontFamily: Fonts.semibold },
  splitInput:    { width: 100, borderWidth: 1, borderRadius: Radius.sm, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, fontFamily: Fonts.bold, textAlign: "right" },
  totals:        { ...Glass.cardStrong, borderRadius: Radius.lg, paddingHorizontal: 16, paddingVertical: 6 },
  totalRow:      { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8 },
  totalLabel:    { fontSize: 13, fontFamily: Fonts.regular },
  totalVal:      { fontSize: 13, fontFamily: Fonts.semibold },
  grandTotal:    { fontSize: 22, fontFamily: Fonts.bold, letterSpacing: -0.5 },
});
