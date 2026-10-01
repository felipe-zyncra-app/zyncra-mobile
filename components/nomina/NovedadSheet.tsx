import { useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Alert } from "react-native";
import { Colors, Fonts } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { supabase } from "@/lib/supabase";
import { ErrorDB, exigirFilas, mensajeError, nuevoId, revisar } from "@/lib/db";
import { fmtMoneyFull } from "@/lib/format";
import { leerMonto, montoATexto } from "@/lib/dinero";
import { fmtDia } from "@/lib/tz";
import { ETIQUETA_NOVEDAD, type TipoNovedad } from "@/lib/nomina";
import {
  LARGO_CONCEPTO, TIPOS_NOVEDAD, validarNovedad, type FormNovedad, type OrigenNovedad,
} from "@/lib/nomina-reglas";
import SemanaStrip from "@/components/agenda/SemanaStrip";
import {
  Ayuda, BotonesHoja, BotonPeligro, CajaError, CampoTexto, Chip, Etiqueta, Hoja, Opciones,
  tecladoMonto, type Opcion,
} from "./ReglaComun";

/**
 * Anotar, cambiar o borrar una novedad manual (payroll_adjustments, source
 * 'manual'). Las de Caja y POS y las ya pagadas no llegan aquí: TabNovedades
 * explica por qué no se tocan. La base lo exige igual (RLS: el dueño solo
 * cambia o borra lo que no se ha liquidado).
 */

export type ProNovedad = { id: string; name: string; is_active: boolean | null };

export type FilaNovedad = {
  id: string;
  professional_id: string;
  kind: TipoNovedad;
  amount: number;
  entry_date: string;
  concept: string | null;
  source: OrigenNovedad;
  statement_id: string | null;
};

export const ICONO_NOVEDAD: Record<TipoNovedad, NonNullable<Opcion<TipoNovedad>["icono"]>> = {
  bonus: "gift-outline",
  tip: "cash-outline",
  deduction: "remove-circle-outline",
};

export const COLOR_NOVEDAD: Record<TipoNovedad, string> = {
  bonus: Colors.blue,
  tip: Colors.success,
  deduction: Colors.red,
};

const OPCIONES_TIPO: Opcion<TipoNovedad>[] = TIPOS_NOVEDAD.map(k => ({
  valor: k.valor, etiqueta: ETIQUETA_NOVEDAD[k.valor], ayuda: k.ayuda, icono: ICONO_NOVEDAD[k.valor], color: COLOR_NOVEDAD[k.valor],
}));

const conMayuscula = (x: string) => (x ? x[0].toUpperCase() + x.slice(1) : x);

export default function NovedadSheet({ fila, tenantId, hoy, pros, profesionalInicial, onCerrar, onListo, onDesactualizada }: {
  /** null = novedad nueva. */
  fila: FilaNovedad | null;
  tenantId: string;
  /** Día del negocio. */
  hoy: string;
  /** Todo el equipo (para el nombre); para elegir solo salen los activos. */
  pros: ProNovedad[];
  /** Profesional ya elegido al abrir (el filtro de la lista). */
  profesionalInicial?: string | null;
  onCerrar: () => void;
  /** Guardada o borrada: cerrar y recargar. */
  onListo: (mensaje: string) => void;
  /** Ya se había pagado o borrado en otro lado: recargar la lista. */
  onDesactualizada: () => void;
}) {
  const { t } = useTheme();
  const activos = useMemo(() => pros.filter(p => p.is_active !== false), [pros]);
  const nombre = (id: string | null) => pros.find(p => p.id === id)?.name ?? "—";

  const [form, setForm] = useState<FormNovedad>(() => {
    if (fila) {
      return {
        professional_id: fila.professional_id,
        kind: fila.kind,
        monto: montoATexto(fila.amount),
        entry_date: fila.entry_date,
        concept: fila.concept ?? "",
      };
    }
    const inicial = profesionalInicial && activos.some(p => p.id === profesionalInicial) ? profesionalInicial : null;
    return {
      professional_id: inicial ?? (activos.length === 1 ? activos[0].id : null),
      kind: "bonus",
      monto: "",
      entry_date: hoy,
      concept: "",
    };
  });
  const [semana, setSemana] = useState(form.entry_date);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const enCurso = useRef(false);
  // Id generado al abrir: si se corta la red después de guardar y se vuelve a
  // tocar Guardar, el segundo insert choca con el primero en vez de duplicar.
  const idNueva = useRef(nuevoId());

  const cambiar = <K extends keyof FormNovedad>(k: K, v: FormNovedad[K]) => {
    setForm(f => ({ ...f, [k]: v }));
    if (error) setError(null);
  };

  // Para elegir: activos, y la persona actual aunque ya no esté activa.
  const elegibles = useMemo(() => {
    const actual = fila ? pros.find(p => p.id === fila.professional_id) : null;
    return actual && actual.is_active === false ? [...activos, actual] : activos;
  }, [activos, pros, fila]);

  const monto = leerMonto(form.monto);
  const etiquetaTipo = ETIQUETA_NOVEDAD[form.kind];

  const guardar = async () => {
    if (enCurso.current) return;
    const r = validarNovedad(form, hoy);
    if (!r.ok) { setError(r.error); return; }
    enCurso.current = true;
    setGuardando(true);
    setError(null);
    try {
      if (fila) {
        exigirFilas(
          await supabase.from("payroll_adjustments").update(r.valor)
            .eq("id", fila.id).eq("tenant_id", tenantId)
            .eq("source", "manual").is("statement_id", null)
            .select("id"),
          "No se guardaron los cambios",
        );
        onListo(`Se guardó la novedad de ${nombre(r.valor.professional_id)}.`);
      } else {
        const res = await supabase.from("payroll_adjustments").insert({
          id: idNueva.current,
          tenant_id: tenantId,
          source: "manual",
          ...r.valor,
        }).select("id");
        // 23505 = ese id ya existe: era un reintento y la primera sí quedó.
        if (res.error && (res.error as { code?: string }).code !== "23505") revisar(res, "No se anotó la novedad");
        onListo(
          `Quedó anotada: ${ETIQUETA_NOVEDAD[r.valor.kind].toLowerCase()} de ${fmtMoneyFull(r.valor.amount)} para ${nombre(r.valor.professional_id)}. Sale en su próxima liquidación.`,
        );
      }
    } catch (e) {
      if (e instanceof ErrorDB && e.code === "SIN_FILAS") {
        setError("No se guardó: esta novedad ya se pagó o la borraron en otro dispositivo. Cierra para ver la lista actualizada.");
        onDesactualizada();
      } else {
        setError(mensajeError(e));
      }
    } finally {
      enCurso.current = false;
      setGuardando(false);
    }
  };

  const borrar = () => {
    if (!fila || enCurso.current) return;
    const que = `${ETIQUETA_NOVEDAD[fila.kind].toLowerCase()} de ${fmtMoneyFull(fila.amount)} de ${nombre(fila.professional_id)}`;
    Alert.alert("Borrar novedad", `¿Borrar ${que}? No se puede deshacer.`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Borrar",
        style: "destructive",
        onPress: async () => {
          if (enCurso.current) return;
          enCurso.current = true;
          setGuardando(true);
          setError(null);
          try {
            exigirFilas(
              await supabase.from("payroll_adjustments").delete()
                .eq("id", fila.id).eq("tenant_id", tenantId)
                .eq("source", "manual").is("statement_id", null)
                .select("id"),
              "No se borró la novedad",
            );
            onListo(`Se borró ${que}.`);
          } catch (e) {
            if (e instanceof ErrorDB && e.code === "SIN_FILAS") {
              setError("No se borró: esta novedad ya se pagó o la borraron en otro dispositivo. Cierra para ver la lista actualizada.");
              onDesactualizada();
            } else {
              setError(mensajeError(e));
            }
          } finally {
            enCurso.current = false;
            setGuardando(false);
          }
        },
      },
    ]);
  };

  const elegirDia = (d: string) => { cambiar("entry_date", d); setSemana(d); };
  const ayudaTipo = TIPOS_NOVEDAD.find(k => k.valor === form.kind)?.ayuda;

  return (
    <Hoja
      titulo={fila ? "Editar novedad" : "Anotar novedad"}
      subtitulo="Se suma o se resta en la próxima liquidación de esa persona."
      onCerrar={onCerrar}
      ocupado={guardando}
      pie={(
        <>
          <CajaError mensaje={error} />
          <BotonesHoja
            onCancelar={onCerrar}
            onGuardar={guardar}
            guardando={guardando}
            textoGuardar={fila ? "Guardar cambios" : "Anotar"}
          />
          {fila ? <BotonPeligro texto="Borrar novedad" onPress={borrar} deshabilitado={guardando} /> : null}
        </>
      )}
    >
      <Etiqueta>Profesional</Etiqueta>
      {elegibles.length === 0 ? (
        <Ayuda tono="alerta">No hay profesionales activos. Agrégalos en Equipo para anotarles novedades.</Ayuda>
      ) : (
        <View style={s.chips}>
          {elegibles.map(p => (
            <Chip
              key={p.id}
              etiqueta={p.is_active === false ? `${p.name} (inactivo)` : p.name}
              activo={form.professional_id === p.id}
              onPress={() => cambiar("professional_id", p.id)}
              apagado={guardando}
            />
          ))}
        </View>
      )}

      <Etiqueta>Tipo</Etiqueta>
      <Opciones opciones={OPCIONES_TIPO} valor={form.kind} onCambiar={k => cambiar("kind", k)} enLista deshabilitado={guardando} />

      <Etiqueta>Monto</Etiqueta>
      <CampoTexto
        value={form.monto}
        onChangeText={v => cambiar("monto", v)}
        keyboardType={tecladoMonto()}
        placeholder="Ej. 50000"
        editable={!guardando}
        accessibilityLabel="Monto"
        conError={!!error && !(monto && monto > 0)}
      />
      {monto && monto > 0 ? (
        <Text style={[s.vista, { color: form.kind === "deduction" ? Colors.red : t.text }]}>
          {form.kind === "deduction" ? "− " : "+ "}{fmtMoneyFull(monto)} · {etiquetaTipo}
        </Text>
      ) : null}

      <Etiqueta>Fecha</Etiqueta>
      <View style={s.filaFecha}>
        <Text style={[s.fecha, { color: t.text }]}>{conMayuscula(fmtDia(form.entry_date, "completo"))}</Text>
        {form.entry_date !== hoy ? <Chip etiqueta="Hoy" icono="today-outline" onPress={() => elegirDia(hoy)} apagado={guardando} /> : null}
      </View>
      <SemanaStrip
        semana={semana}
        seleccionado={form.entry_date}
        hoy={hoy}
        onSeleccionar={elegirDia}
        onCambiarSemana={setSemana}
        style={[s.semana, { borderColor: t.line }]}
      />
      {form.entry_date > hoy ? (
        <Ayuda>Con fecha futura queda pendiente hasta la liquidación que cubra ese día.</Ayuda>
      ) : null}

      <Etiqueta>Concepto (opcional)</Etiqueta>
      <CampoTexto
        value={form.concept}
        onChangeText={v => cambiar("concept", v)}
        maxLength={LARGO_CONCEPTO}
        placeholder={form.kind === "deduction" ? "Ej. Adelanto del 20 de septiembre" : "Ej. Meta de ventas de septiembre"}
        editable={!guardando}
        accessibilityLabel="Concepto"
        returnKeyType="done"
      />
      {ayudaTipo ? <Ayuda>{ayudaTipo} Sale en la colilla de pago.</Ayuda> : null}
    </Hoja>
  );
}

const s = StyleSheet.create({
  chips:     { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  vista:     { fontSize: 13, fontFamily: Fonts.semibold },
  filaFecha: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  fecha:     { flex: 1, fontSize: 14, fontFamily: Fonts.semibold },
  semana:    { borderRadius: 14, borderLeftWidth: 1, borderRightWidth: 1 },
});
