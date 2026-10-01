import { monedaActiva } from "./format";

/**
 * Cálculos de dinero compartidos por Caja, Finanzas, POS, Historial de cobros,
 * la hoja de cobro y Facturación. Son funciones puras (se prueban en
 * lib/__tests__/dinero-test.ts).
 */

// ─── Montos escritos a mano (DIN-18) ─────────────────────────────────────────
// Antes todas las pantallas hacían parseFloat(s.replace(/\./g, "").replace(",", ".")):
// en un iPhone con región EE. UU. el teclado trae ".", así que un descuento de
// "12.5" % se leía 125 (se acotaba a 100 y el cobro quedaba en $0) y un ítem
// libre "50,000" entraba como $50.

/** Monedas que se manejan sin centavos (el peso colombiano, entre otras). */
const SIN_DECIMALES = new Set(["COP", "CLP", "PYG", "JPY", "KRW", "VND", "ISK", "UGX", "XAF", "XOF"]);

/** true si la moneda (por defecto la del negocio) no usa centavos. */
export function monedaSinDecimales(currency: string = monedaActiva().currency): boolean {
  return SIN_DECIMALES.has((currency ?? "").toUpperCase());
}

/**
 * Lee un monto. Devuelve null si no hay ningún dígito (para validar "monto
 * obligatorio").
 *  · Sin centavos (COP): solo cuentan los dígitos. "50.000", "50,000" y
 *    "$ 50 000" son 50000.
 *  · Con centavos: el ÚLTIMO separador ("," o ".") es el decimal si lo siguen
 *    1 o 2 dígitos; los demás son de miles. "1.234,5" → 1234.5, "12.50" → 12.5,
 *    "1,234" → 1234.
 */
export function leerMonto(texto: string | null | undefined, opciones: { decimales?: boolean } = {}): number | null {
  const s = String(texto ?? "").trim();
  if (!/\d/.test(s)) return null;
  const decimales = opciones.decimales ?? !monedaSinDecimales();
  if (!decimales) return Number(s.replace(/\D/g, "")) || 0;

  const limpio = s.replace(/[^\d.,]/g, "");
  const m = /[.,](\d{1,2})$/.exec(limpio);
  if (m) {
    const entero = limpio.slice(0, limpio.length - m[0].length).replace(/\D/g, "");
    return Number(`${entero || "0"}.${m[1]}`) || 0;
  }
  return Number(limpio.replace(/\D/g, "")) || 0;
}

/** Como leerMonto, pero 0 cuando no hay dígitos. */
export function parseMonto(texto: string | null | undefined, opciones: { decimales?: boolean } = {}): number {
  return leerMonto(texto, opciones) ?? 0;
}

/** Porcentaje entre 0 y 100. Acepta "," o "." como decimal: "12,5" y "12.5" son 12.5. */
export function parsePorcentaje(texto: string | null | undefined): number {
  const s = String(texto ?? "").replace(",", ".").replace(/[^\d.]/g, "");
  const partes = s.split(".");
  const n = Number(partes.length > 1 ? `${partes[0]}.${partes.slice(1).join("")}` : partes[0]);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, 100);
}

/**
 * Un monto como texto para un campo editable, que leerMonto vuelve a leer
 * igual: sin centavos "40000"; con centavos "12.50" o "12".
 */
export function montoATexto(n: number, opciones: { decimales?: boolean } = {}): string {
  const decimales = opciones.decimales ?? !monedaSinDecimales();
  if (!Number.isFinite(n) || n <= 0) return "";
  return decimales ? n.toFixed(2).replace(/\.00$/, "") : String(Math.round(n));
}

/**
 * Con qué suele pagar un cliente en efectivo, para los atajos de "Recibe" en
 * la hoja de cobro: el total redondeado hacia arriba a 5, 10, 20, 50 y 100
 * (en miles si la moneda no usa centavos, como el peso), sin repetir y solo
 * los que superan el total. "Exacto" va aparte.
 *   $35.000 → $40.000, $50.000, $100.000
 */
export function sugerenciasEfectivo(total: number, opciones: { decimales?: boolean; max?: number } = {}): number[] {
  if (!Number.isFinite(total) || total <= 0) return [];
  const unidad = (opciones.decimales ?? !monedaSinDecimales()) ? 1 : 1000;
  const out: number[] = [];
  for (const billete of [5, 10, 20, 50, 100]) {
    const paso = billete * unidad;
    const v = Math.ceil(total / paso) * paso;
    if (v > total && !out.includes(v)) out.push(v);
  }
  return out.sort((a, b) => a - b).slice(0, opciones.max ?? 3);
}

// ─── Caja ────────────────────────────────────────────────────────────────────

export type MovimientoCaja = {
  type: string;
  amount: number | string;
  payment_method?: string | null;
  category?: string | null;
  description?: string | null;
  pos_sale_id?: string | null;
  layaway_payment_id?: string | null;
};

export type TotalesCaja = {
  ingresos: number;
  egresos: number;
  /** Ingresos que entran al cajón (efectivo, o sin método: movimientos manuales). */
  ingresosEfectivo: number;
  /** Nequi, tarjeta, QR…: no están en el cajón. */
  ingresosElectronicos: number;
  /** Fondo + ingresos − egresos (todo lo movido, en cualquier medio). */
  balance: number;
  /** Lo que debe haber físicamente en el cajón: contra esto se hace el arqueo. */
  efectivoEsperado: number;
};

/** Efectivo = método "efectivo" o sin método (los movimientos manuales de Caja). */
export function esEfectivo(m: Pick<MovimientoCaja, "payment_method">): boolean {
  return !m.payment_method || m.payment_method === "efectivo";
}

export function totalesCaja(movimientos: readonly MovimientoCaja[], apertura: number | string | null | undefined): TotalesCaja {
  const fondo = Number(apertura) || 0;
  let ingresos = 0, egresos = 0, ingresosEfectivo = 0;
  for (const m of movimientos) {
    const monto = Number(m.amount) || 0;
    if (m.type === "ingreso") {
      ingresos += monto;
      if (esEfectivo(m)) ingresosEfectivo += monto;
    } else if (m.type === "egreso") {
      egresos += monto;
    }
  }
  return {
    ingresos,
    egresos,
    ingresosEfectivo,
    ingresosElectronicos: ingresos - ingresosEfectivo,
    balance: fondo + ingresos - egresos,
    efectivoEsperado: fondo + ingresosEfectivo - egresos,
  };
}

/**
 * Ingreso "Venta POS" cuya venta ya no existe (DIN-X1). cash_movements.pos_sale_id
 * es ON DELETE SET NULL: una anulación hecha en el web (o un script de
 * limpieza) borra la venta y deja el ingreso, que la Caja seguía sumando al
 * arqueo. Los egresos "Anulación · …" que registra voidSale no cuentan: son
 * del tipo contrario y su texto empieza distinto.
 */
export function esIngresoHuerfano(m: MovimientoCaja): boolean {
  return m.type === "ingreso"
    && m.category === "POS"
    && !m.pos_sale_id
    && !m.layaway_payment_id
    && /^Venta POS/.test(m.description ?? "");
}

// ─── Ventas ──────────────────────────────────────────────────────────────────

export type ItemVenta = {
  name?: string | null;
  price?: number | string | null;
  quantity?: number | string | null;
  item_type?: string | null;
  services?: { name?: string | null } | null;
};

/** Nombre visible de un ítem: el del servicio si sigue existiendo, si no el guardado en la venta. */
export function nombreItem(i: ItemVenta): string {
  return i.services?.name || i.name || "Sin nombre";
}

/**
 * Ranking de lo más vendido (DIN-01 / DIN-24). La columna es pos_sale_items.price
 * (unit_price no existe). Productos e ítems libres se nombran por su propio
 * `name` en vez de caer todos en "Sin nombre", y un producto no se mezcla con
 * un servicio que se llame igual.
 */
export function agruparPorItem(
  ventas: readonly { pos_sale_items?: readonly ItemVenta[] | null }[],
  max = 6,
): { name: string; esProducto: boolean; val: number; pct: number }[] {
  const totales = new Map<string, { name: string; esProducto: boolean; val: number }>();
  for (const v of ventas) {
    for (const i of v.pos_sale_items ?? []) {
      // Una propina no es algo que el negocio vendió: es del profesional y va
      // a su nómina. Sin esto, "Propina · Ana" salía entre lo más vendido.
      if (i.item_type === "tip") continue;
      const esProducto = i.item_type === "product";
      const name = nombreItem(i);
      const clave = `${esProducto ? "p" : "s"}:${name}`;
      const val = (Number(i.quantity) || 0) * (Number(i.price) || 0);
      const previo = totales.get(clave);
      if (previo) previo.val += val;
      else totales.set(clave, { name, esProducto, val });
    }
  }
  const orden = Array.from(totales.values()).filter(x => x.val > 0).sort((a, b) => b.val - a.val).slice(0, max);
  const tope = orden[0]?.val || 1;
  return orden.map(x => ({ ...x, pct: Math.round((x.val / tope) * 100) }));
}

// ─── Facturación ─────────────────────────────────────────────────────────────

/** Método de pago del POS → código de medio de pago de la DIAN (Factus). */
export function metodoAFactus(metodo: string | null | undefined): string {
  switch (metodo) {
    case "efectivo":      return "10";
    case "tarjeta":       return "49";
    case "transferencia": return "47";
    case "nequi":
    case "daviplata":
    case "qr":            return "42";
    default:              return "10";
  }
}

/**
 * Reparte un descuento de la venta entre los precios unitarios, para que la
 * factura sume lo que se cobró. Devuelve los precios nuevos (enteros) y lo que
 * no se pudo cuadrar por redondeo (0 casi siempre).
 */
export function prorratearPrecios(
  items: readonly { price: number; quantity: number }[],
  total: number,
): { precios: number[]; diferencia: number } {
  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
  if (subtotal <= 0 || total >= subtotal || total < 0) {
    return { precios: items.map(i => Math.round(i.price)), diferencia: Math.round(total - subtotal) };
  }
  const factor = total / subtotal;
  const precios = items.map(i => Math.round(i.price * factor));
  let suma = precios.reduce((s, p, k) => s + p * items[k].quantity, 0);
  // El redondeo se corrige en el primer ítem de cantidad 1 (si lo hay).
  const k1 = items.findIndex(i => i.quantity === 1);
  if (k1 >= 0 && suma !== Math.round(total)) {
    precios[k1] += Math.round(total) - suma;
    suma = Math.round(total);
  }
  return { precios, diferencia: Math.round(total) - suma };
}
