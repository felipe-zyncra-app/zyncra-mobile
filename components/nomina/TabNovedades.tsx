import { useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Fonts, Radius } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { useTenant } from "@/lib/tenant";
import { supabase } from "@/lib/supabase";
import { mensajeError, traerTodo, traerTodoDetalle } from "@/lib/db";
import { useGuardRespuestas, useRecarga } from "@/lib/useRecarga";
import { fmtMoneyFull } from "@/lib/format";
import { fmtDia } from "@/lib/tz";
import { ETIQUETA_NOVEDAD } from "@/lib/nomina";
import {
  ETIQUETA_ORIGEN, esTipoNovedad, motivoNoEditable, novedadEditable, totalesNovedades,
  type OrigenNovedad,
} from "@/lib/nomina-reglas";
import { Card, CardHead, SegmentedControl } from "@/components/ui";
import ErrorState from "@/components/ErrorState";
import { FilaMonto, SelectorPeriodo, usePeriodoNomina } from "./comun";
import NovedadSheet, { COLOR_NOVEDAD, ICONO_NOVEDAD, type FilaNovedad, type ProNovedad } from "./NovedadSheet";
import { Aviso, Chip } from "./ReglaComun";
import type { PropsTabNomina } from "./tipos";

/**
 * Nómina → Novedades: bonificaciones, propinas y descuentos o adelantos de
 * cada profesional (payroll_adjustments), igual que el panel web.
 *
 *   · "Por pagar": todas las pendientes (statement_id null), de cualquier
 *     fecha: una novedad anotada tarde no se pierde, sale en la próxima
 *     liquidación de esa persona.
 *   · "Por periodo": todo lo del periodo elegido, pagado o no.
 *
 * Aquí se anotan las manuales. Las propinas registradas en Caja o en el POS
 * con su profesional las crea la base sola (source caja / pos) y no se tocan
 * aquí; tampoco lo ya pagado. Se escribe directo con la RLS del dueño.
 */

type Modo = "pendientes" | "periodo";

const MODOS: { value: Modo; label: string }[] = [
  { value: "pendientes", label: "Por pagar" },
  { value: "periodo", label: "Por periodo" },
];

/** Con miles de pendientes (nadie liquida) no se cuelga el teléfono. */
const TOPE_FILAS = 3000;

type FilaCruda = Omit<FilaNovedad, "amount" | "kind" | "source"> & { amount: number | string; kind: string; source: string };

function normalizar(f: FilaCruda): FilaNovedad | null {
  if (!esTipoNovedad(f.kind)) return null;
  const source: OrigenNovedad = f.source === "caja" || f.source === "pos" ? f.source : "manual";
  return { ...f, kind: f.kind, source, amount: Number(f.amount) || 0 };
}

type Datos = { clave: string; pros: ProNovedad[]; filas: FilaNovedad[]; truncado: boolean };

export default function TabNovedades({ tenantId, timezone }: PropsTabNomina) {
  const { t } = useTheme();
  const { ready } = useTenant();
  const guard = useGuardRespuestas();
  const periodo = usePeriodoNomina(timezone);
  const [modo, setModo] = useState<Modo>("pendientes");
  const [filtroPro, setFiltroPro] = useState<string | null>(null);
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [refrescando, setRefrescando] = useState(false);
  const [hoja, setHoja] = useState<{ fila: FilaNovedad | null } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const avisoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { desde, hasta } = periodo.tramo;
  const clave = modo === "pendientes" ? "pendientes" : `${desde}_${hasta}`;

  const { hoy, recargar } = useRecarga(async () => {
    const turno = guard.nuevo();
    const claveCarga = clave;
    try {
      const [pros, novedades] = await Promise.all([
        traerTodo<ProNovedad>((d, h) =>
          supabase.from("professionals").select("id, name, is_active")
            .eq("tenant_id", tenantId).order("name").order("id").range(d, h),
        { contexto: "No se pudo cargar el equipo" }),
        traerTodoDetalle<FilaCruda>((d, h) => {
          let q = supabase.from("payroll_adjustments")
            .select("id, professional_id, kind, amount, entry_date, concept, source, statement_id")
            .eq("tenant_id", tenantId);
          q = modo === "pendientes" ? q.is("statement_id", null) : q.gte("entry_date", desde).lte("entry_date", hasta);
          return q.order("entry_date", { ascending: false }).order("created_at", { ascending: false }).order("id").range(d, h);
        }, { contexto: "No se pudieron cargar las novedades", tope: TOPE_FILAS }),
      ]);
      if (!turno.vigente()) return;
      setDatos({
        clave: claveCarga,
        pros,
        filas: novedades.filas.map(normalizar).filter((x): x is FilaNovedad => x !== null),
        truncado: novedades.truncado,
      });
      setError(null);
    } catch (e) {
      if (turno.vigente()) setError(e);
    }
  }, [tenantId, clave], { timeZone: timezone, habilitado: !!tenantId && ready, alCambiarSede: false });

  useEffect(() => () => { if (avisoTimer.current) clearTimeout(avisoTimer.current); }, []);

  const mostrarAviso = (texto: string) => {
    setAviso(texto);
    if (avisoTimer.current) clearTimeout(avisoTimer.current);
    avisoTimer.current = setTimeout(() => setAviso(null), 6000);
  };

  // Solo se muestra lo cargado para lo que se está viendo: al cambiar de
  // periodo no quedan las filas del anterior bajo la etiqueta nueva.
  const vista = datos && datos.clave === clave ? datos : null;
  const pros = useMemo(() => datos?.pros ?? [], [datos]);
  const nombre = (id: string) => pros.find(p => p.id === id)?.name ?? "Profesional borrado";
  const inactivo = (id: string) => pros.find(p => p.id === id)?.is_active === false;

  // Filtro: activos, y los inactivos solo si tienen novedades en la lista.
  const opcionesPro = useMemo(() => {
    const conFilas = new Set((vista?.filas ?? []).map(f => f.professional_id));
    return pros.filter(p => p.is_active !== false || conFilas.has(p.id));
  }, [pros, vista]);

  // Si la persona filtrada ya no sale entre las opciones (p. ej. un inactivo
  // sin novedades en lo nuevo que se ve), se vuelve a "Todo el equipo".
  const filtro = filtroPro && opcionesPro.some(p => p.id === filtroPro) ? filtroPro : null;
  const filas = useMemo(
    () => (vista?.filas ?? []).filter(f => !filtro || f.professional_id === filtro),
    [vista, filtro],
  );
  const totales = useMemo(() => totalesNovedades(filas), [filas]);

  const onRefresh = async () => {
    setRefrescando(true);
    await recargar();
    setRefrescando(false);
  };

  const abrir = (f: FilaNovedad) => {
    if (novedadEditable(f)) { setHoja({ fila: f }); return; }
    Alert.alert("Esta novedad no se cambia aquí", motivoNoEditable(f) ?? "");
  };

  const anioHoy = hoy.slice(0, 4);
  const fechaCorta = (d: string) => fmtDia(d, d.slice(0, 4) === anioHoy ? "dia-mes" : "corto");

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.contenido}
        refreshControl={<RefreshControl refreshing={refrescando} onRefresh={onRefresh} tintColor={Colors.red} />}
      >
        <View style={s.barra}>
          <SegmentedControl options={MODOS} value={modo} onChange={setModo} />
          <TouchableOpacity
            style={s.btnNueva}
            onPress={() => setHoja({ fila: null })}
            disabled={!vista}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Anotar novedad"
            accessibilityState={{ disabled: !vista }}
          >
            <Ionicons name="add" size={18} color="white" />
            <Text style={s.btnNuevaTxt}>Anotar</Text>
          </TouchableOpacity>
        </View>

        {modo === "periodo" ? <SelectorPeriodo periodo={periodo} /> : null}

        {opcionesPro.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
            <Chip etiqueta="Todo el equipo" activo={!filtro} onPress={() => setFiltroPro(null)} />
            {opcionesPro.map(p => (
              <Chip
                key={p.id}
                etiqueta={p.is_active === false ? `${p.name} (inactivo)` : p.name}
                activo={filtro === p.id}
                onPress={() => setFiltroPro(x => (x === p.id ? null : p.id))}
              />
            ))}
          </ScrollView>
        ) : null}

        {aviso ? <Aviso texto={aviso} icono="checkmark-circle-outline" tono="ok" /> : null}

        {error && !vista ? (
          <ErrorState error={error} onRetry={recargar} />
        ) : !vista ? (
          <ActivityIndicator color={Colors.red} style={{ marginTop: 32 }} />
        ) : (
          <>
            {error ? (
              <TouchableOpacity onPress={recargar} style={[s.viejo, { backgroundColor: t.cardSolid }]} accessibilityRole="button">
                <Ionicons name="alert-circle-outline" size={16} color={Colors.red} />
                <Text style={[s.viejoTxt, { color: t.ink }]} numberOfLines={2}>No se pudo actualizar: {mensajeError(error)}</Text>
                <Text style={s.viejoBtn}>Reintentar</Text>
              </TouchableOpacity>
            ) : null}

            {filas.length > 0 ? (
              <Card>
                <CardHead
                  title={modo === "pendientes" ? "Por pagar" : "En el periodo"}
                  sub={modo === "pendientes" ? "Pendientes de liquidar, de cualquier fecha" : "Pagadas y pendientes"}
                />
                <View style={s.totales}>
                  <FilaMonto label="Propinas" valor={totales.propinas} />
                  <FilaMonto label="Bonificaciones" valor={totales.bonos} />
                  <FilaMonto label="Descuentos y adelantos" valor={totales.descuentos} signo={-1} />
                  <View style={[s.separador, { backgroundColor: t.line }]} />
                  <FilaMonto
                    label="Neto de novedades"
                    valor={Math.abs(totales.neto)}
                    signo={totales.neto < 0 ? -1 : 1}
                    fuerte
                  />
                </View>
              </Card>
            ) : null}

            <Card>
              <CardHead title="Novedades" aside={filas.length ? String(filas.length) : undefined} />
              {filas.length === 0 ? (
                <View style={s.vacio}>
                  <Ionicons name="gift-outline" size={32} color={t.subtle} />
                  <Text style={[s.vacioTxt, { color: t.muted }]}>
                    {modo === "pendientes" ? "No hay novedades por pagar." : "No hay novedades en este periodo."}
                  </Text>
                  <Text style={[s.vacioSub, { color: t.subtle }]}>
                    Toca «Anotar» para una bonificación, una propina o un descuento.
                  </Text>
                </View>
              ) : (
                filas.map((f, i) => {
                  const editable = novedadEditable(f);
                  const resta = f.kind === "deduction";
                  const pagada = !!f.statement_id;
                  const etiqueta = ETIQUETA_NOVEDAD[f.kind];
                  const signo = resta ? "−" : "+";
                  return (
                    <TouchableOpacity
                      key={f.id}
                      onPress={() => abrir(f)}
                      activeOpacity={0.6}
                      style={[s.fila, i < filas.length - 1 && { borderBottomWidth: 1, borderBottomColor: t.divider }]}
                      accessibilityRole="button"
                      accessibilityLabel={`${nombre(f.professional_id)}, ${etiqueta}, ${signo}${fmtMoneyFull(f.amount)}, ${fmtDia(f.entry_date, "largo")}, ${ETIQUETA_ORIGEN[f.source]}, ${pagada ? "pagada" : "pendiente"}`}
                      accessibilityHint={editable ? "Abre la novedad para cambiarla o borrarla" : "Explica por qué no se puede cambiar"}
                    >
                      <View style={[s.icono, { backgroundColor: COLOR_NOVEDAD[f.kind] + "14" }]}>
                        <Ionicons name={ICONO_NOVEDAD[f.kind]} size={17} color={COLOR_NOVEDAD[f.kind]} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[s.filaTitulo, { color: t.ink }]} numberOfLines={1}>
                          {nombre(f.professional_id)} · {etiqueta}
                        </Text>
                        {f.concept ? <Text style={[s.filaConcepto, { color: t.muted }]} numberOfLines={2}>{f.concept}</Text> : null}
                        <Text style={[s.filaMeta, { color: t.subtle }]} numberOfLines={1}>
                          {fechaCorta(f.entry_date)} · {ETIQUETA_ORIGEN[f.source]}{inactivo(f.professional_id) ? " · inactivo" : ""}
                        </Text>
                      </View>
                      <View style={s.filaDerecha}>
                        <Text style={[s.monto, { color: resta ? Colors.red : t.text }]}>{signo}{fmtMoneyFull(f.amount)}</Text>
                        <View style={[s.estado, { backgroundColor: pagada ? Colors.success + "18" : "rgba(245,158,11,0.14)" }]}>
                          <Text style={[s.estadoTxt, { color: pagada ? Colors.success : "#b45309" }]}>{pagada ? "Pagada" : "Pendiente"}</Text>
                        </View>
                      </View>
                      <Ionicons name={editable ? "chevron-forward" : "lock-closed-outline"} size={14} color={t.subtle} />
                    </TouchableOpacity>
                  );
                })
              )}
            </Card>

            {vista.truncado ? (
              <Text style={[s.nota, { color: t.subtle }]}>
                Se muestran las {TOPE_FILAS.toLocaleString("es-CO")} más recientes: los totales son solo de esas.
              </Text>
            ) : null}
          </>
        )}

        <Text style={[s.nota, { color: t.subtle }]}>
          Las propinas registradas en Caja o en el POS con su profesional se anotan solas. Una novedad queda pendiente hasta que una liquidación la paga; ya pagada no se cambia.
        </Text>
      </ScrollView>

      {hoja && vista ? (
        <NovedadSheet
          key={hoja.fila?.id ?? "nueva"}
          fila={hoja.fila}
          tenantId={tenantId}
          hoy={hoy}
          pros={pros}
          profesionalInicial={filtro}
          onCerrar={() => setHoja(null)}
          onListo={msg => { setHoja(null); mostrarAviso(msg); void recargar(); }}
          onDesactualizada={() => { void recargar(); }}
        />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  contenido:   { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 48, gap: 14 },
  barra:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  btnNueva:    { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, borderRadius: Radius.full, backgroundColor: Colors.red },
  btnNuevaTxt: { fontSize: 14, fontFamily: Fonts.bold, color: "white" },
  chips:       { gap: 8, paddingVertical: 4 },

  viejo:       { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: "rgba(251,15,5,0.32)", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11 },
  viejoTxt:    { flex: 1, fontSize: 12, fontFamily: Fonts.regular },
  viejoBtn:    { fontSize: 12, fontFamily: Fonts.bold, color: Colors.red },

  totales:     { paddingHorizontal: 16, paddingVertical: 8 },
  separador:   { height: 1, marginVertical: 4 },

  vacio:       { alignItems: "center", gap: 8, paddingVertical: 32, paddingHorizontal: 24 },
  vacioTxt:    { fontSize: 14, fontFamily: Fonts.semibold, textAlign: "center" },
  vacioSub:    { fontSize: 12, fontFamily: Fonts.regular, textAlign: "center" },

  fila:        { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 12, minHeight: 60 },
  icono:       { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  filaTitulo:  { fontSize: 13.5, fontFamily: Fonts.semibold },
  filaConcepto: { fontSize: 12, fontFamily: Fonts.regular, marginTop: 1 },
  filaMeta:    { fontSize: 11.5, fontFamily: Fonts.regular, marginTop: 2 },
  filaDerecha: { alignItems: "flex-end", gap: 4 },
  monto:       { fontSize: 14, fontFamily: Fonts.bold },
  estado:      { paddingHorizontal: 8, paddingVertical: 2, borderRadius: Radius.full },
  estadoTxt:   { fontSize: 10.5, fontFamily: Fonts.bold },

  nota:        { fontSize: 11.5, fontFamily: Fonts.regular, lineHeight: 16, textAlign: "center" },
});
