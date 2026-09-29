import { validarCorreo, validarCorreoCliente, correoClienteObligatorio } from "@/lib/contacto";

describe("validarCorreoCliente", () => {
  test("acepta buzones reales que el alta de negocios rechaza", () => {
    expect(validarCorreoCliente("Ana@Mail.com")).toEqual({ ok: true, valor: "ana@mail.com" });
    expect(validarCorreo("ana@mail.com").ok).toBe(false);
  });
  test("exige la misma forma", () => {
    expect(validarCorreoCliente("ana@").ok).toBe(false);
    expect(validarCorreoCliente("a@b.123").ok).toBe(false);
    expect(validarCorreoCliente("").ok).toBe(false);
  });
});

describe("correoClienteObligatorio", () => {
  test("por defecto se pide", () => {
    expect(correoClienteObligatorio(null)).toBe(true);
    expect(correoClienteObligatorio({})).toBe(true);
  });
  test("con prótesis capilares es opcional", () => {
    expect(correoClienteObligatorio({ protesis_enabled: true })).toBe(false);
  });
  test("el valor explícito manda en ambos sentidos", () => {
    expect(correoClienteObligatorio({ protesis_enabled: true, client_email_required: true })).toBe(true);
    expect(correoClienteObligatorio({ client_email_required: false })).toBe(false);
  });
});
