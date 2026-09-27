import { STATUS_META, STATUS_OPTIONS } from "@/constants/status";

// Prueba mínima de la configuración de Jest (preset jest-expo + alias "@/").
describe("constants/status", () => {
  test("STATUS_OPTIONS sale de STATUS_META, en el mismo orden", () => {
    expect(STATUS_OPTIONS.map((o) => o.status)).toEqual(Object.keys(STATUS_META));
    for (const o of STATUS_OPTIONS) {
      expect(o.label).toBe(STATUS_META[o.status].label);
      expect(o.color).toBe(STATUS_META[o.status].color);
    }
  });

  test("cubre los estados de cita que guarda la base", () => {
    expect(Object.keys(STATUS_META).sort()).toEqual(
      ["cancelled", "completed", "confirmed", "no_show", "pending"],
    );
  });

  test("el fondo es translúcido para que sirva en claro y en oscuro", () => {
    for (const meta of Object.values(STATUS_META)) {
      expect(meta.bg).toMatch(/^rgba\(/);
    }
  });
});
