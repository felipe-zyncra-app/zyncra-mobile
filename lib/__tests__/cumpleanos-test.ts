import { ANIO_SIN_ANIO, cumpleParaGuardar, diasDelMes, fmtCumple, leerCumple } from "@/lib/cumpleanos";

describe("cumpleaños (mes y día)", () => {
  it("febrero tiene 29 días para no dejar por fuera a nadie", () => {
    expect(diasDelMes(2)).toBe(29);
    expect(diasDelMes(4)).toBe(30);
    expect(diasDelMes(12)).toBe(31);
  });

  it("lee fechas reales y rechaza las que no existen", () => {
    expect(leerCumple("1995-06-24")).toEqual({ anio: 1995, mes: 6, dia: 24 });
    expect(leerCumple("2000-02-29T00:00:00")).toEqual({ anio: 2000, mes: 2, dia: 29 });
    expect(leerCumple("1995-02-31")).toBeNull();
    expect(leerCumple("")).toBeNull();
    expect(leerCumple(null)).toBeNull();
  });

  it("sin año previo guarda con el año de relleno", () => {
    expect(cumpleParaGuardar({ mes: 6, dia: 24 })).toBe(`${ANIO_SIN_ANIO}-06-24`);
    expect(cumpleParaGuardar({ mes: 2, dia: 29 }, null)).toBe("2000-02-29");
  });

  it("conserva el año real que ya tenía la ficha", () => {
    expect(cumpleParaGuardar({ mes: 7, dia: 1 }, "1990-03-15")).toBe("1990-07-01");
    // 29-feb no existe en 1990: cae al año de relleno.
    expect(cumpleParaGuardar({ mes: 2, dia: 29 }, "1990-03-15")).toBe("2000-02-29");
  });

  it("vacío o inválido se guarda como null", () => {
    expect(cumpleParaGuardar(null, "1990-03-15")).toBeNull();
    expect(cumpleParaGuardar({ mes: 4, dia: 31 })).toBeNull();
  });

  it("se muestra sin año", () => {
    expect(fmtCumple({ mes: 6, dia: 24 })).toBe("24 de junio");
  });
});
