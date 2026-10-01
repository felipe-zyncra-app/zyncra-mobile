import { ErrorNomina, type Linea, type Pendiente } from "@/lib/nomina";
import {
  agruparPorCita, basicoManualDe, estadoAcceso, etiquetaNovedad, horaCorta, mensajeNomina,
  textoBasico, textoSinCerrar, totalConBasico,
} from "@/components/nomina/ResumenTextos";
import { unirPaginas } from "@/components/nomina/HistorialComun";


// Sin red: lib/nomina usa authedFetch, que arranca el cliente de Supabase.
jest.mock("@/lib/supabase", () => ({ supabase: {} }));
// Ayudas de presentación de la nómina: no calculan la nómina (eso es del
// servidor), solo acomodan lo que llega de /api/nomina/* para mostrarlo.

function linea(p: Partial<Linea>): Linea {
  return {
    tipo: "servicio", professional_id: "pro-1", dia: "2026-10-03", cita_id: null, venta_id: null,
    item_id: null, service_id: null, nombre: "Corte", cantidad: 1, valor: 40000, comision: 16000,
    regla: "general", cliente: "Ana", hora: "10:30:00", liquidada: false,
    ...p,
  };
}

const pendiente = (p: Partial<Pendiente> = {}): Pendiente => ({
  tramosComision: [], comisiones: { citas: 0, ventasServicios: 0, comisionServicios: 0, ventasProductos: 0, comisionProductos: 0 },
  basico: null, novedades: [], propinas: 0, bonos: 0, descuentos: 0, total: 0,
  ...p,
});

const basico = { salario: 1_300_000, periodo: "mensual" as const, desde: "2026-01-01", tramos: [], dias: 15, monto: 650_000 };

describe("mensajes de error de /api/nomina", () => {
  test("cada código de acceso tiene su texto, sin depender del mensaje en inglés", () => {
    expect(mensajeNomina(new ErrorNomina("Unauthorized", 401, "sin_sesion"))).toMatch(/sesión expiró/);
    expect(mensajeNomina(new ErrorNomina("x", 403, "sin_montos"))).toBe("Tu negocio no tiene activado que veas montos.");
    expect(mensajeNomina(new ErrorNomina("x", 403, "solo_dueno"))).toMatch(/Solo el dueño/);
  });

  test("sin código usa el texto del servidor si está en español, o un respaldo", () => {
    expect(mensajeNomina(new ErrorNomina("La nómina cambió mientras la revisabas.", 409, "cambio")))
      .toBe("La nómina cambió mientras la revisabas.");
    expect(mensajeNomina(new ErrorNomina("Internal server error", 500))).toMatch(/No se pudo completar/);
    expect(mensajeNomina(new Error("Network request failed"))).toMatch(/conexión/);
  });

  test("estadoAcceso: 401/403 bloquean la vista; el resto se reintenta", () => {
    expect(estadoAcceso(new ErrorNomina("x", 403, "sin_montos"))?.texto).toMatch(/no tiene activado que veas montos/);
    expect(estadoAcceso(new ErrorNomina("x", 403, "sin_ficha"))?.titulo).toBe("Sin ficha de profesional");
    expect(estadoAcceso(new ErrorNomina("x", 401, "sin_sesion"))?.titulo).toBe("Sesión vencida");
    expect(estadoAcceso(new ErrorNomina("No se pudo calcular la nómina", 500))).toBeNull();
    expect(estadoAcceso(new Error("Network request failed"))).toBeNull();
    expect(estadoAcceso(null)).toBeNull();
  });
});

describe("textos", () => {
  test("básico, novedades, horas y citas sin cerrar", () => {
    expect(textoBasico(basico)).toBe("15 días de $1.300.000 mensual");
    expect(textoBasico({ ...basico, dias: 1, periodo: "semanal" })).toBe("1 día de $1.300.000 semanal");
    expect(etiquetaNovedad({ kind: "tip", concept: null })).toBe("Propina");
    expect(etiquetaNovedad({ kind: "bonus", concept: " Meta " })).toBe("Bonificación · Meta");
    expect(horaCorta("14:05:00")).toBe("2:05 PM");
    expect(horaCorta(null)).toBeNull();
    expect(textoSinCerrar(1)).toMatch(/^Hay 1 cita pasada/);
    expect(textoSinCerrar(3)).toMatch(/^Hay 3 citas pasadas/);
  });
});

describe("agruparPorCita", () => {
  test("junta los servicios de la misma cita y deja fuera los productos", () => {
    const grupos = agruparPorCita([
      linea({ cita_id: "c1", nombre: "Corte", valor: 40000, comision: 16000, liquidada: true }),
      linea({ cita_id: "c1", nombre: "Barba", valor: 20000, comision: 8000, liquidada: false }),
      linea({ cita_id: "c2", nombre: "Tinte", dia: "2026-10-04", cliente: "Luis" }),
      linea({ tipo: "producto", venta_id: "v9", nombre: "Cera", regla: "producto" }),
      linea({ cita_id: null, venta_id: "v3", nombre: "Corte", cliente: null }),
    ]);
    expect(grupos.map(g => g.clave)).toEqual(["cita:c1", "cita:c2", "venta:v3"]);
    expect(grupos[0]).toMatchObject({ valor: 60000, comision: 24000, liquidada: false, sinCita: false });
    expect(grupos[0].lineas.map(l => l.nombre)).toEqual(["Corte", "Barba"]);
    expect(grupos[2].sinCita).toBe(true);
  });
});

describe("liquidar con el básico ajustado", () => {
  test("el total es el del servidor con el básico cambiado por el escrito", () => {
    const pend = pendiente({ basico, total: 700_000 });
    expect(totalConBasico(pend, 650_000)).toBe(700_000);
    expect(totalConBasico(pend, 500_000)).toBe(550_000);
    // Sin básico (o sin número escrito) es el total del servidor tal cual.
    expect(totalConBasico(pendiente({ total: 90_000 }), 10)).toBe(90_000);
    expect(totalConBasico(pend, null)).toBe(700_000);
  });

  test("basicoManual solo viaja si cambió", () => {
    const pend = pendiente({ basico });
    expect(basicoManualDe(pend, 650_000)).toBeNull();
    expect(basicoManualDe(pend, 650_000.4)).toBeNull();
    expect(basicoManualDe(pend, 0)).toBe(0);
    expect(basicoManualDe(pend, 600_000)).toBe(600_000);
    expect(basicoManualDe(pendiente(), 600_000)).toBeNull();
  });
});

describe("historial", () => {
  test("unirPaginas no repite filas que ya estaban", () => {
    const it = (id: string, tipo: "nomina" | "comision" = "nomina") => ({
      tipo, id, professional_id: "p", profesional: "Ana", period_start: "2026-10-01", period_end: "2026-10-15",
      appointments_count: 1, service_sales: 1, service_commission: 1, total_amount: 1, note: null, paid_at: "2026-10-16T12:00:00Z",
    });
    const r = unirPaginas([it("a"), it("b")], [it("b"), it("b", "comision"), it("c")]);
    expect(r.map(x => `${x.tipo}-${x.id}`)).toEqual(["nomina-a", "nomina-b", "comision-b", "nomina-c"]);
  });
});
