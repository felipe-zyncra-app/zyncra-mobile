import { escaparLike, filtroBusquedaClientes } from "@/lib/useClientSearch";
import { separarTelefono, telefonoParaGuardar, variantesTelefono } from "@/lib/countries";

// Búsqueda de clientes en el servidor (CLI-04 / CAL-08) y teléfonos al
// guardar un cliente (CLI-05 / CLI-10).

describe("filtroBusquedaClientes", () => {
  test("con menos de 2 caracteres no busca en el servidor", () => {
    expect(filtroBusquedaClientes("")).toBeNull();
    expect(filtroBusquedaClientes(" a ")).toBeNull();
  });

  test("acepta comas y paréntesis entre comillas en vez de borrarlos", () => {
    const f = filtroBusquedaClientes("Pérez, Ana (tía)")!;
    expect(f).toBe('name.ilike."%Pérez, Ana (tía)%"');
  });

  test("escapa los comodines de LIKE y las comillas", () => {
    expect(escaparLike("50%_x\\")).toBe("50\\%\\_x\\\\");
    const f = filtroBusquedaClientes('ab"c%')!;
    // % literal → \% para LIKE → \\% dentro de las comillas de PostgREST.
    expect(f).toBe('name.ilike."%ab\\"c\\\\%%"');
  });

  test("quita el comodín * de PostgREST", () => {
    expect(filtroBusquedaClientes("an*a")).toBe('name.ilike."%an a%"');
  });

  test("busca el teléfono por dígitos, también sin indicativo", () => {
    const f = filtroBusquedaClientes("+57 300 123 4567")!;
    expect(f).toContain('phone.ilike."%573001234567%"');
    expect(f).toContain('phone.ilike."%3001234567%"');
  });

  test("'+57 300' busca por los dígitos 57300", () => {
    expect(filtroBusquedaClientes("+57 300")).toBe('name.ilike."%+57 300%",phone.ilike."%57300%"');
  });

  test("dos puntos y comilla simple quedan dentro de las comillas dobles", () => {
    expect(filtroBusquedaClientes("Dra: O'Neil")).toBe('name.ilike."%Dra: O\'Neil%"');
  });

  test("un nombre con un número suelto no busca por teléfono", () => {
    expect(filtroBusquedaClientes("Ana 123")).toBe('name.ilike."%Ana 123%"');
  });
});

describe("telefonoParaGuardar", () => {
  test("número nacional colombiano → indicativo + nacional", () => {
    expect(telefonoParaGuardar("CO", "300 123 4567")).toEqual({ phone: "573001234567", countryCode: "57", valido: true });
  });

  test("no duplica el indicativo si el usuario ya lo escribió", () => {
    expect(telefonoParaGuardar("CO", "573001234567")?.phone).toBe("573001234567");
  });

  test("un número con + respeta su país aunque el selector diga otro", () => {
    expect(telefonoParaGuardar("CO", "+52 55 1234 5678")).toEqual({ phone: "525512345678", countryCode: "52", valido: true });
  });

  test("marca como no válido un número imposible, sin perderlo", () => {
    const r = telefonoParaGuardar("CO", "12345");
    expect(r?.valido).toBe(false);
    expect(r?.phone).toBe("5712345");
  });

  test("sin dígitos devuelve null", () => {
    expect(telefonoParaGuardar("CO", "  ")).toBeNull();
  });
});

describe("variantesTelefono", () => {
  test("un cliente viejo guardado sin indicativo se encuentra desde el formato nuevo", () => {
    const v = variantesTelefono("573001234567", "57");
    expect(v).toEqual(expect.arrayContaining(["573001234567", "3001234567", "+573001234567"]));
  });

  test("y al revés", () => {
    expect(variantesTelefono("3001234567")).toEqual(expect.arrayContaining(["3001234567", "573001234567"]));
  });
});

describe("separarTelefono", () => {
  test("separa el indicativo de un número guardado", () => {
    expect(separarTelefono("573001234567", "57")).toEqual({ iso2: "CO", dial: "57", national: "3001234567" });
  });

  test("un número de EE. UU. no se confunde con Colombia", () => {
    expect(separarTelefono("13055550101", "1")).toMatchObject({ dial: "1", national: "3055550101" });
  });
});
