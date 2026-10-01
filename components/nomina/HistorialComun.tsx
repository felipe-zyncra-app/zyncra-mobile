import { useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Fonts } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { fmtMoneyFull } from "@/lib/format";
import { diaLocalDe, fmtDia } from "@/lib/tz";
import { useRecarga } from "@/lib/useRecarga";
import { leerHistorial, type ItemHistorial } from "@/lib/nomina";
import { etiquetaTramo } from "./comun";
import { Etiqueta } from "./ResumenPiezas";
import { citas } from "./ResumenTextos";

/**
 * Historial de pagos (colillas de nómina y liquidaciones de comisión de
 * antes), compartido por la pestaña Historial del dueño y Mi nómina del
 * equipo. El servidor decide qué ve cada uno: el profesional, solo lo suyo.
 */

export const POR_PAGINA = 30;

const claveDe = (it: ItemHistorial) => `${it.tipo}-${it.id}`;

/** Une una página nueva sin repetir filas (por si dos pagos comparten paid_at). */
export function unirPaginas(previos: readonly ItemHistorial[], nuevos: readonly ItemHistorial[]): ItemHistorial[] {
  const vistos = new Set(previos.map(claveDe));
  return [...previos, ...nuevos.filter(it => !vistos.has(claveDe(it)))];
}

/**
 * Carga la primera página al enfocar (y cuando cambian el filtro o `version`)
 * y pagina con `antes` = paid_at del último. Una recarga deja sin efecto la
 * página que estaba en camino.
 */
export function useHistorialNomina({ tenantId, profesionalId, timeZone, version = 0, habilitado = true }: {
  tenantId: string;
  profesionalId?: string | null;
  timeZone: string;
  /** Súbelo para forzar una recarga (p. ej. tras anular o al deslizar para refrescar). */
  version?: number;
  habilitado?: boolean;
}) {
  const clave = `${tenantId}|${profesionalId ?? ""}`;
  const [estado, setEstado] = useState<{ clave: string; items: ItemHistorial[]; hayMas: boolean } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [errorMas, setErrorMas] = useState<unknown>(null);
  const generacion = useRef(0);

  const { recargar, cargando } = useRecarga(async () => {
    const mia = ++generacion.current;
    try {
      const r = await leerHistorial({ tenantId, profesionalId, limit: POR_PAGINA });
      if (mia !== generacion.current) return;
      setEstado({ clave, items: r.items, hayMas: r.hayMas });
      setError(null);
      setErrorMas(null);
    } catch (e) {
      if (mia === generacion.current) setError(e);
    }
  }, [clave, version], { timeZone, habilitado, alCambiarSede: false });

  const vigente = estado && estado.clave === clave ? estado : null;
  const items = vigente?.items ?? [];

  const verMas = async () => {
    const ultimo = items[items.length - 1];
    if (cargandoMas || !vigente?.hayMas || !ultimo) return;
    const mia = generacion.current;
    setCargandoMas(true);
    setErrorMas(null);
    try {
      const r = await leerHistorial({ tenantId, profesionalId, limit: POR_PAGINA, antes: ultimo.paid_at });
      if (mia !== generacion.current) return;
      setEstado(prev => (prev && prev.clave === clave
        ? { clave, items: unirPaginas(prev.items, r.items), hayMas: r.hayMas }
        : prev));
    } catch (e) {
      if (mia === generacion.current) setErrorMas(e);
    } finally {
      setCargandoMas(false);
    }
  };

  return {
    items,
    hayMas: vigente?.hayMas ?? false,
    /** Ya llegó la primera página del filtro actual. */
    cargado: !!vigente,
    cargando,
    error,
    cargandoMas,
    errorMas,
    recargar,
    verMas,
  };
}

/** Una fila del historial. Las de nómina abren la colilla; las de comisión vieja no tienen. */
export function FilaHistorial({ it, timeZone, conNombre = true, primero, onPress }: {
  it: ItemHistorial;
  timeZone: string;
  conNombre?: boolean;
  primero: boolean;
  onPress?: (it: ItemHistorial) => void;
}) {
  const { t } = useTheme();
  const esNomina = it.tipo === "nomina";
  const total = Number(it.total_amount) || 0;
  const pagado = fmtDia(diaLocalDe(it.paid_at, timeZone), "dia-mes");
  const rango = etiquetaTramo({ desde: it.period_start, hasta: it.period_end });
  const abre = esNomina && !!onPress;
  return (
    <TouchableOpacity
      onPress={abre ? () => onPress?.(it) : undefined}
      disabled={!abre}
      activeOpacity={0.7}
      accessibilityRole={abre ? "button" : undefined}
      accessibilityLabel={`${conNombre ? `${it.profesional}, ` : ""}${esNomina ? "nómina" : "comisión"} del ${rango}, ${fmtMoneyFull(total)}, pagado el ${pagado}${abre ? ". Ver colilla" : ""}`}
      style={[s.fila, !primero && { borderTopWidth: 1, borderTopColor: t.line }]}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <View style={s.filaTop}>
          {conNombre ? <Text style={[s.nombre, { color: t.text }]} numberOfLines={1}>{it.profesional}</Text> : null}
          <Etiqueta texto={esNomina ? "Nómina" : "Comisión"} color={esNomina ? Colors.red : t.muted} />
        </View>
        <Text style={[s.sub, { color: conNombre ? t.muted : t.text }]} numberOfLines={1}>{rango}</Text>
        <Text style={[s.sub, { color: t.subtle }]} numberOfLines={2}>
          Pagado el {pagado}{esNomina ? "" : ` · ${citas(Number(it.appointments_count) || 0)}`}{it.note ? ` · ${it.note}` : ""}
        </Text>
      </View>
      <Text style={[s.monto, { color: total < 0 ? Colors.red : t.text }]}>{total < 0 ? "− " : ""}{fmtMoneyFull(Math.abs(total))}</Text>
      {abre ? <Ionicons name="chevron-forward" size={15} color={t.subtle} /> : <View style={{ width: 15 }} />}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  fila:    { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
  filaTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  nombre:  { fontSize: 13.5, fontFamily: Fonts.bold, flexShrink: 1 },
  sub:     { fontSize: 11.5, fontFamily: Fonts.regular },
  monto:   { fontSize: 14, fontFamily: Fonts.bold },
});
