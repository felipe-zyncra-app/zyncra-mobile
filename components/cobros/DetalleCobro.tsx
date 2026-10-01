import { useEffect, useState } from "react";
import { Modal, View, Text, ScrollView, StyleSheet, TouchableOpacity, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/lib/theme";
import { useTenant } from "@/lib/tenant";
import { fmtMoneyFull, fmt12, enlaceWhatsApp } from "@/lib/format";
import { diaLocalDe, horaLocalDe, fmtDia, esHoy } from "@/lib/tz";
import { lineasDePago } from "@/lib/ingresos";
import { medioOGenerico } from "@/lib/medios-pago";
import { nombresDeItems, textoRecibo } from "@/lib/recibo";
import { Colors, Fonts, Radius } from "@/constants/theme";
import { IconButton, MonoTag } from "@/components/ui";
import AnularCobroModal, { type CobroAAnular } from "@/components/AnularCobroModal";
import CambiarMedioModal, { type CobroACorregir } from "@/components/cobros/CambiarMedioModal";
import { detalleDe, type CobroFila } from "./FilaCobro";

export type CobroDetalle = CobroFila & {
  payments: unknown;
  appointment_id: string | null;
  /** Antes del descuento. Si falta, se toma la suma de los ítems. */
  subtotal?: number | string | null;
};

type Props = {
  cobro: CobroDetalle | null;
  /** Nombre por la cita, si se conoce (si no, el cliente de la venta). */
  cliente?: string | null;
  /** Sede del cobro, solo si el negocio tiene varias. */
  sede?: string | null;
  factura?: { number: string | null } | null;
  /** Si viene, se ofrece "Emitir factura electrónica". */
  onFacturar?: () => void;
  onClose: () => void;
  /** Tras anular. `aviso` = algo secundario que no se pudo (stock o cita). */
  onAnulado: (aviso?: string) => void;
  /** Tras corregir el medio de pago (recargar la lista). Sin él no se ofrece. */
  onMedioCambiado?: (aviso?: string) => void;
};

/**
 * Detalle de un cobro ya registrado: qué se cobró, cómo se pagó (con el
 * desglose del pago dividido, que antes no se veía en ninguna parte) y las
 * acciones sobre él. Anular pide contraseña (AnularCobroModal), que se abre
 * encima de esta hoja.
 */
export default function DetalleCobro({ cobro, cliente, sede, factura, onFacturar, onClose, onAnulado, onMedioCambiado }: Props) {
  const { t } = useTheme();
  const { tenant, timezone } = useTenant();
  const [anular, setAnular] = useState<CobroAAnular | null>(null);
  const [corregir, setCorregir] = useState<CobroACorregir | null>(null);

  useEffect(() => { setAnular(null); setCorregir(null); }, [cobro?.id]);

  if (!cobro) return null;

  const items = (cobro.pos_sale_items ?? []).map(i => ({ name: i.name, qty: Number(i.quantity) || 1, price: Number(i.price) || 0 }));
  const total = Number(cobro.total) || 0;
  const sumaItems = items.reduce((sum, i) => sum + i.price * i.qty, 0);
  const subtotal = Number(cobro.subtotal) > 0 ? Number(cobro.subtotal) : sumaItems;
  const descuento = Math.max(0, Math.round(subtotal - total));
  const lineas = lineasDePago(cobro);
  const methodLabel = lineas.map(l => medioOGenerico(l.method).label).join(" + ");
  const quien = cliente ?? cobro.clients?.name ?? null;

  // La nota por defecto son los mismos ítems: solo se muestra si alguien escribió otra cosa.
  const nota = cobro.note?.trim() ?? "";
  const notaPropia = nota && nota !== nombresDeItems(cobro.pos_sale_items ?? []) ? nota : null;

  const dia = diaLocalDe(cobro.created_at, timezone);
  const cuando = `${esHoy(dia, timezone) ? "Hoy" : fmtDia(dia, "semana-dia-mes")} · ${fmt12(horaLocalDe(cobro.created_at, timezone))}`;

  const wa = cobro.clients?.phone
    ? enlaceWhatsApp(cobro.clients.phone, {
        texto: textoRecibo(tenant?.name ?? "Tu negocio", { clientName: quien, items, subtotal, discount: descuento, total, methodLabel }),
      })
    : null;

  const pedirAnular = () => setAnular({
    id: cobro.id, total, created_at: cobro.created_at, appointment_id: cobro.appointment_id,
    cliente: quien, detalle: detalleDe(cobro),
  });

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Cerrar detalle" accessibilityRole="button" />
        <View style={[s.sheet, { backgroundColor: t.cardSolid, borderColor: t.line }]}>
          <View style={[s.handle, { backgroundColor: t.lineStrong }]} />
          <View style={s.titulo}>
            <Text style={[s.tituloTxt, { color: t.ink }]} accessibilityRole="header">Detalle del cobro</Text>
            <IconButton icon="close" label="Cerrar" onPress={onClose} />
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
            <Text style={[s.total, { color: t.ink }]}>{fmtMoneyFull(total)}</Text>
            <Text style={[s.meta, { color: t.muted }]}>{cuando}{sede ? ` · ${sede}` : ""}</Text>
            <View style={s.chips}>
              <View style={[s.chip, { backgroundColor: t.chipBg }]}>
                <Ionicons name="person-outline" size={12} color={t.muted} />
                <Text style={[s.chipTxt, { color: t.text }]} numberOfLines={1}>{quien ?? "Venta directa"}</Text>
              </View>
              {cobro.appointment_id ? (
                <View style={[s.chip, { backgroundColor: t.chipBg }]}>
                  <Ionicons name="calendar-outline" size={12} color={t.muted} />
                  <Text style={[s.chipTxt, { color: t.text }]}>Cita</Text>
                </View>
              ) : null}
              {factura ? (
                <View style={[s.chip, { backgroundColor: t.chipBg }]}>
                  <Ionicons name="document-text-outline" size={12} color={t.muted} />
                  <Text style={[s.chipTxt, { color: t.text }]}>Factura #{factura.number || "—"}</Text>
                </View>
              ) : null}
            </View>

            <MonoTag style={s.seccion}>Qué se cobró</MonoTag>
            <View style={[s.caja, { borderColor: t.line }]}>
              {items.length === 0 ? (
                <Text style={[s.fila, s.filaTxt, { color: t.muted }]}>{detalleDe(cobro) ?? "Sin detalle"}</Text>
              ) : items.map((it, i) => (
                <View key={`${it.name}-${i}`} style={[s.fila, i > 0 && { borderTopWidth: 1, borderTopColor: t.line }]}>
                  <Text style={[s.filaTxt, { color: t.text, flex: 1 }]} numberOfLines={2}>
                    {it.name}{it.qty > 1 ? ` × ${it.qty}` : ""}
                  </Text>
                  <Text style={[s.filaVal, { color: t.text }]}>{fmtMoneyFull(it.price * it.qty)}</Text>
                </View>
              ))}
              {descuento > 0 ? (
                <View style={[s.fila, { borderTopWidth: 1, borderTopColor: t.line }]}>
                  <Text style={[s.filaTxt, { color: t.muted, flex: 1 }]}>Descuento</Text>
                  <Text style={[s.filaVal, { color: Colors.success }]}>−{fmtMoneyFull(descuento)}</Text>
                </View>
              ) : null}
              <View style={[s.fila, { borderTopWidth: 1, borderTopColor: t.line }]}>
                <Text style={[s.filaTxt, { color: t.ink, flex: 1, fontFamily: Fonts.bold }]}>Total</Text>
                <Text style={[s.filaVal, { color: t.ink, fontFamily: Fonts.bold }]}>{fmtMoneyFull(total)}</Text>
              </View>
            </View>

            <MonoTag style={s.seccion}>{lineas.length > 1 ? "Pago dividido" : "Cómo pagó"}</MonoTag>
            <View style={[s.caja, { borderColor: t.line }]}>
              {lineas.map((l, i) => {
                const m = medioOGenerico(l.method);
                return (
                  <View key={`${l.method}-${i}`} style={[s.fila, i > 0 && { borderTopWidth: 1, borderTopColor: t.line }]}>
                    <View style={[s.medioIcono, { backgroundColor: m.color + "18" }]}>
                      <Ionicons name={m.icon} size={14} color={m.color} />
                    </View>
                    <Text style={[s.filaTxt, { color: t.text, flex: 1 }]}>{m.label}</Text>
                    <Text style={[s.filaVal, { color: t.text }]}>{fmtMoneyFull(l.amount)}</Text>
                  </View>
                );
              })}
            </View>

            {notaPropia ? (
              <>
                <MonoTag style={s.seccion}>Nota</MonoTag>
                <Text style={[s.nota, { color: t.text }]}>{notaPropia}</Text>
              </>
            ) : null}

            <View style={{ gap: 10, marginTop: 20 }}>
              {wa ? (
                <TouchableOpacity onPress={() => Linking.openURL(wa)} style={s.btnWa} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel="Enviar recibo por WhatsApp">
                  <Ionicons name="logo-whatsapp" size={17} color="#128C7E" />
                  <Text style={s.btnWaTxt}>Enviar recibo por WhatsApp</Text>
                </TouchableOpacity>
              ) : null}
              {onFacturar ? (
                <TouchableOpacity onPress={onFacturar} style={[s.btnSec, { borderColor: t.lineStrong }]} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel="Emitir factura electrónica">
                  <Ionicons name="document-text-outline" size={17} color={t.ink} />
                  <Text style={[s.btnSecTxt, { color: t.ink }]}>Emitir factura electrónica</Text>
                </TouchableOpacity>
              ) : null}
              {onMedioCambiado ? (
                <TouchableOpacity onPress={() => setCorregir({ id: cobro.id, total, lineas })} style={[s.btnSec, { borderColor: t.lineStrong }]}
                  activeOpacity={0.85} accessibilityRole="button" accessibilityLabel="Cambiar medio de pago">
                  <Ionicons name="card-outline" size={17} color={t.ink} />
                  <Text style={[s.btnSecTxt, { color: t.ink }]}>Cambiar medio de pago</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity onPress={pedirAnular} style={s.btnAnular} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel="Anular cobro">
                <Ionicons name="trash-outline" size={16} color={Colors.red} />
                <Text style={s.btnAnularTxt}>Anular cobro</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>

      {/* Encima de esta hoja: dos Modal hermanos no se presentan bien a la vez en iOS. */}
      <AnularCobroModal
        cobro={anular}
        onClose={() => setAnular(null)}
        onAnulado={aviso => { setAnular(null); onAnulado(aviso); }}
      />
      <CambiarMedioModal
        cobro={corregir}
        onClose={() => setCorregir(null)}
        onCambiado={aviso => { setCorregir(null); onMedioCambiado?.(aviso); }}
      />
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay:     { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet:       { maxHeight: "88%", borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 34 },
  handle:      { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 10 },
  titulo:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  tituloTxt:   { fontSize: 17, fontFamily: Fonts.bold },
  total:       { fontSize: 32, fontFamily: Fonts.bold, letterSpacing: -1 },
  meta:        { fontSize: 13, fontFamily: Fonts.regular, marginTop: 2 },
  chips:       { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  chip:        { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 5, maxWidth: 240 },
  chipTxt:     { fontSize: 12, fontFamily: Fonts.semibold },
  seccion:     { marginTop: 18, marginBottom: 8 },
  caja:        { borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: 14 },
  fila:        { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11 },
  filaTxt:     { fontSize: 13.5, fontFamily: Fonts.regular },
  filaVal:     { fontSize: 13.5, fontFamily: Fonts.semibold },
  medioIcono:  { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  nota:        { fontSize: 13.5, fontFamily: Fonts.regular, lineHeight: 19 },
  btnWa:       { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: Radius.full, borderWidth: 1, borderColor: "rgba(37,211,102,0.5)", backgroundColor: "rgba(37,211,102,0.08)" },
  btnWaTxt:    { fontSize: 14, fontFamily: Fonts.bold, color: "#128C7E" },
  btnSec:      { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: Radius.full, borderWidth: 1 },
  btnSecTxt:   { fontSize: 14, fontFamily: Fonts.bold },
  btnAnular:   { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12 },
  btnAnularTxt:{ fontSize: 13.5, fontFamily: Fonts.bold, color: Colors.red },
});
