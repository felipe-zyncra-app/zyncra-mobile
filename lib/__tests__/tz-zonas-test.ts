import * as tz from "@/lib/tz";

// Tests exhaustivos de lib/tz.ts: fronteras de consulta Y agrupamiento en
// memoria en la zona del negocio (D9). Zonas negativas sin horario de verano
// (Bogotá), positivas con horario de verano (Madrid) y negativas con horario
// de verano que cambia a medianoche (Santiago). Los tests no dependen de la
// zona de la máquina: la simulación del teléfono en otra zona está en
// tz-dispositivo-test.ts.

const BOG = "America/Bogota";
const MAD = "Europe/Madrid";
const SCL = "America/Santiago";

const ms = (iso: string) => Date.parse(iso);
const iso = (n: number) => new Date(n).toISOString();

afterEach(() => {
  jest.useRealTimers();
  tz.establecerZonaActiva(null);
});

describe("fronteras de día en cada zona", () => {
  test("Bogotá (UTC-5 todo el año): el día empieza a las 05:00 UTC", () => {
    expect(tz.inicioDelDiaUTC("2026-09-26", BOG)).toBe("2026-09-26T05:00:00.000Z");
    expect(tz.finDelDiaUTC("2026-09-26", BOG)).toBe("2026-09-27T04:59:59.999Z");
    expect(tz.inicioDelDiaUTC("2026-01-01", BOG)).toBe("2026-01-01T05:00:00.000Z");
    expect(tz.finDelDiaUTC("2026-12-31", BOG)).toBe("2027-01-01T04:59:59.999Z");
  });

  test("Madrid: UTC+1 en invierno, UTC+2 en verano", () => {
    expect(tz.inicioDelDiaUTC("2026-01-15", MAD)).toBe("2026-01-14T23:00:00.000Z");
    expect(tz.inicioDelDiaUTC("2026-07-15", MAD)).toBe("2026-07-14T22:00:00.000Z");
    expect(tz.finDelDiaUTC("2026-07-15", MAD)).toBe("2026-07-15T21:59:59.999Z");
  });

  test("Madrid, días del cambio de hora: 23 h en marzo y 25 h en octubre", () => {
    // 29-mar-2026: a las 02:00 pasa a las 03:00.
    const iniMar = tz.inicioDelDiaUTC("2026-03-29", MAD);
    const finMar = tz.finDelDiaUTC("2026-03-29", MAD);
    expect([iniMar, finMar]).toEqual(["2026-03-28T23:00:00.000Z", "2026-03-29T21:59:59.999Z"]);
    expect((ms(finMar) + 1 - ms(iniMar)) / 3_600_000).toBe(23);
    // 25-oct-2026: a las 03:00 vuelve a las 02:00.
    const iniOct = tz.inicioDelDiaUTC("2026-10-25", MAD);
    const finOct = tz.finDelDiaUTC("2026-10-25", MAD);
    expect([iniOct, finOct]).toEqual(["2026-10-24T22:00:00.000Z", "2026-10-25T22:59:59.999Z"]);
    expect((ms(finOct) + 1 - ms(iniOct)) / 3_600_000).toBe(25);
  });

  test("Santiago: UTC-4 en invierno, UTC-3 en verano", () => {
    expect(tz.inicioDelDiaUTC("2026-07-01", SCL)).toBe("2026-07-01T04:00:00.000Z");
    expect(tz.inicioDelDiaUTC("2026-01-15", SCL)).toBe("2026-01-15T03:00:00.000Z");
  });

  test("Santiago 6-sep-2026: la medianoche no existe (00:00 → 01:00) y el día empieza a las 01:00", () => {
    // Antes el día 6 empezaba a las 23:00 del 5 (03:00Z): se quedaba con una
    // hora del día anterior y el 5 perdía su última hora.
    expect(tz.inicioDelDiaUTC("2026-09-06", SCL)).toBe("2026-09-06T04:00:00.000Z");
    expect(tz.horaLocalDe("2026-09-06T04:00:00.000Z", SCL)).toBe("01:00");
    expect(tz.finDelDiaUTC("2026-09-05", SCL)).toBe("2026-09-06T03:59:59.999Z");
    expect(tz.finDelDiaUTC("2026-09-06", SCL)).toBe("2026-09-07T02:59:59.999Z");
    // Un cobro a las 23:30 del 5 (hora de invierno) es del 5, y cae en su ventana.
    expect(tz.diaLocalDe("2026-09-06T03:30:00Z", SCL)).toBe("2026-09-05");
    expect(ms("2026-09-06T03:30:00Z")).toBeLessThanOrEqual(ms(tz.finDelDiaUTC("2026-09-05", SCL)));
  });

  test("Santiago 4-abr-2026: la hora de las 23 se repite y el día dura 25 h", () => {
    expect(tz.inicioDelDiaUTC("2026-04-04", SCL)).toBe("2026-04-04T03:00:00.000Z");
    expect(tz.finDelDiaUTC("2026-04-04", SCL)).toBe("2026-04-05T03:59:59.999Z");
    expect(tz.inicioDelDiaUTC("2026-04-05", SCL)).toBe("2026-04-05T04:00:00.000Z");
    // Las dos "23:30" del 4 son del 4.
    expect(tz.diaLocalDe("2026-04-05T02:30:00Z", SCL)).toBe("2026-04-04");
    expect(tz.diaLocalDe("2026-04-05T03:30:00Z", SCL)).toBe("2026-04-04");
    expect(tz.horaLocalDe("2026-04-05T03:30:00Z", SCL)).toBe("23:30");
  });
});

describe("invariantes: fronteras y agrupamiento coinciden en las 19 zonas", () => {
  const zonas = tz.ZONAS_DISPONIBLES.map(z => z.id);
  // Todo 2026 (incluye los cambios de hora de Madrid, Santiago y Asunción) y
  // los 29 de febrero de 2024 y 2028.
  const dias = [...tz.listaDeDias("2026-01-01", "2026-12-31"), "2024-02-29", "2028-02-29"];

  test.each(zonas)("%s", (zona) => {
    const errores: string[] = [];
    for (const d of dias) {
      const ini = ms(tz.inicioDelDiaUTC(d, zona));
      const fin = ms(tz.finDelDiaUTC(d, zona));
      const horas = (fin + 1 - ini) / 3_600_000;
      if (tz.diaLocalDe(new Date(ini), zona) !== d) errores.push(`${d}: el inicio no es del día`);
      if (tz.diaLocalDe(new Date(ini - 1), zona) !== tz.sumarDias(d, -1)) errores.push(`${d}: antes del inicio no es el día anterior`);
      if (tz.diaLocalDe(new Date(fin), zona) !== d) errores.push(`${d}: el fin no es del día`);
      if (tz.diaLocalDe(new Date(fin + 1), zona) !== tz.sumarDias(d, 1)) errores.push(`${d}: después del fin no es el día siguiente`);
      if (tz.inicioDelDiaUTC(tz.sumarDias(d, 1), zona) !== iso(fin + 1)) errores.push(`${d}: hueco o traslape con el día siguiente`);
      if (![23, 24, 25].includes(horas)) errores.push(`${d}: dura ${horas} h`);
      if (horas !== 23 && tz.horaLocalDe(new Date(ini), zona) !== "00:00") errores.push(`${d}: no empieza a medianoche`);
    }
    expect(errores).toEqual([]);
  });

  test("las zonas marcadas con horario de verano son las que cambian de desfase en 2026", () => {
    const cambia = (zona: string) =>
      tz.horaLocalDe("2026-01-15T12:00:00Z", zona) !== tz.horaLocalDe("2026-07-15T12:00:00Z", zona);
    // Paraguay dejó el horario de verano en 2024: un Node con tzdata anterior
    // a 2024b todavía se lo aplica, y ahí no se puede comprobar.
    const tzdata = (process.versions as Record<string, string | undefined>).tz ?? "";
    for (const z of tz.ZONAS_DISPONIBLES) {
      if (z.id === "America/Asuncion" && tzdata < "2024b") continue;
      expect([z.id, cambia(z.id)]).toEqual([z.id, !!z.dst]);
    }
  });
});

describe("noches después de las 19:00 (el UTC ya es mañana)", () => {
  test("un cobro de las 7:30 PM en Bogotá es del mismo día y cae en su ventana", () => {
    const cobro = "2026-09-27T00:30:00Z";   // sábado 26, 19:30 en Bogotá
    expect(cobro.slice(0, 10)).toBe("2026-09-27");   // el error de siempre
    expect(tz.diaLocalDe(cobro, BOG)).toBe("2026-09-26");
    expect(tz.horaLocalDe(cobro, BOG)).toBe("19:30");
    expect(tz.minutosDelDia(cobro, BOG)).toBe(19 * 60 + 30);
    const hoy = tz.rangoDePeriodo("dia", BOG, "2026-09-26");
    expect(ms(cobro)).toBeGreaterThanOrEqual(ms(hoy.desdeUTC));
    expect(ms(cobro)).toBeLessThanOrEqual(ms(hoy.hastaUTC));
    const manana = tz.rangoDePeriodo("dia", BOG, "2026-09-27");
    expect(ms(cobro)).toBeLessThan(ms(manana.desdeUTC));
  });

  test("11:59 PM en Bogotá sigue siendo el mismo día; 12:00 AM ya es el siguiente", () => {
    expect(tz.diaLocalDe("2026-09-27T04:59:59.999Z", BOG)).toBe("2026-09-26");
    expect(tz.diaLocalDe("2026-09-27T05:00:00.000Z", BOG)).toBe("2026-09-27");
  });

  test("en zona positiva pasa al revés: 00:30 en Madrid es 22:30 UTC del día anterior", () => {
    expect(tz.diaLocalDe("2026-09-26T22:30:00Z", MAD)).toBe("2026-09-27");
    expect(tz.minutosDelDia("2026-09-26T22:30:00Z", MAD)).toBe(30);
    expect(tz.diaLocalDe("2026-09-26T21:59:59Z", MAD)).toBe("2026-09-26");
  });

  test("hoyNegocio y esHoy a las 7:30 PM de Bogotá", () => {
    jest.useFakeTimers({ now: new Date("2026-09-27T00:30:00Z") });
    expect(tz.hoyNegocio(BOG)).toBe("2026-09-26");
    expect(tz.hoyNegocio(MAD)).toBe("2026-09-27");
    expect(tz.hoyNegocio(SCL)).toBe("2026-09-26");
    expect(tz.esHoy("2026-09-26", BOG)).toBe(true);
    expect(tz.esHoy("2026-09-27", BOG)).toBe(false);
    expect(tz.minutosDelDia(undefined, BOG)).toBe(19 * 60 + 30);
    // Sin zona explícita usa la zona activa del negocio, no Bogotá fijo.
    tz.establecerZonaActiva(MAD);
    expect(tz.hoyNegocio()).toBe("2026-09-27");
  });
});

describe("semanas de lunes a domingo", () => {
  test("diaDeSemana: 1 = lunes … 7 = domingo", () => {
    expect(["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"]
      .map(tz.diaDeSemana)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  test("el domingo es el último día de su semana, no el primero de la siguiente", () => {
    expect(tz.inicioDeSemana("2026-09-27")).toBe("2026-09-21");
    expect(tz.finDeSemana("2026-09-27")).toBe("2026-09-27");
    expect(tz.inicioDeSemana("2026-09-28")).toBe("2026-09-28");
    // Un cobro del domingo a las 10 PM en Bogotá (lunes 03:00 UTC) es de esa semana.
    const semana = tz.rangoDePeriodo("semana", BOG, "2026-09-27");
    const cobro = "2026-09-28T03:00:00Z";
    expect(tz.diaLocalDe(cobro, BOG)).toBe("2026-09-27");
    expect(ms(cobro)).toBeLessThanOrEqual(ms(semana.hastaUTC));
    expect(semana.hastaUTC).toBe("2026-09-28T04:59:59.999Z");
  });

  test("semana que cruza mes y año", () => {
    const r = tz.rangoDePeriodo("semana", BOG, "2026-01-01");   // jueves
    expect([r.desde, r.hasta, r.dias]).toEqual(["2025-12-29", "2026-01-04", 7]);
    expect(tz.etiquetaRango(r)).toBe("29 dic 2025 – 4 ene 2026");
    const s = tz.rangoDePeriodo("semana", BOG, "2026-10-01");
    expect(tz.etiquetaRango(s)).toBe("28 sep – 4 oct 2026");
  });

  test("semana con cambio de hora en Madrid: 167 horas", () => {
    const r = tz.rangoDePeriodo("semana", MAD, "2026-03-29");
    expect([r.desde, r.hasta]).toEqual(["2026-03-23", "2026-03-29"]);
    expect(r.desdeUTC).toBe("2026-03-22T23:00:00.000Z");
    expect(r.hastaUTC).toBe("2026-03-29T21:59:59.999Z");
    expect((ms(r.hastaUTC) + 1 - ms(r.desdeUTC)) / 3_600_000).toBe(167);
  });

  test("navegar semanas y 'siguiente' deshabilitado en la semana actual (según la zona)", () => {
    // Domingo 27 a las 9 PM en Bogotá = lunes 28 a las 4 AM en Madrid.
    jest.useFakeTimers({ now: new Date("2026-09-28T02:00:00Z") });
    const bog = tz.rangoDePeriodo("semana", BOG);
    const mad = tz.rangoDePeriodo("semana", MAD);
    expect([bog.desde, bog.hasta]).toEqual(["2026-09-21", "2026-09-27"]);
    expect([mad.desde, mad.hasta]).toEqual(["2026-09-28", "2026-10-04"]);
    expect(tz.rangoIncluyeHoy(bog)).toBe(true);
    expect(tz.rangoIncluyeHoy(tz.rangoAnterior(bog))).toBe(false);
    expect(tz.rangoIncluyeHoy(tz.rangoAnterior(mad))).toBe(false);
    expect(tz.moverReferencia("semana", "2026-09-27", -1)).toBe("2026-09-20");
    expect(tz.rangoSiguiente(bog).desde).toBe("2026-09-28");
    expect(tz.moverRango(bog, -3).desde).toBe("2026-08-31");
  });
});

describe("meses cortos y años bisiestos", () => {
  test("fin de mes de cada largo", () => {
    expect(tz.finDeMes("2026-02-10")).toBe("2026-02-28");
    expect(tz.finDeMes("2026-04-10")).toBe("2026-04-30");
    expect(tz.finDeMes("2026-12-10")).toBe("2026-12-31");
    expect(tz.finDeMes("2028-02-01")).toBe("2028-02-29");
    expect(tz.finDeMes("2024-02-29")).toBe("2024-02-29");
    expect(tz.finDeMes("2100-02-01")).toBe("2100-02-28");   // divisible por 100: no es bisiesto
    expect(tz.finDeMes("2000-02-01")).toBe("2000-02-29");   // divisible por 400: sí
    expect(tz.inicioDeMes("2026-02-28")).toBe("2026-02-01");
  });

  test("rango de febrero en Bogotá: 28 días y ventana UTC correcta", () => {
    const r = tz.rangoDePeriodo("mes", BOG, "2026-02-14");
    expect([r.desde, r.hasta, r.dias]).toEqual(["2026-02-01", "2026-02-28", 28]);
    expect(r.desdeUTC).toBe("2026-02-01T05:00:00.000Z");
    expect(r.hastaUTC).toBe("2026-03-01T04:59:59.999Z");
    expect(tz.etiquetaRango(r)).toBe("febrero 2026");
  });

  test("mover de mes desde el 31 o el 29 no se salta ningún mes", () => {
    expect(tz.moverReferencia("mes", "2026-01-31", 1)).toBe("2026-02-01");
    expect(tz.moverReferencia("mes", "2026-03-31", -1)).toBe("2026-02-01");
    expect(tz.moverReferencia("mes", "2026-12-15", 1)).toBe("2027-01-01");
    expect(tz.moverReferencia("mes", "2026-01-15", -1)).toBe("2025-12-01");
    expect(tz.moverReferencia("mes", "2028-02-29", 12)).toBe("2029-02-01");
    const feb28 = tz.rangoAnterior(tz.rangoDePeriodo("mes", BOG, "2028-03-31"));
    expect([feb28.desde, feb28.hasta, feb28.dias]).toEqual(["2028-02-01", "2028-02-29", 29]);
  });

  test("mes con cambio de hora en Madrid y en Santiago", () => {
    const mar = tz.rangoDePeriodo("mes", MAD, "2026-03-15");
    expect([mar.desdeUTC, mar.hastaUTC]).toEqual(["2026-02-28T23:00:00.000Z", "2026-03-31T21:59:59.999Z"]);
    const oct = tz.rangoDePeriodo("mes", MAD, "2026-10-15");
    expect([oct.desdeUTC, oct.hastaUTC]).toEqual(["2026-09-30T22:00:00.000Z", "2026-10-31T22:59:59.999Z"]);
    const sep = tz.rangoDePeriodo("mes", SCL, "2026-09-15");
    expect([sep.desdeUTC, sep.hastaUTC]).toEqual(["2026-09-01T04:00:00.000Z", "2026-10-01T02:59:59.999Z"]);
  });

  test("aritmética de días alrededor del 29 de febrero", () => {
    expect(tz.sumarDias("2028-02-28", 1)).toBe("2028-02-29");
    expect(tz.sumarDias("2028-02-29", 1)).toBe("2028-03-01");
    expect(tz.sumarDias("2026-02-28", 1)).toBe("2026-03-01");
    expect(tz.sumarDias("2026-03-01", -1)).toBe("2026-02-28");
    expect(tz.sumarDias("2026-01-31", 30)).toBe("2026-03-02");
    expect(tz.sumarDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(tz.diaDeSemana("2028-02-29")).toBe(2);   // martes
    expect(tz.listaDeDias("2028-02-27", "2028-03-01")).toEqual(["2028-02-27", "2028-02-28", "2028-02-29", "2028-03-01"]);
    expect(tz.diasEntre("2028-01-01", "2028-12-31")).toBe(366);
    expect(tz.diasEntre("2026-01-01", "2026-12-31")).toBe(365);
  });

  test("año bisiesto completo y año anterior", () => {
    const r = tz.rangoDePeriodo("anio", BOG, "2028-07-04");
    expect([r.desde, r.hasta, r.dias]).toEqual(["2028-01-01", "2028-12-31", 366]);
    expect(r.hastaUTC).toBe("2029-01-01T04:59:59.999Z");
    expect(tz.etiquetaRango(r)).toBe("2028");
    const ant = tz.rangoAnterior(r);
    expect([ant.desde, ant.hasta, ant.dias]).toEqual(["2027-01-01", "2027-12-31", 365]);
    expect(tz.moverReferencia("anio", "2028-02-29", 1)).toBe("2029-01-01");
    expect(tz.inicioDeAnio("2028-02-29")).toBe("2028-01-01");
    expect(tz.finDeAnio("2028-02-29")).toBe("2028-12-31");
  });
});

describe("instanteDe: la hora de una cita en la zona del negocio", () => {
  test("zona negativa y positiva", () => {
    expect(tz.instanteDe("2026-09-26", "19:30", BOG).toISOString()).toBe("2026-09-27T00:30:00.000Z");
    expect(tz.instanteDe("2026-09-26", "10:00", MAD).toISOString()).toBe("2026-09-26T08:00:00.000Z");
    expect(tz.instanteDe("2026-01-26", "10:00", MAD).toISOString()).toBe("2026-01-26T09:00:00.000Z");
    expect(tz.instanteDe("2026-09-26", "10:00:00", SCL).toISOString()).toBe("2026-09-26T13:00:00.000Z");
  });

  test("una hora que no existe se corre hacia adelante lo que dura el salto", () => {
    // Madrid 29-mar: 02:30 no existe → 03:30 de verano.
    expect(tz.instanteDe("2026-03-29", "02:30", MAD).toISOString()).toBe("2026-03-29T01:30:00.000Z");
    // Santiago 6-sep: 00:00 y 00:30 no existen → 01:00 y 01:30 de verano.
    expect(tz.instanteDe("2026-09-06", "00:00", SCL).toISOString()).toBe("2026-09-06T04:00:00.000Z");
    expect(tz.instanteDe("2026-09-06", "00:30", SCL).toISOString()).toBe("2026-09-06T04:30:00.000Z");
    expect(tz.horaLocalDe(tz.instanteDe("2026-09-06", "00:30", SCL), SCL)).toBe("01:30");
  });

  test("una hora repetida toma la primera vez que ocurre", () => {
    // Madrid 25-oct: 02:30 ocurre en verano (00:30Z) y otra vez en invierno (01:30Z).
    expect(tz.instanteDe("2026-10-25", "02:30", MAD).toISOString()).toBe("2026-10-25T00:30:00.000Z");
    // Santiago 4-abr: 23:30 ocurre a las 02:30Z y otra vez a las 03:30Z.
    expect(tz.instanteDe("2026-04-04", "23:30", SCL).toISOString()).toBe("2026-04-05T02:30:00.000Z");
  });

  test("ida y vuelta: diaLocalDe/horaLocalDe devuelven el día y la hora pedidos", () => {
    for (const zona of [BOG, MAD, SCL]) {
      for (const d of ["2026-01-15", "2026-02-28", "2026-03-29", "2026-04-04", "2026-09-27", "2026-10-25", "2028-02-29"]) {
        for (const h of ["00:00", "06:15", "12:00", "19:30", "23:59"]) {
          const t = tz.instanteDe(d, h, zona);
          expect([zona, d, h, tz.diaLocalDe(t, zona), tz.horaLocalDe(t, zona)]).toEqual([zona, d, h, d, h]);
        }
      }
    }
  });

  test("día inválido da una fecha inválida (no un instante cualquiera)", () => {
    expect(Number.isNaN(tz.instanteDe("", "10:00", BOG).getTime())).toBe(true);
  });
});

describe("mostrar días sin parsearlos como UTC", () => {
  test("todos los estilos de fmtDia", () => {
    expect(tz.fmtDia("2026-09-26", "corto")).toBe("26 sep 2026");
    expect(tz.fmtDia("2026-09-26", "dia-mes")).toBe("26 sep");
    expect(tz.fmtDia("2026-09-26", "semana-dia")).toBe("sáb 26");
    expect(tz.fmtDia("2026-09-27", "semana-dia")).toBe("dom 27");
    expect(tz.fmtDia("2026-09-26", "largo")).toBe("sábado 26 de septiembre");
    expect(tz.fmtDia("2026-09-26", "completo")).toBe("sábado 26 de septiembre de 2026");
    expect(tz.fmtDia("2026-09-26", "mes-anio")).toBe("septiembre 2026");
    expect(tz.fmtDia("2028-02-29", "largo")).toBe("martes 29 de febrero");
    expect(tz.fmtDia("2026-09-26")).toBe("26 sep 2026");
    expect(tz.fmtDia("")).toBe("");
    expect(tz.fmtDia("26/09/2026")).toBe("");
  });

  test("etiquetaRango de cada periodo", () => {
    jest.useFakeTimers({ now: new Date("2026-09-27T00:30:00Z") });
    expect(tz.etiquetaRango(tz.rangoDePeriodo("dia", BOG))).toBe("Hoy");
    expect(tz.etiquetaRango(tz.rangoDePeriodo("dia", BOG, "2026-09-25"))).toBe("viernes 25 de septiembre");
    expect(tz.etiquetaRango(tz.rangoDePeriodo("semana", BOG, "2026-09-26"))).toBe("21 – 27 sep 2026");
    expect(tz.etiquetaRango(tz.rangoDePeriodo("mes", BOG, "2026-09-26"))).toBe("septiembre 2026");
    expect(tz.etiquetaRango(tz.rangoPersonalizado("2026-09-26", "2026-09-26", BOG))).toBe("26 sep 2026");
    expect(tz.etiquetaRango(tz.rangoPersonalizado("2025-12-20", "2026-01-10", BOG))).toBe("20 dic 2025 – 10 ene 2026");
  });

  test("fechaDeDia es mediodía local del mismo día (para pickers)", () => {
    const d = tz.fechaDeDia("2026-09-26");
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 8, 26, 12]);
    expect(Number.isNaN(tz.fechaDeDia("x").getTime())).toBe(true);
  });
});

describe("rangos personalizados", () => {
  test("se ordenan, cuentan días y se corren por su largo", () => {
    const r = tz.rangoPersonalizado("2026-03-31", "2026-03-01", MAD);
    expect([r.periodo, r.desde, r.hasta, r.dias, r.timeZone]).toEqual(["personalizado", "2026-03-01", "2026-03-31", 31, MAD]);
    expect(r.desdeUTC).toBe("2026-02-28T23:00:00.000Z");
    expect(r.hastaUTC).toBe("2026-03-31T21:59:59.999Z");
    const sig = tz.rangoSiguiente(r);
    expect([sig.desde, sig.hasta, sig.dias]).toEqual(["2026-04-01", "2026-05-01", 31]);
  });

  test("el mismo rango en otra zona cambia la ventana UTC, no los días", () => {
    const bog = tz.rangoPersonalizado("2026-09-01", "2026-09-30", BOG);
    const mad = tz.rangoPersonalizado("2026-09-01", "2026-09-30", MAD);
    expect([bog.desde, bog.hasta]).toEqual([mad.desde, mad.hasta]);
    expect(bog.desdeUTC).toBe("2026-09-01T05:00:00.000Z");
    expect(mad.desdeUTC).toBe("2026-08-31T22:00:00.000Z");
  });
});

describe("zona del negocio y entradas raras", () => {
  test("zonaDelNegocio, etiquetaZona y zona activa", () => {
    expect(tz.zonaDelNegocio({ timezone: MAD })).toBe(MAD);
    expect(tz.zonaDelNegocio({ timezone: "" })).toBe(tz.ZONA_POR_DEFECTO);
    expect(tz.zonaDelNegocio(null)).toBe(tz.ZONA_POR_DEFECTO);
    expect(tz.etiquetaZona(SCL)).toBe("Chile — Santiago");
    expect(tz.etiquetaZona("Asia/Tokyo")).toBe("Asia/Tokyo");
    tz.establecerZonaActiva(SCL);
    expect(tz.zonaActiva()).toBe(SCL);
    expect(tz.inicioDelDiaUTC("2026-07-01")).toBe("2026-07-01T04:00:00.000Z");
    expect(tz.diaLocalDe("2026-07-01T03:30:00Z")).toBe("2026-06-30");
    tz.establecerZonaActiva("");
    expect(tz.zonaActiva()).toBe(tz.ZONA_POR_DEFECTO);
    tz.establecerZonaActiva(undefined);
    expect(tz.zonaActiva()).toBe(tz.ZONA_POR_DEFECTO);
  });

  test("entradas vacías o inválidas no lanzan", () => {
    expect(tz.diaLocalDe("")).toBe("");
    expect(tz.diaLocalDe("no es fecha")).toBe("");
    expect(tz.diaLocalDe(new Date(NaN))).toBe("");
    expect(tz.horaLocalDe("")).toBe("");
    expect(tz.minutosDelDia("")).toBe(0);
    expect(tz.sumarDias("2026-13", 1)).toBe("");
    expect(tz.inicioDeMes("")).toBe("");
    expect(tz.finDeMes("")).toBe("");
    expect(tz.inicioDeAnio("")).toBe("");
    expect(tz.mesDe("2026-09-26")).toBe("2026-09");
    expect(tz.diasEntre("2026-09-10", "2026-09-01")).toBe(0);
    expect(tz.listaDeDias("2026-09-10", "2026-09-01")).toEqual([]);
    expect(tz.moverReferencia("mes", "x", 1)).toBe("x");
  });

  test("una zona que el motor no conoce cae al comportamiento anterior sin romper", () => {
    expect(tz.inicioDelDiaUTC("2026-09-26", "Marte/Base")).toBe("2026-09-26T00:00:00");
    expect(tz.finDelDiaUTC("2026-09-26", "Marte/Base")).toBe("2026-09-26T23:59:59");
    expect(tz.diaLocalDe("2026-09-27T01:30:00Z", "Marte/Base")).toBe("2026-09-27");
  });

  test("motor sin soporte de timeZone (Hermes viejo): mismo resultado que antes, nunca un error", () => {
    const Original = Intl.DateTimeFormat;
    const spy = jest.spyOn(Intl, "DateTimeFormat").mockImplementation(((loc?: string, o?: Intl.DateTimeFormatOptions) => {
      if (o?.timeZone) throw new RangeError("timeZone no soportado");
      return new Original(loc, o);
    }) as unknown as typeof Intl.DateTimeFormat);
    try {
      jest.isolateModules(() => {
        // Copia nueva del módulo: la caché de formateadores empieza vacía.
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- copia aislada del módulo
        const t = require("@/lib/tz") as typeof tz;
        expect(t.soportaZonas()).toBe(false);
        expect(t.inicioDelDiaUTC("2026-09-26", BOG)).toBe("2026-09-26T00:00:00");
        expect(t.finDelDiaUTC("2026-09-26", BOG)).toBe("2026-09-26T23:59:59");
        expect(t.diaLocalDe("2026-09-27T01:30:00Z", BOG)).toBe("2026-09-27");
        expect(t.rangoDePeriodo("semana", BOG, "2026-09-26").desde).toBe("2026-09-21");
        expect(t.fmtDia("2026-09-26", "largo")).toBe("sábado 26 de septiembre");
      });
    } finally {
      spy.mockRestore();
    }
  });

  test("el formateador se crea una vez por zona (agrupar miles de filas no lo recrea)", () => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- copia aislada del módulo
      const t = require("@/lib/tz") as typeof tz;
      const spy = jest.spyOn(Intl, "DateTimeFormat");
      try {
        for (let i = 0; i < 500; i++) t.diaLocalDe(new Date(ms("2026-09-01T00:00:00Z") + i * 3_600_000), BOG);
        for (let i = 0; i < 50; i++) t.inicioDelDiaUTC(t.sumarDias("2026-03-01", i), MAD);
        expect(spy.mock.calls.length).toBeLessThanOrEqual(2);
      } finally {
        spy.mockRestore();
      }
    });
  });
});
