import { useEffect, useRef, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, KeyboardAvoidingView, ActivityIndicator, Alert,
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
import { validarContrasena, traducirErrorAuth, AYUDA_CONTRASENA } from "@/lib/cuenta";

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
  label, value, onChangeText, placeholder, keyboardType, autoCapitalize, editable = true,
}: {
  label: string; value: string; onChangeText?: (t: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "email-address";
  autoCapitalize?: "none" | "words";
  editable?: boolean;
}) {
  const { t } = useTheme();
  return (
    <View style={s.field}>
      <Text style={[s.fieldLabel, { color: t.muted }]}>{label}</Text>
      <TextInput
        style={[s.fieldInput, { backgroundColor: t.inputBg, borderColor: t.inputBorder, color: editable ? t.text : t.muted }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.subtle}
        keyboardType={keyboardType ?? "default"}
        autoCapitalize={autoCapitalize ?? "sentences"}
        editable={editable}
        accessibilityLabel={label}
      />
    </View>
  );
}

/** Campo de contraseña con botón de mostrar/ocultar. */
function PassField({ label, value, onChangeText, placeholder, error }: {
  label: string; value: string; onChangeText: (t: string) => void; placeholder: string; error?: boolean;
}) {
  const { t } = useTheme();
  const [ver, setVer] = useState(false);
  return (
    <View style={s.passRow}>
      <TextInput
        style={[s.fieldInput, { flex: 1, backgroundColor: t.inputBg, borderColor: error ? Colors.red : t.inputBorder, color: t.text }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.subtle}
        secureTextEntry={!ver}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={label}
      />
      <TouchableOpacity
        style={s.eyeBtn} onPress={() => setVer(p => !p)}
        accessibilityRole="button" accessibilityLabel={ver ? "Ocultar contraseña" : "Mostrar contraseña"}
      >
        <Ionicons name={ver ? "eye-off-outline" : "eye-outline"} size={18} color={t.subtle} />
      </TouchableOpacity>
    </View>
  );
}

export default function ProfileScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const { user, verificarContrasena } = useAuth();
  const [email, setEmail]         = useState("");
  const [displayName, setDisplayName] = useState("");
  const [nombreInicial, setNombreInicial] = useState("");
  const [currentPass, setCurrentPass] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [savedOk, setSavedOk]     = useState(false);

  // Se llena UNA vez por usuario. `user` cambia con cada evento de sesión
  // (refresco del token y el SIGNED_IN de verificarContrasena al cambiar la
  // contraseña): antes eso reiniciaba el nombre que se estaba editando, y si
  // luego fallaba updateUser el cambio se perdía sin aviso.
  const iniciadoPara = useRef<string | null>(null);
  useEffect(() => {
    if (!user || iniciadoPara.current === user.id) return;
    iniciadoPara.current = user.id;
    setEmail(user.email ?? "");
    const meta = user.user_metadata as { full_name?: string } | null;
    setDisplayName(meta?.full_name ?? "");
    setNombreInicial(meta?.full_name ?? "");
    setLoading(false);
  }, [user]);

  const handleSave = async () => {
    const cambiaNombre = displayName.trim() !== nombreInicial.trim() && displayName.trim().length > 0;
    const cambiaPass = newPassword.length > 0;
    if (!cambiaNombre && !cambiaPass) {
      Alert.alert("Sin cambios", "No hay nada nuevo que guardar.");
      return;
    }
    if (cambiaPass) {
      // Misma regla que el registro (AJU-24): antes aquí se aceptaba "aaaaaa".
      const err = validarContrasena(newPassword);
      if (err) { Alert.alert("Contraseña", err); return; }
      if (newPassword !== confirmPass) { Alert.alert("Contraseña", "Las contraseñas no coinciden."); return; }
      if (!currentPass) { Alert.alert("Contraseña", "Escribe tu contraseña actual para confirmar el cambio."); return; }
    }
    setSaving(true);
    try {
      // Con el teléfono desbloqueado cualquiera podía cambiar la contraseña
      // del dueño, que es la cuenta con acceso a clientes, caja y a eliminar el
      // negocio. Ahora se confirma la actual antes.
      if (cambiaPass) {
        const v = await verificarContrasena(currentPass);
        if (!v.ok) { Alert.alert("No se cambió", v.mensaje ?? "La contraseña actual no es correcta."); return; }
      }

      const updates: { data?: { full_name: string }; password?: string } = {};
      if (cambiaNombre) updates.data = { full_name: displayName.trim() };
      if (cambiaPass)   updates.password = newPassword;

      const { error } = await supabase.auth.updateUser(updates);
      if (error) { Alert.alert("No se guardó", traducirErrorAuth(error)); return; }

      setCurrentPass("");
      setNewPassword("");
      setConfirmPass("");
      if (cambiaNombre) setNombreInicial(displayName.trim());
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 2000);
    } catch (e) {
      Alert.alert("No se guardó", traducirErrorAuth(e));
    } finally {
      setSaving(false);
    }
  };

  const passStrength = (() => {
    if (!newPassword) return null;
    let score = 0;
    if (newPassword.length >= 6) score++;
    if (/[A-Z]/.test(newPassword)) score++;
    if (/\d/.test(newPassword)) score++;
    if (score <= 1) return { label: "Débil", color: Colors.red, score: 1 };
    if (score === 2) return { label: "Media", color: "#f59e0b", score: 2 };
    return { label: "Válida", color: Colors.success, score: 3 };
  })();

  const initials = getInitials(displayName, email);
  const noCoinciden = confirmPass.length > 0 && confirmPass !== newPassword;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      {/* Header (tinta oscura en ambos temas: firma de marca) */}
      <LinearGradient colors={Gradients.ink} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.header}>
        <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, zIndex: 1 }} />
        <View style={s.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel="Volver">
            <Ionicons name="arrow-back" size={20} color="white" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.headerTitle} accessibilityRole="header">Mi perfil</Text>
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
              <Text style={[s.sectionLabel, { color: t.subtle }]}>Información personal</Text>
              <View style={[s.card, Shadow.sm, { backgroundColor: t.card, borderColor: t.cardBorder }]}>
                <View style={s.cardTitleRow}>
                  <View style={[s.cardIcon, { backgroundColor: Colors.purple + "15" }]}>
                    <Ionicons name="person-outline" size={16} color={Colors.purple} />
                  </View>
                  <Text style={[s.cardTitle, { color: t.text }]}>Datos de la cuenta</Text>
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
                  <Ionicons name="information-circle-outline" size={14} color={t.subtle} />
                  <Text style={[s.infoNoteText, { color: t.subtle }]}>
                    Para cambiar el correo, contacta soporte.
                  </Text>
                </View>
              </View>
            </Animated.View>

            {/* Security */}
            <Animated.View entering={FadeInDown.delay(60).duration(340)}>
              <Text style={[s.sectionLabel, { marginTop: 24, color: t.subtle }]}>Seguridad</Text>
              <View style={[s.card, Shadow.sm, { backgroundColor: t.card, borderColor: t.cardBorder }]}>
                <View style={s.cardTitleRow}>
                  <View style={[s.cardIcon, { backgroundColor: "#f59e0b18" }]}>
                    <Ionicons name="lock-closed-outline" size={16} color="#f59e0b" />
                  </View>
                  <Text style={[s.cardTitle, { color: t.text }]}>Cambiar contraseña</Text>
                </View>
                <Text style={[s.passHint, { color: t.subtle }]}>Déjalo en blanco si no deseas cambiarla</Text>

                <View style={s.field}>
                  <Text style={[s.fieldLabel, { color: t.muted }]}>Nueva contraseña</Text>
                  <PassField label="Nueva contraseña" value={newPassword} onChangeText={setNewPassword} placeholder={AYUDA_CONTRASENA} />
                  {passStrength && (
                    <View style={s.strengthRow}>
                      {[1, 2, 3].map(i => (
                        <View key={i} style={[s.strengthBar, { backgroundColor: i <= passStrength.score ? passStrength.color : t.trackBg }]} />
                      ))}
                      <Text style={[s.strengthLabel, { color: passStrength.color }]}>{passStrength.label}</Text>
                    </View>
                  )}
                </View>

                <View style={s.field}>
                  <Text style={[s.fieldLabel, { color: t.muted }]}>Confirmar contraseña</Text>
                  <PassField label="Confirmar contraseña" value={confirmPass} onChangeText={setConfirmPass} placeholder="Repite la contraseña" error={noCoinciden} />
                  {noCoinciden && <Text style={s.mismatchText}>Las contraseñas no coinciden</Text>}
                </View>

                {newPassword.length > 0 && (
                  <View style={s.field}>
                    <Text style={[s.fieldLabel, { color: t.muted }]}>Contraseña actual</Text>
                    <PassField label="Contraseña actual" value={currentPass} onChangeText={setCurrentPass} placeholder="Para confirmar que eres tú" />
                  </View>
                )}
              </View>
            </Animated.View>
          </ScrollView>

          {/* Bottom bar */}
          <View style={[s.bottomBar, { backgroundColor: t.bg, borderTopColor: t.border }]}>
            <TouchableOpacity
              style={s.btn}
              onPress={handleSave}
              disabled={saving}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityState={{ disabled: saving, busy: saving }}
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

  sectionLabel:   { fontSize: 11, fontFamily: "JetBrainsMono_500Medium", textTransform: "uppercase", letterSpacing: 0.9, marginBottom: 10 },

  card:           { borderWidth: 1, borderRadius: Radius.lg, padding: 16 },
  cardTitleRow:   { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 18 },
  cardIcon:       { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  cardTitle:      { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold" },

  field:          { marginBottom: 16 },
  fieldLabel:     { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", marginBottom: 8 },
  fieldInput:     { borderWidth: 1.5, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 13, fontSize: 14, fontFamily: "SpaceGrotesk_400Regular" },

  infoNote:       { flexDirection: "row", alignItems: "center", gap: 6, marginTop: -4, paddingTop: 0 },
  infoNoteText:   { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", flex: 1 },

  passHint:       { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", marginBottom: 16, marginTop: -6 },
  passRow:        { flexDirection: "row", alignItems: "center", gap: 8 },
  eyeBtn:         { width: 44, height: 48, alignItems: "center", justifyContent: "center" },

  strengthRow:    { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  strengthBar:    { flex: 1, height: 3, borderRadius: 4 },
  strengthLabel:  { fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", width: 46 },

  mismatchText:   { fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.red, marginTop: 6 },

  bottomBar:      { padding: 20, paddingBottom: 34, borderTopWidth: 1 },
  btn:            { borderRadius: Radius.full, overflow: "hidden" },
  btnGrad:        { paddingVertical: 16, alignItems: "center", backgroundColor: Colors.red },
  btnText:        { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
});
