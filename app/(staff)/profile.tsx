import { useMemo, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, ActivityIndicator,
  Linking, RefreshControl,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { Config, authedFetch } from "@/lib/config";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { Colors, Fonts, Gradients, Radius, Shadow } from "@/constants/theme";
import { useTheme, type ThemeColors } from "@/lib/theme";
import { ErrorDB, mensajeError, revisar } from "@/lib/db";
import { AVISO_ELIMINAR_CUENTA_EQUIPO, estadoServidorCuentas } from "@/lib/cuenta";
import { useGuardRespuestas, useRecarga } from "@/lib/useRecarga";
import { colorDeProfesional } from "@/lib/comisiones";
import ErrorState from "@/components/ErrorState";
import MiNomina from "@/components/nomina/MiNomina";
import { ListRow } from "@/components/ui";

// Apple 5.1.1(i): la política de privacidad tiene que poder abrirse desde la
// app, también para el equipo (AJU-10). Mismas filas que Ajustes del dueño.
const LEGALES = [
  { icon: "shield-checkmark-outline", label: "Política de privacidad", url: Config.urls.privacidad },
  { icon: "document-text-outline",    label: "Términos y condiciones", url: Config.urls.terminos },
] as const;

function abrirEnlace(url: string) {
  Linking.openURL(url).catch(() => Alert.alert("No se pudo abrir el enlace", `Ábrelo en tu navegador: ${url}`));
}

// professionals no tiene columna color (ESQ-09): pedirla hacía fallar la
// consulta y el perfil se quedaba en "..." para siempre.
type StaffInfo = { id: string; name: string; role: string | null; email: string | null };

/**
 * La migración que agrega mi_negocio() es la que evita que borrar la cuenta
 * de un colaborador arrastre las citas del negocio. Si la RPC aún no existe,
 * eso tampoco (D18: funcionar antes y después de la migración). Tres estados,
 * compartidos con AccountBlocked: ver lib/cuenta.ts.
 */
const estadoServidor = estadoServidorCuentas;

export default function StaffProfileScreen() {
  const { user, tenantId, professionalId, cerrarSesion } = useAuth();
  const { t } = useTheme();
  const s = useMemo(() => crearEstilos(t), [t]);
  const { tenant, timezone, ready } = useTenant();
  const guard = useGuardRespuestas();
  const [info, setInfo] = useState<StaffInfo | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Sube al deslizar para refrescar: Mi nómina se recarga con el perfil.
  const [versionNomina, setVersionNomina] = useState(0);
  const [borrando, setBorrando] = useState(false);
  const [saliendo, setSaliendo] = useState(false);

  const { recargar } = useRecarga(async () => {
    if (!user || !tenantId) return;
    const turno = guard.nuevo();
    try {
      // El tenant sale de useAuth (el embed tenants(...) vuelve null para el
      // staff por RLS y dejaba tenant_id = "": ESQ-16).
      let proQ = supabase.from("professionals").select("id, name, role, email");
      proQ = professionalId ? proQ.eq("id", professionalId) : proQ.eq("user_id", user.id).eq("tenant_id", tenantId);
      const pro = (revisar(await proQ.limit(1), "No se pudo cargar tu perfil") ?? [])[0] as StaffInfo | undefined;
      if (!pro) throw new ErrorDB({ code: "PGRST116", message: "" }, "No se encontró tu perfil en el negocio");
      if (!turno.vigente()) return;
      setInfo({ ...pro, email: pro.email ?? user.email ?? null });
      setError(null);
    } catch (e) {
      if (turno.vigente()) setError(e);
    }
  }, [user?.id, tenantId, professionalId, timezone], {
    timeZone: timezone,
    habilitado: !!user && !!tenantId && ready,
    alCambiarSede: false,
  });

  const onRefresh = async () => {
    setRefreshing(true);
    setVersionNomina(v => v + 1);
    await recargar();
    setRefreshing(false);
  };

  const handleLogout = () => {
    Alert.alert("Cerrar sesión", "¿Seguro que quieres salir?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Salir", style: "destructive", onPress: async () => {
          // cerrarSesion funciona sin red, cancela las notificaciones de este
          // teléfono y lleva al login.
          setSaliendo(true);
          try { await cerrarSesion(); } finally { setSaliendo(false); }
        },
      },
    ]);
  };

  const borrarCuenta = async () => {
    setBorrando(true);
    try {
      const res = await authedFetch(Config.edgeFunctions.deleteAccount, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { error?: string }));
        throw new Error(body.error || "No se pudo eliminar la cuenta.");
      }
      await cerrarSesion();
    } catch (e) {
      Alert.alert("No se eliminó la cuenta", e instanceof Error && e.message ? e.message : mensajeError(e));
    } finally {
      setBorrando(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (borrando) return;
    setBorrando(true);
    const servidor = await estadoServidor().finally(() => setBorrando(false));
    if (servidor.estado === "desconocido") {
      // No se pudo confirmar que el servidor ya protege el historial: no se
      // arriesga el borrado en cascada por un corte de red.
      Alert.alert("No se pudo continuar", mensajeError(servidor.error, "No pudimos verificar tu cuenta"));
      return;
    }
    if (servidor.estado === "pendiente") {
      // Sin la migración, el servidor borra la fila del profesional y con ella,
      // en cascada, todas sus citas y liquidaciones del negocio (SEG-02 /
      // AJU-03 / ESQ-02). Mientras tanto se atiende a mano.
      Alert.alert(
        "Eliminar cuenta",
        AVISO_ELIMINAR_CUENTA_EQUIPO,
        [
          { text: "Cancelar", style: "cancel" },
          { text: "Ir a soporte", onPress: () => { Linking.openURL(Config.urls.soporte).catch(() => Alert.alert("No se pudo abrir el enlace", Config.urls.soporte)); } },
        ],
      );
      return;
    }
    Alert.alert(
      "Eliminar cuenta",
      "Se eliminará tu usuario de Zyncra y ya no podrás entrar a este negocio. Tus citas y comisiones se quedan en el negocio, porque le pertenecen. Esta acción no se puede deshacer.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Continuar", style: "destructive",
          onPress: () => {
            Alert.alert(
              "¿Confirmas la eliminación?",
              "Esta es tu última oportunidad para cancelar.",
              [
                { text: "Cancelar", style: "cancel" },
                { text: "Eliminar cuenta", style: "destructive", onPress: borrarCuenta },
              ],
            );
          },
        },
      ],
    );
  };

  const initials = info
    ? info.name.split(" ").map(w => w[0]).filter(Boolean).join("").slice(0, 2).toUpperCase() || "?"
    : "?";
  const avatarColor = info ? colorDeProfesional(info.id) : Colors.red;
  const tenantName = tenant?.name ?? "Tu negocio";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      {/* Header */}
      <LinearGradient colors={Gradients.ink} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.header}>
        <LinearGradient colors={Gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, zIndex: 1 }} />
        <View style={s.headerBlob} />
        <Animated.View entering={FadeInDown.duration(400)} style={{ alignItems: "center", position: "relative", zIndex: 1 }}>
          <View style={[s.avatarRing, { borderColor: avatarColor + "60" }]}>
            <View style={[s.avatarInner, { backgroundColor: avatarColor }]}>
              <Text style={s.avatarText}>{initials}</Text>
            </View>
          </View>
          <Text style={s.name}>{info?.name ?? (error ? "Tu perfil" : "...")}</Text>
          <Text style={s.role}>{info?.role ?? ""}</Text>
          <View style={s.businessPill}>
            <Ionicons name="business-outline" size={12} color="rgba(255,255,255,.8)" />
            <Text style={s.businessText}>{tenantName}</Text>
          </View>
        </Animated.View>
      </LinearGradient>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.red} />}
      >
        {error && !info ? (
          // Antes un fallo dejaba el nombre en "..." y el spinner girando sin fin.
          <View style={{ minHeight: 260 }}>
            <ErrorState error={error} onRetry={recargar} />
          </View>
        ) : tenantId && ready ? (
          // Mi nómina: la calcula el servidor (/api/nomina), igual que el panel
          // web del dueño. Antes aquí se calculaba una comisión local que no
          // coincidía con la del negocio. Espera a `ready`: los periodos van
          // en la zona del negocio.
          <Animated.View entering={FadeInDown.delay(80).duration(400)}>
            <Text style={s.sectionLabel}>Mi nómina</Text>
            <MiNomina tenantId={tenantId} timezone={timezone} version={versionNomina} />
          </Animated.View>
        ) : null}

        {/* Info de cuenta */}
        <Animated.View entering={FadeInDown.delay(200).duration(400)} style={{ marginTop: 20 }}>
          <Text style={s.sectionLabel}>Cuenta</Text>
          <View style={[s.card, Shadow.sm]}>
            <View style={s.infoRow}>
              <View style={s.infoIcon}><Ionicons name="mail-outline" size={16} color={t.muted} /></View>
              <View style={{ flex: 1 }}>
                <Text style={s.infoLabel}>Correo electrónico</Text>
                <Text style={s.infoValue}>{info?.email ?? user?.email ?? "—"}</Text>
              </View>
            </View>
            <View style={s.divider} />
            <View style={s.infoRow}>
              <View style={s.infoIcon}><Ionicons name="briefcase-outline" size={16} color={t.muted} /></View>
              <View style={{ flex: 1 }}>
                <Text style={s.infoLabel}>Cargo</Text>
                <Text style={s.infoValue}>{info?.role || "—"}</Text>
              </View>
            </View>
          </View>
        </Animated.View>

        {/* Legal */}
        <Animated.View entering={FadeInDown.delay(230).duration(400)} style={{ marginTop: 20 }}>
          <Text style={s.sectionLabel}>Legal</Text>
          <View style={[s.card, Shadow.sm]}>
            {LEGALES.map((l, i) => (
              <ListRow
                key={l.url}
                icon={l.icon}
                color={t.muted}
                label={l.label}
                last={i === LEGALES.length - 1}
                onPress={() => abrirEnlace(l.url)}
                right={<Ionicons name="open-outline" size={15} color={t.subtle} />}
              />
            ))}
          </View>
        </Animated.View>

        {/* Logout */}
        <Animated.View entering={FadeInDown.delay(260).duration(400)} style={{ marginTop: 16 }}>
          <TouchableOpacity style={[s.logoutBtn, Shadow.sm]} onPress={handleLogout} activeOpacity={0.8} disabled={saliendo} accessibilityRole="button">
            {saliendo
              ? <ActivityIndicator color={Colors.red} size="small" />
              : <Ionicons name="log-out-outline" size={18} color={Colors.red} />}
            <Text style={s.logoutText}>Cerrar sesión</Text>
          </TouchableOpacity>
        </Animated.View>

        {/* Eliminar cuenta */}
        <Animated.View entering={FadeInDown.delay(300).duration(400)} style={{ marginTop: 10 }}>
          <TouchableOpacity style={s.deleteRow} onPress={handleDeleteAccount} activeOpacity={0.6} disabled={borrando} accessibilityRole="button">
            {borrando
              ? <ActivityIndicator color={t.muted} size="small" />
              : <Text style={s.deleteText}>Eliminar cuenta</Text>}
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

// Colores del tema (D17): los Colors.white/text fijos dejaban tarjetas blancas
// con texto oscuro en modo oscuro.
function crearEstilos(t: ThemeColors) {
  return StyleSheet.create({
    header:       { paddingTop: 32, paddingBottom: 40, paddingHorizontal: 24, overflow: "hidden" },
    headerBlob:   { position: "absolute", width: 200, height: 200, borderRadius: 100, backgroundColor: "rgba(255,255,255,.08)", top: -60, right: -40 },
    avatarRing:   { width: 88, height: 88, borderRadius: 44, borderWidth: 2.5, borderColor: "rgba(255,255,255,.4)", alignItems: "center", justifyContent: "center", marginBottom: 14 },
    avatarInner:  { width: 78, height: 78, borderRadius: 39, alignItems: "center", justifyContent: "center" },
    avatarText:   { fontSize: 28, fontFamily: Fonts.bold, color: "white" },
    name:         { fontSize: 22, fontFamily: Fonts.bold, color: "white", letterSpacing: -0.5 },
    role:         { fontSize: 13, fontFamily: Fonts.semibold, color: "rgba(255,255,255,.8)", marginTop: 4 },
    businessPill: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(255,255,255,.14)", borderRadius: Radius.full, paddingHorizontal: 12, paddingVertical: 5, marginTop: 10 },
    businessText: { fontSize: 12, fontFamily: Fonts.semibold, color: "rgba(255,255,255,.85)" },

    sectionLabel: { fontSize: 11, fontFamily: Fonts.mono, color: t.subtle, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 },

    card:     { backgroundColor: t.cardSolid, borderWidth: 1, borderColor: t.line, borderRadius: Radius.lg, overflow: "hidden" },
    infoRow:  { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
    infoIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: t.chipBg, alignItems: "center", justifyContent: "center" },
    infoLabel:{ fontSize: 11, fontFamily: Fonts.semibold, color: t.muted },
    infoValue:{ fontSize: 14, fontFamily: Fonts.semibold, color: t.text, marginTop: 2 },
    divider:  { height: 1, backgroundColor: t.line, marginHorizontal: 14 },

    logoutBtn:  { backgroundColor: t.cardSolid, borderWidth: 1, borderColor: t.line, borderRadius: Radius.md, padding: 16, flexDirection: "row", alignItems: "center", gap: 10 },
    logoutText: { fontSize: 14, fontFamily: Fonts.semibold, color: Colors.red },
    deleteRow:  { alignItems: "center", paddingVertical: 10 },
    deleteText: { fontSize: 12.5, fontFamily: Fonts.regular, color: t.muted, textDecorationLine: "underline" },
  });
}
