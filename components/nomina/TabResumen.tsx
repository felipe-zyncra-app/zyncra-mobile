import { useState } from "react";
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Fonts, Radius } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { fmtMoneyFull } from "@/lib/format";
import { useGuardRespuestas, useRecarga } from "@/lib/useRecarga";
import { Card, CardHead, MonoTag } from "@/components/ui";
import ErrorState from "@/components/ErrorState";
import { hayPendiente, leerResumen, type ResumenNomina, type ResumenProfesional } from "@/lib/nomina";
import { etiquetaTramo, SelectorPeriodo, usePeriodoNomina } from "./comun";
import DetalleProfesional from "./DetalleProfesional";
import LiquidarSheet from "./LiquidarSheet";
import { Aviso, AvatarNomina, BotonNomina, DesglosePendiente, type TonoAviso } from "./ResumenPiezas";
import { citas, mensajeNomina, textoSinCerrar } from "./ResumenTextos";
import type { PropsTabNomina } from "./tipos";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

/**
 * Resumen de la nómina (dueño), igual que el web: por periodo (quincena por
 * defecto, mes o semana), lo pendiente de cada profesional con su desglose,
 * el detalle cita por cita y el pago ("Liquidar"). Todo lo calcula
 * /api/nomina/resumen; aquí solo se muestra.
 */
export default function TabResumen({ tenantId, timezone }: PropsTabNomina) {
  const { t } = useTheme();
  const periodo = usePeriodoNomina(timezone);
  const { desde, hasta } = periodo.tramo;
  const guard = useGuardRespuestas();
  const [data, setData] = useState<ResumenNomina | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [aviso, setAviso] = useState<{ tono: TonoAviso; texto: string } | null>(null);
  const [detalle, setDetalle] = useState<ResumenProfesional | null>(null);
  const [pagar, setPagar] = useState<ResumenProfesional | null>(null);

  const { recargar } = useRecarga(async () => {
    const turno = guard.nuevo();
    try {
      const r = await leerResumen({ tenantId, desde, hasta });
      if (!turno.vigente()) return;
      setData(r);
      setError(null);
    } catch (e) {
      if (turno.vigente()) setError(e);
    }
    // La nómina es de todas las sedes: cambiar de sede no la cambia.
  }, [tenantId, desde, hasta], { timeZone: timezone, alCambiarSede: false });

  const onRefresh = async () => { setRefreshing(true); await recargar(); setRefreshing(false); };

  // Mientras llega el periodo nuevo no se muestran los números del anterior.
  const vista = data && data.desde === desde && data.hasta === hasta ? data : null;
  const pros = vista?.profesionales ?? [];
  // Totales de las tarjetas: la suma de lo que mandó el servidor por persona.
  const tot = pros.reduce((a, p) => ({
    pendiente: a.pendiente + p.pendiente.total,
    comisiones: a.comisiones + p.pendiente.comisiones.comisionServicios + p.pendiente.comisiones.comisionProductos,
    basicos: a.basicos + (p.pendiente.basico?.monto ?? 0),
    extras: a.extras + p.pendiente.propinas + p.pendiente.bonos,
    citas: a.citas + p.periodo.citas,
    sinCerrar: a.sinCerrar + p.citasSinCerrar,
  }), { pendiente: 0, comisiones: 0, basicos: 0, extras: 0, citas: 0, sinCerrar: 0 });
  const sinAsignar = (vista?.sinAsignar.ventasServicios ?? 0) + (vista?.sinAsignar.ventasProductos ?? 0);

  const subtitulo = vista
    ? `${etiquetaTramo({ desde, hasta })} · ${tot.citas} ${tot.citas === 1 ? "cita atendida" : "citas atendidas"}${hasta > vista.hoy ? " · lo pendiente va hasta hoy" : ""}`
    : etiquetaTramo({ desde, hasta });

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={s.contenido}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.red} />}
      >
        <SelectorPeriodo periodo={periodo} />

        {aviso ? <Aviso tono={aviso.tono} texto={aviso.texto} onCerrar={() => setAviso(null)} /> : null}

        {error && !vista ? (
          <View style={{ minHeight: 260 }}>
            <ErrorState error={error} message={mensajeNomina(error)} onRetry={recargar} />
          </View>
        ) : !vista ? (
          <ActivityIndicator color={Colors.red} style={{ marginTop: 32 }} />
        ) : (
          <>
            {error ? (
              <TouchableOpacity onPress={recargar} style={[s.vieja, { backgroundColor: t.cardSolid }]} accessibilityRole="button">
                <Ionicons name="alert-circle-outline" size={16} color={Colors.red} />
                <Text style={[s.viejaTxt, { color: t.ink }]} numberOfLines={2}>No se pudo actualizar: {mensajeNomina(error)}</Text>
                <Text style={s.viejaReintentar}>Reintentar</Text>
              </TouchableOpacity>
            ) : null}
            {tot.sinCerrar > 0 ? <Aviso tono="aviso" texto={textoSinCerrar(tot.sinCerrar)} /> : null}
            {sinAsignar > 0 ? (
              <Aviso
                tono="aviso"
                texto={`${fmtMoneyFull(sinAsignar)} en ventas sin cita no dicen quién vendió, así que no le suman comisión a nadie. En el POS elige quién vendió cada producto.`}
              />
            ) : null}

            <View style={s.kpis}>
              <Kpi label="Por pagar" valor={tot.pendiente} icono="cash-outline" color={Colors.red} />
              <Kpi label="Comisiones" valor={tot.comisiones} icono="stats-chart-outline" color={Colors.blue} />
              <Kpi label="Básicos" valor={tot.basicos} icono="people-outline" color="#8b5cf6" />
              <Kpi label="Propinas y bonos" valor={tot.extras} icono="gift-outline" color={Colors.success} />
            </View>

            <Card>
              <CardHead title="Por profesional" sub={subtitulo} />
              {pros.length === 0 ? (
                <Text style={[s.vacio, { color: t.muted }]}>Nadie tiene citas, ventas, básico ni novedades en este periodo.</Text>
              ) : (
                pros.map((p, i) => (
                  <FilaProfesional
                    key={p.professional_id}
                    p={p}
                    primero={i === 0}
                    onDetalle={() => setDetalle(p)}
                    onLiquidar={() => { setAviso(null); setPagar(p); }}
                  />
                ))
              )}
            </Card>

            <Text style={[s.pie, { color: t.subtle }]}>
              Cuenta las citas atendidas (completadas o cobradas) de todas las sedes, con lo que se cobró en el POS o, si no se cobró ahí, el precio del servicio. Las reglas de cada persona están en Reglas; bonificaciones, propinas y adelantos, en Novedades.
            </Text>
          </>
        )}
      </ScrollView>

      {detalle && vista ? (
        <DetalleProfesional tenantId={tenantId} p={detalle} desde={vista.desde} hasta={vista.hasta} onClose={() => setDetalle(null)} />
      ) : null}
      {pagar && vista ? (
        <LiquidarSheet
          key={`${pagar.professional_id}-${pagar.firma}`}
          tenantId={tenantId}
          p={pagar}
          desde={vista.desde}
          hasta={vista.hasta}
          hoy={vista.hoy}
          onClose={() => setPagar(null)}
          onCambio={texto => { setPagar(null); setAviso({ tono: "error", texto }); void recargar(); }}
          onListo={texto => { setPagar(null); setAviso({ tono: "ok", texto }); void recargar(); }}
        />
      ) : null}
    </View>
  );
}

function Kpi({ label, valor, icono, color }: { label: string; valor: number; icono: IoniconName; color: string }) {
  const { t } = useTheme();
  const texto = fmtMoneyFull(valor);
  return (
    <View style={[s.kpi, { backgroundColor: t.cardSolid, borderColor: t.line }]} accessible accessibilityLabel={`${label}: ${texto}`}>
      <View style={[s.kpiIcono, { backgroundColor: color + "16" }]}>
        <Ionicons name={icono} size={16} color={color} />
      </View>
      <Text style={[s.kpiValor, { color: valor < 0 ? Colors.red : t.text }]} numberOfLines={1} adjustsFontSizeToFit>{texto}</Text>
      <MonoTag>{label}</MonoTag>
    </View>
  );
}

function FilaProfesional({ p, primero, onDetalle, onLiquidar }: {
  p: ResumenProfesional;
  primero: boolean;
  onDetalle: () => void;
  onLiquidar: () => void;
}) {
  const { t } = useTheme();
  const pend = p.pendiente;
  const debe = hayPendiente(pend);
  const vendido = p.periodo.ventasServicios + p.periodo.ventasProductos;
  const total = pend.total;
  return (
    <View style={[s.pro, !primero && { borderTopWidth: 1, borderTopColor: t.line }]}>
      <TouchableOpacity
        onPress={onDetalle}
        style={s.proCabeza}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`Ver detalle de ${p.nombre}. Por pagar ${fmtMoneyFull(total)}`}
      >
        <AvatarNomina nombre={p.nombre} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[s.proNombre, { color: t.text }]} numberOfLines={1}>
            {p.nombre}{p.activo ? "" : " · Inactivo"}
          </Text>
          <Text style={[s.proSub, { color: t.muted }]} numberOfLines={2}>
            {citas(p.periodo.citas)} · vendió {fmtMoneyFull(vendido)}
          </Text>
          {p.comisionLiquidada > 0 ? (
            <Text style={[s.proSub, { color: Colors.success }]}>Ya liquidado: {fmtMoneyFull(p.comisionLiquidada)} de comisión</Text>
          ) : null}
          {p.citasSinCerrar > 0 ? (
            <Text style={[s.proSub, s.sinCerrar]}>{p.citasSinCerrar} sin cerrar</Text>
          ) : null}
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={[s.proTotal, { color: total < 0 ? Colors.red : debe ? t.text : t.subtle }]}>
            {total < 0 ? "− " : ""}{fmtMoneyFull(Math.abs(total))}
          </Text>
          <MonoTag>{total < 0 ? "A favor" : "Por pagar"}</MonoTag>
        </View>
      </TouchableOpacity>

      {debe ? (
        <View style={[s.desglose, { backgroundColor: t.chipBg }]}>
          <DesglosePendiente pend={pend} compacto />
        </View>
      ) : (
        <Text style={[s.alDia, { color: p.comisionLiquidada > 0 ? Colors.success : t.subtle }]}>
          {p.comisionLiquidada > 0 ? "Al día: no tiene nada pendiente en este periodo." : "Nada pendiente en este periodo."}
        </Text>
      )}

      <View style={s.proAcciones}>
        <BotonNomina chico tono="fantasma" label="Detalle" icono="list-outline" onPress={onDetalle} accessibilityLabel={`Detalle de ${p.nombre}`} />
        <BotonNomina
          chico
          tono="suave"
          label="Liquidar"
          icono="wallet-outline"
          onPress={onLiquidar}
          disabled={!debe}
          accessibilityLabel={`Liquidar a ${p.nombre}`}
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  contenido:   { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 110, gap: 14 },
  vieja:       { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: "rgba(251,15,5,0.32)", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11 },
  viejaTxt:    { flex: 1, fontSize: 12, fontFamily: Fonts.regular },
  viejaReintentar: { fontSize: 12, fontFamily: Fonts.bold, color: Colors.red },

  kpis:        { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  kpi:         { flexBasis: "47%", flexGrow: 1, borderWidth: 1, borderRadius: Radius.md, padding: 13, gap: 6 },
  kpiIcono:    { width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  kpiValor:    { fontSize: 17, fontFamily: Fonts.bold, letterSpacing: -0.4 },

  vacio:       { fontSize: 13.5, fontFamily: Fonts.regular, textAlign: "center", paddingVertical: 28, paddingHorizontal: 20, lineHeight: 19 },

  pro:         { paddingHorizontal: 16, paddingVertical: 14, gap: 10 },
  proCabeza:   { flexDirection: "row", alignItems: "center", gap: 11 },
  proNombre:   { fontSize: 14, fontFamily: Fonts.bold },
  proSub:      { fontSize: 11.5, fontFamily: Fonts.regular, marginTop: 2 },
  sinCerrar:   { color: "#b45309", fontFamily: Fonts.semibold },
  proTotal:    { fontSize: 16, fontFamily: Fonts.bold },
  desglose:    { borderRadius: Radius.md, paddingHorizontal: 12, paddingVertical: 4 },
  alDia:       { fontSize: 12, fontFamily: Fonts.semibold },
  proAcciones: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },

  pie:         { fontSize: 11.5, fontFamily: Fonts.regular, lineHeight: 17 },
});
