import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/lib/theme";
import { fmtMoneyFull, fmt12 } from "@/lib/format";
import { horaLocalDe } from "@/lib/tz";
import { medioOGenerico } from "@/lib/medios-pago";
import { Fonts, Radius, Shadow } from "@/constants/theme";
import { nombresDeItems } from "@/lib/recibo";
import { lineasDePago } from "@/lib/ingresos";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

/** Lo mínimo de un cobro (pos_sales) para listarlo. */
export type CobroFila = {
  id: string;
  created_at: string;
  total: number;
  payment_method: string;
  /** Desglose del pago dividido ([{ method, amount }]); null si fue un solo medio. */
  payments?: unknown;
  note: string | null;
  clients: { name: string; phone?: string | null } | null;
  pos_sale_items: { name: string; price: number; quantity: number }[] | null;
};

/**
 * La nota que escribió alguien. Por defecto la nota de un cobro son los mismos
 * ítems («Corte + Barba»): esa no cuenta como nota, es el detalle.
 */
export function notaPropiaDe(c: Pick<CobroFila, "note" | "pos_sale_items">): string | null {
  const nota = c.note?.trim() ?? "";
  return nota && nota !== nombresDeItems(c.pos_sale_items ?? []) ? nota : null;
}

/** Qué se cobró: los ítems o, sin ítems, la nota. */
export function detalleDe(c: Pick<CobroFila, "note" | "pos_sale_items">): string | null {
  const items = c.pos_sale_items ?? [];
  if (items.length > 0) return nombresDeItems(items);
  return c.note?.trim() || null;
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
  // Pago dividido: «Efectivo $10.000 + QR $50.000» en vez de solo «Dividido».
  const lineas = lineasDePago(cobro).filter(l => l.amount > 0);
  const mixto = lineas.length > 1;
  const medioTxt = mixto
    ? lineas.map(l => `${medioOGenerico(l.method).label} ${fmtMoneyFull(l.amount)}`).join(" + ")
    : medio.label;
  const quien = cliente ?? cobro.clients?.name ?? null;
  const detalle = detalleDe(cobro);
  const nota = notaPropiaDe(cobro);
  const hora = fmt12(horaLocalDe(cobro.created_at, timezone));

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[s.card, Shadow.sm, { backgroundColor: t.cardSolid, borderColor: t.line }]}
      accessibilityRole="button"
      accessibilityLabel={`${quien ?? "Venta directa"}, ${fmtMoneyFull(Number(cobro.total))}${mixto ? `, pago dividido: ${medioTxt}` : ` en ${medio.label}`}, ${hora}.${nota ? ` Nota: ${nota}.` : ""} Ver detalle`}
    >
      <View style={[s.icono, { backgroundColor: medio.color + "18" }]}>
        <Ionicons name={medio.icon} size={17} color={medio.color} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[s.quien, { color: t.ink }]} numberOfLines={1}>{quien ?? "Venta directa"}</Text>
        {mixto ? (
          <>
            <View style={s.mixtoFila}>
              {lineas.map((l, i) => {
                const m = medioOGenerico(l.method);
                return (
                  <View key={`${l.method}-${i}`} style={[s.mixtoChip, { backgroundColor: m.color + "14" }]}>
                    <Ionicons name={m.icon} size={10} color={m.color} />
                    <Text style={[s.mixtoTxt, { color: m.color }]} numberOfLines={1}>{m.label} {fmtMoneyFull(l.amount)}</Text>
                  </View>
                );
              })}
            </View>
            {detalle ? <Text style={[s.detalle, { color: t.muted }]} numberOfLines={1}>{detalle}</Text> : null}
          </>
        ) : (
          <Text style={[s.detalle, { color: t.muted }]} numberOfLines={1}>
            {medioTxt}{detalle ? ` · ${detalle}` : ""}
          </Text>
        )}
        {nota ? (
          // La nota del cobro a la vista, sin abrir el detalle.
          <View style={s.notaFila}>
            <Ionicons name="chatbox-ellipses-outline" size={11} color="#b45309" />
            <Text style={s.notaTxt} numberOfLines={2}>{nota}</Text>
          </View>
        ) : null}
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
  mixtoFila:   { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4 },
  mixtoChip:   { flexDirection: "row", alignItems: "center", gap: 3, borderRadius: Radius.full, paddingHorizontal: 7, paddingVertical: 2 },
  mixtoTxt:    { fontSize: 11, fontFamily: Fonts.semibold },
  notaFila:    { flexDirection: "row", alignItems: "flex-start", gap: 5, marginTop: 4 },
  notaTxt:     { flex: 1, fontSize: 12, fontFamily: Fonts.regular, color: "#b45309", lineHeight: 16 },
  etiquetas:   { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  etiqueta:    { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3, maxWidth: 170 },
  etiquetaTxt: { fontSize: 10.5, fontFamily: Fonts.semibold },
  derecha:     { alignItems: "flex-end", gap: 2 },
  monto:       { fontSize: 15, fontFamily: Fonts.bold, letterSpacing: -0.2 },
  hora:        { fontSize: 11, fontFamily: Fonts.semibold },
});
