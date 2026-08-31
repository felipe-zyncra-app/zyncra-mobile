import { useState, useCallback, useEffect } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, Pressable, Share,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Fonts, Gradients, MonoLabel, Radius, Shadow } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";

const SWATCHES_PRIMARY   = ["#fb0f05", "#e11d48", "#7c3aed", "#2563eb", "#059669", "#d97706", "#14111C"];
const SWATCHES_SECONDARY = ["#0027fe", "#06b6d4", "#8b5cf6", "#f59e0b", "#10b981", "#ef4444", "#6366f1"];

const BOOKING_BASE = "zyncra.app/book/";

interface Config {
  businessName:   string;
  welcome:        string;
  slug:           string;
  primaryColor:   string;
  secondaryColor: string;
}

const DEFAULT: Config = {
  businessName:   "Mi Negocio",
  welcome:        "Reserva tu cita fácil y rápido",
  slug:           "mi-negocio",
  primaryColor:   "#fb0f05",
  secondaryColor: "#0027fe",
};

// ── ColorPicker row ───────────────────────────────────────────────────────────

function ColorPicker({
  label, value, swatches, onChange,
}: {
  label: string; value: string; swatches: string[]; onChange: (c: string) => void;
}) {
  return (
    <View style={{ marginBottom: 18 }}>
      <Text style={s.fieldLabel}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <View style={[s.colorPreview, { backgroundColor: value }]} />
        <TextInput
          value={value}
          onChangeText={onChange}
          style={[s.input, { flex: 1, fontFamily: Fonts.mono, fontSize: 13 }]}
          autoCapitalize="none"
          autoCorrect={false}
          placeholderTextColor={Colors.subtle}
        />
      </View>
      <View style={s.swatchRow}>
        {swatches.map(c => (
          <Pressable key={c} onPress={() => onChange(c)} style={[s.swatch, { backgroundColor: c }, value === c && s.swatchActive]}>
            {value === c && <Ionicons name="checkmark" size={12} color="white" />}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// ── Live preview (mini booking page mockup) ───────────────────────────────────

function LivePreview({ config }: { config: Config }) {
  const grad = `${config.primaryColor} → ${config.secondaryColor}`;

  return (
    <View style={s.previewWrapper}>
      <Text style={s.previewLabel}>VISTA PREVIA</Text>

      {/* Phone frame */}
      <View style={s.phoneFrame}>
        {/* Status bar */}
        <View style={[s.phoneBrowser, { backgroundColor: "#F0EEE9" }]}>
          <View style={s.phoneDots}>
            {["#ff5f57", "#ffbd2e", "#28c840"].map(c => (
              <View key={c} style={[s.phoneDot, { backgroundColor: c }]} />
            ))}
          </View>
          <View style={s.phoneUrl}>
            <Text style={s.phoneUrlText} numberOfLines={1}>{BOOKING_BASE}{config.slug}</Text>
          </View>
        </View>

        {/* Page content */}
        <View style={s.phonePage}>
          {/* Business header */}
          <View style={s.previewHeader}>
            <LinearGradient
              colors={[config.primaryColor, config.secondaryColor]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={s.previewAvatar}
            >
              <Text style={s.previewAvatarText}>{config.businessName.charAt(0)}</Text>
            </LinearGradient>
            <Text style={s.previewBizName}>{config.businessName}</Text>
            <Text style={s.previewWelcome}>{config.welcome}</Text>
          </View>

          {/* Steps */}
          <View style={s.previewSteps}>
            {["Servicio", "Fecha", "Datos"].map((step, i) => (
              <View key={i} style={{ alignItems: "center", flex: 1 }}>
                <View style={[
                  s.previewStep,
                  i === 0 && { backgroundColor: config.primaryColor },
                ]}>
                  <Text style={[s.previewStepNum, i === 0 && { color: "white" }]}>{i + 1}</Text>
                </View>
                <Text style={[s.previewStepLabel, i === 0 && { color: "#14111C" }]}>{step}</Text>
              </View>
            ))}
          </View>

          {/* Service cards */}
          <View style={s.previewServices}>
            {[
              { name: "Servicio ejemplo", price: "$50", sel: false },
              { name: "Servicio destacado", price: "$80", sel: true },
            ].map((svc, i) => (
              <View key={i} style={[
                s.previewSvcRow,
                svc.sel && { borderColor: config.primaryColor, backgroundColor: config.primaryColor + "12" },
              ]}>
                <View style={[s.previewSvcIcon, { backgroundColor: config.primaryColor + "18" }]}>
                  <Ionicons name="sparkles-outline" size={11} color={config.primaryColor} />
                </View>
                <Text style={s.previewSvcName}>{svc.name}</Text>
                <Text style={[s.previewSvcPrice, { color: config.primaryColor }]}>{svc.price}</Text>
              </View>
            ))}
          </View>

          {/* CTA */}
          <LinearGradient
            colors={[config.primaryColor, config.secondaryColor]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={s.previewCta}
          >
            <Text style={s.previewCtaText}>Continuar →</Text>
          </LinearGradient>
        </View>
      </View>

      <Text style={s.previewHint}>Los cambios se aplican al guardar</Text>
    </View>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function BrandingScreen() {
  const router  = useRouter();
  const { tenantId } = useAuth();
  const { tenant, update: updateTenant } = useTenant();
  const [config, setConfig] = useState<Config>({ ...DEFAULT });
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!tenant) return;
    setConfig(prev => ({
      ...prev,
      businessName: tenant.name,
      slug:         tenant.slug || DEFAULT.slug,
    }));
  }, [tenant]);

  useEffect(() => {
    if (!tenantId) return;
    supabase.from("branding")
      .select("welcome_message, primary_color, secondary_color")
      .eq("tenant_id", tenantId)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        setConfig(prev => ({
          ...prev,
          welcome:        data.welcome_message || DEFAULT.welcome,
          primaryColor:   data.primary_color || DEFAULT.primaryColor,
          secondaryColor: data.secondary_color || DEFAULT.secondaryColor,
        }));
      });
  }, [tenantId]);

  const bookingLink = `https://${BOOKING_BASE}${config.slug}`;

  const handleCopy = useCallback(async () => {
    try {
      await Share.share({ message: bookingLink, url: bookingLink });
    } catch {}
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [bookingLink]);

  const handleSave = async () => {
    if (saving || !tenantId) return;
    setSaving(true);

    const [tenantOk, brandRes] = await Promise.all([
      updateTenant({
        name: config.businessName.trim(),
        slug:  config.slug,
      }),
      supabase.from("branding").upsert({
        tenant_id:       tenantId,
        business_name:   config.businessName.trim(),
        welcome_message: config.welcome,
        primary_color:   config.primaryColor,
        secondary_color: config.secondaryColor,
      }, { onConflict: "tenant_id" }),
    ]);

    setSaving(false);
    if (tenantOk && !brandRes.error) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } else {
      Alert.alert("Error", "No se pudieron guardar los cambios");
    }
  };

  const set = (key: keyof Config) => (val: string) =>
    setConfig(prev => ({ ...prev, [key]: val }));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.cream2 }} edges={["top"]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={Colors.white} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.headerCrumb}>MARCA Y DISEÑO</Text>
          <Text style={s.headerTitle}>Mi Marca</Text>
        </View>
        <LinearGradient
          colors={Gradients.brand}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          style={s.headerAccent}
        />
      </View>

      <ScrollView automaticallyAdjustKeyboardInsets
        contentContainerStyle={s.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Booking link card */}
        <View style={[s.card, s.linkCard]}>
          <View style={[s.linkIcon, { backgroundColor: Colors.red + "12" }]}>
            <Ionicons name="storefront-outline" size={18} color={Colors.red} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.linkCardTitle}>Link de reservas</Text>
            <Text style={s.linkCardUrl} numberOfLines={1}>{bookingLink}</Text>
          </View>
          <TouchableOpacity
            style={[s.copyBtn, copied && s.copyBtnDone]}
            onPress={handleCopy}
            activeOpacity={0.7}
          >
            <Ionicons name={copied ? "checkmark" : "copy-outline"} size={16} color={copied ? "#10b981" : Colors.dim} />
            <Text style={[s.copyBtnText, copied && { color: "#10b981" }]}>
              {copied ? "Copiado" : "Copiar"}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Identity form */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>IDENTIDAD VISUAL</Text>
          <View style={[s.card]}>
            {/* Business name */}
            <View style={{ marginBottom: 16 }}>
              <Text style={s.fieldLabel}>Nombre del negocio</Text>
              <TextInput
                value={config.businessName}
                onChangeText={set("businessName")}
                style={s.input}
                placeholder="Ej. Spa & Bienestar Nova"
                placeholderTextColor={Colors.subtle}
              />
            </View>

            {/* Slug */}
            <View style={{ marginBottom: 16 }}>
              <Text style={s.fieldLabel}>URL del negocio</Text>
              <View style={s.slugRow}>
                <Text style={s.slugPrefix}>zyncra.app/book/</Text>
                <TextInput
                  value={config.slug}
                  onChangeText={val => set("slug")(val.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""))}
                  style={[s.input, s.slugInput]}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholderTextColor={Colors.subtle}
                  placeholder="mi-negocio"
                />
              </View>
            </View>

            {/* Welcome */}
            <View>
              <Text style={s.fieldLabel}>Mensaje de bienvenida</Text>
              <TextInput
                value={config.welcome}
                onChangeText={set("welcome")}
                style={s.input}
                placeholder="Ej. Reserva tu cita en 60 segundos"
                placeholderTextColor={Colors.subtle}
              />
            </View>
          </View>
        </View>

        {/* Colors */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>COLORES DE MARCA</Text>
          <View style={[s.card]}>
            <ColorPicker
              label="Color primario"
              value={config.primaryColor}
              swatches={SWATCHES_PRIMARY}
              onChange={set("primaryColor")}
            />
            <ColorPicker
              label="Color secundario"
              value={config.secondaryColor}
              swatches={SWATCHES_SECONDARY}
              onChange={set("secondaryColor")}
            />
            {/* Gradient preview */}
            <View>
              <Text style={s.fieldLabel}>Vista de gradiente</Text>
              <LinearGradient
                colors={[config.primaryColor, config.secondaryColor]}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={s.gradPreview}
              />
            </View>
          </View>
        </View>

        {/* Live preview */}
        <LivePreview config={config} />

        {/* Save */}
        {saved && (
          <View style={s.savedBanner}>
            <Ionicons name="checkmark-circle" size={16} color="#10b981" />
            <Text style={s.savedText}>Cambios guardados correctamente</Text>
          </View>
        )}

        <TouchableOpacity onPress={handleSave} activeOpacity={0.85}>
          <LinearGradient
            colors={Gradients.brand}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={s.saveBtn}
          >
            <Ionicons name={saving ? "hourglass-outline" : "save-outline"} size={18} color="white" />
            <Text style={s.saveBtnText}>{saving ? "Guardando…" : "Guardar configuración"}</Text>
          </LinearGradient>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  header: {
    backgroundColor: Colors.ink,
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16,
    flexDirection: "row", alignItems: "center", gap: 12, overflow: "hidden",
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.10)",
    alignItems: "center", justifyContent: "center",
  },
  headerCrumb: { ...MonoLabel, fontSize: 9, color: "rgba(255,255,255,0.45)" },
  headerTitle: { fontSize: 22, fontFamily: Fonts.bold, color: Colors.white, letterSpacing: -0.5, marginTop: 2 },
  headerAccent: { position: "absolute", bottom: 0, left: 0, right: 0, height: 3 },

  scroll: { padding: 16, paddingBottom: 110 },

  card: {
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.border,
    padding: 16, ...Shadow.sm,
  },
  linkCard: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 20 },
  linkIcon: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  linkCardTitle: { fontSize: 13, fontFamily: Fonts.bold, color: Colors.text },
  linkCardUrl: { fontSize: 11, fontFamily: Fonts.mono, color: Colors.red, marginTop: 2 },
  copyBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
    borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  copyBtnDone: { borderColor: "#10b981", backgroundColor: "rgba(16,185,129,0.06)" },
  copyBtnText: { fontSize: 12, fontFamily: Fonts.semibold, color: Colors.dim },

  section: { marginBottom: 20 },
  sectionTitle: { ...MonoLabel, marginBottom: 8 },

  fieldLabel: {
    fontSize: 10.5, fontFamily: Fonts.mono,
    color: Colors.subtle, textTransform: "uppercase",
    letterSpacing: 0.8, marginBottom: 7,
  },
  input: {
    backgroundColor: "rgba(20,15,30,0.025)",
    borderWidth: 1.5, borderColor: Colors.border,
    borderRadius: 10, paddingHorizontal: 13, paddingVertical: 11,
    fontSize: 14, fontFamily: Fonts.regular, color: Colors.text,
  },
  slugRow: { flexDirection: "row", alignItems: "center", gap: 0 },
  slugPrefix: {
    fontSize: 13, fontFamily: Fonts.mono, color: Colors.subtle,
    backgroundColor: "rgba(20,15,30,0.04)",
    paddingHorizontal: 10, paddingVertical: 11,
    borderWidth: 1.5, borderColor: Colors.border,
    borderRightWidth: 0, borderTopLeftRadius: 10, borderBottomLeftRadius: 10,
  },
  slugInput: {
    flex: 1, borderTopLeftRadius: 0, borderBottomLeftRadius: 0,
    fontFamily: Fonts.mono, fontSize: 13,
  },

  colorPreview: { width: 42, height: 42, borderRadius: 10, borderWidth: 1.5, borderColor: Colors.border },
  swatchRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  swatch: {
    width: 30, height: 30, borderRadius: 8,
    alignItems: "center", justifyContent: "center",
  },
  swatchActive: { borderWidth: 2.5, borderColor: "white" },
  gradPreview: { height: 12, borderRadius: 6, marginTop: 8 },

  // Preview
  previewWrapper: { marginBottom: 20 },
  previewLabel: { ...MonoLabel, marginBottom: 10 },
  phoneFrame: {
    borderRadius: Radius.lg, overflow: "hidden",
    borderWidth: 1, borderColor: Colors.border,
    ...Shadow.md,
  },
  phoneBrowser: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 12, paddingVertical: 8,
    borderBottomWidth: 1, borderColor: Colors.border,
  },
  phoneDots: { flexDirection: "row", gap: 4 },
  phoneDot: { width: 8, height: 8, borderRadius: 4 },
  phoneUrl: {
    flex: 1, backgroundColor: Colors.white,
    borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: Colors.border,
  },
  phoneUrlText: { fontSize: 10, fontFamily: Fonts.mono, color: Colors.subtle },
  phonePage: { backgroundColor: "rgba(20,15,30,0.025)", padding: 14 },
  previewHeader: { alignItems: "center", marginBottom: 14 },
  previewAvatar: {
    width: 52, height: 52, borderRadius: 26,
    alignItems: "center", justifyContent: "center", marginBottom: 8,
  },
  previewAvatarText: { fontSize: 20, fontFamily: Fonts.bold, color: "white" },
  previewBizName: { fontSize: 14, fontFamily: Fonts.bold, color: Colors.text, marginBottom: 2 },
  previewWelcome: { fontSize: 11, fontFamily: Fonts.regular, color: Colors.dim, textAlign: "center" },
  previewSteps: { flexDirection: "row", marginBottom: 14 },
  previewStep: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: Colors.white, borderWidth: 1.5, borderColor: Colors.border,
    alignItems: "center", justifyContent: "center",
  },
  previewStepNum: { fontSize: 9, fontFamily: Fonts.bold, color: Colors.subtle },
  previewStepLabel: { fontSize: 8.5, fontFamily: Fonts.semibold, color: Colors.subtle, marginTop: 3 },
  previewServices: { gap: 6, marginBottom: 12 },
  previewSvcRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    padding: 9, borderRadius: 10,
    borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  previewSvcIcon: { width: 28, height: 28, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  previewSvcName: { flex: 1, fontSize: 11, fontFamily: Fonts.semibold, color: Colors.text },
  previewSvcPrice: { fontSize: 12, fontFamily: Fonts.bold },
  previewCta: { borderRadius: 8, paddingVertical: 9, alignItems: "center" },
  previewCtaText: { fontSize: 12, fontFamily: Fonts.bold, color: "white" },
  previewHint: { fontSize: 11, fontFamily: Fonts.regular, color: Colors.subtle, textAlign: "center", marginTop: 8 },

  savedBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(16,185,129,0.08)",
    borderWidth: 1, borderColor: "rgba(16,185,129,0.2)",
    borderRadius: 10, padding: 12, marginBottom: 12,
  },
  savedText: { fontSize: 13, fontFamily: Fonts.semibold, color: "#059669" },

  saveBtn: {
    borderRadius: Radius.lg, flexDirection: "row", alignItems: "center",
    justifyContent: "center", gap: 8, paddingVertical: 15,
  },
  saveBtnText: { fontSize: 15, fontFamily: Fonts.bold, color: "white" },
});
