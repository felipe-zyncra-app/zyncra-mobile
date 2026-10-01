import type { SaleItemInput } from "./record-sale";

/**
 * Propinas y vendedores en el cobro, para que lleguen solos a la nómina —
 * espejo del POS, la Caja y la factura del panel web (commit de Nómina,
 * 2df070c) y de la migración 20261001_nomina:
 *
 *   · Propina en una venta: una línea con item_type 'tip', nombre
 *     "Propina · <profesional>" y professional_id = quien la recibe. Entra a
 *     caja con el pago como cualquier línea y el trigger
 *     nomina_propina_de_venta la vuelve una novedad de su nómina.
 *   · La propina NO se descuenta: el descuento sale de lo demás (el cálculo
 *     de nómina del servidor reparte el descuento solo entre esas líneas).
 *   · La propina NO va en la factura electrónica: no es una venta del negocio.
 *   · Quién vendió un producto: pos_sale_items.professional_id. null = el
 *     profesional de la cita (lo de siempre).
 *   · Propina en Caja: ingreso de categoría "Propina" con
 *     cash_movements.professional_id (vacío = para el negocio, no va a
 *     nómina); la novedad la crea el trigger nomina_propina_de_caja.
 *
 * Funciones puras: se prueban en lib/__tests__/propinas-test.ts.
 */

export const TIPO_PROPINA = "tip";
export const CATEGORIA_PROPINA = "Propina";

export type Profesional = { id: string; name: string };

/** Lo que la hoja de cobro lleva en el carrito (components/ChargeSheet). */
export type LineaCarrito = {
  key: string;
  serviceId: string | null;
  productId: string | null;
  itemType: "service" | "product" | "free" | "tip";
  name: string;
  price: number;
  qty: number;
  unitCost?: number | null;
  /** Stock disponible (productos): tope de cantidad en el carrito. */
  maxQty?: number;
  /** Sede del producto: su salida de stock va a esa sede, no a la de la pantalla. */
  locationId?: string | null;
  /** Quién vendió el producto o recibe la propina. null = el profesional de la cita. */
  professionalId?: string | null;
};

/** true si la línea es una propina (en el carrito o ya guardada en la venta). */
export function esPropina(i: { item_type?: string | null; itemType?: string | null }): boolean {
  return (i.item_type ?? i.itemType) === TIPO_PROPINA;
}

/** Nombre de la línea, igual que el POS web: "Propina · Ana". */
export function nombrePropina(profesional: string): string {
  const n = profesional.trim();
  return n ? `Propina · ${n}` : "Propina";
}

/**
 * La línea de propina para el carrito. Una por persona (la clave lleva su
 * id): agregarPropina suma a la que ya haya en vez de repetirla.
 */
export function lineaPropina(pro: Profesional, monto: number): LineaCarrito {
  return {
    key: `tip-${pro.id}`, serviceId: null, productId: null, itemType: "tip",
    name: nombrePropina(pro.name), price: monto, qty: 1, professionalId: pro.id,
  };
}

/** Agrega la propina al carrito; si esa persona ya tiene una, se suman (dos "Propina · Ana" se leían como un error). */
export function agregarPropina<T extends { key: string; price: number }>(cart: readonly T[], linea: T): T[] {
  const ya = cart.find(i => i.key === linea.key);
  return ya
    ? cart.map(i => (i === ya ? { ...i, price: i.price + linea.price } : i))
    : [...cart, linea];
}

/** El carrito como ítems de recordSale: el ítem libre va como servicio (igual que el web). */
export function itemsDeVenta(cart: readonly LineaCarrito[]): SaleItemInput[] {
  return cart.map(i => ({
    name: i.name, price: i.price, quantity: i.qty,
    service_id: i.itemType === "service" ? i.serviceId : null,
    product_id: i.itemType === "product" ? i.productId : null,
    item_type: i.itemType === "product" ? "product" : i.itemType === "tip" ? "tip" : "service",
    unit_cost: i.unitCost ?? null,
    location_id: i.locationId ?? null,
    // Solo el producto (quién lo vendió) y la propina (quién la recibe) lo
    // llevan; en un servicio, null = quien atendió la cita.
    professional_id: i.itemType === "product" || i.itemType === "tip" ? i.professionalId ?? null : null,
  }));
}

// ─── Totales del cobro ───────────────────────────────────────────────────────

export type LineaConPrecio = { price: number; quantity?: number; qty?: number; item_type?: string | null; itemType?: string | null };

export type TotalesCobro = {
  /** Todo lo del carrito, propinas incluidas. */
  subtotal: number;
  propinas: number;
  /** Sobre esto se calcula el descuento: el subtotal sin propinas. */
  baseDescuento: number;
  /** Sin redondear, como lo mostraba la hoja de cobro. */
  descuento: number;
  /** Lo que se cobra (con la propina), redondeado. */
  total: number;
};

/**
 * Misma fórmula que el POS web: el descuento (% o fijo, con tope en la base)
 * sale del subtotal SIN propinas, y el total sí las incluye, así que el pago
 * (y el pago dividido) cubre también la propina.
 */
export function totalesCobro(
  lineas: readonly LineaConPrecio[],
  descuento: { tipo: "percentage" | "fixed"; valor: number },
): TotalesCobro {
  let subtotal = 0, propinas = 0;
  for (const l of lineas) {
    const v = (Number(l.price) || 0) * (Number(l.quantity ?? l.qty ?? 1) || 0);
    subtotal += v;
    if (esPropina(l)) propinas += v;
  }
  const baseDescuento = Math.max(subtotal - propinas, 0);
  const valor = Number.isFinite(descuento.valor) && descuento.valor > 0 ? descuento.valor : 0;
  const desc = descuento.tipo === "percentage"
    ? (baseDescuento * Math.min(valor, 100)) / 100
    : Math.min(valor, baseDescuento);
  return { subtotal, propinas, baseDescuento, descuento: desc, total: Math.max(Math.round(subtotal - desc), 0) };
}

// ─── Equipo ──────────────────────────────────────────────────────────────────

/**
 * Opciones de "¿Para quién?": primero el profesional de la cita (lo normal),
 * luego el resto del equipo activo. Si el de la cita ya no está activo,
 * igual aparece: la propina sigue siendo suya.
 */
export function equipoConCita(equipo: readonly Profesional[], deLaCita: Profesional | null): Profesional[] {
  if (!deLaCita) return [...equipo];
  return [deLaCita, ...equipo.filter(p => p.id !== deLaCita.id)];
}

/** "Vendió: …" debajo de un producto del carrito. */
export function etiquetaVendedor(
  professionalId: string | null | undefined,
  equipo: readonly Profesional[],
  deLaCita: Profesional | null,
): string {
  if (professionalId) {
    const p = equipo.find(x => x.id === professionalId) ?? (deLaCita?.id === professionalId ? deLaCita : null);
    if (p) return `Vendió: ${p.name}`;
  }
  return deLaCita ? `Vendió: ${deLaCita.name} (la cita)` : "Vendió: sin asignar";
}

/** Tras cobrar: "La propina queda en la nómina de Ana." (null sin propinas). */
export function textoPropinaCobrada(
  lineas: readonly { professionalId?: string | null }[],
  equipo: readonly Profesional[],
): string | null {
  if (lineas.length === 0) return null;
  const nombres = Array.from(new Set(lineas
    .map(l => equipo.find(p => p.id === l.professionalId)?.name)
    .filter((n): n is string => !!n)));
  const quien = nombres.length === 0 ? "quien la recibe"
    : nombres.length === 1 ? nombres[0]
    : `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
  return lineas.length === 1
    ? `La propina queda en la nómina de ${quien}.`
    : `Las propinas quedan en la nómina de ${nombres.length === 0 ? "quienes las reciben" : quien}.`;
}

/** Un ítem libre que en realidad es una propina (la costumbre de antes). */
export function pareceUnaPropina(concepto: string): boolean {
  return /propina/i.test(concepto);
}

// ─── Factura ─────────────────────────────────────────────────────────────────

/**
 * Lo que va en la factura electrónica de un cobro: sus líneas sin las
 * propinas y el total sin ellas (sobre ese total se reparte el descuento).
 */
export function paraFacturar<T extends { price: number; quantity: number; item_type?: string | null }>(
  items: readonly T[],
  total: number,
): { items: T[]; total: number; propinas: number } {
  const propinas = items.filter(i => esPropina(i)).reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.quantity) || 0), 0);
  return {
    items: items.filter(i => !esPropina(i)),
    total: Math.max((Number(total) || 0) - propinas, 0),
    propinas,
  };
}

// ─── Caja ────────────────────────────────────────────────────────────────────

/**
 * cash_movements.professional_id de un movimiento manual: solo un ingreso
 * "Propina" con alguien elegido lo lleva (vacío = para el negocio).
 */
export function profesionalDeMovimiento(tipo: string, categoria: string | null | undefined, para: string | null | undefined): string | null {
  return tipo === "ingreso" && categoria === CATEGORIA_PROPINA && para ? para : null;
}
