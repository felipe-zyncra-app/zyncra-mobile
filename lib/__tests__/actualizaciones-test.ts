import { debeAvisar, fechaCorta, sePuedeRevisar, textoVersion } from "@/lib/actualizaciones";

describe("lib/actualizaciones", () => {
  const creada = new Date(2026, 9, 21, 19, 9); // 21-oct-2026 7:09 p. m., hora local

  test("el pie de Ajustes dice qué código corre", () => {
    expect(textoVersion({ version: "1.2.6", habilitado: false, embebida: true, creada: null, updateId: null }))
      .toBe("Sin actualizaciones automáticas");
    expect(textoVersion({ version: "1.2.6", habilitado: true, embebida: true, creada, updateId: "abc" }))
      .toBe("Versión de la tienda, sin actualizaciones descargadas");
    const t = textoVersion({ version: "1.2.6", habilitado: true, embebida: false, creada, updateId: "01a160f0-d713-7446-acd2-1c4f11614118" });
    expect(t.startsWith("Actualizada el ")).toBe(true);
    expect(t).toMatch(/21 (de )?oct/);
    expect(t).toContain("7:09");
    expect(t.endsWith(" · 01a160f0")).toBe(true);
  });

  test("la fecha corta va en español y con hora", () => {
    const f = fechaCorta(creada);
    expect(f).toMatch(/21 (de )?oct, 7:09/);
    expect(f).not.toContain(".,");
  });

  test("se avisa una vez por actualización descargada", () => {
    expect(debeAvisar({ pendiente: false, idDescargada: "u1", yaAvisada: null })).toBe(false);
    expect(debeAvisar({ pendiente: true, idDescargada: "u1", yaAvisada: null })).toBe(true);
    expect(debeAvisar({ pendiente: true, idDescargada: "u1", yaAvisada: "u1" })).toBe(false);
    expect(debeAvisar({ pendiente: true, idDescargada: "u2", yaAvisada: "u1" })).toBe(true);
    // Una vuelta a la versión de la tienda (rollback) no trae id: también se avisa una vez.
    expect(debeAvisar({ pendiente: true, idDescargada: undefined, yaAvisada: null })).toBe(true);
    expect(debeAvisar({ pendiente: true, idDescargada: undefined, yaAvisada: "rollback" })).toBe(false);
  });

  test("no se revisa el servidor más de una vez cada 5 minutos", () => {
    const ahora = 1_000_000_000;
    expect(sePuedeRevisar(null, ahora)).toBe(true);
    expect(sePuedeRevisar(ahora - 60_000, ahora)).toBe(false);
    expect(sePuedeRevisar(ahora - 5 * 60_000, ahora)).toBe(true);
  });
});
