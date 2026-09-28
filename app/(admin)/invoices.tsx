import { useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Alert, TextInput, Modal, FlatList, ActivityIndicator, Linking, RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { Colors, Radius, Shadow } from "@/constants/theme";
import ErrorState from "@/components/ErrorState";
import { useTheme, type ThemeColors } from "@/lib/theme";
import { ScreenHeader } from "@/components/ui";
import { Config, authedFetch } from "@/lib/config";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { fmtMoneyFull } from "@/lib/format";
import { diaLocalDe, fmtDia } from "@/lib/tz";
import { esErrorDeRed, mensajeError, nuevoId, revisar, traerTodo } from "@/lib/db";
import { useRecarga, useGuardRespuestas } from "@/lib/useRecarga";
import { leerMonto, metodoAFactus, prorratearPrecios } from "@/lib/dinero";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

// ─── Constants ────────────────────────────────────────────────────────────────

const MUNICIPALITIES = [
  { id: 149,   label: "Bogotá D.C." },
  { id: 76001, label: "Cali" },
  { id: 5001,  label: "Medellín" },
  { id: 8001,  label: "Barranquilla" },
  { id: 13001, label: "Cartagena" },
  { id: 54001, label: "Cúcuta" },
  { id: 68001, label: "Bucaramanga" },
  { id: 17001, label: "Manizales" },
  { id: 41001, label: "Neiva" },
  { id: 73001, label: "Ibagué" },
  { id: 63001, label: "Armenia" },
  { id: 66001, label: "Pereira" },
  { id: 52001, label: "Pasto" },
  { id: 23001, label: "Montería" },
  { id: 15001, label: "Tunja" },
  { id: 19001, label: "Popayán" },
  { id: 50001, label: "Villavicencio" },
];

const ID_TYPES = [
  { id: 13, label: "Cédula de Ciudadanía" },
  { id: 31, label: "NIT" },
  { id: 22, label: "Cédula de Extranjería" },
  { id: 41, label: "Pasaporte" },
  { id: 12, label: "Tarjeta de Identidad" },
];

const PAYMENT_METHODS = [
  { code: "10", label: "Efectivo", icon: "cash-outline" as IoniconName },
  { code: "49", label: "Tarjeta débito/crédito", icon: "card-outline" as IoniconName },
  { code: "47", label: "Transferencia bancaria", icon: "swap-horizontal-outline" as IoniconName },
  { code: "42", label: "Débito bancario (PSE/Nequi)", icon: "phone-portrait-outline" as IoniconName },
];

const TAX_OPTIONS = [
  { value: "0.00", label: "0% — Excluido de IVA", is_excluded: 1 },
  { value: "19.00", label: "19% — IVA general", is_excluded: 0 },
  { value: "5.00", label: "5% — IVA reducido", is_excluded: 0 },
];

// Fondos translúcidos: sirven en claro y en oscuro.
const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  sent:     { label: "Enviada",   color: "#388e3c", bg: "rgba(56,142,60,0.14)" },
  accepted: { label: "Aceptada",  color: "#1e88e5", bg: "rgba(30,136,229,0.14)" },
  rejected: { label: "Rechazada", color: "#e53935", bg: "rgba(229,57,53,0.14)" },
  credited: { label: "Con nota crédito", color: "#8e24aa", bg: "rgba(142,36,170,0.14)" },
  draft:    { label: "Borrador",  color: "#9e9e9e", bg: "rgba(158,158,158,0.16)" },
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface InvoiceSettings {
  environment: "sandbox" | "production";
  factus_client_id: string;
  factus_client_secret: string;
  factus_username: string;
  factus_password: string;
  numbering_range_id: string;
  nit: string; dv: string; company_name: string; address: string;
  municipality_id: string; phone: string;
}

interface InvoiceItem {
  name: string; quantity: number; price: number; tax_rate: string; is_excluded: number;
}

interface CustomerForm {
  id_type: number; id_number: string; name: string; surname: string;
  company: string; email: string; phone: string; address: string; municipality_id: number;
}

interface Invoice {
  id: string; number: string; cufe: string; status: string;
  customer_name: string; payment_method: string;
  subtotal: number; tax_total: number; total: number;
  pdf_url: string | null; notes: string | null; created_at: string;
  invoice_items?: { name: string; quantity: number; price: number; tax_rate: string; total: number }[];
}

/** Factura ya emitida (para el modal de éxito o para bloquear otra). */
type FacturaEmitida = { cufe: string | null; number: string | null; pdf_url?: string | null };

/** Intento cuya respuesta no llegó: la factura pudo emitirse igual. */
type IntentoDudoso = { desde: string; customerId: string; total: number; posSaleId: string | null };

/** Cobro que se está facturando (viene de Historial de cobros). */
type VentaAFacturar = { id: string; total: number; created_at: string; cliente: string | null };

const EMPTY_SETTINGS: InvoiceSettings = {
  environment: "sandbox", factus_client_id: "", factus_client_secret: "",
  factus_username: "", factus_password: "", numbering_range_id: "",
  nit: "", dv: "", company_name: "", address: "", municipality_id: "", phone: "",
};

const EMPTY_CUSTOMER: CustomerForm = {
  id_type: 13, id_number: "", name: "", surname: "",
  company: "", email: "", phone: "", address: "", municipality_id: 149,
};

const EMPTY_ITEM: InvoiceItem = { name: "", quantity: 1, price: 0, tax_rate: "0.00", is_excluded: 1 };

function facturaVigente<T extends { status: string; credit_note_cufe: string | null }>(lista: T[]): T | null {
  return lista.find(f => !f.credit_note_cufe && f.status !== "rejected" && f.status !== "credited") ?? null;
}

function preguntar(titulo: string, mensaje: string, ok: string, cancelar: string): Promise<boolean> {
  return new Promise(resolve => {
    Alert.alert(titulo, mensaje, [
      { text: cancelar, style: "cancel", onPress: () => resolve(false) },
      { text: ok, style: "destructive", onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}

// ─── Main ──────────────────────────────────────────────────────────────────────

export default function InvoicesScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const s  = useMemo(() => crearEstilos(t), [t]);
  const pk = useMemo(() => crearEstilosPicker(t), [t]);
  const sc = useMemo(() => crearEstilosExito(t), [t]);
  const { tenantId } = useAuth();
  const { timezone } = useTenant();
  // Facturar un cobro concreto: /(admin)/invoices?venta=<pos_sale_id>
  const { venta: ventaParam } = useLocalSearchParams<{ venta?: string }>();
  const ventaId = typeof ventaParam === "string" && ventaParam.length > 0 ? ventaParam : null;
  const [tab, setTab]         = useState(ventaId ? 1 : 0);

  // Settings
  const [settings, setSettings]     = useState<InvoiceSettings>(EMPTY_SETTINGS);
  const [settingsError, setSettingsError] = useState<unknown>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSaved, setSettingsSaved]   = useState(false);
  const [testingConn, setTestingConn]       = useState(false);
  const [connResult, setConnResult]         = useState<{ ok: boolean; msg: string } | null>(null);

  // Invoice form
  const [customer, setCustomer]   = useState<CustomerForm>(EMPTY_CUSTOMER);
  const [items, setItems]         = useState<InvoiceItem[]>([{ ...EMPTY_ITEM }]);
  const [priceText, setPriceText] = useState<string[]>([""]);
  const [paymentMethod, setPaymentMethod] = useState("10");
  const [notes, setNotes]         = useState("");
  const [emitting, setEmitting]   = useState(false);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);
  const [successInvoice, setSuccessInvoice] = useState<FacturaEmitida | null>(null);
  const [muniModal, setMuniModal] = useState(false);
  const [cusMuniModal, setCusMuniModal] = useState(false);
  const [idTypeModal, setIdTypeModal]   = useState(false);
  const [payModal, setPayModal]   = useState(false);

  // Idempotencia (DIN-17): una referencia por factura, la misma en los
  // reintentos; y si una respuesta se pierde, antes de reenviar se busca si
  // la factura sí se emitió.
  const claveRef = useRef(nuevoId());
  const emitiendo = useRef(false);
  const [intentoDudoso, setIntentoDudoso] = useState<IntentoDudoso | null>(null);

  // Cobro a facturar
  const [venta, setVenta]               = useState<VentaAFacturar | null>(null);
  const [ventaError, setVentaError]     = useState<string | null>(null);
  const [avisoVenta, setAvisoVenta]     = useState<string | null>(null);
  const [facturaDeVenta, setFacturaDeVenta] = useState<FacturaEmitida | null>(null);

  // History
  const guardHist = useGuardRespuestas();
  const [invoices, setInvoices]     = useState<Invoice[]>([]);
  const [invCargadas, setInvCargadas] = useState(false);
  const [invError, setInvError]     = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Ajustes: se cargan una vez por negocio (no al enfocar: pisaría lo que se
  // esté escribiendo en el formulario).
  const cargarAjustes = async (vigente: () => boolean = () => true) => {
    if (!tenantId) return;
    const { data, error } = await supabase.from("invoice_settings").select("*").eq("tenant_id", tenantId).maybeSingle();
    if (!vigente()) return;
    if (error) { setSettingsError(error); return; }
    setSettingsError(null);
    if (data) {
      setSettings({
        environment:         data.environment ?? "sandbox",
        factus_client_id:    data.factus_client_id ?? "",
        factus_client_secret: data.factus_client_secret ?? "",
        factus_username:     data.factus_username ?? "",
        factus_password:     data.factus_password ?? "",
        numbering_range_id:  data.numbering_range_id ? String(data.numbering_range_id) : "",
        nit:                 data.nit ?? "",
        dv:                  data.dv ?? "",
        company_name:        data.company_name ?? "",
        address:             data.address ?? "",
        municipality_id:     data.municipality_id ? String(data.municipality_id) : "",
        phone:               data.phone ?? "",
      });
    }
  };

  useEffect(() => {
    let vigente = true;
    cargarAjustes(() => vigente);
    return () => { vigente = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  // Cobro a facturar: precarga ítems, cliente y medio de pago, y revisa si ya
  // tiene factura (no se factura dos veces el mismo cobro).
  useEffect(() => {
    if (!tenantId || !ventaId) return;
    let vigente = true;
    (async () => {
      try {
        const [v, f] = await Promise.all([
          supabase.from("pos_sales")
            .select("id, total, payment_method, payments, created_at, clients(name, phone, email, address, document), pos_sale_items(name, price, quantity)")
            .eq("id", ventaId).eq("tenant_id", tenantId).maybeSingle(),
          supabase.from("invoices").select("id, number, cufe, pdf_url, status, credit_note_cufe").eq("pos_sale_id", ventaId),
        ]);
        const fila = revisar(v, "No se pudo cargar el cobro") as unknown as {
          id: string; total: number; payment_method: string; payments: { method: string }[] | null; created_at: string;
          clients: { name: string; phone: string | null; email: string | null; address: string | null; document: string | null } | null;
          pos_sale_items: { name: string; price: number; quantity: number }[];
        } | null;
        const facturas = (revisar(f, "No se pudo revisar si el cobro ya tiene factura") ?? []) as
          { number: string | null; cufe: string | null; pdf_url: string | null; status: string; credit_note_cufe: string | null }[];
        if (!vigente) return;
        if (!fila) { setVentaError("Este cobro ya no existe: puede que lo hayan anulado."); return; }
        setVenta({ id: fila.id, total: Number(fila.total), created_at: fila.created_at, cliente: fila.clients?.name ?? null });
        setFacturaDeVenta(facturaVigente(facturas));
        const base = (fila.pos_sale_items ?? []).map(i => ({ name: i.name, price: Number(i.price) || 0, quantity: Number(i.quantity) || 1 }));
        if (base.length > 0) {
          // Un descuento del cobro se reparte en los precios para que la
          // factura sume lo cobrado.
          const { precios, diferencia } = prorratearPrecios(base, Number(fila.total));
          const nuevos = base.map((i, k) => ({ ...EMPTY_ITEM, name: i.name, quantity: i.quantity, price: precios[k] }));
          setItems(nuevos);
          setPriceText(nuevos.map(i => String(i.price)));
          setAvisoVenta(diferencia !== 0
            ? `Los precios no suman exactamente lo cobrado (diferencia de ${fmtMoneyFull(Math.abs(diferencia))}). Ajústalos antes de emitir.`
            : null);
        }
        const metodo = fila.payment_method === "mixto" ? fila.payments?.[0]?.method : fila.payment_method;
        setPaymentMethod(metodoAFactus(metodo));
        const c = fila.clients;
        if (c) {
          setCustomer(p => ({
            ...p,
            name: c.name ?? p.name,
            phone: c.phone ?? p.phone,
            email: c.email ?? p.email,
            address: c.address ?? p.address,
            id_number: c.document ?? p.id_number,
          }));
        }
      } catch (e) {
        if (vigente) setVentaError(mensajeError(e));
      }
    })();
    return () => { vigente = false; };
  }, [tenantId, ventaId]);

  // Historial: se recarga al enfocar/volver mientras la pestaña está abierta.
  const { recargar: recargarHist } = useRecarga(async () => {
    if (!tenantId) return;
    const turno = guardHist.nuevo();
    try {
      const filas = await traerTodo<Invoice>((d, h) =>
        supabase.from("invoices")
          .select("*, invoice_items(*)")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false }).order("id")
          .range(d, h),
      { contexto: "No se pudieron cargar las facturas", tope: 2000 });
      if (!turno.vigente()) return;
      setInvoices(filas);
      setInvError(null);
      setInvCargadas(true);
    } catch (e) {
      if (turno.vigente()) setInvError(e);
    }
  }, [tenantId], { habilitado: !!tenantId && tab === 2 });

  const saveSettings = async () => {
    if (!tenantId || savingSettings) return;
    setSavingSettings(true); setSettingsSaved(false);
    try {
      revisar(await supabase.from("invoice_settings").upsert({
        tenant_id: tenantId, ...settings,
        numbering_range_id: settings.numbering_range_id ? Number(settings.numbering_range_id) : null,
        municipality_id:    settings.municipality_id    ? Number(settings.municipality_id)    : null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "tenant_id" }).select("id").single(), "No se pudo guardar la configuración");
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 2500);
    } catch (e) {
      Alert.alert("No se guardó", mensajeError(e));
    } finally {
      setSavingSettings(false);
    }
  };

  const testConnection = async () => {
    setTestingConn(true); setConnResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await authedFetch(Config.api.factus, {
        method: "POST",
        body: JSON.stringify({ action: "test", supabaseToken: session?.access_token, tenantId }),
      });
      const json = await res.json().catch(() => ({}));
      setConnResult(res.ok ? { ok: true, msg: "Conexión exitosa con Factus." } : { ok: false, msg: json.error ?? "Error al conectar." });
    } catch (e) {
      setConnResult({ ok: false, msg: mensajeError(e) });
    } finally {
      setTestingConn(false);
    }
  };

  const updateItem = (i: number, field: keyof InvoiceItem, value: string | number) => {
    setItems(prev => prev.map((item, idx) => {
      if (idx !== i) return item;
      if (field === "tax_rate") {
        const opt = TAX_OPTIONS.find(o => o.value === value);
        return { ...item, tax_rate: String(value), is_excluded: opt?.is_excluded ?? 1 };
      }
      return { ...item, [field]: value };
    }));
  };

  // Precio: en pesos solo cuentan los dígitos ("50.000" pegado era $50, DIN-18).
  const updatePrice = (i: number, texto: string) => {
    setPriceText(prev => prev.map((p, k) => (k === i ? texto : p)));
    updateItem(i, "price", leerMonto(texto, { decimales: false }) ?? 0);
  };
  const addItem = () => { setItems(p => [...p, { ...EMPTY_ITEM }]); setPriceText(p => [...p, ""]); };
  const removeItem = (i: number) => {
    setItems(p => p.filter((_, idx) => idx !== i));
    setPriceText(p => p.filter((_, idx) => idx !== i));
  };

  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const taxTotal = items.reduce((sum, i) => sum + (i.price * i.quantity * (parseFloat(i.tax_rate) || 0)) / 100, 0);
  const total    = subtotal + taxTotal;

  /** ¿Se emitió ya una factura igual desde `desde`? (tras una respuesta perdida) */
  const buscarEmitida = async (intento: IntentoDudoso): Promise<FacturaEmitida | null> => {
    if (!tenantId) return null;
    let q = supabase.from("invoices")
      .select("number, cufe, pdf_url, total, status")
      .eq("tenant_id", tenantId)
      .eq("customer_id", intento.customerId)
      .gte("created_at", intento.desde)
      .in("status", ["sent", "accepted"]);
    if (intento.posSaleId) q = q.eq("pos_sale_id", intento.posSaleId);
    const filas = (revisar(await q.order("created_at", { ascending: false }).limit(5), "No se pudo revisar si la factura se emitió") ?? []) as
      { number: string | null; cufe: string | null; pdf_url: string | null; total: number }[];
    return filas.find(f => Math.abs(Number(f.total) - intento.total) < 1) ?? null;
  };

  const reiniciarFormulario = () => {
    setCustomer(EMPTY_CUSTOMER); setItems([{ ...EMPTY_ITEM }]); setPriceText([""]); setNotes("");
    claveRef.current = nuevoId();
    setIntentoDudoso(null);
  };

  const mostrarExito = (f: FacturaEmitida) => {
    setSuccessInvoice(f);
    if (venta) setFacturaDeVenta(f);
    reiniciarFormulario();
    setInvCargadas(false);
  };

  const emitInvoice = async () => {
    if (emitiendo.current || !tenantId) return;
    setInvoiceError(null);
    if (facturaDeVenta) { setInvoiceError("Este cobro ya tiene factura electrónica: no se puede emitir otra."); return; }
    if (!customer.id_number || !customer.name) { setInvoiceError("Completa el número y nombre del cliente."); return; }
    if (items.some(i => !i.name || i.price <= 0)) { setInvoiceError("Todos los ítems necesitan nombre y precio > 0."); return; }
    emitiendo.current = true;
    setEmitting(true);
    const intento: IntentoDudoso = {
      // Un minuto de margen por si el reloj del teléfono va adelantado.
      desde: new Date(Date.now() - 60_000).toISOString(),
      customerId: customer.id_number,
      total,
      posSaleId: ventaId,
    };
    try {
      // 1. El intento anterior quedó sin respuesta: primero ver si sí se emitió.
      if (intentoDudoso) {
        const previa = await buscarEmitida(intentoDudoso);
        if (previa) { mostrarExito(previa); return; }
        const seguir = await preguntar(
          "¿Reintentar la factura?",
          "El intento anterior no tuvo respuesta y la factura no aparece en el sistema. Si en realidad sí se emitió, reintentar crearía una factura duplicada ante la DIAN. Si tienes dudas, revísalo primero en el portal de Factus.",
          "Reintentar", "Revisar primero",
        );
        if (!seguir) return;
        intento.desde = intentoDudoso.desde;
      }
      // 2. El cobro no puede tener ya una factura (emitida desde otro dispositivo o el web).
      if (ventaId) {
        const f = (revisar(
          await supabase.from("invoices").select("number, cufe, pdf_url, status, credit_note_cufe").eq("pos_sale_id", ventaId),
          "No se pudo revisar si el cobro ya tiene factura",
        ) ?? []) as { number: string | null; cufe: string | null; pdf_url: string | null; status: string; credit_note_cufe: string | null }[];
        const ya = facturaVigente(f);
        if (ya) { setFacturaDeVenta(ya); setInvoiceError(`Este cobro ya tiene la factura #${ya.number || "—"}.`); return; }
      }

      const { data: { session } } = await supabase.auth.getSession();
      let res: Response;
      try {
        res = await authedFetch(Config.api.factus, {
          method: "POST",
          body: JSON.stringify({
            action: "create", supabaseToken: session?.access_token,
            tenantId,
            invoiceData: {
              customer, items, paymentMethod, notes,
              // reference_code: el servidor aún no lo usa (usa FAC-<hora>); cuando
              // lo reenvíe a Factus, un reintento con la misma clave no duplica.
              reference_code: `ZM-${claveRef.current}`,
              pos_sale_id: ventaId,
            },
          }),
        });
      } catch (e) {
        // Sin respuesta: Factus pudo haber emitido. No se deja reintentar a ciegas.
        setIntentoDudoso(intento);
        const previa = await buscarEmitida(intento).catch(() => null);
        if (previa) { mostrarExito(previa); return; }
        setInvoiceError(esErrorDeRed(e) || (e as Error)?.name === "TimeoutError"
          ? "No hubo respuesta del servidor y no sabemos si la factura se emitió. Revisa el Historial: al reintentar, primero se comprobará si ya existe."
          : mensajeError(e, "No se pudo emitir la factura"));
        return;
      }
      const json = await res.json().catch(() => ({} as { error?: string }));
      if (res.ok) {
        mostrarExito({ cufe: json.cufe ?? null, number: json.number ?? null, pdf_url: json.pdf_url ?? null });
        return;
      }
      if (res.status >= 500) {
        // Error interno del servidor: pudo fallar DESPUÉS de emitir en Factus.
        setIntentoDudoso(intento);
        setInvoiceError(`${json.error ?? "El servidor tuvo un error"}. Puede que la factura sí se haya emitido: revisa el Historial antes de reintentar.`);
        return;
      }
      // 4xx: Factus (o la validación) la rechazó; no se emitió.
      setInvoiceError(json.error ?? "Error al emitir la factura.");
    } catch (e) {
      setInvoiceError(mensajeError(e, "No se pudo emitir la factura"));
    } finally {
      emitiendo.current = false;
      setEmitting(false);
    }
  };

  // ── Settings tab ──────────────────────────────────────────────────────────

  const renderSettings = () => (
    <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 20, paddingBottom: 110 }}>
      {settingsError ? (
        <TouchableOpacity onPress={() => cargarAjustes()} style={[s.banner, { backgroundColor: Colors.red + "12" }]} accessibilityRole="button">
          <Ionicons name="cloud-offline-outline" size={16} color={Colors.red} />
          <Text style={[s.bannerTxt, { color: Colors.red }]}>{mensajeError(settingsError, "No se pudo cargar la configuración")} Toca para reintentar.</Text>
        </TouchableOpacity>
      ) : null}
      <Text style={s.sectionTitle}>Credenciales Factus</Text>
      <View style={[s.card, Shadow.sm]}>
        <Text style={s.hint}>
          Conecta tu cuenta de Factus para emitir facturas electrónicas validadas por la DIAN.
        </Text>

        <Text style={s.fieldLabel}>Ambiente</Text>
        <View style={s.envRow}>
          {(["sandbox", "production"] as const).map(env => (
            <TouchableOpacity
              key={env}
              style={[s.envBtn, settings.environment === env && s.envBtnActive]}
              onPress={() => setSettings(p => ({ ...p, environment: env }))}
              accessibilityRole="button" accessibilityState={{ selected: settings.environment === env }}
            >
              <Text style={[s.envBtnTxt, settings.environment === env && s.envBtnTxtActive]}>
                {env === "sandbox" ? "Sandbox (Pruebas)" : "Producción"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {([
          { key: "factus_client_id",     label: "Client ID" },
          { key: "factus_client_secret", label: "Client Secret" },
          { key: "factus_username",      label: "Usuario (email Factus)" },
          { key: "factus_password",      label: "Contraseña Factus" },
          { key: "numbering_range_id",   label: "ID Rango Numeración DIAN" },
        ] as { key: keyof InvoiceSettings; label: string }[]).map(({ key, label }) => (
          <View key={key} style={{ marginBottom: 12 }}>
            <Text style={s.fieldLabel}>{label}</Text>
            <TextInput
              style={s.input}
              value={settings[key]}
              onChangeText={v => setSettings(p => ({ ...p, [key]: v }))}
              secureTextEntry={key.includes("secret") || key.includes("password")}
              autoCapitalize="none"
              placeholderTextColor={t.subtle}
              placeholder={label}
            />
          </View>
        ))}
      </View>

      <Text style={[s.sectionTitle, { marginTop: 20 }]}>Datos del Emisor</Text>
      <View style={[s.card, Shadow.sm]}>
        {([
          { key: "nit",          label: "NIT" },
          { key: "dv",           label: "Dígito de verificación (DV)" },
          { key: "company_name", label: "Razón Social" },
          { key: "phone",        label: "Teléfono" },
          { key: "address",      label: "Dirección" },
        ] as { key: keyof InvoiceSettings; label: string }[]).map(({ key, label }) => (
          <View key={key} style={{ marginBottom: 12 }}>
            <Text style={s.fieldLabel}>{label}</Text>
            <TextInput
              style={s.input}
              value={settings[key]}
              onChangeText={v => setSettings(p => ({ ...p, [key]: v }))}
              placeholderTextColor={t.subtle}
              placeholder={label}
            />
          </View>
        ))}
        <Text style={s.fieldLabel}>Municipio</Text>
        <TouchableOpacity style={s.pickerBtn} onPress={() => setMuniModal(true)} accessibilityRole="button">
          <Text style={[s.pickerTxt, !settings.municipality_id && { color: t.subtle }]}>
            {MUNICIPALITIES.find(m => String(m.id) === settings.municipality_id)?.label ?? "Seleccionar municipio"}
          </Text>
          <Ionicons name="chevron-down" size={16} color={t.subtle} />
        </TouchableOpacity>
      </View>

      {connResult && (
        <View style={[s.banner, { backgroundColor: connResult.ok ? Colors.success + "14" : Colors.red + "12" }]}>
          <Ionicons name={connResult.ok ? "checkmark-circle-outline" : "close-circle-outline"} size={16} color={connResult.ok ? Colors.success : Colors.red} />
          <Text style={[s.bannerTxt, { color: connResult.ok ? Colors.success : Colors.red }]}>{connResult.msg}</Text>
        </View>
      )}
      {settingsSaved && (
        <View style={[s.banner, { backgroundColor: Colors.success + "14" }]}>
          <Ionicons name="checkmark-circle-outline" size={16} color={Colors.success} />
          <Text style={[s.bannerTxt, { color: Colors.success }]}>Configuración guardada.</Text>
        </View>
      )}

      <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
        <TouchableOpacity style={[s.btn, { flex: 1 }]} onPress={saveSettings} disabled={savingSettings} accessibilityRole="button">
          {savingSettings ? <ActivityIndicator color="white" size="small" /> : <Text style={s.btnTxt}>Guardar</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={[s.btnSecondary, { flex: 1 }]} onPress={testConnection} disabled={testingConn} accessibilityRole="button">
          {testingConn ? <ActivityIndicator color={Colors.blue} size="small" /> : <Text style={s.btnSecondaryTxt}>Probar conexión</Text>}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );

  // ── Nueva factura tab ─────────────────────────────────────────────────────

  const renderNueva = () => (
    <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 20, paddingBottom: 110 }} keyboardShouldPersistTaps="handled">
      {ventaId && (
        <View style={[s.banner, { backgroundColor: t.chipBg, alignItems: "flex-start" }]}>
          <Ionicons name="receipt-outline" size={16} color={t.muted} style={{ marginTop: 1 }} />
          <View style={{ flex: 1, gap: 2 }}>
            {ventaError ? (
              <Text style={[s.bannerTxt, { color: Colors.red }]}>{ventaError}</Text>
            ) : venta ? (
              <>
                <Text style={[s.bannerTxt, { color: t.text }]}>
                  Facturando el cobro de {venta.cliente ?? "venta directa"} · {fmtMoneyFull(venta.total)}
                </Text>
                <Text style={[s.bannerSub, { color: t.muted }]}>{fmtDia(diaLocalDe(venta.created_at, timezone), "corto")}</Text>
                {avisoVenta && <Text style={[s.bannerSub, { color: "#d97706" }]}>{avisoVenta}</Text>}
              </>
            ) : (
              <Text style={[s.bannerTxt, { color: t.muted }]}>Cargando el cobro…</Text>
            )}
          </View>
        </View>
      )}

      {facturaDeVenta && (
        <View style={[s.banner, { backgroundColor: Colors.success + "14", alignItems: "flex-start" }]}>
          <Ionicons name="checkmark-circle-outline" size={16} color={Colors.success} style={{ marginTop: 1 }} />
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={[s.bannerTxt, { color: Colors.success }]}>
              Este cobro ya tiene la factura #{facturaDeVenta.number || "—"}. No se puede emitir otra.
            </Text>
            {facturaDeVenta.pdf_url ? (
              <TouchableOpacity onPress={() => Linking.openURL(facturaDeVenta.pdf_url!)} accessibilityRole="button">
                <Text style={[s.bannerSub, { color: Colors.blue, textDecorationLine: "underline" }]}>Ver PDF</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      )}

      <Text style={s.sectionTitle}>Datos del Cliente</Text>
      <View style={[s.card, Shadow.sm]}>
        <Text style={s.fieldLabel}>Tipo de documento</Text>
        <TouchableOpacity style={s.pickerBtn} onPress={() => setIdTypeModal(true)} accessibilityRole="button">
          <Text style={s.pickerTxt}>{ID_TYPES.find(tipo => tipo.id === customer.id_type)?.label}</Text>
          <Ionicons name="chevron-down" size={16} color={t.subtle} />
        </TouchableOpacity>

        {([
          { key: "id_number", label: "Número de documento", keyboard: "default" },
          { key: "name",      label: "Nombres",             keyboard: "default" },
          { key: "surname",   label: "Apellidos",            keyboard: "default" },
          { key: "company",   label: "Empresa / Razón social", keyboard: "default" },
          { key: "email",     label: "Email",               keyboard: "email-address" },
          { key: "phone",     label: "Teléfono",            keyboard: "phone-pad" },
          { key: "address",   label: "Dirección",           keyboard: "default" },
        ] as { key: Exclude<keyof CustomerForm, "id_type" | "municipality_id">; label: string; keyboard: "default" | "email-address" | "phone-pad" }[]).map(({ key, label, keyboard }) => (
          <View key={key} style={{ marginBottom: 12 }}>
            <Text style={s.fieldLabel}>{label}</Text>
            <TextInput
              style={s.input}
              value={customer[key]}
              onChangeText={v => setCustomer(p => ({ ...p, [key]: v }))}
              keyboardType={keyboard}
              autoCapitalize={key === "email" ? "none" : "sentences"}
              placeholder={label}
              placeholderTextColor={t.subtle}
            />
          </View>
        ))}

        <Text style={s.fieldLabel}>Municipio</Text>
        <TouchableOpacity style={s.pickerBtn} onPress={() => setCusMuniModal(true)} accessibilityRole="button">
          <Text style={s.pickerTxt}>{MUNICIPALITIES.find(m => m.id === customer.municipality_id)?.label ?? "—"}</Text>
          <Ionicons name="chevron-down" size={16} color={t.subtle} />
        </TouchableOpacity>
      </View>

      <Text style={[s.sectionTitle, { marginTop: 20 }]}>Ítems / Servicios</Text>
      <View style={[s.card, Shadow.sm]}>
        {items.map((item, i) => (
          <View key={i} style={{ marginBottom: 16, borderBottomWidth: i < items.length - 1 ? 1 : 0, borderBottomColor: t.border, paddingBottom: i < items.length - 1 ? 16 : 0 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <Text style={s.fieldLabel}>Ítem {i + 1}</Text>
              {items.length > 1 && (
                <TouchableOpacity onPress={() => removeItem(i)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Quitar ítem ${i + 1}`}>
                  <Ionicons name="close-circle-outline" size={20} color={Colors.red} />
                </TouchableOpacity>
              )}
            </View>
            <TextInput style={[s.input, { marginBottom: 8 }]} value={item.name} onChangeText={v => updateItem(i, "name", v)} placeholder="Descripción del ítem" placeholderTextColor={t.subtle} />
            <View style={{ flexDirection: "row", gap: 10, marginBottom: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={[s.fieldLabel, { marginBottom: 4 }]}>Cant.</Text>
                <TextInput style={s.input} value={String(item.quantity)} onChangeText={v => updateItem(i, "quantity", Math.max(1, parseInt(v.replace(/\D/g, ""), 10) || 1))} keyboardType="number-pad" />
              </View>
              <View style={{ flex: 2 }}>
                <Text style={[s.fieldLabel, { marginBottom: 4 }]}>Precio unit.</Text>
                <TextInput style={s.input} value={priceText[i] ?? String(item.price || "")} onChangeText={v => updatePrice(i, v)} keyboardType="number-pad" placeholder="0" placeholderTextColor={t.subtle} />
                {item.price > 0 && <Text style={s.priceHint}>= {fmtMoneyFull(item.price)}</Text>}
              </View>
            </View>
            <Text style={s.fieldLabel}>IVA</Text>
            <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
              {TAX_OPTIONS.map(opt => (
                <TouchableOpacity key={opt.value} style={[s.taxBtn, item.tax_rate === opt.value && s.taxBtnActive]} onPress={() => updateItem(i, "tax_rate", opt.value)}
                  accessibilityRole="button" accessibilityState={{ selected: item.tax_rate === opt.value }}>
                  <Text style={[s.taxBtnTxt, item.tax_rate === opt.value && s.taxBtnTxtActive]}>{opt.label.split("—")[0].trim()}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}
        <TouchableOpacity style={s.addItemBtn} onPress={addItem} accessibilityRole="button">
          <Ionicons name="add-circle-outline" size={16} color={Colors.blue} />
          <Text style={s.addItemBtnTxt}>Agregar ítem</Text>
        </TouchableOpacity>
      </View>

      <Text style={[s.sectionTitle, { marginTop: 20 }]}>Método de pago</Text>
      <TouchableOpacity style={[s.card, Shadow.sm, { padding: 0 }]} onPress={() => setPayModal(true)} accessibilityRole="button">
        {(() => {
          const pm = PAYMENT_METHODS.find(p => p.code === paymentMethod);
          return (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 16 }}>
              <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.success + "16", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name={pm?.icon ?? "cash-outline"} size={18} color={Colors.success} />
              </View>
              <Text style={{ flex: 1, fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: t.text }}>{pm?.label}</Text>
              <Ionicons name="chevron-down" size={16} color={t.subtle} />
            </View>
          );
        })()}
      </TouchableOpacity>

      <Text style={[s.sectionTitle, { marginTop: 20 }]}>Notas</Text>
      <View style={[s.card, Shadow.sm]}>
        <TextInput
          style={[s.input, { minHeight: 70, textAlignVertical: "top" }]}
          value={notes}
          onChangeText={setNotes}
          multiline
          placeholder="Observaciones (opcional)"
          placeholderTextColor={t.subtle}
        />
      </View>

      <View style={[s.summaryCard, Shadow.sm]}>
        <View style={s.summaryRow}>
          <Text style={s.summaryLabel}>Subtotal</Text>
          <Text style={s.summaryValue}>{fmtMoneyFull(subtotal)}</Text>
        </View>
        <View style={s.summaryRow}>
          <Text style={s.summaryLabel}>IVA</Text>
          <Text style={s.summaryValue}>{fmtMoneyFull(taxTotal)}</Text>
        </View>
        <View style={[s.summaryRow, { borderTopWidth: 1, borderTopColor: t.border, paddingTop: 10, marginTop: 4 }]}>
          <Text style={[s.summaryLabel, { fontFamily: "SpaceGrotesk_700Bold", color: t.text }]}>Total</Text>
          <Text style={[s.summaryValue, { fontSize: 18 }]}>{fmtMoneyFull(total)}</Text>
        </View>
      </View>

      {invoiceError && (
        <View style={[s.banner, { backgroundColor: Colors.red + "12", marginTop: 8 }]} accessibilityRole="alert">
          <Ionicons name="close-circle-outline" size={16} color={Colors.red} />
          <Text style={[s.bannerTxt, { color: Colors.red }]}>{invoiceError}</Text>
        </View>
      )}

      <TouchableOpacity style={[s.btn, { marginTop: 16 }, (emitting || !!facturaDeVenta) && { opacity: 0.5 }]} onPress={emitInvoice}
        disabled={emitting || !!facturaDeVenta} accessibilityRole="button">
        {emitting ? <ActivityIndicator color="white" size="small" /> : (
          <>
            <Ionicons name="document-text-outline" size={18} color="white" />
            <Text style={s.btnTxt}>{intentoDudoso ? "Comprobar y reintentar" : "Emitir Factura DIAN"}</Text>
          </>
        )}
      </TouchableOpacity>
      <Text style={{ fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", color: t.subtle, textAlign: "center", marginTop: 6 }}>
        Se enviará a la DIAN vía Factus
      </Text>
    </ScrollView>
  );

  // ── Historial tab ─────────────────────────────────────────────────────────

  const renderHistorial = () => (
    <View style={{ flex: 1 }}>
      {invError && !invCargadas ? (
        <ErrorState error={invError} onRetry={recargarHist} />
      ) : !invCargadas ? (
        <ActivityIndicator color={Colors.red} style={{ marginTop: 32 }} />
      ) : invoices.length === 0 ? (
        <View style={s.emptyBox}>
          <Ionicons name="document-text-outline" size={40} color={t.subtle} />
          <Text style={s.emptyTitle}>Sin facturas aún</Text>
          <Text style={s.emptyTxt}>Las facturas emitidas aparecerán aquí</Text>
        </View>
      ) : (
        <FlatList
          data={invoices}
          keyExtractor={i => i.id}
          contentContainerStyle={{ padding: 20, paddingBottom: 110 }}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await recargarHist(); setRefreshing(false); }} tintColor={Colors.red} />}
          renderItem={({ item: inv }) => {
            const st = STATUS_MAP[inv.status] ?? STATUS_MAP.draft;
            const expanded = expandedId === inv.id;
            return (
              <View style={[s.invCard, Shadow.sm]}>
                <TouchableOpacity onPress={() => setExpandedId(expanded ? null : inv.id)} style={s.invHeader} accessibilityRole="button" accessibilityState={{ expanded }}>
                  <View style={s.invNumber}>
                    <Text style={s.invNumberTxt}>#{inv.number || "—"}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.invCustomer} numberOfLines={1}>{inv.customer_name}</Text>
                    <Text style={s.invDate}>{fmtDia(diaLocalDe(inv.created_at, timezone), "corto")}</Text>
                  </View>
                  <Text style={s.invTotal}>{fmtMoneyFull(inv.total)}</Text>
                  <View style={[s.statusBadge, { backgroundColor: st.bg }]}>
                    <Text style={[s.statusTxt, { color: st.color }]}>{st.label}</Text>
                  </View>
                  <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={16} color={t.subtle} />
                </TouchableOpacity>
                {expanded && (
                  <View style={s.invDetail}>
                    {inv.cufe ? (
                      <View style={{ marginBottom: 10 }}>
                        <Text style={s.invDetailLabel}>CUFE</Text>
                        <Text style={s.invCufe} selectable>{inv.cufe}</Text>
                      </View>
                    ) : null}
                    {inv.invoice_items?.map((it, i) => (
                      <View key={i} style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                        <Text style={s.invItem}>{it.name} × {it.quantity}</Text>
                        <Text style={s.invItem}>{fmtMoneyFull(it.total)}</Text>
                      </View>
                    ))}
                    {inv.pdf_url && (
                      <TouchableOpacity style={[s.btnSecondary, { marginTop: 12, alignSelf: "flex-start" }]} onPress={() => Linking.openURL(inv.pdf_url!)} accessibilityRole="button">
                        <Ionicons name="download-outline" size={14} color={Colors.blue} />
                        <Text style={s.btnSecondaryTxt}>Descargar PDF</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            );
          }}
        />
      )}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader crumb="Dinero" title="Factura Electrónica" subtitle="Emite facturas DIAN vía Factus" onBack={() => router.back()} />

      <View style={s.tabBar}>
        {["Configuración", "Nueva Factura", "Historial"].map((label, i) => (
          <TouchableOpacity key={i} style={s.tabItem} onPress={() => setTab(i)} accessibilityRole="tab" accessibilityState={{ selected: tab === i }}>
            <Text style={[s.tabTxt, tab === i && s.tabTxtActive]}>{label}</Text>
            {tab === i && <View style={s.tabUnderline} />}
          </TouchableOpacity>
        ))}
      </View>

      {tab === 0 && renderSettings()}
      {tab === 1 && renderNueva()}
      {tab === 2 && renderHistorial()}

      {/* Municipio picker (settings) */}
      <Modal visible={muniModal} animationType="slide" transparent onRequestClose={() => setMuniModal(false)}>
        <View style={pk.overlay}>
          <View style={pk.sheet}>
            <View style={pk.handle} />
            <Text style={pk.title}>Municipio del emisor</Text>
            <FlatList
              data={MUNICIPALITIES}
              keyExtractor={m => String(m.id)}
              renderItem={({ item }) => (
                <TouchableOpacity style={pk.row} onPress={() => { setSettings(p => ({ ...p, municipality_id: String(item.id) })); setMuniModal(false); }}>
                  <Text style={pk.rowTxt}>{item.label}</Text>
                  {settings.municipality_id === String(item.id) && <Ionicons name="checkmark" size={18} color={Colors.red} />}
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={pk.sep} />}
            />
          </View>
        </View>
      </Modal>

      {/* Municipio picker (customer) */}
      <Modal visible={cusMuniModal} animationType="slide" transparent onRequestClose={() => setCusMuniModal(false)}>
        <View style={pk.overlay}>
          <View style={pk.sheet}>
            <View style={pk.handle} />
            <Text style={pk.title}>Municipio del cliente</Text>
            <FlatList
              data={MUNICIPALITIES}
              keyExtractor={m => String(m.id)}
              renderItem={({ item }) => (
                <TouchableOpacity style={pk.row} onPress={() => { setCustomer(p => ({ ...p, municipality_id: item.id })); setCusMuniModal(false); }}>
                  <Text style={pk.rowTxt}>{item.label}</Text>
                  {customer.municipality_id === item.id && <Ionicons name="checkmark" size={18} color={Colors.red} />}
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={pk.sep} />}
            />
          </View>
        </View>
      </Modal>

      {/* ID Type picker */}
      <Modal visible={idTypeModal} animationType="slide" transparent onRequestClose={() => setIdTypeModal(false)}>
        <View style={pk.overlay}>
          <View style={pk.sheet}>
            <View style={pk.handle} />
            <Text style={pk.title}>Tipo de documento</Text>
            {ID_TYPES.map((tipo, i) => (
              <View key={tipo.id}>
                {i > 0 && <View style={pk.sep} />}
                <TouchableOpacity style={pk.row} onPress={() => { setCustomer(p => ({ ...p, id_type: tipo.id })); setIdTypeModal(false); }}>
                  <Text style={pk.rowTxt}>{tipo.label}</Text>
                  {customer.id_type === tipo.id && <Ionicons name="checkmark" size={18} color={Colors.red} />}
                </TouchableOpacity>
              </View>
            ))}
          </View>
        </View>
      </Modal>

      {/* Payment method picker */}
      <Modal visible={payModal} animationType="slide" transparent onRequestClose={() => setPayModal(false)}>
        <View style={pk.overlay}>
          <View style={pk.sheet}>
            <View style={pk.handle} />
            <Text style={pk.title}>Método de pago</Text>
            {PAYMENT_METHODS.map((pm, i) => (
              <View key={pm.code}>
                {i > 0 && <View style={pk.sep} />}
                <TouchableOpacity style={pk.row} onPress={() => { setPaymentMethod(pm.code); setPayModal(false); }}>
                  <Ionicons name={pm.icon} size={18} color={t.muted} />
                  <Text style={[pk.rowTxt, { flex: 1 }]}>{pm.label}</Text>
                  {paymentMethod === pm.code && <Ionicons name="checkmark" size={18} color={Colors.red} />}
                </TouchableOpacity>
              </View>
            ))}
          </View>
        </View>
      </Modal>

      {/* Success modal */}
      <Modal visible={!!successInvoice} animationType="fade" transparent onRequestClose={() => setSuccessInvoice(null)}>
        <View style={sc.overlay}>
          <View style={sc.card}>
            <View style={sc.icon}>
              <Ionicons name="checkmark-circle" size={48} color={Colors.success} />
            </View>
            <Text style={sc.title}>¡Factura emitida!</Text>
            <Text style={sc.sub}>Enviada exitosamente a la DIAN.</Text>
            {successInvoice?.number && (
              <View style={sc.numBox}>
                <Text style={sc.numLabel}>Número de factura</Text>
                <Text style={sc.numValue}>#{successInvoice.number}</Text>
              </View>
            )}
            {successInvoice?.cufe && (
              <View style={sc.cufeBox}>
                <Text style={sc.cufeLabel}>CUFE</Text>
                <Text style={sc.cufeValue} selectable>{successInvoice.cufe}</Text>
              </View>
            )}
            <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
              {successInvoice?.pdf_url && (
                <TouchableOpacity style={[s.btn, { flex: 1 }]} onPress={() => Linking.openURL(successInvoice!.pdf_url!)} accessibilityRole="button">
                  <Ionicons name="download-outline" size={16} color="white" />
                  <Text style={s.btnTxt}>PDF</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={[s.btnSecondary, { flex: 1 }]} onPress={() => { setSuccessInvoice(null); setTab(2); }} accessibilityRole="button">
                <Text style={s.btnSecondaryTxt}>Ver historial</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.btnSecondary, { flex: 1 }]}
                onPress={() => { setSuccessInvoice(null); if (ventaId) router.back(); }} accessibilityRole="button">
                <Text style={s.btnSecondaryTxt}>{ventaId ? "Listo" : "Nueva"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function crearEstilos(t: ThemeColors) {
  return StyleSheet.create({
    tabBar:       { flexDirection: "row", backgroundColor: t.cardSolid, borderBottomWidth: 1, borderBottomColor: t.line },
    tabItem:      { flex: 1, alignItems: "center", paddingVertical: 12 },
    tabTxt:       { fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold", color: t.muted, textAlign: "center" },
    tabTxtActive: { color: Colors.red, fontFamily: "SpaceGrotesk_700Bold" },
    tabUnderline: { position: "absolute", bottom: 0, left: 8, right: 8, height: 2, backgroundColor: Colors.red, borderRadius: 1 },

    sectionTitle: { fontSize: 11, fontFamily: "JetBrainsMono_500Medium", color: t.subtle, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 },
    card:         { backgroundColor: t.cardSolid, borderWidth: 1, borderColor: t.line, borderRadius: Radius.lg, padding: 16, marginBottom: 4 },
    hint:         { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: t.muted, marginBottom: 16, lineHeight: 18 },
    fieldLabel:   { fontSize: 11, fontFamily: "JetBrainsMono_500Medium", color: t.subtle, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
    input:        { backgroundColor: t.chipBg, borderRadius: Radius.md, padding: 12, fontSize: 14, fontFamily: "SpaceGrotesk_400Regular", color: t.text },
    priceHint:    { fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold", color: t.subtle, marginTop: 4 },

    envRow:      { flexDirection: "row", gap: 10, marginBottom: 16 },
    envBtn:      { flex: 1, padding: 10, borderRadius: Radius.md, borderWidth: 1.5, borderColor: t.line, alignItems: "center" },
    envBtnActive:{ borderColor: Colors.red, backgroundColor: Colors.red + "10" },
    envBtnTxt:   { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: t.muted },
    envBtnTxtActive: { color: Colors.red },

    pickerBtn:  { flexDirection: "row", alignItems: "center", backgroundColor: t.chipBg, borderRadius: Radius.md, padding: 12, marginBottom: 12 },
    pickerTxt:  { flex: 1, fontSize: 14, fontFamily: "SpaceGrotesk_400Regular", color: t.text },

    banner:    { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: Radius.md, marginBottom: 8 },
    bannerTxt: { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", flex: 1 },
    bannerSub: { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular" },

    btn:         { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: Colors.red, borderRadius: Radius.lg, padding: 14 },
    btnTxt:      { fontSize: 14, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
    btnSecondary:{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: Radius.lg, padding: 14, borderWidth: 1, borderColor: t.line, backgroundColor: t.cardSolid },
    btnSecondaryTxt: { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: t.muted },

    taxBtn:        { paddingVertical: 6, paddingHorizontal: 10, borderRadius: Radius.sm, borderWidth: 1, borderColor: t.line, backgroundColor: t.chipBg },
    taxBtnActive:  { backgroundColor: Colors.blue, borderColor: Colors.blue },
    taxBtnTxt:     { fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold", color: t.muted },
    taxBtnTxtActive: { color: Colors.white, fontFamily: "SpaceGrotesk_700Bold" },

    addItemBtn:    { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10 },
    addItemBtnTxt: { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.blue },

    summaryCard:  { backgroundColor: t.cardSolid, borderWidth: 1, borderColor: t.line, borderRadius: Radius.lg, padding: 16, marginTop: 16 },
    summaryRow:   { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
    summaryLabel: { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: t.muted },
    summaryValue: { fontSize: 14, fontFamily: "SpaceGrotesk_700Bold", color: t.text },

    invCard:     { backgroundColor: t.cardSolid, borderWidth: 1, borderColor: t.line, borderRadius: Radius.lg, overflow: "hidden" },
    invHeader:   { flexDirection: "row", alignItems: "center", gap: 10, padding: 14 },
    invNumber:   { backgroundColor: Colors.red + "14", paddingVertical: 4, paddingHorizontal: 8, borderRadius: Radius.sm },
    invNumberTxt:{ fontSize: 12, fontFamily: "SpaceGrotesk_700Bold", color: Colors.red },
    invCustomer: { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: t.text },
    invDate:     { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", color: t.muted },
    invTotal:    { fontSize: 14, fontFamily: "SpaceGrotesk_700Bold", color: t.text },
    statusBadge: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: Radius.full },
    statusTxt:   { fontSize: 10, fontFamily: "SpaceGrotesk_700Bold" },
    invDetail:   { padding: 14, borderTopWidth: 1, borderTopColor: t.line, backgroundColor: t.chipBg },
    invDetailLabel: { fontSize: 11, fontFamily: "JetBrainsMono_500Medium", color: t.subtle, textTransform: "uppercase", marginBottom: 4 },
    invCufe:     { fontSize: 10, fontFamily: "SpaceGrotesk_400Regular", color: t.text, lineHeight: 16 },
    invItem:     { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: t.muted },

    emptyBox:  { alignItems: "center", justifyContent: "center", paddingVertical: 60, gap: 12 },
    emptyTitle:{ fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", color: t.text },
    emptyTxt:  { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: t.muted },
  });
}

function crearEstilosPicker(t: ThemeColors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
    sheet:   { backgroundColor: t.cardSolid, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, maxHeight: "65%" },
    handle:  { width: 40, height: 4, backgroundColor: t.lineStrong, borderRadius: 2, alignSelf: "center", marginBottom: 16 },
    title:   { fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", color: t.text, marginBottom: 12 },
    row:     { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, paddingHorizontal: 4 },
    rowTxt:  { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: t.text },
    sep:     { height: 1, backgroundColor: t.line },
  });
}

function crearEstilosExito(t: ThemeColors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 24 },
    card:    { backgroundColor: t.cardSolid, borderWidth: 1, borderColor: t.line, borderRadius: 24, padding: 28, width: "100%", alignItems: "center" },
    icon:    { marginBottom: 12 },
    title:   { fontSize: 20, fontFamily: "SpaceGrotesk_700Bold", color: t.text, marginBottom: 6 },
    sub:     { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: t.muted, marginBottom: 16 },
    numBox:  { backgroundColor: Colors.blue + "14", borderRadius: Radius.md, padding: 14, width: "100%", alignItems: "center", marginBottom: 10 },
    numLabel:{ fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", color: t.muted },
    numValue:{ fontSize: 20, fontFamily: "SpaceGrotesk_700Bold", color: Colors.blue },
    cufeBox: { backgroundColor: t.chipBg, borderRadius: Radius.md, padding: 12, width: "100%" },
    cufeLabel:{ fontSize: 11, fontFamily: "JetBrainsMono_500Medium", color: t.muted, textTransform: "uppercase", marginBottom: 4 },
    cufeValue:{ fontSize: 10, fontFamily: "SpaceGrotesk_400Regular", color: t.text, lineHeight: 16 },
  });
}
