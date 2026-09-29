import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import Animated, { FadeInRight } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/lib/theme";
import { fmtMoneyFull, fmt12 } from "@/lib/format";
import { cobradoDe, estaCobrada, precioDeLista, ventasDe, type VentaResumen } from "@/lib/ingresos";
import { medioOGenerico } from "@/lib/medios-pago";
import { Colors, Fonts, Radius, Shadow } from "@/constants/theme";
import { IconButton } from "@/components/ui";

export type CitaCobro = {
  id: string;
  appointment_time: string;
  status: string;
  client_id: string | null;
  service_id: string | null;
  location_id: string | null;
  clients: { name: string; phone?: string | null } | null;
  services: { name: string; price: number } | null;
  /** Servicios adicionales: se cobran junto al principal (DIN-23). */
  appointment_services: { price: number }[] | null;
  /**
   * Cobros de la cita, embebidos (se hayan hecho el día que se hayan hecho):
   * así una cita ya cobrada nunca vuelve a ofrecer "Cobrar". Mismo criterio
   * que el Panel y Reportes (lib/ingresos.ts, D10).
   */
  pos_sales: VentaResumen[] | null;
};

/** Lo cobrado por una cita (null = sin cobrar). */
export type VentaCita = { total: number; payment_method: string };

/**
 * Cobro de la cita. Si quedó con dos cobros (casos viejos, DIN-06) se suman,
 * y si se pagaron con métodos distintos se muestra como pago dividido.
 */
export function ventaDeCita(a: CitaCobro): VentaCita | null {
  if (!estaCobrada(a)) return null;
  const metodos = new Set(ventasDe(a).map(v => v.payment_method || "otro"));
  return { total: cobradoDe(a), payment_method: metodos.size === 1 ? [...metodos][0] : "mixto" };
}

/** Citas que todavía se pueden cobrar: activas, o completadas sin cobro (D10: "por cobrar"). */
export function esCobrable(a: Pick<CitaCobro, "status">): boolean {
  return a.status === "pending" || a.status === "confirmed" || a.status === "completed";
}

export function porCobrar(a: CitaCobro): boolean {
  return esCobrable(a) && !estaCobrada(a);
}

function servicioDe(a: CitaCobro): string {
  const extras = a.appointment_services?.length ?? 0;
  return `${a.services?.name ?? "Sin servicio"}${extras > 0 ? ` + ${extras} adicional${extras > 1 ? "es" : ""}` : ""}`;
}

/**
 * Una cita del día en Cobros. Por cobrar: la acción grande es Cobrar y lo
 * demás (No asistió, Cancelar) va en "Más", no al lado del botón principal.
 * Cobrada o cancelada: una fila compacta que no compite con lo pendiente.
 */
export default function TarjetaCita({ cita, onCobrar, onMas, onVerCobro, index }: {
  cita: CitaCobro;
  /** Solo se usan mientras la cita está por cobrar. */
  onCobrar?: () => void;
  onMas?: () => void;
  /** Solo si el cobro es de este día (se tiene su detalle). */
  onVerCobro?: () => void;
  index: number;
}) {
  const { t, mode } = useTheme();
  const venta = ventaDeCita(cita);
  const hora = fmt12(cita.appointment_time.slice(0, 5));
  const cliente = cita.clients?.name ?? "Sin cliente";
  const entrada = FadeInRight.delay(Math.min(index, 8) * 50).duration(300);

  if (venta) {
    const medio = medioOGenerico(venta.payment_method);
    return (
      <Animated.View entering={entrada}>
        <TouchableOpacity
          onPress={onVerCobro}
          disabled={!onVerCobro}
          activeOpacity={0.8}
          style={[s.compacta, { backgroundColor: t.cardSolid, borderColor: t.line }]}
          accessibilityRole={onVerCobro ? "button" : undefined}
          accessibilityLabel={`${cliente}, ${hora}, cobrada ${fmtMoneyFull(venta.total)} en ${medio.label}`}
        >
          <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[s.compactaNombre, { color: t.ink }]} numberOfLines={1}>{cliente}</Text>
            <Text style={[s.compactaSub, { color: t.muted }]} numberOfLines={1}>{hora} · {servicioDe(cita)}</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={[s.compactaMonto, { color: t.ink }]}>{fmtMoneyFull(venta.total)}</Text>
            <Text style={[s.compactaSub, { color: t.muted }]}>{medio.label}</Text>
          </View>
          {onVerCobro ? <Ionicons name="chevron-forward" size={15} color={t.subtle} /> : null}
        </TouchableOpacity>
      </Animated.View>
    );
  }

  if (!esCobrable(cita)) {
    return (
      <Animated.View entering={entrada}>
        <View style={[s.compacta, { backgroundColor: t.cardSolid, borderColor: t.line, opacity: 0.6 }]}>
          <Ionicons name={cita.status === "no_show" ? "person-remove-outline" : "close-circle-outline"} size={18} color={t.subtle} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[s.compactaNombre, { color: t.ink }]} numberOfLines={1}>{cliente}</Text>
            <Text style={[s.compactaSub, { color: t.muted }]} numberOfLines={1}>{hora} · {servicioDe(cita)}</Text>
          </View>
          <Text style={[s.compactaSub, { color: t.muted }]}>{cita.status === "no_show" ? "No asistió" : "Cancelada"}</Text>
        </View>
      </Animated.View>
    );
  }

  const precio = precioDeLista(cita);
  const sinCobro = cita.status === "completed";
  const ambar = mode === "dark" ? "#fbbf24" : "#b45309";
  return (
    <Animated.View entering={entrada}>
      <View style={[s.card, Shadow.sm, { backgroundColor: t.cardSolid, borderColor: t.line }]}>
        <View style={s.arriba}>
          <View style={[s.hora, { backgroundColor: t.chipBg }]}>
            <Ionicons name="time-outline" size={12} color={t.muted} />
            <Text style={[s.horaTxt, { color: t.text }]}>{hora}</Text>
          </View>
          {sinCobro ? (
            <View style={[s.aviso, { backgroundColor: ambar + "18" }]}>
              <Ionicons name="alert-circle-outline" size={12} color={ambar} />
              <Text style={[s.avisoTxt, { color: ambar }]}>Completada sin cobro</Text>
            </View>
          ) : null}
          <View style={{ flex: 1 }} />
          <IconButton icon="ellipsis-horizontal" label={`Más opciones para la cita de ${cliente}`} onPress={() => onMas?.()} size={17} color={t.muted} tone="plain" />
        </View>
        <Text style={[s.nombre, { color: t.ink }]} numberOfLines={1}>{cliente}</Text>
        <Text style={[s.servicio, { color: t.muted }]} numberOfLines={1}>{servicioDe(cita)}</Text>
        <TouchableOpacity
          onPress={onCobrar}
          style={s.cobrar}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={`Cobrar ${precio > 0 ? fmtMoneyFull(precio) : ""} a ${cliente}`}
        >
          <Ionicons name="card-outline" size={16} color="white" />
          <Text style={s.cobrarTxt}>{precio > 0 ? `Cobrar ${fmtMoneyFull(precio)}` : "Cobrar"}</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  card:           { borderWidth: 1, borderRadius: Radius.lg, padding: 14, paddingBottom: 12, marginBottom: 10 },
  arriba:         { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8, marginRight: -6, marginTop: -4 },
  hora:           { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 5 },
  horaTxt:        { fontSize: 12, fontFamily: Fonts.bold },
  aviso:          { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: Radius.full, paddingHorizontal: 9, paddingVertical: 5 },
  avisoTxt:       { fontSize: 11, fontFamily: Fonts.bold },
  nombre:         { fontSize: 16, fontFamily: Fonts.bold },
  servicio:       { fontSize: 12.5, fontFamily: Fonts.regular, marginTop: 2 },
  cobrar:         { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 12, borderRadius: Radius.md, paddingVertical: 12, backgroundColor: Colors.red },
  cobrarTxt:      { fontSize: 14, fontFamily: Fonts.bold, color: "white" },
  compacta:       { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: Radius.md, paddingVertical: 11, paddingHorizontal: 12, marginBottom: 8 },
  compactaNombre: { fontSize: 14, fontFamily: Fonts.semibold },
  compactaSub:    { fontSize: 11.5, fontFamily: Fonts.regular, marginTop: 1 },
  compactaMonto:  { fontSize: 14, fontFamily: Fonts.bold },
});
