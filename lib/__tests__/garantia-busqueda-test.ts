import { filtrarServicios } from "@/lib/scheduling";
import { precioDeLista } from "@/lib/ingresos";
import { SIN_GARANTIA, garantiaLista } from "@/components/agenda/GarantiaSelector";

jest.mock("@/lib/supabase", () => ({ supabase: {} }));

describe("buscador de servicios", () => {
  const lista = [
    { name: "Depilación cejas", code: "101" },
    { name: "Semipermanente uñas", code: "205" },
    { name: "Corte", code: null },
  ];
  it("ignora tildes y mayúsculas", () => {
    expect(filtrarServicios(lista, "DEPILACION").map(x => x.name)).toEqual(["Depilación cejas"]);
  });
  it("cada palabra en cualquier orden", () => {
    expect(filtrarServicios(lista, "uñas semi").map(x => x.name)).toEqual(["Semipermanente uñas"]);
    expect(filtrarServicios(lista, "unas").map(x => x.name)).toEqual(["Semipermanente uñas"]);
  });
  it("por código, y sin texto devuelve todo", () => {
    expect(filtrarServicios(lista, "205").map(x => x.name)).toEqual(["Semipermanente uñas"]);
    expect(filtrarServicios(lista, "  ")).toHaveLength(3);
  });
});

describe("garantía", () => {
  it("una cita de garantía solo cobra los adicionales", () => {
    const cita = { services: { price: 40_000 }, appointment_services: [{ price: 5_000 }] };
    expect(precioDeLista(cita)).toBe(45_000);
    expect(precioDeLista({ ...cita, is_warranty: true })).toBe(5_000);
  });
  it("con citas anteriores hay que elegir cuál se repara", () => {
    expect(garantiaLista(SIN_GARANTIA)).toBe(true);
    expect(garantiaLista({ ...SIN_GARANTIA, activa: true, hayCitas: true })).toBe(false);
    expect(garantiaLista({ ...SIN_GARANTIA, activa: true, hayCitas: true, originalId: "c1" })).toBe(true);
    expect(garantiaLista({ ...SIN_GARANTIA, activa: true, hayCitas: false })).toBe(true);
  });
});
