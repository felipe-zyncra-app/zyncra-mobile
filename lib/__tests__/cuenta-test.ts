import {
  validarContrasena, traducirErrorAuth, crearSlug, slugConSufijo,
  paisPorZona, zonaParaPais, paisDeLocale, PAISES_REGISTRO,
} from "@/lib/cuenta";

describe("validarContrasena", () => {
  test("misma regla que el registro", () => {
    expect(validarContrasena("Clave1")).toBeNull();
    expect(validarContrasena("aaaaaa")).not.toBeNull();
    expect(validarContrasena("Abcdef")).not.toBeNull();
    expect(validarContrasena("")).not.toBeNull();
  });
});

describe("traducirErrorAuth", () => {
  test("credenciales inválidas en español", () => {
    expect(traducirErrorAuth({ message: "Invalid login credentials", code: "invalid_credentials" }))
      .toBe("Correo o contraseña incorrectos.");
    expect(traducirErrorAuth({ message: "Invalid login credentials" })).toBe("Correo o contraseña incorrectos.");
  });

  test("correo ya registrado y límite de envíos", () => {
    expect(traducirErrorAuth({ message: "User already registered" })).toMatch(/ya tiene una cuenta/);
    expect(traducirErrorAuth({ message: "For security purposes, you can only request this after 42 seconds." }))
      .toMatch(/Espera un minuto/);
  });

  test("sin red", () => {
    expect(traducirErrorAuth(new TypeError("Network request failed"))).toMatch(/Sin conexión/);
  });

  test("nunca devuelve el inglés crudo", () => {
    expect(traducirErrorAuth({ message: "Something odd happened" })).not.toMatch(/Something/);
  });
});

describe("crearSlug", () => {
  test("conserva las letras con tilde y la ñ", () => {
    expect(crearSlug("Peluquería Ñandú")).toBe("peluqueria-nandu");
    expect(crearSlug("  Black Fade   Barbershop!! ")).toBe("black-fade-barbershop");
  });

  test("nunca queda vacío", () => {
    expect(crearSlug("💈💈")).toBe("negocio");
    expect(crearSlug("")).toBe("negocio");
  });

  test("sufijos ante choques", () => {
    expect(slugConSufijo("barberia", 0)).toBe("barberia");
    expect(slugConSufijo("barberia", 1)).toBe("barberia-2");
    expect(slugConSufijo("barberia", 2)).toBe("barberia-3");
    expect(slugConSufijo("barberia", 3, () => 0)).toBe("barberia-aaaa");
  });
});

describe("país y zona", () => {
  test("propone el país por la zona del teléfono", () => {
    expect(paisPorZona("Europe/Madrid")?.code).toBe("ES");
    expect(paisPorZona("America/Monterrey")?.code).toBe("MX");
    expect(paisPorZona("Asia/Tokyo")).toBeUndefined();
  });

  test("usa la zona del teléfono solo si es del país elegido", () => {
    const mx = PAISES_REGISTRO.find(p => p.code === "MX")!;
    expect(zonaParaPais(mx, "America/Tijuana")).toBe("America/Tijuana");
    expect(zonaParaPais(mx, "America/Bogota")).toBe("America/Mexico_City");
  });

  test("país a partir del locale", () => {
    expect(paisDeLocale("es-MX")).toBe("MX");
    expect(paisDeLocale("es-CO")).toBe("CO");
    expect(paisDeLocale(null)).toBe("CO");
  });
});
