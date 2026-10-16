import { useMemo, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Fonts, Radius } from "@/constants/theme";
import { useTheme, type ThemeColors } from "@/lib/theme";
import { fmtMoneyFull } from "@/lib/format";
import { leerMonto, monedaSinDecimales } from "@/lib/dinero";
import { nuevoId } from "@/lib/db";
import { DURACIONES_ADICIONAL, adicionalValido, type Adicional } from "@/lib/adicionales";

const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

/**
 * "Adicional con valor libre" en el paso Servicio de Nueva cita: lo que no
 * está en la carta (arreglar dos uñas, un retoque…) con su nombre, valor y
 * tiempo. Va solo o junto a un servicio de la carta.
 */
export default function AdicionalesEditor({ value, onChange }: {
  value: Adicional[];
  onChange: (v: Adicional[]) => void;
}) {
  const { t } = useTheme();
  const s = useMemo(() => crearEstilos(t), [t]);
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [precioTxt, setPrecioTxt] = useState("");
  const [duracion, setDuracion] = useState(30);

  const precio = leerMonto(precioTxt);
  const ok = adicionalValido({ nombre, precio, duracion });

  const agregar = () => {
    if (!ok || precio === null) return;
    onChange([...value, { key: nuevoId(), nombre: nombre.trim(), precio, duracion }]);
    setNombre(""); setPrecioTxt(""); setDuracion(30); setAbierto(false);
  };

  return (
    <View style={s.card}>
      {value.map(a => (
        <View key={a.key} style={s.item}>
          <View style={s.itemIcon}><Ionicons name="pricetag-outline" size={15} color={Colors.red} /></View>
          <View style={{ flex: 1 }}>
            <Text style={s.itemNombre} numberOfLines={1}>{a.nombre}</Text>
            <Text style={s.sub}>⏱ {a.duracion} min</Text>
          </View>
          <Text style={s.itemPrecio}>{fmtMoneyFull(a.precio)}</Text>
          <TouchableOpacity onPress={() => onChange(value.filter(x => x.key !== a.key))} hitSlop={HIT_SLOP}
            accessibilityRole="button" accessibilityLabel={`Quitar ${a.nombre}`}>
            <Ionicons name="close-circle" size={19} color={t.subtle} />
          </TouchableOpacity>
        </View>
      ))}

      {abierto ? (
        <View style={{ gap: 10 }}>
          <Text style={s.label}>Adicional con valor libre</Text>
          <TextInput
            style={s.input}
            value={nombre}
            onChangeText={setNombre}
            placeholder="Qué se hace (ej: arreglo de 2 uñas)"
            placeholderTextColor={t.subtle}
            maxLength={80}
            autoFocus
            accessibilityLabel="Nombre del adicional"
          />
          <TextInput
            style={s.input}
            value={precioTxt}
            onChangeText={setPrecioTxt}
            placeholder="Valor ($)"
            placeholderTextColor={t.subtle}
            keyboardType={monedaSinDecimales() ? "number-pad" : "decimal-pad"}
            accessibilityLabel="Valor del adicional"
          />
          {precio !== null && <Text style={s.sub}>= {fmtMoneyFull(precio)}</Text>}
          <Text style={s.label}>Tiempo</Text>
          <View style={s.chips}>
            {DURACIONES_ADICIONAL.map(m => {
              const on = duracion === m;
              return (
                <TouchableOpacity key={m} onPress={() => setDuracion(m)} style={[s.chip, on && s.chipOn]}
                  accessibilityRole="button" accessibilityState={{ selected: on }}>
                  <Text style={[s.chipTxt, on && { color: "white" }]}>{m} min</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <View style={{ flexDirection: "row", gap: 10, marginTop: 2 }}>
            <TouchableOpacity onPress={() => setAbierto(false)} style={[s.btn, s.btnSec]} accessibilityRole="button">
              <Text style={[s.btnTxt, { color: t.muted }]}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={agregar} disabled={!ok} style={[s.btn, { backgroundColor: Colors.red }, !ok && { opacity: 0.4 }]}
              accessibilityRole="button" accessibilityState={{ disabled: !ok }}>
              <Text style={[s.btnTxt, { color: "white" }]}>Agregar</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity onPress={() => setAbierto(true)} style={s.abrir} accessibilityRole="button">
          <Ionicons name="add-circle-outline" size={18} color={Colors.red} />
          <View style={{ flex: 1 }}>
            <Text style={s.abrirTxt}>{value.length ? "Agregar otro adicional" : "Adicional con valor libre"}</Text>
            {value.length === 0 && <Text style={s.sub}>Para lo que no está en la carta, como arreglar solo dos uñas.</Text>}
          </View>
        </TouchableOpacity>
      )}
    </View>
  );
}

function crearEstilos(t: ThemeColors) {
  return StyleSheet.create({
    card:       { backgroundColor: t.cardSolid, borderWidth: 1, borderColor: t.line, borderRadius: Radius.lg, padding: 14, marginBottom: 14, gap: 10 },
    item:       { flexDirection: "row", alignItems: "center", gap: 10 },
    itemIcon:   { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(251,15,5,0.08)" },
    itemNombre: { fontSize: 13.5, fontFamily: Fonts.semibold, color: t.text },
    itemPrecio: { fontSize: 13.5, fontFamily: Fonts.bold, color: t.text },
    sub:        { fontSize: 12, fontFamily: Fonts.regular, color: t.muted, lineHeight: 16 },
    label:      { fontSize: 11, fontFamily: Fonts.bold, color: t.muted, textTransform: "uppercase", letterSpacing: 0.6 },
    input:      { fontSize: 14, fontFamily: Fonts.regular, color: t.text, backgroundColor: t.inputBg, borderWidth: 1, borderColor: t.inputBorder, borderRadius: Radius.md, padding: 12 },
    chips:      { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip:       { paddingVertical: 8, paddingHorizontal: 12, borderRadius: Radius.full, borderWidth: 1, borderColor: t.line },
    chipOn:     { backgroundColor: Colors.red, borderColor: Colors.red },
    chipTxt:    { fontSize: 12.5, fontFamily: Fonts.semibold, color: t.text },
    btn:        { flex: 1, paddingVertical: 12, borderRadius: Radius.full, alignItems: "center" },
    btnSec:     { borderWidth: 1, borderColor: t.line },
    btnTxt:     { fontSize: 13.5, fontFamily: Fonts.bold },
    abrir:      { flexDirection: "row", alignItems: "center", gap: 10 },
    abrirTxt:   { fontSize: 14, fontFamily: Fonts.semibold, color: Colors.red },
  });
}
