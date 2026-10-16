import { ordenarPorCategoria } from "@/lib/categorias";

describe("catálogo en el orden de Servicios", () => {
  it("categorías como las ordenó el negocio, nuevas en orden alfabético y Sin categoría al final", () => {
    const svcs = [
      { name: "Retiro", category: "Uñas", position: 2 },
      { name: "Gift", category: null, position: 0 },
      { name: "Corte", category: "Cabello", position: 1 },
      { name: "Masaje", category: "Spa", position: 0 },
      { name: "Semipermanente", category: "Uñas", position: 1 },
      { name: "Barba", category: "Barbería", position: 0 },
      { name: "Tinte", category: "Cabello", position: 0 },
    ];
    expect(ordenarPorCategoria(svcs, ["Uñas", "Cabello"]).map(s => s.name))
      .toEqual(["Semipermanente", "Retiro", "Tinte", "Corte", "Barba", "Masaje", "Gift"]);
  });
});
