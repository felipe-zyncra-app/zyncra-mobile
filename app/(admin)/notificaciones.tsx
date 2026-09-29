import { useMemo, useState } from "react";
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Fonts, Radius } from "@/constants/theme";
import { useTheme, type ThemeColors } from "@/lib/theme";
import { esErrorDeRed, mensajeError } from "@/lib/db";
import { useAvisos } from "@/lib/useAvisos";
import { agruparAvisos, NOMBRE_TIPO, type AvisoVisible, type GrupoAviso, type TipoAviso } from "@/lib/avisos";
import { IconButton, ScreenHeader } from "@/components/ui";
import ErrorState from "@/components/ErrorState";
import EmptyState from "@/components/EmptyState";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

// Mismos colores que la campana del portal; en oscuro, la variante clara del
// mismo tono para que el texto pequeño se lea sobre el fondo oscuro.
const TONO_TIPO: Record<TipoAviso, { claro: string; oscuro: string; icono: IoniconName }> = {
  inasistencia:    { claro: "#dc2626", oscuro: "#f87171", icono: "alert-circle-outline" },
  sin_confirmar:   { claro: "#d97706", oscuro: "#fbbf24", icono: "time-outline" },
  sin_profesional: { claro: "#ea580c", oscuro: "#fb923c", icono: "person-outline" },
  nueva_cita:      { claro: "#2563eb", oscuro: "#60a5fa", icono: "calendar-outline" },
  cancelacion:     { claro: "#6b7280", oscuro: "#9ca3af", icono: "close-circle-outline" },
};

const TONO_GRUPO: Record<GrupoAviso, TipoAviso> = {
  urgente:   "inasistencia",
  accion:    "sin_confirmar",
  actividad: "nueva_cita",
};

function iniciales(nombre: string): string {
  return nombre.trim().split(/\s+/).slice(0, 2).map(p => p[0] ?? "").join("").toUpperCase() || "?";
}

/**
 * Campana del Panel: lo mismo que la campana del portal (nueva cita,
 * cancelaciones recientes, sin confirmar, por presentarse y sin profesional),
 * con las fechas en la zona del negocio y la sede activa. Tocar un aviso lleva
 * a la Agenda en el día de la cita y abre su detalle. Leídos y descartados se
 * guardan en este teléfono (lib/useAvisos).
 */
export default function NotificacionesScreen() {
  const router = useRouter();
  const { t, mode } = useTheme();
  const s = useMemo(() => crearEstilos(t), [t]);
  const { avisos, noLeidos, cargado, error, sede, recargar, marcarLeido, descartar, marcarTodosLeidos } = useAvisos();
  const [refreshing, setRefreshing] = useState(false);

  const tono = (tipo: TipoAviso) => (mode === "dark" ? TONO_TIPO[tipo].oscuro : TONO_TIPO[tipo].claro);
  const grupos = agruparAvisos(avisos);

  const onRefresh = async () => { setRefreshing(true); await recargar(); setRefreshing(false); };

  const volver = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(admin)/(tabs)");
  };

  const abrir = (a: AvisoVisible) => {
    marcarLeido(a.id);
    // Vuelve a las pestañas (no apila otra copia) y la Agenda abre ese día.
    router.dismissTo({ pathname: "/(admin)/(tabs)/agenda", params: { fecha: a.fecha, cita: a.citaId } });
  };

  const resumen = !cargado ? " " : noLeidos > 0
    ? `${noLeidos} sin leer`
    : avisos.length > 0 ? "Todo leído" : "Todo en orden por ahora";
  const subtitulo = sede ? `${resumen} · ${sede}` : resumen;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader
        crumb="Panel"
        title="Notificaciones"
        subtitle={subtitulo}
        onBack={volver}
        rightAction={noLeidos > 0 ? { icon: "checkmark-done-outline", label: "Marcar todos como leídos", onPress: marcarTodosLeidos } : undefined}
      />

      {!cargado && error ? (
        <ErrorState error={error} onRetry={recargar} />
      ) : !cargado ? (
        <View style={s.cargando}>
          <ActivityIndicator color={Colors.red} size="large" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={s.contenido}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.red} />}
        >
          {error ? (
            // Falló una recarga: se conserva la lista y se avisa.
            <TouchableOpacity
              onPress={recargar}
              activeOpacity={0.8}
              style={[s.banner, { borderColor: "rgba(251,15,5,0.32)", backgroundColor: t.cardSolid }]}
              accessibilityRole="button"
              accessibilityLabel="No se pudieron actualizar los avisos. Reintentar"
            >
              <Ionicons name={esErrorDeRed(error) ? "cloud-offline-outline" : "alert-circle-outline"} size={16} color={Colors.red} />
              <Text style={[s.bannerTexto, { color: t.text }]} numberOfLines={2}>
                No se pudo actualizar: {mensajeError(error)}
              </Text>
              <Text style={s.bannerAccion}>Reintentar</Text>
            </TouchableOpacity>
          ) : null}

          {avisos.length === 0 ? (
            <EmptyState
              icon="notifications-off-outline"
              title="No tienes avisos"
              subtitle={`Aquí verás las citas agendadas en las últimas 2 horas (y si se cancelaron), las de hoy sin confirmar o a punto de empezar y las que no tienen profesional${sede ? `, en ${sede}` : ""}.`}
            />
          ) : (
            <>
              {/* Resumen por grupo, como el portal. */}
              <View style={s.chips}>
                {grupos.map(g => {
                  const c = tono(TONO_GRUPO[g.grupo]);
                  return (
                    <View key={g.grupo} style={[s.chip, { backgroundColor: c + "18" }]}>
                      <Text style={[s.chipTexto, { color: c }]}>{g.titulo} · {g.avisos.length}</Text>
                    </View>
                  );
                })}
              </View>

              {grupos.map((g, gi) => (
                <View key={g.grupo} style={{ marginTop: gi === 0 ? 4 : 18 }}>
                  <View style={s.grupoFila}>
                    <Text style={[s.grupoTitulo, { color: t.subtle }]} accessibilityRole="header">{g.titulo}</Text>
                    <View style={[s.grupoLinea, { backgroundColor: t.line }]} />
                    <Text style={[s.grupoCuenta, { color: t.subtle }]}>{g.avisos.length}</Text>
                  </View>

                  {g.avisos.map((a, i) => {
                    const c = tono(a.tipo);
                    const detalle = a.cuando ? `${a.servicio} · ${a.cuando}` : a.servicio;
                    return (
                      <Animated.View
                        key={a.id}
                        entering={gi * 4 + i < 12 ? FadeInDown.delay((gi * 4 + i) * 40).duration(260) : undefined}
                        style={[s.card, { backgroundColor: t.cardSolid, borderColor: t.line, borderLeftColor: c }]}
                      >
                        <TouchableOpacity
                          style={s.cardToque}
                          onPress={() => abrir(a)}
                          activeOpacity={0.65}
                          accessibilityRole="button"
                          accessibilityLabel={`${a.leido ? "" : "Sin leer. "}${NOMBRE_TIPO[a.tipo]}: ${a.cliente}, ${detalle}. ${a.etiqueta}`}
                          accessibilityHint="Abre la agenda en el día de la cita"
                        >
                          <View style={[s.avatar, { backgroundColor: c + "18", borderColor: c + "40" }]}>
                            <Text style={[s.avatarTexto, { color: c }]}>{iniciales(a.cliente)}</Text>
                          </View>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <View style={s.cardArriba}>
                              <View style={[s.pill, { backgroundColor: c + "14" }]}>
                                <Ionicons name={TONO_TIPO[a.tipo].icono} size={11} color={c} />
                                <Text style={[s.pillTexto, { color: c }]} numberOfLines={1}>{NOMBRE_TIPO[a.tipo]}</Text>
                              </View>
                              <Text style={[s.etiqueta, { color: t.subtle }]} numberOfLines={1}>{a.etiqueta}</Text>
                              {!a.leido ? <View style={s.punto} /> : null}
                            </View>
                            <Text style={[s.cliente, { color: t.ink, fontFamily: a.leido ? Fonts.semibold : Fonts.bold }]} numberOfLines={1}>
                              {a.cliente}
                            </Text>
                            <Text style={[s.detalle, { color: t.muted }]} numberOfLines={1}>{detalle}</Text>
                          </View>
                        </TouchableOpacity>
                        <IconButton
                          icon="close"
                          label={`Descartar aviso de ${a.cliente}`}
                          onPress={() => descartar(a.id)}
                          tone="plain"
                          size={16}
                          color={t.subtle}
                          style={s.descartar}
                        />
                      </Animated.View>
                    );
                  })}
                </View>
              ))}

              <Text style={[s.pie, { color: t.subtle }]}>
                Lo que marcas como leído o descartas se guarda solo en este teléfono.
              </Text>
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function crearEstilos(t: ThemeColors) {
  return StyleSheet.create({
    cargando:     { flex: 1, alignItems: "center", justifyContent: "center" },
    contenido:    { padding: 16, paddingBottom: 48, flexGrow: 1 },

    banner:       { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12 },
    bannerTexto:  { flex: 1, fontSize: 12, fontFamily: Fonts.regular },
    bannerAccion: { fontSize: 12, fontFamily: Fonts.bold, color: Colors.red },

    chips:        { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 14 },
    chip:         { borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 4 },
    chipTexto:    { fontSize: 11, fontFamily: Fonts.bold, letterSpacing: 0.2 },

    grupoFila:    { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
    grupoTitulo:  { fontSize: 10, fontFamily: Fonts.mono, textTransform: "uppercase", letterSpacing: 1.1 },
    grupoLinea:   { flex: 1, height: 1 },
    grupoCuenta:  { fontSize: 10, fontFamily: Fonts.mono },

    card:         { flexDirection: "row", alignItems: "center", borderWidth: 1, borderLeftWidth: 3, borderRadius: 13, marginBottom: 8, overflow: "hidden" },
    cardToque:    { flex: 1, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingLeft: 12, paddingRight: 4, minHeight: 64 },
    avatar:       { width: 38, height: 38, borderRadius: 19, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
    avatarTexto:  { fontSize: 12.5, fontFamily: Fonts.bold },
    cardArriba:   { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
    pill:         { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: Radius.full, paddingHorizontal: 7, paddingVertical: 2, flexShrink: 1 },
    pillTexto:    { fontSize: 10, fontFamily: Fonts.bold, textTransform: "uppercase", letterSpacing: 0.4 },
    etiqueta:     { fontSize: 10.5, fontFamily: Fonts.semibold, flexShrink: 0 },
    punto:        { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.red },
    cliente:      { fontSize: 13.5, lineHeight: 18 },
    detalle:      { fontSize: 12, fontFamily: Fonts.regular, marginTop: 1 },
    descartar:    { marginRight: 6 },

    pie:          { fontSize: 11, fontFamily: Fonts.regular, textAlign: "center", marginTop: 18, lineHeight: 16 },
  });
}
