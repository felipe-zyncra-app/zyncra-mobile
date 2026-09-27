import {
  fmt12, fmt12Hour, telefonoE164, enlaceWhatsApp, enlaceTel, fmtTelefono, fmtPhone, PAIS_POR_DEFECTO,
} from "@/lib/format";
import { minsToTime, timeToMins } from "@/lib/scheduling";

// Horas en 12 h y teléfonos (D13): país por defecto CO, sin anteponer 57 a
// ciegas. Casos de Colombia, México, España y números sin indicativo.

describe("fmt12Hour / fmt12", () => {
  test.each([
    ["00:00", "12:00 AM"],
    ["00:15", "12:15 AM"],
    ["06:05", "6:05 AM"],
    ["09:00", "9:00 AM"],
    ["09:30", "9:30 AM"],
    ["11:59", "11:59 AM"],
    ["12:00", "12:00 PM"],
    ["12:30:00", "12:30 PM"],
    ["13:05", "1:05 PM"],
    ["19:30:00", "7:30 PM"],
    ["23:59:59", "11:59 PM"],
  ])("%s → %s", (entrada, esperado) => {
    expect(fmt12Hour(entrada)).toBe(esperado);
    expect(fmt12(entrada)).toBe(esperado);
  });

  test("con cupos cada 30 min, 9:00 y 9:30 no se ven iguales", () => {
    expect(fmt12Hour("09:00")).not.toBe(fmt12Hour("09:30"));
  });

  test("hora de una cifra (antes salía '9:0 AM')", () => {
    expect(fmt12Hour("9:30")).toBe("9:30 AM");
    expect(fmt12Hour("0:05")).toBe("12:05 AM");
    expect(fmt12Hour("7:00:00")).toBe("7:00 AM");
  });

  test("24:00 (cierre a medianoche) es 12:00 AM, no PM", () => {
    expect(fmt12Hour("24:00")).toBe("12:00 AM");
  });

  test("fin de una cita que pasa de medianoche (minsToTime no da la vuelta)", () => {
    // 23:30 + 2 h = "25:30": antes salía tal cual en el resumen de Nueva cita.
    expect(fmt12(minsToTime(timeToMins("23:30") + 120))).toBe("1:30 AM");
    expect(fmt12("24:30")).toBe("12:30 AM");
    expect(fmt12("36:15")).toBe("12:15 PM");
    expect(fmt12("47:59")).toBe("11:59 PM");
  });

  test("entradas que no son hora se devuelven tal cual, sin lanzar", () => {
    expect(fmt12Hour("")).toBe("");
    expect(fmt12Hour(undefined as unknown as string)).toBe("");
    expect(fmt12Hour(null as unknown as string)).toBe("");
    expect(fmt12Hour("9")).toBe("9");
    expect(fmt12Hour("abcd")).toBe("abcd");
    expect(fmt12Hour("48:00")).toBe("48:00");
    expect(fmt12Hour("99:00")).toBe("99:00");
    expect(fmt12Hour("2026-09-26T10:00")).toBe("2026-09-26T10:00");
  });
});

describe("teléfonos de Colombia", () => {
  test("país por defecto CO", () => {
    expect(PAIS_POR_DEFECTO).toBe("CO");
  });

  test.each([
    ["3001234567"],
    ["300 123 4567"],
    ["(300) 123-4567"],
    ["300.123.4567"],
    ["573001234567"],
    ["57 300 123 4567"],
    ["+57 300 123 4567"],
    ["+573001234567"],
    ["00573001234567"],
    [" 3001234567 "],
  ])("celular %p → +573001234567", (entrada) => {
    expect(telefonoE164(entrada)).toBe("+573001234567");
  });

  test("fijo de Bogotá con el prefijo 601 (numeración de 10 dígitos)", () => {
    expect(telefonoE164("601 234 5678")).toBe("+576012345678");
    expect(telefonoE164("6012345678", { indicativo: "57" })).toBe("+576012345678");
  });

  test("con el indicativo guardado aparte (clients.phone_country_code)", () => {
    expect(telefonoE164("3001234567", { indicativo: "57" })).toBe("+573001234567");
    expect(telefonoE164("3001234567", { indicativo: "+57" })).toBe("+573001234567");
    expect(telefonoE164("573001234567", { indicativo: "57" })).toBe("+573001234567");
  });

  test("enlaces y formato legible", () => {
    expect(enlaceWhatsApp("3001234567")).toBe("https://wa.me/573001234567");
    expect(enlaceTel("3001234567")).toBe("tel:+573001234567");
    expect(fmtTelefono("3001234567")).toBe("+57 300 1234567");
    expect(fmtPhone("3001234567")).toBe("573001234567");
    expect(fmtPhone("+57 300 123 4567")).toBe("573001234567");
  });
});

describe("teléfonos de México", () => {
  test("guardado con indicativo, con o sin '+'", () => {
    expect(telefonoE164("525512345678")).toBe("+525512345678");
    expect(telefonoE164("+52 55 1234 5678")).toBe("+525512345678");
    expect(telefonoE164("0052 55 1234 5678")).toBe("+525512345678");
  });

  test("número nacional: con país MX o con indicativo 52", () => {
    expect(telefonoE164("5512345678", { pais: "MX" })).toBe("+525512345678");
    expect(telefonoE164("55 1234 5678", { indicativo: "52" })).toBe("+525512345678");
    expect(telefonoE164("5512345678", { indicativo: "+52" })).toBe("+525512345678");
  });

  test("celular guardado con el '1' que México quitó en 2019", () => {
    expect(telefonoE164("+52 1 55 1234 5678")).toBe("+525512345678");
    expect(telefonoE164("5215512345678")).toBe("+525512345678");
    expect(telefonoE164("15512345678", { indicativo: "52" })).toBe("+525512345678");
    expect(enlaceWhatsApp("+52 1 55 1234 5678")).toBe("https://wa.me/525512345678");
  });

  test("nunca le antepone 57 a un número mexicano (COM-06)", () => {
    expect(fmtPhone("525512345678")).toBe("525512345678");
    expect(enlaceWhatsApp("525512345678")).toBe("https://wa.me/525512345678");
    // Aunque el cliente tenga el indicativo 57 por defecto.
    expect(telefonoE164("525512345678", { indicativo: "57" })).toBe("+525512345678");
  });

  test("formato legible", () => {
    expect(fmtTelefono("525512345678")).toBe("+52 55 1234 5678");
  });
});

describe("teléfonos de España", () => {
  test("guardado con indicativo, con o sin '+' o '00'", () => {
    expect(telefonoE164("34612345678")).toBe("+34612345678");
    expect(telefonoE164("+34 612 34 56 78")).toBe("+34612345678");
    expect(telefonoE164("0034 612 34 56 78")).toBe("+34612345678");
    expect(telefonoE164("+34 91 123 45 67")).toBe("+34911234567");   // fijo de Madrid
  });

  test("número nacional de 9 dígitos: con país ES o indicativo 34", () => {
    expect(telefonoE164("612345678", { pais: "ES" })).toBe("+34612345678");
    expect(telefonoE164("612 34 56 78", { indicativo: "34" })).toBe("+34612345678");
    expect(enlaceWhatsApp("612345678", { pais: "ES", texto: "Hola" })).toBe("https://wa.me/34612345678?text=Hola");
  });

  test("formato legible", () => {
    expect(fmtTelefono("34612345678")).toBe("+34 612 34 56 78");
    expect(fmtTelefono("612345678", { pais: "ES" })).toBe("+34 612 34 56 78");
  });
});

describe("números sin indicativo o inválidos", () => {
  test("un nacional de otro país sin indicativo no se adivina (ni se vuelve colombiano)", () => {
    expect(telefonoE164("5512345678")).toBeNull();   // México sin 52
    expect(telefonoE164("612345678")).toBeNull();    // España sin 34
    expect(enlaceWhatsApp("612345678")).toBeNull();
  });

  test("demasiado corto, vacío o nulo → null", () => {
    expect(telefonoE164("12345")).toBeNull();
    expect(telefonoE164("2345678")).toBeNull();      // fijo viejo de 7 dígitos
    expect(telefonoE164("")).toBeNull();
    expect(telefonoE164("   ")).toBeNull();
    expect(telefonoE164(null)).toBeNull();
    expect(telefonoE164(undefined)).toBeNull();
    expect(telefonoE164("sin número")).toBeNull();
    expect(telefonoE164("+57 300 123")).toBeNull();
  });

  test("WhatsApp: null cuando el número no sirve (no abrir ni marcar enviado)", () => {
    expect(enlaceWhatsApp("12")).toBeNull();
    expect(enlaceWhatsApp(null)).toBeNull();
    expect(enlaceWhatsApp("12345", { texto: "Hola" })).toBeNull();
  });

  test("llamar: si no se reconoce, marca los dígitos; sin dígitos, null", () => {
    expect(enlaceTel("12345")).toBe("tel:12345");
    expect(enlaceTel("ext. 123")).toBe("tel:123");
    expect(enlaceTel("")).toBeNull();
    expect(enlaceTel(null)).toBeNull();
  });

  test("formato legible de lo que no se reconoce: el texto original", () => {
    expect(fmtTelefono("12345")).toBe("12345");
    expect(fmtTelefono(null)).toBe("");
    expect(fmtPhone("12345")).toBe("12345");
    expect(fmtPhone(null as unknown as string)).toBe("");
  });

  test("otros países con '+' o guardados con indicativo", () => {
    expect(telefonoE164("584121234567")).toBe("+584121234567");   // Venezuela
    expect(telefonoE164("+1 305 555 0101")).toBe("+13055550101");  // EE. UU. (número de ficción: se acepta por posible)
    expect(enlaceWhatsApp("+1 305 555 0101")).toContain("13055550101");
    expect(telefonoE164("+593 99 123 4567")).toBe("+593991234567"); // Ecuador
  });
});

describe("texto del mensaje de WhatsApp", () => {
  test("se codifica completo: tildes, saltos de línea, &, ? y #", () => {
    const url = enlaceWhatsApp("3001234567", { texto: "Hola María,\n¿confirmas tu cita de las 3 & 30? #1" });
    expect(url).toBe(`https://wa.me/573001234567?text=${encodeURIComponent("Hola María,\n¿confirmas tu cita de las 3 & 30? #1")}`);
    expect(url).not.toContain(" ");
    expect(new URL(url!).searchParams.get("text")).toBe("Hola María,\n¿confirmas tu cita de las 3 & 30? #1");
  });

  test("sin texto no agrega ?text=", () => {
    expect(enlaceWhatsApp("3001234567", { texto: "" })).toBe("https://wa.me/573001234567");
  });
});
