import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/lib/theme";
import { fmtMoneyFull, fmt12 } from "@/lib/format";
import { horaLocalDe } from "@/lib/tz";
import { medioOGenerico } from "@/lib/medios-pago";
import { Fonts, Radius, Shadow } from "@/constants/theme";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

/** Lo mínimo de un cobro (pos_sales) para listarlo. */
export type CobroFila = {
  id: string;
  created_at: string;
  total: number;
  payment_method: string;
  note: string | null;
  clients: { name: string; phone?: string | null } | null;
  pos_sale_items: { name: string; price: number; quantity: number }[] | null;
};

/** Qué se cobró: la nota (que por defecto son los ítems) o el primer ítem. */
export function detalleDe(c: Pick<CobroFila, "note" | "pos_sale_items">): string | null {
  return c.note?.trim() || c.pos_sale_items?.[0]?.name || null;
}

/**
 * Un cobro en una lista (pestaña Cobros e Historial). Tocarlo abre su
 * detalle, que es donde viven Recibo, Facturar y Anular: antes cada tarjeta
 * llevaba una papelera a un toque de distancia.
 */
export default function FilaCobro({ cobro, cliente, timezone, etiquetas, onPress }: {
  cobro: CobroFila;
  /** Nombre a mostrar si se conoce por la cita; si no, el cliente de la venta. */
  cliente?: string | null;
  timezone: string;
  /** Sede, factura…: se muestran debajo como etiquetas pequeñas. */
  etiquetas?: { icon: IoniconName; texto: string }[];
  onPress: () => void;
}) {
  const { t } = useTheme();
  const medio = medioOGenerico(cobro.payment_method);
  const quien = cliente ?? cobro.clients?.name ?? null;
  const detalle = detalleDe(cobro);
  const hora = fmt12(horaLocalDe(cobro.created_at, timezone));

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[s.card, Shadow.sm, { backgroundColor: t.cardSolid, borderColor: t.line }]}
      accessibilityRole="button"
      accessibilityLabel={`${quien ?? "Venta directa"}, ${fmtMoneyFull(Number(cobro.total))} en ${medio.label}, ${hora}. Ver detalle`}
    >
      <View style={[s.icono, { backgroundColor: medio.color + "18" }]}>
        <Ionicons name={medio.icon} size={17} color={medio.color} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[s.quien, { color: t.ink }]} numberOfLines={1}>{quien ?? "Venta directa"}</Text>
        <Text style={[s.detalle, { color: t.muted }]} numberOfLines={1}>
          {medio.label}{detalle ? ` · ${detalle}` : ""}
        </Text>
        {etiquetas && etiquetas.length > 0 ? (
          <View style={s.etiquetas}>
            {etiquetas.map(e => (
              <View key={e.texto} style={[s.etiqueta, { backgroundColor: t.chipBg }]}>
                <Ionicons name={e.icon} size={10} color={t.muted} />
                <Text style={[s.etiquetaTxt, { color: t.muted }]} numberOfLines={1}>{e.texto}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
      <View style={s.derecha}>
        <Text style={[s.monto, { color: t.ink }]}>{fmtMoneyFull(Number(cobro.total))}</Text>
        <Text style={[s.hora, { color: t.subtle }]}>{hora}</Text>
      </View>
      <Ionicons name="chevron-forward" size={15} color={t.subtle} />
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  card:        { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: Radius.lg, paddingVertical: 12, paddingLeft: 12, paddingRight: 10, marginBottom: 8 },
  icono:       { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  quien:       { fontSize: 14.5, fontFamily: Fonts.bold },
  detalle:     { fontSize: 12, fontFamily: Fonts.regular, marginTop: 2 },
  etiquetas:   { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  etiqueta:    { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3, maxWidth: 170 },
  etiquetaTxt: { fontSize: 10.5, fontFamily: Fonts.semibold },
  derecha:     { alignItems: "flex-end", gap: 2 },
  monto:       { fontSize: 15, fontFamily: Fonts.bold, letterSpacing: -0.2 },
  hora:        { fontSize: 11, fontFamily: Fonts.semibold },
});
