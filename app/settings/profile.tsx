import { useEffect, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { Colors, Gradients, Radius, Shadow } from "@/constants/theme";
import { useTheme } from "@/lib/theme";

function getInitials(name: string, email: string) {
  const n = name.trim();
  if (n) {
    const parts = n.split(" ").filter(Boolean);
    return parts.length >= 2
      ? (parts[0][0] + parts[1][0]).toUpperCase()
      : parts[0].slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

function FieldBlock({
  label, value, onChangeText, placeholder, secureTextEntry, keyboardType, autoCapitalize, editable = true,
}: {
  label: string; value: string; onChangeText?: (t: string) => void;
  placeholder?: string; secureTextEntry?: boolean;
  keyboardType?: "default" | "email-address";
  autoCapitalize?: "none" | "words";
  editable?: boolean;
}) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        style={[s.fieldInput, !editable && s.fieldInputDisabled]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={Colors.subtle}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType ?? "default"}
        autoCapitalize={autoCapitalize ?? "sentences"}
        editable={editable}
      />
    </View>
  );
}

export default function ProfileScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const { user } = useAuth();
  const [email, setEmail]         = useState("");
  const [displayName, setDisplayName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [savedOk, setSavedOk]     = useState(false);
  const [showPass, setShowPass]   = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    if (!user) return;
    setEmail(user.email ?? "");
    const meta = user.user_metadata as { full_name?: string } | null;
    setDisplayName(meta?.full_name ?? "");
    setLoading(false);
  }, [user]);

  const handleSave = async () => {
    if (newPassword && newPassword !== confirmPass) {
      Alert.alert("Error", "Las contraseñas no coinciden.");
      return;
    }
    if (newPassword && newPassword.length < 6) {
      Alert.alert("Error", "La contraseña debe tener mínimo 6 caracteres.");
      return;
    }
    setSaving(true);

    const updates: { data?: { full_name: string }; password?: string } = {};
    if (displayName.trim()) updates.data = { full_name: displayName.trim() };
    if (newPassword)         updates.password = newPassword;

    const { error } = await supabase.auth.updateUser(updates);
    setSaving(false);

    if (error) {
      Alert.alert("Error", error.message);
      return;
    }

    setNewPassword("");
    setConfirmPass("");
    setSavedOk(true);
    setTimeout(() => setSavedOk(false), 2000);
  };

  const passStrength = (() => {
    if (!newPassword) return null;
    let score = 0;
    if (newPassword.length >= 6) score++;
    if (/[A-Z]/.test(newPassword)) score++;
    if (/\d/.test(newPassword)) score++;
    if (score <= 1) return { label: "Débil", color: Colors.red };
    if (score === 2) return { label: "Media", color: "#f59e0b" };
    return { label: "Fuerte", color: Colors.success };
  })();

  const initials = getInitials(displayName, email);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      {/* Header */}
      <LinearGradient colors={Gradients.ink} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.header}>
        <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, zIndex: 1 }} />
        <View style={s.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="arrow-back" size={20} color="white" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.headerTitle}>Mi perfil</Text>
            <Text style={s.headerSub}>Datos personales y seguridad</Text>
          </View>
        </View>

        {/* Avatar */}
        <View style={s.avatarWrap}>
          <View style={s.avatar}>
            <Text style={s.avatarText}>{initials}</Text>
          </View>
          <Text style={s.avatarEmail}>{email}</Text>
        </View>
      </LinearGradient>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={Colors.red} size="large" />
        </View>
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }}>
          <ScrollView automaticallyAdjustKeyboardInsets
            contentContainerStyle={{ padding: 20, paddingBottom: 120 }}
            keyboardShouldPersistTaps="handled"
          >
            {/* Personal info */}
            <Animated.View entering={FadeInDown.delay(0).duration(340)}>
              <Text style={s.sectionLabel}>Información personal</Text>
              <View style={[s.card, Shadow.sm]}>
                <View style={s.cardTitleRow}>
                  <View style={[s.cardIcon, { backgroundColor: Colors.purple + "15" }]}>
                    <Ionicons name="person-outline" size={16} color={Colors.purple} />
                  </View>
                  <Text style={s.cardTitle}>Datos de la cuenta</Text>
                </View>

                <FieldBlock
                  label="Nombre completo"
                  value={displayName}
                  onChangeText={setDisplayName}
                  placeholder="Tu nombre"
                  autoCapitalize="words"
                />
                <FieldBlock
                  label="Correo electrónico"
                  value={email}
                  placeholder="—"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  editable={false}
                />
                <View style={s.infoNote}>
                  <Ionicons name="information-circle-outline" size={14} color={Colors.subtle} />
                  <Text style={s.infoNoteText}>
                    Para cambiar el correo, contacta soporte.
                  </Text>
                </View>
              </View>
            </Animated.View>

            {/* Security */}
            <Animated.View entering={FadeInDown.delay(60).duration(340)}>
              <Text style={[s.sectionLabel, { marginTop: 24 }]}>Seguridad</Text>
              <View style={[s.card, Shadow.sm]}>
                <View style={s.cardTitleRow}>
                  <View style={[s.cardIcon, { backgroundColor: "#f59e0b18" }]}>
                    <Ionicons name="lock-closed-outline" size={16} color="#f59e0b" />
                  </View>
                  <Text style={s.cardTitle}>Cambiar contraseña</Text>
                </View>
                <Text style={s.passHint}>Deja en blanco si no deseas cambiarla</Text>

                {/* New password */}
                <View style={s.field}>
                  <Text style={s.fieldLabel}>Nueva contraseña</Text>
                  <View style={s.passRow}>
                    <TextInput
                      style={[s.fieldInput, { flex: 1, marginBottom: 0 }]}
                      value={newPassword}
                      onChangeText={setNewPassword}
                      placeholder="Mín. 6 caracteres"
                      placeholderTextColor={Colors.subtle}
                      secureTextEntry={!showPass}
                      autoCapitalize="none"
                    />
                    <TouchableOpacity style={s.eyeBtn} onPress={() => setShowPass(p => !p)}>
                      <Ionicons name={showPass ? "eye-off-outline" : "eye-outline"} size={18} color={Colors.subtle} />
                    </TouchableOpacity>
                  </View>
                  {/* Strength bar */}
                  {passStrength && (
                    <View style={s.strengthRow}>
                      {[1, 2, 3].map(i => {
                        const score = passStrength.label === "Débil" ? 1 : passStrength.label === "Media" ? 2 : 3;
                        return (
                          <View key={i} style={[s.strengthBar, { backgroundColor: i <= score ? passStrength.color : Colors.border }]} />
                        );
                      })}
                      <Text style={[s.strengthLabel, { color: passStrength.color }]}>{passStrength.label}</Text>
                    </View>
                  )}
                </View>

                {/* Confirm */}
                <View style={s.field}>
                  <Text style={s.fieldLabel}>Confirmar contraseña</Text>
                  <View style={s.passRow}>
                    <TextInput
                      style={[s.fieldInput, { flex: 1, marginBottom: 0 }, confirmPass && confirmPass !== newPassword && s.fieldInputError]}
                      value={confirmPass}
                      onChangeText={setConfirmPass}
                      placeholder="Repite la contraseña"
                      placeholderTextColor={Colors.subtle}
                      secureTextEntry={!showConfirm}
                      autoCapitalize="none"
                    />
                    <TouchableOpacity style={s.eyeBtn} onPress={() => setShowConfirm(p => !p)}>
                      <Ionicons name={showConfirm ? "eye-off-outline" : "eye-outline"} size={18} color={Colors.subtle} />
                    </TouchableOpacity>
                  </View>
                  {confirmPass.length > 0 && confirmPass !== newPassword && (
                    <Text style={s.mismatchText}>Las contraseñas no coinciden</Text>
                  )}
                </View>
              </View>
            </Animated.View>
          </ScrollView>

          {/* Bottom bar */}
          <View style={s.bottomBar}>
            <TouchableOpacity
              style={s.btn}
              onPress={handleSave}
              disabled={saving}
              activeOpacity={0.85}
            >
              <View style={[s.btnGrad, { backgroundColor: savedOk ? Colors.success : Colors.red }]}>
                {saving ? (
                  <ActivityIndicator color="white" />
                ) : savedOk ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Ionicons name="checkmark-circle" size={18} color="white" />
                    <Text style={s.btnText}>Guardado</Text>
                  </View>
                ) : (
                  <Text style={s.btnText}>Guardar cambios</Text>
                )}
              </View>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header:         { paddingTop: 16, paddingHorizontal: 24, paddingBottom: 28 },
  headerRow:      { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 24 },
  backBtn:        { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,.10)", alignItems: "center", justifyContent: "center" },
  headerTitle:    { fontSize: 22, fontFamily: "SpaceGrotesk_700Bold", color: "white", letterSpacing: -0.4 },
  headerSub:      { fontSize: 12, color: "rgba(255,255,255,.75)", fontFamily: "SpaceGrotesk_400Regular", marginTop: 2 },

  avatarWrap:     { alignItems: "center" },
  avatar:         { width: 72, height: 72, borderRadius: 36, backgroundColor: "rgba(255,255,255,.25)", alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: "rgba(255,255,255,.5)", marginBottom: 10 },
  avatarText:     { fontSize: 26, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
  avatarEmail:    { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: "rgba(255,255,255,.85)" },

  sectionLabel:   { fontSize: 11, fontFamily: "JetBrainsMono_500Medium", color: Colors.subtle, textTransform: "uppercase", letterSpacing: 0.9, marginBottom: 10 },

  card:           { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.lg, padding: 16 },
  cardTitleRow:   { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 18 },
  cardIcon:       { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  cardTitle:      { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.text },

  field:          { marginBottom: 16 },
  fieldLabel:     { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted, marginBottom: 8 },
  fieldInput:     { backgroundColor: Colors.cream2, borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 13, fontSize: 14, fontFamily: "SpaceGrotesk_400Regular", color: Colors.text, marginBottom: 0 },
  fieldInputDisabled: { color: Colors.muted, backgroundColor: Colors.cream2 },
  fieldInputError:{ borderColor: Colors.red },

  infoNote:       { flexDirection: "row", alignItems: "center", gap: 6, marginTop: -4, paddingTop: 0 },
  infoNoteText:   { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", color: Colors.subtle, flex: 1 },

  passHint:       { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", color: Colors.subtle, marginBottom: 16, marginTop: -6 },
  passRow:        { flexDirection: "row", alignItems: "center", gap: 8 },
  eyeBtn:         { width: 44, height: 48, alignItems: "center", justifyContent: "center" },

  strengthRow:    { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  strengthBar:    { flex: 1, height: 3, borderRadius: 4 },
  strengthLabel:  { fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", width: 42 },

  mismatchText:   { fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.red, marginTop: 6 },

  bottomBar:      { padding: 20, paddingBottom: 34, borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.cream2 },
  btn:            { borderRadius: Radius.full, overflow: "hidden" },
  btnGrad: { paddingVertical: 16, alignItems: "center", backgroundColor: Colors.red },
  btnText:        { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
});
