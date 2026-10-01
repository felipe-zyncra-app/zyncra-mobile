import {
  armarReglasServicio, buscarServicios, diasDeBasicoAtras, esFechaReal, filasReglasServicio, fmtPorcentaje,
  formPagoInicial, formServicioInicial, leerPorcentaje, leerValorRegla, mismaRegla,
  mismasReglasServicio, mismoPerfil, motivoNoEditable, novedadEditable, resumenReglasServicio,
  textoRegla, totalesNovedades, validarNovedad, validarPago, validarValorRegla, valorReglaATexto,
  type FormNovedad, type FormPago, type FormServicio,
} from "@/lib/nomina-reglas";
import { configurarMoneda } from "@/lib/format";

// Reglas y novedades de la nómina que el dueño escribe directo en la base.
// Los topes son los de la migración 20261001_nomina (repo web).

afterEach(() => configurarMoneda());

const HOY = "2026-10-01";

describe("lectura de valores", () => {
  test("esFechaReal rechaza fechas que no existen", () => {
    expect(esFechaReal("2026-10-01")).toBe(true);
    expect(esFechaReal("2024-02-29")).toBe(true);
    expect(esFechaReal("2026-02-29")).toBe(false);
    expect(esFechaReal("2026-13-01")).toBe(false);
    expect(esFechaReal("2026-10-1")).toBe(false);
    expect(esFechaReal("")).toBe(false);
  });

  test("leerPorcentaje acepta coma, punto y % pero no lo acota", () => {
    expect(leerPorcentaje("40")).toBe(40);
    expect(leerPorcentaje("12,5")).toBe(12.5);
    expect(leerPorcentaje("12.5")).toBe(12.5);
    expect(leerPorcentaje(" 40 % ")).toBe(40);
    expect(leerPorcentaje("150")).toBe(150);
    expect(leerPorcentaje("0")).toBe(0);
    expect(leerPorcentaje("")).toBeNull();
    expect(leerPorcentaje("abc")).toBeNull();
    expect(leerPorcentaje("-5")).toBeNull();
    expect(leerPorcentaje("1.2.3")).toBeNull();
  });

  test("leerValorRegla: % con decimales, fijo como monto de la moneda", () => {
    expect(leerValorRegla("percentage", "12,5")).toBe(12.5);
    expect(leerValorRegla("fixed", "10.000")).toBe(10000);
    expect(leerValorRegla("fixed", "")).toBeNull();
  });

  test("validarValorRegla: % entre 0 y 100, fijo ≥ 0", () => {
    expect(validarValorRegla("percentage", "40", "la comisión general")).toEqual({ ok: true, valor: 40 });
    expect(validarValorRegla("percentage", "0", "x")).toEqual({ ok: true, valor: 0 });
    expect(validarValorRegla("fixed", "0", "x")).toEqual({ ok: true, valor: 0 });
    expect(validarValorRegla("percentage", "101", "la comisión general"))
      .toEqual({ ok: false, error: "El porcentaje de la comisión general no puede pasar de 100." });
    expect(validarValorRegla("percentage", "", "la comisión de Ana"))
      .toEqual({ ok: false, error: "Escribe el valor de la comisión de Ana." });
    expect(validarValorRegla("fixed", "abc", "x").ok).toBe(false);
    expect(validarValorRegla("fixed", "2000000000", "x").ok).toBe(false);
  });

  test("valorReglaATexto se vuelve a leer igual", () => {
    expect(valorReglaATexto("percentage", 12.5)).toBe("12.5");
    expect(leerPorcentaje(valorReglaATexto("percentage", 12.5))).toBe(12.5);
    expect(valorReglaATexto("fixed", 15000)).toBe("15000");
    expect(valorReglaATexto("fixed", 0)).toBe("0");
    expect(valorReglaATexto("percentage", 0)).toBe("0");
  });

  test("textoRegla", () => {
    expect(textoRegla(null)).toBe("—");
    expect(textoRegla({ type: "percentage", value: 40 })).toBe("40%");
    expect(fmtPorcentaje(12.5)).toBe("12,5%");
    expect(textoRegla({ type: "fixed", value: 10000 })).toBe("$10.000");
    expect(textoRegla({ type: "fixed", value: 10000 }, true)).toBe("$10.000 por cita");
  });
});

describe("novedades", () => {
  const base: FormNovedad = { professional_id: "p1", kind: "bonus", monto: "50.000", entry_date: HOY, concept: "  Meta de  septiembre " };

  test("arma la fila con el monto leído y el concepto limpio", () => {
    expect(validarNovedad(base, HOY)).toEqual({
      ok: true,
      valor: { professional_id: "p1", kind: "bonus", amount: 50000, entry_date: HOY, concept: "Meta de septiembre" },
    });
    const sinConcepto = validarNovedad({ ...base, concept: "   " }, HOY);
    expect(sinConcepto.ok && sinConcepto.valor.concept).toBeNull();
  });

  test("exige profesional, monto mayor que cero y una fecha real", () => {
    expect(validarNovedad({ ...base, professional_id: null }, HOY))
      .toEqual({ ok: false, error: "Elige a quién es la novedad." });
    expect(validarNovedad({ ...base, monto: "" }, HOY))
      .toEqual({ ok: false, error: "Escribe un monto mayor que cero." });
    expect(validarNovedad({ ...base, monto: "0" }, HOY).ok).toBe(false);
    expect(validarNovedad({ ...base, monto: "2.000.000.000" }, HOY).ok).toBe(false);
    expect(validarNovedad({ ...base, entry_date: "2026-02-30" }, HOY).ok).toBe(false);
    expect(validarNovedad({ ...base, kind: "regalo" as never }, HOY).ok).toBe(false);
  });

  test("la fecha puede ser futura, pero no más de un año", () => {
    expect(validarNovedad({ ...base, entry_date: "2026-10-16" }, HOY).ok).toBe(true);
    expect(validarNovedad({ ...base, entry_date: "2027-10-02" }, HOY).ok).toBe(true);
    expect(validarNovedad({ ...base, entry_date: "2027-10-03" }, HOY).ok).toBe(false);
    expect(validarNovedad({ ...base, entry_date: "1999-12-31" }, HOY).ok).toBe(false);
  });

  test("con centavos respeta el decimal", () => {
    configurarMoneda("USD", "en-US");
    const r = validarNovedad({ ...base, monto: "12.50" }, HOY);
    expect(r.ok && r.valor.amount).toBe(12.5);
  });

  test("solo las manuales sin pagar se editan, y las demás dicen por qué", () => {
    expect(novedadEditable({ source: "manual", statement_id: null })).toBe(true);
    expect(novedadEditable({ source: "manual", statement_id: "s1" })).toBe(false);
    expect(novedadEditable({ source: "caja", statement_id: null })).toBe(false);
    expect(novedadEditable({ source: "pos", statement_id: null })).toBe(false);
    expect(motivoNoEditable({ source: "manual", statement_id: null })).toBeNull();
    expect(motivoNoEditable({ source: "manual", statement_id: "s1" })).toMatch(/Ya se pagó/);
    expect(motivoNoEditable({ source: "caja", statement_id: null })).toMatch(/Caja/);
    expect(motivoNoEditable({ source: "pos", statement_id: null })).toMatch(/POS/);
    // Pagada pesa más que el origen.
    expect(motivoNoEditable({ source: "pos", statement_id: "s1" })).toMatch(/Ya se pagó/);
  });

  test("totales de la lista: propinas y bonos suman, descuentos restan", () => {
    expect(totalesNovedades([
      { kind: "tip", amount: 5000 },
      { kind: "tip", amount: "2500" },
      { kind: "bonus", amount: 20000 },
      { kind: "deduction", amount: 10000 },
    ])).toEqual({ propinas: 7500, bonos: 20000, descuentos: 10000, neto: 17500 });
    expect(totalesNovedades([])).toEqual({ propinas: 0, bonos: 0, descuentos: 0, neto: 0 });
  });
});

describe("pago de cada profesional", () => {
  const form = (cambios: Partial<FormPago> = {}): FormPago => ({
    general: { tipo: "percentage", valor: "40" },
    basico: "",
    periodo: "mensual",
    desde: HOY,
    pctProductos: "",
    ...cambios,
  });

  test("sin perfil y sin básico ni % de productos no crea perfil (productos siguen a la general)", () => {
    expect(validarPago(form(), { perfilExiste: false, hoy: HOY })).toEqual({
      ok: true,
      valor: { general: { type: "percentage", value: 40 }, perfil: null, borrarPerfil: false },
    });
  });

  test("con básico crea el perfil con su fecha; el % de productos vacío queda en null (= la general)", () => {
    const r = validarPago(form({ basico: "1.300.000", periodo: "quincenal", desde: "2026-09-16" }), { perfilExiste: false, hoy: HOY });
    expect(r).toEqual({
      ok: true,
      valor: {
        general: { type: "percentage", value: 40 },
        perfil: { base_salary: 1300000, base_period: "quincenal", base_since: "2026-09-16", product_commission_pct: null },
        borrarPerfil: false,
      },
    });
  });

  test("básico 0 y % vacío con perfil existente: se borra el perfil", () => {
    const r = validarPago(form({ basico: "", pctProductos: "" }), { perfilExiste: true, hoy: HOY });
    expect(r.ok && r.valor.perfil).toBeNull();
    expect(r.ok && r.valor.borrarPerfil).toBe(true);
  });

  test("sin básico la fecha queda en null aunque el perfil exista", () => {
    const r = validarPago(form({ basico: "", pctProductos: "10", desde: "fecha mala" }), { perfilExiste: true, hoy: HOY });
    expect(r.ok && r.valor.perfil).toEqual({ base_salary: 0, base_period: "mensual", base_since: null, product_commission_pct: 10 });
  });

  test("el % de productos vacío nunca copia la general (fija o ninguna)", () => {
    const fija = validarPago(form({ general: { tipo: "fixed", valor: "10.000" }, basico: "500000" }), { perfilExiste: false, hoy: HOY });
    expect(fija.ok && fija.valor.general).toEqual({ type: "fixed", value: 10000 });
    expect(fija.ok && fija.valor.perfil?.product_commission_pct).toBeNull();
    const sin = validarPago(form({ general: { tipo: "none", valor: "" }, pctProductos: "0" }), { perfilExiste: true, hoy: HOY });
    expect(sin.ok && sin.valor.general).toBeNull();
    expect(sin.ok && sin.valor.perfil?.product_commission_pct).toBe(0);
  });

  test("rechaza valores fuera de rango", () => {
    const ctx = { perfilExiste: false, hoy: HOY };
    expect(validarPago(form({ general: { tipo: "percentage", valor: "120" } }), ctx).ok).toBe(false);
    expect(validarPago(form({ general: { tipo: "percentage", valor: "" } }), ctx).ok).toBe(false);
    expect(validarPago(form({ basico: "abc" }), ctx).ok).toBe(false);
    expect(validarPago(form({ basico: "1000000", desde: "2026-02-30" }), ctx).ok).toBe(false);
    expect(validarPago(form({ basico: "1000000", desde: "2028-01-01" }), ctx).ok).toBe(false);
    expect(validarPago(form({ pctProductos: "101" }), ctx))
      .toEqual({ ok: false, error: "El % de productos no puede pasar de 100." });
    expect(validarPago(form({ pctProductos: "diez" }), ctx).ok).toBe(false);
    expect(validarPago(form({ periodo: "anual" as never, basico: "1" }), ctx).ok).toBe(false);
  });

  test("formPagoInicial precarga lo guardado y vuelve a validar igual", () => {
    const regla = { type: "percentage" as const, value: 35 };
    const perfil = { base_salary: 1300000, base_period: "quincenal" as const, base_since: "2026-09-16", product_commission_pct: 12.5 };
    const f = formPagoInicial(regla, perfil, HOY);
    expect(f).toEqual({
      general: { tipo: "percentage", valor: "35" },
      basico: "1300000",
      periodo: "quincenal",
      desde: "2026-09-16",
      pctProductos: "12.5",
    });
    const r = validarPago(f, { perfilExiste: true, hoy: HOY });
    expect(r.ok && mismaRegla(r.valor.general, regla)).toBe(true);
    expect(r.ok && mismoPerfil(r.valor.perfil, perfil)).toBe(true);

    expect(formPagoInicial(null, null, HOY)).toEqual({
      general: { tipo: "none", valor: "" }, basico: "", periodo: "mensual", desde: HOY, pctProductos: "",
    });
  });

  test("mismaRegla / mismoPerfil", () => {
    expect(mismaRegla(null, null)).toBe(true);
    expect(mismaRegla(null, { type: "fixed", value: 1 })).toBe(false);
    expect(mismaRegla({ type: "fixed", value: 1 }, { type: "percentage", value: 1 })).toBe(false);
    const p = { base_salary: 1, base_period: "mensual" as const, base_since: null, product_commission_pct: 0 };
    expect(mismoPerfil(p, { ...p })).toBe(true);
    expect(mismoPerfil(p, { ...p, base_since: HOY })).toBe(false);
    expect(mismoPerfil(null, p)).toBe(false);
  });

  test("diasDeBasicoAtras cuenta los días antes de hoy", () => {
    expect(diasDeBasicoAtras(HOY, HOY)).toBe(0);
    expect(diasDeBasicoAtras("2026-10-05", HOY)).toBe(0);
    expect(diasDeBasicoAtras("2026-09-30", HOY)).toBe(1);
    expect(diasDeBasicoAtras("2026-09-01", HOY)).toBe(30);
    expect(diasDeBasicoAtras("mala", HOY)).toBe(0);
  });
});

describe("comisión por servicio", () => {
  const activos = new Set(["ana", "luis"]);
  const nombres: Record<string, string> = { ana: "Ana", luis: "Luis", vieja: "Marta" };
  const guardadas = [
    { professional_id: null, type: "percentage" as const, value: 40 },
    { professional_id: "luis", type: "fixed" as const, value: 15000 },
    { professional_id: "ana", type: "percentage" as const, value: 50 },
    { professional_id: "vieja", type: "percentage" as const, value: 30 },
  ];

  test("formServicioInicial separa la de todos, las activas (por nombre) y las inactivas", () => {
    const f = formServicioInicial(guardadas, id => activos.has(id), id => nombres[id]);
    expect(f.todos).toEqual({ tipo: "percentage", valor: "40" });
    expect(f.personas.map(p => p.nombre)).toEqual(["Ana", "Luis"]);
    expect(f.personas[1]).toEqual({ professional_id: "luis", nombre: "Luis", tipo: "fixed", valor: "15000" });
    expect(f.conservar).toEqual([{ professional_id: "vieja", type: "percentage", value: 30 }]);
  });

  test("sin cambios, el conjunto armado es el mismo que el guardado (y no se reescribe)", () => {
    const f = formServicioInicial(guardadas, id => activos.has(id), id => nombres[id]);
    const r = armarReglasServicio(f);
    expect(r.ok).toBe(true);
    expect(r.ok && mismasReglasServicio(r.valor, guardadas)).toBe(true);
  });

  test("las reglas de inactivos se conservan al guardar", () => {
    const f: FormServicio = {
      todos: { tipo: "none", valor: "" },
      personas: [{ professional_id: "ana", nombre: "Ana", tipo: "percentage", valor: "45" }],
      conservar: [{ professional_id: "vieja", type: "percentage", value: 30 }],
    };
    expect(armarReglasServicio(f)).toEqual({
      ok: true,
      valor: [
        { professional_id: "ana", type: "percentage", value: 45 },
        { professional_id: "vieja", type: "percentage", value: 30 },
      ],
    });
  });

  test("valida cada valor, con el nombre de quien falla, y no deja a alguien dos veces", () => {
    const f: FormServicio = {
      todos: { tipo: "percentage", valor: "40" },
      personas: [{ professional_id: "ana", nombre: "Ana", tipo: "percentage", valor: "140" }],
      conservar: [],
    };
    expect(armarReglasServicio(f)).toEqual({ ok: false, error: "El porcentaje de la comisión de Ana no puede pasar de 100." });
    expect(armarReglasServicio({ ...f, todos: { tipo: "fixed", valor: "" } }))
      .toEqual({ ok: false, error: "Escribe el valor de la comisión para todos." });
    const doble = armarReglasServicio({
      ...f,
      personas: [
        { professional_id: "ana", nombre: "Ana", tipo: "percentage", valor: "10" },
        { professional_id: "ana", nombre: "Ana", tipo: "fixed", valor: "1000" },
      ],
    });
    expect(doble.ok).toBe(false);
  });

  test("un fijo de 0 vale: el servicio no paga comisión aunque la general sí", () => {
    const r = armarReglasServicio({ todos: { tipo: "fixed", valor: "0" }, personas: [], conservar: [] });
    expect(r).toEqual({ ok: true, valor: [{ professional_id: null, type: "fixed", value: 0 }] });
  });

  test("todo en 'sin regla' deja el servicio sin reglas", () => {
    expect(armarReglasServicio({ todos: { tipo: "none", valor: "" }, personas: [], conservar: [] }))
      .toEqual({ ok: true, valor: [] });
  });

  test("filasReglasServicio agrega negocio y servicio a cada regla", () => {
    expect(filasReglasServicio("t1", "s1", [
      { professional_id: null, type: "percentage", value: 40 },
      { professional_id: "ana", type: "fixed", value: 15000 },
    ])).toEqual([
      { tenant_id: "t1", service_id: "s1", professional_id: null, type: "percentage", value: 40 },
      { tenant_id: "t1", service_id: "s1", professional_id: "ana", type: "fixed", value: 15000 },
    ]);
  });

  test("mismasReglasServicio no depende del orden", () => {
    expect(mismasReglasServicio(guardadas, [...guardadas].reverse())).toBe(true);
    expect(mismasReglasServicio(guardadas, guardadas.slice(1))).toBe(false);
    expect(mismasReglasServicio(
      [{ professional_id: null, type: "percentage", value: 40 }],
      [{ professional_id: null, type: "percentage", value: 41 }],
    )).toBe(false);
  });

  test("buscarServicios ignora tildes y mayúsculas y busca en categoría y código", () => {
    const lista = [
      { id: "a", name: "Mantenimiento prótesis", category: "Prótesis", code: "101" },
      { id: "b", name: "Corte clásico", category: "Cortes", code: null },
      { id: "c", name: "Lavado", category: null },
    ];
    expect(buscarServicios(lista, "  ").map(s => s.id)).toEqual(["a", "b", "c"]);
    expect(buscarServicios(lista, "PROTESIS").map(s => s.id)).toEqual(["a"]);
    expect(buscarServicios(lista, "clasico").map(s => s.id)).toEqual(["b"]);
    expect(buscarServicios(lista, "cortes").map(s => s.id)).toEqual(["b"]);
    expect(buscarServicios(lista, "101").map(s => s.id)).toEqual(["a"]);
  });

  test("resumenReglasServicio", () => {
    expect(resumenReglasServicio(guardadas)).toEqual({ todos: "40%", distintas: 3 });
    expect(resumenReglasServicio([])).toEqual({ todos: null, distintas: 0 });
  });
});
