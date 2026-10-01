import { useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Fonts, Radius } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { SegmentedControl } from "@/components/ui";
import { fmtMoneyFull } from "@/lib/format";
import { fmtDia, hoyNegocio } from "@/lib/tz";
import { moverPeriodo, periodoDe, type TipoPeriodo, type Tramo } from "@/lib/nomina";

/**
 * Piezas compartidas por las pantallas de nómina (dueño: Nómina; equipo: Mi
 * nómina). Solo presentan: los montos vienen calculados del servidor.
 */

/** "1 – 15 oct 2026", "16 – 31 oct 2026", "29 sep – 5 oct 2026". */
export function etiquetaTramo(t: Tramo): string {
  if (t.desde === t.hasta) return fmtDia(t.desde, "corto");
  const mismoAnio = t.desde.slice(0, 4) === t.hasta.slice(0, 4);
  const mismoMes = mismoAnio && t.desde.slice(5, 7) === t.hasta.slice(5, 7);
  if (mismoMes) return `${Number(t.desde.slice(8, 10))} – ${fmtDia(t.hasta, "corto")}`;
  if (mismoAnio) return `${fmtDia(t.desde, "dia-mes")} – ${fmtDia(t.hasta, "corto")}`;
  return `${fmtDia(t.desde, "corto")} – ${fmtDia(t.hasta, "corto")}`;
}

/** Periodo elegido en pantalla: quincena (por defecto), mes o semana, y su navegación. */
export function usePeriodoNomina(timezone: string, inicial: TipoPeriodo = "quincena") {
  const hoy = hoyNegocio(timezone);
  const [tipo, setTipoState] = useState<TipoPeriodo>(inicial);
  const [tramo, setTramo] = useState<Tramo>(() => periodoDe(inicial, hoy));
  const actual = useMemo(() => periodoDe(tipo, hoy), [tipo, hoy]);
  const setTipo = (t: TipoPeriodo) => { setTipoState(t); setTramo(periodoDe(t, hoy)); };
  return {
    hoy,
    tipo,
    setTipo,
    tramo,
    anterior: () => setTramo(x => moverPeriodo(tipo, x, -1)),
    // No se navega al futuro: nada se liquida después de hoy.
    siguiente: () => setTramo(x => (x.hasta >= hoy ? x : moverPeriodo(tipo, x, 1))),
    esActual: tramo.desde === actual.desde && tramo.hasta === actual.hasta,
    puedeAvanzar: tramo.hasta < hoy,
  };
}

export type PeriodoNomina = ReturnType<typeof usePeriodoNomina>;

const OPCIONES: { value: TipoPeriodo; label: string }[] = [
  { value: "quincena", label: "Quincena" },
  { value: "mes", label: "Mes" },
  { value: "semana", label: "Semana" },
];

export function SelectorPeriodo({ periodo }: { periodo: PeriodoNomina }) {
  const { t } = useTheme();
  return (
    <View style={{ gap: 10 }}>
      <SegmentedControl options={OPCIONES} value={periodo.tipo} onChange={periodo.setTipo} />
      <View style={[s.nav, { backgroundColor: t.cardSolid, borderColor: t.line }]}>
        <TouchableOpacity onPress={periodo.anterior} hitSlop={10} accessibilityRole="button" accessibilityLabel="Periodo anterior" style={s.navBtn}>
          <Ionicons name="chevron-back" size={18} color={t.text} />
        </TouchableOpacity>
        <View style={{ alignItems: "center", flex: 1 }}>
          <Text style={[s.navTxt, { color: t.text }]}>{etiquetaTramo(periodo.tramo)}</Text>
          {periodo.esActual && <Text style={[s.navSub, { color: t.subtle }]}>Periodo actual</Text>}
        </View>
        <TouchableOpacity
          onPress={periodo.siguiente} hitSlop={10} disabled={!periodo.puedeAvanzar}
          accessibilityRole="button" accessibilityLabel="Periodo siguiente"
          accessibilityState={{ disabled: !periodo.puedeAvanzar }}
          style={[s.navBtn, !periodo.puedeAvanzar && { opacity: 0.3 }]}>
          <Ionicons name="chevron-forward" size={18} color={t.text} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

/** Fila "concepto ........ $monto". `signo` -1 lo muestra como resta, en rojo. */
export function FilaMonto({ label, valor, sub, signo = 1, fuerte, color }: {
  label: string; valor: number; sub?: string | null; signo?: 1 | -1; fuerte?: boolean; color?: string;
}) {
  const { t } = useTheme();
  const tono = color ?? (signo < 0 ? Colors.red : t.text);
  return (
    <View style={s.fila}>
      <View style={{ flex: 1, paddingRight: 10 }}>
        <Text style={[fuerte ? s.filaLabelFuerte : s.filaLabel, { color: fuerte ? t.text : t.muted }]}>{label}</Text>
        {!!sub && <Text style={[s.filaSub, { color: t.subtle }]}>{sub}</Text>}
      </View>
      <Text style={[fuerte ? s.filaValorFuerte : s.filaValor, { color: tono }]}>
        {signo < 0 && valor > 0 ? "− " : ""}{fmtMoneyFull(valor)}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  nav: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: Radius.md, paddingVertical: 8, paddingHorizontal: 6 },
  navBtn: { padding: 8, minWidth: 40, minHeight: 40, alignItems: "center", justifyContent: "center" },
  navTxt: { fontSize: 15, fontFamily: Fonts.bold },
  navSub: { fontSize: 11, fontFamily: Fonts.regular, marginTop: 1 },
  fila: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 7 },
  filaLabel: { fontSize: 13.5, fontFamily: Fonts.regular },
  filaLabelFuerte: { fontSize: 15, fontFamily: Fonts.bold },
  filaSub: { fontSize: 11.5, fontFamily: Fonts.regular, marginTop: 2 },
  filaValor: { fontSize: 13.5, fontFamily: Fonts.semibold },
  filaValorFuerte: { fontSize: 17, fontFamily: Fonts.bold },
});
