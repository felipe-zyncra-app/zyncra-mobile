import type { ReactNode } from "react";
import {
  Modal, View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, type TextInputProps,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Fonts, Radius } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { IconButton } from "@/components/ui";
import { monedaSinDecimales } from "@/lib/dinero";
import type { ReglaTipo } from "@/lib/nomina";

/**
 * Piezas de las hojas de Nómina → Reglas (pago de un profesional, comisión de
 * un servicio) y Nómina → Novedades: la hoja inferior con teclado, las
 * opciones grandes (44 pt), los campos y los botones. Solo presentación.
 */

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

const HIT = { top: 6, bottom: 6, left: 4, right: 4 };

// ─── Hoja inferior ───────────────────────────────────────────────────────────

export function Hoja({ titulo, subtitulo, onCerrar, ocupado, children, pie }: {
  titulo: string;
  subtitulo?: string | null;
  onCerrar: () => void;
  /** Guardando: no se cierra con el gesto ni con la X. */
  ocupado?: boolean;
  children: ReactNode;
  /** Botones fijos abajo (fuera del scroll, siempre a la vista con el teclado). */
  pie: ReactNode;
}) {
  const { t } = useTheme();
  const cerrar = () => { if (!ocupado) onCerrar(); };
  return (
    <Modal visible animationType="slide" transparent onRequestClose={cerrar}>
      <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[s.hoja, { backgroundColor: t.cardSolid, borderColor: t.line }]}>
          <View style={[s.asa, { backgroundColor: t.lineStrong }]} />
          <View style={s.cabeza}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[s.titulo, { color: t.text }]} accessibilityRole="header" numberOfLines={2}>{titulo}</Text>
              {subtitulo ? <Text style={[s.subtitulo, { color: t.muted }]} numberOfLines={2}>{subtitulo}</Text> : null}
            </View>
            <IconButton icon="close" label="Cerrar" onPress={cerrar} disabled={ocupado} />
          </View>
          <ScrollView
            style={s.cuerpo}
            contentContainerStyle={s.cuerpoContenido}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
          <View style={[s.pie, { borderTopColor: t.line }]}>{pie}</View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Textos ──────────────────────────────────────────────────────────────────

export function Etiqueta({ children }: { children: ReactNode }) {
  const { t } = useTheme();
  return <Text style={[s.etiqueta, { color: t.muted }]}>{children}</Text>;
}

export function Ayuda({ children, tono = "normal" }: { children: ReactNode; tono?: "normal" | "alerta" }) {
  const { t } = useTheme();
  return (
    <Text style={[s.ayuda, { color: tono === "alerta" ? "#b45309" : t.subtle }]}>{children}</Text>
  );
}

export function CajaError({ mensaje }: { mensaje: string | null }) {
  if (!mensaje) return null;
  return (
    <View style={s.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Ionicons name="alert-circle-outline" size={16} color={Colors.red} style={{ marginTop: 1 }} />
      <Text style={s.errorTxt}>{mensaje}</Text>
    </View>
  );
}

/** Aviso en línea (información o resultado), no un error. */
export function Aviso({ texto, icono = "information-circle-outline", tono = "info" }: {
  texto: string; icono?: IoniconName; tono?: "info" | "ok";
}) {
  const { t } = useTheme();
  const color = tono === "ok" ? Colors.success : Colors.blue;
  return (
    <View style={[s.aviso, { backgroundColor: color + "12" }]} accessibilityLiveRegion="polite">
      <Ionicons name={icono} size={16} color={color} style={{ marginTop: 1 }} />
      <Text style={[s.avisoTxt, { color: t.text }]}>{texto}</Text>
    </View>
  );
}

// ─── Opciones ────────────────────────────────────────────────────────────────

export type Opcion<T extends string> = { valor: T; etiqueta: string; icono?: IoniconName; ayuda?: string; color?: string };

/**
 * Opciones excluyentes con botones de al menos 44 pt. En fila para 2–3
 * opciones cortas; en lista (con ayuda debajo) para las largas.
 */
export function Opciones<T extends string>({ opciones, valor, onCambiar, enLista, deshabilitado }: {
  opciones: readonly Opcion<T>[];
  valor: T;
  onCambiar: (v: T) => void;
  enLista?: boolean;
  deshabilitado?: boolean;
}) {
  const { t } = useTheme();
  return (
    <View style={enLista ? s.opcionesLista : s.opcionesFila} accessibilityRole="radiogroup">
      {opciones.map(o => {
        const activa = o.valor === valor;
        const color = o.color ?? t.ink;
        return (
          <TouchableOpacity
            key={o.valor}
            onPress={() => onCambiar(o.valor)}
            disabled={deshabilitado}
            activeOpacity={0.75}
            accessibilityRole="radio"
            accessibilityState={{ selected: activa, disabled: !!deshabilitado }}
            accessibilityLabel={o.ayuda ? `${o.etiqueta}. ${o.ayuda}` : o.etiqueta}
            style={[
              enLista ? s.opcionLista : s.opcionFila,
              { borderColor: activa ? color : t.line, backgroundColor: activa ? color + "12" : t.chipBg },
            ]}
          >
            {o.icono ? <Ionicons name={o.icono} size={17} color={activa ? color : t.muted} /> : null}
            <View style={enLista ? { flex: 1, minWidth: 0 } : undefined}>
              <Text
                style={[s.opcionTxt, { color: activa ? (o.color ?? t.text) : t.muted }, activa && { fontFamily: Fonts.bold }]}
                numberOfLines={enLista ? 1 : 2}
              >
                {o.etiqueta}
              </Text>
              {enLista && o.ayuda ? <Text style={[s.opcionAyuda, { color: t.subtle }]}>{o.ayuda}</Text> : null}
            </View>
            {enLista ? (
              <Ionicons name={activa ? "radio-button-on" : "radio-button-off"} size={18} color={activa ? color : t.subtle} />
            ) : null}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/** Pastilla para elegir una persona o un atajo ("Hoy", "Todo el equipo"). */
export function Chip({ etiqueta, activo, onPress, apagado, icono }: {
  etiqueta: string; activo?: boolean; onPress: () => void; apagado?: boolean; icono?: IoniconName;
}) {
  const { t } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={apagado}
      hitSlop={HIT}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={etiqueta}
      accessibilityState={{ selected: !!activo, disabled: !!apagado }}
      style={[
        s.chip,
        { backgroundColor: activo ? t.ink : t.chipBg, borderColor: activo ? t.ink : t.line },
        apagado && { opacity: 0.4 },
      ]}
    >
      {icono ? <Ionicons name={icono} size={14} color={activo ? t.cardSolid : t.muted} /> : null}
      <Text style={[s.chipTxt, { color: activo ? t.cardSolid : t.muted }]} numberOfLines={1}>{etiqueta}</Text>
    </TouchableOpacity>
  );
}

// ─── Campos ──────────────────────────────────────────────────────────────────

export function CampoTexto({ conError, style, ...props }: TextInputProps & { conError?: boolean }) {
  const { t } = useTheme();
  return (
    <TextInput
      placeholderTextColor={t.subtle}
      {...props}
      style={[s.campo, { backgroundColor: t.inputBg, borderColor: conError ? Colors.red : t.inputBorder, color: t.text }, style]}
    />
  );
}

/** Teclado para montos: sin centavos (pesos) basta el numérico. */
export function tecladoMonto(): "number-pad" | "decimal-pad" {
  return monedaSinDecimales() ? "number-pad" : "decimal-pad";
}

/** Valor de una regla con su unidad: "$" delante si es fijo, "%" detrás si es porcentaje. */
export function CampoValor({ tipo, valor, onCambiar, etiqueta, placeholder, editable = true }: {
  tipo: ReglaTipo;
  valor: string;
  onCambiar: (v: string) => void;
  /** Lo que dice el lector de pantalla. */
  etiqueta: string;
  placeholder?: string;
  editable?: boolean;
}) {
  const { t } = useTheme();
  const pct = tipo === "percentage";
  return (
    <View style={[s.campoValor, { backgroundColor: t.inputBg, borderColor: t.inputBorder }]}>
      {!pct ? <Text style={[s.unidad, { color: t.muted }]}>$</Text> : null}
      <TextInput
        value={valor}
        onChangeText={onCambiar}
        keyboardType={pct ? "decimal-pad" : tecladoMonto()}
        placeholder={placeholder ?? (pct ? "Ej. 40" : "Ej. 15000")}
        placeholderTextColor={t.subtle}
        editable={editable}
        accessibilityLabel={etiqueta}
        style={[s.campoValorInput, { color: t.text }]}
      />
      {pct ? <Text style={[s.unidad, { color: t.muted }]}>%</Text> : null}
    </View>
  );
}

// ─── Botones ─────────────────────────────────────────────────────────────────

export function BotonesHoja({ onCancelar, onGuardar, guardando, textoGuardar = "Guardar", deshabilitado }: {
  onCancelar: () => void;
  onGuardar: () => void;
  guardando: boolean;
  textoGuardar?: string;
  deshabilitado?: boolean;
}) {
  const { t } = useTheme();
  const apagado = guardando || !!deshabilitado;
  return (
    <View style={s.botones}>
      <TouchableOpacity
        style={[s.btnSec, { borderColor: t.line }]}
        onPress={onCancelar}
        disabled={guardando}
        accessibilityRole="button"
      >
        <Text style={[s.btnSecTxt, { color: t.muted }]}>Cancelar</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[s.btnPri, apagado && { opacity: 0.55 }]}
        onPress={onGuardar}
        disabled={apagado}
        accessibilityRole="button"
        accessibilityLabel={textoGuardar}
        accessibilityState={{ disabled: apagado, busy: guardando }}
      >
        {guardando ? <ActivityIndicator color="white" /> : <Text style={s.btnPriTxt}>{textoGuardar}</Text>}
      </TouchableOpacity>
    </View>
  );
}

/** Botón de texto destructivo ("Borrar novedad", "Quitar"). */
export function BotonPeligro({ texto, onPress, deshabilitado, icono = "trash-outline" }: {
  texto: string; onPress: () => void; deshabilitado?: boolean; icono?: IoniconName;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={deshabilitado}
      hitSlop={HIT}
      accessibilityRole="button"
      accessibilityLabel={texto}
      accessibilityState={{ disabled: !!deshabilitado }}
      style={[s.peligro, deshabilitado && { opacity: 0.45 }]}
    >
      <Ionicons name={icono} size={16} color={Colors.red} />
      <Text style={s.peligroTxt}>{texto}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  overlay:   { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  hoja:      { maxHeight: "92%", borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, paddingTop: 10 },
  asa:       { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 10 },
  cabeza:    { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 20, paddingBottom: 8 },
  titulo:    { fontSize: 18, fontFamily: Fonts.bold, letterSpacing: -0.2 },
  subtitulo: { fontSize: 12.5, fontFamily: Fonts.regular, marginTop: 2 },
  cuerpo:    { flexGrow: 0, flexShrink: 1 },
  cuerpoContenido: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16, gap: 8 },
  pie:       { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 30, borderTopWidth: 1, gap: 10 },

  etiqueta:  { fontSize: 11, fontFamily: Fonts.bold, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 10 },
  ayuda:     { fontSize: 12, fontFamily: Fonts.regular, lineHeight: 17 },
  error:     { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, borderRadius: Radius.md, backgroundColor: "rgba(251,15,5,0.08)" },
  errorTxt:  { flex: 1, fontSize: 13, fontFamily: Fonts.semibold, color: Colors.red, lineHeight: 18 },
  aviso:     { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, borderRadius: Radius.md },
  avisoTxt:  { flex: 1, fontSize: 12.5, fontFamily: Fonts.regular, lineHeight: 18 },

  opcionesFila:  { flexDirection: "row", gap: 8 },
  opcionesLista: { gap: 8 },
  opcionFila:    { flex: 1, minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 8, paddingVertical: 8, borderRadius: Radius.md, borderWidth: 1 },
  opcionLista:   { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderRadius: Radius.md, borderWidth: 1 },
  opcionTxt:     { fontSize: 13, fontFamily: Fonts.semibold, textAlign: "center" },
  opcionAyuda:   { fontSize: 11.5, fontFamily: Fonts.regular, marginTop: 2 },

  chip:      { minHeight: 40, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, borderRadius: Radius.full, borderWidth: 1, maxWidth: 240 },
  chipTxt:   { fontSize: 13, fontFamily: Fonts.semibold },

  campo:     { minHeight: 48, borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontFamily: Fonts.regular },
  campoValor: { minHeight: 48, flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: 14, gap: 6 },
  campoValorInput: { flex: 1, paddingVertical: 12, fontSize: 15, fontFamily: Fonts.regular },
  unidad:    { fontSize: 15, fontFamily: Fonts.semibold },

  botones:   { flexDirection: "row", gap: 10 },
  btnSec:    { flex: 1, minHeight: 48, borderWidth: 1, borderRadius: Radius.full, alignItems: "center", justifyContent: "center" },
  btnSecTxt: { fontSize: 14, fontFamily: Fonts.semibold },
  btnPri:    { flex: 1.4, minHeight: 48, backgroundColor: Colors.red, borderRadius: Radius.full, alignItems: "center", justifyContent: "center" },
  btnPriTxt: { fontSize: 14, fontFamily: Fonts.bold, color: "white" },
  peligro:   { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, alignSelf: "center", paddingHorizontal: 12 },
  peligroTxt: { fontSize: 13.5, fontFamily: Fonts.bold, color: Colors.red },
});
