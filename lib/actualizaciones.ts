/**
 * Actualizaciones al aire (expo-updates): qué versión corre la app y cuándo
 * ofrecer la nueva. Solo cuentas, sin importar expo-updates, para probarlas
 * con Jest; AvisoActualizacion y Ajustes le pasan lo que lee el módulo.
 *
 * Contexto (22-oct-2026): la app de la tienda es la 1.2.6 y todo lo de octubre
 * llegó por `eas update`, pero la app aplicaba lo descargado solo en el
 * SIGUIENTE arranque y Ajustes decía "v1.2.6" igual antes y después: el dueño
 * no veía los cambios ni tenía cómo saber si ya los tenía.
 */

export interface EstadoVersion {
  /** Constants.expoConfig.version (la de la tienda). */
  version: string;
  /** Updates.isEnabled y no es desarrollo: hay actualizaciones al aire. */
  habilitado: boolean;
  /** Updates.isEmbeddedLaunch: corre el código que vino con la build de la tienda. */
  embebida: boolean;
  /** Updates.createdAt: cuándo se publicó lo que está corriendo. */
  creada: Date | null;
  /** Updates.updateId: cuál actualización corre. */
  updateId: string | null;
}

/** "21 oct, 7:09 p. m." en la zona del teléfono (la hora en que se publicó, para cotejar con quien publicó). */
export function fechaCorta(d: Date): string {
  const dia = d.toLocaleDateString("es-CO", { day: "numeric", month: "short" }).replace(".", "");
  const hora = d.toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" });
  return `${dia}, ${hora}`;
}

/** Segunda línea del pie de Ajustes: qué código está corriendo. */
export function textoVersion(e: EstadoVersion): string {
  if (!e.habilitado) return "Sin actualizaciones automáticas";
  if (e.embebida || !e.creada) return "Versión de la tienda, sin actualizaciones descargadas";
  const id = e.updateId ? ` · ${e.updateId.slice(0, 8)}` : "";
  return `Actualizada el ${fechaCorta(e.creada)}${id}`;
}

/**
 * ¿Ofrecer la actualización descargada? Una vez por actualización en cada
 * arranque: si el dueño dijo "Luego", no se insiste (se aplica sola en el
 * siguiente arranque, como siempre).
 */
export function debeAvisar(args: { pendiente: boolean; idDescargada: string | null | undefined; yaAvisada: string | null }): boolean {
  if (!args.pendiente) return false;
  const id = args.idDescargada ?? "rollback";
  return id !== args.yaAvisada;
}

/** Revisar el servidor como mucho cada tantos minutos (al arrancar y al volver a primer plano). */
export function sePuedeRevisar(ultima: number | null, ahora: number, minutos = 5): boolean {
  return ultima === null || ahora - ultima >= minutos * 60_000;
}
