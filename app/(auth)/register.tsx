import { useState, useRef } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Pressable, KeyboardAvoidingView, Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  FadeInRight, FadeOutLeft, FadeInDown, FadeInUp,
  useSharedValue, useAnimatedStyle, withSpring,
} from "react-native-reanimated";
import { useRouter } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { Config } from "@/lib/config";
import { Colors, Gradients, Radius } from "@/constants/theme";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// ── Data ─────────────────────────────────────────────────────────────────────

const BIZ_TYPES = [
  { id: "barberia",  emoji: "💈", label: "Barbería" },
  { id: "salon",     emoji: "✂️", label: "Salón" },
  { id: "spa",       emoji: "💆", label: "Spa" },
  { id: "manicure",  emoji: "💅", label: "Manicure" },
  { id: "estetica",  emoji: "🏥", label: "Estética" },
  { id: "odontologia", emoji: "🦷", label: "Odontología" },
  { id: "medico",    emoji: "⚕️", label: "Consultorio" },
  { id: "masajes",   emoji: "🧘", label: "Masajes" },
  { id: "tatuajes",  emoji: "🎨", label: "Tatuajes" },
  { id: "otro",      emoji: "🏪", label: "Otro" },
];

const COLLAB_OPTS = [
  { id: "solo", label: "Solo yo",      icon: "🙋" },
  { id: "2-3",  label: "2-3 personas", icon: "👫" },
  { id: "4-7",  label: "4-7 personas", icon: "👨‍👩‍👧‍👦" },
  { id: "8+",   label: "8 o más",      icon: "🏢" },
];

const APPT_OPTS = [
  { id: "<5",    label: "Menos de 5", icon: "🌱" },
  { id: "5-15",  label: "5 a 15",     icon: "📊" },
  { id: "16-30", label: "16 a 30",    icon: "🔥" },
  { id: "30+",   label: "Más de 30",  icon: "⚡" },
];

const GOALS = [
  { id: "noshows",     emoji: "🚫", label: "Reducir no-shows" },
  { id: "whatsapp",    emoji: "💬", label: "Agenda WhatsApp" },
  { id: "pos",         emoji: "💳", label: "POS y cobros" },
  { id: "billing",     emoji: "📄", label: "Control de caja" },
  { id: "reviews",     emoji: "⭐", label: "Reseñas Google" },
  { id: "commissions", emoji: "💰", label: "Comisiones" },
  { id: "marketing",   emoji: "📣", label: "Marketing WA" },
  { id: "team",        emoji: "👥", label: "Gestionar equipo" },
];

const createSlug = (n: string) =>
  n.toLowerCase().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");

function translateAuthError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("already registered")) return "Ese correo ya tiene una cuenta. Inicia sesión.";
  if (m.includes("invalid") && m.includes("email")) return "El correo no es válido.";
  if (m.includes("password")) return "La contraseña no cumple los requisitos.";
  if (m.includes("network") || m.includes("fetch")) return "Sin conexión. Revisa tu internet e inténtalo de nuevo.";
  return msg;
}

// ── Reusable components ───────────────────────────────────────────────────────

function GradientBtn({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const scale = useSharedValue(1);
  const st = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <AnimatedPressable style={[st, c.gradBtn, { opacity: disabled ? 0.45 : 1 }]}
      onPressIn={() => { if (!disabled) scale.value = withSpring(0.97, { stiffness: 400 }); }}
      onPressOut={() => { scale.value = withSpring(1, { stiffness: 400 }); }}
      onPress={() => { if (!disabled) onPress(); }}>
      <Text style={c.gradBtnText}>{label}</Text>
    </AnimatedPressable>
  );
}

function BackBtn({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity style={c.backBtn} onPress={onPress}>
      <Text style={c.backBtnText}>← Atrás</Text>
    </TouchableOpacity>
  );
}

function SelectCard({ emoji, label, active, onPress }: { emoji?: string; label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[c.selCard, active && c.selCardActive]}
      onPress={onPress} activeOpacity={0.8}>
      {emoji ? <Text style={c.selEmoji}>{emoji}</Text> : null}
      <Text style={[c.selLabel, active && c.selLabelActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function RegisterScreen() {
  const router = useRouter();
  const { refreshRole } = useAuth();
  const [step, setStep] = useState(1);

  const [bizType, setBizType] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [collaborators, setCollaborators] = useState("");
  const [appointments, setAppointments] = useState("");
  const [multiSede, setMultiSede] = useState<boolean | null>(null);
  const [goals, setGoals] = useState<string[]>([]);
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Si el signUp funcionó pero falló crear el negocio, el reintento salta el signUp
  // (volver a llamarlo con el mismo correo devolvería "already registered" y dejaría al usuario atrapado)
  const createdUserId = useRef<string | null>(null);

  const toggleGoal = (id: string) => {
    setGoals(prev =>
      prev.includes(id) ? prev.filter(g => g !== id) : prev.length < 3 ? [...prev, id] : prev
    );
  };

  const can1 = bizType !== "" && businessName.trim() !== "";
  const can2 = collaborators !== "" && appointments !== "" && multiSede !== null;
  const can3 = goals.length > 0;
  const can4 = email.trim() !== "" && password.trim() !== "";

  const handleRegister = async () => {
    const re = /^(?=.*[A-Z])(?=.*\d).{6,}$/;
    if (!re.test(password)) {
      setError("Mín. 6 caracteres, 1 mayúscula y 1 número.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      let userId = createdUserId.current;
      if (!userId) {
        const { data: auth, error: ae } = await supabase.auth.signUp({ email, password });
        if (ae) throw new Error(translateAuthError(ae.message));
        userId = auth.user?.id ?? null;
        if (!userId) throw new Error("No se pudo crear la cuenta. Inténtalo de nuevo.");
        createdUserId.current = userId;
      }
      const slug = createSlug(businessName);
      // Todo el perfil del negocio va dentro de tenants.settings (jsonb). La
      // versión anterior insertaba en business_profiles, tabla que NO existe en
      // la base: aquel insert fallaba en silencio y las respuestas del wizard se
      // perdían enteras. biz_type además habilita los módulos verticales
      // (Historias Clínicas) en el panel web.
      // Se repiten los valores del DEFAULT de tenants.settings porque mandar el
      // campo lo reemplaza entero — omitirlos dejaría al negocio sin
      // primaryColor ni la config de depósitos.
      const { data: td, error: te } = await supabase.from("tenants")
        .insert([{
          owner_id: userId, name: businessName, slug,
          phone: whatsapp || null,
          settings: {
            logo: "", coverImage: "", primaryColor: "#2563EB",
            depositAmount: 0, requireDeposit: false,
            biz_type: bizType,
            onboarding: {
              collaborators,
              appointments_per_day: appointments,
              multi_sede: multiSede,
              goals,
            },
          },
        }])
        .select("id").single();
      if (te) { if (te.code === "23505") throw new Error("Ese nombre ya está en uso."); throw te; }

      // ── Prueba gratis ────────────────────────────────────────────────────
      // La crea el MISMO endpoint que usa el registro del portal, así que los
      // días de prueba (14) y el estado inicial salen de una sola fuente y el
      // cron de facturación del web ve la cuenta desde el día uno. Sin esta
      // llamada el negocio nace sin fila en saas_subscriptions: invisible para
      // el cron y con una prueba que no vence nunca.
      // El plan va explícito: sin planId el endpoint toma el más barato de
      // saas_plans, que sigue siendo Starter — el plan de usuario único
      // retirado de la oferta por la directriz 3.1.3(c) de Apple.
      if (td?.id) {
        try {
          const { data: plan } = await supabase
            .from("saas_plans").select("id")
            .eq("name", "Growth").eq("active", true).maybeSingle();
          await fetch(Config.api.activateTrial, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tenantId: td.id, planId: plan?.id }),
          });
        } catch {
          // Se falla abierto a propósito: la cuenta y el negocio ya existen.
          // Sin suscripción la app no bloquea (igual que el panel web trata
          // subData null), así que el dueño entra y soporte puede crearla.
        }
      }
      // El SIGNED_IN del signUp resolvió el rol cuando el negocio todavía no
      // existía, así que quedó en null. Sin volver a resolverlo, el guard de
      // (admin) rebota al login al tocar "Ir a mi panel".
      await refreshRole();
      setStep(5);
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const progress = Math.min((step - 1) / 4, 1);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      {/* ── Header ── */}
      <LinearGradient colors={Gradients.ink} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={c.header}>
        <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, zIndex: 1 }} />
        <View style={c.headerBlob1} />
        <View style={c.headerBlob2} />
        <View style={{ position: "relative", zIndex: 1 }}>
          <Text style={c.headerLogo}>Z</Text>
          <Text style={c.headerTitle}>
            {step === 1 ? "Tu negocio" : step === 2 ? "Tu operación" : step === 3 ? "Tus retos" : step === 4 ? "Tu cuenta" : "¡Listo!"}
          </Text>
          <Text style={c.headerSub}>
            {step === 1 ? "Cuéntanos sobre lo que haces" : step === 2 ? "¿Cómo trabajas día a día?" : step === 3 ? "¿Qué quieres mejorar?" : step === 4 ? "Un paso más para empezar" : "Cuenta creada con éxito"}
          </Text>
        </View>
        {/* Progress bar */}
        <View style={c.progressTrack}>
          <Animated.View style={[c.progressFill, { width: `${progress * 100}%` as any }]} />
        </View>
      </LinearGradient>

      {/* ── Body ── */}
      <ScrollView style={{ flex: 1, backgroundColor: Colors.cream }}
        contentContainerStyle={{ padding: 24, paddingBottom: 60 }}
        keyboardShouldPersistTaps="handled">

        {/* STEP 1 */}
        {step === 1 && (
          <Animated.View entering={FadeInRight.duration(300)}>
            <Text style={c.stepLabel}>Tipo de negocio</Text>
            <View style={c.bizGrid}>
              {BIZ_TYPES.map(b => (
                <TouchableOpacity key={b.id}
                  style={[c.bizCard, bizType === b.id && c.bizCardActive]}
                  onPress={() => setBizType(b.id)} activeOpacity={0.8}>
                  <Text style={c.bizEmoji}>{b.emoji}</Text>
                  <Text style={[c.bizLabel, bizType === b.id && c.bizLabelActive]}>{b.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={[c.stepLabel, { marginTop: 20 }]}>Nombre de tu negocio</Text>
            <TextInput style={c.input} placeholder="Ej: Black Fade Barbershop"
              placeholderTextColor={Colors.subtle} value={businessName}
              onChangeText={setBusinessName} />
            <GradientBtn label="Continuar →" onPress={() => setStep(2)} disabled={!can1} />
            <TouchableOpacity style={{ alignItems: "center", marginTop: 20 }} onPress={() => router.back()}>
              <Text style={{ color: Colors.muted, fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold" }}>
                ¿Ya tienes cuenta? <Text style={{ color: Colors.red, fontFamily: "SpaceGrotesk_700Bold" }}>Inicia sesión</Text>
              </Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* STEP 2 */}
        {step === 2 && (
          <Animated.View entering={FadeInRight.duration(300)}>
            <Text style={c.stepLabel}>¿Cuántas personas trabajan contigo?</Text>
            <View style={c.opGrid}>
              {COLLAB_OPTS.map(o => (
                <SelectCard key={o.id} emoji={o.icon} label={o.label}
                  active={collaborators === o.id} onPress={() => setCollaborators(o.id)} />
              ))}
            </View>
            <Text style={[c.stepLabel, { marginTop: 22 }]}>¿Cuántas citas atiendes por día?</Text>
            <View style={c.opGrid}>
              {APPT_OPTS.map(o => (
                <SelectCard key={o.id} emoji={o.icon} label={o.label}
                  active={appointments === o.id} onPress={() => setAppointments(o.id)} />
              ))}
            </View>
            <Text style={[c.stepLabel, { marginTop: 22 }]}>¿Tienes más de una sede?</Text>
            <View style={{ flexDirection: "row", gap: 12 }}>
              {[{ v: true, l: "Sí, varias" }, { v: false, l: "Solo una" }].map(o => (
                <SelectCard key={String(o.v)} label={o.l}
                  active={multiSede === o.v} onPress={() => setMultiSede(o.v)} />
              ))}
            </View>
            <View style={c.btnRow}>
              <BackBtn onPress={() => setStep(1)} />
              <View style={{ flex: 1 }}>
                <GradientBtn label="Continuar →" onPress={() => setStep(3)} disabled={!can2} />
              </View>
            </View>
          </Animated.View>
        )}

        {/* STEP 3 */}
        {step === 3 && (
          <Animated.View entering={FadeInRight.duration(300)}>
            <Text style={c.stepLabel}>¿Qué quieres mejorar? (máx. 3)</Text>
            <View style={c.goalGrid}>
              {GOALS.map(g => {
                const on = goals.includes(g.id);
                const disabled = !on && goals.length >= 3;
                return (
                  <TouchableOpacity key={g.id}
                    style={[c.goalChip, on && c.goalChipActive, disabled && { opacity: 0.4 }]}
                    onPress={() => toggleGoal(g.id)} activeOpacity={0.8} disabled={disabled}>
                    <Text style={{ fontSize: 15 }}>{g.emoji}</Text>
                    <Text style={[c.goalText, on && c.goalTextActive]}>{g.label}</Text>
                    {on && <Text style={c.goalCheck}>✓</Text>}
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={{ textAlign: "center", color: Colors.subtle, fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", marginTop: 12 }}>
              {goals.length}/3 seleccionados
            </Text>
            <View style={c.btnRow}>
              <BackBtn onPress={() => setStep(2)} />
              <View style={{ flex: 1 }}>
                <GradientBtn label="Continuar →" onPress={() => setStep(4)} disabled={!can3} />
              </View>
            </View>
          </Animated.View>
        )}

        {/* STEP 4 */}
        {step === 4 && (
          <Animated.View entering={FadeInRight.duration(300)}>
            {error && (
              <View style={c.errorBox}>
                <Text style={c.errorText}>⚠ {error}</Text>
              </View>
            )}
            <Text style={c.stepLabel}>Correo electrónico</Text>
            <TextInput style={c.input} placeholder="tu@correo.com"
              placeholderTextColor={Colors.subtle} keyboardType="email-address"
              autoCapitalize="none" value={email} onChangeText={setEmail} />
            <Text style={c.stepLabel}>WhatsApp <Text style={{ color: Colors.subtle, fontFamily: "SpaceGrotesk_400Regular" }}>(opcional)</Text></Text>
            <TextInput style={c.input} placeholder="+57 300 000 0000"
              placeholderTextColor={Colors.subtle} keyboardType="phone-pad"
              value={whatsapp} onChangeText={setWhatsapp} />
            <Text style={c.stepLabel}>Contraseña</Text>
            <TextInput style={c.input} placeholder="Mín. 6 car., 1 mayúscula, 1 número"
              placeholderTextColor={Colors.subtle} secureTextEntry
              value={password} onChangeText={setPassword} />
            <View style={c.btnRow}>
              <BackBtn onPress={() => setStep(3)} />
              <View style={{ flex: 1 }}>
                <GradientBtn label={loading ? "Creando..." : "Crear cuenta →"}
                  onPress={handleRegister} disabled={!can4 || loading} />
              </View>
            </View>
          </Animated.View>
        )}

        {/* STEP 5 — Cuenta creada */}
        {step === 5 && (
          <Animated.View entering={FadeInDown.duration(500).springify()} style={{ alignItems: "center" }}>
            <Text style={{ fontSize: 56, marginBottom: 16 }}>🎉</Text>
            <Text style={[c.stepLabel, { fontSize: 22, textAlign: "center", marginBottom: 6 }]}>¡Cuenta creada!</Text>
            <Text style={{ color: Colors.muted, fontSize: 14, textAlign: "center", fontFamily: "SpaceGrotesk_400Regular", marginBottom: 28 }}>
              Ya puedes configurar {businessName}: tu agenda, tus servicios y tu equipo.
            </Text>
            <View style={{ width: "100%" }}>
              <GradientBtn label="Ir a mi panel →" onPress={() => router.replace("/(admin)/(tabs)")} />
            </View>
          </Animated.View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const c = StyleSheet.create({
  header: { paddingTop: 60, paddingHorizontal: 24, paddingBottom: 24, overflow: "hidden" },
  headerBlob1: { position: "absolute", width: 180, height: 180, borderRadius: 90, backgroundColor: "rgba(255,255,255,.1)", top: -60, right: -40 },
  headerBlob2: { position: "absolute", width: 120, height: 120, borderRadius: 60, backgroundColor: "rgba(0,0,0,.08)", bottom: -30, left: -20 },
  headerLogo: { fontSize: 28, fontFamily: "SpaceGrotesk_700Bold", color: "white", marginBottom: 4 },
  headerTitle: { fontSize: 22, fontFamily: "SpaceGrotesk_700Bold", color: "white", letterSpacing: -0.5 },
  headerSub: { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: "rgba(255,255,255,.75)", marginTop: 2 },
  progressTrack: { height: 4, backgroundColor: "rgba(255,255,255,.25)", borderRadius: 4, marginTop: 20 },
  progressFill: { height: 4, backgroundColor: "white", borderRadius: 4 },
  stepLabel: { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: "#3a3a48", marginBottom: 12 },
  input: {
    backgroundColor: Colors.white, borderWidth: 1.5, borderColor: Colors.border,
    borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 13,
    fontSize: 14, fontFamily: "SpaceGrotesk_400Regular", color: Colors.text, marginBottom: 18,
  },
  gradBtn: { borderRadius: Radius.md, paddingVertical: 16, alignItems: "center", backgroundColor: Colors.red },
  gradBtnText: { color: "white", fontSize: 15, fontFamily: "SpaceGrotesk_700Bold" },
  backBtn: { backgroundColor: Colors.white, borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md, paddingVertical: 16, paddingHorizontal: 18, justifyContent: "center" },
  backBtnText: { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted },
  btnRow: { flexDirection: "row", gap: 12, marginTop: 24, alignItems: "stretch" },
  bizGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  bizCard: {
    width: "22%", aspectRatio: 0.9, backgroundColor: Colors.white,
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md,
    alignItems: "center", justifyContent: "center", gap: 4,
  },
  bizCardActive: { borderColor: Colors.red, backgroundColor: "rgba(251,15,5,.07)" },
  bizEmoji: { fontSize: 22 },
  bizLabel: { fontSize: 10, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted, textAlign: "center" },
  bizLabelActive: { color: Colors.red },
  opGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  selCard: {
    flex: 1, minWidth: "45%", backgroundColor: Colors.white,
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md,
    paddingVertical: 14, paddingHorizontal: 12,
    flexDirection: "row", alignItems: "center", gap: 8,
  },
  selCardActive: { borderColor: Colors.red, backgroundColor: "rgba(251,15,5,.07)" },
  selEmoji: { fontSize: 18 },
  selLabel: { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted, flex: 1 },
  selLabelActive: { color: Colors.red },
  goalGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  goalChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: Colors.white, borderWidth: 1.5, borderColor: Colors.border,
    borderRadius: Radius.full, paddingVertical: 9, paddingHorizontal: 14,
  },
  goalChipActive: { borderColor: Colors.red, backgroundColor: "rgba(251,15,5,.08)" },
  goalText: { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.muted },
  goalTextActive: { color: Colors.red },
  goalCheck: { fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", color: Colors.red },
  errorBox: { backgroundColor: "#fff0f0", borderWidth: 1, borderColor: "rgba(251,15,5,.2)", borderRadius: Radius.md, padding: 12, marginBottom: 16 },
  errorText: { color: "#d90d04", fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold" },
});
