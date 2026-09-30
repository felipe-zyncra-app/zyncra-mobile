import { useMemo, useState } from "react";
import { View, Text, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl, Alert } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "@/lib/supabase";
import { enviarCorreoCita } from "@/lib/correo-cita";
import { Colors, Fonts, Radius } from "@/constants/theme";
import { STATUS_META } from "@/constants/status";
import { useTheme, type ThemeColors } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { getActiveLocationId } from "@/lib/active-location";
import { esErrorDeRed, exigirFilas, mensajeError } from "@/lib/db";
import { useGuardRespuestas, useRecarga } from "@/lib/useRecarga";
import { reprogramarRecordatorioCita } from "@/lib/notifications";
import { fmt12, fmtMoneyFull } from "@/lib/format";
import { precioDeLista } from "@/lib/ingresos";
import { fmtDia, sumarDias } from "@/lib/tz";
import {
  agruparPorCobrar, estadoPorCobrar, fechaPorCobrar, porDia, serviciosDe, traerPorCobrarDetalle,
  type CitaPorCobrarDetalle,
} from "@/lib/porCobrar";
import { MonoTag, ScreenHeader } from "@/components/ui";
import ErrorState from "@/components/ErrorState";
import EmptyState from "@/components/EmptyState";
import SedeChip, { cargarListaSedes, nombreSede, sedeDeFila, type SedeLite } from "@/components/SedeChip";
import ChargeSheet, { type LinkedAppt } from "@/components/ChargeSheet";
import { confirmar } from "@/components/agenda/tipos";

/**
 * Por cobrar: de qué citas es la cifra de la tarjeta del Panel. La consulta y
 * la suma son las mismas (lib/porCobrar.ts), así que el total de arriba es
 * siempre el de la tarjeta.
 *
 *  · Vencidas: ya pasaron y nadie las cobró. Se cobran aquí mismo, o se
 *    marcan No asistió / Cancelada para que salgan (y dejen de inflar la cifra).
 *  · Hoy: se cobran aquí mismo.
 *  · Próximas: por día; tocar una abre la Agenda en ese día con su detalle.
 *
 * D10: aquí no se ofrece "Completada" (completar = cobrar) y una cita ya
 * cobrada no aparece (ni se le cambia el estado: se revisa antes de guardar).
 */

type Seccion = "vencidas" | "hoy" | "proximas";

/** Los dos estados que sacan una vencida de la lista sin cobrarla. */
type EstadoCaida = "no_show" | "cancelled";

type Datos = {
  citas: CitaPorCobrarDetalle[];
  sedes: SedeLite[];
  /** Nombre de la sede activa, solo si el negocio tiene más de una. */
  sede: string | null;
};

type Fila =
  | { tipo: "seccion"; key: string; seccion: Seccion; titulo: string; total: number; cantidad: number; ayuda?: string }
  | { tipo: "dia"; key: string; dia: string; total: number; cantidad: number }
  | { tipo: "cita"; key: string; seccion: Seccion; cita: CitaPorCobrarDetalle };

// Mismo tono que la campana: en oscuro, la variante clara para que el texto
// pequeño se lea sobre el fondo oscuro.
const TONOS = {
  vencido:  { claro: "#dc2626", oscuro: "#f87171" },
  hoy:      { claro: "#2563eb", oscuro: "#60a5fa" },
  pendiente:{ claro: "#b45309", oscuro: "#fbbf24" },
} as const;

async function cargarDatos(tenantId: string): Promise<Datos> {
  // La sede activa, como el Panel: la cifra de la tarjeta es de esa sede.
  const loc = await getActiveLocationId(tenantId);
  const [citas, sedes] = await Promise.all([
    traerPorCobrarDetalle(tenantId, loc),
    // Solo para rotular: si falla, la lista se muestra igual sin el nombre.
    cargarListaSedes(tenantId, loc),
  ]);
  return { citas, sedes, sede: nombreSede(sedes, loc) };
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
/** Solo la primera letra: textTransform "capitalize" dejaría "Martes 29 De Septiembre". */
const conMayuscula = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1);

export default function PorCobrarScreen() {
  const router = useRouter();
  const { t, mode } = useTheme();
  const s = useMemo(() => crearEstilos(t), [t]);
  const { tenantId } = useAuth();
  const { tenant, timezone, ready } = useTenant();
  const guard = useGuardRespuestas();

  const [datos, setDatos]           = useState<Datos | null>(null);
  const [error, setError]           = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [cobro, setCobro]           = useState<LinkedAppt | null>(null);
  /** Cambio de estado en curso (cita y estado): el spinner va en ESE botón y los demás esperan. */
  const [ocupada, setOcupada]       = useState<{ id: string; status: EstadoCaida } | null>(null);

  // Carga al enfocar, al volver a primer plano, a medianoche del negocio y al
  // cambiar de sede (useRecarga), con la zona real del negocio.
  const { hoy, recargar } = useRecarga(async () => {
    if (!tenantId) return;
    const turno = guard.nuevo();
    try {
      const d = await cargarDatos(tenantId);
      if (!turno.vigente()) return;
      setDatos(d);
      setError(null);
    } catch (e) {
      if (turno.vigente()) setError(e);
    }
  }, [tenantId, timezone], { timeZone: timezone, habilitado: !!tenantId && ready });

  const onRefresh = async () => { setRefreshing(true); await recargar(); setRefreshing(false); };

  const volver = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(admin)/(tabs)");
  };

  const tono = (k: keyof typeof TONOS) => (mode === "dark" ? TONOS[k].oscuro : TONOS[k].claro);

  // `hoy` es el día del negocio (useRecarga): después de las 7 PM de Bogotá
  // una cita de esta mañana sigue en "Hoy", no en "Vencidas".
  const resumen = useMemo(() => agruparPorCobrar(datos?.citas ?? [], hoy), [datos, hoy]);

  const filas = useMemo<Fila[]>(() => {
    const out: Fila[] = [];
    const { vencidas, deHoy, proximas } = resumen;
    if (vencidas.citas.length > 0) {
      out.push({
        tipo: "seccion", key: "s-vencidas", seccion: "vencidas", titulo: "Vencidas",
        total: vencidas.total, cantidad: vencidas.citas.length,
        ayuda: "Ya pasaron y nadie las cobró: cóbralas o márcalas como No asistió o Cancelada para que salgan de aquí.",
      });
      for (const c of vencidas.citas) out.push({ tipo: "cita", key: c.id, seccion: "vencidas", cita: c });
    }
    if (deHoy.citas.length > 0) {
      out.push({ tipo: "seccion", key: "s-hoy", seccion: "hoy", titulo: "Hoy", total: deHoy.total, cantidad: deHoy.citas.length });
      for (const c of deHoy.citas) out.push({ tipo: "cita", key: c.id, seccion: "hoy", cita: c });
    }
    if (proximas.citas.length > 0) {
      out.push({
        tipo: "seccion", key: "s-proximas", seccion: "proximas", titulo: "Próximas",
        total: proximas.total, cantidad: proximas.citas.length,
        ayuda: "Toca una cita para abrirla en la Agenda.",
      });
      for (const g of porDia(proximas.citas)) {
        out.push({ tipo: "dia", key: `d-${g.dia}`, dia: g.dia, total: g.total, cantidad: g.citas.length });
        for (const c of g.citas) out.push({ tipo: "cita", key: c.id, seccion: "proximas", cita: c });
      }
    }
    return out;
  }, [resumen]);

  /** Saca la cita de la lista al instante; la recarga confirma con el servidor. */
  const quitar = (id: string) =>
    setDatos(prev => (prev ? { ...prev, citas: prev.citas.filter(c => c.id !== id) } : prev));

  const nombreCliente = (c: CitaPorCobrarDetalle) => c.clients?.name?.trim() || "Sin cliente";
  const cuando = (c: CitaPorCobrarDetalle) => `${fechaPorCobrar(c.appointment_date, hoy)}, ${fmt12(c.appointment_time)}`;

  const abrirCobro = (c: CitaPorCobrarDetalle) => {
    setCobro({
      id: c.id, clientId: c.client_id, clientName: c.clients?.name ?? null, clientPhone: c.clients?.phone ?? null,
      serviceId: c.service_id, serviceName: c.services?.name ?? null, servicePrice: Number(c.services?.price ?? 0),
      locationId: c.location_id ?? null, time: c.appointment_time,
    });
  };

  /** Guarda el estado. false si no se pudo (ya avisó) o si resultó cobrada. */
  const guardarEstado = async (negocio: string, c: CitaPorCobrarDetalle, status: EstadoCaida): Promise<boolean> => {
    try {
      // Revalidar que siga sin cobro: otro teléfono o el portal pudo cobrarla
      // mientras tanto, y una cita cobrada no cambia de estado (D10).
      const venta = await supabase.from("pos_sales").select("id").eq("appointment_id", c.id).limit(1);
      if (venta.error) {
        Alert.alert("No se pudo cambiar el estado", mensajeError(venta.error, "No se pudo revisar el cobro de la cita"));
        return false;
      }
      if ((venta.data ?? []).length > 0) {
        Alert.alert("Esta cita ya se cobró", "Alguien la cobró mientras tanto, así que ya no está por cobrar.");
        quitar(c.id);
        recargar();
        return false;
      }
      exigirFilas(
        await supabase.from("appointments").update({ status }).eq("id", c.id).eq("tenant_id", negocio).select("id"),
        "No se pudo cambiar el estado de la cita",
      );
      // Correo de cancelación al cliente, como el calendario web. No se espera.
      if (status === "cancelled") void enviarCorreoCita("cancellation", c.id);
      return true;
    } catch (e) {
      Alert.alert("No se pudo cambiar el estado", mensajeError(e));
      return false;
    }
  };

  const marcar = async (c: CitaPorCobrarDetalle, status: EstadoCaida) => {
    if (!tenantId || ocupada) return;
    const etiqueta = STATUS_META[status].label;
    const ok = await confirmar(
      `¿Marcar como ${etiqueta}?`,
      `${nombreCliente(c)} · ${cuando(c)}. Sale de Por cobrar y no suma a tus ingresos.`,
      `Marcar ${etiqueta}`,
      true,
    );
    if (!ok) return;
    setOcupada({ id: c.id, status });
    const guardado = await guardarEstado(tenantId, c, status);
    setOcupada(null);
    if (!guardado) return;

    // Recordatorio solo DESPUÉS de que el cambio se guardó (como la Agenda):
    // cancelada o no asistió ya no tiene aviso pendiente.
    reprogramarRecordatorioCita(tenantId, {
      id: c.id,
      date: c.appointment_date,
      time: c.appointment_time,
      clientName: c.clients?.name ?? null,
      serviceName: c.services?.name ?? null,
      status,
    }, timezone).catch(() => {});

    quitar(c.id);
    recargar();
  };

  const abrirEnAgenda = (c: CitaPorCobrarDetalle) => {
    // Vuelve a las pestañas (no apila otra copia) y la Agenda abre ese día con el detalle.
    router.dismissTo({ pathname: "/(admin)/(tabs)/agenda", params: { fecha: c.appointment_date, cita: c.id } });
  };

  // ── Piezas de la lista ──────────────────────────────────────────────────────

  const encabezado = (
    <View>
      {error && datos ? (
        // Falló una recarga: se conserva la lista y se avisa.
        <TouchableOpacity
          onPress={recargar}
          activeOpacity={0.8}
          style={[s.banner, { borderColor: "rgba(251,15,5,0.32)", backgroundColor: t.cardSolid }]}
          accessibilityRole="button"
          accessibilityLabel="No se pudo actualizar lo que está por cobrar. Reintentar"
        >
          <Ionicons name={esErrorDeRed(error) ? "cloud-offline-outline" : "alert-circle-outline"} size={16} color={Colors.red} />
          <Text style={[s.bannerTexto, { color: t.text }]} numberOfLines={2}>
            No se pudo actualizar: {mensajeError(error)}
          </Text>
          <Text style={s.bannerAccion}>Reintentar</Text>
        </TouchableOpacity>
      ) : null}

      {datos?.sede ? <View style={s.sede}><SedeChip nombre={datos.sede} /></View> : null}

      {resumen.cantidad > 0 ? (
        <Animated.View entering={FadeInDown.duration(350)} style={[s.totalCard, { backgroundColor: t.cardSolid, borderColor: t.line }]}>
          <MonoTag>Total por cobrar</MonoTag>
          <Text
            style={[s.total, { color: t.ink }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            accessibilityLabel={`Total por cobrar: ${fmtMoneyFull(resumen.total)}, ${plural(resumen.cantidad, "cita", "citas")}`}
          >
            {fmtMoneyFull(resumen.total)}
          </Text>
          <Text style={[s.explica, { color: t.muted }]}>
            Citas agendadas o atendidas que todavía no tienen cobro, de cualquier fecha. No depende del periodo del Panel.
          </Text>
          <View style={s.chips}>
            <Chip color={tono("vencido")} texto={`Vencido ${fmtMoneyFull(resumen.vencidas.total)} (${resumen.vencidas.citas.length})`} />
            <Chip color={tono("hoy")} texto={`Hoy ${fmtMoneyFull(resumen.deHoy.total)} (${resumen.deHoy.citas.length})`} />
            <Chip color={t.muted} texto={`Próximas ${fmtMoneyFull(resumen.proximas.total)} (${resumen.proximas.citas.length})`} />
          </View>
        </Animated.View>
      ) : null}
    </View>
  );

  const pintarFila = ({ item }: { item: Fila }) => {
    if (item.tipo === "seccion") {
      const c = item.seccion === "vencidas" ? tono("vencido") : item.seccion === "hoy" ? tono("hoy") : t.subtle;
      return (
        <View style={s.seccion}>
          <View style={s.seccionFila}>
            <Text style={[s.seccionTitulo, { color: c }]} accessibilityRole="header">{item.titulo}</Text>
            <View style={[s.seccionLinea, { backgroundColor: t.line }]} />
            <Text style={[s.seccionCuenta, { color: t.subtle }]}>{fmtMoneyFull(item.total)} · {item.cantidad}</Text>
          </View>
          {item.ayuda ? <Text style={[s.ayuda, { color: t.muted }]}>{item.ayuda}</Text> : null}
        </View>
      );
    }
    if (item.tipo === "dia") {
      const manana = item.dia === sumarDias(hoy, 1);
      return (
        <View style={s.dia}>
          <Text style={[s.diaTitulo, { color: t.ink }]}>
            {manana ? `Mañana · ${fmtDia(item.dia, "largo")}` : conMayuscula(fmtDia(item.dia, "largo"))}
          </Text>
          <Text style={[s.diaCuenta, { color: t.subtle }]}>
            {fmtMoneyFull(item.total)} · {plural(item.cantidad, "cita", "citas")}
          </Text>
        </View>
      );
    }
    return (
      <FilaCita
        cita={item.cita}
        seccion={item.seccion}
        hoy={hoy}
        sede={datos?.sede ? sedeDeFila(datos.sedes, item.cita.location_id) : null}
        ocupadaCon={ocupada?.id === item.cita.id ? ocupada.status : null}
        bloqueada={!!ocupada}
        tono={tono}
        onCobrar={() => abrirCobro(item.cita)}
        onMarcar={st => marcar(item.cita, st)}
        onAbrir={() => abrirEnAgenda(item.cita)}
      />
    );
  };

  const subtitulo = !datos ? " " : resumen.cantidad > 0
    ? `${plural(resumen.cantidad, "cita", "citas")} sin cobro`
    : "Todo cobrado";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader crumb="Panel" title="Por cobrar" subtitle={subtitulo} onBack={volver} />

      {error && !datos ? (
        <ErrorState error={error} onRetry={recargar} />
      ) : !datos ? (
        <View style={s.cargando}>
          <ActivityIndicator color={Colors.red} size="large" />
        </View>
      ) : (
        <FlatList
          data={filas}
          keyExtractor={f => f.key}
          renderItem={pintarFila}
          ListHeaderComponent={encabezado}
          ListEmptyComponent={(
            <EmptyState
              icon="checkmark-done-circle-outline"
              title="No tienes nada por cobrar"
              subtitle="Cuando una cita agendada o atendida quede sin cobro, aparecerá aquí."
            />
          )}
          contentContainerStyle={s.contenido}
          initialNumToRender={20}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.red} />}
        />
      )}

      {tenantId && (
        <ChargeSheet
          visible={!!cobro}
          tenantId={tenantId}
          target={cobro ? { kind: "appointment", appt: cobro } : null}
          // Al cerrar se recarga siempre: si la hoja encontró la cita YA cobrada
          // (otro teléfono o el portal) y seguía "completada", no llama onSaved
          // y la fila se quedaba aquí con su "Cobrar".
          onClose={() => { setCobro(null); recargar(); }}
          // Cobrada: sale de la lista al instante y los totales se recalculan.
          onSaved={() => { if (cobro) quitar(cobro.id); recargar(); }}
          businessName={tenant?.name ?? null}
        />
      )}
    </SafeAreaView>
  );
}

// ─── Chip del resumen ─────────────────────────────────────────────────────────

function Chip({ color, texto }: { color: string; texto: string }) {
  return (
    <View style={[cs.chip, { backgroundColor: color + "18" }]}>
      <Text style={[cs.texto, { color }]}>{texto}</Text>
    </View>
  );
}

const cs = StyleSheet.create({
  chip:  { borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 4 },
  texto: { fontSize: 11.5, fontFamily: Fonts.bold, letterSpacing: 0.1 },
});

// ─── Fila de una cita ─────────────────────────────────────────────────────────

function FilaCita({ cita, seccion, hoy, sede, ocupadaCon, bloqueada, tono, onCobrar, onMarcar, onAbrir }: {
  cita: CitaPorCobrarDetalle;
  seccion: Seccion;
  hoy: string;
  /** Sede de la cita, solo si el negocio tiene varias. */
  sede: string | null;
  /** Estado que se está guardando para ESTA cita (su botón muestra el spinner). */
  ocupadaCon: EstadoCaida | null;
  /** Hay un cambio de estado en curso (en esta u otra cita): no se aceptan más toques. */
  bloqueada: boolean;
  tono: (k: keyof typeof TONOS) => string;
  onCobrar: () => void;
  onMarcar: (status: EstadoCaida) => void;
  onAbrir: () => void;
}) {
  const { t } = useTheme();
  const vencida = seccion === "vencidas";
  const cliente = cita.clients?.name?.trim() || "Sin cliente";
  const servicios = serviciosDe(cita);
  const pro = cita.professionals?.name?.trim() || null;
  const monto = fmtMoneyFull(precioDeLista(cita));
  const hora = fmt12(cita.appointment_time);
  // Próximas van bajo el título de su día: basta la hora.
  const cuando = seccion === "vencidas" ? `${fechaPorCobrar(cita.appointment_date, hoy)} · ${hora}` : hora;
  // El lector de pantalla no ve el título del día al lado: la fila dice su día.
  const cuandoA11y = seccion === "hoy" ? `Hoy, ${hora}` : `${fechaPorCobrar(cita.appointment_date, hoy)}, ${hora}`;
  const estado = estadoPorCobrar(cita.status, vencida);
  const colorEstado = vencida ? tono("vencido") : cita.status === "confirmed" ? tono("hoy") : tono("pendiente");
  const detalle = [servicios, pro ? `con ${pro}` : null, sede].filter(Boolean).join(" · ");
  const borde = vencida ? tono("vencido") : seccion === "hoy" ? tono("hoy") : t.lineStrong;
  const resumen = `${cuandoA11y}. ${cliente}. ${detalle}. ${monto}. ${estado}`;

  const cuerpo = (
    <>
      <View style={f.arriba}>
        <Text style={[f.cuando, { color: t.subtle }]} numberOfLines={1}>{cuando}</Text>
        <Text style={[f.monto, { color: t.ink }]} numberOfLines={1}>{monto}</Text>
      </View>
      <Text style={[f.cliente, { color: t.ink }]} numberOfLines={1}>{cliente}</Text>
      <Text style={[f.detalle, { color: t.muted }]} numberOfLines={2}>{detalle}</Text>
      <View style={[f.pill, { backgroundColor: colorEstado + "18" }]}>
        <View style={[f.pillPunto, { backgroundColor: colorEstado }]} />
        <Text style={[f.pillTexto, { color: colorEstado }]}>{estado}</Text>
      </View>
    </>
  );

  if (seccion === "proximas") {
    return (
      <TouchableOpacity
        style={[f.card, { backgroundColor: t.cardSolid, borderColor: t.line, borderLeftColor: borde }]}
        onPress={onAbrir}
        activeOpacity={0.65}
        accessibilityRole="button"
        accessibilityLabel={resumen}
        accessibilityHint="Abre la agenda en el día de la cita"
      >
        <View style={f.proximaFila}>
          <View style={{ flex: 1, minWidth: 0 }}>{cuerpo}</View>
          <Ionicons name="chevron-forward" size={16} color={t.subtle} />
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <View style={[f.card, { backgroundColor: t.cardSolid, borderColor: t.line, borderLeftColor: borde }]}>
      <View accessible accessibilityLabel={`${vencida ? "Vencida: " : ""}${resumen}`}>{cuerpo}</View>
      <View style={f.acciones}>
        <TouchableOpacity
          onPress={onCobrar}
          disabled={bloqueada}
          activeOpacity={0.85}
          hitSlop={HIT_SLOP}
          style={[f.boton, f.botonCobrar, bloqueada && { opacity: 0.5 }]}
          accessibilityRole="button"
          accessibilityLabel={`Cobrar la cita de ${cliente}, ${monto}`}
          accessibilityState={{ disabled: bloqueada }}
        >
          <Ionicons name="card-outline" size={14} color="white" />
          <Text style={f.botonCobrarTexto}>Cobrar</Text>
        </TouchableOpacity>
        {vencida ? (
          <>
            <BotonEstado
              texto="No asistió"
              icono="alert-circle-outline"
              label={`Marcar la cita de ${cliente} como No asistió`}
              ocupado={ocupadaCon === "no_show"}
              bloqueado={bloqueada}
              onPress={() => onMarcar("no_show")}
            />
            <BotonEstado
              texto="Cancelada"
              icono="close-circle-outline"
              label={`Marcar la cita de ${cliente} como Cancelada`}
              ocupado={ocupadaCon === "cancelled"}
              bloqueado={bloqueada}
              onPress={() => onMarcar("cancelled")}
            />
          </>
        ) : null}
      </View>
    </View>
  );
}

function BotonEstado({ texto, icono, label, ocupado, bloqueado, onPress }: {
  texto: string;
  icono: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  ocupado: boolean;
  bloqueado: boolean;
  onPress: () => void;
}) {
  const { t } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={bloqueado}
      activeOpacity={0.7}
      hitSlop={HIT_SLOP}
      style={[f.boton, { backgroundColor: t.chipBg, borderColor: t.lineStrong, borderWidth: 1 }, bloqueado && { opacity: 0.5 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: bloqueado, busy: ocupado }}
    >
      {ocupado
        ? <ActivityIndicator size="small" color={t.muted} />
        : <Ionicons name={icono} size={14} color={t.muted} />}
      <Text style={[f.botonTexto, { color: t.text }]}>{texto}</Text>
    </TouchableOpacity>
  );
}

/** Los botones miden 36 pt; con este margen el área táctil llega a 44 pt. */
const HIT_SLOP = { top: 4, bottom: 4, left: 2, right: 2 };

const f = StyleSheet.create({
  card:        { borderWidth: 1, borderLeftWidth: 3, borderRadius: 13, marginBottom: 8, paddingVertical: 12, paddingHorizontal: 12 },
  proximaFila: { flexDirection: "row", alignItems: "center", gap: 8 },
  arriba:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 4 },
  cuando:      { fontSize: 11, fontFamily: Fonts.mono, flexShrink: 1 },
  monto:       { fontSize: 14, fontFamily: Fonts.bold, letterSpacing: -0.2 },
  cliente:     { fontSize: 14, fontFamily: Fonts.semibold, lineHeight: 19 },
  detalle:     { fontSize: 12, fontFamily: Fonts.regular, marginTop: 1, lineHeight: 16 },
  pill:        { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 2.5, marginTop: 7 },
  pillPunto:   { width: 5, height: 5, borderRadius: 2.5 },
  pillTexto:   { fontSize: 10.5, fontFamily: Fonts.semibold },
  acciones:    { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 11 },
  boton:       { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, minHeight: 36, borderRadius: Radius.sm + 2, paddingHorizontal: 12 },
  // Rojo de marca con texto blanco: se lee igual en claro y en oscuro.
  botonCobrar: { backgroundColor: Colors.red },
  botonCobrarTexto: { fontSize: 12.5, fontFamily: Fonts.bold, color: "white" },
  botonTexto:  { fontSize: 12.5, fontFamily: Fonts.semibold },
});

function crearEstilos(t: ThemeColors) {
  return StyleSheet.create({
    cargando:     { flex: 1, alignItems: "center", justifyContent: "center" },
    contenido:    { padding: 16, paddingBottom: 48, flexGrow: 1 },

    banner:       { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12 },
    bannerTexto:  { flex: 1, fontSize: 12, fontFamily: Fonts.regular },
    bannerAccion: { fontSize: 12, fontFamily: Fonts.bold, color: Colors.red },

    sede:         { marginBottom: 12 },

    totalCard:    { borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 6 },
    total:        { fontSize: 30, fontFamily: Fonts.bold, letterSpacing: -1, lineHeight: 34, marginTop: 6 },
    explica:      { fontSize: 12.5, fontFamily: Fonts.regular, lineHeight: 18, marginTop: 6 },
    chips:        { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12 },

    seccion:      { marginTop: 18, marginBottom: 8 },
    seccionFila:  { flexDirection: "row", alignItems: "center", gap: 8 },
    seccionTitulo:{ fontSize: 10.5, fontFamily: Fonts.monoBold, textTransform: "uppercase", letterSpacing: 1.1 },
    seccionLinea: { flex: 1, height: 1 },
    seccionCuenta:{ fontSize: 10.5, fontFamily: Fonts.mono },
    ayuda:        { fontSize: 12, fontFamily: Fonts.regular, lineHeight: 17, marginTop: 6 },

    dia:          { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginTop: 6, marginBottom: 6 },
    diaTitulo:    { fontSize: 13, fontFamily: Fonts.semibold, flexShrink: 1 },
    diaCuenta:    { fontSize: 11, fontFamily: Fonts.mono },
  });
}
