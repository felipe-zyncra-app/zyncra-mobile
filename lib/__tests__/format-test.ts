import {
  fmt12Hour, fmtPhone, telefonoE164, enlaceWhatsApp, enlaceTel,
  fmtMoneyFull, configurarMoneda, fmtDateShort,
} from "@/lib/format";

describe("lib/format", () => {
  afterEach(() => configurarMoneda());

  test("fmt12Hour conserva los minutos (AGE-01 / CAL-02)", () => {
    expect(fmt12Hour("09:00")).toBe("9:00 AM");
    expect(fmt12Hour("09:30")).toBe("9:30 AM");
    expect(fmt12Hour("12:30:00")).toBe("12:30 PM");
    expect(fmt12Hour("00:15")).toBe("12:15 AM");
  });

  test("teléfonos: nacional CO, guardados con indicativo y de otros países", () => {
    expect(telefonoE164("3001234567")).toBe("+573001234567");
    expect(telefonoE164("573001234567")).toBe("+573001234567");
    expect(telefonoE164("525512345678")).toBe("+525512345678");
    expect(telefonoE164("34612345678")).toBe("+34612345678");
    expect(telefonoE164("+34 612 34 56 78")).toBe("+34612345678");
    expect(telefonoE164("584121234567")).toBe("+584121234567");
    expect(telefonoE164("5512345678", { indicativo: "52" })).toBe("+525512345678");
    expect(telefonoE164("123")).toBeNull();
  });

  test("fmtPhone ya no antepone 57 a números de otros países (COM-06)", () => {
    expect(fmtPhone("525512345678")).toBe("525512345678");
    expect(fmtPhone("3001234567")).toBe("573001234567");
  });

  test("enlaces de WhatsApp y llamada", () => {
    expect(enlaceWhatsApp("3001234567", { texto: "Hola María" })).toBe("https://wa.me/573001234567?text=Hola%20Mar%C3%ADa");
    expect(enlaceWhatsApp("12")).toBeNull();
    expect(enlaceTel("3001234567")).toBe("tel:+573001234567");
  });

  test("moneda: COP igual que siempre; USD con centavos", () => {
    expect(fmtMoneyFull(25000)).toBe("$25.000");
    expect(fmtMoneyFull(12.5)).toBe("$13");
    configurarMoneda("USD", "en-US");
    expect(fmtMoneyFull(12.5)).toBe("$12.50");
  });

  test("fmtDateShort lee el día sin pasar por UTC", () => {
    expect(fmtDateShort("2026-09-26")).toBe("26 sep 2026");
  });
});
