import {
  calcularComision, describirRegla, totalesEntre, completadasSinCobro, diasSinLiquidar,
  recortarHastaHoy, pagosQueSeCruzan, colorDeProfesional, cobradoDespuesDeLiquidar,
} from "@/lib/comisiones";
import { rangoDePeriodo } from "@/lib/tz";

describe("lib/comisiones", () => {
  test("regla porcentual y fija", () => {
    expect(calcularComision({ type: "percentage", value: 40 }, 100000, 3)).toBe(40000);
    expect(calcularComision({ type: "fixed", value: "20000" }, 100000, 3)).toBe(60000);
    expect(calcularComision(null, 100000, 3)).toBe(0);
    expect(describirRegla({ type: "percentage", value: 12.5 }, n => `$${n}`)).toBe("12.5% de lo cobrado");
    expect(describirRegla({ type: "fixed", value: 20000 }, n => `$${n}`)).toBe("$20000 por cita");
  });

  test("solo las citas cobradas generan comisión (D10)", () => {
    const citas = [
      { id: "a", appointment_date: "2026-09-21", status: "completed", pos_sales: [{ total: 45000 }] },
      { id: "b", appointment_date: "2026-09-22", status: "completed", pos_sales: [] },          // sin cobro
      { id: "c", appointment_date: "2026-09-23", status: "confirmed", pos_sales: [{ total: 10000 }] }, // cobrada y luego cambiada
      { id: "d", appointment_date: "2026-09-29", status: "completed", pos_sales: [{ total: 99999 }] }, // fuera del rango
    ];
    const t = totalesEntre(citas, { type: "percentage", value: 20 }, "2026-09-21", "2026-09-27");
    expect(t).toEqual({ citas: 2, ingresos: 55000, comision: 11000 });
    expect(completadasSinCobro(citas)).toBe(1);
  });

  test("la semana de comisiones incluye el lunes aunque sean las 8:30 PM en Bogotá (TZ-01)", () => {
    // Miércoles 23-sep 20:30 en Bogotá = 24-sep 01:30Z.
    jest.useFakeTimers().setSystemTime(new Date("2026-09-24T01:30:00Z"));
    try {
      const r = rangoDePeriodo("semana", "America/Bogota");
      expect([r.desde, r.hasta]).toEqual(["2026-09-21", "2026-09-27"]);
      const m = rangoDePeriodo("mes", "Europe/Madrid");
      expect([m.desde, m.hasta]).toEqual(["2026-09-01", "2026-09-30"]);
    } finally {
      jest.useRealTimers();
    }
  });

  test("liquidar dos veces la misma semana no vuelve a pagar los días ya liquidados (DIN-15)", () => {
    const pagos = [{ period_start: "2026-09-21", period_end: "2026-09-23" }];
    expect(diasSinLiquidar("2026-09-21", "2026-09-27", pagos)).toEqual([{ desde: "2026-09-24", hasta: "2026-09-27" }]);
    // Un pago en medio deja dos tramos.
    expect(diasSinLiquidar("2026-09-01", "2026-09-30", [{ period_start: "2026-09-08", period_end: "2026-09-14" }])).toEqual([
      { desde: "2026-09-01", hasta: "2026-09-07" },
      { desde: "2026-09-15", hasta: "2026-09-30" },
    ]);
    // Todo liquidado.
    expect(diasSinLiquidar("2026-09-21", "2026-09-27", [{ period_start: "2026-09-01", period_end: "2026-09-30" }])).toEqual([]);
    expect(pagosQueSeCruzan([{ period_start: "2026-08-25", period_end: "2026-09-02" }, { period_start: "2026-10-01", period_end: "2026-10-07" }], "2026-09-01", "2026-09-30")).toHaveLength(1);
  });

  test("no se marcan como pagados los días que aún no llegan", () => {
    expect(recortarHastaHoy([{ desde: "2026-09-01", hasta: "2026-09-30" }], "2026-09-15")).toEqual([{ desde: "2026-09-01", hasta: "2026-09-15" }]);
    expect(recortarHastaHoy([{ desde: "2026-09-20", hasta: "2026-09-30" }], "2026-09-15")).toEqual([]);
  });

  test("el color del profesional sale del id y es estable", () => {
    const c = colorDeProfesional("3a5998b9-9ab9-464b-9f80-3cc890ecb2e5");
    expect(c).toMatch(/^#[0-9a-f]{6}$/i);
    expect(colorDeProfesional("3a5998b9-9ab9-464b-9f80-3cc890ecb2e5")).toBe(c);
    expect(colorDeProfesional(null)).toMatch(/^#/);
  });

  test("cobros de días ya liquidados que no entraron en la liquidación", () => {
    const citas = [
      { id: "a", appointment_date: "2026-09-21", status: "completed", pos_sales: [{ total: 30000 }] },
      // Vencida cobrada después de liquidar el lunes a miércoles:
      { id: "b", appointment_date: "2026-09-22", status: "completed", pos_sales: [{ total: 45000 }] },
      { id: "c", appointment_date: "2026-09-25", status: "completed", pos_sales: [{ total: 20000 }] },
    ];
    const pago = { period_start: "2026-09-21", period_end: "2026-09-23", appointments_count: 1, revenue_total: 30000 };
    expect(cobradoDespuesDeLiquidar(citas, [pago], "2026-09-21", "2026-09-27")).toEqual({ citas: 1, ingresos: 45000 });
    // Liquidación completa: nada pendiente.
    expect(cobradoDespuesDeLiquidar(citas, [{ ...pago, appointments_count: 2, revenue_total: 75000 }], "2026-09-21", "2026-09-27"))
      .toEqual({ citas: 0, ingresos: 0 });
    // Una liquidación vieja que valoró más (precio de lista) no da negativos.
    expect(cobradoDespuesDeLiquidar(citas, [{ ...pago, appointments_count: 3, revenue_total: 90000 }], "2026-09-21", "2026-09-27"))
      .toEqual({ citas: 0, ingresos: 0 });
    // Una liquidación que se sale del rango (el mes visto desde la semana) no se compara.
    expect(cobradoDespuesDeLiquidar(citas, [{ ...pago, period_start: "2026-09-01", period_end: "2026-09-30" }], "2026-09-21", "2026-09-27"))
      .toEqual({ citas: 0, ingresos: 0 });
  });
});
