import { useEffect, useState } from "react";
import { View, Text, TextInput } from "react-native";
import { Colors, Fonts, Radius } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { fmt12 } from "@/lib/format";
import { parsearHora } from "@/lib/scheduling";

// ─── "Otra hora": cualquier minuto del día, fuera de la grilla ────────────────
//
// La grilla ofrece los inicios "oficiales" del negocio (su intervalo). El equipo
// a veces necesita meter una cita entre medias — un retoque de 20 min a las
// 11:10 — y para eso está esto. El choque con otra cita o con una ausencia lo
// valida el guardado (verificarCupo), igual que con un cupo de la grilla; si la
// hora queda fuera de la jornada o sobre el descanso, la pantalla lo avisa
// (`aviso`) y pide confirmar antes de guardar.
export function OtherTimeField({ value, inGrid, onChange, aviso }: {
  value: string | null;
  inGrid: boolean;
  onChange: (t: string) => void;
  /** Advertencia para la hora elegida (fuera de la jornada, descanso…). */
  aviso?: string | null;
}) {
  const { t } = useTheme();
  const [raw, setRaw] = useState("");
  const [invalida, setInvalida] = useState(false);
  useEffect(() => { if (inGrid || value === null) { setRaw(""); setInvalida(false); } }, [inGrid, value]);

  const commit = (text: string) => {
    if (!text.trim()) { setInvalida(false); return; }
    const hora = parsearHora(text);
    // Antes una entrada que no se entendía se descartaba en silencio y el
    // usuario creía haber elegido esa hora.
    setInvalida(!hora);
    if (hora) onChange(hora);
  };

  const outside = value !== null && !inGrid;
  return (
    <View style={{ marginTop: 16 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Text style={{ fontSize: 12, fontFamily: Fonts.semibold, color: t.muted }}>Otra hora</Text>
        <TextInput
          value={raw}
          onChangeText={v => { setRaw(v); if (invalida) setInvalida(false); }}
          onBlur={() => commit(raw)}
          onSubmitEditing={() => commit(raw)}
          placeholder="Ej: 11:10"
          placeholderTextColor={t.subtle}
          keyboardType="numbers-and-punctuation"
          returnKeyType="done"
          accessibilityLabel="Otra hora, en formato de 24 horas"
          style={{
            width: 120, paddingVertical: 9, paddingHorizontal: 12, borderRadius: Radius.md,
            backgroundColor: t.inputBg, borderWidth: 1, borderColor: invalida ? Colors.red : t.inputBorder,
            fontSize: 13, fontFamily: Fonts.semibold, color: t.text,
          }}
        />
        {outside && (
          <Text style={{ fontSize: 12, fontFamily: Fonts.semibold, color: Colors.red, flex: 1 }} numberOfLines={1}>
            Elegida: {fmt12(value!)}
          </Text>
        )}
      </View>
      {invalida ? (
        <Text style={{ fontSize: 11.5, fontFamily: Fonts.semibold, color: Colors.red, marginTop: 6 }}>
          No entendimos esa hora. Escríbela como 11:10 o 14:30 (los minutos con dos dígitos).
        </Text>
      ) : outside && aviso ? (
        <Text style={{ fontSize: 11.5, fontFamily: Fonts.semibold, color: "#d97706", marginTop: 6 }}>
          {aviso}
        </Text>
      ) : null}
      <Text style={{ fontSize: 11, fontFamily: Fonts.regular, color: t.subtle, marginTop: 6 }}>
        Para agendar entre dos cupos (24 h o con AM/PM). Si choca con otra cita o con una ausencia del profesional, no se guardará.
      </Text>
    </View>
  );
}
