import { useEffect, useRef, useState } from "react";
import {
  Modal, View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/lib/theme";
import { useTenant } from "@/lib/tenant";
import { Colors, Fonts, Radius } from "@/constants/theme";
import { fmtMoneyFull, fmt12 } from "@/lib/format";
import { diaLocalDe, horaLocalDe, fmtDia, esHoy } from "@/lib/tz";
import { voidSale } from "@/lib/record-sale";
import { useAuth } from "@/lib/auth";
import { refreshAllReminders } from "@/lib/notifications";

/**
 * Confirmación fuerte para anular un cobro (DIN-08). Antes bastaba un Alert
 * "Anular": cualquiera con el teléfono del dueño en el mostrador podía borrar
 * cobros en efectivo. Ahora, igual que el web, se pide la contraseña y se
 * explica qué va a pasar (caja, inventario, cita). La lógica vive en
 * voidSale (lib/record-sale): no reescribe cajas cerradas, devuelve el stock y
 * bloquea ventas con factura electrónica o bono.
 */

export type CobroAAnular = {
  id: string;
  total: number;
  created_at: string;
  appointment_id: string | null;
  cliente?: string | null;
  detalle?: string | null;
};

type Props = {
  cobro: CobroAAnular | null;
  onClose: () => void;
  /** Se llama tras anular. `aviso` = algo secundario que no se pudo (stock o cita). */
  onAnulado: (aviso?: string) => void;
};

export default function AnularCobroModal({ cobro, onClose, onAnulado }: Props) {
  const { t } = useTheme();
  const { timezone } = useTenant();
  const { tenantId } = useAuth();
  const [contrasena, setContrasena] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enCurso = useRef(false);

  useEffect(() => {
    setContrasena("");
    setError(null);
  }, [cobro?.id]);

  if (!cobro) return null;

  const dia = diaLocalDe(cobro.created_at, timezone);
  const cuando = `${esHoy(dia, timezone) ? "Hoy" : fmtDia(dia, "corto")} · ${fmt12(horaLocalDe(cobro.created_at, timezone))}`;

  const confirmar = async () => {
    if (enCurso.current || !contrasena) return;
    enCurso.current = true;
    setEnviando(true);
    setError(null);
    try {
      const res = await voidSale(cobro.id, cobro.appointment_id, { contrasena });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      // La cita vuelve a Confirmada: su recordatorio se había cancelado al
      // cobrarla. Se reprograman todos (en segundo plano, sin frenar el cierre).
      if (cobro.appointment_id && tenantId) void refreshAllReminders(tenantId, timezone).catch(() => {});
      onAnulado(res.aviso);
    } finally {
      enCurso.current = false;
      setEnviando(false);
    }
  };

  const efectos = [
    { icon: "cash-outline" as const, texto: "El ingreso sale de la caja. Si la caja de ese día ya se cerró, su arqueo no se toca: se registra un egreso «Anulación» en la caja abierta de hoy." },
    { icon: "cube-outline" as const, texto: "Si el cobro incluía productos, las unidades vuelven al inventario." },
    ...(cobro.appointment_id ? [{ icon: "calendar-outline" as const, texto: "La cita vuelve a quedar Confirmada, lista para cobrarse de nuevo." }] : []),
    { icon: "alert-circle-outline" as const, texto: "No se puede deshacer." },
  ];

  return (
    <Modal visible animationType="slide" transparent onRequestClose={() => { if (!enviando) onClose(); }}>
      <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[s.sheet, { backgroundColor: t.cardSolid, borderColor: t.line }]}>
          <View style={[s.handle, { backgroundColor: t.lineStrong }]} />
          <View style={s.titleRow}>
            <View style={s.titleIcon}><Ionicons name="trash-outline" size={18} color={Colors.red} /></View>
            <Text style={[s.title, { color: t.text }]} accessibilityRole="header">Anular cobro</Text>
          </View>

          <View style={[s.resumen, { backgroundColor: t.chipBg }]}>
            <Text style={[s.monto, { color: t.text }]}>{fmtMoneyFull(Number(cobro.total))}</Text>
            <Text style={[s.meta, { color: t.muted }]} numberOfLines={1}>
              {cobro.cliente ?? "Venta directa"} · {cuando}
            </Text>
            {cobro.detalle ? <Text style={[s.meta, { color: t.subtle }]} numberOfLines={1}>{cobro.detalle}</Text> : null}
          </View>

          <View style={{ gap: 8, marginTop: 14 }}>
            {efectos.map((e, i) => (
              <View key={i} style={s.efecto}>
                <Ionicons name={e.icon} size={15} color={t.muted} style={{ marginTop: 1 }} />
                <Text style={[s.efectoTxt, { color: t.muted }]}>{e.texto}</Text>
              </View>
            ))}
          </View>

          <Text style={[s.label, { color: t.muted }]}>Escribe tu contraseña para confirmar</Text>
          <TextInput
            style={[s.input, { backgroundColor: t.inputBg, borderColor: error ? Colors.red : t.inputBorder, color: t.text }]}
            value={contrasena}
            onChangeText={v => { setContrasena(v); if (error) setError(null); }}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="password"
            placeholder="Contraseña de tu cuenta"
            placeholderTextColor={t.subtle}
            editable={!enviando}
            onSubmitEditing={confirmar}
            accessibilityLabel="Contraseña"
          />
          {error ? (
            <View style={s.errorBox} accessibilityRole="alert">
              <Ionicons name="close-circle-outline" size={15} color={Colors.red} />
              <Text style={s.errorTxt}>{error}</Text>
            </View>
          ) : null}

          <View style={s.acciones}>
            <TouchableOpacity
              style={[s.btnSec, { borderColor: t.line }]}
              onPress={onClose}
              disabled={enviando}
              accessibilityRole="button"
            >
              <Text style={[s.btnSecTxt, { color: t.muted }]}>No anular</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.btnPri, (!contrasena || enviando) && { opacity: 0.45 }]}
              onPress={confirmar}
              disabled={!contrasena || enviando}
              accessibilityRole="button"
              accessibilityState={{ disabled: !contrasena || enviando }}
            >
              {enviando ? <ActivityIndicator color="white" /> : <Text style={s.btnPriTxt}>Anular cobro</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay:   { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet:     { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, padding: 22, paddingBottom: 36 },
  handle:    { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 14 },
  titleRow:  { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  titleIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: "rgba(251,15,5,0.10)", alignItems: "center", justifyContent: "center" },
  title:     { fontSize: 18, fontFamily: Fonts.bold },
  resumen:   { borderRadius: Radius.md, padding: 14, gap: 2 },
  monto:     { fontSize: 24, fontFamily: Fonts.bold, letterSpacing: -0.5 },
  meta:      { fontSize: 12.5, fontFamily: Fonts.regular },
  efecto:    { flexDirection: "row", gap: 8 },
  efectoTxt: { flex: 1, fontSize: 12.5, fontFamily: Fonts.regular, lineHeight: 17 },
  label:     { fontSize: 11, fontFamily: Fonts.bold, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 18, marginBottom: 8 },
  input:     { borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontFamily: Fonts.regular },
  errorBox:  { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 8 },
  errorTxt:  { flex: 1, fontSize: 12.5, fontFamily: Fonts.semibold, color: Colors.red, lineHeight: 17 },
  acciones:  { flexDirection: "row", gap: 10, marginTop: 18 },
  btnSec:    { flex: 1, borderWidth: 1, borderRadius: Radius.full, paddingVertical: 14, alignItems: "center" },
  btnSecTxt: { fontSize: 14, fontFamily: Fonts.semibold },
  btnPri:    { flex: 1.4, backgroundColor: Colors.red, borderRadius: Radius.full, paddingVertical: 14, alignItems: "center" },
  btnPriTxt: { fontSize: 14, fontFamily: Fonts.bold, color: "white" },
});
