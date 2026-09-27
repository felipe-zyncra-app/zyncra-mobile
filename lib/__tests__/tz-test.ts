import * as tz from "@/lib/tz";

// Fechas del negocio: fronteras de consulta y agrupamiento en la zona del
// negocio, semanas de lunes a domingo, sin pasar por la zona del teléfono.
describe("lib/tz", () => {
  afterEach(() => tz.establecerZonaActiva(null));

  test("fronteras de día en Bogotá y Madrid (con horario de verano)", () => {
    expect(tz.inicioDelDiaUTC("2026-09-26", "America/Bogota")).toBe("2026-09-26T05:00:00.000Z");
    expect(tz.finDelDiaUTC("2026-09-26", "America/Bogota")).toBe("2026-09-27T04:59:59.999Z");
    expect(tz.inicioDelDiaUTC("2026-07-01", "Europe/Madrid")).toBe("2026-06-30T22:00:00.000Z");
    expect(tz.inicioDelDiaUTC("2026-01-10", "Europe/Madrid")).toBe("2026-01-09T23:00:00.000Z");
    // 29-mar-2026: Madrid pasa a verano, el día dura 23 horas.
    expect(tz.inicioDelDiaUTC("2026-03-29", "Europe/Madrid")).toBe("2026-03-28T23:00:00.000Z");
    expect(tz.finDelDiaUTC("2026-03-29", "Europe/Madrid")).toBe("2026-03-29T21:59:59.999Z");
  });

  test("un cobro de las 8:30 PM en Bogotá es del mismo día, no del siguiente", () => {
    expect(tz.diaLocalDe("2026-09-27T01:30:00Z", "America/Bogota")).toBe("2026-09-26");
    expect(tz.horaLocalDe("2026-09-27T01:30:00Z", "America/Bogota")).toBe("20:30");
  });

  test("instanteDe interpreta la hora en la zona del negocio", () => {
    expect(tz.instanteDe("2026-09-26", "10:00", "Europe/Madrid").toISOString()).toBe("2026-09-26T08:00:00.000Z");
    expect(tz.instanteDe("2026-09-26", "10:00", "America/Bogota").toISOString()).toBe("2026-09-26T15:00:00.000Z");
  });

  test("semana de lunes a domingo, también desde un domingo", () => {
    expect(tz.diaDeSemana("2026-09-27")).toBe(7);
    expect(tz.inicioDeSemana("2026-09-27")).toBe("2026-09-21");
    expect(tz.finDeSemana("2026-09-21")).toBe("2026-09-27");
    const r = tz.rangoDePeriodo("semana", "America/Bogota", "2026-09-26");
    expect([r.desde, r.hasta, r.dias]).toEqual(["2026-09-21", "2026-09-27", 7]);
    expect(r.desdeUTC).toBe("2026-09-21T05:00:00.000Z");
    expect(r.hastaUTC).toBe("2026-09-28T04:59:59.999Z");
    expect(tz.rangoAnterior(r).desde).toBe("2026-09-14");
  });

  test("mes: del 31 de enero al mes siguiente cae en febrero, no en marzo", () => {
    const enero = tz.rangoDePeriodo("mes", "America/Bogota", "2026-01-31");
    const feb = tz.rangoSiguiente(enero);
    expect([feb.desde, feb.hasta]).toEqual(["2026-02-01", "2026-02-28"]);
    expect(tz.finDeMes("2028-02-10")).toBe("2028-02-29");
  });

  test("rango personalizado se ordena y se corre por su largo", () => {
    const p = tz.rangoPersonalizado("2026-09-10", "2026-09-01", "America/Bogota");
    expect([p.desde, p.hasta, p.dias]).toEqual(["2026-09-01", "2026-09-10", 10]);
    const ant = tz.rangoAnterior(p);
    expect([ant.desde, ant.hasta]).toEqual(["2026-08-22", "2026-08-31"]);
  });

  test("fmtDia no corre el día (no parsea como UTC)", () => {
    expect(tz.fmtDia("2026-09-26", "largo")).toBe("sábado 26 de septiembre");
    expect(tz.fmtDia("2026-09-26", "corto")).toBe("26 sep 2026");
    expect(tz.etiquetaRango(tz.rangoPersonalizado("2026-09-28", "2026-10-04", "America/Bogota"))).toBe("28 sep – 4 oct 2026");
  });

  test("entradas inválidas no tumban la pantalla", () => {
    expect(tz.diaLocalDe("")).toBe("");
    expect(tz.inicioDelDiaUTC("xx", "America/Bogota")).toBe("xxT00:00:00");
    expect(tz.sumarDias("", 1)).toBe("");
  });

  test("la zona activa es el valor por defecto de los helpers", () => {
    tz.establecerZonaActiva("Europe/Madrid");
    expect(tz.inicioDelDiaUTC("2026-07-01")).toBe("2026-06-30T22:00:00.000Z");
    tz.establecerZonaActiva(null);
    expect(tz.zonaActiva()).toBe(tz.ZONA_POR_DEFECTO);
  });
});
