/**
 * Adicionales con valor libre al agendar (2026-10-16): lo que no está en la
 * carta, como arreglar solo dos uñas. Se guardan como appointment_services
 * sin service_id (nombre + precio), los mismos que ya cobra la hoja de cobro
 * y suma la nómina; su tiempo va en appointments.duration_minutes.
 */

export type Adicional = { key: string; nombre: string; precio: number; duracion: number };

export const DURACIONES_ADICIONAL = [15, 30, 45, 60, 90];

/** Minutos que ocupa la cita: el servicio de la carta (si hay) más los adicionales. */
export function duracionConAdicionales(servicio: number | null, adicionales: readonly Adicional[]): number {
  return (servicio ?? 0) + adicionales.reduce((s, a) => s + a.duracion, 0);
}

/** Valor de la cita: el servicio de la carta (si hay) más los adicionales. */
export function precioConAdicionales(servicio: number | null, adicionales: readonly Adicional[]): number {
  return (servicio ?? 0) + adicionales.reduce((s, a) => s + a.precio, 0);
}

/** ¿Se puede agregar? Nombre de al menos 2 letras, valor >= 0 y una duración. */
export function adicionalValido(a: { nombre: string; precio: number | null; duracion: number }): boolean {
  return a.nombre.trim().length >= 2 && a.precio !== null && a.precio >= 0 && a.duracion > 0;
}

/**
 * Nombre para mostrar una cita: su servicio de la carta y, si no tiene, el
 * primer adicional ("Arreglo 2 uñas"), con "+N" si hay más.
 */
export function nombreDeCita(a: {
  services?: { name?: string | null } | null;
  appointment_services?: { name?: string | null }[] | null;
} | null | undefined): string | null {
  const extras = (a?.appointment_services ?? []).map(x => x?.name?.trim()).filter((x): x is string => !!x);
  const base = a?.services?.name?.trim();
  if (base) return base;
  if (extras.length === 0) return null;
  return extras.length > 1 ? `${extras[0]} +${extras.length - 1}` : extras[0];
}
