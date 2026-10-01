import { View, Text, StyleSheet } from "react-native";
import { Colors, Fonts, Radius } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { fmtMoneyFull } from "@/lib/format";
import { fmtDia } from "@/lib/tz";
import { MonoTag } from "@/components/ui";
import { ETIQUETA_REGLA, type Linea } from "@/lib/nomina";
import { agruparPorCita, horaCorta } from "./ResumenTextos";
import { Etiqueta } from "./ResumenPiezas";

/**
 * La productividad cita por cita (las `lineas` del resumen): servicios
 * agrupados por cita y productos uno por uno, con lo cobrado, la comisión,
 * la regla que se aplicó y si ese día ya se liquidó.
 */
export function LineasNomina({ lineas }: { lineas: Linea[] }) {
  const { t } = useTheme();
  const grupos = agruparPorCita(lineas);
  const productos = lineas.filter(l => l.tipo === "producto");

  return (
    <View style={{ gap: 16 }}>
      <View>
        <MonoTag style={s.seccion}>Citas atendidas ({grupos.length})</MonoTag>
        {grupos.length === 0 ? (
          <Text style={[s.vacio, { color: t.muted }]}>Sin citas atendidas en el periodo.</Text>
        ) : (
          <View style={[s.caja, { borderColor: t.line }]}>
            {grupos.map((g, i) => {
              const hora = horaCorta(g.hora);
              return (
                <View key={g.clave} style={[s.grupo, i > 0 && { borderTopWidth: 1, borderTopColor: t.line }]}>
                  <View style={s.filaTop}>
                    <Text style={[s.cuando, { color: t.text }]} numberOfLines={2}>
                      {fmtDia(g.dia, "semana-dia-mes")}{hora ? ` · ${hora}` : ""} · {g.cliente ?? (g.sinCita ? "Venta sin cita" : "Sin cliente")}
                    </Text>
                    {g.liquidada ? <Etiqueta texto="Liquidada" color={Colors.success} /> : null}
                  </View>
                  {g.lineas.map((l, j) => (
                    <FilaLinea key={`${l.item_id ?? l.service_id ?? l.nombre}-${j}`} l={l} />
                  ))}
                </View>
              );
            })}
          </View>
        )}
      </View>

      {productos.length > 0 ? (
        <View>
          <MonoTag style={s.seccion}>Productos vendidos ({productos.length})</MonoTag>
          <View style={[s.caja, { borderColor: t.line }]}>
            {productos.map((l, i) => (
              <View key={`${l.item_id ?? l.venta_id ?? l.nombre}-${i}`} style={[s.grupo, i > 0 && { borderTopWidth: 1, borderTopColor: t.line }]}>
                <View style={s.filaTop}>
                  <Text style={[s.cuando, { color: t.text }]} numberOfLines={2}>
                    {fmtDia(l.dia, "semana-dia-mes")}{l.cliente ? ` · ${l.cliente}` : ""}
                  </Text>
                  {l.liquidada ? <Etiqueta texto="Liquidada" color={Colors.success} /> : null}
                </View>
                <FilaLinea l={l} />
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function FilaLinea({ l }: { l: Linea }) {
  const { t } = useTheme();
  return (
    <View style={s.linea}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[s.nombre, { color: t.text }]} numberOfLines={2}>
          {l.nombre}{l.cantidad > 1 ? ` ×${l.cantidad}` : ""}
        </Text>
        <Text style={[s.regla, { color: l.regla === "ninguna" ? Colors.red : t.subtle }]}>{ETIQUETA_REGLA[l.regla] ?? l.regla}</Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={[s.comision, { color: t.text }]}>{fmtMoneyFull(l.comision)}</Text>
        <Text style={[s.valor, { color: t.muted }]}>de {fmtMoneyFull(l.valor)}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  seccion:  { marginBottom: 8 },
  vacio:    { fontSize: 13, fontFamily: Fonts.regular, paddingVertical: 6 },
  caja:     { borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: 12 },
  grupo:    { paddingVertical: 10, gap: 4 },
  filaTop:  { flexDirection: "row", alignItems: "center", gap: 8 },
  cuando:   { flex: 1, fontSize: 13, fontFamily: Fonts.semibold },
  linea:    { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  nombre:   { fontSize: 12.5, fontFamily: Fonts.regular },
  regla:    { fontSize: 11, fontFamily: Fonts.regular, marginTop: 1 },
  comision: { fontSize: 13, fontFamily: Fonts.bold },
  valor:    { fontSize: 11, fontFamily: Fonts.regular, marginTop: 1 },
});
