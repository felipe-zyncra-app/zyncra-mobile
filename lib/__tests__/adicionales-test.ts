import { adicionalValido, duracionConAdicionales, nombreDeCita, precioConAdicionales } from "@/lib/adicionales";
import { duracionCita } from "@/lib/scheduling";

jest.mock("@/lib/supabase", () => ({ supabase: {} }));

const dos = [
  { key: "a", nombre: "Arreglo 2 uñas", precio: 15_000, duracion: 30 },
  { key: "b", nombre: "Retiro", precio: 5_000, duracion: 15 },
];

describe("adicionales con valor libre", () => {
  it("suman tiempo y valor al servicio, o van solos", () => {
    expect(duracionConAdicionales(60, dos)).toBe(105);
    expect(duracionConAdicionales(null, dos)).toBe(45);
    expect(precioConAdicionales(40_000, dos)).toBe(60_000);
    expect(precioConAdicionales(null, [])).toBe(0);
  });
  it("valida nombre, valor y duración", () => {
    expect(adicionalValido({ nombre: "Arreglo", precio: 10_000, duracion: 30 })).toBe(true);
    expect(adicionalValido({ nombre: "Cortesía", precio: 0, duracion: 15 })).toBe(true);
    expect(adicionalValido({ nombre: "A", precio: 10_000, duracion: 30 })).toBe(false);
    expect(adicionalValido({ nombre: "Arreglo", precio: null, duracion: 30 })).toBe(false);
  });
  it("nombre de la cita: el servicio o el primer adicional", () => {
    expect(nombreDeCita({ services: { name: "Manicure" }, appointment_services: [{ name: "Retiro" }] })).toBe("Manicure");
    expect(nombreDeCita({ services: null, appointment_services: [{ name: "Arreglo 2 uñas" }] })).toBe("Arreglo 2 uñas");
    expect(nombreDeCita({ services: null, appointment_services: [{ name: "Arreglo" }, { name: "Retiro" }] })).toBe("Arreglo +1");
    expect(nombreDeCita({ services: null, appointment_services: [] })).toBeNull();
  });
  it("la duración propia de la cita manda sobre la del servicio", () => {
    expect(duracionCita({ duration_minutes: 45, services: { duration_minutes: 60 } })).toBe(45);
    expect(duracionCita({ duration_minutes: null, services: { duration_minutes: 60 } })).toBe(60);
    expect(duracionCita({ duration_minutes: 0, services: null })).toBe(60);
  });
});
