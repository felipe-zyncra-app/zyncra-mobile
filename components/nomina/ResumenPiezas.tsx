import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Fonts, Gradients, Radius } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { fmtMoneyFull } from "@/lib/format";
import { fmtDia } from "@/lib/tz";
import type { Pendiente, ResumenProfesional } from "@/lib/nomina";
import { FilaMonto } from "./comun";
import { citas, etiquetaNovedad, ORIGEN_NOVEDAD, textoBasico } from "./ResumenTextos";

/**
 * Piezas de presentación de la nómina (Resumen del dueño y Mi nómina del
 * equipo). Pintan lo que manda el servidor; no suman nada que importe.
 */

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

// ─── Avatar con iniciales (el mismo degradado del web) ───────────────────────

export function AvatarNomina({ nombre, size = 38 }: { nombre: string; size?: number }) {
  const iniciales = nombre.trim().split(/\s+/).map(p => p[0]).filter(Boolean).join("").slice(0, 2).toUpperCase() || "?";
  return (
    <LinearGradient
      colors={Gradients.brand}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center" }}
    >
      <Text style={{ color: "white", fontFamily: Fonts.bold, fontSize: Math.round(size / 2.8) }}>{iniciales}</Text>
    </LinearGradient>
  );
}

// ─── Aviso (ok / advertencia / error), opcionalmente con cerrar ──────────────

const TONOS = {
  ok:    { fondo: "rgba(16,185,129,0.10)", borde: "rgba(16,185,129,0.30)", color: "#047857", icono: "checkmark-circle-outline" },
  aviso: { fondo: "rgba(245,158,11,0.10)", borde: "rgba(245,158,11,0.32)", color: "#b45309", icono: "warning-outline" },
  error: { fondo: "rgba(251,15,5,0.07)",   borde: "rgba(251,15,5,0.28)",   color: "#d90d04", icono: "alert-circle-outline" },
  info:  { fondo: "rgba(0,39,254,0.07)",   borde: "rgba(0,39,254,0.22)",   color: Colors.blue, icono: "information-circle-outline" },
} as const;

export type TonoAviso = keyof typeof TONOS;

export function Aviso({ tono, texto, titulo, onCerrar, accion }: {
  tono: TonoAviso;
  texto: string;
  titulo?: string;
  onCerrar?: () => void;
  accion?: { label: string; onPress: () => void };
}) {
  const { mode } = useTheme();
  const c = TONOS[tono];
  // En oscuro los tonos fuertes de claro no se leen sobre el fondo: se aclaran.
  const color = mode === "dark" ? (tono === "ok" ? "#34d399" : tono === "aviso" ? "#fbbf24" : tono === "error" ? "#f87171" : "#93a4ff") : c.color;
  return (
    <View
      style={[s.aviso, { backgroundColor: c.fondo, borderColor: c.borde }]}
      accessibilityRole={tono === "error" ? "alert" : "summary"}
    >
      <Ionicons name={c.icono as IoniconName} size={16} color={color} style={{ marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        {titulo ? <Text style={[s.avisoTitulo, { color }]}>{titulo}</Text> : null}
        <Text style={[s.avisoTxt, { color }]}>{texto}</Text>
        {accion ? (
          <TouchableOpacity onPress={accion.onPress} accessibilityRole="button" hitSlop={8} style={{ marginTop: 6, alignSelf: "flex-start" }}>
            <Text style={[s.avisoAccion, { color }]}>{accion.label}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {onCerrar ? (
        <TouchableOpacity onPress={onCerrar} hitSlop={10} accessibilityRole="button" accessibilityLabel="Cerrar aviso">
          <Ionicons name="close" size={16} color={color} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// ─── Botón ───────────────────────────────────────────────────────────────────

export function BotonNomina({ label, onPress, tono = "primario", disabled, cargando, chico, icono, accessibilityLabel, flex }: {
  label: string;
  onPress: () => void;
  tono?: "primario" | "suave" | "fantasma" | "peligro";
  disabled?: boolean;
  cargando?: boolean;
  chico?: boolean;
  icono?: IoniconName;
  accessibilityLabel?: string;
  flex?: number;
}) {
  const { t } = useTheme();
  const estilos = {
    primario: { fondo: Colors.red, borde: Colors.red, color: "white" },
    suave:    { fondo: "rgba(251,15,5,0.08)", borde: "transparent", color: Colors.red },
    fantasma: { fondo: "transparent", borde: t.lineStrong, color: t.ink },
    peligro:  { fondo: "rgba(239,68,68,0.10)", borde: "transparent", color: "#dc2626" },
  }[tono];
  const apagado = !!disabled || !!cargando;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={apagado}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: apagado, busy: !!cargando }}
      style={[
        chico ? s.btnChico : s.btn,
        { backgroundColor: estilos.fondo, borderColor: estilos.borde },
        flex !== undefined && { flex },
        disabled && !cargando && { opacity: 0.45 },
      ]}
    >
      {cargando ? (
        <ActivityIndicator size="small" color={estilos.color} />
      ) : (
        <>
          {icono ? <Ionicons name={icono} size={chico ? 14 : 16} color={estilos.color} /> : null}
          <Text style={[chico ? s.btnChicoTxt : s.btnTxt, { color: estilos.color }]} numberOfLines={1}>{label}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

// ─── Desglose de lo pendiente ────────────────────────────────────────────────

/**
 * Lo que se le debe en el rango: comisiones, básico, cada novedad y el total
 * (todo del servidor). `compacto` deja solo los conceptos con valor, muestra
 * las novedades por tipo (propinas, bonos, descuentos, ya sumadas por el
 * servidor) y no repite el total, para la lista del Resumen.
 */
export function DesglosePendiente({ pend, compacto }: { pend: Pendiente; compacto?: boolean }) {
  const { t } = useTheme();
  const c = pend.comisiones;
  const filas: React.ReactNode[] = [];
  if (!compacto || c.comisionServicios > 0 || c.citas > 0) {
    filas.push(
      <FilaMonto key="serv" label="Comisión por servicios" valor={c.comisionServicios}
        sub={c.citas > 0 || c.ventasServicios > 0 ? `${citas(c.citas)} · ${fmtMoneyFull(c.ventasServicios)} en servicios` : null} />,
    );
  }
  if (!compacto || c.comisionProductos > 0 || c.ventasProductos > 0) {
    filas.push(
      <FilaMonto key="prod" label="Comisión por productos" valor={c.comisionProductos}
        sub={c.ventasProductos > 0 ? `${fmtMoneyFull(c.ventasProductos)} en productos` : null} />,
    );
  }
  if (pend.basico) {
    filas.push(<FilaMonto key="basico" label="Básico" valor={pend.basico.monto} sub={textoBasico(pend.basico)} />);
  }
  if (compacto) {
    if (pend.propinas > 0) filas.push(<FilaMonto key="propinas" label="Propinas" valor={pend.propinas} />);
    if (pend.bonos > 0) filas.push(<FilaMonto key="bonos" label="Bonificaciones" valor={pend.bonos} />);
    if (pend.descuentos > 0) filas.push(<FilaMonto key="desc" label="Descuentos y adelantos" valor={pend.descuentos} signo={-1} />);
  } else {
    for (const n of pend.novedades) {
      filas.push(
        <FilaMonto key={n.id} label={etiquetaNovedad(n)} valor={n.amount} signo={n.kind === "deduction" ? -1 : 1}
          sub={`${fmtDia(n.entry_date, "dia-mes")} · ${ORIGEN_NOVEDAD[n.source] ?? n.source}`} />,
      );
    }
  }
  const total = pend.total;
  if (compacto) return <View>{filas}</View>;
  return (
    <View>
      {filas}
      <View style={[s.totalSep, { borderTopColor: t.line }]}>
        <FilaMonto
          label={total < 0 ? "Saldo a favor del negocio" : "Total por pagar"}
          valor={Math.abs(total)}
          fuerte
          color={total < 0 ? Colors.red : undefined}
        />
      </View>
    </View>
  );
}

// ─── Productividad del periodo ───────────────────────────────────────────────

/** Todo lo atendido en el rango, pagado o no (p.periodo del servidor). */
export function Productividad({ p }: { p: ResumenProfesional }) {
  const { t } = useTheme();
  const datos: [string, string][] = [
    ["Citas", String(p.periodo.citas)],
    ["Servicios", fmtMoneyFull(p.periodo.ventasServicios)],
    ["Productos", fmtMoneyFull(p.periodo.ventasProductos)],
    ["Comisión del periodo", fmtMoneyFull(p.periodo.comisionServicios + p.periodo.comisionProductos)],
  ];
  return (
    <View style={s.prodGrid}>
      {datos.map(([k, v]) => (
        <View key={k} style={[s.prodCelda, { backgroundColor: t.chipBg }]} accessible accessibilityLabel={`${k}: ${v}`}>
          <Text style={[s.prodLbl, { color: t.subtle }]} numberOfLines={1}>{k}</Text>
          <Text style={[s.prodVal, { color: t.text }]} numberOfLines={1} adjustsFontSizeToFit>{v}</Text>
        </View>
      ))}
    </View>
  );
}

/** Etiqueta pequeña ("Liquidada", "Inactivo", "Nómina"). */
export function Etiqueta({ texto, color }: { texto: string; color: string }) {
  return (
    <View style={[s.etiqueta, { backgroundColor: color + "18" }]}>
      <Text style={[s.etiquetaTxt, { color }]}>{texto}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  aviso:       { flexDirection: "row", alignItems: "flex-start", gap: 9, borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: 12, paddingVertical: 11 },
  avisoTitulo: { fontSize: 13, fontFamily: Fonts.bold, marginBottom: 2 },
  avisoTxt:    { fontSize: 12.5, fontFamily: Fonts.regular, lineHeight: 17 },
  avisoAccion: { fontSize: 12.5, fontFamily: Fonts.bold, textDecorationLine: "underline" },

  btn:         { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderWidth: 1, borderRadius: Radius.full, paddingVertical: 13, paddingHorizontal: 18, minHeight: 46 },
  btnTxt:      { fontSize: 14, fontFamily: Fonts.bold },
  btnChico:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, borderWidth: 1, borderRadius: Radius.full, paddingVertical: 8, paddingHorizontal: 14, minHeight: 36 },
  btnChicoTxt: { fontSize: 12.5, fontFamily: Fonts.bold },

  totalSep:    { borderTopWidth: 1, marginTop: 4, paddingTop: 2 },

  prodGrid:    { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  prodCelda:   { flexBasis: "47%", flexGrow: 1, borderRadius: Radius.md, paddingHorizontal: 12, paddingVertical: 10 },
  prodLbl:     { fontSize: 9.5, fontFamily: Fonts.mono, textTransform: "uppercase", letterSpacing: 0.8 },
  prodVal:     { fontSize: 15, fontFamily: Fonts.bold, marginTop: 3 },

  etiqueta:    { borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 2, alignSelf: "flex-start" },
  etiquetaTxt: { fontSize: 10.5, fontFamily: Fonts.bold },
});
