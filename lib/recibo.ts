import { fmtMoneyFull } from "./format";

/**
 * Recibo de pago por WhatsApp (wa.me): mismo formato que el POS web, con el
 * descuento (DIN-19). Lo usan la pantalla de éxito de la hoja de cobro y el
 * detalle de un cobro ya registrado.
 */

export type DatosRecibo = {
  clientName: string | null;
  items: { name: string; qty: number; price: number }[];
  subtotal: number;
  discount: number;
  total: number;
  /** "Efectivo", o "Efectivo + Nequi" en un pago dividido. */
  methodLabel: string;
};

export function textoRecibo(negocio: string, d: DatosRecibo): string {
  const lines: string[] = [];
  lines.push(`*${negocio}* · Recibo de pago`);
  lines.push("");
  lines.push(`Hola${d.clientName ? ` ${d.clientName.split(" ")[0]}` : ""} 👋 gracias por tu visita.`);
  lines.push("");
  for (const it of d.items) lines.push(`• ${it.name}${it.qty > 1 ? ` × ${it.qty}` : ""} — ${fmtMoneyFull(it.price * it.qty)}`);
  if (d.discount > 0) {
    lines.push("");
    lines.push(`Subtotal: ${fmtMoneyFull(d.subtotal)}`);
    lines.push(`Descuento: −${fmtMoneyFull(d.discount)}`);
  }
  lines.push("");
  lines.push(`*Total: ${fmtMoneyFull(d.total)}* (${d.methodLabel})`);
  lines.push("");
  lines.push("¡Te esperamos pronto!");
  return lines.join("\n");
}

/** Lo que la hoja de cobro guarda como nota cuando no se escribe una: "2× Corte + Barba". */
export function nombresDeItems(items: readonly { name: string; quantity?: number | null; qty?: number | null }[]): string {
  return items
    .map(i => {
      const n = Number(i.quantity ?? i.qty ?? 1) || 1;
      return n > 1 ? `${n}× ${i.name}` : i.name;
    })
    .join(" + ");
}
