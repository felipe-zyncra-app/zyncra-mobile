import { useCallback, useEffect, useState } from "react";
import { minutosDelDia } from "@/lib/tz";
import { useGuardRespuestas } from "@/lib/useRecarga";
import {
  cuposLibres, effectiveDayHours, generateSlotsForDay, MIN_LEAD_MIN, ocupacionDelDia, timeToMins,
  type DayHours, type HorarioNegocio, type Ocupado, type ProfesionalAgenda,
} from "@/lib/scheduling";
import type { EstadoCupos } from "./SelectorHora";

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
    const hd = effectiveDayHours(dia, horario, proSchedule);
    setError(null);
    if (!hd.open) {
      setEstado("cerrado");
      setCupos([]);
      setOcupadosGrilla([]);
      setBloqueos([]);
      return;
    }
    setEstado("cargando");
    try {
      const ocupados = await ocupacionDelDia({ tenantId, professionalId: proId, dia, excluirCitaId });
      if (!turno.vigente()) return;
      let grilla = generateSlotsForDay(hd, duracion, intervalo);
      if (dia === hoy) {
        // Al modificar una cita no se exige el margen: moverla un rato es normal.
        const desde = minutosDelDia(new Date(), timezone) + (excluirCitaId ? 0 : MIN_LEAD_MIN);
        grilla = grilla.filter(h => timeToMins(h) >= desde);
      }
      const libres = cuposLibres(grilla, ocupados, duracion);
      setCupos(libres);
      setOcupadosGrilla(grilla.filter(h => !libres.includes(h)));
      setBloqueos(ocupados.filter(o => o.tipo === "bloqueo"));
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
