import { useEffect, useRef, useState } from "react";
import {
  Modal, View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, Image, Share,
} from "react-native";
import { Colors, Fonts, Radius } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { fmtMoneyFull } from "@/lib/format";
import { diaLocalDe, fmtDia } from "@/lib/tz";
import { IconButton, MonoTag } from "@/components/ui";
import { anularLiquidacion, leerColilla, type Colilla, type ItemHistorial } from "@/lib/nomina";
import { etiquetaTramo, FilaMonto } from "./comun";
import { textoColilla } from "./ColillaTexto";
import { Aviso, BotonNomina, Etiqueta } from "./ResumenPiezas";
import { citas, etiquetaNovedad, horaCorta, mensajeNomina, ORIGEN_NOVEDAD, textoBasico } from "./ResumenTextos";

export type ItemColilla = Pick<ItemHistorial, "id" | "profesional" | "period_start" | "period_end">;

/**
 * Colilla de pago de una liquidación de nómina: negocio, profesional,
 * periodo, básico, comisiones, novedades, cita por cita, total y nota, tal
 * como quedó guardada al liquidar. Se puede compartir como texto. El dueño
 * puede anularla (con confirmación): lo que cubría vuelve a quedar pendiente.
 */
export default function ColillaModal({ tenantId, timeZone, item, puedeAnular, onClose, onAnulada }: {
  tenantId: string;
  timeZone: string;
  item: ItemColilla;
  puedeAnular: boolean;
  onClose: () => void;
  onAnulada?: (item: ItemColilla) => void;
}) {
  const { t } = useTheme();
  const [c, setC] = useState<Colilla | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [intento, setIntento] = useState(0);
  const [confirmando, setConfirmando] = useState(false);
  const [anulando, setAnulando] = useState(false);
  const [errorAnular, setErrorAnular] = useState<string | null>(null);
  const enCurso = useRef(false);

  useEffect(() => {
    let vivo = true;
    setError(null);
    leerColilla(tenantId, item.id)
      .then(r => { if (vivo) setC(r); })
      .catch(e => { if (vivo) setError(e); });
    return () => { vivo = false; };
  }, [tenantId, item.id, intento]);

  const compartir = () => {
    if (!c) return;
    Share.share({ message: textoColilla(c, timeZone) }).catch(() => {});
  };

  const anular = async () => {
    if (enCurso.current) return;
    enCurso.current = true;
    setAnulando(true);
    setErrorAnular(null);
    try {
      await anularLiquidacion(tenantId, item.id);
      onAnulada?.(item);
    } catch (e) {
      setErrorAnular(mensajeNomina(e));
    } finally {
      enCurso.current = false;
      setAnulando(false);
    }
  };

  const cerrar = () => { if (!anulando) onClose(); };
  const l = c?.liquidacion;
  const d = l?.detail ?? null;
  const total = Number(l?.total_amount) || 0;
  const logo = c?.negocio.logo && /^https:\/\//.test(c.negocio.logo) ? c.negocio.logo : null;

  return (
    <Modal visible animationType="slide" transparent onRequestClose={cerrar}>
      <View style={s.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={cerrar} accessibilityRole="button" accessibilityLabel="Cerrar colilla" />
        <View style={[s.sheet, { backgroundColor: t.cardSolid, borderColor: t.line }]}>
          <View style={[s.handle, { backgroundColor: t.lineStrong }]} />
          <View style={s.titulo}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[s.tituloTxt, { color: t.ink }]} accessibilityRole="header" numberOfLines={1}>Colilla de pago</Text>
              <Text style={[s.tituloSub, { color: t.muted }]} numberOfLines={1}>
                {item.profesional} · {etiquetaTramo({ desde: item.period_start, hasta: item.period_end })}
              </Text>
            </View>
            {c ? <IconButton icon="share-outline" label="Compartir colilla" onPress={compartir} /> : null}
            <IconButton icon="close" label="Cerrar" onPress={cerrar} />
          </View>

          {error && !c ? (
            <Aviso
              tono="error"
              titulo="No se pudo cargar la colilla"
              texto={mensajeNomina(error)}
              accion={{ label: "Reintentar", onPress: () => setIntento(n => n + 1) }}
            />
          ) : !c || !l ? (
            <ActivityIndicator color={Colors.red} style={{ paddingVertical: 32 }} />
          ) : (
            <ScrollView contentContainerStyle={{ paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
              {/* Encabezado: negocio y profesional */}
              <View style={[s.encabezado, { borderBottomColor: t.ink }]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  {logo ? <Image source={{ uri: logo }} style={s.logo} resizeMode="contain" accessibilityIgnoresInvertColors /> : null}
                  <Text style={[s.negocio, { color: t.ink }]} numberOfLines={2}>{c.negocio.nombre || "Tu negocio"}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0, alignItems: "flex-end" }}>
                  <Text style={[s.pro, { color: t.ink }]} numberOfLines={2}>{c.profesional.nombre}</Text>
                  {c.profesional.cargo ? <Text style={[s.meta, { color: t.muted }]} numberOfLines={1}>{c.profesional.cargo}</Text> : null}
                  <Text style={[s.meta, { color: t.muted }]}>{etiquetaTramo({ desde: l.period_start, hasta: l.period_end })}</Text>
                  <Text style={[s.meta, { color: t.muted }]}>Pagado el {fmtDia(diaLocalDe(l.paid_at, timeZone), "corto")}</Text>
                </View>
              </View>

              <MonoTag style={s.seccion}>Resumen</MonoTag>
              <FilaMonto
                label="Comisión por servicios"
                valor={Number(l.service_commission) || 0}
                sub={`${citas(Number(l.appointments_count) || 0)} · ${fmtMoneyFull(l.service_sales)}`}
              />
              {Number(l.product_sales) > 0 ? (
                <FilaMonto label="Comisión por productos" valor={Number(l.product_commission) || 0} sub={fmtMoneyFull(l.product_sales)} />
              ) : null}
              {Number(l.base_amount) > 0 || d?.basico ? (
                <FilaMonto
                  label="Básico"
                  valor={Number(l.base_amount) || 0}
                  sub={d?.basico
                    ? `${textoBasico(d.basico)}${d.basico.manual ? ` · ajustado; calculado ${fmtMoneyFull(d.basico.calculado)}` : ""}`
                    : `${l.base_days} días`}
                />
              ) : null}
              {(d?.novedades ?? []).map((n, i) => (
                <FilaMonto
                  key={`${n.kind}-${n.entry_date}-${i}`}
                  label={etiquetaNovedad(n)}
                  valor={Number(n.amount) || 0}
                  signo={n.kind === "deduction" ? -1 : 1}
                  sub={`${fmtDia(n.entry_date, "dia-mes")} · ${ORIGEN_NOVEDAD[n.source] ?? n.source}`}
                />
              ))}
              {!d ? (
                <>
                  {Number(l.tips_amount) > 0 ? <FilaMonto label="Propinas" valor={Number(l.tips_amount)} /> : null}
                  {Number(l.bonus_amount) > 0 ? <FilaMonto label="Bonificaciones" valor={Number(l.bonus_amount)} /> : null}
                  {Number(l.deduction_amount) > 0 ? <FilaMonto label="Descuentos y adelantos" valor={Number(l.deduction_amount)} signo={-1} /> : null}
                </>
              ) : null}
              <View style={[s.totalSep, { borderTopColor: t.ink }]}>
                <FilaMonto
                  label={total < 0 ? "Saldo a favor del negocio" : "Total pagado"}
                  valor={Math.abs(total)}
                  fuerte
                  color={total < 0 ? Colors.red : undefined}
                />
              </View>
              {l.note ? <Text style={[s.nota, { color: t.muted }]}>Nota: {l.note}</Text> : null}

              {(d?.lineas ?? []).length > 0 ? (
                <>
                  <MonoTag style={s.seccion}>Citas y ventas ({d?.lineas.length})</MonoTag>
                  <View style={[s.caja, { borderColor: t.line }]}>
                    {(d?.lineas ?? []).map((x, i) => {
                      const hora = horaCorta(x.hora);
                      return (
                        <View key={i} style={[s.linea, i > 0 && { borderTopWidth: 1, borderTopColor: t.line }]}>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={[s.lineaTop, { color: t.text }]} numberOfLines={1}>
                              {fmtDia(x.dia, "dia-mes")}{hora ? ` · ${hora}` : ""} · {x.cliente ?? "Sin cliente"}
                            </Text>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
                              <Text style={[s.lineaSub, { color: t.muted, flexShrink: 1 }]} numberOfLines={2}>
                                {x.nombre}{x.cantidad > 1 ? ` ×${x.cantidad}` : ""}
                              </Text>
                              {x.tipo === "producto" ? <Etiqueta texto="Producto" color={Colors.blue} /> : null}
                            </View>
                          </View>
                          <View style={{ alignItems: "flex-end" }}>
                            <Text style={[s.lineaCom, { color: t.text }]}>{fmtMoneyFull(x.comision)}</Text>
                            <Text style={[s.lineaSub, { color: t.subtle }]}>de {fmtMoneyFull(x.valor)}</Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </>
              ) : null}

              <View style={{ gap: 10, marginTop: 20 }}>
                <BotonNomina label="Compartir colilla" icono="share-outline" tono="fantasma" onPress={compartir} />
                {puedeAnular ? (
                  confirmando ? (
                    <View style={[s.confirmar, { borderColor: "rgba(220,38,38,0.3)" }]}>
                      <Text style={s.confirmarTxt}>
                        ¿Anular esta liquidación? Lo que cubría vuelve a quedar pendiente. La plata que ya entregaste no se toca: eso lo arreglas por fuera.
                      </Text>
                      {errorAnular ? <Text style={s.errorTxt} accessibilityRole="alert">{errorAnular}</Text> : null}
                      <View style={{ flexDirection: "row", gap: 8 }}>
                        <BotonNomina label="No" tono="fantasma" onPress={() => { setConfirmando(false); setErrorAnular(null); }} disabled={anulando} flex={1} />
                        <BotonNomina label="Sí, anular" tono="peligro" onPress={anular} cargando={anulando} flex={1.4} accessibilityLabel="Sí, anular la liquidación" />
                      </View>
                    </View>
                  ) : (
                    <BotonNomina label="Anular liquidación" icono="trash-outline" tono="peligro" onPress={() => setConfirmando(true)} />
                  )
                ) : null}
              </View>
              <Text style={[s.pie, { color: t.subtle }]}>Generada con Zyncra · {l.id.slice(0, 8)}</Text>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay:      { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet:        { maxHeight: "92%", borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 30 },
  handle:       { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 10 },
  titulo:       { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  tituloTxt:    { fontSize: 17, fontFamily: Fonts.bold },
  tituloSub:    { fontSize: 12, fontFamily: Fonts.regular, marginTop: 1 },
  encabezado:   { flexDirection: "row", gap: 14, borderBottomWidth: 2, paddingBottom: 12, marginBottom: 4 },
  logo:         { width: 120, height: 40, marginBottom: 6 },
  negocio:      { fontSize: 16, fontFamily: Fonts.bold },
  pro:          { fontSize: 14, fontFamily: Fonts.bold, textAlign: "right" },
  meta:         { fontSize: 11.5, fontFamily: Fonts.regular, textAlign: "right", marginTop: 1 },
  seccion:      { marginTop: 16, marginBottom: 4 },
  totalSep:     { borderTopWidth: 2, marginTop: 4, paddingTop: 2 },
  nota:         { fontSize: 12.5, fontFamily: Fonts.regular, marginTop: 6, lineHeight: 17 },
  caja:         { borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: 12 },
  linea:        { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 9 },
  lineaTop:     { fontSize: 12.5, fontFamily: Fonts.semibold },
  lineaSub:     { fontSize: 11.5, fontFamily: Fonts.regular },
  lineaCom:     { fontSize: 13, fontFamily: Fonts.bold },
  confirmar:    { borderWidth: 1, borderRadius: Radius.md, padding: 12, gap: 10, backgroundColor: "rgba(239,68,68,0.06)" },
  confirmarTxt: { fontSize: 12.5, fontFamily: Fonts.semibold, color: "#dc2626", lineHeight: 17 },
  errorTxt:     { fontSize: 12.5, fontFamily: Fonts.regular, color: Colors.red, lineHeight: 17 },
  pie:          { fontSize: 11, fontFamily: Fonts.regular, textAlign: "center", marginTop: 16 },
});
