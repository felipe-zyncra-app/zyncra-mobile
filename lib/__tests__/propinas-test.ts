import {
  agregarPropina, equipoConCita, esPropina, etiquetaVendedor, itemsDeVenta, lineaPropina, nombrePropina,
  paraFacturar, pareceUnaPropina, profesionalDeMovimiento, textoPropinaCobrada, totalesCobro,
  type LineaCarrito,
} from "@/lib/propinas";
import { prorratearPrecios } from "@/lib/dinero";

const ana = { id: "pro-ana", name: "Ana" };
const luis = { id: "pro-luis", name: "Luis" };

const corte: LineaCarrito = { key: "svc-1", serviceId: "s1", productId: null, itemType: "service", name: "Corte", price: 50000, qty: 1 };
const cera: LineaCarrito = { key: "prod-1", serviceId: null, productId: "p1", itemType: "product", name: "Cera", price: 20000, qty: 1, unitCost: 8000, locationId: "sede-a" };

describe("totalesCobro: la propina no se descuenta (igual que el POS web)", () => {
  test("descuento % sobre el subtotal sin la propina; el total sí la cobra", () => {
    const r = totalesCobro([corte, lineaPropina(ana, 10000)], { tipo: "percentage", valor: 10 });
    expect(r).toEqual({ subtotal: 60000, propinas: 10000, baseDescuento: 50000, descuento: 5000, total: 55000 });
  });

  test("descuento fijo: el tope es lo que no es propina", () => {
    const r = totalesCobro([corte, lineaPropina(ana, 10000)], { tipo: "fixed", valor: 80000 });
    expect(r.descuento).toBe(50000);
    expect(r.total).toBe(10000);
  });

  test("sin propina, igual que antes", () => {
    const r = totalesCobro([corte, { ...cera, qty: 2 }], { tipo: "percentage", valor: 10 });
    expect(r).toEqual({ subtotal: 90000, propinas: 0, baseDescuento: 90000, descuento: 9000, total: 81000 });
  });

  test("solo propina: no hay nada que descontar", () => {
    const r = totalesCobro([lineaPropina(ana, 15000)], { tipo: "percentage", valor: 50 });
    expect(r).toMatchObject({ descuento: 0, total: 15000 });
  });

  test("porcentaje mayor a 100 se acota; valores inválidos no descuentan", () => {
    expect(totalesCobro([corte], { tipo: "percentage", valor: 250 }).total).toBe(0);
    expect(totalesCobro([corte], { tipo: "fixed", valor: NaN }).total).toBe(50000);
    expect(totalesCobro([corte], { tipo: "fixed", valor: -5 }).total).toBe(50000);
  });

  test("acepta las líneas guardadas en la venta (quantity / item_type)", () => {
    const r = totalesCobro([
      { price: 30000, quantity: 2, item_type: "service" },
      { price: 5000, quantity: 1, item_type: "tip" },
    ], { tipo: "fixed", valor: 0 });
    expect(r).toMatchObject({ subtotal: 65000, propinas: 5000, total: 65000 });
  });
});

describe("línea de propina", () => {
  test("nombre, tipo y profesional como el POS web", () => {
    expect(lineaPropina(ana, 10000)).toEqual({
      key: "tip-pro-ana", serviceId: null, productId: null, itemType: "tip",
      name: "Propina · Ana", price: 10000, qty: 1, professionalId: "pro-ana",
    });
    expect(nombrePropina("  ")).toBe("Propina");
    expect(esPropina(lineaPropina(ana, 1))).toBe(true);
    expect(esPropina({ item_type: "tip" })).toBe(true);
    expect(esPropina({ item_type: "service" })).toBe(false);
  });

  test("dos propinas para la misma persona se suman; para otra, se agrega otra línea", () => {
    let cart = agregarPropina([corte], lineaPropina(ana, 10000));
    cart = agregarPropina(cart, lineaPropina(ana, 5000));
    cart = agregarPropina(cart, lineaPropina(luis, 2000));
    expect(cart.map(i => [i.name, i.price])).toEqual([["Corte", 50000], ["Propina · Ana", 15000], ["Propina · Luis", 2000]]);
  });

  test("tras cobrar se dice a la nómina de quién fue", () => {
    expect(textoPropinaCobrada([], [ana])).toBeNull();
    expect(textoPropinaCobrada([{ professionalId: "pro-ana" }], [ana, luis])).toBe("La propina queda en la nómina de Ana.");
    expect(textoPropinaCobrada([{ professionalId: "pro-ana" }, { professionalId: "pro-luis" }], [ana, luis]))
      .toBe("Las propinas quedan en la nómina de Ana y Luis.");
    expect(textoPropinaCobrada([{ professionalId: "otro" }], [ana])).toBe("La propina queda en la nómina de quien la recibe.");
  });

  test("un ítem libre llamado propina se detecta", () => {
    expect(pareceUnaPropina("Propina")).toBe(true);
    expect(pareceUnaPropina("propina Ana")).toBe(true);
    expect(pareceUnaPropina("Tratamiento")).toBe(false);
  });
});

describe("itemsDeVenta: lo que va a pos_sale_items", () => {
  test("propina con quien la recibe; producto con quien lo vendió; servicio sin profesional", () => {
    const items = itemsDeVenta([
      { ...corte, professionalId: "no-debe-ir" },
      { ...cera, professionalId: "pro-luis" },
      { ...cera, key: "prod-2", productId: "p2" },
      { key: "free-1", serviceId: null, productId: null, itemType: "free", name: "Domicilio", price: 3000, qty: 1 },
      lineaPropina(ana, 10000),
    ]);
    expect(items).toEqual([
      { name: "Corte", price: 50000, quantity: 1, service_id: "s1", product_id: null, item_type: "service", unit_cost: null, location_id: null, professional_id: null },
      { name: "Cera", price: 20000, quantity: 1, service_id: null, product_id: "p1", item_type: "product", unit_cost: 8000, location_id: "sede-a", professional_id: "pro-luis" },
      // Vacío = el profesional de la cita.
      { name: "Cera", price: 20000, quantity: 1, service_id: null, product_id: "p2", item_type: "product", unit_cost: 8000, location_id: "sede-a", professional_id: null },
      // El ítem libre va como servicio sin service_id (igual que el web).
      { name: "Domicilio", price: 3000, quantity: 1, service_id: null, product_id: null, item_type: "service", unit_cost: null, location_id: null, professional_id: null },
      { name: "Propina · Ana", price: 10000, quantity: 1, service_id: null, product_id: null, item_type: "tip", unit_cost: null, location_id: null, professional_id: "pro-ana" },
    ]);
  });
});

describe("equipo y vendedor", () => {
  test("el profesional de la cita va primero y sin repetirse; si ya no está activo, igual aparece", () => {
    expect(equipoConCita([ana, luis], luis).map(p => p.id)).toEqual(["pro-luis", "pro-ana"]);
    expect(equipoConCita([ana], { id: "pro-viejo", name: "Mario" }).map(p => p.id)).toEqual(["pro-viejo", "pro-ana"]);
    expect(equipoConCita([ana, luis], null)).toEqual([ana, luis]);
  });

  test("etiqueta del vendedor", () => {
    expect(etiquetaVendedor(null, [ana, luis], ana)).toBe("Vendió: Ana (la cita)");
    expect(etiquetaVendedor("pro-luis", [ana, luis], ana)).toBe("Vendió: Luis");
    expect(etiquetaVendedor(undefined, [ana, luis], null)).toBe("Vendió: sin asignar");
  });
});

describe("paraFacturar: la propina no va en la factura", () => {
  test("sin la línea de propina y con el descuento repartido sobre lo demás", () => {
    // Corte 50.000 + Cera 20.000 con 10 % de descuento (63.000) + propina 10.000 = 73.000 cobrados.
    const venta = [
      { name: "Corte", price: 50000, quantity: 1, item_type: "service" },
      { name: "Cera", price: 20000, quantity: 1, item_type: "product" },
      { name: "Propina · Ana", price: 10000, quantity: 1, item_type: "tip" },
    ];
    const f = paraFacturar(venta, 73000);
    expect(f.propinas).toBe(10000);
    expect(f.total).toBe(63000);
    expect(f.items.map(i => i.name)).toEqual(["Corte", "Cera"]);
    const { precios, diferencia } = prorratearPrecios(f.items, f.total);
    expect(precios).toEqual([45000, 18000]);
    expect(diferencia).toBe(0);
  });

  test("ventas viejas sin item_type quedan igual", () => {
    const f = paraFacturar([{ name: "Corte", price: 30000, quantity: 1 }], 30000);
    expect(f).toEqual({ items: [{ name: "Corte", price: 30000, quantity: 1 }], total: 30000, propinas: 0 });
  });
});

describe("profesionalDeMovimiento: propina registrada en Caja", () => {
  test("solo un ingreso «Propina» con alguien elegido lleva professional_id", () => {
    expect(profesionalDeMovimiento("ingreso", "Propina", "pro-ana")).toBe("pro-ana");
    expect(profesionalDeMovimiento("ingreso", "Propina", "")).toBeNull();
    expect(profesionalDeMovimiento("ingreso", "Servicio", "pro-ana")).toBeNull();
    expect(profesionalDeMovimiento("egreso", "Propina", "pro-ana")).toBeNull();
    expect(profesionalDeMovimiento("ingreso", null, "pro-ana")).toBeNull();
  });
});
