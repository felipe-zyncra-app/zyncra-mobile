import {
  leerMonto, parseMonto, parsePorcentaje, monedaSinDecimales,
  totalesCaja, esIngresoHuerfano, agruparPorItem, metodoAFactus, prorratearPrecios,
  montoATexto, sugerenciasEfectivo,
} from "@/lib/dinero";
import { configurarMoneda } from "@/lib/format";

afterEach(() => configurarMoneda());

describe("montos (DIN-18)", () => {
  test("en pesos cuentan solo los dígitos", () => {
    expect(parseMonto("50.000")).toBe(50000);
    expect(parseMonto("50,000")).toBe(50000);
    expect(parseMonto("$ 50 000")).toBe(50000);
    expect(parseMonto("")).toBe(0);
    expect(leerMonto("abc")).toBeNull();
    expect(leerMonto("0")).toBe(0);
  });

  test("con centavos el último separador de 1-2 dígitos es el decimal", () => {
    configurarMoneda("USD", "en-US");
    expect(monedaSinDecimales()).toBe(false);
    expect(parseMonto("12.50")).toBe(12.5);
    expect(parseMonto("1.234,5")).toBe(1234.5);
    expect(parseMonto("1,234")).toBe(1234);
    expect(parseMonto("1,234.56")).toBe(1234.56);
  });

  test("porcentaje acepta coma y punto, acotado a 100", () => {
    expect(parsePorcentaje("12.5")).toBe(12.5);
    expect(parsePorcentaje("12,5")).toBe(12.5);
    expect(parsePorcentaje("150")).toBe(100);
    expect(parsePorcentaje("")).toBe(0);
    expect(parsePorcentaje("-5")).toBe(5);
  });
});

describe("totalesCaja", () => {
  test("separa el efectivo esperado de los pagos electrónicos", () => {
    const t = totalesCaja([
      { type: "ingreso", amount: 300000, payment_method: "efectivo" },
      { type: "ingreso", amount: 500000, payment_method: "nequi" },
      { type: "ingreso", amount: "10000", payment_method: null },
      { type: "egreso", amount: 20000 },
    ], 200000);
    expect(t.ingresos).toBe(810000);
    expect(t.ingresosEfectivo).toBe(310000);
    expect(t.ingresosElectronicos).toBe(500000);
    expect(t.balance).toBe(990000);
    expect(t.efectivoEsperado).toBe(490000);
  });
});

describe("esIngresoHuerfano (DIN-X1)", () => {
  test("un ingreso POS sin venta es huérfano; la anulación y los manuales no", () => {
    expect(esIngresoHuerfano({ type: "ingreso", amount: 1, category: "POS", description: "Venta POS · Ana", pos_sale_id: null })).toBe(true);
    expect(esIngresoHuerfano({ type: "ingreso", amount: 1, category: "POS", description: "Venta POS", pos_sale_id: "x" })).toBe(false);
    expect(esIngresoHuerfano({ type: "egreso", amount: 1, category: "POS", description: "Anulación · Venta POS", pos_sale_id: null })).toBe(false);
    expect(esIngresoHuerfano({ type: "ingreso", amount: 1, category: "Producto", description: "Flyer", pos_sale_id: null })).toBe(false);
    expect(esIngresoHuerfano({ type: "ingreso", amount: 1, category: "POS", description: "Venta POS", layaway_payment_id: "l" })).toBe(false);
  });
});

describe("agruparPorItem (DIN-01 / DIN-24)", () => {
  test("usa price y nombra productos e ítems libres por su nombre", () => {
    const r = agruparPorItem([
      { pos_sale_items: [
        { name: "Corte", price: 30000, quantity: 1, item_type: "service", services: { name: "Corte clásico" } },
        { name: "Cera mate", price: 20000, quantity: 2, item_type: "product", services: null },
        { name: "Propina", price: 5000, quantity: 1, item_type: "service", services: null },
      ] },
      { pos_sale_items: [{ name: "Corte", price: "30000", quantity: 1, item_type: "service", services: { name: "Corte clásico" } }] },
    ]);
    expect(r.map(x => [x.name, x.val, x.esProducto])).toEqual([
      ["Corte clásico", 60000, false],
      ["Cera mate", 40000, true],
      ["Propina", 5000, false],
    ]);
    expect(r[0].pct).toBe(100);
  });

  test("las propinas (item_type tip) no cuentan como algo vendido", () => {
    const r = agruparPorItem([
      { pos_sale_items: [
        { name: "Corte", price: 30000, quantity: 1, item_type: "service", services: null },
        { name: "Propina · Ana", price: 90000, quantity: 1, item_type: "tip", services: null },
      ] },
    ]);
    expect(r.map(x => x.name)).toEqual(["Corte"]);
  });
});

describe("facturación", () => {
  test("mapea el método del POS al código DIAN", () => {
    expect(metodoAFactus("efectivo")).toBe("10");
    expect(metodoAFactus("tarjeta")).toBe("49");
    expect(metodoAFactus("transferencia")).toBe("47");
    expect(metodoAFactus("nequi")).toBe("42");
  });

  test("prorratea el descuento para que la factura sume lo cobrado", () => {
    const items = [{ price: 50000, quantity: 1 }, { price: 15000, quantity: 1 }];
    const { precios, diferencia } = prorratearPrecios(items, 52000);
    expect(precios[0] + precios[1]).toBe(52000);
    expect(diferencia).toBe(0);
    expect(prorratearPrecios(items, 65000).precios).toEqual([50000, 15000]);
  });
});

describe("efectivo en la hoja de cobro", () => {
  test("sugiere los billetes que siguen al total, sin repetir", () => {
    expect(sugerenciasEfectivo(35000, { decimales: false })).toEqual([40000, 50000, 100000]);
    expect(sugerenciasEfectivo(48000, { decimales: false })).toEqual([50000, 60000, 100000]);
    expect(sugerenciasEfectivo(8000, { decimales: false })).toEqual([10000, 20000, 50000]);
  });

  test("nunca sugiere el total exacto ni algo menor (Exacto va aparte)", () => {
    for (const total of [5000, 20000, 100000, 250000]) {
      for (const v of sugerenciasEfectivo(total, { decimales: false })) expect(v).toBeGreaterThan(total);
    }
    expect(sugerenciasEfectivo(250000, { decimales: false })).toEqual([260000, 300000]);
  });

  test("con centavos usa billetes de 5, 10, 20…", () => {
    expect(sugerenciasEfectivo(12.5, { decimales: true })).toEqual([15, 20, 50]);
  });

  test("sin total no hay sugerencias", () => {
    expect(sugerenciasEfectivo(0)).toEqual([]);
    expect(sugerenciasEfectivo(Number.NaN)).toEqual([]);
  });

  test("montoATexto se vuelve a leer igual", () => {
    expect(montoATexto(40000, { decimales: false })).toBe("40000");
    expect(leerMonto(montoATexto(40000, { decimales: false }), { decimales: false })).toBe(40000);
    expect(montoATexto(12.5, { decimales: true })).toBe("12.50");
    expect(leerMonto(montoATexto(12.5, { decimales: true }), { decimales: true })).toBe(12.5);
    expect(montoATexto(20, { decimales: true })).toBe("20");
    expect(montoATexto(0)).toBe("");
  });
});
