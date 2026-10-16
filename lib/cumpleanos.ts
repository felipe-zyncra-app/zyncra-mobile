/**
 * Cumpleaños del cliente: se pide solo mes y día.
 *
 * La columna `clients.birthday` es `date` (la comparte el web), así que se
 * guarda con un año de relleno. Se usa 2000 porque es bisiesto: el 29 de
 * febrero es una fecha válida. Si la ficha ya traía un año real (clientes
 * cargados antes, o desde el web), al editar se conserva ese año.
 */

export const ANIO_SIN_ANIO = 2000;

export const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

export type MesDia = { mes: number; dia: number };

/** Días que puede tener el mes (febrero: 29, para no dejar por fuera a nadie). */
export function diasDelMes(mes: number): number {
  return new Date(Date.UTC(ANIO_SIN_ANIO, mes, 0)).getUTCDate();
}

/** Lee 'YYYY-MM-DD' (o con hora detrás). null si no es una fecha real. */
export function leerCumple(valor: string | null | undefined): (MesDia & { anio: number }) | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((valor ?? "").trim());
  if (!m) return null;
  const anio = Number(m[1]), mes = Number(m[2]), dia = Number(m[3]);
  if (mes < 1 || mes > 12 || dia < 1) return null;
  const dt = new Date(Date.UTC(anio, mes - 1, dia));
  if (dt.getUTCFullYear() !== anio || dt.getUTCMonth() !== mes - 1 || dt.getUTCDate() !== dia) return null;
  return { anio, mes, dia };
}

/**
 * Valor para guardar. Conserva el año que ya tenía la ficha si con él la
 * fecha existe (29 de febrero en un año no bisiesto cae al año de relleno).
 */
export function cumpleParaGuardar(md: MesDia | null, anterior?: string | null): string | null {
  if (!md) return null;
  if (md.mes < 1 || md.mes > 12 || md.dia < 1 || md.dia > diasDelMes(md.mes)) return null;
  const previo = leerCumple(anterior);
  const mm = String(md.mes).padStart(2, "0");
  const dd = String(md.dia).padStart(2, "0");
  if (previo && previo.anio !== ANIO_SIN_ANIO && leerCumple(`${previo.anio}-${mm}-${dd}`)) {
    return `${previo.anio}-${mm}-${dd}`;
  }
  return `${ANIO_SIN_ANIO}-${mm}-${dd}`;
}

/** "24 de junio". */
export function fmtCumple(md: MesDia): string {
  return `${md.dia} de ${MESES[md.mes - 1].toLowerCase()}`;
}
