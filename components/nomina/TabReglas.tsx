import { useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, Alert, TextInput,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Fonts, Radius } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { supabase } from "@/lib/supabase";
import { mensajeError, traerTodo } from "@/lib/db";
import { useGuardRespuestas, useRecarga } from "@/lib/useRecarga";
import { fmtMoneyFull } from "@/lib/format";
import { fmtDia } from "@/lib/tz";
import { ETIQUETA_PERIODICIDAD, type Periodicidad, type ReglaTipo } from "@/lib/nomina";
import {
  buscarServicios, fmtPorcentaje, pctProductosPorDefecto, resumenReglasServicio, textoRegla,
  type PerfilPago, type ReglaGeneral, type ReglaServicio,
} from "@/lib/nomina-reglas";
import { Card, CardHead, MonoTag, SegmentedControl } from "@/components/ui";
import Avatar from "@/components/Avatar";
import ErrorState from "@/components/ErrorState";
import ReglaProSheet, { type ProRegla } from "./ReglaProSheet";
import ReglaServicioSheet, { type ServicioRegla } from "./ReglaServicioSheet";
import { Aviso } from "./ReglaComun";
import type { PropsTabNomina } from "./tipos";

/**
 * Nómina → Reglas, igual que el panel web:
 *   · Pago del equipo: por profesional, el básico (monto, periodicidad,
 *     desde cuándo), la comisión general de servicios (commission_rules) y el
 *     % de productos (payroll_profiles).
 *   · Por servicio: comisión para todos y, si hace falta, distinta para
 *     alguien (commission_service_rules).
 * Qué se paga lo calcula el servidor: la regla del servicio para la persona,
 * luego la del servicio, luego la general (un fijo general, una vez por cita).
 * Se escribe directo con la RLS del dueño. Las reglas nuevas, solo para
 * activos; los inactivos con reglas se ven pero no se editan.
 */

type Vista = "equipo" | "servicios";

const VISTAS: { value: Vista; label: string }[] = [
  { value: "equipo", label: "Pago del equipo" },
  { value: "servicios", label: "Por servicio" },
];

/** Sin buscar, no se pintan más de estos servicios de una vez. */
const MAX_SERVICIOS = 100;

type FilaRegla = { professional_id: string; type: string; value: number | string };
type FilaPerfil = {
  professional_id: string; base_salary: number | string; base_period: string;
  base_since: string | null; product_commission_pct: number | string | null;
};
type FilaServicio = { id: string; name: string; price: number | string; category: string | null; code: string | null };
type FilaReglaSvc = { id: string; service_id: string; professional_id: string | null; type: string; value: number | string };

type Datos = {
  pros: ProRegla[];
  generales: Record<string, ReglaGeneral>;
  perfiles: Record<string, PerfilPago>;
  servicios: (ServicioRegla & { code: string | null })[];
  /** Por servicio. */
  reglasSvc: Record<string, ReglaServicio[]>;
  /** Cuántos servicios tienen comisión propia para cada profesional. */
  propias: Record<string, number>;
};

const tipoRegla = (x: string): ReglaTipo => (x === "fixed" ? "fixed" : "percentage");
const periodicidad = (x: string): Periodicidad => (x === "quincenal" || x === "semanal" ? x : "mensual");

export default function TabReglas({ tenantId, timezone }: PropsTabNomina) {
  const { t } = useTheme();
  const guard = useGuardRespuestas();
  const [vista, setVista] = useState<Vista>("equipo");
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [refrescando, setRefrescando] = useState(false);
  const [buscar, setBuscar] = useState("");
  const [editPro, setEditPro] = useState<ProRegla | null>(null);
  const [editSvc, setEditSvc] = useState<ServicioRegla | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const avisoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { hoy, recargar } = useRecarga(async () => {
    const turno = guard.nuevo();
    try {
      const [pros, generales, perfiles, servicios, reglasSvc] = await Promise.all([
        traerTodo<ProRegla>((d, h) =>
          supabase.from("professionals").select("id, name, role, is_active")
            .eq("tenant_id", tenantId).order("name").order("id").range(d, h),
        { contexto: "No se pudo cargar el equipo" }),
        traerTodo<FilaRegla>((d, h) =>
          supabase.from("commission_rules").select("professional_id, type, value")
            .eq("tenant_id", tenantId).order("professional_id").range(d, h),
        { contexto: "No se pudieron cargar las comisiones generales" }),
        traerTodo<FilaPerfil>((d, h) =>
          supabase.from("payroll_profiles")
            .select("professional_id, base_salary, base_period, base_since, product_commission_pct")
            .eq("tenant_id", tenantId).order("professional_id").range(d, h),
        { contexto: "No se pudieron cargar los básicos" }),
        traerTodo<FilaServicio>((d, h) =>
          supabase.from("services").select("id, name, price, category, code")
            .eq("tenant_id", tenantId).eq("is_active", true)
            .order("position").order("name").order("id").range(d, h),
        { contexto: "No se pudieron cargar los servicios" }),
        traerTodo<FilaReglaSvc>((d, h) =>
          supabase.from("commission_service_rules").select("id, service_id, professional_id, type, value")
            .eq("tenant_id", tenantId).order("id").range(d, h),
        { contexto: "No se pudieron cargar las comisiones por servicio" }),
      ]);
      if (!turno.vigente()) return;

      const porServicio: Record<string, ReglaServicio[]> = {};
      const propias: Record<string, number> = {};
      for (const r of reglasSvc) {
        (porServicio[r.service_id] ??= []).push({
          professional_id: r.professional_id, type: tipoRegla(r.type), value: Number(r.value) || 0,
        });
        if (r.professional_id) propias[r.professional_id] = (propias[r.professional_id] ?? 0) + 1;
      }
      setDatos({
        pros,
        generales: Object.fromEntries(generales.map(r => [r.professional_id, { type: tipoRegla(r.type), value: Number(r.value) || 0 }])),
        perfiles: Object.fromEntries(perfiles.map(p => [p.professional_id, {
          base_salary: Number(p.base_salary) || 0,
          base_period: periodicidad(p.base_period),
          base_since: p.base_since,
          // null = igual que la comisión general.
          product_commission_pct: p.product_commission_pct === null ? null : Number(p.product_commission_pct) || 0,
        }])),
        servicios: servicios.map(x => ({ ...x, price: Number(x.price) || 0 })),
        reglasSvc: porServicio,
        propias,
      });
      setError(null);
    } catch (e) {
      if (turno.vigente()) setError(e);
    }
  }, [tenantId], { timeZone: timezone, habilitado: !!tenantId, alCambiarSede: false, alCambiarDia: false });

  useEffect(() => () => { if (avisoTimer.current) clearTimeout(avisoTimer.current); }, []);

  const mostrarAviso = (texto: string) => {
    setAviso(texto);
    if (avisoTimer.current) clearTimeout(avisoTimer.current);
    avisoTimer.current = setTimeout(() => setAviso(null), 6000);
  };

  const onRefresh = async () => {
    setRefrescando(true);
    await recargar();
    setRefrescando(false);
  };

  // Activos, y los inactivos que todavía tienen algo configurado (solo lectura).
  const equipo = useMemo(() => {
    if (!datos) return [];
    const tieneAlgo = (id: string) => !!datos.generales[id] || !!datos.perfiles[id] || (datos.propias[id] ?? 0) > 0;
    const activos = datos.pros.filter(p => p.is_active !== false);
    const inactivos = datos.pros.filter(p => p.is_active === false && tieneAlgo(p.id));
    return [...activos, ...inactivos];
  }, [datos]);

  const serviciosVistos = useMemo(() => buscarServicios(datos?.servicios ?? [], buscar), [datos, buscar]);
  const recortados = !buscar.trim() && serviciosVistos.length > MAX_SERVICIOS;

  const tocarPro = (p: ProRegla) => {
    if (p.is_active === false) {
      Alert.alert(
        `${p.name} está inactivo`,
        "Sus reglas se ven aquí porque todavía se usan para liquidar lo que tenga pendiente. Para cambiarlas, actívalo en Equipo.",
      );
      return;
    }
    setEditPro(p);
  };

  const alGuardar = (cerrar: () => void) => (mensaje: string | null) => {
    cerrar();
    if (mensaje) {
      mostrarAviso(mensaje);
      void recargar();
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.contenido}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refrescando} onRefresh={onRefresh} tintColor={Colors.red} />}
      >
        <SegmentedControl options={VISTAS} value={vista} onChange={setVista} />

        {aviso ? <Aviso texto={aviso} icono="checkmark-circle-outline" tono="ok" /> : null}

        {error && !datos ? (
          <ErrorState error={error} onRetry={recargar} />
        ) : !datos ? (
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

            {vista === "equipo" ? (
              <>
                <Card>
                  <CardHead title="Pago de cada profesional" sub="Básico, comisión general de servicios y % de productos" />
                  {equipo.length === 0 ? (
                    <Text style={[s.vacio, { color: t.muted }]}>No hay profesionales activos. Agrégalos en Equipo.</Text>
                  ) : equipo.map((p, i) => (
                    <FilaPro
                      key={p.id}
                      pro={p}
                      regla={datos.generales[p.id] ?? null}
                      perfil={datos.perfiles[p.id] ?? null}
                      propias={datos.propias[p.id] ?? 0}
                      ultima={i === equipo.length - 1}
                      onPress={() => tocarPro(p)}
                    />
                  ))}
                </Card>
                <Text style={[s.nota, { color: t.subtle }]}>
                  La comisión general aplica a los servicios sin comisión propia (en «Por servicio»). Los productos usan el % de productos; si no se configuró, el % de la comisión general. Los cambios aplican a lo que se liquide de aquí en adelante.
                </Text>
              </>
            ) : (
              <>
                <Card>
                  <CardHead title="Qué comisión se paga por un servicio" />
                  <View style={s.prioridad}>
                    {[
                      "La de ese servicio para esa persona.",
                      "Si no hay, la del servicio para todos.",
                      "Si tampoco, la comisión general de la persona: % de lo cobrado, o un fijo que se paga una vez por cita.",
                    ].map((txt, i) => (
                      <View key={i} style={s.prioridadFila}>
                        <View style={[s.prioridadNum, { backgroundColor: t.chipBg }]}>
                          <Text style={[s.prioridadNumTxt, { color: t.ink }]}>{i + 1}</Text>
                        </View>
                        <Text style={[s.prioridadTxt, { color: t.muted }]}>{txt}</Text>
                      </View>
                    ))}
                  </View>
                </Card>

                <View style={[s.buscador, { backgroundColor: t.inputBg, borderColor: t.inputBorder }]}>
                  <Ionicons name="search" size={16} color={t.subtle} />
                  <TextInput
                    value={buscar}
                    onChangeText={setBuscar}
                    placeholder="Buscar servicio"
                    placeholderTextColor={t.subtle}
                    autoCorrect={false}
                    returnKeyType="search"
                    accessibilityLabel="Buscar servicio"
                    style={[s.buscadorInput, { color: t.text }]}
                  />
                  {buscar ? (
                    <TouchableOpacity onPress={() => setBuscar("")} hitSlop={10} accessibilityRole="button" accessibilityLabel="Borrar búsqueda">
                      <Ionicons name="close-circle" size={18} color={t.subtle} />
                    </TouchableOpacity>
                  ) : null}
                </View>

                <Card>
                  <CardHead title="Comisión por servicio" aside={String(serviciosVistos.length)} />
                  {serviciosVistos.length === 0 ? (
                    <Text style={[s.vacio, { color: t.muted }]}>
                      {datos.servicios.length ? "Ningún servicio coincide." : "No hay servicios activos."}
                    </Text>
                  ) : (recortados ? serviciosVistos.slice(0, MAX_SERVICIOS) : serviciosVistos).map((svc, i, lista) => (
                    <FilaServicioVista
                      key={svc.id}
                      servicio={svc}
                      reglas={datos.reglasSvc[svc.id] ?? []}
                      ultima={i === lista.length - 1}
                      onPress={() => setEditSvc(svc)}
                    />
                  ))}
                </Card>
                {recortados ? (
                  <Text style={[s.nota, { color: t.subtle }]}>
                    Se muestran los primeros {MAX_SERVICIOS} de {serviciosVistos.length}. Busca para encontrar los demás.
                  </Text>
                ) : null}
              </>
            )}
          </>
        )}
      </ScrollView>

      {editPro && datos ? (
        <ReglaProSheet
          key={editPro.id}
          pro={editPro}
          regla={datos.generales[editPro.id] ?? null}
          perfil={datos.perfiles[editPro.id] ?? null}
          propias={datos.propias[editPro.id] ?? 0}
          tenantId={tenantId}
          hoy={hoy}
          onCerrar={() => setEditPro(null)}
          onGuardado={alGuardar(() => setEditPro(null))}
          onCambioParcial={() => { void recargar(); }}
        />
      ) : null}
      {editSvc && datos ? (
        <ReglaServicioSheet
          key={editSvc.id}
          servicio={editSvc}
          reglas={datos.reglasSvc[editSvc.id] ?? []}
          pros={datos.pros}
          tenantId={tenantId}
          onCerrar={() => setEditSvc(null)}
          onGuardado={alGuardar(() => setEditSvc(null))}
          onCambioParcial={() => { void recargar(); }}
        />
      ) : null}
    </View>
  );
}

// ─── Filas ───────────────────────────────────────────────────────────────────

function FilaPro({ pro, regla, perfil, propias, ultima, onPress }: {
  pro: ProRegla; regla: ReglaGeneral | null; perfil: PerfilPago | null; propias: number; ultima: boolean; onPress: () => void;
}) {
  const { t } = useTheme();
  const inactivo = pro.is_active === false;
  const basico = perfil && perfil.base_salary > 0
    ? `${fmtMoneyFull(perfil.base_salary)} ${ETIQUETA_PERIODICIDAD[perfil.base_period].toLowerCase()}${perfil.base_since ? ` · desde ${fmtDia(perfil.base_since, "corto")}` : ""}`
    : "Sin básico";
  const servicios = `${regla ? textoRegla(regla, true) : "Sin comisión general"}${propias ? ` · ${propias} servicio${propias === 1 ? "" : "s"} con la suya` : ""}`;
  const pctDefecto = pctProductosPorDefecto(regla);
  const productos = perfil && perfil.product_commission_pct !== null
    ? (perfil.product_commission_pct > 0 ? fmtPorcentaje(perfil.product_commission_pct) : "Sin comisión")
    : pctDefecto > 0 ? `${fmtPorcentaje(pctDefecto)} (la general)` : "Sin comisión";

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.6}
      style={[s.fila, !ultima && { borderBottomWidth: 1, borderBottomColor: t.divider }, inactivo && { opacity: 0.7 }]}
      accessibilityRole="button"
      accessibilityLabel={`${pro.name}${inactivo ? ", inactivo" : ""}. Básico: ${basico}. Servicios: ${servicios}. Productos: ${productos}.`}
      accessibilityHint={inactivo ? "Explica por qué no se puede cambiar" : "Abre el pago de esta persona para cambiarlo"}
    >
      <Avatar name={pro.name} size={38} />
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <View style={s.filaNombre}>
          <Text style={[s.nombre, { color: t.ink }]} numberOfLines={1}>{pro.name}</Text>
          {inactivo ? <MonoTag>Inactivo</MonoTag> : null}
        </View>
        {pro.role ? <Text style={[s.rol, { color: t.subtle }]} numberOfLines={1}>{pro.role}</Text> : null}
        <Dato etiqueta="Básico" valor={basico} />
        <Dato etiqueta="Servicios" valor={servicios} />
        <Dato etiqueta="Productos" valor={productos} />
      </View>
      <Ionicons name={inactivo ? "lock-closed-outline" : "chevron-forward"} size={15} color={t.subtle} />
    </TouchableOpacity>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  const { t } = useTheme();
  return (
    <Text style={[s.dato, { color: t.muted }]}>
      <Text style={[s.datoEtiqueta, { color: t.text }]}>{etiqueta}: </Text>{valor}
    </Text>
  );
}

function FilaServicioVista({ servicio, reglas, ultima, onPress }: {
  servicio: ServicioRegla; reglas: ReglaServicio[]; ultima: boolean; onPress: () => void;
}) {
  const { t } = useTheme();
  const { todos, distintas } = resumenReglasServicio(reglas);
  const sub = `${fmtMoneyFull(servicio.price)}${servicio.category ? ` · ${servicio.category}` : ""}`;
  const regla = todos ? `${todos} para todos` : "La general de cada uno";
  const extra = distintas > 0 ? `${distintas} distinta${distintas === 1 ? "" : "s"}` : null;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.6}
      style={[s.fila, !ultima && { borderBottomWidth: 1, borderBottomColor: t.divider }]}
      accessibilityRole="button"
      accessibilityLabel={`${servicio.name}, ${sub}. ${regla}${extra ? `, ${extra}` : ""}.`}
      accessibilityHint="Abre la comisión de este servicio"
    >
      <View style={[s.iconoSvc, { backgroundColor: Colors.blue + "14" }]}>
        <Ionicons name="cut-outline" size={17} color={Colors.blue} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[s.nombre, { color: t.ink }]} numberOfLines={2}>{servicio.name}</Text>
        <Text style={[s.rol, { color: t.subtle }]} numberOfLines={1}>{sub}</Text>
      </View>
      <View style={s.svcDerecha}>
        <Text style={[s.svcRegla, { color: todos ? t.text : t.subtle }, todos && { fontFamily: Fonts.bold }]} numberOfLines={1}>{regla}</Text>
        {extra ? <Text style={[s.svcExtra, { color: Colors.blue }]}>{extra}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={15} color={t.subtle} />
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  contenido:    { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 48, gap: 14 },
  viejo:        { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: "rgba(251,15,5,0.32)", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11 },
  viejoTxt:     { flex: 1, fontSize: 12, fontFamily: Fonts.regular },
  viejoBtn:     { fontSize: 12, fontFamily: Fonts.bold, color: Colors.red },
  vacio:        { fontSize: 13.5, fontFamily: Fonts.regular, textAlign: "center", paddingVertical: 28, paddingHorizontal: 20 },
  nota:         { fontSize: 11.5, fontFamily: Fonts.regular, lineHeight: 16, textAlign: "center" },

  fila:         { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12, minHeight: 56 },
  filaNombre:   { flexDirection: "row", alignItems: "center", gap: 8 },
  nombre:       { flexShrink: 1, fontSize: 14, fontFamily: Fonts.semibold },
  rol:          { fontSize: 11.5, fontFamily: Fonts.regular },
  dato:         { fontSize: 12, fontFamily: Fonts.regular, lineHeight: 16 },
  datoEtiqueta: { fontFamily: Fonts.semibold },

  prioridad:      { paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  prioridadFila:  { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  prioridadNum:   { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  prioridadNumTxt: { fontSize: 11.5, fontFamily: Fonts.bold },
  prioridadTxt:   { flex: 1, fontSize: 12.5, fontFamily: Fonts.regular, lineHeight: 18 },

  buscador:      { minHeight: 46, flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: 12 },
  buscadorInput: { flex: 1, paddingVertical: 10, fontSize: 14, fontFamily: Fonts.regular },

  iconoSvc:     { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  svcDerecha:   { alignItems: "flex-end", maxWidth: "42%", gap: 2 },
  svcRegla:     { fontSize: 12.5, fontFamily: Fonts.semibold },
  svcExtra:     { fontSize: 11.5, fontFamily: Fonts.semibold },
});
