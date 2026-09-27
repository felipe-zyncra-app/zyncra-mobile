import { useEffect, useMemo, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Modal, TextInput, KeyboardAvoidingView,
  ActivityIndicator, Alert, RefreshControl,
} from "react-native";
import Animated, { FadeInDown, FadeInRight } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { Colors, Radius, Shadow } from "@/constants/theme";
import ErrorState from "@/components/ErrorState";
import ModalHeader from "@/components/ModalHeader";
import { useTheme } from "@/lib/theme";
import { ScreenHeader } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { fmtMoneyFull } from "@/lib/format";
import { useRecarga, useGuardRespuestas } from "@/lib/useRecarga";
import { ErrorDB, exigirFilas, mensajeError, revisar, traerTodo, traerTodoDetalle } from "@/lib/db";
import {
  type EtiquetaServicio,
  normalizarEtiquetas, etiquetasDesdeTexto, textoDeEtiquetas,
  duracionDe, parsearDuracion, parsearPrecio, textoDePrecio, monedaSinDecimales,
} from "@/lib/servicios";

/** Fila tal cual viene de la base. is_active llega cuando la migración ya se aplicó. */
type ServicioFila = {
  id: string;
  name: string;
  code: string | null;
  price: number | string;
  duration_minutes: number | null;
  duration_min: number | null;
  description: string | null;
  tags: unknown;
  is_active?: boolean | null;
};

type Servicio = {
  id: string;
  name: string;
  code: string | null;
  price: number;
  duracion: number;
  description: string | null;
  tags: EtiquetaServicio[];
  activo: boolean;
  /** Citas completadas o confirmadas (null = no se pudo contar). */
  citas: number | null;
};

function desdeFila(f: ServicioFila, citas: number | null): Servicio {
  return {
    id: f.id,
    name: f.name,
    code: f.code ?? null,
    price: Number(f.price) || 0,
    duracion: duracionDe(f),
    description: f.description ?? null,
    tags: normalizarEtiquetas(f.tags),
    // Antes de la migración la columna no existe: todo servicio está activo.
    activo: f.is_active !== false,
    citas,
  };
}

/** La columna is_active todavía no existe (migración sin aplicar). */
function faltaColumna(err: unknown): boolean {
  const code = err instanceof ErrorDB ? err.code : (err as { code?: string } | null)?.code;
  return code === "PGRST204" || code === "42703";
}

function Field({ label, value, onChangeText, placeholder, keyboardType, multiline, error, hint }: {
  label: string; value: string; onChangeText: (t: string) => void;
  placeholder: string; keyboardType?: "numeric" | "number-pad" | "decimal-pad" | "default"; multiline?: boolean;
  error?: string | null; hint?: string;
}) {
  const { t } = useTheme();
  const numerico = keyboardType && keyboardType !== "default";
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={[f.label, { color: t.muted }]}>{label}</Text>
      <TextInput
        style={[
          f.input,
          { backgroundColor: t.inputBg, borderColor: error ? Colors.red : t.inputBorder, color: t.text },
          multiline && { height: 80, textAlignVertical: "top" },
        ]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.subtle}
        keyboardType={keyboardType ?? "default"}
        multiline={multiline}
        autoCapitalize={numerico ? "none" : "sentences"}
        accessibilityLabel={label}
      />
      {error ? <Text style={f.error}>{error}</Text> : hint ? <Text style={[f.hint, { color: t.subtle }]}>{hint}</Text> : null}
    </View>
  );
}

const f = StyleSheet.create({
  label: { fontSize: 11, fontFamily: "SpaceGrotesk_700Bold", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 },
  input: { borderWidth: 1.5, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, fontFamily: "SpaceGrotesk_400Regular" },
  error: { fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.red, marginTop: 6 },
  hint:  { fontSize: 11.5, fontFamily: "SpaceGrotesk_400Regular", marginTop: 6 },
});

function ServiceModal({ visible, service, tenantId, currency, onClose, onSaved }: {
  visible: boolean; service: Servicio | null; tenantId: string; currency: string;
  onClose: () => void; onSaved: () => Promise<void> | void;
}) {
  const { t } = useTheme();
  const isEdit = service !== null;
  const [name, setName]         = useState("");
  const [code, setCode]         = useState("");
  const [price, setPrice]       = useState("");
  const [duration, setDuration] = useState("");
  const [desc, setDesc]         = useState("");
  const [tagInput, setTagInput] = useState("");
  const [saving, setSaving]     = useState(false);
  const [accion, setAccion]     = useState<"archivar" | "eliminar" | null>(null);
  const [intentado, setIntentado] = useState(false);

  useEffect(() => {
    if (visible) {
      setName(service?.name ?? "");
      setCode(service?.code ?? "");
      setPrice(service ? textoDePrecio(service.price) : "");
      setDuration(service ? String(service.duracion) : "");
      setDesc(service?.description ?? "");
      setTagInput(textoDeEtiquetas(service?.tags ?? []));
      setIntentado(false);
    }
  }, [visible, service]);

  const precio = parsearPrecio(price, currency);
  const duracion = parsearDuracion(duration);
  const nombreOk = name.trim().length >= 2;
  const canSave = nombreOk && precio.ok && duracion.ok;
  const ocupado = saving || accion !== null;

  const handleSave = async () => {
    setIntentado(true);
    if (!canSave || !precio.ok || !duracion.ok) return;
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        // Código corto (p. ej. "101") para llamarlo por número; único por negocio.
        code: code.trim() || null,
        price: precio.valor,
        // D3: la agenda, la reserva y el web leen duration_minutes; la columna
        // vieja se escribe igual para las versiones publicadas que la leen.
        duration_minutes: duracion.valor,
        duration_min: duracion.valor,
        description: desc.trim() || null,
        // D2: formato del web ({name, color}[]) y nunca null (columna NOT NULL).
        tags: etiquetasDesdeTexto(tagInput, service?.tags ?? []),
      };
      if (isEdit) {
        exigirFilas(
          await supabase.from("services").update(payload).eq("id", service!.id).select("id"),
          "No se pudo guardar el servicio",
        );
      } else {
        revisar(
          await supabase.from("services").insert({ ...payload, tenant_id: tenantId }).select("id").single(),
          "No se pudo crear el servicio",
        );
      }
      await onSaved();
      onClose();
    } catch (e) {
      const dup = e instanceof ErrorDB && e.code === "23505";
      Alert.alert(
        "No se pudo guardar",
        dup ? `Ya hay otro servicio con el código "${code.trim()}". Usa uno distinto.` : mensajeError(e),
      );
    } finally {
      setSaving(false);
    }
  };

  /** D1: archivar deja de ofrecerlo en la agenda y la reserva, y conserva su historial. */
  const cambiarActivo = async (activo: boolean) => {
    if (!service) return;
    setAccion("archivar");
    try {
      const res = await supabase.from("services").update({ is_active: activo }).eq("id", service.id).select("id");
      if (res.error && faltaColumna(res.error)) {
        Alert.alert(
          "Archivar aún no está disponible",
          "El servidor todavía no tiene esta función (llega con la próxima actualización). Mientras tanto puedes cambiarle el nombre, por ejemplo \"NO USAR – " + service.name + "\". No lo elimines: se borrarían sus citas.",
        );
        return;
      }
      exigirFilas(res, activo ? "No se pudo reactivar el servicio" : "No se pudo archivar el servicio");
      await onSaved();
      onClose();
    } catch (e) {
      Alert.alert(activo ? "No se reactivó" : "No se archivó", mensajeError(e));
    } finally {
      setAccion(null);
    }
  };

  const confirmarArchivar = () => {
    if (!service) return;
    Alert.alert(
      "Archivar servicio",
      `"${service.name}" dejará de aparecer en la agenda, el POS y la reserva en línea. Sus citas y cobros anteriores se conservan, y puedes reactivarlo cuando quieras.`,
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Archivar", onPress: () => cambiarActivo(false) },
      ],
    );
  };

  /**
   * Borrado físico solo para servicios sin ninguna cita: la FK de appointments
   * es ON DELETE CASCADE y borrar uno usado se llevaba todo su historial
   * (AJU-02 / ESQ-01). El conteo es exacto (head + count), no la lista de la
   * pantalla, que puede venir truncada.
   */
  const handleDelete = async () => {
    if (!service) return;
    setAccion("eliminar");
    let total = 0;
    try {
      const [citas, multiples] = await Promise.all([
        supabase.from("appointments").select("id", { count: "exact", head: true }).eq("service_id", service.id),
        supabase.from("appointment_services").select("appointment_id", { count: "exact", head: true }).eq("service_id", service.id),
      ]);
      if (citas.error) throw new ErrorDB(citas.error, "No pudimos revisar si el servicio tiene citas");
      if (multiples.error) throw new ErrorDB(multiples.error, "No pudimos revisar si el servicio tiene citas");
      total = (citas.count ?? 0) + (multiples.count ?? 0);
    } catch (e) {
      setAccion(null);
      Alert.alert("No se eliminó", `${mensajeError(e)} Por seguridad no se borró nada.`);
      return;
    }
    setAccion(null);

    if (total > 0) {
      Alert.alert(
        "Este servicio tiene historial",
        `"${service.name}" aparece en ${total} cita${total === 1 ? "" : "s"}. Si lo eliminaras se borrarían con él. Archívalo: deja de ofrecerse y el historial se conserva.`,
        service.activo
          ? [{ text: "Cancelar", style: "cancel" }, { text: "Archivar", onPress: () => cambiarActivo(false) }]
          : [{ text: "Entendido", style: "cancel" }],
      );
      return;
    }

    Alert.alert(
      "Eliminar definitivamente",
      `"${service.name}" no tiene citas. Se eliminará para siempre junto con sus precios por nivel y campos personalizados. Esta acción no se puede deshacer.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar", style: "destructive", onPress: async () => {
            setAccion("eliminar");
            try {
              exigirFilas(
                await supabase.from("services").delete().eq("id", service.id).select("id"),
                "No se pudo eliminar el servicio",
              );
              await onSaved();
              onClose();
            } catch (e) {
              // Con la migración, un servicio con citas lo rechaza el servidor
              // con un mensaje en español (P0001) que llega tal cual.
              Alert.alert("No se eliminó", mensajeError(e));
            } finally {
              setAccion(null);
            }
          },
        },
      ],
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <ModalHeader title={isEdit ? "Editar servicio" : "Nuevo servicio"} onClose={onClose} />
        <KeyboardAvoidingView style={{ flex: 1 }}>
          <ScrollView automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingBottom: 120 }}>
            {isEdit && !service!.activo && (
              <View style={[s.aviso, { backgroundColor: t.chipBg, borderColor: t.line }]}>
                <Ionicons name="archive-outline" size={16} color={t.muted} />
                <Text style={[s.avisoTxt, { color: t.muted }]}>
                  Servicio archivado: no aparece en la agenda ni en la reserva en línea.
                </Text>
              </View>
            )}
            <Field
              label="Nombre del servicio *" value={name} onChangeText={setName} placeholder="Ej: Corte de cabello"
              error={intentado && !nombreOk ? "Escribe un nombre de al menos 2 letras." : null}
            />
            <Field label="Código (opcional)" value={code} onChangeText={setCode} placeholder="Ej: 101 — para llamarlo por número en el POS y la agenda" />
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Field
                  label="Precio *" value={price} onChangeText={setPrice} placeholder="25000"
                  keyboardType={monedaSinDecimales(currency) ? "number-pad" : "decimal-pad"}
                  error={(intentado || price.length > 0) && !precio.ok ? precio.error : null}
                  hint={precio.ok && price.trim() ? fmtMoneyFull(precio.valor) : undefined}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label="Duración (min)" value={duration} onChangeText={setDuration} placeholder="30" keyboardType="number-pad"
                  error={!duracion.ok ? duracion.error : null}
                />
              </View>
            </View>
            <Field label="Descripción" value={desc} onChangeText={setDesc} placeholder="Opcional..." multiline />
            <Field
              label="Etiquetas (separadas por coma)" value={tagInput} onChangeText={setTagInput}
              placeholder="Ej: cabello, tintura, express"
              hint="Las etiquetas que ya tenían color en el portal lo conservan."
            />

            {isEdit && (
              <View style={[s.acciones, { borderTopColor: t.line }]}>
                {service!.activo ? (
                  <TouchableOpacity
                    style={[s.accionBtn, { borderColor: t.lineStrong }]}
                    onPress={confirmarArchivar} disabled={ocupado} activeOpacity={0.75}
                    accessibilityRole="button" accessibilityLabel="Archivar servicio"
                  >
                    {accion === "archivar"
                      ? <ActivityIndicator size="small" color={t.text} />
                      : <Ionicons name="archive-outline" size={16} color={t.text} />}
                    <Text style={[s.accionTxt, { color: t.text }]}>Archivar servicio</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[s.accionBtn, { borderColor: t.lineStrong }]}
                    onPress={() => cambiarActivo(true)} disabled={ocupado} activeOpacity={0.75}
                    accessibilityRole="button" accessibilityLabel="Reactivar servicio"
                  >
                    {accion === "archivar"
                      ? <ActivityIndicator size="small" color={t.text} />
                      : <Ionicons name="refresh-outline" size={16} color={t.text} />}
                    <Text style={[s.accionTxt, { color: t.text }]}>Reactivar servicio</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={s.eliminarBtn} onPress={handleDelete} disabled={ocupado} activeOpacity={0.6}
                  accessibilityRole="button" accessibilityLabel="Eliminar servicio"
                >
                  {accion === "eliminar"
                    ? <ActivityIndicator size="small" color={Colors.red} />
                    : <Ionicons name="trash-outline" size={14} color={Colors.red} />}
                  <Text style={s.eliminarTxt}>Eliminar (solo si no tiene citas)</Text>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
          <View style={[s.bottomBar, { backgroundColor: t.bg, borderTopColor: t.border }]}>
            <TouchableOpacity
              style={[s.btn, !canSave && { opacity: 0.4 }]} onPress={handleSave}
              disabled={ocupado} activeOpacity={0.85}
              accessibilityRole="button" accessibilityState={{ disabled: !canSave || ocupado, busy: saving }}
            >
              <View style={s.btnGrad}>
                {saving ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>{isEdit ? "Guardar cambios" : "Crear servicio"}</Text>}
              </View>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

export default function ServicesScreen() {
  const router = useRouter();
  const { t } = useTheme();
  const { tenantId } = useAuth();
  const { currency } = useTenant();
  const guard = useGuardRespuestas();
  const [services, setServices]   = useState<Servicio[] | null>(null);
  const [conteoTruncado, setConteoTruncado] = useState(false);
  const [error, setError]         = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [verArchivados, setVerArchivados] = useState(false);
  const [modal, setModal]         = useState<{ visible: boolean; service: Servicio | null }>({ visible: false, service: null });

  const { recargar } = useRecarga(async () => {
    if (!tenantId) return;
    const turno = guard.nuevo();
    try {
      // select("*") y no una lista de columnas: así is_active llega cuando la
      // migración exista, y antes de eso la consulta no falla por pedirla.
      const filasP = traerTodo<ServicioFila>((d, h) =>
        supabase.from("services").select("*")
          .eq("tenant_id", tenantId).order("name").order("id").range(d, h),
      { contexto: "No se pudieron cargar los servicios" });
      // Conteo "· N citas": paginado (el servidor corta en 1000 filas y el
      // limit(5000) de antes no lo superaba, AJU-23). Si falla, la lista
      // igual se muestra, solo que sin el número.
      const citasP = traerTodoDetalle<{ service_id: string | null }>((d, h) =>
        supabase.from("appointments").select("id, service_id")
          .eq("tenant_id", tenantId).in("status", ["completed", "confirmed"])
          .order("id").range(d, h),
      { contexto: "No se pudieron contar las citas" }).catch(() => null);

      const [filas, citas] = await Promise.all([filasP, citasP]);
      if (!turno.vigente()) return;
      const conteo: Record<string, number> = {};
      citas?.filas.forEach(a => { if (a.service_id) conteo[a.service_id] = (conteo[a.service_id] ?? 0) + 1; });
      setServices(filas.map(fl => desdeFila(fl, citas ? (conteo[fl.id] ?? 0) : null)));
      setConteoTruncado(!!citas?.truncado);
      setError(null);
    } catch (e) {
      if (turno.vigente()) setError(e);
    }
  }, [tenantId], { habilitado: !!tenantId, alCambiarDia: false, alCambiarSede: false, frescuraMs: 30_000 });

  const onRefresh = async () => { setRefreshing(true); await recargar(); setRefreshing(false); };

  const activos = useMemo(() => (services ?? []).filter(x => x.activo), [services]);
  const archivados = useMemo(() => (services ?? []).filter(x => !x.activo), [services]);

  const renderFila = (svc: Servicio, i: number) => (
    <Animated.View key={svc.id} entering={i < 10 ? FadeInRight.delay(i * 50).duration(320) : undefined}>
      <TouchableOpacity
        style={[s.row, Shadow.sm, { backgroundColor: t.card, borderColor: t.cardBorder }, !svc.activo && { opacity: 0.6 }]}
        onPress={() => setModal({ visible: true, service: svc })}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel={`${svc.name}, ${svc.duracion} minutos, ${fmtMoneyFull(svc.price)}${svc.activo ? "" : ", archivado"}`}
      >
        <View style={[s.iconBox, { backgroundColor: Colors.purple + "12" }]}>
          <Ionicons name={svc.activo ? "pricetags-outline" : "archive-outline"} size={18} color={Colors.purple} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            {svc.code && (
              <View style={{ backgroundColor: t.chipBg, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                <Text style={{ fontSize: 11, fontFamily: "SpaceGrotesk_600SemiBold", color: t.muted }}>{svc.code}</Text>
              </View>
            )}
            <Text style={[s.name, { color: t.text, flex: 1 }]} numberOfLines={1}>{svc.name}</Text>
          </View>
          <Text style={[s.info, { color: t.muted }]}>
            {svc.duracion} min
            {svc.citas ? ` · ${svc.citas}${conteoTruncado ? "+" : ""} citas` : ""}
          </Text>
          {svc.tags.length > 0 && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 5 }}>
              {svc.tags.slice(0, 3).map(tag => (
                <View key={tag.name} style={[s.tag, { backgroundColor: tag.color + "1F" }]}>
                  <Text style={[s.tagTxt, { color: tag.color }]}>{tag.name}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={[s.price, { color: t.text }]}>{fmtMoneyFull(svc.price)}</Text>
          <Ionicons name="chevron-forward" size={14} color={t.subtle} style={{ marginTop: 4 }} />
        </View>
      </TouchableOpacity>
    </Animated.View>
  );

  if (error && !services) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <ScreenHeader crumb="Negocio" title="Servicios" onBack={() => router.back()} />
        <ErrorState error={error} onRetry={recargar} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader
        crumb="Negocio"
        title="Servicios"
        subtitle={services ? `${activos.length} en tu catálogo${archivados.length ? ` · ${archivados.length} archivado${archivados.length === 1 ? "" : "s"}` : ""}` : "Cargando…"}
        onBack={() => router.back()}
        rightAction={{ icon: "add", label: "Nuevo servicio", onPress: () => setModal({ visible: true, service: null }) }}
      />

      <ScrollView automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ padding: 20, paddingBottom: 110 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.red} />}
      >
        {error ? (
          // Ya había datos: se conservan y se avisa que no están al día.
          <View style={[s.aviso, { backgroundColor: Colors.red + "12", borderColor: Colors.red + "33" }]}>
            <Ionicons name="alert-circle-outline" size={16} color={Colors.red} />
            <Text style={[s.avisoTxt, { color: t.text }]}>{mensajeError(error)}</Text>
          </View>
        ) : null}

        {services === null ? (
          <ActivityIndicator color={Colors.red} style={{ marginTop: 40 }} />
        ) : activos.length === 0 && archivados.length === 0 ? (
          <Animated.View entering={FadeInDown.duration(400)} style={[s.empty, Shadow.sm, { backgroundColor: t.card, borderColor: t.cardBorder }]}>
            <Ionicons name="pricetags-outline" size={44} color={t.subtle} style={{ marginBottom: 12 }} />
            <Text style={[s.emptyTitle, { color: t.text }]}>Sin servicios</Text>
            <Text style={[s.emptySub, { color: t.muted }]}>Toca + para agregar tu primer servicio</Text>
          </Animated.View>
        ) : (
          <>
            {activos.map(renderFila)}
            {activos.length === 0 && (
              <Text style={[s.emptySub, { color: t.muted, marginVertical: 16 }]}>Todos tus servicios están archivados.</Text>
            )}
            {archivados.length > 0 && (
              <>
                <TouchableOpacity
                  style={s.archToggle} onPress={() => setVerArchivados(v => !v)} activeOpacity={0.7}
                  accessibilityRole="button" accessibilityState={{ expanded: verArchivados }}
                >
                  <Text style={[s.archToggleTxt, { color: t.muted }]}>
                    Archivados ({archivados.length})
                  </Text>
                  <Ionicons name={verArchivados ? "chevron-up" : "chevron-down"} size={14} color={t.muted} />
                </TouchableOpacity>
                {verArchivados && archivados.map((svc, i) => renderFila(svc, i + 10))}
              </>
            )}
          </>
        )}
      </ScrollView>

      {tenantId && (
        <ServiceModal
          visible={modal.visible}
          service={modal.service}
          tenantId={tenantId}
          currency={currency}
          onClose={() => setModal({ visible: false, service: null })}
          onSaved={recargar}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  row:        { borderRadius: Radius.md, borderWidth: 1, padding: 14, flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  iconBox:    { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  name:       { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold" },
  info:       { fontSize: 12, fontFamily: "SpaceGrotesk_400Regular", marginTop: 2 },
  price:      { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold" },
  tag:        { borderRadius: Radius.full, paddingHorizontal: 7, paddingVertical: 2 },
  tagTxt:     { fontSize: 10, fontFamily: "SpaceGrotesk_600SemiBold" },
  empty:      { borderRadius: Radius.xl, borderWidth: 1, padding: 48, alignItems: "center", marginTop: 20 },
  emptyTitle: { fontSize: 16, fontFamily: "SpaceGrotesk_700Bold", marginBottom: 6 },
  emptySub:   { fontSize: 13, fontFamily: "SpaceGrotesk_400Regular", textAlign: "center" },
  aviso:      { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: Radius.md, padding: 12, marginBottom: 14 },
  avisoTxt:   { flex: 1, fontSize: 12.5, fontFamily: "SpaceGrotesk_400Regular", lineHeight: 17 },
  archToggle: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 14 },
  archToggleTxt: { fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold" },
  acciones:   { borderTopWidth: 1, marginTop: 8, paddingTop: 20, gap: 4 },
  accionBtn:  { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1.5, borderRadius: Radius.md, paddingVertical: 13 },
  accionTxt:  { fontSize: 14, fontFamily: "SpaceGrotesk_600SemiBold" },
  eliminarBtn:{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 14 },
  eliminarTxt:{ fontSize: 12.5, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.red },
  bottomBar:  { padding: 20, paddingBottom: 34, borderTopWidth: 1 },
  btn:        { borderRadius: Radius.full, overflow: "hidden" },
  btnGrad:    { paddingVertical: 16, alignItems: "center", backgroundColor: Colors.red },
  btnText:    { fontSize: 15, fontFamily: "SpaceGrotesk_700Bold", color: "white" },
});
