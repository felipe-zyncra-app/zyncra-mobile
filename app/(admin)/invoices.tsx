import { useEffect, useState, useCallback } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Alert, TextInput, Modal, FlatList, ActivityIndicator, Linking,
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
import { Config } from "@/lib/config";
import { useAuth } from "@/lib/auth";
import { fmtMoneyFull, fmtDateFull } from "@/lib/format";

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

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  sent:     { label: "Enviada",   color: "#388e3c", bg: "#e8f5e9" },
  accepted: { label: "Aceptada",  color: "#1565c0", bg: "#e3f2fd" },
  rejected: { label: "Rechazada", color: "#c62828", bg: "#fce4ec" },
  draft:    { label: "Borrador",  color: "#757575", bg: "#f5f5f5" },
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

// ─── Main ──────────────────────────────────────────────────────────────────────

export default function InvoicesScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const [tab, setTab]         = useState(0);
  const { tenantId } = useAuth();

  // Settings
  const [settings, setSettings]     = useState<InvoiceSettings>(EMPTY_SETTINGS);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSaved, setSettingsSaved]   = useState(false);
  const [testingConn, setTestingConn]       = useState(false);
  const [connResult, setConnResult]         = useState<{ ok: boolean; msg: string } | null>(null);

  // Invoice form
  const [customer, setCustomer]   = useState<CustomerForm>(EMPTY_CUSTOMER);
  const [items, setItems]         = useState<InvoiceItem[]>([{ ...EMPTY_ITEM }]);
  const [paymentMethod, setPaymentMethod] = useState("10");
  const [notes, setNotes]         = useState("");
  const [emitting, setEmitting]   = useState(false);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);
  const [successInvoice, setSuccessInvoice] = useState<{ cufe: string; number: string; pdf_url?: string } | null>(null);
  const [muniModal, setMuniModal] = useState(false);
  const [cusMuniModal, setCusMuniModal] = useState(false);
  const [idTypeModal, setIdTypeModal]   = useState(false);
  const [payModal, setPayModal]   = useState(false);

  // History
  const [invoices, setInvoices]     = useState<Invoice[]>([]);
  const [loadingInv, setLoadingInv] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    loadSettings().then(() => { if (cancelled) return; });
    return () => { cancelled = true; };
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId || tab !== 2) return;
    let cancelled = false;
    loadInvoices().then(() => { if (cancelled) return; });
    return () => { cancelled = true; };
  }, [tab, tenantId]);

  const loadSettings = async () => {
    if (!tenantId) return;
    const { data } = await supabase.from("invoice_settings").select("*").eq("tenant_id", tenantId).maybeSingle();
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

  const saveSettings = async () => {
    if (!tenantId) return;
    setSavingSettings(true); setSettingsSaved(false);
    await supabase.from("invoice_settings").upsert({
      tenant_id: tenantId, ...settings,
      numbering_range_id: settings.numbering_range_id ? Number(settings.numbering_range_id) : null,
      municipality_id:    settings.municipality_id    ? Number(settings.municipality_id)    : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "tenant_id" });
    setSavingSettings(false); setSettingsSaved(true);
    setTimeout(() => setSettingsSaved(false), 2500);
  };

  const testConnection = async () => {
    setTestingConn(true); setConnResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(Config.api.factus, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test", supabaseToken: session?.access_token, tenantId }),
      });
      const json = await res.json();
      setConnResult(res.ok ? { ok: true, msg: "Conexión exitosa con Factus." } : { ok: false, msg: json.error ?? "Error al conectar." });
    } catch {
      setConnResult({ ok: false, msg: "Error de red." });
    }
    setTestingConn(false);
  };

  const loadInvoices = useCallback(async () => {
    if (!tenantId) return;
    setLoadingInv(true);
    const { data } = await supabase.from("invoices")
      .select("*, invoice_items(*)")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(100);
    setInvoices((data as Invoice[]) ?? []);
    setLoadingInv(false);
  }, [tenantId]);

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

  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const taxTotal = items.reduce((s, i) => s + (i.price * i.quantity * (parseFloat(i.tax_rate) || 0)) / 100, 0);
  const total    = subtotal + taxTotal;

  const emitInvoice = async () => {
    setInvoiceError(null);
    if (!customer.id_number || !customer.name) { setInvoiceError("Completa el número y nombre del cliente."); return; }
    if (items.some(i => !i.name || i.price <= 0)) { setInvoiceError("Todos los ítems necesitan nombre y precio > 0."); return; }
    setEmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(Config.api.factus, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create", supabaseToken: session?.access_token,
          tenantId, invoiceData: { customer, items, paymentMethod, notes },
        }),
      });
      const json = await res.json();
      if (res.ok) {
        setSuccessInvoice({ cufe: json.cufe, number: json.number, pdf_url: json.pdf_url });
        setCustomer(EMPTY_CUSTOMER); setItems([{ ...EMPTY_ITEM }]); setNotes("");
      } else {
        setInvoiceError(json.error ?? "Error al emitir la factura.");
      }
    } catch {
      setInvoiceError("Error de red al conectar con Factus.");
    }
    setEmitting(false);
  };

  // ── Settings tab ──────────────────────────────────────────────────────────

  const renderSettings = () => (
    <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 20, paddingBottom: 110 }}>
      <Text style={[s.sectionTitle, { color: t.subtle }]}>Credenciales Factus</Text>
      <View style={[s.card, Shadow.sm, { backgroundColor: t.bgAlt }]}>
        <Text style={[s.hint, { color: t.muted }]}>
          Conecta tu cuenta de Factus para emitir facturas electrónicas validadas por la DIAN.
        </Text>

        <Text style={[s.fieldLabel, { color: t.subtle }]}>Ambiente</Text>
        <View style={s.envRow}>
          {(["sandbox", "production"] as const).map(env => (
            <TouchableOpacity
              key={env}
              style={[s.envBtn, settings.environment === env && s.envBtnActive]}
              onPress={() => setSettings(p => ({ ...p, environment: env }))}
            >
              <Text style={[s.envBtnTxt, settings.environment === env && s.envBtnTxtActive]}>
                {env === "sandbox" ? "Sandbox (Pruebas)" : "Producción"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {[
          { key: "factus_client_id",     label: "Client ID" },
          { key: "factus_client_secret", label: "Client Secret" },
          { key: "factus_username",      label: "Usuario (email Factus)" },
          { key: "factus_password",      label: "Contraseña Factus" },
          { key: "numbering_range_id",   label: "ID Rango Numeración DIAN" },
        ].map(({ key, label }) => (
          <View key={key} style={{ marginBottom: 12 }}>
            <Text style={[s.fieldLabel, { color: t.subtle }]}>{label}</Text>
            <TextInput
              style={[s.input, { backgroundColor: t.bg, color: t.text }]}
              value={(settings as any)[key]}
              onChangeText={v => setSettings(p => ({ ...p, [key]: v }))}
              secureTextEntry={key.includes("secret") || key.includes("password")}
              placeholderTextColor={t.subtle}
              placeholder={label}
            />
          </View>
        ))}
      </View>

      <Text style={[s.sectionTitle, { marginTop: 20, color: t.subtle }]}>Datos del Emisor</Text>
      <View style={[s.card, Shadow.sm, { backgroundColor: t.bgAlt }]}>
        {[
          { key: "nit",          label: "NIT" },
          { key: "dv",           label: "Dígito de verificación (DV)" },
          { key: "company_name", label: "Razón Social" },
          { key: "phone",        label: "Teléfono" },
          { key: "address",      label: "Dirección" },
        ].map(({ key, label }) => (
          <View key={key} style={{ marginBottom: 12 }}>
            <Text style={[s.fieldLabel, { color: t.subtle }]}>{label}</Text>
            <TextInput
              style={[s.input, { backgroundColor: t.bg, color: t.text }]}
              value={(settings as any)[key]}
              onChangeText={v => setSettings(p => ({ ...p, [key]: v }))}
              placeholderTextColor={t.subtle}
              placeholder={label}
            />
          </View>
        ))}
        <Text style={[s.fieldLabel, { color: t.subtle }]}>Municipio</Text>
        <TouchableOpacity style={[s.pickerBtn, { backgroundColor: t.bg }]} onPress={() => setMuniModal(true)}>
          <Text style={[s.pickerTxt, !settings.municipality_id && { color: Colors.subtle }]}>
            {MUNICIPALITIES.find(m => String(m.id) === settings.municipality_id)?.label ?? "Seleccionar municipio"}
          </Text>
          <Ionicons name="chevron-down" size={16} color={Colors.subtle} />
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
        <TouchableOpacity style={[s.btn, { flex: 1 }]} onPress={saveSettings} disabled={savingSettings}>
          {savingSettings ? <ActivityIndicator color="white" size="small" /> : <Text style={s.btnTxt}>Guardar</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={[s.btnSecondary, { flex: 1 }]} onPress={testConnection} disabled={testingConn}>
          {testingConn ? <ActivityIndicator color={Colors.blue} size="small" /> : <Text style={s.btnSecondaryTxt}>Probar conexión</Text>}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );

  // ── Nueva factura tab ─────────────────────────────────────────────────────

  const renderNueva = () => (
    <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 20, paddingBottom: 110 }} keyboardShouldPersistTaps="handled">
      <Text style={[s.sectionTitle, { color: t.subtle }]}>Datos del Cliente</Text>
      <View style={[s.card, Shadow.sm, { backgroundColor: t.bgAlt }]}>
        <Text style={[s.fieldLabel, { color: t.subtle }]}>Tipo de documento</Text>
        <TouchableOpacity style={[s.pickerBtn, { backgroundColor: t.bg }]} onPress={() => setIdTypeModal(true)}>
          <Text style={[s.pickerTxt, { color: t.text }]}>{ID_TYPES.find(t => t.id === customer.id_type)?.label}</Text>
          <Ionicons name="chevron-down" size={16} color={Colors.subtle} />
        </TouchableOpacity>

        {[
          { key: "id_number", label: "Número de documento", keyboard: "default" },
          { key: "name",      label: "Nombres",             keyboard: "default" },
          { key: "surname",   label: "Apellidos",            keyboard: "default" },
          { key: "company",   label: "Empresa / Razón social", keyboard: "default" },
          { key: "email",     label: "Email",               keyboard: "email-address" },
          { key: "phone",     label: "Teléfono",            keyboard: "phone-pad" },
          { key: "address",   label: "Dirección",           keyboard: "default" },
        ].map(({ key, label, keyboard }) => (
          <View key={key} style={{ marginBottom: 12 }}>
            <Text style={[s.fieldLabel, { color: t.subtle }]}>{label}</Text>
            <TextInput
              style={[s.input, { backgroundColor: t.bg, color: t.text }]}
              value={(customer as any)[key]}
              onChangeText={v => setCustomer(p => ({ ...p, [key]: v }))}
              keyboardType={keyboard as any}
              placeholder={label}
              placeholderTextColor={t.subtle}
            />
          </View>
        ))}

        <Text style={[s.fieldLabel, { color: t.subtle }]}>Municipio</Text>
        <TouchableOpacity style={[s.pickerBtn, { backgroundColor: t.bg }]} onPress={() => setCusMuniModal(true)}>
          <Text style={[s.pickerTxt, { color: t.text }]}>{MUNICIPALITIES.find(m => m.id === customer.municipality_id)?.label ?? "—"}</Text>
          <Ionicons name="chevron-down" size={16} color={Colors.subtle} />
        </TouchableOpacity>
      </View>

      <Text style={[s.sectionTitle, { marginTop: 20, color: t.subtle }]}>Ítems / Servicios</Text>
      <View style={[s.card, Shadow.sm, { backgroundColor: t.bgAlt }]}>
        {items.map((item, i) => (
          <View key={i} style={{ marginBottom: 16, borderBottomWidth: i < items.length - 1 ? 1 : 0, borderBottomColor: t.border, paddingBottom: i < items.length - 1 ? 16 : 0 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <Text style={[s.fieldLabel, { color: t.subtle }]}>Ítem {i + 1}</Text>
              {items.length > 1 && (
                <TouchableOpacity onPress={() => setItems(p => p.filter((_, idx) => idx !== i))}>
                  <Ionicons name="close-circle-outline" size={20} color={Colors.red} />
                </TouchableOpacity>
              )}
            </View>
            <TextInput style={[s.input, { marginBottom: 8 }]} value={item.name} onChangeText={v => updateItem(i, "name", v)} placeholder="Descripción del ítem" placeholderTextColor={t.subtle} />
            <View style={{ flexDirection: "row", gap: 10, marginBottom: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={[s.fieldLabel, { marginBottom: 4 }]}>Cant.</Text>
                <TextInput style={s.input} value={String(item.quantity)} onChangeText={v => updateItem(i, "quantity", parseInt(v) || 1)} keyboardType="numeric" />
              </View>
              <View style={{ flex: 2 }}>
                <Text style={[s.fieldLabel, { marginBottom: 4 }]}>Precio unit.</Text>
                <TextInput style={s.input} value={String(item.price)} onChangeText={v => updateItem(i, "price", parseFloat(v) || 0)} keyboardType="numeric" />
              </View>
            </View>
            <Text style={[s.fieldLabel, { color: t.subtle }]}>IVA</Text>
            <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
              {TAX_OPTIONS.map(opt => (
                <TouchableOpacity key={opt.value} style={[s.taxBtn, item.tax_rate === opt.value && s.taxBtnActive]} onPress={() => updateItem(i, "tax_rate", opt.value)}>
                  <Text style={[s.taxBtnTxt, item.tax_rate === opt.value && s.taxBtnTxtActive]}>{opt.label.split("—")[0].trim()}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}
        <TouchableOpacity style={s.addItemBtn} onPress={() => setItems(p => [...p, { ...EMPTY_ITEM }])}>
          <Ionicons name="add-circle-outline" size={16} color={Colors.blue} />
          <Text style={s.addItemBtnTxt}>Agregar ítem</Text>
        </TouchableOpacity>
      </View>

      <Text style={[s.sectionTitle, { marginTop: 20, color: t.subtle }]}>Método de pago</Text>
      <TouchableOpacity style={[s.card, Shadow.sm, { padding: 0, backgroundColor: t.bgAlt }]} onPress={() => setPayModal(true)}>
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

      <Text style={[s.sectionTitle, { marginTop: 20, color: t.subtle }]}>Notas</Text>
      <View style={[s.card, Shadow.sm, { backgroundColor: t.bgAlt }]}>
        <TextInput
          style={[s.input, { backgroundColor: t.bg, color: t.text }, { minHeight: 70, textAlignVertical: "top" }]}
          value={notes}
          onChangeText={setNotes}
          multiline
          placeholder="Observaciones (opcional)"
          placeholderTextColor={t.subtle}
        />
      </View>

      <View style={[s.summaryCard, Shadow.sm, { backgroundColor: t.bgAlt }]}>
        <View style={s.summaryRow}>
          <Text style={[s.summaryLabel, { color: t.muted }]}>Subtotal</Text>
          <Text style={[s.summaryValue, { color: t.text }]}>{fmtMoneyFull(subtotal)}</Text>
        </View>
        <View style={s.summaryRow}>
          <Text style={[s.summaryLabel, { color: t.muted }]}>IVA</Text>
          <Text style={[s.summaryValue, { color: t.text }]}>{fmtMoneyFull(taxTotal)}</Text>
        </View>
        <View style={[s.summaryRow, { borderTopWidth: 1, borderTopColor: t.border, paddingTop: 10, marginTop: 4 }]}>
          <Text style={[s.summaryLabel, { fontFamily: "SpaceGrotesk_700Bold", color: t.text }]}>Total</Text>
          <Text style={[s.summaryValue, { fontSize: 18, color: t.text }]}>{fmtMoneyFull(total)}</Text>
        </View>
      </View>

      {invoiceError && (
        <View style={[s.banner, { backgroundColor: Colors.red + "12", marginTop: 8 }]}>
          <Ionicons name="close-circle-outline" size={16} color={Colors.red} />
          <Text style={[s.bannerTxt, { color: Colors.red }]}>{invoiceError}</Text>
        </View>
      )}

      <TouchableOpacity style={[s.btn, { marginTop: 16 }]} onPress={emitInvoice} disabled={emitting}>
        {emitting ? <ActivityIndicator color="white" size="small" /> : (
          <>
            <Ionicons name="document-text-outline" size={18} color="white" />
            <Text style={s.btnTxt}>Emitir Factura DIAN</Text>
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
      {loadingInv ? (
        <ActivityIndicator color={Colors.red} style={{ marginTop: 32 }} />
      ) : invoices.length === 0 ? (
        <View style={s.emptyBox}>
          <Ionicons name="document-text-outline" size={40} color={t.subtle} />
          <Text style={[s.emptyTitle, { color: t.text }]}>Sin facturas aún</Text>
          <Text style={[s.emptyTxt, { color: t.muted }]}>Las facturas emitidas aparecerán aquí</Text>
        </View>
      ) : (
        <FlatList
          data={invoices}
          keyExtractor={i => i.id}
          contentContainerStyle={{ padding: 20, paddingBottom: 110 }}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          renderItem={({ item: inv }) => {
            const st = STATUS_MAP[inv.status] ?? STATUS_MAP.draft;
            const expanded = expandedId === inv.id;
            return (
              <View style={[s.invCard, Shadow.sm, { backgroundColor: t.bgAlt }]}>
                <TouchableOpacity onPress={() => setExpandedId(expanded ? null : inv.id)} style={s.invHeader}>
                  <View style={s.invNumber}>
                    <Text style={s.invNumberTxt}>#{inv.number || "—"}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.invCustomer, { color: t.text }]}>{inv.customer_name}</Text>
                    <Text style={[s.invDate, { color: t.muted }]}>{fmtDateFull(inv.created_at)}</Text>
                  </View>
                  <Text style={[s.invTotal, { color: t.text }]}>{fmtMoneyFull(inv.total)}</Text>
                  <View style={[s.statusBadge, { backgroundColor: st.bg }]}>
                    <Text style={[s.statusTxt, { color: st.color }]}>{st.label}</Text>
                  </View>
                  <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={16} color={t.subtle} />
                </TouchableOpacity>
                {expanded && (
                  <View style={[s.invDetail, { backgroundColor: t.bg, borderTopColor: t.border }]}>
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
                      <TouchableOpacity style={[s.btnSecondary, { marginTop: 12, alignSelf: "flex-start" }]} onPress={() => Linking.openURL(inv.pdf_url!)}>
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
      {/* Header */}
      <ScreenHeader crumb="Ventas" title="Factura Electrónica" subtitle="Emite facturas DIAN vía Factus" onBack={() => router.back()} />

      {/* Tab bar */}
      <View style={[s.tabBar, { backgroundColor: t.bgAlt, borderBottomColor: t.border }]}>
        {["Configuración", "Nueva Factura", "Historial"].map((label, i) => (
          <TouchableOpacity key={i} style={s.tabItem} onPress={() => setTab(i)}>
            <Text style={[s.tabTxt, { color: t.muted }, tab === i && s.tabTxtActive]}>{label}</Text>
            {tab === i && <View style={s.tabUnderline} />}
          </TouchableOpacity>
        ))}
      </View>

      {tab === 0 && renderSettings()}
      {tab === 1 && renderNueva()}
      {tab === 2 && renderHistorial()}

      {/* Municipio picker (settings) */}
      <Modal visible={muniModal} animationType="slide" transparent>
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
              ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: Colors.border }} />}
            />
          </View>
        </View>
      </Modal>

      {/* Municipio picker (customer) */}
      <Modal visible={cusMuniModal} animationType="slide" transparent>
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
              ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: Colors.border }} />}
            />
          </View>
        </View>
      </Modal>

      {/* ID Type picker */}
      <Modal visible={idTypeModal} animationType="slide" transparent>
        <View style={pk.overlay}>
          <View style={pk.sheet}>
            <View style={pk.handle} />
            <Text style={pk.title}>Tipo de documento</Text>
            {ID_TYPES.map((t, i) => (
              <View key={t.id}>
                {i > 0 && <View style={{ height: 1, backgroundColor: Colors.border }} />}
                <TouchableOpacity style={pk.row} onPress={() => { setCustomer(p => ({ ...p, id_type: t.id })); setIdTypeModal(false); }}>
                  <Text style={pk.rowTxt}>{t.label}</Text>
                  {customer.id_type === t.id && <Ionicons name="checkmark" size={18} color={Colors.red} />}
                </TouchableOpacity>
              </View>
            ))}
          </View>
        </View>
      </Modal>

      {/* Payment method picker */}
      <Modal visible={payModal} animationType="slide" transparent>
        <View style={pk.overlay}>
          <View style={pk.sheet}>
            <View style={pk.handle} />
            <Text style={pk.title}>Método de pago</Text>
            {PAYMENT_METHODS.map((pm, i) => (
              <View key={pm.code}>
                {i > 0 && <View style={{ height: 1, backgroundColor: Colors.border }} />}
                <TouchableOpacity style={pk.row} onPress={() => { setPaymentMethod(pm.code); setPayModal(false); }}>
                  <Ionicons name={pm.icon} size={18} color={Colors.muted} />
                  <Text style={[pk.rowTxt, { flex: 1 }]}>{pm.label}</Text>
                  {paymentMethod === pm.code && <Ionicons name="checkmark" size={18} color={Colors.red} />}
                </TouchableOpacity>
              </View>
            ))}
          </View>
        </View>
      </Modal>

      {/* Success modal */}
      <Modal visible={!!successInvoice} animationType="fade" transparent>
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
                <TouchableOpacity style={[s.btn, { flex: 1 }]} onPress={() => Linking.openURL(successInvoice!.pdf_url!)}>
                  <Ionicons name="download-outline" size={16} color="white" />
                  <Text style={s.btnTxt}>PDF</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={[s.btnSecondary, { flex: 1 }]} onPress={() => { setSuccessInvoice(null); setTab(2); loadInvoices(); }}>
                <Text style={s.btnSecondaryTxt}>Ver historial</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.btnSecondary, { flex: 1 }]} onPress={() => setSuccessInvoice(null)}>
                <Text style={s.btnSecondaryTxt}>Nueva</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  header:      { paddingTop: 16, paddingHorizontal: 24, paddingBottom: 20 },
  headerRow:   { flexDirection: "row", alignItems: "center", gap: 14 },
  backBtn:     { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 20, fontFamily: "SpaceGrotesk_700Bold", color: "white", letterSpacing: -0.5 },
  headerSub:   { fontSize: 12, color: "rgba(255,255,255,.75)", fontFamily: "SpaceGrotesk_400Regular", marginTop: 2 },

  tabBar:       { flexDirection: "row", backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border },
  tabItem:      { flex: 1, alignItems: "center", paddingVertical: 12 },
  tabTxt:       { fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted, textAlign: "center" },
  tabTxtActive: { color: Colors.red, fontFamily: "SpaceGrotesk_700Bold" },
  tabUnderline: { position: "absolute", bottom: 0, left: 8, right: 8, height: 2, backgroundColor: Colors.red, borderRadius: 1 },

  sectionTitle: { fontSize: 11, fontFamily: "JetBrainsMono_500Medium", color: Colors.subtle, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 },
  card:         { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.lg, padding: 16, marginBottom: 4 },
  hint:         { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, marginBottom: 16, lineHeight: 18 },
  fieldLabel:   { fontSize: 11, fontFamily: "JetBrainsMono_500Medium", color: Colors.subtle, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  input:        { backgroundColor: Colors.cream2, borderRadius: Radius.md, padding: 12, fontSize: 14, fontFamily: "SpaceGrotesk_400Regular", color: Colors.text },

  envRow:      { flexDirection: "row", gap: 10, marginBottom: 16 },
  envBtn:      { flex: 1, padding: 10, borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.border, alignItems: "center" },
  envBtnActive:{ borderColor: Colors.red, backgroundColor: Colors.red + "10" },
  envBtnTxt:   { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted },
  envBtnTxtActive: { color: Colors.red },

  pickerBtn:  { flexDirection: "row", alignItems: "center", backgroundColor: Colors.cream2, borderRadius: Radius.md, padding: 12, marginBottom: 12 },
  pickerTxt:  { flex: 1, fontSize: 14, fontFamily: "SpaceGrotesk_400Regular", color: Colors.text },

  banner:    { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: Radius.md, marginBottom: 8 },
  bannerTxt: { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", flex: 1 },

  btn:         { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: Colors.red, borderRadius: Radius.lg, padding: 14 },
  btnTxt:      { fontSize: 14, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
  btnSecondary:{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: Radius.lg, padding: 14, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white },
  btnSecondaryTxt: { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted },

  taxBtn:        { paddingVertical: 6, paddingHorizontal: 10, borderRadius: Radius.sm, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.cream2 },
  taxBtnActive:  { backgroundColor: Colors.blue, borderColor: Colors.blue },
  taxBtnTxt:     { fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted },
  taxBtnTxtActive: { color: Colors.white, fontFamily: "SpaceGrotesk_700Bold" },

  addItemBtn:    { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10 },
  addItemBtnTxt: { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.blue },

  summaryCard:  { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.lg, padding: 16, marginTop: 16 },
  summaryRow:   { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  summaryLabel: { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted },
  summaryValue: { fontSize: 14, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text },

  invCard:     { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.lg, overflow: "hidden" },
  invHeader:   { flexDirection: "row", alignItems: "center", gap: 10, padding: 14 },
  invNumber:   { backgroundColor: Colors.red + "14", paddingVertical: 4, paddingHorizontal: 8, borderRadius: Radius.sm },
  invNumberTxt:{ fontSize: 12, fontFamily: "SpaceGrotesk_700Bold", color: Colors.red },
  invCustomer: { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  invDate:     { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted },
  invTotal:    { fontSize: 14, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text },
  statusBadge: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: Radius.full },
  statusTxt:   { fontSize: 10, fontFamily: "SpaceGrotesk_700Bold" },
  invDetail:   { padding: 14, borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.cream2 },
  invDetailLabel: { fontSize: 11, fontFamily: "JetBrainsMono_500Medium", color: Colors.subtle, textTransform: "uppercase", marginBottom: 4 },
  invCufe:     { fontSize: 10, fontFamily: "SpaceGrotesk_400Regular", color: Colors.text, lineHeight: 16 },
  invItem:     { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted },

  emptyBox:  { alignItems: "center", justifyContent: "center", paddingVertical: 60, gap: 12 },
  emptyTitle:{ fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text },
  emptyTxt:  { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted },
});

const pk = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet:   { backgroundColor: Colors.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, maxHeight: "65%" },
  handle:  { width: 40, height: 4, backgroundColor: Colors.border, borderRadius: 2, alignSelf: "center", marginBottom: 16 },
  title:   { fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text, marginBottom: 12 },
  row:     { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, paddingHorizontal: 4 },
  rowTxt:  { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
});

const sc = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 24 },
  card:    { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: 24, padding: 28, width: "100%", alignItems: "center" },
  icon:    { marginBottom: 12 },
  title:   { fontSize: 20, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text, marginBottom: 6 },
  sub:     { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, marginBottom: 16 },
  numBox:  { backgroundColor: Colors.blue + "10", borderRadius: Radius.md, padding: 14, width: "100%", alignItems: "center", marginBottom: 10 },
  numLabel:{ fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted },
  numValue:{ fontSize: 20, fontFamily: "SpaceGrotesk_700Bold", color: Colors.blue },
  cufeBox: { backgroundColor: Colors.cream2, borderRadius: Radius.md, padding: 12, width: "100%" },
  cufeLabel:{ fontSize: 11, fontFamily: "JetBrainsMono_500Medium", color: Colors.muted, textTransform: "uppercase", marginBottom: 4 },
  cufeValue:{ fontSize: 10, fontFamily: "SpaceGrotesk_400Regular", color: Colors.text, lineHeight: 16 },
});
