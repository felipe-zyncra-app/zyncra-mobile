import { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useStaffPermissionsEstado } from "@/lib/permissions";
import { useTheme, type ThemeColors } from "@/lib/theme";
import { Colors, Radius, Shadow, MonoLabel } from "@/constants/theme";
import { ScreenHeader } from "@/components/ui";
import ErrorState from "@/components/ErrorState";
import { PantallaCargando } from "@/lib/guards";
import { mensajeError, revisar } from "@/lib/db";
import { type ProSchedule, DAYS, horarioBase, buildSched, toCanonical, diaInvalido, HoraSelector } from "@/components/equipo/horario";

/**
 * Mi ficha: el colaborador cambia su nombre (edit_profile) y su horario
 * (edit_schedule) si el dueño se lo permitió en Ajustes → Equipo. Guarda con la
 * RPC actualizar_mi_ficha: el staff no tiene UPDATE directo sobre professionals,
 * y la función revisa el permiso y que las horas tengan sentido.
 */
export default function MiFichaScreen() {
  const router = useRouter();
  const { user, tenantId, professionalId } = useAuth();
  const { perms, cargando: cargandoPerms } = useStaffPermissionsEstado();
  const { t } = useTheme();
  const s = useMemo(() => estilos(t), [t]);

  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [nombre, setNombre] = useState("");
  const [nombreInicial, setNombreInicial] = useState("");
  const [horario, setHorario] = useState<ProSchedule>(horarioBase());
  const [guardando, setGuardando] = useState<"nombre" | "horario" | null>(null);

  const cargar = async () => {
    if (!user || !tenantId) return;
    setCargando(true);
    try {
      let q = supabase.from("professionals").select("id, name, schedule");
      q = professionalId ? q.eq("id", professionalId) : q.eq("user_id", user.id).eq("tenant_id", tenantId);
      const fila = (revisar(await q.limit(1), "No se pudo cargar tu ficha") ?? [])[0] as { name: string; schedule: unknown } | undefined;
      // Sin horario propio se parte del horario del negocio (mi_negocio no lo
      // trae; get_staff_context sí).
      let base = horarioBase();
      if (!fila?.schedule) {
        const ctx = await supabase.rpc("get_staff_context");
        const d = (Array.isArray(ctx.data) ? ctx.data[0] : ctx.data) as { tenant_settings?: { schedule?: unknown } } | null;
        if (d?.tenant_settings?.schedule) base = buildSched(d.tenant_settings.schedule);
      }
      setNombre(fila?.name ?? "");
      setNombreInicial(fila?.name ?? "");
      setHorario(fila?.schedule ? buildSched(fila.schedule) : base);
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => { cargar(); }, [user?.id, tenantId, professionalId]); // eslint-disable-line react-hooks/exhaustive-deps

  const guardar = async (que: "nombre" | "horario") => {
    if (!tenantId) return;
    if (que === "horario") {
      const malo = diaInvalido(horario);
      if (malo) { Alert.alert("Revisa el horario", `El ${malo} la salida debe ser después de la entrada.`); return; }
    }
    setGuardando(que);
    const { error: e } = await supabase.rpc("actualizar_mi_ficha", {
      p_tenant_id: tenantId,
      p_name: que === "nombre" ? nombre.trim() : null,
      p_schedule: que === "horario" ? toCanonical(horario) : null,
    });
    setGuardando(null);
    if (e) { Alert.alert("No se guardó", mensajeError(e, "Intenta de nuevo")); return; }
    if (que === "nombre") setNombreInicial(nombre.trim());
    Alert.alert("Listo", que === "nombre" ? "Guardamos tu nombre." : "Guardamos tu horario. Las reservas ya lo respetan.");
  };

  if (cargandoPerms || cargando) return <PantallaCargando />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader title="Mi ficha" subtitle="Tus datos y tu horario" onBack={() => router.back()} />
      {error ? (
        <ErrorState error={error} onRetry={cargar} />
      ) : (
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
            {!perms.edit_profile && !perms.edit_schedule && (
              <Text style={[s.nota, { color: t.muted }]}>
                Por ahora el dueño del negocio es quien cambia tus datos y tu horario. Si necesitas ajustar algo, pídeselo.
              </Text>
            )}

            {perms.edit_profile && (
              <View style={{ marginBottom: 28 }}>
                <Text style={[MonoLabel, { marginBottom: 10, color: t.subtle }]}>Tus datos</Text>
                <Text style={[s.label, { color: t.muted }]}>Nombre</Text>
                <TextInput value={nombre} onChangeText={setNombre} maxLength={60} autoCapitalize="words"
                  style={[s.input, { color: t.text, backgroundColor: t.card, borderColor: t.border }]}
                  placeholder="Tu nombre" placeholderTextColor={t.subtle} accessibilityLabel="Tu nombre" />
                <Text style={[s.nota, { color: t.subtle, marginTop: 6 }]}>Así te ven los clientes al reservar.</Text>
                <TouchableOpacity
                  style={[s.btn, (guardando !== null || nombre.trim().length < 2 || nombre.trim() === nombreInicial) && { opacity: 0.45 }]}
                  disabled={guardando !== null || nombre.trim().length < 2 || nombre.trim() === nombreInicial}
                  onPress={() => guardar("nombre")} accessibilityRole="button">
                  {guardando === "nombre" ? <ActivityIndicator color="white" /> : <Text style={s.btnTxt}>Guardar nombre</Text>}
                </TouchableOpacity>
              </View>
            )}

            {perms.edit_schedule && (
              <View>
                <Text style={[MonoLabel, { marginBottom: 6, color: t.subtle }]}>Mi horario</Text>
                <Text style={[s.nota, { color: t.muted, marginBottom: 10 }]}>Los días y horas en que te pueden reservar. Las citas que ya tienes no cambian.</Text>
                {DAYS.map(({ key, label, largo }) => {
                  const dia = horario[key];
                  const malo = dia.enabled && dia.start >= dia.end;
                  return (
                    <View key={key} style={[s.fila, Shadow.sm, { backgroundColor: t.card, borderColor: malo ? Colors.red : t.border }]}>
                      <TouchableOpacity
                        style={[s.dia, dia.enabled && { backgroundColor: Colors.blue + "18" }]}
                        onPress={() => setHorario(h => ({ ...h, [key]: { ...h[key], enabled: !h[key].enabled } }))}
                        accessibilityRole="switch" accessibilityState={{ checked: dia.enabled }} accessibilityLabel={`Trabajo el ${largo}`}>
                        <Text style={[s.diaTxt, { color: dia.enabled ? Colors.blue : t.muted }]}>{label}</Text>
                      </TouchableOpacity>
                      {dia.enabled ? (
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <HoraSelector label={`Entrada del ${largo}`} value={dia.start} onChange={v => setHorario(h => ({ ...h, [key]: { ...h[key], start: v } }))} />
                          <Text style={{ color: t.muted, fontSize: 12 }}>a</Text>
                          <HoraSelector label={`Salida del ${largo}`} value={dia.end} onChange={v => setHorario(h => ({ ...h, [key]: { ...h[key], end: v } }))} />
                        </View>
                      ) : (
                        <Text style={{ color: t.subtle, fontSize: 12.5 }}>Libre</Text>
                      )}
                    </View>
                  );
                })}
                <TouchableOpacity style={[s.btn, guardando !== null && { opacity: 0.45 }]} disabled={guardando !== null}
                  onPress={() => guardar("horario")} accessibilityRole="button">
                  {guardando === "horario" ? <ActivityIndicator color="white" /> : <Text style={s.btnTxt}>Guardar horario</Text>}
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

function estilos(t: ThemeColors) {
  return StyleSheet.create({
    nota:  { fontSize: 13, lineHeight: 19 },
    label: { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", marginBottom: 6 },
    input: { borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontFamily: "SpaceGrotesk_400Regular" },
    btn:   { marginTop: 14, height: 48, borderRadius: Radius.md, backgroundColor: Colors.red, alignItems: "center", justifyContent: "center" },
    btnTxt: { color: "white", fontSize: 15, fontFamily: "SpaceGrotesk_700Bold" },
    fila:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderRadius: Radius.md, padding: 10, marginTop: 8 },
    dia:   { paddingHorizontal: 12, paddingVertical: 8, borderRadius: Radius.sm, backgroundColor: t.chipBg },
    diaTxt: { fontSize: 13, fontFamily: "SpaceGrotesk_700Bold" },
  });
}
