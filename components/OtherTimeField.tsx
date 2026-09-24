import { useEffect, useState } from "react";
import { View, Text, TextInput } from "react-native";
import { Colors, Radius, Glass } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { fmt12Hour } from "@/lib/format";

// ─── "Otra hora": cualquier minuto del día, fuera de la grilla ────────────────
//
// La grilla ofrece los inicios "oficiales" del negocio (su intervalo). El equipo
// a veces necesita meter una cita entre medias — un retoque de 20 min a las
// 11:10 — y para eso está esto. El choque con otra cita lo valida el guardado
// (hasSlotConflict), igual que con un cupo de la grilla.
export function OtherTimeField({ value, inGrid, onChange }: {
  value: string | null; inGrid: boolean; onChange: (t: string) => void;
}) {
  const { t } = useTheme();
  const [raw, setRaw] = useState("");
  useEffect(() => { if (inGrid || value === null) setRaw(""); }, [inGrid, value]);
  const commit = (text: string) => {
    // Acepta "9:5", "09:05", "1430" → HH:MM en 24 h
    const digits = text.replace(/\D/g, "");
    if (digits.length < 3) return;
    const h = parseInt(digits.length === 3 ? digits.slice(0, 1) : digits.slice(0, 2), 10);
    const m = parseInt(digits.slice(-2), 10);
    if (isNaN(h) || isNaN(m) || h > 23 || m > 59) return;
    onChange(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  };
  const outside = value !== null && !inGrid;
  return (
    <View style={{ marginTop: 16 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Text style={{ fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: t.muted }}>Otra hora</Text>
        <TextInput
          value={raw}
          onChangeText={setRaw}
          onBlur={() => commit(raw)}
          onSubmitEditing={() => commit(raw)}
          placeholder="HH:MM (24 h)"
          placeholderTextColor={Colors.subtle}
          keyboardType="numbers-and-punctuation"
          returnKeyType="done"
          style={{ width: 120, paddingVertical: 9, paddingHorizontal: 12, borderRadius: Radius.md, ...Glass.card, fontSize: 13, fontFamily: "SpaceGrotesk_600SemiBold", color: t.text }}
        />
        {outside && (
          <Text style={{ fontSize: 12, fontFamily: "SpaceGrotesk_600SemiBold", color: Colors.red, flex: 1 }} numberOfLines={1}>
            Fuera de la grilla: {fmt12Hour(value!)}
          </Text>
        )}
      </View>
      <Text style={{ fontSize: 11, fontFamily: "SpaceGrotesk_400Regular", color: t.subtle, marginTop: 6 }}>
        Para agendar entre dos cupos. Si choca con otra cita del colaborador, no se guardará.
      </Text>
    </View>
  );
}

