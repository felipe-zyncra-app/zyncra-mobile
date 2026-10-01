import { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Fonts, Radius, Shadow } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { fmtMoneyFull } from "@/lib/format";
import { useGuardRespuestas, useRecarga } from "@/lib/useRecarga";
import { MonoTag } from "@/components/ui";
import { leerResumen, type ItemHistorial, type ResumenNomina } from "@/lib/nomina";
import { SelectorPeriodo, usePeriodoNomina } from "./comun";
import ColillaModal from "./ColillaModal";
import { LineasNomina } from "./DetalleLineas";
import { FilaHistorial, useHistorialNomina } from "./HistorialComun";
import { Aviso, BotonNomina, DesglosePendiente, Productividad } from "./ResumenPiezas";
import { estadoAcceso, mensajeNomina } from "./ResumenTextos";

/**
 * "Mi nómina" del equipo (Mi Perfil): lo que el profesional lleva en el
 * periodo (quincena por defecto), cita por cita, y sus pagos con la colilla.
 * Todo por /api/nomina/*: el servidor solo le muestra lo suyo y, si el dueño
 * le ocultó los montos (permissions.amounts = false), responde 403
 * sin_montos y aquí se explica en vez de mostrar cifras. No lee la base
 * directo: con los montos ocultos la RLS tampoco lo deja.
 *
 * Va dentro del ScrollView del perfil, así que no tiene scroll propio.
 */
export default function MiNomina({ tenantId, timezone, version = 0 }: {
  tenantId: string;
  timezone: string;
  /** El perfil lo sube al deslizar para refrescar. */
  version?: number;
}) {
  const { t } = useTheme();
  const periodo = usePeriodoNomina(timezone);
  const { desde, hasta } = periodo.tramo;
  const guard = useGuardRespuestas();
  const [data, setData] = useState<ResumenNomina | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [verCitas, setVerCitas] = useState(false);
  const [colilla, setColilla] = useState<ItemHistorial | null>(null);

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
  }, [tenantId, desde, hasta, version], { timeZone: timezone, alCambiarSede: false });

  const hist = useHistorialNomina({ tenantId, timeZone: timezone, version });

  // Montos ocultos, sin ficha o sin sesión: se explica y no se muestra ninguna cifra.
  const bloqueo = estadoAcceso(error) ?? estadoAcceso(hist.error);
  const vista = data && data.desde === desde && data.hasta === hasta ? data : null;
  // El servidor solo manda al propio profesional.
  const yo = vista?.profesionales[0] ?? null;

  if (bloqueo) {
    return (
      <View style={{ gap: 12 }}>
        <Aviso tono="info" titulo={bloqueo.titulo} texto={bloqueo.texto} />
      </View>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      <SelectorPeriodo periodo={periodo} />

      {error && !vista ? (
        <Aviso
          tono="error"
          titulo="No se pudo cargar tu nómina"
          texto={mensajeNomina(error)}
          accion={{ label: "Reintentar", onPress: () => { void recargar(); } }}
        />
      ) : !vista ? (
        <ActivityIndicator color={Colors.red} style={{ paddingVertical: 24 }} />
      ) : !yo ? (
        <View style={[s.card, Shadow.sm, { backgroundColor: t.cardSolid, borderColor: t.line }]}>
          <Text style={[s.vacio, { color: t.muted }]}>No tienes citas, ventas, básico ni novedades en este periodo.</Text>
        </View>
      ) : (
        <>
          {error ? (
            <Aviso tono="error" texto={`No se pudo actualizar: ${mensajeNomina(error)}`} accion={{ label: "Reintentar", onPress: () => { void recargar(); } }} />
          ) : null}

          <View style={[s.card, Shadow.sm, { backgroundColor: t.cardSolid, borderColor: t.line }]}>
            <View style={s.cabeza}>
              <View style={{ flex: 1 }}>
                <MonoTag>{yo.pendiente.total < 0 ? "Saldo a favor del negocio" : "Por cobrar"}</MonoTag>
                <Text style={[s.monto, { color: yo.pendiente.total < 0 ? Colors.red : t.text }]}>
                  {fmtMoneyFull(Math.abs(yo.pendiente.total))}
                </Text>
                <Text style={[s.montoSub, { color: t.subtle }]}>
                  {hasta > vista.hoy ? "Lo pendiente hasta hoy" : "Lo pendiente del periodo"}
                </Text>
              </View>
              <View style={[s.icono, { backgroundColor: Colors.success + "14" }]}>
                <Ionicons name="wallet-outline" size={22} color={Colors.success} />
              </View>
            </View>

            <DesglosePendiente pend={yo.pendiente} />

            {yo.comisionLiquidada > 0 ? (
              <Text style={[s.nota, { color: Colors.success }]}>
                Ya te liquidaron {fmtMoneyFull(yo.comisionLiquidada)} de comisión de este periodo.
              </Text>
            ) : null}
          </View>

          {yo.citasSinCerrar > 0 ? (
            <Aviso
              tono="aviso"
              texto={`${yo.citasSinCerrar === 1 ? "Tienes 1 cita pasada" : `Tienes ${yo.citasSinCerrar} citas pasadas`} sin cerrar en este periodo: no cuentan para tu nómina hasta que se marquen como atendidas o se cobren.`}
            />
          ) : null}

          <View>
            <MonoTag style={{ marginBottom: 8 }}>Lo que atendiste en el periodo</MonoTag>
            <Productividad p={yo} />
          </View>

          {yo.lineas.length > 0 ? (
            <View style={[s.card, Shadow.sm, { backgroundColor: t.cardSolid, borderColor: t.line }]}>
              <TouchableOpacity
                onPress={() => setVerCitas(v => !v)}
                style={s.toggle}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityState={{ expanded: verCitas }}
              >
                <Text style={[s.toggleTxt, { color: t.text }]}>Detalle cita por cita</Text>
                <Ionicons name={verCitas ? "chevron-up" : "chevron-down"} size={16} color={t.muted} />
              </TouchableOpacity>
              {verCitas ? <View style={{ marginTop: 12 }}><LineasNomina lineas={yo.lineas} /></View> : null}
            </View>
          ) : null}
        </>
      )}

      {/* Mis pagos */}
      <MonoTag style={{ marginTop: 8 }}>Mis pagos</MonoTag>
      <View style={[s.lista, Shadow.sm, { backgroundColor: t.cardSolid, borderColor: t.line }]}>
        {hist.error && hist.items.length === 0 ? (
          <View style={{ padding: 12 }}>
            <Aviso
              tono="error"
              titulo="No se pudieron cargar tus pagos"
              texto={mensajeNomina(hist.error)}
              accion={{ label: "Reintentar", onPress: () => { void hist.recargar(); } }}
            />
          </View>
        ) : !hist.cargado ? (
          <ActivityIndicator color={Colors.red} style={{ paddingVertical: 20 }} />
        ) : hist.items.length === 0 ? (
          <Text style={[s.vacio, { color: t.muted }]}>Todavía no tienes pagos registrados.</Text>
        ) : (
          <>
            {hist.items.map((it, i) => (
              <FilaHistorial
                key={`${it.tipo}-${it.id}`}
                it={it}
                timeZone={timezone}
                conNombre={false}
                primero={i === 0}
                onPress={setColilla}
              />
            ))}
            {hist.hayMas ? (
              <View style={[s.mas, { borderTopColor: t.line }]}>
                <BotonNomina chico tono="fantasma" label="Ver más" onPress={() => { void hist.verMas(); }} cargando={hist.cargandoMas} />
              </View>
            ) : null}
            {hist.errorMas ? (
              <Text style={[s.errorMas, { color: Colors.red }]}>{mensajeNomina(hist.errorMas)}</Text>
            ) : null}
          </>
        )}
      </View>

      {colilla ? (
        <ColillaModal
          tenantId={tenantId}
          timeZone={timezone}
          item={colilla}
          puedeAnular={false}
          onClose={() => setColilla(null)}
        />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  card:      { borderWidth: 1, borderRadius: Radius.lg, padding: 16 },
  lista:     { borderWidth: 1, borderRadius: Radius.lg, overflow: "hidden" },
  cabeza:    { flexDirection: "row", alignItems: "flex-start", gap: 14, marginBottom: 8 },
  monto:     { fontSize: 30, fontFamily: Fonts.bold, letterSpacing: -1, marginTop: 4 },
  montoSub:  { fontSize: 11.5, fontFamily: Fonts.regular, marginTop: 2 },
  icono:     { width: 48, height: 48, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  nota:      { fontSize: 12, fontFamily: Fonts.semibold, marginTop: 8 },
  vacio:     { fontSize: 13, fontFamily: Fonts.regular, textAlign: "center", paddingVertical: 20, paddingHorizontal: 16, lineHeight: 18 },
  toggle:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 28 },
  toggleTxt: { fontSize: 13.5, fontFamily: Fonts.semibold },
  mas:       { alignItems: "center", paddingVertical: 12, borderTopWidth: 1 },
  errorMas:  { fontSize: 12, fontFamily: Fonts.regular, textAlign: "center", paddingBottom: 12, paddingHorizontal: 16 },
});
