import { crearGuardRespuestas } from "@/lib/useRecarga";

// Reemplazo de la bandera `cancelled`: solo la última petición queda vigente.
describe("crearGuardRespuestas", () => {
  test("una respuesta vieja que llega tarde no queda vigente", () => {
    const g = crearGuardRespuestas();
    const primera = g.nuevo();
    const segunda = g.nuevo();
    expect(primera.vigente()).toBe(false);
    expect(segunda.vigente()).toBe(true);
  });

  test("invalidar y cerrar dejan todo sin vigencia", () => {
    const g = crearGuardRespuestas();
    const t1 = g.nuevo();
    g.invalidar();
    expect(t1.vigente()).toBe(false);
    const t2 = g.nuevo();
    g.cerrar();
    expect(t2.vigente()).toBe(false);
    g.abrir();
    expect(g.nuevo().vigente()).toBe(true);
  });
});
