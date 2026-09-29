import { useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, Modal, ScrollView, StyleSheet, TouchableOpacity, TextInput,
  KeyboardAvoidingView, Platform, Alert, Switch, Linking, ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { useTheme } from "@/lib/theme";
import { useTenant } from "@/lib/tenant";
import { useClientSearch, type ClientLite } from "@/lib/useClientSearch";
import { findOpenCashSession, recordSale, type SaleItemInput } from "@/lib/record-sale";
import { fmtMoneyFull, fmt12, enlaceWhatsApp } from "@/lib/format";
import { diaLocalDe, horaLocalDe, fmtDia, esHoy } from "@/lib/tz";
import { mensajeError, nuevoId } from "@/lib/db";
import { cancelarRecordatorioCita } from "@/lib/notifications";
import { leerMonto, monedaSinDecimales, montoATexto, parseMonto, parsePorcentaje, sugerenciasEfectivo } from "@/lib/dinero";
import { MEDIOS, MEDIO_DIVIDIDO, medioDePago } from "@/lib/medios-pago";
import { textoRecibo } from "@/lib/recibo";
import { Colors, Fonts, Radius } from "@/constants/theme";
import ModalHeader from "@/components/ModalHeader";
import BottomSaveBar from "@/components/BottomSaveBar";
import MetodosPago from "@/components/cobros/MetodosPago";

/**
 * Hoja de cobro del móvil — paridad con el POS web (src/app/admin/pos):
 * carrito con varios servicios (incluye los servicios adicionales de la cita),
 * productos con stock (descuenta inventario), ítem libre, descuento % o fijo,
 * pago con un método o dividido en varios, y cliente para ventas directas.
 *
 * Sirve tanto para cobrar una cita como para una venta directa (target).
 *
 * Doble cobro (D8 / DIN-06): cada apertura genera un id de venta que se
 * reutiliza en los reintentos (recordSale lo usa como clave de idempotencia),
 * el botón no admite dos toques y, al abrir una cita que ya tiene cobro, se
 * muestra ese cobro en vez del formulario.
 */

// Los métodos viven en lib/medios-pago; estos nombres se conservan para
// Finanzas y el Historial, que los importan de aquí.
export const PAY_METHODS = MEDIOS;
export const MIXTO_METHOD = MEDIO_DIVIDIDO;
export const methodCfg = medioDePago;

export type LinkedAppt = {
  id: string;
  clientId: string | null;
  clientName: string | null;
  /** Para el recibo por WhatsApp tras el cobro. */
  clientPhone?: string | null;
  serviceId: string | null;
  serviceName: string | null;
  servicePrice: number;
  locationId: string | null;
  time: string;
};

/** Resumen del cobro ya registrado, para la pantalla de éxito. */
type DoneSale = {
  total: number;
  subtotal: number;
  discount: number;
  methodLabel: string;
  change: number | null;
  clientName: string | null;
  clientPhone: string | null;
  apptCompleted: boolean;
  items: { name: string; qty: number; price: number }[];
  /** Algo que el usuario debe saber (la cita no se marcó, el cobro ya existía…). */
  aviso: string | null;
};

/** Cobro que ya tiene la cita (se muestra en vez de volver a cobrar). */
type CobroPrevio = { id: string; total: number; payment_method: string; created_at: string };

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
type Estado = "cargando" | "listo" | "error";

// Espejo de productEffectivePrice del POS web y effectivePrice de inventario.tsx
function productPrice(p: Product): number {
  const d = Number(p.discount_value ?? 0);
  if (!d || d <= 0) return Number(p.sale_price);
  if (p.discount_type === "percent") return Number(p.sale_price) * (1 - d / 100);
  return Math.max(0, Number(p.sale_price) - d);
}

interface Props {
  visible: boolean;
  tenantId: string;
  target: ChargeTarget | null;
  onClose: () => void;
  onSaved: () => void;
  /** Nombre del negocio para el recibo por WhatsApp (por defecto, el del negocio con sesión). */
  businessName?: string | null;
}

export default function ChargeSheet({ visible, tenantId, target, onClose, onSaved, businessName }: Props) {
  const router = useRouter();
  const { t, mode } = useTheme();
  const { tenant, timezone } = useTenant();
  // El azul de marca casi no se lee sobre el fondo oscuro.
  const azul = mode === "dark" ? "#8da2ff" : Colors.blue;

  // Montos: en pesos solo cuentan los dígitos; con centavos, "," o "." (DIN-18).
  const conDecimales = !monedaSinDecimales();
  const monto = (x: string) => parseMonto(x, { decimales: conDecimales });
  const tecladoMonto = conDecimales ? "decimal-pad" : "number-pad";

  // Catálogo
  const [services, setServices] = useState<Service[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [catalogo, setCatalogo] = useState<Estado>("cargando");
  const [catalogoError, setCatalogoError] = useState<unknown>(null);
  const [tab, setTab]           = useState<"servicios" | "productos" | "libre">("servicios");
  const [search, setSearch]     = useState("");
  // Sin búsqueda se muestran los primeros del catálogo: con 40 servicios la
  // lista empujaba el pago hasta el fondo.
  const [verTodo, setVerTodo]   = useState(false);
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
  // Efectivo: cuánto entrega el cliente, para mostrar el cambio.
  const [cashReceived, setCashReceived] = useState("");
  // Al cobrar una cita, lo raro (agregar más, descuento, nota) va plegado para
  // que el camino corto —ítems, método, cobrar— se lea de un vistazo.
  const [showMore, setShowMore] = useState(false);
  // Cobro registrado: se muestra la pantalla de éxito en vez de cerrar en seco.
  const [done, setDone] = useState<DoneSale | null>(null);
  // Adicionales de la cita: si no cargan, no se cobra (se cobraría de menos).
  const [extras, setExtras] = useState<Estado>("listo");
  // ¿La cita ya tiene cobro? Mientras se revisa, "Cobrar" espera.
  const [revisando, setRevisando] = useState(false);
  const [cobroPrevio, setCobroPrevio] = useState<CobroPrevio | null>(null);
  // Sin caja abierta no se puede cobrar (recordSale la exige). Se revisa al
  // abrir para avisar ANTES de armar el cobro; si la revisión falla no se
  // bloquea nada: recordSale vuelve a revisar al cobrar.
  const [caja, setCaja] = useState<"revisando" | "abierta" | "cerrada" | "desconocida">("revisando");

  // Clave de idempotencia: una por apertura, la misma en cada reintento.
  const saleIdRef = useRef<string>(nuevoId());
  const enviando = useRef(false);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const targetRef = useRef(target);
  targetRef.current = target;
  // Identidad estable del objetivo: la agenda arma `target` en cada render y
  // antes eso reiniciaba el carrito con la hoja abierta.
  const targetKey = !target ? "" : target.kind === "appointment" ? `a:${target.appt.id}` : "direct";
  const aperturaRef = useRef(0);

  const cargarCatalogo = async () => {
    setCatalogo("cargando");
    const apertura = aperturaRef.current;
    const [svc, prod] = await Promise.all([
      // select("*"): services.is_active llega con la migración; antes de
      // aplicarla, pedir la columna rompería la consulta. Se filtra aquí.
      supabase.from("services").select("*").eq("tenant_id", tenantId).order("name"),
      supabase.from("products")
        .select("id, name, sale_price, cost_price, discount_type, discount_value, stock_quantity")
        .eq("tenant_id", tenantId).eq("is_active", true).order("name"),
    ]);
    if (apertura !== aperturaRef.current) return;
    const err = svc.error || prod.error;
    if (err) { setCatalogoError(err); setCatalogo("error"); return; }
    setServices(((svc.data ?? []) as { id: string; name: string; price: number; is_active?: boolean | null }[])
      .filter(x => x.is_active !== false)
      .map(x => ({ id: x.id, name: x.name, price: Number(x.price) })));
    setProducts((prod.data ?? []) as Product[]);
    setCatalogo("listo");
  };

  const cargarExtras = async (appointmentId: string) => {
    setExtras("cargando");
    const apertura = aperturaRef.current;
    const { data, error } = await supabase.from("appointment_services")
      .select("service_id, name, price").eq("appointment_id", appointmentId).order("created_at");
    if (apertura !== aperturaRef.current) return;
    if (error) { setExtras("error"); return; }
    const filas = (data ?? []) as { service_id: string | null; name: string; price: number }[];
    if (filas.length > 0) {
      setCart(prev => [
        ...prev.filter(i => !i.key.startsWith("extra-")),
        ...filas.map((ex, i) => ({
          key: `extra-${ex.service_id ?? "x"}-${i}`, serviceId: ex.service_id ?? null, productId: null,
          itemType: "service" as const, name: ex.name, price: Number(ex.price), qty: 1,
        })),
      ]);
    }
    setExtras("listo");
  };

  const revisarCaja = async (locationId: string | null | undefined) => {
    setCaja("revisando");
    const apertura = aperturaRef.current;
    try {
      // La misma sede con que recordSale busca la caja: la de la cita o la activa.
      const abierta = await findOpenCashSession(tenantId, locationId ?? undefined);
      if (apertura === aperturaRef.current) setCaja(abierta ? "abierta" : "cerrada");
    } catch {
      if (apertura === aperturaRef.current) setCaja("desconocida");
    }
  };

  const revisarCobroPrevio = async (appointmentId: string) => {
    setRevisando(true);
    const apertura = aperturaRef.current;
    const { data, error } = await supabase.from("pos_sales")
      .select("id, total, payment_method, created_at")
      .eq("appointment_id", appointmentId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (apertura !== aperturaRef.current) return;
    setRevisando(false);
    // Si la revisión falla se deja cobrar: recordSale vuelve a revisar antes
    // de crear la venta y, sin poder consultar, no cobra.
    if (error || !data || data.length === 0) return;
    setCobroPrevio(data[0] as CobroPrevio);
    // La cita pudo quedar sin marcar si aquel cobro falló al final.
    const upd = await supabase.from("appointments").update({ status: "completed" })
      .eq("id", appointmentId).in("status", ["pending", "confirmed"]).select("id");
    if (!upd.error && (upd.data ?? []).length > 0) onSavedRef.current();
  };

  // Estado inicial por apertura: la cita precarga su servicio principal, sus
  // servicios adicionales (appointment_services, igual que el POS web) y el cliente.
  useEffect(() => {
    if (!visible) return;
    aperturaRef.current++;
    saleIdRef.current = nuevoId();
    enviando.current = false;
    const tg = targetRef.current;
    setCart([]); setClient(null); setClientQ(""); setDiscountType("percentage"); setDiscountValue("");
    setMethod("efectivo"); setSplit(false);
    setSplitLines([{ method: "efectivo", amount: "" }, { method: "nequi", amount: "" }]);
    setNote(""); setSearch(""); setVerTodo(false); setTab("servicios"); setFreeName(""); setFreePrice("");
    setCashReceived(""); setDone(null); setCobroPrevio(null); setSaving(false);
    setShowMore(tg?.kind !== "appointment");
    if (tenantId) {
      cargarCatalogo();
      revisarCaja(tg?.kind === "appointment" ? tg.appt.locationId : undefined);
    }
    if (tg?.kind !== "appointment") { setExtras("listo"); setRevisando(false); return; }
    const a = tg.appt;
    if (a.clientId) setClient({ id: a.clientId, name: a.clientName ?? "Cliente", phone: a.clientPhone ?? "" });
    if (a.serviceId || a.serviceName) {
      setCart([{ key: a.serviceId ?? "main", serviceId: a.serviceId, productId: null, itemType: "service", name: a.serviceName ?? "Servicio", price: a.servicePrice, qty: 1 }]);
    }
    cargarExtras(a.id);
    revisarCobroPrevio(a.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, targetKey, tenantId]);

  // ── Carrito ──
  const addService = (svc: Service) => setCart(prev => {
    const ex = prev.find(i => i.serviceId === svc.id && !i.key.startsWith("extra-"));
    if (ex) return prev.map(i => i.key === ex.key ? { ...i, qty: i.qty + 1 } : i);
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
  const freePriceNum = leerMonto(freePrice, { decimales: conDecimales });
  const freeOk = freeName.trim().length >= 2 && (freePriceNum ?? 0) > 0;
  const addFree = () => {
    if (!freeOk) return;
    setCart(prev => [...prev, { key: `free-${Date.now()}`, serviceId: null, productId: null, itemType: "free", name: freeName.trim(), price: freePriceNum ?? 0, qty: 1 }]);
    setFreeName(""); setFreePrice("");
  };
  const changeQty = (key: string, delta: number) => setCart(prev => prev
    .map(i => i.key === key ? { ...i, qty: Math.min(i.qty + delta, i.maxQty ?? Infinity) } : i)
    .filter(i => i.qty > 0));

  // ── Totales (misma fórmula que el POS web) ──
  const subtotal    = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
  const discountVal = discountType === "percentage" ? parsePorcentaje(discountValue) : monto(discountValue);
  const discountAmt = discountType === "percentage"
    ? (subtotal * discountVal) / 100
    : Math.min(discountVal, subtotal);
  const total = Math.max(Math.round(subtotal - discountAmt), 0);

  const splitSum       = split ? splitLines.reduce((sum, l) => sum + monto(l.amount), 0) : 0;
  const splitRemaining = Math.round(total - splitSum);
  const splitValid     = !split || (Math.abs(splitRemaining) < 1 && splitLines.every(l => monto(l.amount) > 0));

  const coincidencias = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (tab === "servicios") return services.filter(x => !q || x.name.toLowerCase().includes(q));
    if (tab === "productos") return products.filter(x => !q || x.name.toLowerCase().includes(q));
    return [];
  }, [tab, search, services, products]);
  const TOPE_CATALOGO = 8;
  const recortar = !verTodo && !search.trim() && coincidencias.length > TOPE_CATALOGO;
  const filtered = coincidencias.slice(0, recortar ? TOPE_CATALOGO : 40);

  const canCharge = cart.length > 0 && total >= 0 && splitValid && !saving && extras === "listo" && !revisando && caja !== "cerrada";

  // Por qué "Cobrar" está apagado, dicho junto al botón (antes el botón solo
  // se veía gris y la razón quedaba arriba, en el pago dividido).
  const motivo = saving ? null
    : revisando ? "Revisando si la cita ya tiene cobro…"
    : extras === "cargando" ? "Cargando los servicios adicionales de la cita…"
    : extras === "error" ? "Reintenta cargar los servicios adicionales para cobrar la cita completa."
    : caja === "cerrada" ? "Abre la caja para poder cobrar."
    : cart.length === 0 ? "Agrega al menos un servicio, producto o ítem libre."
    : split && splitLines.some(l => monto(l.amount) <= 0) ? "Escribe el monto de cada método del pago dividido."
    : split && splitRemaining > 0 ? `Faltan ${fmtMoneyFull(splitRemaining)} por repartir en el pago dividido.`
    : split && splitRemaining < 0 ? `Sobran ${fmtMoneyFull(-splitRemaining)} en el pago dividido.`
    : null;

  /** Pone en esa línea lo que falta para que el pago dividido cuadre. */
  const ponerResto = (idx: number) => setSplitLines(prev => prev.map((x, i) =>
    i === idx ? { ...x, amount: montoATexto(monto(x.amount) + splitRemaining, { decimales: conDecimales }) } : x));

  // Cuánto suele entregar el cliente en efectivo: "Exacto" y los billetes que siguen.
  const atajosEfectivo = useMemo(() => sugerenciasEfectivo(total, { decimales: conDecimales }), [total, conDecimales]);

  /** Cuántas unidades de ese servicio o producto ya están en el cobro (sin contar los adicionales de la cita). */
  const enElCobro = (id: string, esProducto: boolean) => cart
    .filter(i => (esProducto ? i.productId === id : i.serviceId === id && !i.key.startsWith("extra-")))
    .reduce((sum, i) => sum + i.qty, 0);

  // ── Cobrar ──
  const handleCharge = async () => {
    if (!canCharge || !target || enviando.current) return;
    enviando.current = true;
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
        saleId: saleIdRef.current,
        tenantId,
        total,
        subtotal,
        discountType: discountAmt > 0 ? discountType : null,
        discountValue: discountAmt > 0 ? discountVal : 0,
        paymentMethod: split ? "mixto" : method,
        payments: split ? splitLines.map(l => ({ method: l.method, amount: Math.round(monto(l.amount)) })) : null,
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
            `${res.message} Así el cobro queda en el arqueo del día, igual que en el panel web.`,
            [
              { text: "Ahora no", style: "cancel" },
              { text: "Abrir caja", onPress: () => { onClose(); router.push("/(admin)/caja"); } },
            ],
          );
          return;
        }
        if (res.error === "ALREADY_CHARGED") {
          Alert.alert("Esta cita ya se cobró", res.message);
          onSaved();
          onClose();
          return;
        }
        if (res.error !== "APPOINTMENT_FAILED") {
          // SALE_FAILED: la hoja queda abierta con el MISMO id de venta, así
          // que reintentar completa lo que haya quedado a medias sin duplicar.
          // Si se cierra, la próxima apertura usa otro id: por eso, cuando
          // quedó algo a medias, se pide expresamente no cerrarla.
          Alert.alert(
            "No se pudo registrar el cobro",
            res.pendiente
              ? `${res.message}\n\nParte del cobro alcanzó a guardarse. No cierres esta ventana: toca Cobrar otra vez cuando vuelva la conexión para completarlo sin duplicarlo.`
              : res.message,
          );
          return;
        }
        // APPOINTMENT_FAILED: el cobro sí quedó; se muestra el éxito con el aviso.
      }

      // Cobrar = completar (D10): el aviso "Cita próxima" del teléfono ya no
      // aplica. Antes lo cancelaba el cambio manual a Completada, que ya no existe.
      if (res.ok && target.kind === "appointment") cancelarRecordatorioCita(target.appt.id).catch(() => {});

      onSaved();
      const received = monto(cashReceived);
      const change = (!split && method === "efectivo" && cashReceived && received >= total) ? received - total : null;
      const methodLabel = split
        ? splitLines.map(l => methodCfg(l.method)?.label ?? l.method).join(" + ")
        : (methodCfg(method)?.label ?? method);
      setDone({
        total, subtotal, discount: Math.round(discountAmt), methodLabel, change,
        clientName: client?.name ?? null,
        clientPhone: client?.phone || (target.kind === "appointment" ? target.appt.clientPhone ?? null : null),
        apptCompleted: target.kind === "appointment" && res.ok,
        items: cart.map(i => ({ name: i.name, qty: i.qty, price: i.price })),
        aviso: !res.ok
          ? res.message
          : res.yaExistia ? "Este cobro ya se había registrado en un intento anterior: no se duplicó." : null,
      });
    } catch (e) {
      Alert.alert("No se pudo registrar el cobro", mensajeError(e));
    } finally {
      enviando.current = false;
      setSaving(false);
    }
  };

  const appt = target?.kind === "appointment" ? target.appt : null;

  const cashReceivedNum = monto(cashReceived);
  const cashOk    = !!cashReceived && cashReceivedNum >= total;
  const cashChange = cashOk ? cashReceivedNum - total : null;
  const methodLabelNow = split ? "pago dividido" : (methodCfg(method)?.label ?? method);
  const nombreNegocio = businessName ?? tenant?.name ?? "Tu negocio";

  // ── La cita ya tiene cobro: no se ofrece cobrar otra vez ──
  if (cobroPrevio && !done) {
    const dia = diaLocalDe(cobroPrevio.created_at, timezone);
    const cuando = `${esHoy(dia, timezone) ? "hoy" : fmtDia(dia, "corto")} a las ${fmt12(horaLocalDe(cobroPrevio.created_at, timezone))}`;
    return (
      <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
        <View style={{ flex: 1, backgroundColor: t.bg }}>
          <ModalHeader title="Cita ya cobrada" onClose={onClose} />
          <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40, alignItems: "center", gap: 14 }}>
            <View style={s.doneIcon}><Ionicons name="checkmark" size={34} color="white" /></View>
            <Text style={[s.doneTotal, { color: t.text }]}>{fmtMoneyFull(Number(cobroPrevio.total))}</Text>
            <Text style={[s.doneMeta, { color: t.muted, textAlign: "center" }]}>
              {methodCfg(cobroPrevio.payment_method)?.label ?? cobroPrevio.payment_method} · cobrado {cuando}
            </Text>
            <Text style={[s.infoText, { color: t.muted }]}>
              {appt?.clientName ? `La cita de ${appt.clientName}` : "Esta cita"} ya tiene un cobro registrado, así que no se vuelve a cobrar.
              Si hay que corregirlo, anúlalo desde el historial de cobros y vuelve a cobrar.
            </Text>
            <TouchableOpacity onPress={() => { onClose(); router.push("/(admin)/pos-history" as never); }}
              style={[s.secondaryBtn, { borderColor: t.line }]} activeOpacity={0.85} accessibilityRole="button">
              <Ionicons name="time-outline" size={17} color={t.text} />
              <Text style={[s.secondaryBtnText, { color: t.text }]}>Ver historial de cobros</Text>
            </TouchableOpacity>
          </ScrollView>
          <BottomSaveBar label="Entendido" saving={false} onPress={onClose} />
        </View>
      </Modal>
    );
  }

  // ── Pantalla de éxito ──
  if (done) {
    const wa = done.clientPhone
      ? enlaceWhatsApp(done.clientPhone, { texto: textoRecibo(nombreNegocio, done) })
      : null;
    return (
      <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
        <View style={{ flex: 1, backgroundColor: t.bg }}>
          <ModalHeader title="Cobro registrado" onClose={onClose} />
          <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40, alignItems: "center", gap: 14 }}>
            <View style={s.doneIcon}><Ionicons name="checkmark" size={34} color="white" /></View>
            <Text style={[s.doneTotal, { color: t.text }]}>{fmtMoneyFull(done.total)}</Text>
            <Text style={[s.doneMeta, { color: t.muted }]}>{done.methodLabel}{done.clientName ? ` · ${done.clientName}` : ""}</Text>
            {done.aviso && (
              <View style={s.avisoBox}>
                <Ionicons name="alert-circle-outline" size={16} color="#d97706" />
                <Text style={s.avisoText}>{done.aviso}</Text>
              </View>
            )}
            {done.change !== null && done.change > 0 && (
              <View style={s.doneChange}>
                <Text style={s.doneChangeLabel}>Entrega de cambio</Text>
                <Text style={s.doneChangeVal}>{fmtMoneyFull(done.change)}</Text>
              </View>
            )}
            {done.apptCompleted && (
              <View style={s.doneApptRow}>
                <Ionicons name="checkmark-circle" size={15} color={Colors.success} />
                <Text style={s.doneApptText}>La cita quedó Completada en la agenda.</Text>
              </View>
            )}
            <View style={[s.receipt, { backgroundColor: t.card, borderColor: t.border, alignSelf: "stretch", marginTop: 6 }]}>
              {done.items.map((it, i) => (
                <View key={i}>
                  {i > 0 && <View style={[s.divider, { backgroundColor: t.border }]} />}
                  <View style={s.receiptRow}>
                    <Text style={[s.receiptLabel, { color: t.text, flex: 1 }]} numberOfLines={1}>{it.name}{it.qty > 1 ? ` × ${it.qty}` : ""}</Text>
                    <Text style={[s.receiptVal, { color: t.text }]}>{fmtMoneyFull(it.price * it.qty)}</Text>
                  </View>
                </View>
              ))}
              {done.discount > 0 && (
                <>
                  <View style={[s.divider, { backgroundColor: t.border }]} />
                  <View style={s.receiptRow}>
                    <Text style={[s.receiptLabel, { color: t.muted, flex: 1 }]}>Descuento</Text>
                    <Text style={[s.receiptVal, { color: Colors.success }]}>−{fmtMoneyFull(done.discount)}</Text>
                  </View>
                </>
              )}
              <View style={[s.divider, { backgroundColor: t.border }]} />
              <View style={s.receiptRow}>
                <Text style={[s.receiptLabel, { color: t.text, flex: 1, fontFamily: Fonts.bold }]}>Total</Text>
                <Text style={[s.receiptVal, { color: t.text, fontFamily: Fonts.bold }]}>{fmtMoneyFull(done.total)}</Text>
              </View>
            </View>
            {wa ? (
              <TouchableOpacity onPress={() => Linking.openURL(wa)} style={s.waBtn} activeOpacity={0.85} accessibilityRole="button">
                <Ionicons name="logo-whatsapp" size={18} color="#128C7E" />
                <Text style={s.waBtnText}>Enviar recibo por WhatsApp</Text>
              </TouchableOpacity>
            ) : done.clientPhone ? (
              <Text style={[s.infoText, { color: t.subtle }]}>El teléfono del cliente no es un número válido de WhatsApp.</Text>
            ) : null}
          </ScrollView>
          <BottomSaveBar label="Listo" saving={false} onPress={onClose} />
        </View>
      </Modal>
    );
  }

  // ── Bloques del formulario ──
  // Cobrar una cita: lo que se cobra ya viene; se elige cómo pagó y se cobra.
  // Venta directa: primero se elige qué se vende (antes el catálogo quedaba
  // debajo del pago y había que bajar para empezar).

  const avisoCaja = caja === "cerrada" ? (
    <View style={s.cajaBox}>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Ionicons name="lock-closed-outline" size={18} color="#b45309" />
        <View style={{ flex: 1 }}>
          <Text style={[s.cajaTitulo, { color: t.text }]}>La caja está cerrada</Text>
          <Text style={[s.cajaTexto, { color: t.muted }]}>Para cobrar, abre la caja de esta sede: así el cobro queda en el arqueo del día, igual que en el panel web.</Text>
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
        <TouchableOpacity onPress={() => { onClose(); router.push("/(admin)/caja"); }} style={s.cajaBtn} activeOpacity={0.85} accessibilityRole="button">
          <Text style={s.cajaBtnTxt}>Abrir caja</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => revisarCaja(appt?.locationId)} style={[s.cajaBtnSec, { borderColor: t.lineStrong }]} activeOpacity={0.85} accessibilityRole="button">
          <Text style={[s.cajaBtnSecTxt, { color: t.text }]}>Ya la abrí</Text>
        </TouchableOpacity>
      </View>
    </View>
  ) : null;

  const bannerCita = appt ? (
    <View style={s.apptBanner}>
      <View style={s.apptBannerIcon}><Ionicons name="calendar-outline" size={18} color={Colors.success} /></View>
      <View style={{ flex: 1 }}>
        <Text style={s.apptBannerKicker}>Cobrando una cita</Text>
        <Text style={[s.apptBannerTitle, { color: t.text }]} numberOfLines={1}>{appt.clientName ?? "Sin cliente"}</Text>
        <Text style={[s.apptBannerMeta, { color: t.muted }]} numberOfLines={1}>{appt.serviceName ?? "Servicio"} · {fmt12(appt.time.slice(0, 5))}</Text>
        <Text style={[s.apptBannerHint, { color: t.muted }]}>Al cobrar, la cita queda Completada.</Text>
      </View>
    </View>
  ) : null;

  const errorExtras = extras === "error" && appt ? (
    <View style={s.errorBox}>
      <Ionicons name="cloud-offline-outline" size={16} color={Colors.red} />
      <Text style={s.errorText}>No se pudieron cargar los servicios adicionales de la cita. Sin ellos el cobro quedaría incompleto.</Text>
      <TouchableOpacity onPress={() => cargarExtras(appt.id)} hitSlop={8} accessibilityRole="button">
        <Text style={s.errorRetry}>Reintentar</Text>
      </TouchableOpacity>
    </View>
  ) : null;

  const bloqueCliente = !appt ? (
    <View>
      <Text style={[s.label, { color: t.muted }]}>Cliente (opcional)</Text>
      {client ? (
        <View style={[s.clientChip, { backgroundColor: t.card, borderColor: t.border }]}>
          <Ionicons name="person-circle-outline" size={18} color={Colors.red} />
          <Text style={[s.clientChipText, { color: t.text }]} numberOfLines={1}>{client.name}</Text>
          <TouchableOpacity onPress={() => setClient(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Quitar cliente">
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
          <Text style={[s.hint, { color: t.subtle, marginTop: 0 }]}>Con cliente, el cobro suma a su historial y puedes enviarle el recibo por WhatsApp.</Text>
        </>
      )}
    </View>
  ) : null;

  const bloqueCarrito = (
    <View>
      <Text style={[s.label, { color: t.muted }]}>{appt ? "Se cobra" : `En el cobro${cart.length > 0 ? ` · ${cart.reduce((n, i) => n + i.qty, 0)}` : ""}`}</Text>
      {cart.length === 0 ? (
        <View style={[s.emptyCart, { borderColor: t.border }]}>
          <Text style={{ fontFamily: Fonts.regular, fontSize: 13, color: t.subtle, textAlign: "center" }}>
            {appt ? "Agrega servicios, productos o un ítem libre" : "Lo que agregues de la lista de arriba aparece aquí"}
          </Text>
        </View>
      ) : cart.map(i => {
        const tope = i.maxQty != null && i.qty >= i.maxQty;
        return (
          <View key={i.key} style={[s.cartRow, { backgroundColor: t.card, borderColor: t.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[s.cartName, { color: t.text }]} numberOfLines={1}>{i.name}</Text>
              <Text style={[s.cartSub, { color: t.muted }]}>
                {fmtMoneyFull(i.price)}{i.itemType === "product" ? " · producto" : ""}{tope ? " · sin más stock" : ""}
              </Text>
            </View>
            <View style={s.qtyBox}>
              <TouchableOpacity onPress={() => changeQty(i.key, -1)} style={[s.qtyBtn, { backgroundColor: t.chipBg }]} hitSlop={8}
                accessibilityRole="button" accessibilityLabel={i.qty === 1 ? `Quitar ${i.name}` : `Una unidad menos de ${i.name}`}>
                <Ionicons name={i.qty === 1 ? "trash-outline" : "remove"} size={15} color={Colors.red} />
              </TouchableOpacity>
              <Text style={[s.qtyText, { color: t.text }]}>{i.qty}</Text>
              <TouchableOpacity onPress={() => changeQty(i.key, 1)} style={[s.qtyBtn, { backgroundColor: t.chipBg }]} hitSlop={8}
                disabled={tope} accessibilityRole="button" accessibilityLabel={`Una unidad más de ${i.name}`} accessibilityState={{ disabled: tope }}>
                <Ionicons name="add" size={15} color={tope ? t.subtle : t.text} />
              </TouchableOpacity>
            </View>
            <Text style={[s.cartLineTotal, { color: t.text }]}>{fmtMoneyFull(i.price * i.qty)}</Text>
          </View>
        );
      })}
    </View>
  );

  const bloquePago = (
    <View>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <Text style={[s.label, { color: t.muted, marginBottom: 0 }]}>¿Cómo pagó el cliente?</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={{ fontFamily: Fonts.semibold, fontSize: 12, color: t.muted }}>Dividir pago</Text>
          <Switch value={split} onValueChange={setSplit} trackColor={{ false: t.trackBg, true: Colors.red + "60" }} thumbColor={split ? Colors.red : "#f4f3f4"}
            accessibilityLabel="Dividir pago" />
        </View>
      </View>
      {!split ? (
        <>
          <MetodosPago value={method} onChange={setMethod} />
          {method === "efectivo" && cart.length > 0 && total > 0 && (
            <View style={s.cashBox}>
              <View style={{ flexDirection: "row", gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={s.cashLabel}>Recibe</Text>
                  <TextInput style={[s.cashInput, { color: t.text }]} value={cashReceived} onChangeText={setCashReceived}
                    placeholder={fmtMoneyFull(total)} placeholderTextColor={t.subtle} keyboardType={tecladoMonto} accessibilityLabel="Efectivo recibido" />
                </View>
                <View style={{ flex: 1, alignItems: "flex-end" }}>
                  <Text style={s.cashLabel}>Cambio</Text>
                  <Text style={[s.cashChange, { color: cashChange === null ? t.subtle : cashChange > 0 ? t.text : Colors.success }]}>
                    {cashChange === null ? (cashReceived ? `Faltan ${fmtMoneyFull(total - cashReceivedNum)}` : "—") : cashChange === 0 ? "Exacto" : fmtMoneyFull(cashChange)}
                  </Text>
                </View>
              </View>
              <View style={s.atajos}>
                {[total, ...atajosEfectivo].map((v, i) => {
                  const activo = !!cashReceived && cashReceivedNum === v;
                  return (
                    <TouchableOpacity key={v} onPress={() => setCashReceived(montoATexto(v, { decimales: conDecimales }))} activeOpacity={0.8}
                      style={[s.atajo, { borderColor: activo ? Colors.success : "rgba(16,185,129,0.35)", backgroundColor: activo ? Colors.success : t.cardSolid }]}
                      accessibilityRole="button" accessibilityLabel={i === 0 ? "Recibe el valor exacto" : `Recibe ${fmtMoneyFull(v)}`}>
                      <Text style={[s.atajoTxt, { color: activo ? "white" : t.text }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{i === 0 ? "Exacto" : fmtMoneyFull(v)}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}
        </>
      ) : (
        <View style={{ gap: 10 }}>
          {splitLines.map((l, idx) => (
            <View key={idx} style={[s.splitRow, { backgroundColor: t.card, borderColor: t.border }]}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} keyboardShouldPersistTaps="handled">
                {PAY_METHODS.map(m => {
                  const active = l.method === m.key;
                  return (
                    <TouchableOpacity key={m.key} onPress={() => setSplitLines(prev => prev.map((x, i) => i === idx ? { ...x, method: m.key } : x))}
                      accessibilityRole="button" accessibilityState={{ selected: active }}
                      style={[s.miniChip, { borderColor: t.border }, active && { backgroundColor: m.color, borderColor: m.color }]}>
                      <Ionicons name={m.icon} size={12} color={active ? "white" : m.color} />
                      <Text style={[s.miniChipText, { color: t.muted }, active && { color: "white" }]}>{m.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 }}>
                <TextInput style={[s.splitInput, { borderColor: t.border, color: t.text }]} value={l.amount}
                  onChangeText={v => setSplitLines(prev => prev.map((x, i) => i === idx ? { ...x, amount: v } : x))}
                  placeholder="Monto" placeholderTextColor={t.subtle} keyboardType={tecladoMonto} accessibilityLabel={`Monto en ${methodCfg(l.method)?.label ?? l.method}`} />
                {splitRemaining > 0 && (
                  <TouchableOpacity onPress={() => ponerResto(idx)} style={s.restoBtn} activeOpacity={0.8}
                    accessibilityRole="button" accessibilityLabel={`Poner aquí los ${fmtMoneyFull(splitRemaining)} que faltan`}>
                    <Text style={s.restoTxt}>+ {fmtMoneyFull(splitRemaining)}</Text>
                  </TouchableOpacity>
                )}
                {splitLines.length > 2 && (
                  <TouchableOpacity onPress={() => setSplitLines(prev => prev.filter((_, i) => i !== idx))} hitSlop={8}
                    accessibilityRole="button" accessibilityLabel="Quitar este método">
                    <Ionicons name="close-circle" size={20} color={t.subtle} />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ))}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <TouchableOpacity onPress={() => setSplitLines(prev => [...prev, { method: "tarjeta", amount: "" }])} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
              accessibilityRole="button">
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
  );

  const toggleMas = appt ? (
    <TouchableOpacity onPress={() => setShowMore(v => !v)} style={{ flexDirection: "row", alignItems: "center", gap: 6 }} activeOpacity={0.7}
      accessibilityRole="button" accessibilityState={{ expanded: showMore }}>
      <Ionicons name={showMore ? "remove-circle-outline" : "add-circle-outline"} size={16} color={azul} />
      <Text style={{ fontFamily: Fonts.bold, fontSize: 13, color: azul }}>
        {showMore ? "Menos opciones" : "Agregar otro servicio, producto, descuento o nota"}
      </Text>
    </TouchableOpacity>
  ) : null;

  const bloqueAgregar = (showMore || !appt) ? (
    <View>
      <Text style={[s.label, { color: t.muted }]}>{appt ? "Agregar" : "¿Qué vendes?"}</Text>
      <View style={s.tabs}>
        {([["servicios", "Servicios"], ["productos", "Productos"], ["libre", "Ítem libre"]] as const).map(([key, lbl]) => (
          <TouchableOpacity key={key} onPress={() => { setTab(key); setSearch(""); setVerTodo(false); }}
            accessibilityRole="tab" accessibilityState={{ selected: tab === key }}
            style={[s.tab, { borderColor: t.border, backgroundColor: t.card }, tab === key && [s.tabActive, { backgroundColor: t.ink, borderColor: t.ink }]]}>
            <Text style={[s.tabText, { color: t.muted }, tab === key && { color: t.cardSolid }]}>{lbl}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {tab !== "libre" ? (
        catalogo === "error" ? (
          <View style={s.errorBox}>
            <Ionicons name="cloud-offline-outline" size={16} color={Colors.red} />
            <Text style={s.errorText}>{mensajeError(catalogoError, "No se pudo cargar el catálogo")}</Text>
            <TouchableOpacity onPress={cargarCatalogo} hitSlop={8} accessibilityRole="button">
              <Text style={s.errorRetry}>Reintentar</Text>
            </TouchableOpacity>
          </View>
        ) : catalogo === "cargando" ? (
          <ActivityIndicator color={Colors.red} style={{ paddingVertical: 12 }} />
        ) : (
        <>
          <View style={[s.searchBox, { backgroundColor: t.card, borderColor: t.border }]}>
            <Ionicons name="search-outline" size={15} color={t.subtle} />
            <TextInput
              style={[s.searchInput, { color: t.text }]}
              value={search} onChangeText={setSearch}
              placeholder={tab === "servicios" ? "Buscar servicio" : "Buscar producto"} placeholderTextColor={t.subtle}
            />
          </View>
          {filtered.length === 0 ? (
            <Text style={{ fontFamily: Fonts.regular, fontSize: 12, color: t.subtle, paddingVertical: 8 }}>
              {search.trim() ? "Nada coincide con la búsqueda" : tab === "servicios" ? "Sin servicios" : "Sin productos activos"}
            </Text>
          ) : (filtered as (Service | Product)[]).map(item => {
            const isProd = tab === "productos";
            const price  = isProd ? productPrice(item as Product) : (item as Service).price;
            const stock  = isProd ? (item as Product).stock_quantity : null;
            const out    = isProd && (stock ?? 0) <= 0;
            const n      = enElCobro(item.id, isProd);
            return (
              <TouchableOpacity key={item.id} onPress={() => isProd ? addProduct(item as Product) : addService(item as Service)}
                accessibilityRole="button" accessibilityLabel={`Agregar ${item.name}${n > 0 ? `, ya hay ${n} en el cobro` : ""}`}
                style={[s.resultRow, { borderColor: t.border }, out && { opacity: 0.45 }]} activeOpacity={0.75}>
                <View style={{ flex: 1 }}>
                  <Text style={[s.resultName, { color: t.text }]} numberOfLines={1}>{item.name}</Text>
                  {isProd && <Text style={[s.resultSub, { color: out ? Colors.red : t.muted }]}>{out ? "Sin stock" : `${stock} disponibles`}</Text>}
                </View>
                <Text style={[s.resultPrice, { color: t.text }]}>{fmtMoneyFull(price)}</Text>
                {n > 0 ? (
                  <View style={s.enCobro}><Text style={s.enCobroTxt}>{n}</Text></View>
                ) : (
                  <Ionicons name="add-circle" size={22} color={out ? t.subtle : Colors.red} />
                )}
              </TouchableOpacity>
            );
          })}
          {recortar ? (
            <TouchableOpacity onPress={() => setVerTodo(true)} style={{ paddingVertical: 12 }} accessibilityRole="button">
              <Text style={{ fontFamily: Fonts.bold, fontSize: 13, color: azul }}>
                Ver los {coincidencias.length} {tab === "servicios" ? "servicios" : "productos"}
              </Text>
            </TouchableOpacity>
          ) : null}
        </>
        )
      ) : (
        <View style={{ gap: 10 }}>
          <TextInput style={[s.input, { backgroundColor: t.card, borderColor: t.border, color: t.text }]}
            value={freeName} onChangeText={setFreeName} placeholder="Concepto (ej: Propina, Tratamiento)" placeholderTextColor={t.subtle} />
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <TextInput style={[s.input, { backgroundColor: t.card, borderColor: t.border, color: t.text }]}
                value={freePrice} onChangeText={setFreePrice} placeholder="Precio" placeholderTextColor={t.subtle} keyboardType={tecladoMonto}
                accessibilityLabel="Precio del ítem libre" />
              {freePriceNum !== null && <Text style={[s.hint, { color: t.subtle }]}>= {fmtMoneyFull(freePriceNum)}</Text>}
            </View>
            <TouchableOpacity onPress={addFree} style={[s.addFreeBtn, !freeOk && { opacity: 0.4 }]}
              disabled={!freeOk} accessibilityRole="button" accessibilityState={{ disabled: !freeOk }}>
              <Ionicons name="add" size={18} color="white" />
              <Text style={s.addFreeText}>Agregar</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  ) : null;

  const bloqueDescuento = (showMore || discountAmt > 0) ? (
    <View>
      <Text style={[s.label, { color: t.muted }]}>Descuento (opcional)</Text>
      <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
        <View style={[s.segment, { borderColor: t.border, backgroundColor: t.card }]}>
          {(["percentage", "fixed"] as const).map(k => (
            <TouchableOpacity key={k} onPress={() => setDiscountType(k)} style={[s.segmentBtn, discountType === k && { backgroundColor: t.ink }]}
              accessibilityRole="button" accessibilityLabel={k === "percentage" ? "Descuento en porcentaje" : "Descuento en valor fijo"}
              accessibilityState={{ selected: discountType === k }}>
              <Text style={[s.segmentText, { color: t.muted }, discountType === k && { color: t.cardSolid }]}>{k === "percentage" ? "%" : "$"}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TextInput style={[s.input, { flex: 1, marginBottom: 0, backgroundColor: t.card, borderColor: t.border, color: t.text }]}
          value={discountValue} onChangeText={setDiscountValue} placeholder={discountType === "percentage" ? "0 %" : "$ 0"}
          placeholderTextColor={t.subtle} keyboardType={discountType === "percentage" ? "decimal-pad" : tecladoMonto}
          accessibilityLabel="Valor del descuento" />
        {discountAmt > 0 && <Text style={{ fontFamily: Fonts.bold, fontSize: 13, color: Colors.success }}>−{fmtMoneyFull(discountAmt)}</Text>}
      </View>
      {discountType === "percentage" && discountVal > 0 && (
        <Text style={[s.hint, { color: t.subtle, marginTop: 6 }]}>{discountVal} % de {fmtMoneyFull(subtotal)}</Text>
      )}
    </View>
  ) : null;

  const bloqueNota = (showMore || !!note) ? (
    <View>
      <Text style={[s.label, { color: t.muted }]}>Nota (opcional)</Text>
      <TextInput style={[s.input, { backgroundColor: t.card, borderColor: t.border, color: t.text }]}
        value={note} onChangeText={setNote} placeholder="Ej: pagó con billete de 100" placeholderTextColor={t.subtle} />
    </View>
  ) : null;

  const bloqueTotales = (
    <View style={[s.totals, { backgroundColor: t.card, borderColor: t.border }]}>
      {discountAmt > 0 && <View style={s.totalRow}><Text style={[s.totalLabel, { color: t.muted }]}>Subtotal</Text><Text style={[s.totalVal, { color: t.text }]}>{fmtMoneyFull(subtotal)}</Text></View>}
      {discountAmt > 0 && <View style={s.totalRow}><Text style={[s.totalLabel, { color: t.muted }]}>Descuento</Text><Text style={[s.totalVal, { color: Colors.success }]}>−{fmtMoneyFull(discountAmt)}</Text></View>}
      {discountAmt > 0 && <View style={[s.divider, { backgroundColor: t.border }]} />}
      <View style={s.totalRow}><Text style={[s.totalLabel, { color: t.text, fontFamily: Fonts.bold, fontSize: 15 }]}>Total</Text><Text style={[s.grandTotal, { color: t.text }]}>{fmtMoneyFull(total)}</Text></View>
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <ModalHeader title={appt ? "Cobrar cita" : "Venta directa"} onClose={onClose} />

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 18 }} keyboardShouldPersistTaps="handled">
            {avisoCaja}
            {appt ? (
              <>
                {bannerCita}
                {errorExtras}
                {bloqueCarrito}
                {bloquePago}
                {toggleMas}
                {bloqueAgregar}
                {bloqueDescuento}
                {bloqueNota}
              </>
            ) : (
              <>
                {bloqueAgregar}
                {bloqueCarrito}
                {bloqueCliente}
                {bloquePago}
                {bloqueDescuento}
                {bloqueNota}
              </>
            )}
            {bloqueTotales}
          </ScrollView>
        </KeyboardAvoidingView>

        <BottomSaveBar
          label={total > 0 ? `Cobrar ${fmtMoneyFull(total)} · ${methodLabelNow}` : "Registrar cobro"}
          saving={saving}
          disabled={!canCharge}
          onPress={handleCharge}
          hint={motivo}
        />
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  label:         { fontSize: 11, fontFamily: Fonts.bold, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 },
  input:         { borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontFamily: Fonts.regular, marginBottom: 8 },
  hint:          { fontSize: 11.5, fontFamily: Fonts.semibold, marginTop: -2 },
  infoText:      { fontSize: 13, fontFamily: Fonts.regular, textAlign: "center", lineHeight: 19 },
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
  qtyBtn:        { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  qtyText:       { fontSize: 14, fontFamily: Fonts.bold, minWidth: 18, textAlign: "center" },
  cartLineTotal: { fontSize: 13, fontFamily: Fonts.bold, minWidth: 74, textAlign: "right" },
  tabs:          { flexDirection: "row", gap: 8, marginBottom: 10 },
  tab:           { flex: 1, borderWidth: 1, borderRadius: Radius.full, paddingVertical: 8, alignItems: "center" },
  tabActive:     { borderWidth: 1 },
  tabText:       { fontSize: 12, fontFamily: Fonts.semibold },
  addFreeBtn:    { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: Colors.red, borderRadius: Radius.md, paddingHorizontal: 14, height: 46 },
  addFreeText:   { fontSize: 13, fontFamily: Fonts.bold, color: "white" },
  segment:       { flexDirection: "row", borderWidth: 1, borderRadius: Radius.md, overflow: "hidden" },
  segmentBtn:    { paddingHorizontal: 16, paddingVertical: 12 },
  segmentText:   { fontSize: 14, fontFamily: Fonts.bold },
  splitRow:      { borderWidth: 1, borderRadius: Radius.md, padding: 10 },
  miniChip:      { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 7 },
  miniChipText:  { fontSize: 11, fontFamily: Fonts.semibold },
  splitInput:    { flex: 1, borderWidth: 1, borderRadius: Radius.sm, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, fontFamily: Fonts.bold },
  restoBtn:      { borderRadius: Radius.full, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: "rgba(16,185,129,0.12)" },
  restoTxt:      { fontSize: 12.5, fontFamily: Fonts.bold, color: Colors.success },
  totals:        { borderWidth: 1, borderRadius: Radius.lg, paddingHorizontal: 16, paddingVertical: 6 },
  totalRow:      { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8 },
  totalLabel:    { fontSize: 13, fontFamily: Fonts.regular },
  totalVal:      { fontSize: 13, fontFamily: Fonts.semibold },
  grandTotal:    { fontSize: 22, fontFamily: Fonts.bold, letterSpacing: -0.5 },
  apptBanner:    { flexDirection: "row", gap: 12, padding: 14, borderRadius: Radius.lg, backgroundColor: "rgba(16,185,129,0.08)", borderWidth: 1, borderColor: "rgba(16,185,129,0.3)" },
  apptBannerIcon:{ width: 38, height: 38, borderRadius: 11, backgroundColor: "rgba(16,185,129,0.15)", alignItems: "center", justifyContent: "center" },
  apptBannerKicker:{ fontSize: 10, fontFamily: Fonts.bold, color: Colors.success, textTransform: "uppercase", letterSpacing: 0.8 },
  apptBannerTitle:{ fontSize: 15, fontFamily: Fonts.bold, marginTop: 2 },
  apptBannerMeta:{ fontSize: 12.5, fontFamily: Fonts.regular, marginTop: 1 },
  apptBannerHint:{ fontSize: 11.5, fontFamily: Fonts.regular, marginTop: 6, lineHeight: 16 },
  errorBox:      { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: Radius.md, backgroundColor: "rgba(251,15,5,0.08)" },
  errorText:     { flex: 1, fontSize: 12.5, fontFamily: Fonts.semibold, color: Colors.red, lineHeight: 17 },
  errorRetry:    { fontSize: 12.5, fontFamily: Fonts.bold, color: Colors.red, textDecorationLine: "underline" },
  avisoBox:      { alignSelf: "stretch", flexDirection: "row", gap: 8, padding: 12, borderRadius: Radius.md, backgroundColor: "rgba(245,158,11,0.12)" },
  avisoText:     { flex: 1, fontSize: 12.5, fontFamily: Fonts.semibold, color: "#d97706", lineHeight: 17 },
  cashBox:       { marginTop: 12, padding: 12, borderRadius: Radius.md, backgroundColor: "rgba(16,185,129,0.06)", borderWidth: 1, borderColor: "rgba(16,185,129,0.2)" },
  atajos:        { flexDirection: "row", gap: 6, marginTop: 12 },
  atajo:         { flex: 1, alignItems: "center", borderWidth: 1, borderRadius: Radius.full, paddingHorizontal: 4, paddingVertical: 8 },
  atajoTxt:      { fontSize: 12.5, fontFamily: Fonts.bold },
  cashLabel:     { fontSize: 10, fontFamily: Fonts.bold, color: Colors.success, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 4 },
  cashInput:     { fontSize: 18, fontFamily: Fonts.monoBold, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: "rgba(16,185,129,0.35)" },
  cashChange:    { fontSize: 20, fontFamily: Fonts.monoBold, letterSpacing: -0.3, paddingVertical: 4 },
  doneIcon:      { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.success, alignItems: "center", justifyContent: "center", marginTop: 12, marginBottom: 4 },
  doneTotal:     { fontSize: 34, fontFamily: Fonts.bold, letterSpacing: -1 },
  doneMeta:      { fontSize: 14, fontFamily: Fonts.regular, marginTop: -8 },
  doneChange:    { alignItems: "center", paddingVertical: 10, paddingHorizontal: 18, borderRadius: Radius.md, backgroundColor: "rgba(16,185,129,0.08)" },
  doneChangeLabel:{ fontSize: 10, fontFamily: Fonts.bold, color: Colors.success, textTransform: "uppercase", letterSpacing: 0.7 },
  doneChangeVal: { fontSize: 22, fontFamily: Fonts.monoBold, color: Colors.success, marginTop: 2 },
  doneApptRow:   { flexDirection: "row", alignItems: "center", gap: 6 },
  doneApptText:  { fontSize: 12.5, fontFamily: Fonts.semibold, color: Colors.success },
  secondaryBtn:  { alignSelf: "stretch", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: Radius.full, borderWidth: 1, marginTop: 6 },
  secondaryBtnText: { fontSize: 14, fontFamily: Fonts.bold },
  waBtn:         { alignSelf: "stretch", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: Radius.full, borderWidth: 1, borderColor: "rgba(37,211,102,0.5)", backgroundColor: "rgba(37,211,102,0.08)", marginTop: 4 },
  waBtnText:     { fontSize: 14, fontFamily: Fonts.bold, color: "#128C7E" },
  searchBox:     { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: 12, marginBottom: 4 },
  searchInput:   { flex: 1, paddingVertical: 11, fontSize: 14, fontFamily: Fonts.regular },
  enCobro:       { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: Colors.red, alignItems: "center", justifyContent: "center" },
  enCobroTxt:    { fontSize: 12, fontFamily: Fonts.bold, color: "white" },
  cajaBox:       { padding: 14, borderRadius: Radius.lg, backgroundColor: "rgba(245,158,11,0.10)", borderWidth: 1, borderColor: "rgba(245,158,11,0.35)" },
  cajaTitulo:    { fontSize: 14, fontFamily: Fonts.bold },
  cajaTexto:     { fontSize: 12.5, fontFamily: Fonts.regular, lineHeight: 17, marginTop: 2 },
  cajaBtn:       { flex: 1, alignItems: "center", paddingVertical: 11, borderRadius: Radius.full, backgroundColor: "#b45309" },
  cajaBtnTxt:    { fontSize: 13.5, fontFamily: Fonts.bold, color: "white" },
  cajaBtnSec:    { flex: 1, alignItems: "center", paddingVertical: 11, borderRadius: Radius.full, borderWidth: 1 },
  cajaBtnSecTxt: { fontSize: 13.5, fontFamily: Fonts.bold },
});
