import { MEDIOS, MEDIO_DIVIDIDO, medioDePago, medioOGenerico } from "@/lib/medios-pago";
import { MEDIOS_PAGO } from "@/lib/ingresos";

// Un solo juego de nombres, íconos y colores para Cobros, Historial, Finanzas y el Panel.
describe("lib/medios-pago", () => {
  test("cada método tiene su propio color y su propio ícono", () => {
    expect(new Set(MEDIOS.map(m => m.color)).size).toBe(MEDIOS.length);
    expect(new Set(MEDIOS.map(m => m.icon)).size).toBe(MEDIOS.length);
    // Nequi llevaba el ícono de WhatsApp.
    expect(medioDePago("nequi")?.icon).not.toBe("logo-whatsapp");
  });

  test("el Panel usa los mismos nombres y colores que la hoja de cobro", () => {
    for (const m of MEDIOS) expect(MEDIOS_PAGO[m.key]).toEqual({ label: m.label, color: m.color });
    expect(MEDIOS_PAGO.otro.label).toBe("Otro");
  });

  test("pago dividido y métodos desconocidos", () => {
    expect(medioDePago("mixto")).toBe(MEDIO_DIVIDIDO);
    expect(medioDePago("bitcoin")).toBeUndefined();
    // Uno que no conoce el POS sale con su nombre, no desaparece.
    expect(medioOGenerico("bono")).toMatchObject({ key: "bono", label: "Bono" });
    expect(medioOGenerico(null).label).toBe("Otro");
    expect(medioOGenerico("efectivo").label).toBe("Efectivo");
  });
});
