import { mensajeError, textoParaUsuario } from "@/lib/db";
import { fmt12, fmtMoneyFull } from "@/lib/format";
import {
  ErrorNomina, ETIQUETA_NOVEDAD, ETIQUETA_PERIODICIDAD,
  type BasicoPendiente, type Linea, type Novedad, type Pendiente,
} from "@/lib/nomina";

/**
 * Textos y agrupaciones de las pantallas de nómina. Funciones puras (se
 * prueban en __tests__/nomina-textos-test.ts). No calculan la nómina: solo
 * acomodan para mostrar lo que ya calculó el servidor.
 */

/** De dónde salió una novedad. */
export const ORIGEN_NOVEDAD: Record<Novedad["source"], string> = {
  manual: "A mano",
  caja: "Caja",
  pos: "POS",
};

/** "Bonificación · Meta de octubre", "Propina". */
export function etiquetaNovedad(n: Pick<Novedad, "kind" | "concept">): string {
  const base = ETIQUETA_NOVEDAD[n.kind] ?? n.kind;
  const concepto = n.concept?.trim();
  return concepto ? `${base} · ${concepto}` : base;
}

/** "15 días de $1.300.000 mensual". */
export function textoBasico(b: Pick<BasicoPendiente, "dias" | "salario" | "periodo">): string {
  const periodo = (ETIQUETA_PERIODICIDAD[b.periodo] ?? String(b.periodo)).toLowerCase();
  return `${b.dias} ${b.dias === 1 ? "día" : "días"} de ${fmtMoneyFull(b.salario)} ${periodo}`;
}

/** "1 cita", "3 citas". */
export function citas(n: number): string {
  return `${n} ${n === 1 ? "cita" : "citas"}`;
}

/** Aviso de citas pasadas sin cerrar (no cuentan hasta marcarlas atendidas o cobrarlas). */
export function textoSinCerrar(n: number): string {
  return `${n === 1 ? "Hay 1 cita pasada" : `Hay ${n} citas pasadas`} sin marcar como atendida ni cobrar en este periodo. No cuentan para la nómina hasta que se cierren en la agenda.`;
}

/** "9:30 AM" desde "09:30:00"; null si no hay hora. */
export function horaCorta(hora: string | null | undefined): string | null {
  return hora && /^\s*\d{1,2}:\d{2}/.test(hora) ? fmt12(hora) : null;
}

// ─── Errores del servidor ────────────────────────────────────────────────────

/** Lo que dice la app según el código de /api/nomina/* (ver lib/nomina-datos del web). */
const POR_CODIGO: Record<string, string> = {
  sin_sesion: "Tu sesión expiró. Cierra sesión y vuelve a entrar.",
  tenant_invalido: "No se reconoció el negocio. Cierra sesión y vuelve a entrar.",
  sin_acceso: "Tu usuario ya no tiene acceso a este negocio.",
  sin_ficha: "Tu usuario no tiene una ficha de profesional activa en este negocio.",
  sin_montos: "Tu negocio no tiene activado que veas montos.",
  solo_dueno: "Solo el dueño del negocio puede hacer esto.",
};

/** Mensaje para el usuario de cualquier error de nómina (servidor, red o JS). */
export function mensajeNomina(e: unknown): string {
  if (e instanceof ErrorNomina) {
    if (e.code && POR_CODIGO[e.code]) return POR_CODIGO[e.code];
    const respaldo = e.status === 401
      ? POR_CODIGO.sin_sesion
      : e.status === 403
        ? "No tienes permiso para ver la nómina."
        : "No se pudo completar. Revisa tu conexión e inténtalo de nuevo.";
    return textoParaUsuario(e.message, respaldo);
  }
  return mensajeError(e);
}

export type EstadoAcceso = { titulo: string; texto: string };

/**
 * Si el error es de acceso (401/403), qué mostrar en vez de los números; null
 * si es otro error (red, servidor), que se muestra con "Reintentar".
 */
export function estadoAcceso(e: unknown): EstadoAcceso | null {
  if (!(e instanceof ErrorNomina) || (e.status !== 401 && e.status !== 403)) return null;
  switch (e.code) {
    case "sin_montos":
      return {
        titulo: "Montos ocultos",
        texto: "Tu negocio no tiene activado que veas montos. Si quieres ver tu nómina aquí, pídeselo al administrador.",
      };
    case "sin_ficha":
      return {
        titulo: "Sin ficha de profesional",
        texto: "Tu usuario no tiene una ficha de profesional activa en este negocio, así que no hay nómina que mostrar. Pídele al administrador que la revise en Equipo.",
      };
    case "sin_acceso":
      return { titulo: "Sin acceso", texto: POR_CODIGO.sin_acceso };
    case "sin_sesion":
      return { titulo: "Sesión vencida", texto: POR_CODIGO.sin_sesion };
    default:
      return {
        titulo: e.status === 401 ? "Sesión vencida" : "Sin permiso",
        texto: mensajeNomina(e),
      };
  }
}

// ─── Líneas cita por cita ────────────────────────────────────────────────────

export type GrupoCita = {
  clave: string;
  dia: string;
  hora: string | null;
  cliente: string | null;
  /** Venta del POS sin cita (servicio cobrado directo). */
  sinCita: boolean;
  lineas: Linea[];
  valor: number;
  comision: number;
  /** Todas sus líneas ya están cubiertas por una liquidación. */
  liquidada: boolean;
};

/**
 * Agrupa los servicios por cita (o por venta si no tienen cita), en el orden
 * que mandó el servidor. Los productos se muestran aparte, uno por uno.
 * Suma valor y comisión del grupo solo para mostrar el renglón de la cita.
 */
export function agruparPorCita(lineas: readonly Linea[]): GrupoCita[] {
  const grupos = new Map<string, GrupoCita>();
  for (const l of lineas) {
    if (l.tipo !== "servicio") continue;
    const clave = l.cita_id ? `cita:${l.cita_id}` : `venta:${l.venta_id ?? l.item_id ?? l.nombre}`;
    const g = grupos.get(clave);
    if (g) {
      g.lineas.push(l);
      g.valor += l.valor;
      g.comision += l.comision;
      g.liquidada = g.liquidada && l.liquidada;
    } else {
      grupos.set(clave, {
        clave, dia: l.dia, hora: l.hora, cliente: l.cliente, sinCita: !l.cita_id,
        lineas: [l], valor: l.valor, comision: l.comision, liquidada: l.liquidada,
      });
    }
  }
  return [...grupos.values()];
}

// ─── Liquidar ────────────────────────────────────────────────────────────────

/**
 * Total que se va a pagar si el dueño ajusta el básico: el del servidor con
 * el básico calculado cambiado por el escrito. Sin ajuste es el del servidor
 * tal cual. El definitivo lo devuelve /api/nomina/liquidar.
 */
export function totalConBasico(pend: Pick<Pendiente, "total" | "basico">, basico: number | null): number {
  if (!pend.basico || basico === null) return pend.total;
  return pend.total - pend.basico.monto + basico;
}

/** El básico escrito, para mandarlo como basicoManual solo si cambió. */
export function basicoManualDe(pend: Pick<Pendiente, "basico">, basico: number | null): number | null {
  if (!pend.basico || basico === null) return null;
  return Math.round(basico) === Math.round(pend.basico.monto) ? null : basico;
}
