import { useEffect, useState } from "react";
import {
  View, Text, Modal, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { recordSale } from "@/lib/record-sale";
import { Colors, Gradients, Radius, Shadow, Glass } from "@/constants/theme";

const METHODS = [
  { key: "efectivo",      label: "Efectivo",      icon: "cash-outline" as const },
  { key: "tarjeta",       label: "Tarjeta",        icon: "card-outline" as const },
  { key: "transferencia", label: "Transferencia",  icon: "phone-portrait-outline" as const },
  { key: "nequi",         label: "Nequi",          icon: "logo-whatsapp" as const },
  { key: "daviplata",     label: "Daviplata",      icon: "phone-portrait-outline" as const },
  { key: "qr",            label: "QR",             icon: "qr-code-outline" as const },
];

type Client = { id: string; name: string };

interface Props {
  visible: boolean;
  tenantId: string;
  onClose: () => void;
  onSaved: () => void;
}

export default function ManualSaleModal({ visible, tenantId, onClose, onSaved }: Props) {
  const router = useRouter();
  const [description, setDescription] = useState("");
  const [amount, setAmount]           = useState("");
  const [method, setMethod]           = useState("efectivo");
  const [clientQ, setClientQ]         = useState("");
  const [clients, setClients]         = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [saving, setSaving]           = useState(false);

  useEffect(() => {
    if (!visible) { reset(); return; }
  }, [visible]);

  useEffect(() => {
    if (clientQ.length < 2) { setClients([]); return; }
    supabase.from("clients")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .ilike("name", `%${clientQ}%`)
      .limit(5)
      .then(({ data }) => setClients(data ?? []));
  }, [clientQ]);

  function reset() {
    setDescription(""); setAmount(""); setMethod("efectivo");
    setClientQ(""); setClients([]); setSelectedClient(null);
  }

  const total = parseFloat(amount.replace(/\./g, "").replace(",", ".")) || 0;
  const canSave = description.trim().length >= 2 && total > 0;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      // recordSale escribe venta + ítem + ingreso en la caja abierta de la
      // sede activa (antes faltaba el movimiento de caja y la venta directa
      // nunca aparecía en el arqueo).
      const concept = description.trim();
      const res = await recordSale({
        tenantId,
        total,
        paymentMethod: method,
        clientId: selectedClient?.id ?? null,
        note: concept,
        description: `Venta POS${selectedClient ? ` · ${selectedClient.name}` : ""} · ${concept}`,
        items: [{ name: concept, price: total, quantity: 1, item_type: "service" }],
      });
      if (!res.ok) {
        if (res.error === "NO_CASH_SESSION") {
          Alert.alert(
            "La caja está cerrada",
            "Abre la caja de esta sede antes de registrar la venta. Así queda en el arqueo del día, igual que en el panel web.",
            [
              { text: "Ahora no", style: "cancel" },
              { text: "Abrir caja", onPress: () => { onClose(); router.push("/(admin)/caja"); } },
            ],
          );
        } else {
          Alert.alert("No se pudo registrar la venta", "Revisa tu conexión e inténtalo de nuevo.");
        }
        return;
      }
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: Colors.cream2 }}>
        <LinearGradient colors={Gradients.ink} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.header}>
          <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3 }} />
          <View style={s.headerRow}>
            <TouchableOpacity onPress={onClose} style={s.closeBtn}>
              <Ionicons name="close" size={20} color="white" />
            </TouchableOpacity>
            <Text style={s.headerTitle}>Venta directa</Text>
            <View style={{ width: 40 }} />
          </View>
        </LinearGradient>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">

            {/* Description */}
            <Text style={s.label}>Concepto *</Text>
            <TextInput
              style={s.input}
              value={description}
              onChangeText={setDescription}
              placeholder="Ej: Corte de cabello"
              placeholderTextColor={Colors.subtle}
              autoCapitalize="sentences"
            />

            {/* Amount */}
            <Text style={s.label}>Valor *</Text>
            <View style={s.amountWrap}>
              <Text style={s.currencySymbol}>$</Text>
              <TextInput
                style={[s.input, { flex: 1, borderLeftWidth: 0, borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }]}
                value={amount}
                onChangeText={setAmount}
                placeholder="0"
                placeholderTextColor={Colors.subtle}
                keyboardType="numeric"
              />
            </View>

            {/* Payment method */}
            <Text style={s.label}>Método de pago</Text>
            <View style={s.methodGrid}>
              {METHODS.map(m => (
                <TouchableOpacity
                  key={m.key}
                  style={[s.methodBtn, method === m.key && s.methodBtnActive]}
                  onPress={() => setMethod(m.key)}
                  activeOpacity={0.75}
                >
                  {method === m.key ? (
                    <View style={s.methodGrad}>
                      <Ionicons name={m.icon} size={18} color="white" />
                      <Text style={s.methodLabelActive}>{m.label}</Text>
                    </View>
                  ) : (
                    <View style={s.methodInner}>
                      <Ionicons name={m.icon} size={18} color={Colors.subtle} />
                      <Text style={s.methodLabel}>{m.label}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>

            {/* Client (optional) */}
            <Text style={s.label}>Cliente (opcional)</Text>
            {selectedClient ? (
              <View style={[s.selectedClient, Shadow.sm]}>
                <Ionicons name="person-circle" size={22} color={Colors.purple} />
                <Text style={s.selectedClientName}>{selectedClient.name}</Text>
                <TouchableOpacity onPress={() => { setSelectedClient(null); setClientQ(""); }}>
                  <Ionicons name="close-circle" size={18} color={Colors.subtle} />
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <TextInput
                  style={s.input}
                  value={clientQ}
                  onChangeText={setClientQ}
                  placeholder="Buscar cliente..."
                  placeholderTextColor={Colors.subtle}
                />
                {clients.map(c => (
                  <TouchableOpacity key={c.id} style={[s.clientRow, Shadow.sm]} onPress={() => { setSelectedClient(c); setClientQ(""); setClients([]); }}>
                    <Ionicons name="person-outline" size={16} color={Colors.muted} />
                    <Text style={s.clientRowName}>{c.name}</Text>
                  </TouchableOpacity>
                ))}
              </>
            )}
          </ScrollView>

          <View style={s.bottomBar}>
            <TouchableOpacity
              style={[s.btn, !canSave && { opacity: 0.4 }]}
              onPress={handleSave}
              disabled={!canSave || saving}
              activeOpacity={0.85}
            >
              <View style={s.btnGrad}>
                {saving
                  ? <ActivityIndicator color="white" />
                  : <Text style={s.btnText}>
                      {total > 0 ? `Cobrar $${Math.round(total).toLocaleString("es-CO")}` : "Crear venta"}
                    </Text>
                }
              </View>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  header:        { paddingTop: 16, paddingHorizontal: 20, paddingBottom: 20 },
  headerRow:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  closeBtn:      { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,.2)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.3)" },
  headerTitle:   { fontSize: 18, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
  label:         { fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", color: Colors.muted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8, marginTop: 16 },
  input:         { ...Glass.cardStrong, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, fontFamily: "SpaceGrotesk_400Regular", color: Colors.text },
  amountWrap:    { flexDirection: "row", alignItems: "center" },
  currencySymbol:{ backgroundColor: "rgba(255,255,255,0.72)", borderWidth: 1, borderColor: "rgba(255,255,255,0.75)", borderTopLeftRadius: Radius.md, borderBottomLeftRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: Colors.muted, borderRightWidth: 0 },
  methodGrid:    { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  methodBtn:     { flex: 1, minWidth: "45%", borderRadius: Radius.md, ...Glass.card, overflow: "hidden" },
  methodBtnActive:{ borderColor: "transparent" },
  methodGrad:    { paddingVertical: 12, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: Colors.red },
  methodInner:   { paddingVertical: 12, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 8 },
  methodLabel:   { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted },
  methodLabelActive: { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: "white" },
  selectedClient:{ flexDirection: "row", alignItems: "center", gap: 10, ...Glass.cardStrong, borderRadius: Radius.md, padding: 12 },
  selectedClientName: { flex: 1, fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },
  clientRow:     { flexDirection: "row", alignItems: "center", gap: 10, ...Glass.card, borderRadius: Radius.md, padding: 12, marginTop: 6 },
  clientRowName: { fontSize: 14, fontFamily: "SpaceGrotesk_400Regular", color: Colors.text },
  bottomBar:     { padding: 20, paddingBottom: 34, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.6)", backgroundColor: "rgba(244,244,249,0.85)" },
  btn:           { borderRadius: Radius.full, overflow: "hidden" },
  btnGrad: { paddingVertical: 16, alignItems: "center", backgroundColor: Colors.red },
  btnText:       { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
});
