import { useEffect, useRef, useState } from "react";
import {
  Modal, View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/lib/theme";
import { Colors, Fonts, Radius } from "@/constants/theme";
import { fmtMoneyFull } from "@/lib/format";
import { Config, authedFetch } from "@/lib/config";
import { mensajeError } from "@/lib/db";
import { leerMonto, monedaSinDecimales } from "@/lib/dinero";
import { MEDIOS } from "@/lib/medios-pago";

/** Lo que se pagó, por medio (la parte con bono incluida, que no se toca). */
export type CobroACorregir = { id: string; total: number; lineas: { method: string; amount: number }[] };

type Props = {
  cobro: CobroACorregir | null;
  onClose: () => void;
  /** Tras corregir. `aviso` = el cobro no tenía ingreso en la caja. */
  onCambiado: (aviso?: string) => void;
};

const BONO = "bono";
type Linea = { method: string; amount: string };

/**
 * Corregir el medio de pago de un cobro ya registrado (se pagó con Nequi y
 * quedó en Efectivo), igual que "Cambiar medio de pago" del historial web:
 * mismo endpoint (/api/admin/pos-sales/payment-method), misma contraseña del
 * dueño que anular. Solo cambia el medio, no el valor; la parte con bono no
 * se toca, y la caja de ese día se corrige en el servidor.
 */
export default function CambiarMedioModal({ cobro, onClose, onCambiado }: Props) {
  const { t } = useTheme();
  const conDecimales = !monedaSinDecimales();
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [contrasena, setContrasena] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enCurso = useRef(false);

  const bono = (cobro?.lineas ?? []).filter(l => l.method === BONO).reduce((n, l) => n + l.amount, 0);
  const objetivo = Math.round((Number(cobro?.total) || 0) - bono);

  useEffect(() => {
    const propias = (cobro?.lineas ?? []).filter(l => l.method !== BONO)
      .map(l => ({ method: MEDIOS.some(m => m.key === l.method) ? l.method : "efectivo", amount: String(Math.round(l.amount)) }));
    setLineas(propias.length ? propias : [{ method: "efectivo", amount: String(objetivo) }]);
    setContrasena("");
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cobro?.id]);

  if (!cobro) return null;

  const dividido = lineas.length > 1;
  const suma = lineas.reduce((n, l) => n + Math.round(leerMonto(l.amount, { decimales: conDecimales }) ?? 0), 0);
  const cuadra = !dividido || suma === objetivo;
  const listo = !!contrasena && cuadra && !enviando;

  const guardar = async () => {
    if (enCurso.current || !listo) return;
    enCurso.current = true;
    setEnviando(true);
    setError(null);
    try {
      const payments = dividido
        ? lineas.map(l => ({ method: l.method, amount: Math.round(leerMonto(l.amount, { decimales: conDecimales }) ?? 0) }))
        : [{ method: lineas[0].method, amount: objetivo }];
      const res = await authedFetch(Config.api.posSalePaymentMethod, {
        method: "POST",
        timeoutMs: Config.timeouts.chat,
        body: JSON.stringify({ sale_id: cobro.id, password: contrasena, payments }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof json?.error === "string" ? json.error : "No se pudo cambiar el medio de pago.");
        return;
      }
      onCambiado(typeof json?.aviso === "string" ? json.aviso : undefined);
    } catch (e) {
      setError(mensajeError(e, "No se pudo cambiar el medio de pago"));
    } finally {
      enCurso.current = false;
      setEnviando(false);
    }
  };

  const chips = (activo: string, elegir: (k: string) => void) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} keyboardShouldPersistTaps="handled">
      {MEDIOS.map(m => {
        const sel = m.key === activo;
        return (
          <TouchableOpacity key={m.key} onPress={() => elegir(m.key)} activeOpacity={0.8}
            accessibilityRole="radio" accessibilityState={{ checked: sel }} accessibilityLabel={m.label}
            style={[s.chip, { borderColor: sel ? m.color : t.line, backgroundColor: sel ? m.color + "1A" : t.cardSolid }]}>
            <Ionicons name={m.icon} size={14} color={sel ? m.color : t.muted} />
            <Text style={[s.chipTxt, { color: sel ? m.color : t.muted }]}>{m.label}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );

  return (
    <Modal visible animationType="slide" transparent onRequestClose={() => { if (!enviando) onClose(); }}>
      <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[s.sheet, { backgroundColor: t.cardSolid, borderColor: t.line }]}>
          <View style={[s.handle, { backgroundColor: t.lineStrong }]} />
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={[s.title, { color: t.text }]} accessibilityRole="header">Cambiar medio de pago</Text>
            <Text style={[s.sub, { color: t.muted }]}>
              Cobro de {fmtMoneyFull(Number(cobro.total))}. Solo cambia el medio, no el valor; la caja de ese día se corrige sola.
              {bono > 0 ? ` Lo pagado con bono (${fmtMoneyFull(bono)}) no cambia.` : ""}
            </Text>

            {!dividido ? (
              <View style={{ marginTop: 14 }}>
                {chips(lineas[0]?.method ?? "efectivo", k => setLineas([{ method: k, amount: String(objetivo) }]))}
              </View>
            ) : (
              <View style={{ gap: 12, marginTop: 14 }}>
                {lineas.map((l, i) => (
                  <View key={i} style={{ gap: 6 }}>
                    {chips(l.method, k => setLineas(prev => prev.map((x, j) => (j === i ? { ...x, method: k } : x))))}
                    <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                      <TextInput value={l.amount} keyboardType={conDecimales ? "decimal-pad" : "number-pad"}
                        onChangeText={v => setLineas(prev => prev.map((x, j) => (j === i ? { ...x, amount: v } : x)))}
                        accessibilityLabel={`Monto ${i + 1}`} placeholder="Monto" placeholderTextColor={t.subtle}
                        style={[s.input, { flex: 1, backgroundColor: t.inputBg, borderColor: t.inputBorder, color: t.text }]} />
                      {lineas.length > 2 && (
                        <TouchableOpacity onPress={() => setLineas(prev => prev.filter((_, j) => j !== i))} hitSlop={8}
                          accessibilityRole="button" accessibilityLabel={`Quitar el medio ${i + 1}`}>
                          <Ionicons name="close-circle" size={22} color={t.subtle} />
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                ))}
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <TouchableOpacity onPress={() => setLineas(prev => [...prev, { method: "efectivo", amount: "" }])} accessibilityRole="button">
                    <Text style={[s.link, { color: Colors.blue }]}>+ Otro medio</Text>
                  </TouchableOpacity>
                  <Text style={[s.suma, { color: cuadra ? Colors.success : "#d97706" }]}>Suman {fmtMoneyFull(suma)} de {fmtMoneyFull(objetivo)}</Text>
                </View>
              </View>
            )}
            <TouchableOpacity accessibilityRole="button" style={{ marginTop: 12 }}
              onPress={() => setLineas(dividido
                ? [{ method: lineas[0]?.method ?? "efectivo", amount: String(objetivo) }]
                : [{ method: lineas[0]?.method ?? "efectivo", amount: String(objetivo) }, { method: "nequi", amount: "" }])}>
              <Text style={[s.link, { color: Colors.blue }]}>{dividido ? "Usar un solo medio" : "Dividir entre varios medios"}</Text>
            </TouchableOpacity>

            <Text style={[s.label, { color: t.muted }]}>Contraseña del dueño para confirmar</Text>
            <TextInput
              style={[s.input, { backgroundColor: t.inputBg, borderColor: error ? Colors.red : t.inputBorder, color: t.text }]}
              value={contrasena}
              onChangeText={v => { setContrasena(v); if (error) setError(null); }}
              secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="password"
              placeholder="Contraseña del dueño" placeholderTextColor={t.subtle}
              editable={!enviando} onSubmitEditing={guardar} accessibilityLabel="Contraseña"
            />
            {error ? (
              <View style={s.errorBox} accessibilityRole="alert">
                <Ionicons name="close-circle-outline" size={15} color={Colors.red} />
                <Text style={s.errorTxt}>{error}</Text>
              </View>
            ) : null}

            <View style={s.acciones}>
              <TouchableOpacity style={[s.btnSec, { borderColor: t.line }]} onPress={onClose} disabled={enviando} accessibilityRole="button">
                <Text style={[s.btnSecTxt, { color: t.muted }]}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.btnPri, !listo && { opacity: 0.45 }]} onPress={guardar} disabled={!listo}
                accessibilityRole="button" accessibilityState={{ disabled: !listo, busy: enviando }}>
                {enviando ? <ActivityIndicator color="white" /> : <Text style={s.btnPriTxt}>Guardar</Text>}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay:   { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet:     { maxHeight: "90%", borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, padding: 22, paddingBottom: 36 },
  handle:    { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 14 },
  title:     { fontSize: 18, fontFamily: Fonts.bold },
  sub:       { fontSize: 12.5, fontFamily: Fonts.regular, lineHeight: 17, marginTop: 6 },
  chip:      { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderRadius: Radius.full, paddingHorizontal: 12, paddingVertical: 8 },
  chipTxt:   { fontSize: 12.5, fontFamily: Fonts.semibold },
  link:      { fontSize: 12.5, fontFamily: Fonts.bold },
  suma:      { fontSize: 12, fontFamily: Fonts.semibold },
  label:     { fontSize: 11, fontFamily: Fonts.bold, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 18, marginBottom: 8 },
  input:     { borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontFamily: Fonts.regular },
  errorBox:  { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 8 },
  errorTxt:  { flex: 1, fontSize: 12.5, fontFamily: Fonts.semibold, color: Colors.red, lineHeight: 17 },
  acciones:  { flexDirection: "row", gap: 10, marginTop: 18 },
  btnSec:    { flex: 1, borderWidth: 1, borderRadius: Radius.full, paddingVertical: 14, alignItems: "center" },
  btnSecTxt: { fontSize: 14, fontFamily: Fonts.semibold },
  btnPri:    { flex: 1.4, backgroundColor: Colors.blue, borderRadius: Radius.full, paddingVertical: 14, alignItems: "center" },
  btnPriTxt: { fontSize: 14, fontFamily: Fonts.bold, color: "white" },
});
