import { useEffect, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  KeyboardAvoidingView, ActivityIndicator, Modal, FlatList, Alert,
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
import ErrorState from "@/components/ErrorState";
import { ZONAS_DISPONIBLES, etiquetaZona, hoyNegocio, horaLocalDe, fmtDia } from "@/lib/tz";
import { fmt12, telefonoE164 } from "@/lib/format";
import { exigirFilas, mensajeError, patchTenantSettings } from "@/lib/db";
import { validarTelefono } from "@/lib/contacto";
import { paisDeLocale } from "@/lib/cuenta";

/** "sábado 26 de septiembre · 9:30 PM" en la zona dada, para confirmar que es la correcta. */
function ahoraEn(zona: string): string {
  return `${fmtDia(hoyNegocio(zona), "largo")} · ${fmt12(horaLocalDe(new Date(), zona))}`;
}

export default function BusinessInfoScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const { tenantId } = useAuth();
  const {
    tenant: tenantCtx, patch: patchTenant, timezone: tzCtx, locale,
    refresh: refreshTenant, error: errorTenant, loading: cargandoTenant,
  } = useTenant();
  const [name, setName]         = useState("");
  const [phone, setPhone]       = useState("");
  const [address, setAddress]   = useState("");
  const [timezone, setTimezone] = useState(tzCtx);
  const [tzOpen, setTzOpen]     = useState(false);
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const [errPhone, setErrPhone] = useState<string | null>(null);
  const [reintentando, setReintentando] = useState(false);
  // Teléfono tal como se mostró al abrir: si no se toca, no se revalida ni se
  // reescribe (un número viejo de otro país no debe impedir cambiar el nombre).
  const [phoneInicial, setPhoneInicial] = useState("");
  const pais = paisDeLocale(locale);

  // El formulario se llena cuando cambian los VALORES del negocio, no el
  // objeto: así refrescar el negocio (p. ej. para tomar la zona nueva) no
  // borra lo que el dueño está escribiendo si esos datos no cambiaron.
  const hayTenant = !!tenantCtx;
  const nombreCtx = tenantCtx?.name ?? "";
  const telCtx = tenantCtx?.phone ?? "";
  const dirCtx = tenantCtx?.address ?? "";
  useEffect(() => {
    if (!hayTenant) return;
    setName(nombreCtx);
    // tenants.phone se guarda en dígitos con indicativo: con el "+" delante
    // se lee bien sin importar el país del negocio.
    const tel = telCtx ? (telefonoE164(telCtx, { pais }) ?? telCtx) : "";
    setPhone(tel);
    setPhoneInicial(tel);
    setAddress(dirCtx);
  }, [hayTenant, nombreCtx, telCtx, dirCtx, pais]);

  useEffect(() => { setTimezone(tzCtx); }, [tzCtx]);

  const canSave = name.trim().length >= 2;

  const handleSave = async () => {
    if (!canSave || !tenantId || !tenantCtx) return;

    // AJU-25: el teléfono es la forma de contactar al negocio (cobros, soporte).
    // Se valida y se guarda normalizado; vaciarlo solo si ya estaba vacío.
    const telCambio = phone.trim() !== phoneInicial.trim();
    let telGuardar: string | null = null;
    if (telCambio) {
      if (phone.trim()) {
        const tel = validarTelefono(phone, pais);
        if (!tel.ok) { setErrPhone(tel.error ?? "Revisa el teléfono."); return; }
        telGuardar = tel.valor!;
      } else if (tenantCtx.phone) {
        setErrPhone("El teléfono no puede quedar vacío: es la forma de contactar a tu negocio.");
        return;
      }
    }
    setErrPhone(null);

    setSaving(true);
    setSaved(false);
    let zonaGuardada = false;
    try {
      // La zona vive dentro de `settings`, un jsonb compartido con el horario,
      // el intervalo de turnos, el logo, los colores… Antes se leía y se
      // escribía el objeto entero sin mirar errores: si la lectura fallaba se
      // guardaba { timezone } y se borraba todo lo demás (AJU-07). D7: se
      // escribe solo esta clave.
      if (timezone !== tzCtx) {
        await patchTenantSettings(tenantId, { timezone });
        zonaGuardada = true;
      }
      const campos: { name: string; address: string | null; phone?: string | null } = {
        name: name.trim(),
        address: address.trim() || null,
      };
      if (telCambio) campos.phone = telGuardar;
      exigirFilas(
        await supabase.from("tenants").update(campos).eq("id", tenantId).select("id"),
        "No se pudieron guardar los datos del negocio",
      );
      patchTenant({
        name: name.trim(),
        address: address.trim(),
        ...(telCambio ? { phone: telGuardar ?? "" } : {}),
      });
      await refreshTenant();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      // Si la zona alcanzó a guardarse, decirlo: "No se guardó" a secas
      // mentía. Y refrescar el negocio para que Panel, Agenda, POS, Reportes
      // y recordatorios tomen ya la zona nueva (antes seguían con la vieja
      // hasta reiniciar). El formulario no se pierde: el nombre, el teléfono
      // y la dirección del servidor no cambiaron, así que no se rellena.
      if (zonaGuardada) refreshTenant().catch(() => {});
      Alert.alert(
        zonaGuardada ? "Se guardó solo la zona horaria" : "No se guardó",
        zonaGuardada ? `${mensajeError(e)} La zona horaria sí quedó guardada.` : mensajeError(e),
      );
    } finally {
      setSaving(false);
    }
  };

  const reintentarCarga = async () => {
    setReintentando(true);
    try { await refreshTenant(); } finally { setReintentando(false); }
  };

  // Sin datos del negocio no hay nada que editar: antes la pantalla se quedaba
  // en el spinner para siempre si la carga fallaba.
  if (!tenantCtx) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <ScreenHeader crumb="Negocio" title="Info del negocio" subtitle="Nombre, teléfono y dirección" onBack={() => router.back()} />
        {errorTenant && !cargandoTenant && !reintentando ? (
          <ErrorState message={errorTenant} onRetry={reintentarCarga} />
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator color={Colors.red} size="large" />
          </View>
        )}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader crumb="Negocio" title="Info del negocio" subtitle="Nombre, teléfono y dirección" onBack={() => router.back()} />

      <KeyboardAvoidingView style={{ flex: 1 }}>
        <ScrollView automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingBottom: 120 }}>
          <Animated.View entering={FadeInDown.duration(350)}>
            <FormField
              label="Nombre del negocio *" value={name} onChangeText={setName} placeholder="Ej: Salón Bella"
              error={name.length > 0 && !canSave ? "Escribe al menos 2 letras." : undefined}
            />
            <FormField
              label="Teléfono / WhatsApp" value={phone}
              onChangeText={v => { setPhone(v); setErrPhone(null); }}
              placeholder="Ej: +57 300 123 4567" keyboardType="phone-pad"
              error={errPhone ?? undefined}
              hint="Fuera de tu país, escríbelo con el indicativo (+52, +34…)."
            />
            <FormField label="Dirección" value={address} onChangeText={setAddress} placeholder="Ej: Cra 15 #45-20, Bogotá" />

            <Text style={[s.fieldLabel, { color: t.muted }]}>Zona horaria</Text>
            <TouchableOpacity
              style={[s.tzRow, { backgroundColor: t.inputBg, borderColor: t.inputBorder }]}
              onPress={() => setTzOpen(true)} activeOpacity={0.75}
              accessibilityRole="button" accessibilityLabel={`Zona horaria: ${etiquetaZona(timezone)}`}
            >
              <View style={{ flex: 1 }}>
                <Text style={[s.tzValue, { color: t.text }]}>{etiquetaZona(timezone)}</Text>
                <Text style={[s.tzHint, { color: t.subtle }]}>Allí ahora es {ahoraEn(timezone)}</Text>
              </View>
              <Ionicons name="chevron-down" size={16} color={t.subtle} />
            </TouchableOpacity>
            <Text style={[s.tzNote, { color: t.subtle }]}>
              Define cuándo empieza y termina el día para tus ingresos y reportes.
              Si la dejas mal, los cobros de la noche se cuentan al día siguiente.
            </Text>
          </Animated.View>

          {saved && (
            <Animated.View entering={FadeInDown.duration(300)} style={[s.savedBanner, Shadow.sm]} accessibilityLiveRegion="polite">
              <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
              <Text style={s.savedText}>Cambios guardados</Text>
            </Animated.View>
          )}
        </ScrollView>

        <BottomSaveBar label="Guardar cambios" saving={saving} disabled={!canSave} onPress={handleSave} />
      </KeyboardAvoidingView>

      <Modal visible={tzOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setTzOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
          <ScreenHeader crumb="Negocio" title="Zona horaria" subtitle="Dónde opera tu negocio" onBack={() => setTzOpen(false)} />
          <FlatList
            data={ZONAS_DISPONIBLES.some(z => z.id === timezone) ? ZONAS_DISPONIBLES : [{ id: timezone, label: timezone }, ...ZONAS_DISPONIBLES]}
            keyExtractor={z => z.id}
            contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
            renderItem={({ item }) => {
              const activa = item.id === timezone;
              return (
                <TouchableOpacity
                  style={[s.tzOption, { backgroundColor: t.card, borderColor: activa ? Colors.red : t.border }]}
                  onPress={() => { setTimezone(item.id); setTzOpen(false); }}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  accessibilityState={{ selected: activa }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[s.tzValue, { color: t.text }]}>{item.label}</Text>
                    <Text style={[s.tzHint, { color: t.subtle }]}>
                      {ahoraEn(item.id)}
                      {"dst" in item && item.dst ? " · usa horario de verano" : ""}
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
  fieldLabel: { fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8, marginTop: 4 },
  tzRow:      { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1.5, borderRadius: Radius.md, padding: 14 },
  tzValue:    { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold" },
  tzHint:     { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", marginTop: 2 },
  tzNote:     { fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", marginTop: 8, lineHeight: 16 },
  tzOption:   { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1.5, borderRadius: Radius.md, padding: 14, marginBottom: 10 },
  savedBanner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: Colors.success + "12", borderRadius: Radius.md, padding: 14, marginTop: 8 },
  savedText:   { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.success },
});
