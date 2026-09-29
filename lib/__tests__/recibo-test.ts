import { nombresDeItems, textoRecibo } from "@/lib/recibo";

describe("lib/recibo", () => {
  test("el recibo lleva los ítems, el descuento y el método", () => {
    const texto = textoRecibo("Barbería Prueba", {
      clientName: "Ana María",
      items: [{ name: "Corte", qty: 1, price: 30000 }, { name: "Cera", qty: 2, price: 10000 }],
      subtotal: 50000,
      discount: 5000,
      total: 45000,
      methodLabel: "Efectivo + Nequi",
    });
    expect(texto).toContain("*Barbería Prueba* · Recibo de pago");
    expect(texto).toContain("Hola Ana 👋");
    expect(texto).toContain("• Cera × 2");
    expect(texto).toContain("Descuento: −");
    expect(texto).toContain("(Efectivo + Nequi)");
  });

  test("sin descuento no muestra subtotal", () => {
    const texto = textoRecibo("X", { clientName: null, items: [{ name: "Corte", qty: 1, price: 1 }], subtotal: 1, discount: 0, total: 1, methodLabel: "Tarjeta" });
    expect(texto).not.toContain("Subtotal");
    expect(texto).toContain("Hola 👋");
  });

  test("nombresDeItems arma la nota por defecto de la hoja de cobro", () => {
    expect(nombresDeItems([{ name: "Corte", quantity: 1 }, { name: "Cera", quantity: 2 }])).toBe("Corte + 2× Cera");
  });
});
