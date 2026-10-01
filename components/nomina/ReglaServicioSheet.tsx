import { useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Fonts, Radius } from "@/constants/theme";
import { useTheme } from "@/lib/theme";
import { supabase } from "@/lib/supabase";
import { mensajeError, revisar } from "@/lib/db";
import { fmtMoneyFull } from "@/lib/format";
import type { ReglaTipo } from "@/lib/nomina";
import {
  armarReglasServicio, filasReglasServicio, formServicioInicial, mismasReglasServicio, textoRegla,
  type FormServicio, type ReglaServicio,
} from "@/lib/nomina-reglas";
import { IconButton } from "@/components/ui";
import {
  Aviso, Ayuda, BotonesHoja, CajaError, CampoValor, Chip, Etiqueta, Hoja, Opciones, type Opcion,
} from "./ReglaComun";
import type { ProRegla } from "./ReglaProSheet";

/**
 * Comisión de un servicio (Nómina → Reglas → Por servicio), como el modal del
 * panel web: una regla para todos y, si hace falta, una distinta para
 * alguien (commission_service_rules, professional_id null = para todos).
 *
 * Al guardar se borran las reglas del servicio y se escribe el conjunto
 * nuevo, igual que el web. Las de profesionales inactivos no se editan aquí,
 * pero se reescriben iguales para no perderlas. Si el borrado pasa y la
 * escritura nueva falla, se intenta dejar las de antes.
 */

export type ServicioRegla = { id: string; name: string; price: number; category: string | null };

const OPCIONES_TODOS: Opcion<ReglaTipo | "none">[] = [
  { valor: "none", etiqueta: "La general" },
  { valor: "percentage", etiqueta: "% de lo cobrado" },
  { valor: "fixed", etiqueta: "Fijo por vez" },
];

const OPCIONES_PERSONA: Opcion<ReglaTipo>[] = [
  { valor: "percentage", etiqueta: "% de lo cobrado" },
  { valor: "fixed", etiqueta: "Fijo por vez" },
];

export default function ReglaServicioSheet({ servicio, reglas, pros, tenantId, onCerrar, onGuardado, onCambioParcial }: {
  servicio: ServicioRegla;
  /** Las reglas guardadas de este servicio. */
  reglas: ReglaServicio[];
  /** Todo el equipo; para agregar solo salen los activos. */
  pros: ProRegla[];
  tenantId: string;
  onCerrar: () => void;
  /** Guardado (mensaje) o sin cambios (null): cerrar y recargar. */
  onGuardado: (mensaje: string | null) => void;
  /** Quedó algo distinto de lo que había (falló a medias): recargar sin cerrar. */
  onCambioParcial: () => void;
}) {
  const { t } = useTheme();
  const activo = (id: string) => pros.find(p => p.id === id)?.is_active !== false;
  const nombre = (id: string | null) => (id ? pros.find(p => p.id === id)?.name ?? "Profesional borrado" : "Todos");

  const [form, setForm] = useState<FormServicio>(() => formServicioInicial(reglas, activo, id => nombre(id)));
  const [agregando, setAgregando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const enCurso = useRef(false);

  const libres = useMemo(
    () => pros.filter(p => p.is_active !== false && !form.personas.some(x => x.professional_id === p.id)),
    [pros, form.personas],
  );

  const tocar = (f: (x: FormServicio) => FormServicio) => {
    setForm(f);
    if (error) setError(null);
  };

  const agregar = (p: ProRegla) => {
    tocar(f => ({ ...f, personas: [...f.personas, { professional_id: p.id, nombre: p.name, tipo: "percentage", valor: "" }] }));
    setAgregando(false);
  };

  const guardar = async () => {
    if (enCurso.current) return;
    const r = armarReglasServicio(form);
    if (!r.ok) { setError(r.error); return; }
    if (mismasReglasServicio(r.valor, reglas)) { onGuardado(null); return; }

    enCurso.current = true;
    setGuardando(true);
    setError(null);
    let borradas = false;
    try {
      // Reemplazar las reglas del servicio: borrar y escribir de nuevo (como el web).
      revisar(
        await supabase.from("commission_service_rules").delete()
          .eq("tenant_id", tenantId).eq("service_id", servicio.id),
        "No se pudieron cambiar las comisiones del servicio",
      );
      borradas = true;
      if (r.valor.length > 0) {
        revisar(
          await supabase.from("commission_service_rules")
            .insert(filasReglasServicio(tenantId, servicio.id, r.valor)).select("id"),
          "No se guardaron las comisiones nuevas",
        );
      }
      onGuardado(
        r.valor.length > 0
          ? `Se guardó la comisión de ${servicio.name}.`
          : `${servicio.name} quedó con la comisión general de cada uno.`,
      );
    } catch (e) {
      if (!borradas || r.valor.length === 0) {
        setError(mensajeError(e));
      } else {
        // Las de antes ya se borraron y las nuevas no entraron: devolverlas.
        let restauradas = reglas.length === 0;
        if (!restauradas) {
          try {
            const back = await supabase.from("commission_service_rules")
              .insert(filasReglasServicio(tenantId, servicio.id, reglas)).select("id");
            restauradas = !back.error;
          } catch {
            restauradas = false;
          }
        }
        setError(restauradas
          ? `${mensajeError(e)} Las comisiones del servicio quedaron como estaban.`
          : `${mensajeError(e)} Se quitaron las comisiones que tenía este servicio y no se pudieron escribir las nuevas: vuelve a tocar Guardar.`);
        onCambioParcial();
      }
    } finally {
      enCurso.current = false;
      setGuardando(false);
    }
  };

  const tipoTodos = form.todos.tipo;

  return (
    <Hoja
      titulo={servicio.name}
      subtitulo={`${fmtMoneyFull(servicio.price)}${servicio.category ? ` · ${servicio.category}` : ""} · comisión de este servicio`}
      onCerrar={onCerrar}
      ocupado={guardando}
      pie={(
        <>
          <CajaError mensaje={error} />
          <BotonesHoja onCancelar={onCerrar} onGuardar={guardar} guardando={guardando} />
        </>
      )}
    >
      <Aviso texto="Gana la comisión de la persona en este servicio; si no tiene, la del servicio para todos; y si tampoco hay, la comisión general de cada uno." />

      <Etiqueta>Para todos</Etiqueta>
      <Opciones
        opciones={OPCIONES_TODOS}
        valor={tipoTodos}
        onCambiar={tipo => tocar(f => ({ ...f, todos: { ...f.todos, tipo } }))}
        deshabilitado={guardando}
      />
      {tipoTodos !== "none" ? (
        <CampoValor
          tipo={tipoTodos}
          valor={form.todos.valor}
          onCambiar={valor => tocar(f => ({ ...f, todos: { ...f.todos, valor } }))}
          etiqueta={tipoTodos === "percentage" ? "Porcentaje para todos" : "Monto fijo para todos"}
          editable={!guardando}
        />
      ) : null}
      <Ayuda>
        {tipoTodos === "none"
          ? "Cada quien gana su comisión general (la de «Pago del equipo») en este servicio."
          : tipoTodos === "fixed"
            ? "Un fijo se paga por cada vez que hacen el servicio. Con 0 este servicio no paga comisión."
            : "Sobre lo cobrado por el servicio, con el descuento de la venta repartido."}
      </Ayuda>

      <Etiqueta>Distinta para alguien</Etiqueta>
      {form.personas.length === 0 && form.conservar.length === 0 ? (
        <Ayuda>Nadie tiene una comisión distinta en este servicio.</Ayuda>
      ) : null}
      {form.personas.map((p, i) => (
        <View key={p.professional_id} style={[s.persona, { borderColor: t.line, backgroundColor: t.chipBg }]}>
          <View style={s.personaCabeza}>
            <Text style={[s.personaNombre, { color: t.text }]} numberOfLines={1}>{p.nombre}</Text>
            <IconButton
              icon="trash-outline"
              label={`Quitar la comisión de ${p.nombre}`}
              tone="plain"
              color={Colors.red}
              onPress={() => tocar(f => ({ ...f, personas: f.personas.filter((_, j) => j !== i) }))}
              disabled={guardando}
            />
          </View>
          <Opciones
            opciones={OPCIONES_PERSONA}
            valor={p.tipo}
            onCambiar={tipo => tocar(f => ({ ...f, personas: f.personas.map((x, j) => (j === i ? { ...x, tipo } : x)) }))}
            deshabilitado={guardando}
          />
          <CampoValor
            tipo={p.tipo}
            valor={p.valor}
            onCambiar={valor => tocar(f => ({ ...f, personas: f.personas.map((x, j) => (j === i ? { ...x, valor } : x)) }))}
            etiqueta={`Comisión de ${p.nombre}`}
            editable={!guardando}
          />
        </View>
      ))}

      {form.conservar.map(c => (
        <View key={c.professional_id ?? "todos"} style={[s.inactivo, { borderColor: t.line }]}>
          <Ionicons name="lock-closed-outline" size={14} color={t.subtle} />
          <Text style={[s.inactivoTxt, { color: t.muted }]}>
            {nombre(c.professional_id)} (inactivo): {textoRegla(c)}. Se conserva; para cambiarla, actívalo en Equipo.
          </Text>
        </View>
      ))}

      {libres.length > 0 ? (
        agregando ? (
          <View style={s.chips}>
            {libres.map(p => <Chip key={p.id} etiqueta={p.name} onPress={() => agregar(p)} apagado={guardando} />)}
            <Chip etiqueta="Cancelar" icono="close" onPress={() => setAgregando(false)} />
          </View>
        ) : (
          <TouchableOpacity
            style={[s.agregar, { borderColor: t.lineStrong }]}
            onPress={() => setAgregando(true)}
            disabled={guardando}
            accessibilityRole="button"
            accessibilityLabel="Agregar a alguien"
          >
            <Ionicons name="add" size={18} color={Colors.red} />
            <Text style={s.agregarTxt}>Agregar a alguien</Text>
          </TouchableOpacity>
        )
      ) : form.personas.length > 0 ? (
        <Ayuda>Todo el equipo activo tiene ya su comisión en este servicio.</Ayuda>
      ) : null}
    </Hoja>
  );
}

const s = StyleSheet.create({
  persona:       { borderWidth: 1, borderRadius: Radius.md, padding: 12, gap: 10 },
  personaCabeza: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  personaNombre: { flex: 1, fontSize: 14, fontFamily: Fonts.bold },
  inactivo:      { flexDirection: "row", alignItems: "flex-start", gap: 8, borderWidth: 1, borderStyle: "dashed", borderRadius: Radius.md, padding: 12 },
  inactivoTxt:   { flex: 1, fontSize: 12.5, fontFamily: Fonts.regular, lineHeight: 17 },
  chips:         { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  agregar:       { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderStyle: "dashed", borderRadius: Radius.md },
  agregarTxt:    { fontSize: 14, fontFamily: Fonts.bold, color: Colors.red },
});
