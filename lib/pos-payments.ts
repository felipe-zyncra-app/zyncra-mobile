/**
 * Desglose de pago de una venta POS, para reportes que agrupan por método.
 *
 * Espejo de src/lib/pos-payments.ts del web — mantener ambos en sync.
 *
 * Una venta con pago dividido guarda payment_method = "mixto" y el detalle real
 * en `payments` ([{method, amount}, ...]). Para que Finanzas sume por método,
 * hay que EXPANDIR ese desglose en vez de contar la venta como "mixto".
 */

export interface PaymentLine { method: string; amount: number }

export function salePaymentLines(sale: {
  payment_method?: string | null;
  total?: number | null;
  payments?: PaymentLine[] | null;
}): PaymentLine[] {
  const p = sale.payments;
  if (Array.isArray(p) && p.length > 0) {
    return p.map(x => ({ method: x.method, amount: Number(x.amount) || 0 }));
  }
  return [{ method: sale.payment_method || "otro", amount: Number(sale.total) || 0 }];
}

/** ¿La venta incluye este método de pago? (considera el desglose dividido) */
export function saleUsesMethod(
  sale: { payment_method?: string | null; total?: number | null; payments?: PaymentLine[] | null },
  method: string,
): boolean {
  return salePaymentLines(sale).some(l => l.method === method);
}
