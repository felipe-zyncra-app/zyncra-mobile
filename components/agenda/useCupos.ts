import { useCallback, useEffect, useState } from "react";
import { minutosDelDia } from "@/lib/tz";
import { useGuardRespuestas } from "@/lib/useRecarga";
import {
  cuposLibres, effectiveDayHours, generateSlotsForDay, MIN_LEAD_MIN, ocupacionDelDia, timeToMins,
  type DayHours, type HorarioNegocio, type Ocupado, type ProfesionalAgenda,
} from "@/lib/scheduling";
import { unirCuposDelEquipo } from "@/lib/asignacion";
import type { EstadoCupos } from "./SelectorHora";

/** Grilla del día, cupos libres y ocupación de un profesional (para un día que atiende). */
async function calcularCupos(o: {
  tenantId: string;
  proId: string;
  proSchedule: unknown;
  duracion: number;
  dia: string;
  horario: HorarioNegocio;
  intervalo: number;
  excluirCitaId?: string | null;
  hoy: string;
  timezone: string;
}): Promise<{ grilla: string[]; libres: string[]; ocupados: Ocupado[] }> {
  const hd = effectiveDayHours(o.dia, o.horario, o.proSchedule);
  const ocupados = await ocupacionDelDia({ tenantId: o.tenantId, professionalId: o.proId, dia: o.dia, excluirCitaId: o.excluirCitaId });
  let grilla = generateSlotsForDay(hd, o.duracion, o.intervalo);
  if (o.dia === o.hoy) {
    // Al modificar una cita no se exige el margen: moverla un rato es normal.
    const desde = minutosDelDia(new Date(), o.timezone) + (o.excluirCitaId ? 0 : MIN_LEAD_MIN);
    grilla = grilla.filter(h => timeToMins(h) >= desde);
  }
  return { grilla, libres: cuposLibres(grilla, ocupados, o.duracion), ocupados };
}

/**
 * Cupos libres de un profesional en un día, para Nueva cita y Modificar cita
 * (antes cada modal tenía su copia de loadSlots/reloadSlots).
 *  · respeta el horario efectivo (profesional > negocio), el descanso, las
 *    citas del día Y los bloqueos (blocked_slots);
 *  · si la consulta falla queda en "error" sin cupos (no "todo libre");
 *  · hoy no ofrece horas que ya pasaron en la zona del negocio (en Nueva
 *    cita, tampoco las de los próximos MIN_LEAD_MIN minutos, como el web);
 *  · `ocupados` son los cupos de la grilla que chocan con una cita o un
 *    bloqueo: se muestran tachados, igual que el panel web, para que se vea
 *    que el día sí tiene horario y está lleno;
 *  · solo acepta la respuesta del último día pedido (cambiar de día rápido ya
 *    no pinta los cupos del día anterior).
 */
export function useCuposDelDia(p: {
  tenantId: string;
  profesional: ProfesionalAgenda | null;
  duracion: number | null;
  dia: string;
  horario: HorarioNegocio | null;
  intervalo: number;
  habilitado: boolean;
  excluirCitaId?: string | null;
  hoy: string;
  timezone: string;
}): {
  estado: EstadoCupos;
  error: unknown;
  cupos: string[];
  ocupados: string[];
  bloqueos: Ocupado[];
  horarioDia: DayHours | null;
  recargar: () => Promise<void>;
} {
  const { tenantId, profesional, duracion, dia, horario, intervalo, habilitado, excluirCitaId, hoy, timezone } = p;
  const guard = useGuardRespuestas();
  const [estado, setEstado] = useState<EstadoCupos>("cargando");
  const [error, setError] = useState<unknown>(null);
  const [cupos, setCupos] = useState<string[]>([]);
  const [ocupadosGrilla, setOcupadosGrilla] = useState<string[]>([]);
  const [bloqueos, setBloqueos] = useState<Ocupado[]>([]);

  const proId = profesional?.id ?? null;
  const proSchedule = profesional?.schedule;
  const horarioDia = proId && horario ? effectiveDayHours(dia, horario, proSchedule) : null;

  const recargar = useCallback(async () => {
    if (!habilitado || !proId || !duracion || !horario || !dia) return;
    const turno = guard.nuevo();
    setError(null);
    if (!effectiveDayHours(dia, horario, proSchedule).open) {
      setEstado("cerrado");
      setCupos([]);
      setOcupadosGrilla([]);
      setBloqueos([]);
      return;
    }
    setEstado("cargando");
    try {
      const r = await calcularCupos({ tenantId, proId, proSchedule, duracion, dia, horario, intervalo, excluirCitaId, hoy, timezone });
      if (!turno.vigente()) return;
      setCupos(r.libres);
      setOcupadosGrilla(r.grilla.filter(h => !r.libres.includes(h)));
      setBloqueos(r.ocupados.filter(o => o.tipo === "bloqueo"));
      setEstado("listo");
    } catch (e) {
      if (!turno.vigente()) return;
      setError(e);
      setCupos([]);
      setOcupadosGrilla([]);
      setBloqueos([]);
      setEstado("error");
    }
  }, [habilitado, proId, proSchedule, duracion, horario, dia, tenantId, excluirCitaId, intervalo, hoy, timezone, guard]);

  useEffect(() => { recargar(); }, [recargar]);

  return { estado, error, cupos, ocupados: ocupadosGrilla, bloqueos, horarioDia, recargar };
}

type CuposEquipo = { cupos: string[]; ocupados: string[]; bloqueos: Ocupado[]; libresPorHora: Record<string, string[]> };
const SIN_CUPOS: CuposEquipo = { cupos: [], ocupados: [], bloqueos: [], libresPorHora: {} };

/**
 * Cupos de TODO el equipo en un día, para "Al azar" en Nueva cita: una hora
 * se ofrece si al menos un profesional la tiene libre (`libresPorHora` dice
 * quiénes, para sortear entre ellos al guardar). Si la agenda de alguno no se
 * pudo leer queda en "error": ofrecer horas sin saber si están libres es
 * justo lo que AGE-X1 prohibió. Las ausencias de cada profesional no se
 * listan (serían de varias personas); sí los cierres de todo el negocio.
 */
export function useCuposDelEquipo(p: {
  tenantId: string;
  profesionales: ProfesionalAgenda[];
  duracion: number | null;
  dia: string;
  horario: HorarioNegocio | null;
  intervalo: number;
  habilitado: boolean;
  excluirCitaId?: string | null;
  hoy: string;
  timezone: string;
}): {
  estado: EstadoCupos;
  error: unknown;
  cupos: string[];
  ocupados: string[];
  bloqueos: Ocupado[];
  horarioDia: DayHours | null;
  libresPorHora: Record<string, string[]>;
  recargar: () => Promise<void>;
} {
  const { tenantId, profesionales, duracion, dia, horario, intervalo, habilitado, excluirCitaId, hoy, timezone } = p;
  const guard = useGuardRespuestas();
  const [estado, setEstado] = useState<EstadoCupos>("cargando");
  const [error, setError] = useState<unknown>(null);
  const [res, setRes] = useState<CuposEquipo>(SIN_CUPOS);

  // Horario del negocio ese día: sirve para los avisos de una hora puesta a mano.
  const horarioDia = horario ? effectiveDayHours(dia, horario, null) : null;

  const recargar = useCallback(async () => {
    if (!habilitado || profesionales.length === 0 || !duracion || !horario || !dia) return;
    const turno = guard.nuevo();
    setError(null);
    const abiertos = profesionales.filter(pro => effectiveDayHours(dia, horario, pro.schedule).open);
    if (abiertos.length === 0) {
      setEstado("cerrado");
      setRes(SIN_CUPOS);
      return;
    }
    setEstado("cargando");
    try {
      const porPro = await Promise.all(abiertos.map(async pro => ({
        pro,
        r: await calcularCupos({ tenantId, proId: pro.id, proSchedule: pro.schedule, duracion, dia, horario, intervalo, excluirCitaId, hoy, timezone }),
      })));
      if (!turno.vigente()) return;
      const u = unirCuposDelEquipo(porPro.map(({ pro, r }) => ({ proId: pro.id, cerrado: false, grilla: r.grilla, libres: r.libres })));
      const cierres = new Map<string, Ocupado>();
      for (const { r } of porPro) {
        for (const o of r.ocupados) if (o.tipo === "bloqueo" && !o.professionalId) cierres.set(o.id ?? `${o.inicio}-${o.fin}`, o);
      }
      setRes({ cupos: u.cupos, ocupados: u.ocupados, bloqueos: [...cierres.values()], libresPorHora: u.libresPorHora });
      setEstado("listo");
    } catch (e) {
      if (!turno.vigente()) return;
      setError(e);
      setRes(SIN_CUPOS);
      setEstado("error");
    }
  }, [habilitado, profesionales, duracion, horario, dia, tenantId, excluirCitaId, intervalo, hoy, timezone, guard]);

  useEffect(() => { recargar(); }, [recargar]);

  return { estado, error, ...res, horarioDia, recargar };
}
