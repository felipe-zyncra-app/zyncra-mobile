import { barajar, disponibilidadDe, sortearProfesional, unirCuposDelEquipo } from "@/lib/asignacion";
import { verificarCupo } from "@/lib/scheduling";

jest.mock("@/lib/supabase", () => ({ supabase: {} }));
jest.mock("@/lib/scheduling", () => ({
  ...jest.requireActual("@/lib/scheduling"),
  verificarCupo: jest.fn(),
}));
const verificar = verificarCupo as jest.MockedFunction<typeof verificarCupo>;

const base = { tenantId: "t1", dia: "2026-10-20", hora: "10:00", duracion: 30, horario: null };

describe("barajar", () => {
  it("no pierde ni repite elementos y no toca la lista original", () => {
    const lista = [1, 2, 3, 4, 5];
    const r = barajar(lista, () => 0.3);
    expect([...r].sort()).toEqual(lista);
    expect(lista).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("unirCuposDelEquipo", () => {
  it("ofrece una hora si alguien la tiene libre y recuerda quiénes", () => {
    const u = unirCuposDelEquipo([
      { proId: "a", cerrado: false, grilla: ["09:00", "09:30", "10:00"], libres: ["09:00", "10:00"] },
      { proId: "b", cerrado: false, grilla: ["09:00", "09:30", "10:00"], libres: ["10:00"] },
      { proId: "c", cerrado: true, grilla: [], libres: [] },
    ]);
    expect(u.cerrado).toBe(false);
    expect(u.cupos).toEqual(["09:00", "10:00"]);
    expect(u.ocupados).toEqual(["09:30"]);
    expect(u.libresPorHora).toEqual({ "09:00": ["a"], "10:00": ["a", "b"] });
  });

  it("todo el equipo cerrado = día cerrado", () => {
    expect(unirCuposDelEquipo([{ proId: "a", cerrado: true, grilla: [], libres: [] }]).cerrado).toBe(true);
  });
});

describe("disponibilidadDe", () => {
  beforeEach(() => verificar.mockReset());
  const pro = { id: "a", name: "Ana" };

  it("libre, cruce con cita (aviso) o ausencia (bloqueado)", async () => {
    verificar.mockResolvedValueOnce({ ok: true });
    expect(await disponibilidadDe({ ...base, pro })).toEqual({ estado: "libre" });

    verificar.mockResolvedValueOnce({ ok: false, motivo: "Choca con otra cita", conCita: true });
    expect(await disponibilidadDe({ ...base, pro })).toMatchObject({ estado: "aviso", conCita: true });

    verificar.mockResolvedValueOnce({ ok: false, motivo: "Ausencia" });
    expect(await disponibilidadDe({ ...base, pro })).toEqual({ estado: "bloqueado", motivo: "Ausencia" });
  });
});

describe("sortearProfesional", () => {
  beforeEach(() => verificar.mockReset());
  const candidatos = [{ id: "a", name: "Ana" }, { id: "b", name: "Beto" }];

  it("salta a quien ya no está libre", async () => {
    verificar.mockImplementation(async o => (o.professionalId === "a" ? { ok: false, motivo: "x", conCita: true } : { ok: true }));
    const r = await sortearProfesional({ ...base, candidatos, azar: () => 0 });
    expect(r?.id).toBe("b");
  });

  it("null si nadie está libre", async () => {
    verificar.mockResolvedValue({ ok: false, motivo: "Ausencia" });
    expect(await sortearProfesional({ ...base, candidatos })).toBeNull();
  });
});
