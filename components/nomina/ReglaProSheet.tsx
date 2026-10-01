import { useMemo, useRef, useState } from "react";
import { View, StyleSheet } from "react-native";
import { supabase } from "@/lib/supabase";
import { ErrorDB, exigirFilas, mensajeError } from "@/lib/db";
import { leerMonto } from "@/lib/dinero";
import { fmtDia } from "@/lib/tz";
import { ETIQUETA_PERIODICIDAD, mesDe, quincenaDe, type Periodicidad, type ReglaTipo } from "@/lib/nomina";
import {
  PERIODICIDADES, diasDeBasicoAtras, esFechaReal, fmtPorcentaje, formPagoInicial, leerPorcentaje,
  mismaRegla, mismoPerfil, pctProductosPorDefecto, validarPago,
  type FormPago, type PerfilPago, type ReglaGeneral,
} from "@/lib/nomina-reglas";
import {
  Ayuda, BotonesHoja, CajaError, CampoTexto, CampoValor, Chip, Etiqueta, Hoja, Opciones, type Opcion,
} from "./ReglaComun";

/**
 * Pago de un profesional (Nómina → Reglas → Pago del equipo), como el modal
 * del panel web:
 *   · comisión general de servicios → commission_rules (la de siempre: la
 *     misma escritura que hacía la pantalla vieja de Comisiones);
 *   · básico, periodicidad, desde cuándo y % de productos → payroll_profiles
 *     (upsert por negocio + profesional).
 * Aplica a lo que se liquide de aquí en adelante; lo pagado no cambia.
 */

export type ProRegla = { id: string; name: string; role: string | null; is_active: boolean | null };

const OPCIONES_GENERAL: Opcion<ReglaTipo | "none">[] = [
  { valor: "none", etiqueta: "Sin comisión" },
  { valor: "percentage", etiqueta: "% de lo cobrado" },
  { valor: "fixed", etiqueta: "Fijo por cita" },
];

const OPCIONES_PERIODO: Opcion<Periodicidad>[] = PERIODICIDADES.map(p => ({ valor: p, etiqueta: ETIQUETA_PERIODICIDAD[p] }));

/** Más atrás de esto se avisa que los periodos sin liquidar saldrán con básico pendiente. */
const DIAS_AVISO_BASICO = 31;

export default function ReglaProSheet({ pro, regla, perfil, propias, tenantId, hoy, onCerrar, onGuardado, onCambioParcial }: {
  pro: ProRegla;
  regla: ReglaGeneral | null;
  perfil: PerfilPago | null;
  /** Servicios con una comisión propia para esta persona (Por servicio). */
  propias: number;
  tenantId: string;
  hoy: string;
  onCerrar: () => void;
  /** Guardado (mensaje) o sin cambios (null): cerrar y recargar. */
  onGuardado: (mensaje: string | null) => void;
  /** Se guardó una parte: recargar sin cerrar. */
  onCambioParcial: () => void;
}) {
  const [form, setForm] = useState<FormPago>(() => formPagoInicial(regla, perfil, hoy));
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const enCurso = useRef(false);

  const cambiar = (cambios: Partial<FormPago>) => {
    setForm(f => ({ ...f, ...cambios }));
    if (error) setError(null);
  };

  const basico = leerMonto(form.basico) ?? 0;
  const atras = basico > 0 ? diasDeBasicoAtras(form.desde, hoy) : 0;

  // % de productos que se usaría con el campo vacío: el de la general que se está editando.
  const pctPorDefecto = useMemo(() => {
    if (form.general.tipo !== "percentage") return 0;
    const v = leerPorcentaje(form.general.valor);
    return pctProductosPorDefecto(v === null || v > 100 ? null : { type: "percentage", value: v });
  }, [form.general]);

  const atajosDesde = useMemo(() => {
    const vistos = new Set<string>();
    return [
      { etiqueta: "Hoy", dia: hoy },
      { etiqueta: "Inicio de la quincena", dia: quincenaDe(hoy).desde },
      { etiqueta: "Inicio del mes", dia: mesDe(hoy).desde },
    ].filter(a => (vistos.has(a.dia) ? false : (vistos.add(a.dia), true)));
  }, [hoy]);

  const guardar = async () => {
    if (enCurso.current) return;
    const r = validarPago(form, { perfilExiste: !!perfil, hoy });
    if (!r.ok) { setError(r.error); return; }
    const { general, perfil: nuevo, borrarPerfil } = r.valor;
    const cambiaGeneral = !mismaRegla(general, regla);
    const cambiaPerfil = borrarPerfil || (nuevo !== null && !mismoPerfil(nuevo, perfil));
    if (!cambiaGeneral && !cambiaPerfil) { onGuardado(null); return; }

    enCurso.current = true;
    setGuardando(true);
    setError(null);
    let generalHecha = false;
    try {
      if (cambiaGeneral) {
        if (general) {
          exigirFilas(
            await supabase.from("commission_rules").upsert({
              tenant_id: tenantId,
              professional_id: pro.id,
              type: general.type,
              value: general.value,
              updated_at: new Date().toISOString(),
            }, { onConflict: "tenant_id,professional_id" }).select("id"),
            "No se guardó la comisión general",
          );
        } else {
          try {
            exigirFilas(
              await supabase.from("commission_rules").delete()
                .eq("professional_id", pro.id).eq("tenant_id", tenantId).select("id"),
              "No se quitó la comisión general",
            );
          } catch (e) {
            // Ya no estaba (la quitaron en otro dispositivo): queda como se pidió.
            if (!(e instanceof ErrorDB && e.code === "SIN_FILAS")) throw e;
          }
        }
        generalHecha = true;
      }
      if (cambiaPerfil && borrarPerfil) {
        // Básico 0 y % vacío: ya no hace falta perfil (igual que el web).
        try {
          exigirFilas(
            await supabase.from("payroll_profiles").delete()
              .eq("professional_id", pro.id).eq("tenant_id", tenantId).select("id"),
            "No se quitó el básico ni el % de productos",
          );
        } catch (e) {
          if (!(e instanceof ErrorDB && e.code === "SIN_FILAS")) throw e;
        }
      } else if (cambiaPerfil && nuevo) {
        exigirFilas(
          await supabase.from("payroll_profiles").upsert({
            tenant_id: tenantId,
            professional_id: pro.id,
            ...nuevo,
            updated_at: new Date().toISOString(),
          }, { onConflict: "tenant_id,professional_id" }).select("id"),
          "No se guardó el básico ni el % de productos",
        );
      }
      onGuardado(`Se guardó el pago de ${pro.name}. Aplica a lo que se liquide de aquí en adelante.`);
    } catch (e) {
      if (generalHecha) {
        setError(`${mensajeError(e)} La comisión general sí quedó guardada.`);
        onCambioParcial();
      } else {
        setError(mensajeError(e));
      }
    } finally {
      enCurso.current = false;
      setGuardando(false);
    }
  };

  const tipoGeneral = form.general.tipo;

  return (
    <Hoja
      titulo={`Pago de ${pro.name}`}
      subtitulo="Aplica a lo que se liquide de aquí en adelante. Lo ya pagado no cambia."
      onCerrar={onCerrar}
      ocupado={guardando}
      pie={(
        <>
          <CajaError mensaje={error} />
          <BotonesHoja onCancelar={onCerrar} onGuardar={guardar} guardando={guardando} />
        </>
      )}
    >
      <Etiqueta>Comisión general de servicios</Etiqueta>
      <Opciones
        opciones={OPCIONES_GENERAL}
        valor={tipoGeneral}
        onCambiar={tipo => cambiar({ general: { ...form.general, tipo } })}
        deshabilitado={guardando}
      />
      {tipoGeneral !== "none" ? (
        <CampoValor
          tipo={tipoGeneral}
          valor={form.general.valor}
          onCambiar={valor => cambiar({ general: { ...form.general, valor } })}
          etiqueta={tipoGeneral === "percentage" ? "Porcentaje de la comisión general" : "Monto fijo por cita"}
          placeholder={tipoGeneral === "percentage" ? "Ej. 40" : "Ej. 10000"}
          editable={!guardando}
        />
      ) : null}
      <Ayuda>
        {tipoGeneral === "fixed"
          ? "Se paga una vez por cada cita atendida, tenga los servicios que tenga. "
          : tipoGeneral === "percentage"
            ? "Sobre lo cobrado de cada servicio, con el descuento de la venta repartido. "
            : "Sin comisión general, solo gana en los servicios que tengan comisión propia. "}
        Aplica a los servicios sin comisión propia en «Por servicio».
        {propias > 0 ? ` ${pro.name} tiene comisión propia en ${propias} servicio${propias === 1 ? "" : "s"}.` : ""}
      </Ayuda>

      <Etiqueta>Básico</Etiqueta>
      <CampoValor
        tipo="fixed"
        valor={form.basico}
        onCambiar={v => cambiar({ basico: v })}
        etiqueta="Monto del básico"
        placeholder="Vacío = sin básico"
        editable={!guardando}
      />
      {basico > 0 ? (
        <>
          <Etiqueta>Cada cuánto</Etiqueta>
          <Opciones
            opciones={OPCIONES_PERIODO}
            valor={form.periodo}
            onCambiar={periodo => cambiar({ periodo })}
            deshabilitado={guardando}
          />
          <Etiqueta>Se cuenta desde</Etiqueta>
          <CampoTexto
            value={form.desde}
            onChangeText={v => cambiar({ desde: v.trim() })}
            placeholder="AAAA-MM-DD"
            keyboardType="numbers-and-punctuation"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={10}
            editable={!guardando}
            accessibilityLabel="Desde cuándo se cuenta el básico, año-mes-día"
            conError={!!form.desde && !esFechaReal(form.desde)}
          />
          <View style={s.chips}>
            {atajosDesde.map(a => (
              <Chip
                key={a.dia}
                etiqueta={a.etiqueta}
                activo={form.desde === a.dia}
                onPress={() => cambiar({ desde: a.dia })}
                apagado={guardando}
              />
            ))}
          </View>
          <Ayuda>
            {esFechaReal(form.desde) ? `Desde el ${fmtDia(form.desde, "completo")}. ` : ""}
            Lo de antes de esa fecha no sale como pendiente (ya lo pagaste por fuera).{" "}
            {form.periodo === "semanal"
              ? "Se prorratea por días de calendario: 7 días son una semana de básico."
              : "Se prorratea por días con mes de 30 días: una quincena es la mitad del básico mensual."}
          </Ayuda>
          {atras > DIAS_AVISO_BASICO ? (
            <Ayuda tono="alerta">
              Empieza hace {atras} días: los periodos desde esa fecha que no hayas liquidado en Zyncra mostrarán el básico como pendiente. Si ya lo pagaste por fuera, pon una fecha más reciente.
            </Ayuda>
          ) : null}
        </>
      ) : (
        <Ayuda>Déjalo vacío si solo gana comisión.</Ayuda>
      )}

      <Etiqueta>Comisión por productos vendidos</Etiqueta>
      <CampoValor
        tipo="percentage"
        valor={form.pctProductos}
        onCambiar={v => cambiar({ pctProductos: v })}
        etiqueta="Porcentaje de comisión por productos"
        placeholder={`Vacío = ${fmtPorcentaje(pctPorDefecto)}`}
        editable={!guardando}
      />
      <Ayuda>
        Sobre lo cobrado de los productos que vende (en el POS, quien vendió o el profesional de la cita).
        {!form.pctProductos.trim()
          ? pctPorDefecto > 0
            ? ` Vacío: el mismo % de la comisión general (${fmtPorcentaje(pctPorDefecto)}).`
            : " Vacío: sin comisión por productos."
          : ""}
      </Ayuda>
    </Hoja>
  );
}

const s = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
