import { useEffect, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator, Modal, FlatList,
} from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { Colors, Radius, Shadow } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { ScreenHeader } from "@/components/ui";
import BottomSaveBar from "@/components/BottomSaveBar";
import FormField from "@/components/FormField";
import { ZONAS_DISPONIBLES, etiquetaZona, diaLocalDe } from "@/lib/tz";

export default function BusinessInfoScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const { tenantId } = useAuth();
  const { tenant: tenantCtx, patch: patchTenant, timezone: tzCtx, refresh: refreshTenant } = useTenant();
  const [name, setName]         = useState("");
  const [phone, setPhone]       = useState("");
  const [address, setAddress]   = useState("");
  const [timezone, setTimezone] = useState(tzCtx);
  const [tzOpen, setTzOpen]     = useState(false);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);

  useEffect(() => {
    if (!tenantCtx) return;
    setName(tenantCtx.name ?? "");
    setPhone(tenantCtx.phone ?? "");
    setAddress(tenantCtx.address ?? "");
    setLoading(false);
  }, [tenantCtx]);

  useEffect(() => { setTimezone(tzCtx); }, [tzCtx]);

  const canSave = name.trim().length >= 2;

  const handleSave = async () => {
    if (!canSave || !tenantId) return;
    setSaving(true);

    // La zona vive dentro de `settings`, que es un jsonb compartido con el
    // horario, el intervalo de turnos y demas. Hay que leerlo y fusionar: un
    // update directo del objeto borraria todo lo otro.
    const { data: actual } = await supabase
      .from("tenants").select("settings").eq("id", tenantId).single();
    const settings = { ...((actual?.settings as any) ?? {}), timezone };

    await supabase.from("tenants").update({
      name: name.trim(),
      phone: phone.trim() || null,
      address: address.trim() || null,
      settings,
    }).eq("id", tenantId);
    patchTenant({
      name: name.trim(),
      phone: phone.trim(),
      address: address.trim(),
    });
    await refreshTenant();
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader crumb="Negocio" title="Info del negocio" subtitle="Nombre, teléfono y dirección" onBack={() => router.back()} />

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={Colors.red} size="large" />
        </View>
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }}>
          <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 20, paddingBottom: 120 }}>
            <Animated.View entering={FadeInDown.duration(350)}>
              <FormField label="Nombre del negocio *" value={name} onChangeText={setName} placeholder="Ej: Salón Bella" />
              <FormField label="Teléfono / WhatsApp" value={phone} onChangeText={setPhone} placeholder="Ej: 3001234567" keyboardType="phone-pad" />
              <FormField label="Dirección" value={address} onChangeText={setAddress} placeholder="Ej: Cra 15 #45-20, Bogotá" />

              <Text style={[s.fieldLabel, { color: t.muted }]}>Zona horaria</Text>
              <TouchableOpacity
                style={[s.tzRow, { backgroundColor: t.bgAlt, borderColor: t.border }]}
                onPress={() => setTzOpen(true)} activeOpacity={0.75}>
                <View style={{ flex: 1 }}>
                  <Text style={[s.tzValue, { color: t.text }]}>{etiquetaZona(timezone)}</Text>
                  <Text style={[s.tzHint, { color: t.subtle }]}>
                    Hoy aquí es {diaLocalDe(new Date(), timezone)}
                  </Text>
                </View>
                <Ionicons name="chevron-down" size={16} color={t.subtle} />
              </TouchableOpacity>
              <Text style={[s.tzNote, { color: t.subtle }]}>
                Define cuándo empieza y termina el día para tus ingresos y reportes.
                Si la dejas mal, los cobros de la noche se cuentan al día siguiente.
              </Text>
            </Animated.View>

            {saved && (
              <Animated.View entering={FadeInDown.duration(300)} style={[s.savedBanner, Shadow.sm]}>
                <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
                <Text style={s.savedText}>Cambios guardados</Text>
              </Animated.View>
            )}
          </ScrollView>

          <BottomSaveBar label="Guardar cambios" saving={saving} disabled={!canSave} onPress={handleSave} />
        </KeyboardAvoidingView>
      )}

      <Modal visible={tzOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setTzOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
          <ScreenHeader crumb="Negocio" title="Zona horaria" subtitle="Dónde opera tu negocio" onBack={() => setTzOpen(false)} />
          <FlatList
            data={ZONAS_DISPONIBLES}
            keyExtractor={z => z.id}
            contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
            renderItem={({ item }) => {
              const activa = item.id === timezone;
              return (
                <TouchableOpacity
                  style={[s.tzOption, { backgroundColor: t.bgAlt, borderColor: activa ? Colors.red : t.border }]}
                  onPress={() => { setTimezone(item.id); setTzOpen(false); }}
                  activeOpacity={0.75}>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.tzValue, { color: t.text }]}>{item.label}</Text>
                    <Text style={[s.tzHint, { color: t.subtle }]}>
                      {diaLocalDe(new Date(), item.id)}
                      {item.dst ? " · usa horario de verano" : ""}
                    </Text>
                  </View>
                  {activa && <Ionicons name="checkmark-circle" size={20} color={Colors.red} />}
                </TouchableOpacity>
              );
            }}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  fieldLabel: { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", marginBottom: 8, marginTop: 4 },
  tzRow:      { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: Radius.md, padding: 14 },
  tzValue:    { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold" },
  tzHint:     { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", marginTop: 2 },
  tzNote:     { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", marginTop: 8, lineHeight: 16 },
  tzOption:   { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1.5, borderRadius: Radius.md, padding: 14, marginBottom: 10 },
  savedBanner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: Colors.success + "12", borderRadius: Radius.md, padding: 14, marginTop: 8 },
  savedText:   { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.success },
});
