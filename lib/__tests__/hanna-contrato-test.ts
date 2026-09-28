import { cuerpoGenerarCampanas, leerAccionPendiente, normalizarCampanas } from "@/lib/hanna-contrato";

describe("normalizarCampanas", () => {
  test("lee el formato multicanal del web y toma el texto de WhatsApp", () => {
    const json = {
      ok: true,
      campanas: [{
        tipo: "reactivacion", nombre: "Te extrañamos", segmento: "inactive", razon: "Hay 40 inactivos",
        contenidos: [
          { canal: "instagram", texto: "Post público", hashtags: ["salon"] },
          { canal: "whatsapp", texto: "Hola {{nombre}}, vuelve a {{negocio}}" },
        ],
      }],
    };
    expect(normalizarCampanas(json)).toEqual([{
      tipo: "reactivacion", nombre: "Te extrañamos", segmento: "inactive", razon: "Hay 40 inactivos",
      mensaje: "Hola {{nombre}}, vuelve a {{negocio}}",
    }]);
  });

  test("sigue leyendo el formato viejo con `mensaje`", () => {
    const r = normalizarCampanas({ campanas: [{ tipo: "agenda", nombre: "Martes", segmento: "all", razon: "", mensaje: "Hola" }] });
    expect(r[0].mensaje).toBe("Hola");
  });

  test("descarta borradores sin texto de WhatsApp y sin nombre", () => {
    const r = normalizarCampanas({
      campanas: [
        { nombre: "Solo Instagram", contenidos: [{ canal: "instagram", texto: "x" }] },
        { nombre: "", contenidos: [{ canal: "whatsapp", texto: "x" }] },
        { nombre: "Vacía", contenidos: [{ canal: "whatsapp", texto: "   " }] },
        null,
      ],
    });
    expect(r).toEqual([]);
  });

  test("segmento desconocido cae en 'all' y el tipo por defecto es 'personalizada'", () => {
    const r = normalizarCampanas({ campanas: [{ nombre: "X", segmento: "vip", contenidos: [{ canal: "whatsapp", texto: "Hola" }] }] });
    expect(r[0].segmento).toBe("all");
    expect(r[0].tipo).toBe("personalizada");
  });

  test("respuesta rara no rompe", () => {
    expect(normalizarCampanas(null)).toEqual([]);
    expect(normalizarCampanas({ campanas: "no" })).toEqual([]);
  });
});

describe("cuerpoGenerarCampanas", () => {
  test("pide solo WhatsApp y manda el brief recortado si hay", () => {
    expect(cuerpoGenerarCampanas()).toEqual({ channels: ["whatsapp"] });
    expect(cuerpoGenerarCampanas("  promo martes  ")).toEqual({ channels: ["whatsapp"], brief: "promo martes" });
    expect(cuerpoGenerarCampanas("x".repeat(400)).brief).toHaveLength(300);
  });
});

describe("leerAccionPendiente", () => {
  test("devuelve la acción cuando el servidor la deja en espera", () => {
    const a = leerAccionPendiente({
      reply: "Necesito que confirmes esta acción:",
      pendingAction: { tool: "cancel_appointment", args: { appointment_id: "1" }, summary: "Cancelar la cita de María" },
    });
    expect(a).toEqual({ tool: "cancel_appointment", args: { appointment_id: "1" }, summary: "Cancelar la cita de María" });
  });

  test("null si no hay acción o viene mal formada", () => {
    expect(leerAccionPendiente({ reply: "Hola" })).toBeNull();
    expect(leerAccionPendiente({ pendingAction: { args: {} } })).toBeNull();
  });

  test("sin resumen usa un texto por defecto", () => {
    expect(leerAccionPendiente({ pendingAction: { tool: "delete_service" } })?.summary).toMatch(/cambio/);
  });
});
