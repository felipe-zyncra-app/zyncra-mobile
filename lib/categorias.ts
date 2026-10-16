/**
 * Orden del catálogo de servicios, igual que la página Servicios del web
 * (src/lib/category-order.ts): las categorías en el orden que guardó el
 * negocio (settings.categoryOrder), las nuevas después en orden alfabético y
 * "Sin categoría" al final; dentro de cada una, por `position` (como se
 * crearon o se movieron) y luego por nombre.
 */

export const SIN_CATEGORIA = "Sin categoría";

export function categoriaDe(s: { category?: string | null }): string {
  return s.category?.trim() || SIN_CATEGORIA;
}

/** Servicios en el orden del catálogo (planos: la categoría se lee con categoriaDe). */
export function ordenarPorCategoria<T extends { name: string; category?: string | null; position?: number | null }>(
  servicios: readonly T[],
  orden: readonly string[],
): T[] {
  const rango = new Map(orden.map((c, i) => [c, i]));
  const rangoDe = (c: string) => (c === SIN_CATEGORIA ? Number.MAX_SAFE_INTEGER : rango.get(c) ?? Number.MAX_SAFE_INTEGER - 1);
  return [...servicios].sort((a, b) => {
    const ca = categoriaDe(a), cb = categoriaDe(b);
    if (ca !== cb) return rangoDe(ca) - rangoDe(cb) || ca.localeCompare(cb, "es");
    return (a.position ?? 0) - (b.position ?? 0) || a.name.localeCompare(b.name, "es");
  });
}
