/**
 * Reglas de sede para inventario y caja — espejo del panel web (auditoría
 * #11-#13, 29-sep: inventario/page.tsx, pos/page.tsx y finanzas/TabCaja.tsx).
 *
 * location_id NULL = registro "general": los productos, movimientos y cajas
 * de antes del 29-sep se guardaban sin sede, y así cuentan en todas.
 */

/**
 * Filtro PostgREST (para `.or(...)`) con los registros de la sede más los
 * generales. Solo con `.eq` los productos viejos sin sede desaparecían de la
 * lista de la sede al recargar.
 */
export function filtroSedeOGeneral(locationId: string): string {
  return `location_id.eq.${locationId},location_id.is.null`;
}

/**
 * Sede de un movimiento de stock: la del producto (dueña del stock) y, si es
 * un producto viejo sin sede, la de respaldo (la de la venta o la activa).
 * Sin location_id el movimiento no salía en "Movimientos" de la sede y la RLS
 * del admin de sede lo rechazaba.
 */
export function sedeDeStock(sedeProducto: string | null | undefined, respaldo: string | null | undefined): string | null {
  return sedeProducto ?? respaldo ?? null;
}

/**
 * ¿Un movimiento traído con `filtroSedeOGeneral` es de la sede activa? Los
 * movimientos sin sede se muestran en la sede de SU producto; si el producto
 * tampoco tiene sede, en todas.
 */
export function movimientoEnSede(
  m: { location_id?: string | null; products?: { location_id?: string | null } | null },
  locationId: string | null,
): boolean {
  if (!locationId || m.location_id === locationId) return true;
  if (m.location_id) return false;
  const sedeProducto = m.products?.location_id ?? null;
  return !sedeProducto || sedeProducto === locationId;
}

/**
 * ¿La caja general (location_id NULL) cuenta como de la sede activa? Solo en
 * un negocio de una sola sede: ahí todas sus cajas viejas se abrieron sin
 * sede y, filtrando por la sede, una caja general abierta ya no se podía
 * cerrar y el historial quedaba vacío (web TabCaja, revisión 2026-09-29).
 */
export function incluyeCajaGeneral(locationId: string | null, numSedes: number): boolean {
  return !!locationId && numSedes <= 1;
}

/**
 * De las cajas abiertas del alcance (con la general incluida puede haber dos:
 * la vieja sin sede y la de la sede), primero la de la sede, que es la que usa el POS.
 */
export function preferirCajaDeSede<T extends { location_id: string | null }>(lista: readonly T[], locationId: string | null): T | null {
  return lista.find(c => c.location_id === locationId) ?? lista[0] ?? null;
}
