import { useEffect, useRef, useState } from "react";
import {
  Modal, View, Text, TextInput, ScrollView, StyleSheet, KeyboardAvoidingView, Platform,
  TouchableOpacity, ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Fonts, Radius } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { fmtMoneyFull } from "@/lib/format";
import { fmtDia, sumarDias } from "@/lib/tz";
import { leerMonto } from "@/lib/dinero";
import { nuevoId } from "@/lib/db";
import { ErrorNomina, hayPendiente, leerResumen, liquidar, type ResumenProfesional } from "@/lib/nomina";
import { etiquetaTramo, FilaMonto } from "./comun";
import { Aviso, AvatarNomina, BotonNomina } from "./ResumenPiezas";
import {
  basicoManualDe, citas, etiquetaNovedad, mensajeNomina, ORIGEN_NOVEDAD, textoBasico, totalConBasico,
} from "./ResumenTextos";

/**
 * Confirmación de pago de un profesional (solo el dueño), igual que el web.
 * Muestra lo que se va a liquidar tal como lo calculó el servidor; el dueño
 * puede ajustar el básico (ausencias, ingreso a mitad de periodo) y dejar una
 * nota.
 *
 *   · Hoy queda por fuera salvo que se marque "Incluir lo de hoy": liquidar
 *     marca días enteros como pagados, y lo que se cobrara más tarde ese día
 *     no entraría en ninguna nómina. Si el periodo incluye hoy, la hoja pide
 *     al servidor lo pendiente hasta ayer (o hasta hoy, con la casilla) y
 *     liquida con ESE hasta y ESA firma: mezclarlas da 409 "cambio".
 *   · statementId se genera al ABRIR la hoja (esta se monta al abrirse):
 *     reintentar después de un corte manda el mismo y el servidor no paga
 *     dos veces.
 *   · 409 "cambio" (entró un cobro, una novedad u otra liquidación mientras
 *     se revisaba) o "vacio" (nada que pagar, o el periodo no ha empezado):
 *     se cierra, se recarga el resumen y se explica.
 */
export default function LiquidarSheet({ tenantId, p, desde, hasta, hoy, onClose, onCambio, onListo }: {
  tenantId: string;
  /** Como vino en el resumen del periodo (desde–hasta). */
  p: ResumenProfesional;
  desde: string;
  hasta: string;
  hoy: string;
  onClose: () => void;
  onCambio: (texto: string) => void;
  onListo: (texto: string) => void;
}) {
  const { t } = useTheme();
  const [statementId] = useState(nuevoId);
  const incluyeHoy = desde <= hoy && hasta >= hoy;
  const [conHoy, setConHoy] = useState(false);
  const hastaLiq = !incluyeHoy ? hasta : conHoy ? hoy : sumarDias(hoy, -1);

  // Lo pendiente hasta hastaLiq. Si el periodo ya pasó es el mismo del
  // resumen; si incluye hoy, se pide de nuevo al servidor.
  const [pro, setPro] = useState<ResumenProfesional | null>(incluyeHoy ? null : p);
  const [cargando, setCargando] = useState(incluyeHoy);
  const [errorCarga, setErrorCarga] = useState<unknown>(null);
  const [intento, setIntento] = useState(0);
  const [basico, setBasico] = useState(!incluyeHoy && p.pendiente.basico ? String(Math.round(p.pendiente.basico.monto)) : "");
  const [nota, setNota] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enCurso = useRef(false);

  useEffect(() => {
    if (!incluyeHoy) return;
    let vivo = true;
    setErrorCarga(null);
    if (hastaLiq < desde) {
      // El periodo empieza hoy: sin la casilla no hay nada que liquidar.
      setPro(null);
      setCargando(false);
      return;
    }
    setCargando(true);
    leerResumen({ tenantId, desde, hasta: hastaLiq, profesionalId: p.professional_id })
      .then(r => {
        if (!vivo) return;
        const x = r.profesionales.find(y => y.professional_id === p.professional_id) ?? null;
        setPro(x);
        setBasico(x?.pendiente.basico ? String(Math.round(x.pendiente.basico.monto)) : "");
      })
      .catch(e => { if (vivo) { setPro(null); setErrorCarga(e); } })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [incluyeHoy, hastaLiq, desde, tenantId, p.professional_id, intento]);

  const pend = pro?.pendiente ?? null;
  const hayAlgo = !!pend && hayPendiente(pend);
  const basicoNum = pend?.basico ? leerMonto(basico) : null;
  const basicoInvalido = !!pend?.basico && basicoNum === null;
  const total = pend ? totalConBasico(pend, basicoNum) : 0;
  const listo = !cargando && hayAlgo && !basicoInvalido;

  const confirmar = async () => {
    if (enCurso.current || !pro || !pend || !listo) return;
    enCurso.current = true;
    setGuardando(true);
    setError(null);
    try {
      const r = await liquidar({
        tenantId, profesionalId: p.professional_id, desde, hasta: hastaLiq, firma: pro.firma, statementId,
        basicoManual: basicoManualDe(pend, basicoNum),
        nota: nota.trim() || null,
      });
      onListo(`Nómina de ${p.nombre} liquidada: ${fmtMoneyFull(r.total)}. La colilla está en Historial.`);
    } catch (e) {
      if (e instanceof ErrorNomina && e.status === 409 && (e.code === "cambio" || e.code === "vacio")) {
        const motivo = mensajeNomina(e).replace(/[.\s]*$/, ".");
        onCambio(`${p.nombre}: ${motivo} El resumen ya se actualizó con lo último.`);
        return;
      }
      // La hoja queda abierta con el mismo statementId: reintentar no duplica.
      setError(mensajeNomina(e));
    } finally {
      enCurso.current = false;
      setGuardando(false);
    }
  };

  const c = pend?.comisiones;

  return (
    <Modal visible animationType="slide" transparent onRequestClose={() => { if (!guardando) onClose(); }}>
      <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[s.sheet, { backgroundColor: t.cardSolid, borderColor: t.line }]}>
          <View style={[s.handle, { backgroundColor: t.lineStrong }]} />
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
            <View style={s.cabeza}>
              <AvatarNomina nombre={p.nombre} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[s.titulo, { color: t.ink }]} accessibilityRole="header" numberOfLines={2}>Liquidar a {p.nombre}</Text>
                <Text style={[s.sub, { color: t.muted }]}>
                  {hastaLiq >= desde ? `Lo pendiente del ${etiquetaTramo({ desde, hasta: hastaLiq })}` : "Este periodo empieza hoy"}
                </Text>
              </View>
            </View>

            {incluyeHoy ? (
              <TouchableOpacity
                onPress={() => setConHoy(v => !v)}
                disabled={guardando}
                activeOpacity={0.7}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: conHoy, disabled: guardando }}
                accessibilityLabel={`Incluir lo de hoy, ${fmtDia(hoy, "dia-mes")}`}
                style={[s.casilla, { backgroundColor: t.chipBg }]}
              >
                <Ionicons name={conHoy ? "checkbox" : "square-outline"} size={20} color={conHoy ? Colors.red : t.muted} />
                <Text style={[s.casillaTxt, { color: t.muted }]}>
                  <Text style={{ color: t.ink, fontFamily: Fonts.bold }}>Incluir lo de hoy</Text> ({fmtDia(hoy, "dia-mes")}). Márcalo solo si ya terminaste de atender hoy: lo que se cobre después de liquidar ya no entraría en ninguna nómina.
                </Text>
              </TouchableOpacity>
            ) : null}

            {cargando ? (
              <ActivityIndicator color={Colors.red} style={{ paddingVertical: 28 }} />
            ) : errorCarga ? (
              <Aviso
                tono="error"
                titulo="No se pudo calcular lo pendiente"
                texto={mensajeNomina(errorCarga)}
                accion={{ label: "Reintentar", onPress: () => setIntento(n => n + 1) }}
              />
            ) : !pend || !c || !hayAlgo ? (
              <Text style={[s.vacio, { color: t.muted }]}>
                {hastaLiq < desde
                  ? "Marca «Incluir lo de hoy» para liquidar este periodo."
                  : `No hay nada pendiente hasta el ${fmtDia(hastaLiq, "dia-mes")}.`}
              </Text>
            ) : (
              <>
                <FilaMonto
                  label="Comisión por servicios"
                  valor={c.comisionServicios}
                  sub={`${citas(c.citas)} · ${fmtMoneyFull(c.ventasServicios)} en servicios`}
                />
                {c.ventasProductos > 0 ? (
                  <FilaMonto label="Comisión por productos" valor={c.comisionProductos} sub={`${fmtMoneyFull(c.ventasProductos)} en productos`} />
                ) : null}

                {pend.basico ? (
                  <View style={s.basico}>
                    <View style={s.basicoFila}>
                      <View style={{ flex: 1, paddingRight: 10 }}>
                        <Text style={[s.basicoLbl, { color: t.muted }]}>Básico</Text>
                        <Text style={[s.basicoSub, { color: t.subtle }]}>
                          {textoBasico(pend.basico)} · calculado {fmtMoneyFull(pend.basico.monto)}
                        </Text>
                      </View>
                      <TextInput
                        value={basico}
                        onChangeText={v => { setBasico(v); if (error) setError(null); }}
                        keyboardType="decimal-pad"
                        editable={!guardando}
                        accessibilityLabel="Básico a pagar"
                        style={[s.basicoInput, {
                          backgroundColor: t.inputBg, color: t.text,
                          borderColor: basicoInvalido ? Colors.red : t.inputBorder,
                        }]}
                      />
                    </View>
                    <Text style={[s.ayuda, { color: basicoInvalido ? Colors.red : t.subtle }]}>
                      {basicoInvalido
                        ? "Escribe el básico a pagar (0 si esta vez no aplica)."
                        : "Puedes ajustarlo (ausencias, ingreso a mitad de periodo). Los días quedan pagados igual."}
                    </Text>
                  </View>
                ) : null}

                {pend.novedades.map(n => (
                  <FilaMonto
                    key={n.id}
                    label={etiquetaNovedad(n)}
                    valor={n.amount}
                    signo={n.kind === "deduction" ? -1 : 1}
                    sub={`${fmtDia(n.entry_date, "dia-mes")} · ${ORIGEN_NOVEDAD[n.source] ?? n.source}`}
                  />
                ))}

                <View style={[s.totalSep, { borderTopColor: t.line }]}>
                  <FilaMonto
                    label={total < 0 ? "Saldo a favor del negocio" : "Total a pagar"}
                    valor={Math.abs(total)}
                    fuerte
                    color={total < 0 ? Colors.red : undefined}
                  />
                </View>

                <Text style={[s.label, { color: t.muted }]}>Nota (opcional)</Text>
                <TextInput
                  value={nota}
                  onChangeText={setNota}
                  maxLength={300}
                  placeholder="Ej. Pago por Nequi"
                  placeholderTextColor={t.subtle}
                  editable={!guardando}
                  accessibilityLabel="Nota de la liquidación"
                  style={[s.input, { backgroundColor: t.inputBg, borderColor: t.inputBorder, color: t.text }]}
                />
              </>
            )}

            {error ? (
              <View style={{ marginTop: 12 }}>
                <Aviso tono="error" titulo="No se registró la liquidación" texto={error} />
              </View>
            ) : null}

            <View style={s.acciones}>
              <BotonNomina label="Cancelar" tono="fantasma" onPress={onClose} disabled={guardando} flex={1} />
              <BotonNomina
                label={total > 0 && hayAlgo ? `Liquidar ${fmtMoneyFull(total)}` : "Liquidar"}
                accessibilityLabel={`Confirmar liquidación de ${p.nombre}`}
                onPress={confirmar}
                cargando={guardando}
                disabled={!listo}
                flex={1.5}
              />
            </View>
            <Text style={[s.pie, { color: t.subtle }]}>
              Liquidar registra el pago en Zyncra; la plata la entregas tú. Si te equivocas, se puede anular desde Historial.
            </Text>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay:     { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet:       { maxHeight: "92%", borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 30 },
  handle:      { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 12 },
  cabeza:      { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  titulo:      { fontSize: 17, fontFamily: Fonts.bold },
  sub:         { fontSize: 12, fontFamily: Fonts.regular, marginTop: 2 },
  casilla:     { flexDirection: "row", alignItems: "flex-start", gap: 10, borderRadius: Radius.md, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 10 },
  casillaTxt:  { flex: 1, fontSize: 12, fontFamily: Fonts.regular, lineHeight: 17 },
  vacio:       { fontSize: 13.5, fontFamily: Fonts.regular, textAlign: "center", paddingVertical: 24, lineHeight: 19 },
  basico:      { paddingVertical: 7 },
  basicoFila:  { flexDirection: "row", alignItems: "center" },
  basicoLbl:   { fontSize: 13.5, fontFamily: Fonts.regular },
  basicoSub:   { fontSize: 11.5, fontFamily: Fonts.regular, marginTop: 2 },
  basicoInput: { width: 130, borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: 12, paddingVertical: 9, fontSize: 15, fontFamily: Fonts.bold, textAlign: "right" },
  ayuda:       { fontSize: 11.5, fontFamily: Fonts.regular, marginTop: 5, lineHeight: 16 },
  totalSep:    { borderTopWidth: 1, marginTop: 6, paddingTop: 2 },
  label:       { fontSize: 11, fontFamily: Fonts.bold, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 14, marginBottom: 8 },
  input:       { borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontFamily: Fonts.regular },
  acciones:    { flexDirection: "row", gap: 10, marginTop: 18 },
  pie:         { fontSize: 11.5, fontFamily: Fonts.regular, lineHeight: 16, marginTop: 12, textAlign: "center" },
});
