import { useEffect, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator,
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
import GradientHeader from "@/components/GradientHeader";
import BottomSaveBar from "@/components/BottomSaveBar";
import FormField from "@/components/FormField";

export default function BusinessInfoScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const { tenantId } = useAuth();
  const { tenant: tenantCtx, patch: patchTenant } = useTenant();
  const [name, setName]         = useState("");
  const [phone, setPhone]       = useState("");
  const [address, setAddress]   = useState("");
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

  const canSave = name.trim().length >= 2;

  const handleSave = async () => {
    if (!canSave || !tenantId) return;
    setSaving(true);
    await supabase.from("tenants").update({
      name: name.trim(),
      phone: phone.trim() || null,
      address: address.trim() || null,
    }).eq("id", tenantId);
    patchTenant({
      name: name.trim(),
      phone: phone.trim(),
      address: address.trim(),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <GradientHeader title="Info del negocio" subtitle="Nombre, teléfono y dirección" onBack={() => router.back()} />

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={Colors.red} size="large" />
        </View>
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 120 }}>
            <Animated.View entering={FadeInDown.duration(350)}>
              <FormField label="Nombre del negocio *" value={name} onChangeText={setName} placeholder="Ej: Salón Bella" />
              <FormField label="Teléfono / WhatsApp" value={phone} onChangeText={setPhone} placeholder="Ej: 3001234567" keyboardType="phone-pad" />
              <FormField label="Dirección" value={address} onChangeText={setAddress} placeholder="Ej: Cra 15 #45-20, Bogotá" />
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
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  savedBanner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: Colors.success + "12", borderRadius: Radius.md, padding: 14, marginTop: 8 },
  savedText:   { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.success },
});
