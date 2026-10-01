import type { Colilla } from "@/lib/nomina";
import { MAX_LINEAS_TEXTO, textoColilla } from "@/components/nomina/ColillaTexto";


// Sin red: lib/nomina usa authedFetch, que arranca el cliente de Supabase.
jest.mock("@/lib/supabase", () => ({ supabase: {} }));
// La colilla en texto (para Share): los montos son los que guardó el servidor
// al liquidar; aquí solo se arma el texto, con fechas en la zona del negocio.

const ZONA = "America/Bogota";

function colilla(p: Partial<Colilla["liquidacion"]> = {}, extra: Partial<Colilla> = {}): Colilla {
  return {
    liquidacion: {
      id: "3a5998b9-9ab9-464b-9f80-3cc890ecb2e5",
      professional_id: "pro-1",
      period_start: "2026-10-01",
      period_end: "2026-10-15",
      appointments_count: 12,
      service_sales: 480000,
      service_commission: 96000,
      product_sales: 50000,
      product_commission: 5000,
      base_amount: 600000,
      base_days: 15,
      tips_amount: 10000,
      bonus_amount: 0,
      deduction_amount: 50000,
      total_amount: 661000,
      note: "Pago por Nequi",
      // 16-oct 1:30 AM UTC = 15-oct 8:30 PM en Bogotá.
      paid_at: "2026-10-16T01:30:00Z",
      detail: {
        version: 1,
        profesional: "Laura Gómez",
        desde: "2026-10-01",
        hasta: "2026-10-15",
        basico: { salario: 1_300_000, periodo: "mensual", desde: "2026-01-01", tramos: [], dias: 15, monto: 600000, manual: true, calculado: 650000 },
        lineas: [
          { tipo: "servicio", dia: "2026-10-03", hora: "10:30:00", cliente: "Ana", nombre: "Corte", cantidad: 1, valor: 40000, comision: 16000, regla: "general" },
          { tipo: "producto", dia: "2026-10-04", hora: null, cliente: null, nombre: "Cera", cantidad: 2, valor: 50000, comision: 5000, regla: "producto" },
        ],
        novedades: [
          { kind: "tip", amount: 10000, entry_date: "2026-10-03", concept: null, source: "caja" },
          { kind: "deduction", amount: 50000, entry_date: "2026-10-05", concept: "Adelanto", source: "manual" },
        ],
      },
      ...p,
    },
    profesional: { nombre: "Laura Gómez", cargo: "Estilista" },
    negocio: { nombre: "Imperio Capilar", logo: null },
    ...extra,
  };
}

describe("textoColilla", () => {
  test("lleva negocio, profesional, periodo, desglose, total, nota y líneas", () => {
    const texto = textoColilla(colilla(), ZONA);
    expect(texto).toContain("*Imperio Capilar* · Colilla de pago");
    expect(texto).toContain("Laura Gómez · Estilista");
    expect(texto).toContain("Periodo: 1 – 15 oct 2026");
    // El día del pago es el del negocio, no el de UTC.
    expect(texto).toContain("Pagado el 15 oct 2026");
    expect(texto).toContain("Comisión por servicios (12 citas · $480.000): $96.000");
    expect(texto).toContain("Comisión por productos ($50.000): $5.000");
    expect(texto).toContain("Básico (15 días de $1.300.000 mensual, ajustado; calculado $650.000): $600.000");
    expect(texto).toContain("Propina (3 oct): $10.000");
    expect(texto).toContain("Descuento o adelanto · Adelanto (5 oct): −$50.000");
    expect(texto).toContain("*Total pagado: $661.000*");
    expect(texto).toContain("Nota: Pago por Nequi");
    expect(texto).toContain("• 3 oct 10:30 AM · Ana · Corte: $40.000 → $16.000");
    expect(texto).toContain("• 4 oct · Sin cliente · Cera ×2 (producto): $50.000 → $5.000");
    expect(texto).toContain("Generada con Zyncra · 3a5998b9");
  });

  test("total negativo: saldo a favor del negocio", () => {
    const texto = textoColilla(colilla({ total_amount: -20000 }), ZONA);
    expect(texto).toContain("*Saldo a favor del negocio: $20.000*");
    expect(texto).not.toContain("Total pagado");
  });

  test("sin productos, sin básico y sin nota no muestra esas filas", () => {
    const c = colilla({ product_sales: 0, product_commission: 0, base_amount: 0, base_days: 0, note: null });
    c.liquidacion.detail = { ...c.liquidacion.detail!, basico: null };
    const texto = textoColilla(c, ZONA);
    expect(texto).not.toContain("Comisión por productos");
    expect(texto).not.toContain("Básico");
    expect(texto).not.toContain("Nota:");
  });

  test("colilla sin detalle: usa los totales de novedades", () => {
    const texto = textoColilla(colilla({ detail: null }), ZONA);
    expect(texto).toContain("Básico (15 días): $600.000");
    expect(texto).toContain("Propinas: $10.000");
    expect(texto).toContain("Descuentos y adelantos: −$50.000");
    expect(texto).not.toContain("Citas y ventas");
  });

  test("corta las líneas largas", () => {
    const c = colilla();
    const base = c.liquidacion.detail!.lineas[0];
    c.liquidacion.detail = { ...c.liquidacion.detail!, lineas: Array.from({ length: MAX_LINEAS_TEXTO + 5 }, () => base) };
    const texto = textoColilla(c, ZONA);
    expect(texto.split("\n").filter(x => x.startsWith("• "))).toHaveLength(MAX_LINEAS_TEXTO);
    expect(texto).toContain("… y 5 líneas más.");
  });
});
