import {
  avisosDeHorario, effectiveDayHours, verificarCupo,
  type HorarioNegocio, type ProfesionalAgenda,
} from "@/lib/scheduling";

/**
 * Asignar una cita a un profesional al azar (Nueva cita → "Al azar") y
 * cambiarla de profesional después (Detalle de cita → "Cambiar profesional").
 */

/** Copia barajada (Fisher–Yates). `azar` se inyecta en los tests. */
export function barajar<T>(lista: readonly T[], azar: () => number = Math.random): T[] {
  const out = [...lista];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(azar() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Cupos de un profesional en el día, como los calcula useCuposDelDia. */
export type CuposDeProfesional = { proId: string; cerrado: boolean; grilla: string[]; libres: string[] };

/**
 * Une los cupos de todo el equipo: una hora se ofrece si al menos un
 * profesional la tiene libre, y se recuerda quiénes, para sortear entre ellos
 * al guardar. Las horas de la grilla que nadie tiene libres van en `ocupados`.
 */
export function unirCuposDelEquipo(porPro: CuposDeProfesional[]): {
  cerrado: boolean;
  cupos: string[];
  ocupados: string[];
  libresPorHora: Record<string, string[]>;
} {
  const libresPorHora: Record<string, string[]> = {};
  const grilla = new Set<string>();
  for (const p of porPro) {
    if (p.cerrado) continue;
    p.grilla.forEach(h => grilla.add(h));
    for (const h of p.libres) (libresPorHora[h] ??= []).push(p.proId);
  }
  const cupos = Object.keys(libresPorHora).sort();
  const ocupados = [...grilla].filter(h => !libresPorHora[h]).sort();
  return { cerrado: porPro.every(p => p.cerrado), cupos, ocupados, libresPorHora };
}

/**
 * Qué tan disponible está un profesional para una cita ya fijada:
 *  · libre: la puede tomar;
 *  · aviso: se puede, confirmando (otra cita a la misma hora, o fuera de su
 *    horario), igual que al agendar a mano;
 *  · bloqueado: tiene una ausencia o el negocio está cerrado.
 */
export type Disponibilidad =
  | { estado: "libre" }
  | { estado: "aviso"; motivo: string; conCita: boolean }
  | { estado: "bloqueado"; motivo: string };

export async function disponibilidadDe(o: {
  tenantId: string;
  pro: ProfesionalAgenda;
  dia: string;
  hora: string;
  duracion: number;
  horario: HorarioNegocio | null;
  excluirCitaId?: string | null;
}): Promise<Disponibilidad> {
  const v = await verificarCupo({
    tenantId: o.tenantId, professionalId: o.pro.id, dia: o.dia, hora: o.hora,
    duracion: o.duracion, excluirCitaId: o.excluirCitaId,
  });
  if (!v.ok && !v.conCita) return { estado: "bloqueado", motivo: v.motivo };
  const fuera = o.horario ? avisosDeHorario(effectiveDayHours(o.dia, o.horario, o.pro.schedule), o.hora, o.duracion) : [];
  const motivos = [...(v.ok ? [] : [v.motivo]), ...fuera];
  if (motivos.length === 0) return { estado: "libre" };
  return { estado: "aviso", motivo: motivos.join(" "), conCita: !v.ok };
}

/**
 * Sortea un profesional para la hora elegida. Primero entre los que la tienen
 * libre según la grilla; cada candidato se re-verifica contra la base (el cupo
 * pudo ocuparse mientras se llenaba el formulario). Si ninguno sirve, null.
 */
export async function sortearProfesional(o: {
  tenantId: string;
  candidatos: ProfesionalAgenda[];
  dia: string;
  hora: string;
  duracion: number;
  horario: HorarioNegocio | null;
  excluirCitaId?: string | null;
  azar?: () => number;
}): Promise<ProfesionalAgenda | null> {
  for (const pro of barajar(o.candidatos, o.azar)) {
    const d = await disponibilidadDe({ ...o, pro });
    if (d.estado === "libre") return pro;
  }
  return null;
}
