// Buscador de servicios de Nueva cita y el caso real de Imperio Capilar
// (apertura 09:00, cupos cada 90 min, descanso 13:30–14:00 "solo corta la grilla").

import { aServicioAgenda, filtrarServicios, generateSlotsForDay, servicioPorCodigo } from "@/lib/scheduling";
import { fmt12Hour } from "@/lib/format";

const servicios = [
  { id: "a", name: "Mantenimiento prótesis", code: "101" },
  { id: "b", name: "Corte clásico", code: "1010" },
  { id: "c", name: "Lavado", code: null },
];

describe("filtrarServicios", () => {
  test("sin texto devuelve todos", () => {
    expect(filtrarServicios(servicios, "  ")).toHaveLength(3);
  });
  test("busca por nombre sin importar mayúsculas", () => {
    expect(filtrarServicios(servicios, "CORTE").map(x => x.id)).toEqual(["b"]);
  });
  test("busca por código", () => {
    expect(filtrarServicios(servicios, "101").map(x => x.id)).toEqual(["a", "b"]);
  });
});

describe("servicioPorCodigo", () => {
  test("solo elige con el código exacto", () => {
    expect(servicioPorCodigo(servicios, " 101 ")?.id).toBe("a");
    expect(servicioPorCodigo(servicios, "10")).toBeNull();
    expect(servicioPorCodigo(servicios, "")).toBeNull();
  });
});

describe("aServicioAgenda", () => {
  test("trae el código del admin, y null si está vacío", () => {
    expect(aServicioAgenda({ id: 1, name: "X", price: 0, duration_minutes: 30, code: " 7 " }).code).toBe("7");
    expect(aServicioAgenda({ id: 1, name: "X", price: 0, duration_minutes: 30, code: "" }).code).toBeNull();
  });
});

describe("horario de Imperio Capilar", () => {
  const dia = { open: true, start: "09:00", end: "19:00", break_start: "13:30", break_end: "14:00", break_soft: true };
  test("los cupos cada 90 min conservan los minutos y la grilla se reinicia tras el descanso", () => {
    const cupos = generateSlotsForDay(dia, 60, 90);
    expect(cupos).toEqual(["09:00", "10:30", "12:00", "14:00", "15:30", "17:00"]);
    expect(cupos.map(fmt12Hour)).toEqual(["9:00 AM", "10:30 AM", "12:00 PM", "2:00 PM", "3:30 PM", "5:00 PM"]);
  });
  test("el descanso se muestra con sus minutos", () => {
    expect(fmt12Hour("13:30")).toBe("1:30 PM");
  });
});
