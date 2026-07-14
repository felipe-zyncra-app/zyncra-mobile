import { useEffect, useState, useCallback } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform, ActivityIndicator,
  Share, Image, Pressable,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { Colors, Gradients, Radius, Shadow } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { Config } from "@/lib/config";
import GradientHeader from "@/components/GradientHeader";
import BottomSaveBar from "@/components/BottomSaveBar";
import FormField from "@/components/FormField";

const COLOR_PRESETS = [
  "#fb0f05","#ef4444","#f97316","#f59e0b",
  "#22c55e","#10b981","#0ea5e9","#0027fe",
  "#8b5cf6","#4f46e5","#ec4899","#111118",
];

// ── Color picker ──────────────────────────────────────────────────────────────
function ColorPicker({ label, value, onChange }: { label: string; value: string; onChange: (c: string) => void }) {
  const [hex, setHex] = useState(value);

  useEffect(() => { setHex(value); }, [value]);

  const applyHex = (raw: string) => {
    const clean = raw.startsWith("#") ? raw : `#${raw}`;
    setHex(clean);
    if (/^#[0-9a-fA-F]{6}$/.test(clean)) onChange(clean);
  };

  return (
    <View style={{ marginBottom: 22 }}>
      <Text style={cp.label}>{label}</Text>
      <View style={cp.swatches}>
        {COLOR_PRESETS.map(c => (
          <Pressable key={c} onPress={() => { onChange(c); setHex(c); }} style={[cp.swatch, { backgroundColor: c }, value === c && cp.swatchActive]} />
        ))}
      </View>
      <View style={cp.hexRow}>
        <View style={[cp.preview, { backgroundColor: value }]} />
        <TextInput
          style={cp.hexInput}
          value={hex}
          onChangeText={applyHex}
          placeholder="#000000"
          placeholderTextColor={Colors.subtle}
          autoCapitalize="none"
          maxLength={7}
        />
      </View>
    </View>
  );
}

const cp = StyleSheet.create({
  label:       { fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", color: Colors.muted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 },
  swatches:    { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  swatch:      { width: 30, height: 30, borderRadius: 8, borderWidth: 1.5, borderColor: "transparent" },
  swatchActive:{ borderColor: Colors.text, transform: [{ scale: 1.15 }] },
  hexRow:      { flexDirection: "row", alignItems: "center", gap: 10 },
  preview:     { width: 36, height: 36, borderRadius: 10, borderWidth: 1, borderColor: Colors.border },
  hexInput:    { flex: 1, backgroundColor: Colors.white, borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 11, fontSize: 14, fontFamily: "SpaceGrotesk_400Regular", color: Colors.text },
});

// ── Section card ──────────────────────────────────────────────────────────────
function Section({ title, icon, color, children }: { title: string; icon: string; color: string; children: React.ReactNode }) {
  return (
    <Animated.View entering={FadeInDown.duration(400)} style={[sc.card, Shadow.sm]}>
      <View style={sc.header}>
        <View style={[sc.iconBox, { backgroundColor: color + "15" }]}>
          <Ionicons name={icon as any} size={17} color={color} />
        </View>
        <Text style={sc.title}>{title}</Text>
      </View>
      <View style={sc.body}>{children}</View>
    </Animated.View>
  );
}

const sc = StyleSheet.create({
  card:    { backgroundColor: Colors.white, borderRadius: 18, marginBottom: 16, overflow: "hidden", borderWidth: 1, borderColor: Colors.border },
  header:  { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.border },
  iconBox: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  title:   { fontSize: 14, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text },
  body:    { padding: 18 },
});

// ── Main screen ───────────────────────────────────────────────────────────────
export default function StoreScreen() {
  const router = useRouter();
  const { tenantId } = useAuth();
  const { t } = useTheme();
  const { patch: patchTenant } = useTenant();

  const [slug,       setSlug]       = useState<string>("");
  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [saved,      setSaved]      = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  // Tenants fields
  const [bizName,  setBizName]  = useState("");
  const [phone,    setPhone]    = useState("");
  const [address,  setAddress]  = useState("");

  // Branding fields
  const [logoUrl,      setLogoUrl]      = useState<string | null>(null);
  const [logoUri,      setLogoUri]      = useState<string | null>(null);  // local pick
  const [welcome,      setWelcome]      = useState("Reserva tu cita fácil y rápido");
  const [primaryColor, setPrimaryColor] = useState(Colors.red);
  const [secondColor,  setSecondColor]  = useState(Colors.blue);

  const bookingLink = slug ? `${Config.urls.booking}${slug}` : "";

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);

    const { data: tenant } = await supabase
      .from("tenants")
      .select("name, phone, address, slug")
      .eq("id", tenantId)
      .single();

    if (tenant) {
      setSlug(tenant.slug ?? "");
      setBizName(tenant.name ?? "");
      setPhone(tenant.phone ?? "");
      setAddress(tenant.address ?? "");

      const { data: brand } = await supabase
        .from("branding")
        .select("logo_url, welcome_message, primary_color, secondary_color")
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (brand) {
        setLogoUrl(brand.logo_url ?? null);
        setWelcome(brand.welcome_message ?? "Reserva tu cita fácil y rápido");
        setPrimaryColor(brand.primary_color ?? Colors.red);
        setSecondColor(brand.secondary_color ?? Colors.blue);
      }
    }
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const pickLogo = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.8,
    });
    if (!result.canceled) setLogoUri(result.assets[0].uri);
  };

  const uploadLogo = async (): Promise<string | null> => {
    if (!logoUri || !tenantId) return logoUrl;
    const response = await fetch(logoUri);
    const blob = await response.blob();
    const path = `${tenantId}/logo.jpg`;
    const { error } = await supabase.storage.from("logos").upload(path, blob, { contentType: "image/jpeg", upsert: true });
    if (error) return logoUrl;
    const { data } = supabase.storage.from("logos").getPublicUrl(path);
    return `${data.publicUrl}?t=${Date.now()}`;
  };

  const handleSave = async () => {
    if (!tenantId) return;
    setSaving(true);

    // Update tenant info
    await supabase.from("tenants").update({
      name:    bizName.trim() || null,
      phone:   phone.trim()   || null,
      address: address.trim() || null,
    }).eq("id", tenantId);

    // Upload logo if picked
    const finalLogoUrl = await uploadLogo();
    if (logoUri) { setLogoUrl(finalLogoUrl); setLogoUri(null); }

    // Upsert branding
    await supabase.from("branding").upsert({
      tenant_id:       tenantId,
      business_name:   bizName.trim(),
      logo_url:        finalLogoUrl,
      welcome_message: welcome.trim(),
      primary_color:   primaryColor,
      secondary_color: secondColor,
    }, { onConflict: "tenant_id" });

    patchTenant({
      name:    bizName.trim(),
      phone:   phone.trim(),
      address: address.trim(),
      slug:    slug.trim(),
    });

    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleShare = () => {
    if (!bookingLink) return;
    Share.share({ message: bookingLink, url: bookingLink });
  };

  const handleCopyLink = async () => {
    if (!bookingLink) return;
    // Share sheet with copy option — no external clipboard package needed
    await Share.share({ message: bookingLink });
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const logoDisplay = logoUri ?? (logoUrl ? `${logoUrl}` : null);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <GradientHeader title="Mi Tienda" subtitle="Personaliza y comparte tu negocio" onBack={() => router.back()} />

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={Colors.red} size="large" />
        </View>
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

            {/* ── Booking link card ──────────────────────────────────── */}
            <Animated.View entering={FadeInDown.delay(60).duration(400)} style={[s.linkCard, Shadow.md]}>
              <LinearGradient
                colors={["#07071a", "#130d2e"]}
                style={StyleSheet.absoluteFill}
              />
              {/* glow blob */}
              <View style={s.linkGlow} />

              <View style={s.linkTop}>
                <View style={s.linkIconBox}>
                  <Ionicons name="link-outline" size={18} color={Colors.red} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.linkTitle}>Link de reservas para clientes</Text>
                  <Text style={s.linkSub}>Comparte este link para que tus clientes agenden</Text>
                </View>
              </View>

              <View style={s.linkUrlBox}>
                <Text style={s.linkUrl} numberOfLines={1} ellipsizeMode="middle">
                  {bookingLink || "Configurando tu tienda…"}
                </Text>
              </View>

              <View style={s.linkActions}>
                <TouchableOpacity style={s.linkBtn} onPress={handleCopyLink} activeOpacity={0.8}>
                  <Ionicons name="copy-outline" size={15} color="rgba(255,255,255,0.8)" />
                  <Text style={s.linkBtnText}>Copiar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.linkBtnPrimary} onPress={handleShare} activeOpacity={0.8}>
                  <View style={s.linkBtnGrad}>
                    <Ionicons name="share-social-outline" size={15} color="white" />
                    <Text style={s.linkBtnPrimaryText}>Compartir</Text>
                  </View>
                </TouchableOpacity>
              </View>
            </Animated.View>

            {/* ── Información del negocio ────────────────────────────── */}
            <Section title="Información del negocio" icon="storefront-outline" color={Colors.red}>
              <FormField label="Nombre del negocio" value={bizName} onChangeText={setBizName} placeholder="Ej: Salón Bella" />
              <FormField label="Teléfono / WhatsApp" value={phone}   onChangeText={setPhone}   placeholder="Ej: 3001234567" keyboardType="phone-pad" />
              <FormField label="Dirección"           value={address} onChangeText={setAddress} placeholder="Ej: Cra 15 #45-20, Bogotá" />
            </Section>

            {/* ── Personalización visual ─────────────────────────────── */}
            <Section title="Personalización visual" icon="color-palette-outline" color={Colors.purple}>

              {/* Logo */}
              <View style={s.logoRow}>
                <Pressable onPress={pickLogo} style={s.logoPicker}>
                  {logoDisplay ? (
                    <Image source={{ uri: logoDisplay }} style={s.logoImg} />
                  ) : (
                    <View style={s.logoPlaceholder}>
                      <Ionicons name="image-outline" size={28} color={Colors.subtle} />
                    </View>
                  )}
                  <View style={s.logoBadge}>
                    <Ionicons name="camera" size={12} color="white" />
                  </View>
                </Pressable>
                <View style={{ flex: 1 }}>
                  <Text style={s.logoHint}>Logo del negocio</Text>
                  <Text style={s.logoHintSub}>Se muestra en tu página de reservas pública. Toca para cambiar.</Text>
                </View>
              </View>

              <View style={{ height: 1, backgroundColor: Colors.border, marginBottom: 18 }} />

              <FormField
                label="Mensaje de bienvenida"
                value={welcome}
                onChangeText={setWelcome}
                placeholder="Reserva tu cita fácil y rápido"
              />

              <View style={{ height: 1, backgroundColor: Colors.border, marginBottom: 18 }} />

              <ColorPicker label="Color primario"    value={primaryColor} onChange={setPrimaryColor} />
              <ColorPicker label="Color secundario"  value={secondColor}  onChange={setSecondColor}  />

              {/* Live preview strip */}
              <View style={s.previewStrip}>
                <Text style={s.previewLabel}>Vista previa del botón</Text>
                <View style={{ borderRadius: 10, overflow: "hidden", alignSelf: "flex-start" }}>
                  <LinearGradient
                    colors={[primaryColor, secondColor]}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                    style={s.previewBtn}>
                    <Text style={s.previewBtnText}>Reservar cita →</Text>
                  </LinearGradient>
                </View>
              </View>

            </Section>

            {saved && (
              <Animated.View entering={FadeInDown.duration(300)} style={[s.savedBanner, Shadow.sm]}>
                <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
                <Text style={s.savedText}>Cambios guardados correctamente</Text>
              </Animated.View>
            )}

            <View style={{ height: 120 }} />
          </ScrollView>

          <BottomSaveBar label="Guardar cambios" saving={saving} onPress={handleSave} />
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 16, paddingTop: 20 },

  // Link card
  linkCard:     { borderRadius: 20, overflow: "hidden", marginBottom: 16, padding: 20, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  linkGlow:     { position: "absolute", top: -60, right: -60, width: 200, height: 200, borderRadius: 100, backgroundColor: "rgba(251,15,5,0.12)" },
  linkTop:      { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 14 },
  linkIconBox:  { width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(251,15,5,0.15)", alignItems: "center", justifyContent: "center" },
  linkTitle:    { fontSize: 13, fontFamily: "SpaceGrotesk_700Bold", color: "white", marginBottom: 3 },
  linkSub:      { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", color: "rgba(255,255,255,0.45)", lineHeight: 15 },
  linkUrlBox:   { backgroundColor: "rgba(255,255,255,0.07)", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, marginBottom: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)" },
  linkUrl:      { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.red, letterSpacing: 0.2 },
  linkActions:  { flexDirection: "row", gap: 10 },
  linkBtn:      { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 11, borderRadius: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", backgroundColor: "rgba(255,255,255,0.07)" },
  linkBtnText:  { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: "rgba(255,255,255,0.8)" },
  linkBtnPrimary: { flex: 1, borderRadius: 10, overflow: "hidden" },
  linkBtnGrad:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 11, backgroundColor: Colors.red, borderRadius: 10 },
  linkBtnPrimaryText: { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: "white" },

  // Logo
  logoRow:         { flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 20 },
  logoPicker:      { position: "relative" },
  logoImg:         { width: 72, height: 72, borderRadius: 18 },
  logoPlaceholder: { width: 72, height: 72, borderRadius: 18, backgroundColor: Colors.cream2, borderWidth: 1.5, borderColor: Colors.border, alignItems: "center", justifyContent: "center", borderStyle: "dashed" },
  logoBadge:       { position: "absolute", bottom: -4, right: -4, width: 22, height: 22, borderRadius: 11, backgroundColor: Colors.red, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: Colors.white },
  logoHint:        { fontSize: 13, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text, marginBottom: 4 },
  logoHintSub:     { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: Colors.muted, lineHeight: 17 },

  // Preview
  previewStrip:    { backgroundColor: Colors.cream2, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: Colors.border },
  previewLabel:    { fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 },
  previewBtn:      { paddingVertical: 10, paddingHorizontal: 20 },
  previewBtnText:  { fontSize: 13, fontFamily: "SpaceGrotesk_700Bold", color: "white" },

  // Saved
  savedBanner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: Colors.success + "12", borderRadius: Radius.md, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: Colors.success + "30" },
  savedText:   { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.success },

});
