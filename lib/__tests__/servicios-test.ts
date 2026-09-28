import {
  normalizarEtiquetas, etiquetasDesdeTexto, textoDeEtiquetas,
  duracionDe, parsearDuracion, parsearPrecio, textoDePrecio,
  COLOR_ETIQUETA_POR_DEFECTO, COLORES_ETIQUETA,
} from "@/lib/servicios";

describe("normalizarEtiquetas", () => {
  test("lee strings (formato viejo del móvil) y objetos (formato del web)", () => {
    expect(normalizarEtiquetas(["corte", { name: "Color", color: "#3b82f6" }])).toEqual([
      { name: "corte", color: COLOR_ETIQUETA_POR_DEFECTO },
      { name: "Color", color: "#3b82f6" },
    ]);
  });

  test("null, basura y vacíos dan un arreglo, nunca null", () => {
    expect(normalizarEtiquetas(null)).toEqual([]);
    expect(normalizarEtiquetas("corte")).toEqual([]);
    expect(normalizarEtiquetas(["", "  ", { name: "" }, 3, null])).toEqual([]);
  });

  test("quita duplicados sin importar mayúsculas y corrige colores inválidos", () => {
    expect(normalizarEtiquetas(["Corte", "corte", { name: "x", color: "rojo" }])).toEqual([
      { name: "Corte", color: COLOR_ETIQUETA_POR_DEFECTO },
      { name: "x", color: COLOR_ETIQUETA_POR_DEFECTO },
    ]);
  });
});

describe("etiquetasDesdeTexto", () => {
  test("conserva el color de las etiquetas que ya existían", () => {
    const previas = [{ name: "Color", color: "#8b5cf6" }];
    expect(etiquetasDesdeTexto("color, express", previas)).toEqual([
      { name: "color", color: "#8b5cf6" },
      { name: "express", color: COLORES_ETIQUETA[1] },
    ]);
  });

  test("texto vacío da []", () => {
    expect(etiquetasDesdeTexto(" , ,")).toEqual([]);
  });

  test("ida y vuelta con textoDeEtiquetas", () => {
    const tags = etiquetasDesdeTexto("cabello, tintura");
    expect(textoDeEtiquetas(tags)).toBe("cabello, tintura");
  });
});

describe("duración", () => {
  test("duration_minutes manda sobre duration_min", () => {
    expect(duracionDe({ duration_minutes: 60, duration_min: 30 })).toBe(60);
    expect(duracionDe({ duration_min: 45 })).toBe(45);
    expect(duracionDe({})).toBe(30);
  });

  test("valida enteros entre 5 y 480", () => {
    expect(parsearDuracion("45")).toEqual({ ok: true, valor: 45 });
    expect(parsearDuracion("")).toEqual({ ok: true, valor: 30 });
    expect(parsearDuracion("-30").ok).toBe(false);
    expect(parsearDuracion("1.5").ok).toBe(false);
    expect(parsearDuracion("2").ok).toBe(false);
    expect(parsearDuracion("600").ok).toBe(false);
  });
});

describe("parsearPrecio", () => {
  test("separadores de miles en pesos", () => {
    expect(parsearPrecio("25.000")).toEqual({ ok: true, valor: 25000 });
    expect(parsearPrecio("25,000")).toEqual({ ok: true, valor: 25000 });
    expect(parsearPrecio("$ 1.250.000")).toEqual({ ok: true, valor: 1250000 });
    expect(parsearPrecio("12500.00")).toEqual({ ok: true, valor: 12500 });
  });

  test("decimales en monedas que los usan", () => {
    expect(parsearPrecio("19,99", "USD")).toEqual({ ok: true, valor: 19.99 });
    expect(parsearPrecio("1.234,5", "EUR")).toEqual({ ok: true, valor: 1234.5 });
  });

  test("el precio 0 es válido; negativos y letras no", () => {
    expect(parsearPrecio("0")).toEqual({ ok: true, valor: 0 });
    expect(parsearPrecio("-30").ok).toBe(false);
    expect(parsearPrecio("abc").ok).toBe(false);
    expect(parsearPrecio("").ok).toBe(false);
  });

  test("textoDePrecio precarga sin separadores", () => {
    expect(textoDePrecio(25000)).toBe("25000");
    expect(textoDePrecio(19.9)).toBe("19.90");
    expect(textoDePrecio(null)).toBe("");
  });
});
