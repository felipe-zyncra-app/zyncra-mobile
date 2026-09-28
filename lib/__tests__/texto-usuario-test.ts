import { textoParaUsuario } from "@/lib/db";

const RESPALDO = "No se pudo eliminar la cuenta.";

describe("textoParaUsuario", () => {
  it("deja pasar los mensajes en español de nuestros triggers", () => {
    expect(textoParaUsuario("Una entrada clínica firmada no puede eliminarse", RESPALDO))
      .toBe("Una entrada clínica firmada no puede eliminarse");
    expect(textoParaUsuario("Este servicio tiene citas en el historial: archívalo en vez de borrarlo.", RESPALDO))
      .toBe("Este servicio tiene citas en el historial: archívalo en vez de borrarlo.");
  });

  it("cambia por el respaldo lo que viene en inglés o es técnico", () => {
    expect(textoParaUsuario("User not found", RESPALDO)).toBe(RESPALDO);
    expect(textoParaUsuario("Failed to delete user", RESPALDO)).toBe(RESPALDO);
    expect(textoParaUsuario('duplicate key value violates unique constraint "x"', RESPALDO)).toBe(RESPALDO);
    expect(textoParaUsuario("Internal Server Error", RESPALDO)).toBe(RESPALDO);
  });

  it("usa el respaldo si no hay texto", () => {
    expect(textoParaUsuario(undefined, RESPALDO)).toBe(RESPALDO);
    expect(textoParaUsuario("   ", RESPALDO)).toBe(RESPALDO);
    expect(textoParaUsuario({ error: "x" }, RESPALDO)).toBe(RESPALDO);
  });
});
