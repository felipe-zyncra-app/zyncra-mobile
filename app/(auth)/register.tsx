import { useState } from "react";
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
import { Colors, Gradients, Radius, Shadow } from "@/constants/theme";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// ── Data ─────────────────────────────────────────────────────────────────────

const BIZ_TYPES = [
  { id: "barberia",  emoji: "💈", label: "Barbería" },
  { id: "salon",     emoji: "✂️", label: "Salón" },
  { id: "spa",       emoji: "💆", label: "Spa" },
  { id: "manicure",  emoji: "💅", label: "Manicure" },
  { id: "estetica",  emoji: "🏥", label: "Estética" },
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
  { id: "billing",     emoji: "📄", label: "Facturas DIAN" },
  { id: "reviews",     emoji: "⭐", label: "Reseñas Google" },
  { id: "commissions", emoji: "💰", label: "Comisiones" },
  { id: "marketing",   emoji: "📣", label: "Marketing WA" },
  { id: "team",        emoji: "👥", label: "Gestionar equipo" },
];

const PLAN_INFO = {
  Esencial: { price: "$99.900/mes", color: Colors.text, emoji: "✨" },
  Pro:       { price: "$199.900/mes", color: Colors.red,  emoji: "🚀" },
  Personalizado: { price: "A medida", color: "#7B2FBE",   emoji: "🏢" },
} as const;

const createSlug = (n: string) =>
  n.toLowerCase().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");

function determinePlan(c: string, a: string, m: boolean, g: string[]): "Esencial" | "Pro" | "Personalizado" {
  if (m || c === "8+") return "Personalizado";
  const pro = ["pos", "billing", "marketing", "commissions"];
  if (["4-7", "8+"].includes(c) || ["16-30", "30+"].includes(a) || g.some(x => pro.includes(x))) return "Pro";
  return "Esencial";
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
  const [plan, setPlan] = useState<"Esencial" | "Pro" | "Personalizado">("Esencial");

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
      const { data: auth, error: ae } = await supabase.auth.signUp({ email, password });
      if (ae) throw ae;
      if (auth.user) {
        const slug = createSlug(businessName);
        const { data: td, error: te } = await supabase.from("tenants")
          .insert([{ owner_id: auth.user.id, name: businessName, slug }])
          .select().single();
        if (te) { if (te.code === "23505") throw new Error("Ese nombre ya está en uso."); throw te; }
        if (td) {
          await supabase.from("business_profiles").insert([{
            tenant_id: td.id, biz_type: bizType, collaborators,
            appointments_per_day: appointments, multi_sede: multiSede,
            goals, whatsapp: whatsapp || null,
            plan_recommended: determinePlan(collaborators, appointments, multiSede!, goals),
          }]);
        }
        const rec = determinePlan(collaborators, appointments, multiSede!, goals);
        setPlan(rec);
        setStep(5);
      }
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

        {/* STEP 5 — Plan recommendation */}
        {step === 5 && (
          <Animated.View entering={FadeInDown.duration(500).springify()} style={{ alignItems: "center" }}>
            <Text style={{ fontSize: 56, marginBottom: 16 }}>🎉</Text>
            <Text style={[c.stepLabel, { fontSize: 22, textAlign: "center", marginBottom: 6 }]}>¡Cuenta creada!</Text>
            <Text style={{ color: Colors.muted, fontSize: 14, textAlign: "center", fontFamily: "SpaceGrotesk_400Regular", marginBottom: 28 }}>
              Basado en tu perfil, te recomendamos este plan
            </Text>

            <LinearGradient
              colors={plan === "Pro" ? ["#fff5f5", "#fff0f0"] : plan === "Personalizado" ? ["#f8f0ff", "#f3e8ff"] : ["#f5f4f2", "#f0efec"]}
              style={[c.planCard, Shadow.md]}>
              <Text style={{ fontSize: 11, fontFamily: "JetBrainsMono_500Medium", textTransform: "uppercase", letterSpacing: 1, color: PLAN_INFO[plan].color, marginBottom: 4 }}>
                Plan recomendado
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <Text style={{ fontSize: 26, fontFamily: "SpaceGrotesk_700Bold", color: Colors.text }}>
                  {PLAN_INFO[plan].emoji} Plan {plan}
                </Text>
                <Text style={{ fontSize: 17, fontFamily: "SpaceGrotesk_700Bold", color: PLAN_INFO[plan].color }}>
                  {PLAN_INFO[plan].price}
                </Text>
              </View>
              <Text style={{ fontSize: 13, color: Colors.muted, fontFamily: "SpaceGrotesk_400Regular", lineHeight: 20 }}>
                {plan === "Esencial"
                  ? "Agenda digital, recordatorios automáticos, gestión de clientes y WhatsApp."
                  : plan === "Pro"
                  ? "Todo Esencial + POS, comisiones del equipo y campañas de WhatsApp Marketing."
                  : "Múltiples sedes, equipo ilimitado, DIAN y soporte dedicado."}
              </Text>
            </LinearGradient>

            <View style={{ width: "100%", marginTop: 20 }}>
              <GradientBtn label="Ir a mi panel →" onPress={() => router.replace("/(admin)/(tabs)")} />
            </View>
            <Text style={{ marginTop: 16, color: Colors.subtle, fontSize: 12, fontFamily: "SpaceGrotesk_400Regular" }}>
              14 días gratis · Sin tarjeta de crédito
            </Text>
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
  planCard: { width: "100%", borderRadius: Radius.xl, padding: 22 },
});
