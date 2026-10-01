// Reglas de agenda (lib/scheduling): semanas de lunes a domingo, horario por
// defecto, cupos que respetan citas y blocked_slots, "Otra hora" y la franja
// de la línea de tiempo.

import {
  aServicioAgenda, avisosDeHorario, buildWeek, choqueCon, citasQueSeCruzan, cuposLibres, duracionServicio,
  effectiveDayHours, generateSlotsForDay, leerHorarioNegocio, mensajeErrorCita, parsearHora,
  profesionalesDeLaSede, rangoLineaDeTiempo, semanaDe, verificarCupo, type Ocupado,
} from "@/lib/scheduling";

// jest.mock se eleva sobre los imports; mockRespuestas solo se lee al resolver.
const mockRespuestas: Record<string, { data: unknown; error: unknown }> = {};

jest.mock("@/lib/supabase", () => {
  const builder = (tabla: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "in", "order", "limit", "range", "gte", "lte", "single", "maybeSingle"]) {
      b[m] = jest.fn(() => b);
    }
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(mockRespuestas[tabla] ?? { data: [], error: null }).then(res, rej);
    return b;
  };
  return { supabase: { from: jest.fn((tabla: string) => builder(tabla)) } };
});


describe("semanas", () => {
  test("el domingo pertenece a la semana que termina (AGE-02)", () => {
    const semana = semanaDe("2026-09-27"); // domingo
    expect(semana[0]).toBe("2026-09-21");
    expect(semana[6]).toBe("2026-09-27");
    expect(semanaDe("2026-09-21")).toEqual(semana);
  });

  test("buildWeek (compatibilidad) también arranca en el lunes anterior un domingo", () => {
    const w = buildWeek(new Date(2026, 8, 27, 12));
    expect(w[0].getDate()).toBe(21);
    expect(w[6].getDate()).toBe(27);
  });
});

describe("parsearHora (Otra hora)", () => {
  test.each([
    ["9:05", "09:05"],
    ["09:05", "09:05"],
    ["14.30", "14:30"],
    ["930", "09:30"],
    ["1430", "14:30"],
    ["9", "09:00"],
    ["2:30 pm", "14:30"],
    ["12:30pm", "12:30"],
    ["12 am", "00:00"],
    ["11:10 a.m.", "11:10"],
  ])("%s → %s", (entrada, esperado) => {
    expect(parsearHora(entrada)).toBe(esperado);
  });

  test.each(["12:5", "25:00", "9:75", "abc", "", "13 pm", "12345"])("rechaza %p en vez de adivinar", entrada => {
    expect(parsearHora(entrada)).toBeNull();
  });
});

describe("horario del negocio", () => {
  test("sin settings.schedule usa 08:00–19:00 todos los días y lo avisa (AGE-04)", () => {
    const h = leerHorarioNegocio({ timezone: "America/Bogota" });
    expect(h.porDefecto).toBe(true);
    expect(Object.keys(h.dias)).toHaveLength(7);
    expect(effectiveDayHours("2026-09-27", h, null)).toMatchObject({ open: true, start: "08:00", end: "19:00" });
  });

  test("lee schedule y respeta el día cerrado; un día que falte usa el horario por defecto", () => {
    const h = leerHorarioNegocio({ schedule: { "0": { open: false, start: "09:00", end: "18:00" }, "6": { open: true, start: "10:00", end: "14:00" } } });
    expect(h.porDefecto).toBe(false);
    expect(effectiveDayHours("2026-09-27", h, null).open).toBe(false);          // domingo
    expect(effectiveDayHours("2026-09-26", h, null)).toMatchObject({ open: true, start: "10:00", end: "14:00" }); // sábado
    expect(effectiveDayHours("2026-09-21", h, null)).toMatchObject({ open: true, start: "08:00" });              // lunes, falta
  });

  test("usa businessHours (esquema viejo) si no hay schedule", () => {
    const h = leerHorarioNegocio({ businessHours: { "1": { enabled: false }, "2": { enabled: true, open: "07:00", close: "20:00" } } });
    expect(h.origen).toBe("businessHours");
    expect(effectiveDayHours("2026-09-21", h, null).open).toBe(false);
    expect(effectiveDayHours("2026-09-22", h, null)).toMatchObject({ open: true, start: "07:00", end: "20:00" });
  });

  test("el horario del profesional manda y hereda lo que no tenga escrito", () => {
    const h = leerHorarioNegocio({ schedule: { "1": { open: true, start: "08:00", end: "18:00", break_start: "12:00", break_end: "13:00" } } });
    const pro = { "1": { open: true, end: "15:00" } };
    expect(effectiveDayHours("2026-09-21", h, pro)).toMatchObject({ open: true, start: "08:00", end: "15:00", break_start: "12:00" });
    expect(effectiveDayHours("2026-09-21", h, { mon: { enabled: false } }).open).toBe(false);
  });
});

describe("cupos", () => {
  const dia = { open: true, start: "09:00", end: "13:00" };

  test("resta citas y bloqueos", () => {
    const ocupados: Ocupado[] = [
      { inicio: 10 * 60, fin: 11 * 60, tipo: "cita", professionalId: "p1" },
      { inicio: 12 * 60, fin: 13 * 60, tipo: "bloqueo", professionalId: null },
    ];
    const slots = generateSlotsForDay(dia, 30, 30);
    expect(cuposLibres(slots, ocupados, 30)).toEqual(["09:00", "09:30", "11:00", "11:30"]);
    expect(choqueCon(9 * 60 + 45, 30, ocupados)?.tipo).toBe("cita");
  });

  test("avisos para una hora fuera de la grilla", () => {
    const conDescanso = { open: true, start: "09:00", end: "18:00", break_start: "12:30", break_end: "13:00" };
    expect(avisosDeHorario(conDescanso, "08:00", 30)[0]).toMatch(/antes de la apertura/);
    expect(avisosDeHorario(conDescanso, "17:45", 30)[0]).toMatch(/después del cierre/);
    expect(avisosDeHorario(conDescanso, "12:15", 30)[0]).toMatch(/descanso/);
    expect(avisosDeHorario(conDescanso, "10:00", 30)).toEqual([]);
    expect(avisosDeHorario({ ...conDescanso, open: false }, "10:00", 30)[0]).toMatch(/no se atiende/);
  });

  test("profesionales de la sede activa, sin dejar la lista vacía", () => {
    const pros = [{ id: "a", location_id: "norte" }, { id: "b", location_id: "sur" }, { id: "c", location_id: null }];
    expect(profesionalesDeLaSede(pros, "norte").map(p => p.id)).toEqual(["a", "c"]);
    expect(profesionalesDeLaSede(pros, null)).toHaveLength(3);
    expect(profesionalesDeLaSede([{ id: "b", location_id: "sur" }], "norte")).toHaveLength(1);
  });
});

describe("catálogo", () => {
  test("la duración sigue la regla de Ajustes → Servicios (duracionDe)", () => {
    expect(duracionServicio({ duration_minutes: 45, duration_min: 30 })).toBe(45);
    expect(duracionServicio({ duration_min: 40 })).toBe(40);
    expect(duracionServicio([{ duration_minutes: 90 }])).toBe(90);
    // Servicio sin duración válida: 30 min, igual que el web y Ajustes.
    expect(duracionServicio({ duration_minutes: 0, duration_min: null })).toBe(30);
    // numeric que llega como texto.
    expect(duracionServicio({ duration_minutes: "50" as unknown as number })).toBe(50);
    // Cita sin servicio: se le reservan 60 min (o lo que pida quien llama).
    expect(duracionServicio(null)).toBe(60);
    expect(duracionServicio([], 20)).toBe(20);
  });

  test("un servicio archivado queda inactivo; sin la columna (antes de la migración) cuenta como activo", () => {
    expect(aServicioAgenda({ id: "s1", name: "Corte", price: "25000", duration_min: 45 })).toEqual({
      id: "s1", name: "Corte", price: 25000, duracion: 45, activo: true, code: null,
    });
    expect(aServicioAgenda({ id: "s2", name: "Tinte", price: 0, duration_minutes: 90, is_active: false }).activo).toBe(false);
    expect(aServicioAgenda({ id: "s3", name: "Barba", is_active: null }).activo).toBe(true);
  });
});

describe("línea de tiempo", () => {
  test("cubre el horario del día y las citas fuera de él (CAL-09)", () => {
    expect(rangoLineaDeTiempo([{ open: true, start: "07:00", end: "22:00" }], [])).toEqual({ inicio: 420, fin: 1320 });
    expect(rangoLineaDeTiempo([{ open: true, start: "09:00", end: "18:00" }], [{ inicio: 21 * 60 + 30, fin: 22 * 60 + 30 }]))
      .toEqual({ inicio: 540, fin: 1380 });
    expect(rangoLineaDeTiempo([null], [])).toEqual({ inicio: 480, fin: 1260 });
  });

  test("solo cuenta como cruce el mismo profesional, con solapamiento real (AGE-12)", () => {
    const cruzadas = citasQueSeCruzan([
      { id: "1", professionalId: "a", inicio: 600, fin: 660 },
      { id: "2", professionalId: "b", inicio: 600, fin: 660 },
      { id: "3", professionalId: "a", inicio: 630, fin: 690 },
      { id: "4", professionalId: "b", inicio: 600, fin: 660, status: "cancelled" },
      { id: "5", professionalId: "a", inicio: 690, fin: 720 },
    ]);
    expect([...cruzadas].sort()).toEqual(["1", "3"]);
  });
});

describe("verificarCupo", () => {
  beforeEach(() => {
    mockRespuestas.appointments = {
      data: [{ id: "c1", appointment_time: "10:00:00", services: { duration_minutes: null, duration_min: 60 } }],
      error: null,
    };
    mockRespuestas.blocked_slots = {
      data: [
        { id: "b1", start_time: "14:00:00", end_time: "18:00:00", professional_id: "p1", reason: "Médico" },
        { id: "b2", start_time: "08:00:00", end_time: "09:00:00", professional_id: "otro", reason: null },
      ],
      error: null,
    };
  });

  const base = { tenantId: "t1", professionalId: "p1", dia: "2026-09-28", duracion: 30 };

  test("choca con una cita (usa duration_min si falta duration_minutes)", async () => {
    const r = await verificarCupo({ ...base, hora: "10:45" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/otra cita/);
  });

  // Dos clientes a la vez con el mismo profesional (Imperio Capilar): una
  // cita encima de otra se confirma en vez de bloquearse.
  test("el choque con otra cita se puede confirmar (conCita)", async () => {
    const r = await verificarCupo({ ...base, hora: "10:00" });
    expect(r).toMatchObject({ ok: false, conCita: true });
  });

  test("choca con una ausencia del profesional (AGE-05)", async () => {
    const r = await verificarCupo({ ...base, hora: "15:00" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/ausencia programada/);
    if (!r.ok) expect(r.conCita).toBeUndefined();
  });

  test("si cruza una cita y una ausencia, manda la ausencia (no se puede confirmar)", async () => {
    mockRespuestas.appointments = {
      data: [{ id: "c2", appointment_time: "13:45:00", services: { duration_minutes: 30, duration_min: null } }],
      error: null,
    };
    const r = await verificarCupo({ ...base, hora: "13:50", duracion: 30 });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.motivo).toMatch(/ausencia programada/); expect(r.conCita).toBeUndefined(); }
  });

  test("ignora las ausencias de otro profesional", async () => {
    expect(await verificarCupo({ ...base, hora: "08:15" })).toEqual({ ok: true });
  });

  test("rechaza una cita que cruza la medianoche", async () => {
    const r = await verificarCupo({ ...base, hora: "23:45" });
    expect(r.ok).toBe(false);
  });

  test("si la consulta falla, lanza en vez de asumir libre (AGE-X1)", async () => {
    mockRespuestas.appointments = { data: null, error: { message: "Network request failed" } };
    await expect(verificarCupo({ ...base, hora: "12:00" })).rejects.toThrow(/conexión/);
  });

  test("el 23505 de la regla vieja (misma hora exacta) se explica", () => {
    expect(mensajeErrorCita({ code: "23505", message: "duplicate key" })).toMatch(/misma hora/);
    expect(mensajeErrorCita({ code: "42501", message: "" })).toMatch(/permiso/);
  });
});
