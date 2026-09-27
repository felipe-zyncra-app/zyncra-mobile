import {
  ventasDe, cobradoDe, estaCobrada, precioDeLista, lineasDePago, desglosePorMedio, rangoDeHoras, horaDe,
} from "@/lib/ingresos";

// Ingresos = solo lo cobrado (D10), ventas embebidas en la cita y medios de
// pago con los pagos divididos expandidos (DIN-14).
describe("lib/ingresos", () => {
  test("una cita completada sin venta no es ingreso", () => {
    const sinVenta = { status: "completed", services: { price: 30000 }, pos_sales: [] };
    expect(estaCobrada(sinVenta)).toBe(false);
    expect(cobradoDe(sinVenta)).toBe(0);
    // El precio de lista solo sirve para "por cobrar".
    expect(precioDeLista(sinVenta)).toBe(30000);
  });

  test("lo cobrado manda sobre el precio de lista y dos ventas se suman", () => {
    const cita = { services: { price: 30000 }, pos_sales: [{ total: 45000 }, { total: "5000" }] };
    expect(estaCobrada(cita)).toBe(true);
    expect(cobradoDe(cita)).toBe(50000);
  });

  test("el embed tolera objeto suelto y null", () => {
    expect(ventasDe({ pos_sales: { total: 10 } })).toHaveLength(1);
    expect(ventasDe({ pos_sales: null })).toHaveLength(0);
    expect(ventasDe(null)).toHaveLength(0);
  });

  test("precio de lista incluye los servicios adicionales", () => {
    expect(precioDeLista({ services: { price: "20000" }, appointment_services: [{ price: 5000 }, { price: null }] })).toBe(25000);
  });

  test("un pago dividido se reparte por método real, no como 'mixto'", () => {
    const venta = { total: 100000, payment_method: "mixto", payments: [{ method: "efectivo", amount: 60000 }, { method: "nequi", amount: "40000" }] };
    expect(lineasDePago(venta)).toEqual([
      { method: "efectivo", amount: 60000 },
      { method: "nequi", amount: 40000 },
    ]);
    const d = desglosePorMedio([venta, { total: 20000, payment_method: "efectivo" }, { total: 5000, payment_method: "transferencia" }]);
    expect(d.map(x => [x.key, x.value])).toEqual([["efectivo", 80000], ["nequi", 40000], ["transferencia", 5000]]);
    expect(d.find(x => x.key === "transferencia")?.label).toBe("Transferencia");
    // El total del donut cuadra con la suma de las ventas.
    expect(d.reduce((s, x) => s + x.value, 0)).toBe(125000);
  });

  test("payments con basura no revienta", () => {
    expect(lineasDePago({ total: 10, payment_method: "tarjeta", payments: "no" })).toEqual([{ method: "tarjeta", amount: 10 }]);
    expect(lineasDePago({ total: 10, payment_method: null, payments: [null, 3] })).toEqual([{ method: "otro", amount: 10 }]);
  });

  test("las horas de la gráfica se amplían con los datos (cobros de las 20 h)", () => {
    expect(rangoDeHoras([])).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    const r = rangoDeHoras([20, 7, NaN, 99]);
    expect(r[0]).toBe(7);
    expect(r[r.length - 1]).toBe(20);
    expect(horaDe("09:30:00")).toBe(9);
    expect(Number.isNaN(horaDe(null))).toBe(true);
  });
});
