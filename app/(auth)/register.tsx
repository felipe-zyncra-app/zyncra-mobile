import { useState, useRef, useEffect, useMemo } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Pressable, KeyboardAvoidingView, Platform, Modal, FlatList,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  FadeInRight, FadeInDown,
  useSharedValue, useAnimatedStyle, withSpring,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Linking from "expo-linking";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { Config } from "@/lib/config";
import { validarCorreo, validarTelefono } from "@/lib/contacto";
import { ErrorDB, conTimeout, mensajeError, patchTenantSettings } from "@/lib/db";
import { DEFAULT_SLOT_INTERVAL } from "@/lib/scheduling";
import {
  AYUDA_CONTRASENA, validarContrasena, traducirErrorAuth,
  crearSlug, slugConSufijo,
  PAISES_REGISTRO, PAIS_REGISTRO_POR_DEFECTO, type PaisRegistro,
  banderaDe, zonaDelDispositivo, paisPorZona, zonaParaPais, TERMS_VERSION,
  CLAVE_BORRADOR_REGISTRO,
} from "@/lib/cuenta";
import { Colors, Gradients, Radius } from "@/constants/theme";
import { useTheme, type ThemeColors } from "@/lib/theme";

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

/**
 * Borrador del asistente. Si el sistema mata la app mientras el dueño busca el
 * código en su correo (común en Android), al volver la cuenta ya existe y
 * AuthProvider lo lleva a "Terminar registro"; sin esto tenía que contestar
 * todo otra vez (AJU-05). Nunca se guarda la contraseña.
 */
const CLAVE_BORRADOR = CLAVE_BORRADOR_REGISTRO;
type Borrador = {
  bizType?: string; businessName?: string; collaborators?: string; appointments?: string;
  multiSede?: boolean | null; goals?: string[]; email?: string; whatsapp?: string; pais?: string;
};

/**
 * Horario con el que nace el negocio (AGE-04): el mismo sugerido de Ajustes →
 * Horario de atención, lunes a sábado de 9:00 a 18:00 y domingo cerrado. Sin
 * él, la agenda y la reserva en línea usaban el respaldo de 08:00 a 19:00
 * todos los días, domingos incluidos, hasta que el dueño guardara uno.
 * Claves "0" (domingo) a "6" (sábado), como settings.schedule en el web.
 */
function horarioInicial(): Record<string, { open: boolean; start: string; end: string }> {
  const horario: Record<string, { open: boolean; start: string; end: string }> = {};
  for (let d = 0; d < 7; d++) horario[String(d)] = { open: d !== 0, start: "09:00", end: "18:00" };
  return horario;
}

const esperar = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * fetch a los endpoints públicos del portal con tope de tiempo: en Android un
 * corte a mitad de la petición dejaba "Verificando…" colgado para siempre.
 */
const TOPE_PORTAL_MS = 20_000;
function postPortal(url: string, cuerpo: unknown): Promise<Response> {
  return conTimeout(
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) }),
    TOPE_PORTAL_MS,
    "El servidor tardó demasiado en responder. Inténtalo de nuevo.",
  );
}

// ── Colores según el tema ─────────────────────────────────────────────────────

function coloresRegistro(t: ThemeColors) {
  return {
    fondo:      { backgroundColor: t.bg },
    etiqueta:   { color: t.text },
    texto:      { color: t.muted },
    sutil:      { color: t.subtle },
    input:      { backgroundColor: t.inputBg, borderColor: t.inputBorder, color: t.text },
    tarjeta:    { backgroundColor: t.card, borderColor: t.inputBorder },
    tarjetaTxt: { color: t.muted },
  };
}

// ── Reusable components ───────────────────────────────────────────────────────

function GradientBtn({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const scale = useSharedValue(1);
  const st = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <AnimatedPressable style={[st, c.gradBtn, { opacity: disabled ? 0.45 : 1 }]}
      onPressIn={() => { if (!disabled) scale.value = withSpring(0.97, { stiffness: 400 }); }}
      onPressOut={() => { scale.value = withSpring(1, { stiffness: 400 }); }}
      onPress={() => { if (!disabled) onPress(); }}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}>
      <Text style={c.gradBtnText}>{label}</Text>
    </AnimatedPressable>
  );
}

function BackBtn({ onPress }: { onPress: () => void }) {
  const { t } = useTheme();
  return (
    <TouchableOpacity style={[c.backBtn, { backgroundColor: t.card, borderColor: t.inputBorder }]} onPress={onPress} accessibilityRole="button" accessibilityLabel="Atrás">
      <Text style={[c.backBtnText, { color: t.muted }]}>← Atrás</Text>
    </TouchableOpacity>
  );
}

function SelectCard({ emoji, label, active, onPress }: { emoji?: string; label: string; active: boolean; onPress: () => void }) {
  const { t } = useTheme();
  return (
    <TouchableOpacity
      style={[c.selCard, { backgroundColor: t.card, borderColor: t.inputBorder }, active && c.selCardActive]}
      onPress={onPress} activeOpacity={0.8}
      accessibilityRole="radio" accessibilityState={{ checked: active }} accessibilityLabel={label}>
      {emoji ? <Text style={c.selEmoji}>{emoji}</Text> : null}
      <Text style={[c.selLabel, { color: t.muted }, active && c.selLabelActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function RegisterScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const tc = useMemo(() => coloresRegistro(t), [t]);
  const { refreshRole, session, estado, cerrarSesion } = useAuth();
  const { reanudar } = useLocalSearchParams<{ reanudar?: string }>();
  // D14: "Terminar registro" desde /sin-acceso. La cuenta de auth ya existe
  // (se crea antes del código del correo): se usa la sesión y NO se vuelve a
  // hacer signUp, que respondería "already registered".
  const cuentaExistente = reanudar === "1" && !!session?.user;
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
  const zonaTelefono = useMemo(() => zonaDelDispositivo(), []);
  const [pais, setPais] = useState<PaisRegistro>(() => paisPorZona(zonaTelefono) ?? PAIS_REGISTRO_POR_DEFECTO);
  const [paisOpen, setPaisOpen] = useState(false);
  const [aceptaTerminos, setAceptaTerminos] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Si el signUp funcionó pero falló crear el negocio, el reintento salta el signUp
  // (volver a llamarlo con el mismo correo devolvería "already registered" y dejaría al usuario atrapado)
  const createdUserId = useRef<string | null>(null);
  // Contraseña con la que se creó la cuenta: si el dueño vuelve atrás y la
  // corrige, se aplica con updateUser en vez de ignorarla (AJU-20).
  const contrasenaCuenta = useRef<string>("");
  // El correo se verifica con un código antes de crear el negocio. Sin esto
  // entraban altas con correos que no existen (llegó un "@example.com") y el
  // negocio quedaba sin forma de recibir cobros ni avisos.
  const [verifyMode, setVerifyMode] = useState(false);
  const [otpCode, setOtpCode]       = useState("");
  const [otpLoading, setOtpLoading] = useState(false);
  // El portal borra el código al validarlo. Si después falla crear el negocio
  // (red, nombre), el reintento no debe volver a pedir un código que ya no
  // existe ("Código no encontrado", AJU-14).
  const otpVerificadoPara = useRef<string | null>(null);
  // Teléfono ya normalizado (dígitos con indicativo), listo para guardar.
  const telNormalizado = useRef<string>("");
  // Correo con el que se hizo el signUp. El de auth ya no se puede cambiar, así
  // que el negocio tiene que guardar ese mismo y no lo que quede en el input.
  const correoCuenta = useRef<string>("");
  // El servidor solo deja un código por minuto y por correo. Se refleja aquí
  // para que el botón se apague en vez de chocar contra un 429.
  const otpEnviado = useRef(false);
  const [reenvioEn, setReenvioEn] = useState(0);
  const [aviso, setAviso] = useState<string | null>(null);
  const borradorListo = useRef(false);
  // "¿No eres tú?": desde ese toque no se guarda nada más. Al cerrarse la
  // sesión cuentaExistente pasa a false y el efecto de abajo volvía a escribir
  // el borrador, ahora CON el correo de la otra persona.
  const descartandoBorrador = useRef(false);
  // true desde que este mismo registro creó el negocio: el rol pasa a admin
  // antes de mostrar "¡Cuenta creada!" y no hay que redirigir por eso.
  const creadoAqui = useRef(false);

  // Cuenta existente: se fija con la sesión (correo verificado por el código, no el input).
  useEffect(() => {
    if (!cuentaExistente || !session?.user) return;
    createdUserId.current = session.user.id;
    correoCuenta.current = (session.user.email ?? "").toLowerCase();
    setEmail(session.user.email ?? "");
  }, [cuentaExistente, session?.user]);

  // Si al reanudar resulta que ya tiene negocio, no hay nada que terminar.
  useEffect(() => {
    if (reanudar === "1" && estado === "admin" && step !== 5 && !creadoAqui.current) router.replace("/(admin)/(tabs)");
  }, [reanudar, estado, step, router]);

  // Restaurar el borrador (solo lo que el usuario no haya tocado ya).
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(CLAVE_BORRADOR);
        if (!vivo || !raw) return;
        const b = JSON.parse(raw) as Borrador;
        if (b.bizType) setBizType(v => v || b.bizType!);
        if (b.businessName) setBusinessName(v => v || b.businessName!);
        if (b.collaborators) setCollaborators(v => v || b.collaborators!);
        if (b.appointments) setAppointments(v => v || b.appointments!);
        if (typeof b.multiSede === "boolean") setMultiSede(v => (v === null ? b.multiSede! : v));
        if (Array.isArray(b.goals) && b.goals.length) setGoals(v => (v.length ? v : b.goals!.slice(0, 3)));
        if (b.whatsapp) setWhatsapp(v => v || b.whatsapp!);
        if (b.email && !cuentaExistente) setEmail(v => v || b.email!);
        const p = PAISES_REGISTRO.find(x => x.code === b.pais);
        if (p) setPais(p);
      } catch {
        // Sin borrador (o ilegible): se empieza de cero.
      } finally {
        borradorListo.current = true;
      }
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Guardar el borrador en cada cambio (después de restaurarlo, para no pisarlo).
  useEffect(() => {
    if (!borradorListo.current || step === 5 || descartandoBorrador.current) return;
    const b: Borrador = { bizType, businessName, collaborators, appointments, multiSede, goals, whatsapp, pais: pais.code, email: cuentaExistente ? undefined : email };
    AsyncStorage.setItem(CLAVE_BORRADOR, JSON.stringify(b)).catch(() => {});
  }, [bizType, businessName, collaborators, appointments, multiSede, goals, whatsapp, pais, email, cuentaExistente, step]);

  useEffect(() => {
    if (reenvioEn <= 0) return;
    const id = setInterval(() => setReenvioEn(s => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(id);
  }, [reenvioEn]);

  /** Pide el código al portal. `nuevo: false` = el anterior todavía sirve. */
  const enviarCodigo = async (correo: string):
    Promise<{ ok: true; nuevo: boolean } | { ok: false; error: string }> => {
    const res = await postPortal(Config.api.sendOtp, { email: correo });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      // Un 429 cuando ya mandamos uno significa que el anterior sigue vivo:
      // no hay nada roto que contarle al usuario, solo que espere.
      if (res.status === 429 && otpEnviado.current) {
        setReenvioEn(60);
        return { ok: true, nuevo: false };
      }
      return { ok: false, error: d.error || "No se pudo enviar el código de verificación." };
    }
    otpEnviado.current = true;
    setReenvioEn(60);
    return { ok: true, nuevo: true };
  };

  const toggleGoal = (id: string) => {
    setGoals(prev =>
      prev.includes(id) ? prev.filter(g => g !== id) : prev.length < 3 ? [...prev, id] : prev
    );
  };

  const can1 = bizType !== "" && businessName.trim().length >= 2;
  const can2 = collaborators !== "" && appointments !== "" && multiSede !== null;
  const can3 = goals.length > 0;
  // El teléfono dejó de ser opcional: sin él el negocio es inalcanzable.
  const can4 = whatsapp.trim() !== "" && aceptaTerminos
    && (cuentaExistente || (email.trim() !== "" && password.trim() !== ""));

  const handleRegister = async () => {
    if (!aceptaTerminos) { setError("Para crear la cuenta acepta los Términos y la Política de privacidad."); return; }

    let correoValor: string;
    if (cuentaExistente) {
      correoValor = correoCuenta.current;
      if (!correoValor) { setError("Tu sesión no tiene correo. Cierra sesión y regístrate de nuevo."); return; }
    } else {
      const errPass = validarContrasena(password);
      if (errPass) { setError(errPass); return; }
      const correo = validarCorreo(email);
      if (!correo.ok) { setError(correo.error!); return; }
      correoValor = correo.valor!;
      // Si el signUp ya pasó, el correo de la cuenta quedó fijado en auth: dejar
      // seguir con otro crearía un negocio con un correo que nadie verificó.
      if (createdUserId.current && correoCuenta.current !== correoValor) {
        setError(`La cuenta ya se creó con ${correoCuenta.current}. Cierra el registro y empieza de nuevo para usar otro correo.`);
        return;
      }
    }

    // El país decide cómo se lee un número sin indicativo (AJU-13).
    const tel = validarTelefono(whatsapp, pais.code);
    if (!tel.ok) { setError(tel.error!); return; }
    telNormalizado.current = tel.valor!;

    setLoading(true);
    setError(null);
    setAviso(null);
    try {
      if (!cuentaExistente) {
        if (!createdUserId.current) {
          const { data: auth, error: ae } = await supabase.auth.signUp({ email: correoValor, password });
          if (ae) throw new Error(traducirErrorAuth(ae));
          const userId = auth.user?.id ?? null;
          if (!userId) throw new Error("No se pudo crear la cuenta. Inténtalo de nuevo.");
          createdUserId.current = userId;
          correoCuenta.current = correoValor;
          contrasenaCuenta.current = password;
        } else if (password !== contrasenaCuenta.current) {
          // Volvió atrás y corrigió la contraseña: la cuenta ya existe, así que
          // se actualiza (hay sesión desde el signUp).
          const { error: ue } = await supabase.auth.updateUser({ password });
          if (ue) throw new Error(traducirErrorAuth(ue));
          contrasenaCuenta.current = password;
        }
      }
      if (otpVerificadoPara.current === correoValor) {
        // El correo ya se verificó en un intento anterior: directo a crear el negocio.
        setVerifyMode(true);
        return;
      }
      // Mismo endpoint que usa el registro del portal: un solo sitio decide
      // cómo se ve el correo y cuánto dura el código.
      const envio = await enviarCodigo(correoValor);
      if (!envio.ok) throw new Error(envio.error);
      setVerifyMode(true);
    } catch (err: unknown) {
      setError(err instanceof Error && err.message ? err.message : traducirErrorAuth(err));
    } finally {
      setLoading(false);
    }
  };

  const handleReenviar = async () => {
    setError(null);
    setAviso(null);
    try {
      const envio = await enviarCodigo(correoCuenta.current);
      if (!envio.ok) { setError(envio.error); return; }
      setAviso(envio.nuevo
        ? "Te enviamos un código nuevo."
        : "El código anterior sigue vigente. Revisa tu correo y el spam.");
    } catch {
      setError("Sin conexión. Revisa tu internet e inténtalo de nuevo.");
    }
  };

  /**
   * Primer slug libre según la reserva pública (get_public_tenant). Si no se
   * puede consultar, se usa el candidato y el insert reintenta ante un choque.
   */
  const buscarSlugLibre = async (base: string): Promise<{ slug: string; intento: number }> => {
    for (let intento = 0; intento < 5; intento++) {
      const candidato = slugConSufijo(base, intento);
      const { data, error: e } = await supabase.rpc("get_public_tenant", { p_slug: candidato });
      if (e) return { slug: candidato, intento };
      const filas = Array.isArray(data) ? data : data ? [data] : [];
      if (filas.length === 0) return { slug: candidato, intento };
    }
    return { slug: slugConSufijo(base, 5), intento: 5 };
  };

  /** Crea el negocio (o reutiliza el que ya exista de un intento cortado a medias). */
  const crearNegocio = async (userId: string): Promise<string> => {
    // Si un intento anterior sí creó el negocio pero se perdió la respuesta,
    // reintentar crearía un segundo negocio para el mismo dueño.
    const previo = await supabase.from("tenants").select("id").eq("owner_id", userId)
      .order("created_at", { ascending: true }).limit(1);
    if (previo.error) throw new ErrorDB(previo.error, "No pudimos revisar tu cuenta");
    if (previo.data && previo.data.length > 0) return previo.data[0].id as string;

    const base = crearSlug(businessName);
    let { slug, intento } = await buscarSlugLibre(base);
    const zona = zonaParaPais(pais, zonaTelefono);
    for (let vuelta = 0; vuelta < 6; vuelta++) {
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
          owner_id: userId, name: businessName.trim(), slug,
          phone: telNormalizado.current,
          settings: {
            logo: "", coverImage: "", primaryColor: "#2563EB",
            depositAmount: 0, requireDeposit: false,
            biz_type: bizType,
            // País, moneda, idioma y zona como el registro del portal: sin
            // esto todo negocio nacía colombiano y un spa de Madrid contaba los
            // cobros de la madrugada en el día anterior (AJU-13).
            country: pais.code,
            currency: pais.currency,
            locale: pais.locale,
            timezone: zona,
            // El trigger tenants_exigir_contacto rechaza el insert si faltan.
            owner_email: correoCuenta.current,
            owner_phone: telNormalizado.current,
            // Horario y cupos desde el día uno (AGE-04): el dueño los ajusta
            // en Ajustes → Horario de atención.
            schedule: horarioInicial(),
            slot_interval_min: DEFAULT_SLOT_INTERVAL,
            onboarding: {
              collaborators,
              appointments_per_day: appointments,
              multi_sede: multiSede,
              goals,
            },
          },
        }])
        .select("id").single();
      if (!te && td?.id) return td.id as string;
      const texto = `${te?.message ?? ""} ${te?.details ?? ""}`;
      if (te?.code === "23505" && /slug/i.test(texto)) {
        // El nombre no tiene por qué ser único; el link sí: otro sufijo.
        intento += 1;
        slug = slugConSufijo(base, intento);
        continue;
      }
      throw new ErrorDB(te, "No se pudo crear tu negocio");
    }
    throw new Error("No encontramos un link libre para tu negocio. Cambia un poco el nombre e inténtalo de nuevo.");
  };

  /** Registro auditable de la aceptación de los Términos, igual que el portal. */
  const registrarTerminos = async (tenantId: string, userId: string) => {
    for (let i = 0; i < 2; i++) {
      try {
        const res = await postPortal(Config.api.acceptTerms, { tenantId, userId, document: "terms", version: TERMS_VERSION });
        if (res.ok) return;
      } catch { /* se reintenta una vez */ }
      await esperar(1500);
    }
  };

  /**
   * Prueba gratis. La crea el MISMO endpoint que usa el registro del portal,
   * así que los días de prueba (14) y el estado inicial salen de una sola
   * fuente y el cron de facturación del web ve la cuenta desde el día uno.
   * Sin esta llamada el negocio nace sin fila en saas_subscriptions: invisible
   * para el cron y con una prueba que no vence nunca.
   *
   * Antes nadie miraba la respuesta: un 429 (5 altas por minuto por IP, fácil
   * detrás del CGNAT del operador) o un 500 dejaba el negocio sin suscripción
   * y sin que nadie se enterara (AJU-11 / SEG-09). Ahora se reintenta y, si
   * sigue fallando, se deja constancia en tenants.settings.trial_pendiente
   * para que soporte (y el cron del portal) lo encuentren.
   *
   * El plan va explícito: la prueba que se abre desde la app es siempre Growth.
   * Starter (hasta 2 colaboradores, sin Hanna) volvió a la oferta web el
   * 2026-10-05; desde la app no se elige plan (la app no vende ni muestra planes).
   */
  const activarPrueba = async (tenantId: string): Promise<boolean> => {
    let planId: string | null = null;
    let motivo = "";
    for (let i = 0; i < 2 && !planId; i++) {
      const { data: plan, error: pe } = await supabase
        .from("saas_plans").select("id")
        .eq("name", "Growth").eq("active", true).maybeSingle();
      if (!pe && plan?.id) planId = plan.id as string;
      else if (!pe) { motivo = "plan Growth no encontrado"; break; }
      else { motivo = mensajeError(pe); await esperar(1000); }
    }

    if (planId) {
      for (const espera of [0, 2000, 5000]) {
        if (espera) await esperar(espera);
        try {
          const res = await postPortal(Config.api.activateTrial, { tenantId, planId });
          // 409 = ya tenía suscripción (un intento anterior sí llegó).
          if (res.ok || res.status === 409) return true;
          motivo = `HTTP ${res.status}`;
          if (res.status === 400 || res.status === 404) break;   // reintentar no cambia nada
        } catch (e) {
          motivo = mensajeError(e);
        }
      }
    }

    await patchTenantSettings(tenantId, {
      trial_pendiente: { desde: new Date().toISOString(), motivo: motivo || "desconocido", origen: "app" },
    }).catch(() => {});
    return false;
  };

  /** Comprueba el código y, solo entonces, crea el negocio. */
  const handleVerify = async () => {
    setOtpLoading(true);
    setError(null);
    try {
      const correo = correoCuenta.current;
      if (otpVerificadoPara.current !== correo) {
        const vr = await postPortal(Config.api.verifyOtp, { email: correo, code: otpCode.trim() });
        if (!vr.ok) {
          const d = await vr.json().catch(() => ({}));
          throw new Error(d.error || "Código incorrecto.");
        }
        otpVerificadoPara.current = correo;
      }

      const userId = createdUserId.current;
      if (!userId) throw new Error("Se perdió la sesión del registro. Vuelve a empezar.");
      const tenantId = await crearNegocio(userId);
      creadoAqui.current = true;

      await Promise.all([
        registrarTerminos(tenantId, userId),
        activarPrueba(tenantId),
      ]);

      // El SIGNED_IN del signUp resolvió el rol cuando el negocio todavía no
      // existía, así que quedó en null. Sin volver a resolverlo, el guard de
      // (admin) rebota al login al tocar "Ir a mi panel".
      await refreshRole();
      await AsyncStorage.removeItem(CLAVE_BORRADOR).catch(() => {});
      setVerifyMode(false);
      setAviso(null);
      setStep(5);
    } catch (err: unknown) {
      setError(err instanceof Error && err.message ? err.message : mensajeError(err));
    } finally {
      setOtpLoading(false);
    }
  };

  const abrir = (url: string) => { Linking.openURL(url).catch(() => {}); };

  /**
   * "¿No eres tú?": la cuenta abierta es de otra persona. Su borrador (nombre
   * del negocio, WhatsApp) no debe quedar en el teléfono para el próximo que
   * se registre.
   */
  const noSoyYo = async () => {
    descartandoBorrador.current = true;
    await AsyncStorage.removeItem(CLAVE_BORRADOR).catch(() => {});
    await cerrarSesion();
  };

  const progress = Math.min((step - 1) / 4, 1);
  const verificado = otpVerificadoPara.current !== null && otpVerificadoPara.current === correoCuenta.current;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      {/* ── Header ── */}
      <LinearGradient colors={Gradients.ink} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={c.header}>
        <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, zIndex: 1 }} />
        <View style={c.headerBlob1} />
        <View style={c.headerBlob2} />
        <View style={{ position: "relative", zIndex: 1 }}>
          <Text style={c.headerLogo}>Z</Text>
          <Text style={c.headerTitle} accessibilityRole="header">
            {step === 1 ? (cuentaExistente ? "Termina tu registro" : "Tu negocio") : step === 2 ? "Tu operación" : step === 3 ? "Tus retos" : step === 4 ? "Tu cuenta" : "¡Listo!"}
          </Text>
          <Text style={c.headerSub}>
            {step === 1 ? (cuentaExistente ? "Tu cuenta ya existe: faltan los datos del negocio" : "Cuéntanos sobre lo que haces") : step === 2 ? "¿Cómo trabajas día a día?" : step === 3 ? "¿Qué quieres mejorar?" : step === 4 ? "Un paso más para empezar" : "Cuenta creada con éxito"}
          </Text>
        </View>
        {/* Progress bar */}
        <View style={c.progressTrack}>
          <Animated.View style={[c.progressFill, { width: `${progress * 100}%` as `${number}%` }]} />
        </View>
      </LinearGradient>

      {/* ── Body ── */}
      <ScrollView style={[{ flex: 1 }, tc.fondo]}
        contentContainerStyle={{ padding: 24, paddingBottom: 60 }}
        keyboardShouldPersistTaps="handled">

        {/* STEP 1 */}
        {step === 1 && (
          <Animated.View entering={FadeInRight.duration(300)}>
            {cuentaExistente && (
              <View style={[c.avisoBox, { marginBottom: 18 }]}>
                <Text style={c.avisoText}>
                  Entraste como {session?.user?.email}. Completa estos pasos y verifica tu correo para crear tu negocio.
                </Text>
              </View>
            )}
            <Text style={[c.stepLabel, tc.etiqueta]}>Tipo de negocio</Text>
            <View style={c.bizGrid}>
              {BIZ_TYPES.map(b => (
                <TouchableOpacity key={b.id}
                  style={[c.bizCard, tc.tarjeta, bizType === b.id && c.bizCardActive]}
                  onPress={() => setBizType(b.id)} activeOpacity={0.8}
                  accessibilityRole="radio" accessibilityState={{ checked: bizType === b.id }} accessibilityLabel={b.label}>
                  <Text style={c.bizEmoji}>{b.emoji}</Text>
                  <Text style={[c.bizLabel, tc.tarjetaTxt, bizType === b.id && c.bizLabelActive]}>{b.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={[c.stepLabel, tc.etiqueta, { marginTop: 20 }]}>Nombre de tu negocio</Text>
            <TextInput style={[c.input, tc.input]} placeholder="Ej: Black Fade Barbershop"
              placeholderTextColor={t.subtle} value={businessName}
              onChangeText={setBusinessName} accessibilityLabel="Nombre de tu negocio" maxLength={80} />
            <GradientBtn label="Continuar →" onPress={() => setStep(2)} disabled={!can1} />
            {cuentaExistente ? (
              <TouchableOpacity style={{ alignItems: "center", marginTop: 20, paddingVertical: 6 }} onPress={noSoyYo} accessibilityRole="button">
                <Text style={[{ fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold" }, tc.texto]}>
                  ¿No eres tú? <Text style={{ color: Colors.red, fontFamily: "SpaceGrotesk_700Bold" }}>Cerrar sesión</Text>
                </Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={{ alignItems: "center", marginTop: 20, paddingVertical: 6 }} onPress={() => router.back()} accessibilityRole="button">
                <Text style={[{ fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold" }, tc.texto]}>
                  ¿Ya tienes cuenta? <Text style={{ color: Colors.red, fontFamily: "SpaceGrotesk_700Bold" }}>Inicia sesión</Text>
                </Text>
              </TouchableOpacity>
            )}
          </Animated.View>
        )}

        {/* STEP 2 */}
        {step === 2 && (
          <Animated.View entering={FadeInRight.duration(300)}>
            <Text style={[c.stepLabel, tc.etiqueta]}>¿Cuántas personas trabajan contigo?</Text>
            <View style={c.opGrid}>
              {COLLAB_OPTS.map(o => (
                <SelectCard key={o.id} emoji={o.icon} label={o.label}
                  active={collaborators === o.id} onPress={() => setCollaborators(o.id)} />
              ))}
            </View>
            <Text style={[c.stepLabel, tc.etiqueta, { marginTop: 22 }]}>¿Cuántas citas atiendes por día?</Text>
            <View style={c.opGrid}>
              {APPT_OPTS.map(o => (
                <SelectCard key={o.id} emoji={o.icon} label={o.label}
                  active={appointments === o.id} onPress={() => setAppointments(o.id)} />
              ))}
            </View>
            <Text style={[c.stepLabel, tc.etiqueta, { marginTop: 22 }]}>¿Tienes más de una sede?</Text>
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
            <Text style={[c.stepLabel, tc.etiqueta]}>¿Qué quieres mejorar? (máx. 3)</Text>
            <View style={c.goalGrid}>
              {GOALS.map(g => {
                const on = goals.includes(g.id);
                const disabled = !on && goals.length >= 3;
                return (
                  <TouchableOpacity key={g.id}
                    style={[c.goalChip, tc.tarjeta, on && c.goalChipActive, disabled && { opacity: 0.4 }]}
                    onPress={() => toggleGoal(g.id)} activeOpacity={0.8} disabled={disabled}
                    accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled }} accessibilityLabel={g.label}>
                    <Text style={{ fontSize: 15 }}>{g.emoji}</Text>
                    <Text style={[c.goalText, tc.tarjetaTxt, on && c.goalTextActive]}>{g.label}</Text>
                    {on && <Text style={c.goalCheck}>✓</Text>}
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={[{ textAlign: "center", fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", marginTop: 12 }, tc.sutil]}>
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
        {step === 4 && !verifyMode && (
          <Animated.View entering={FadeInRight.duration(300)}>
            {error && (
              <View style={c.errorBox} accessibilityRole="alert">
                <Text style={c.errorText}>⚠ {error}</Text>
              </View>
            )}

            <Text style={[c.stepLabel, tc.etiqueta]}>País de tu negocio</Text>
            <TouchableOpacity
              style={[c.input, tc.input, c.paisRow]} onPress={() => setPaisOpen(true)} activeOpacity={0.75}
              accessibilityRole="button" accessibilityLabel={`País: ${pais.name}. Cambiar`}>
              <Text style={{ fontSize: 18 }}>{banderaDe(pais.code)}</Text>
              <Text style={[c.paisTxt, { color: t.text }]}>{pais.name}</Text>
              <Text style={[c.paisMoneda, tc.sutil]}>{pais.currency}</Text>
              <Ionicons name="chevron-down" size={15} color={t.subtle} />
            </TouchableOpacity>
            <Text style={[c.ayudaCampo, tc.sutil]}>
              Define la moneda, la zona horaria y cómo leemos los teléfonos. Puedes cambiar la zona después en Ajustes.
            </Text>

            <Text style={[c.stepLabel, tc.etiqueta]}>Correo electrónico</Text>
            <TextInput style={[c.input, tc.input, cuentaExistente && { color: t.muted }]} placeholder="tu@correo.com"
              placeholderTextColor={t.subtle} keyboardType="email-address"
              autoCapitalize="none" autoCorrect={false} autoComplete="email"
              editable={!cuentaExistente}
              value={email} onChangeText={setEmail} accessibilityLabel="Correo electrónico" />

            <Text style={[c.stepLabel, tc.etiqueta]}>WhatsApp o teléfono</Text>
            <TextInput style={[c.input, tc.input]} placeholder={pais.code === "CO" ? "+57 300 123 4567" : "Con indicativo, ej: +52 55 1234 5678"}
              placeholderTextColor={t.subtle} keyboardType="phone-pad"
              value={whatsapp} onChangeText={setWhatsapp} accessibilityLabel="WhatsApp o teléfono" />
            <Text style={[c.ayudaCampo, tc.sutil]}>
              Si el número es de otro país, escríbelo con indicativo (ej: +34 612 34 56 78).
            </Text>

            {!cuentaExistente && (
              <>
                <Text style={[c.stepLabel, tc.etiqueta]}>Contraseña</Text>
                <TextInput style={[c.input, tc.input]} placeholder={AYUDA_CONTRASENA}
                  placeholderTextColor={t.subtle} secureTextEntry autoCapitalize="none"
                  autoComplete="new-password" textContentType="newPassword"
                  value={password} onChangeText={setPassword} accessibilityLabel="Contraseña" />
              </>
            )}

            {/* Apple 5.1.1(i) y constancia legal igual que el portal (legal_acceptances). */}
            <Pressable
              style={c.terminosRow}
              onPress={() => { setAceptaTerminos(v => !v); setError(null); }}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: aceptaTerminos }}
              accessibilityLabel="Acepto los Términos y condiciones y la Política de privacidad">
              <View style={[c.check, { borderColor: aceptaTerminos ? Colors.red : t.lineStrong, backgroundColor: aceptaTerminos ? Colors.red : "transparent" }]}>
                {aceptaTerminos && <Ionicons name="checkmark" size={14} color="white" />}
              </View>
              <Text style={[c.terminosTxt, tc.texto]}>
                Acepto los{" "}
                <Text style={c.enlace} onPress={() => abrir(Config.urls.terminos)} accessibilityRole="link">Términos y condiciones</Text>
                {" "}y la{" "}
                <Text style={c.enlace} onPress={() => abrir(Config.urls.privacidad)} accessibilityRole="link">Política de privacidad</Text>.
              </Text>
            </Pressable>

            <View style={c.btnRow}>
              <BackBtn onPress={() => setStep(3)} />
              <View style={{ flex: 1 }}>
                <GradientBtn label={loading ? "Un momento…" : cuentaExistente ? "Continuar →" : "Crear cuenta →"}
                  onPress={handleRegister} disabled={!can4 || loading} />
              </View>
            </View>
          </Animated.View>
        )}

        {/* STEP 4b — Verificación del correo. El negocio aún NO existe: se crea
            al validar el código, para que ningún alta quede con un correo que
            no puede recibir nada. */}
        {step === 4 && verifyMode && (
          <Animated.View entering={FadeInRight.duration(300)}>
            {error && (
              <View style={c.errorBox} accessibilityRole="alert">
                <Text style={c.errorText}>⚠ {error}</Text>
              </View>
            )}
            {aviso && (
              <View style={c.avisoBox}>
                <Text style={c.avisoText}>✓ {aviso}</Text>
              </View>
            )}
            {verificado ? (
              <>
                <Text style={[c.stepLabel, tc.etiqueta]}>Correo verificado</Text>
                <Text style={[{ fontFamily: "SpaceGrotesk_400Regular", marginBottom: 14 }, tc.sutil]}>
                  Ya confirmamos {correoCuenta.current}. Toca el botón para terminar de crear tu negocio.
                </Text>
              </>
            ) : (
              <>
                <Text style={[c.stepLabel, tc.etiqueta]}>Revisa tu correo</Text>
                <Text style={[{ fontFamily: "SpaceGrotesk_400Regular", marginBottom: 14 }, tc.sutil]}>
                  Enviamos un código de 6 dígitos a {correoCuenta.current}. Si no lo ves, mira en spam.
                </Text>
                <TextInput
                  style={[c.input, tc.input, { fontSize: 24, letterSpacing: 8, textAlign: "center" }]}
                  placeholder="000000"
                  placeholderTextColor={t.subtle}
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={otpCode}
                  onChangeText={v => { setOtpCode(v.replace(/\D/g, "")); setError(null); }}
                  accessibilityLabel="Código de verificación"
                />
              </>
            )}
            <View style={c.btnRow}>
              <BackBtn onPress={() => { setVerifyMode(false); setOtpCode(""); setError(null); setAviso(null); }} />
              <View style={{ flex: 1 }}>
                <GradientBtn
                  label={otpLoading ? "Creando tu negocio…" : verificado ? "Crear mi negocio →" : "Verificar y crear →"}
                  onPress={handleVerify}
                  disabled={(!verificado && otpCode.length !== 6) || otpLoading}
                />
              </View>
            </View>
            {/* El portal solo manda un código por minuto y por correo: mientras
                corre la cuenta atrás el enlace se apaga en vez de dar un 429. */}
            {!verificado && (
              <TouchableOpacity
                onPress={handleReenviar}
                disabled={reenvioEn > 0 || otpLoading}
                style={{ marginTop: 18, alignSelf: "center", paddingVertical: 6 }}
                accessibilityRole="button">
                <Text style={[c.reenviarText, tc.sutil]}>
                  ¿No llegó el código?{" "}
                  <Text style={{ color: reenvioEn > 0 ? t.subtle : Colors.blue, fontFamily: "SpaceGrotesk_700Bold" }}>
                    {reenvioEn > 0 ? `Reenviar en ${reenvioEn}s` : "Reenviar"}
                  </Text>
                </Text>
              </TouchableOpacity>
            )}
          </Animated.View>
        )}

        {/* STEP 5 — Cuenta creada */}
        {step === 5 && (
          <Animated.View entering={FadeInDown.duration(500).springify()} style={{ alignItems: "center" }}>
            <Text style={{ fontSize: 56, marginBottom: 16 }}>🎉</Text>
            <Text style={[c.stepLabel, tc.etiqueta, { fontSize: 22, textAlign: "center", marginBottom: 6 }]}>¡Cuenta creada!</Text>
            <Text style={[{ fontSize: 14, textAlign: "center", fontFamily: "SpaceGrotesk_400Regular", marginBottom: 28 }, tc.texto]}>
              Ya puedes configurar {businessName.trim()}: tu agenda, tus servicios y tu equipo.
            </Text>
            <View style={{ width: "100%" }}>
              <GradientBtn label="Ir a mi panel →" onPress={() => router.replace("/(admin)/(tabs)")} />
            </View>
          </Animated.View>
        )}
      </ScrollView>

      {/* Selector de país */}
      <Modal visible={paisOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPaisOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
          <View style={[c.modalHead, { borderBottomColor: t.line }]}>
            <Text style={[c.modalTitle, { color: t.text }]} accessibilityRole="header">País de tu negocio</Text>
            <TouchableOpacity onPress={() => setPaisOpen(false)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cerrar">
              <Ionicons name="close" size={22} color={t.text} />
            </TouchableOpacity>
          </View>
          <FlatList
            data={PAISES_REGISTRO}
            keyExtractor={p => p.code}
            contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
            renderItem={({ item }) => {
              const activo = item.code === pais.code;
              return (
                <TouchableOpacity
                  style={[c.paisOpcion, { backgroundColor: t.card, borderColor: activo ? Colors.red : t.border }]}
                  onPress={() => { setPais(item); setPaisOpen(false); }}
                  activeOpacity={0.75}
                  accessibilityRole="radio" accessibilityState={{ checked: activo }} accessibilityLabel={item.name}>
                  <Text style={{ fontSize: 20 }}>{banderaDe(item.code)}</Text>
                  <Text style={[c.paisTxt, { color: t.text }]}>{item.name}</Text>
                  <Text style={[c.paisMoneda, { color: t.subtle }]}>{item.currency}</Text>
                  {activo && <Ionicons name="checkmark-circle" size={18} color={Colors.red} />}
                </TouchableOpacity>
              );
            }}
          />
        </SafeAreaView>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
// Solo forma y colores de marca: los de superficie y texto salen del tema
// (coloresRegistro / useTheme), para que el registro se lea en modo oscuro.

const c = StyleSheet.create({
  header: { paddingTop: 60, paddingHorizontal: 24, paddingBottom: 24, overflow: "hidden" },
  headerBlob1: { position: "absolute", width: 180, height: 180, borderRadius: 90, backgroundColor: "rgba(255,255,255,.1)", top: -60, right: -40 },
  headerBlob2: { position: "absolute", width: 120, height: 120, borderRadius: 60, backgroundColor: "rgba(0,0,0,.08)", bottom: -30, left: -20 },
  headerLogo: { fontSize: 28, fontFamily: "SpaceGrotesk_700Bold", color: "white", marginBottom: 4 },
  headerTitle: { fontSize: 22, fontFamily: "SpaceGrotesk_700Bold", color: "white", letterSpacing: -0.5 },
  headerSub: { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", color: "rgba(255,255,255,.75)", marginTop: 2 },
  progressTrack: { height: 4, backgroundColor: "rgba(255,255,255,.25)", borderRadius: 4, marginTop: 20 },
  progressFill: { height: 4, backgroundColor: "white", borderRadius: 4 },
  stepLabel: { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", marginBottom: 12 },
  input: {
    borderWidth: 1.5, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 13,
    fontSize: 14, fontFamily: "SpaceGrotesk_400Regular", marginBottom: 18,
  },
  gradBtn: { borderRadius: Radius.md, paddingVertical: 16, alignItems: "center", backgroundColor: Colors.red },
  gradBtnText: { color: "white", fontSize: 15, fontFamily: "SpaceGrotesk_700Bold" },
  backBtn: { borderWidth: 1.5, borderRadius: Radius.md, paddingVertical: 16, paddingHorizontal: 18, justifyContent: "center" },
  backBtnText: { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold" },
  btnRow: { flexDirection: "row", gap: 12, marginTop: 24, alignItems: "stretch" },
  bizGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  bizCard: {
    width: "22%", aspectRatio: 0.9,
    borderWidth: 1.5, borderRadius: Radius.md,
    alignItems: "center", justifyContent: "center", gap: 4,
  },
  bizCardActive: { borderColor: Colors.red, backgroundColor: "rgba(251,15,5,.07)" },
  bizEmoji: { fontSize: 22 },
  bizLabel: { fontSize: 10, fontFamily: "SpaceGrotesk_600SemiBold", textAlign: "center" },
  bizLabelActive: { color: Colors.red },
  opGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  selCard: {
    flex: 1, minWidth: "45%",
    borderWidth: 1.5, borderRadius: Radius.md,
    paddingVertical: 14, paddingHorizontal: 12,
    flexDirection: "row", alignItems: "center", gap: 8,
  },
  selCardActive: { borderColor: Colors.red, backgroundColor: "rgba(251,15,5,.07)" },
  selEmoji: { fontSize: 18 },
  selLabel: { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", flex: 1 },
  selLabelActive: { color: Colors.red },
  goalGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  goalChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    borderWidth: 1.5, borderRadius: Radius.full, paddingVertical: 9, paddingHorizontal: 14,
  },
  goalChipActive: { borderColor: Colors.red, backgroundColor: "rgba(251,15,5,.08)" },
  goalText: { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold" },
  goalTextActive: { color: Colors.red },
  goalCheck: { fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", color: Colors.red },
  // Translúcidos: se leen igual sobre el fondo claro y el oscuro.
  errorBox: { backgroundColor: "rgba(251,15,5,.1)", borderWidth: 1, borderColor: "rgba(251,15,5,.3)", borderRadius: Radius.md, padding: 12, marginBottom: 16 },
  errorText: { color: "#e5332b", fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold" },
  avisoBox: { backgroundColor: "rgba(16,185,129,.1)", borderWidth: 1, borderColor: "rgba(16,185,129,.3)", borderRadius: Radius.md, padding: 12, marginBottom: 16 },
  avisoText: { color: "#10a877", fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", lineHeight: 18 },
  reenviarText: { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular" },
  ayudaCampo: { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", marginTop: -8, marginBottom: 14, lineHeight: 17 },
  paisRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  paisTxt: { flex: 1, fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold" },
  paisMoneda: { fontSize: 12, fontFamily: "JetBrainsMono_500Medium" },
  paisOpcion: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1.5, borderRadius: Radius.md, padding: 14, marginBottom: 8 },
  modalHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1 },
  modalTitle: { fontSize: 17, fontFamily: "SpaceGrotesk_700Bold" },
  terminosRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginTop: 4, paddingVertical: 6 },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: "center", justifyContent: "center", marginTop: 1 },
  terminosTxt: { flex: 1, fontSize: 13, lineHeight: 19, fontFamily: "SpaceGrotesk_400Regular" },
  enlace: { color: Colors.red, fontFamily: "SpaceGrotesk_600SemiBold", textDecorationLine: "underline" },
});
