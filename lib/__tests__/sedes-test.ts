import {
  filtroSedeOGeneral, incluyeCajaGeneral, movimientoEnSede, preferirCajaDeSede, sedeDeStock,
} from "@/lib/sedes";

describe("filtroSedeOGeneral", () => {
  test("la sede más los registros sin sede", () => {
    expect(filtroSedeOGeneral("sede-a")).toBe("location_id.eq.sede-a,location_id.is.null");
  });
});

describe("sedeDeStock", () => {
  test("la del producto; si no tiene, la de respaldo; si tampoco, null", () => {
    expect(sedeDeStock("sede-b", "sede-a")).toBe("sede-b");
    expect(sedeDeStock(null, "sede-a")).toBe("sede-a");
    expect(sedeDeStock(undefined, null)).toBeNull();
  });
});

describe("movimientoEnSede", () => {
  test("sin sede activa se ve todo", () => {
    expect(movimientoEnSede({ location_id: "sede-b" }, null)).toBe(true);
  });

  test("con sede: los suyos sí, los de otra sede no", () => {
    expect(movimientoEnSede({ location_id: "sede-a" }, "sede-a")).toBe(true);
    expect(movimientoEnSede({ location_id: "sede-b", products: { location_id: "sede-a" } }, "sede-a")).toBe(false);
  });

  test("un movimiento viejo sin sede sigue a su producto; sin producto con sede, se ve en todas", () => {
    expect(movimientoEnSede({ location_id: null, products: { location_id: "sede-a" } }, "sede-a")).toBe(true);
    expect(movimientoEnSede({ location_id: null, products: { location_id: "sede-b" } }, "sede-a")).toBe(false);
    expect(movimientoEnSede({ location_id: null, products: { location_id: null } }, "sede-a")).toBe(true);
    expect(movimientoEnSede({ location_id: null, products: null }, "sede-a")).toBe(true);
  });
});

describe("incluyeCajaGeneral", () => {
  test("solo con sede activa y una sola sede", () => {
    expect(incluyeCajaGeneral("sede-a", 1)).toBe(true);
    expect(incluyeCajaGeneral("sede-a", 0)).toBe(true);
    expect(incluyeCajaGeneral("sede-a", 2)).toBe(false);
    expect(incluyeCajaGeneral(null, 1)).toBe(false);
  });
});

describe("preferirCajaDeSede", () => {
  test("primero la de la sede, si no la primera, si no null", () => {
    const general = { id: "g", location_id: null };
    const deSede = { id: "a", location_id: "sede-a" };
    expect(preferirCajaDeSede([general, deSede], "sede-a")).toBe(deSede);
    expect(preferirCajaDeSede([general], "sede-a")).toBe(general);
    expect(preferirCajaDeSede([], "sede-a")).toBeNull();
  });
});
