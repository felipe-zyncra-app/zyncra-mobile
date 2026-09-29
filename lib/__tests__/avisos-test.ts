import {
  agruparAvisos, armarAvisos, avisosVisibles, cuandoCorto, cuandoEsLaCita, enCuanto, haceCuanto,
  leerEstadoAvisos, marcar, podarMarcas, textoRecordatorioCita,
  ESTADO_AVISOS_VACIO, TITULO_RECORDATORIO, type CitaAviso,
} from "@/lib/avisos";
import { fmtDia, instanteDe } from "@/lib/tz";

// lib/avisos: el aviso por cita en el teléfono del dueño (texto PARA EL
// NEGOCIO, no la plantilla del cliente) y la lista de la campana del Panel
// con las reglas del portal, en la zona del negocio.

const BOG = "America/Bogota";
const MAD = "Europe/Madrid";
const HORA = 60 * 60 * 1000;

/** Instante en que suena un aviso `horas` antes de la cita (hora del negocio). */
const suena = (dia: string, hhmm: string, horas: number, tz = BOG) =>
  new Date(instanteDe(dia, hhmm, tz).getTime() - horas * HORA);

describe("recordatorio de cita para el negocio", () => {
  test("mañana: título y cuerpo de recordatorio, no la plantilla del cliente", () => {
    const r = textoRecordatorioCita(
      { date: "2026-09-29", time: "15:00:00", clientName: "Juan", serviceName: "Corte" },
      suena("2026-09-29", "15:00", 24),
      BOG,
    );
    expect(r.title).toBe(TITULO_RECORDATORIO);
    expect(r.title).toBe("Recordatorio de cita");
    expect(r.body).toBe("Recuerda: mañana a las 3:00 PM tienes una cita con Juan para Corte.");
    expect(r.body).not.toMatch(/Hola|Te recordamos|Te esperamos/);
  });

  test("hoy, y más de un día antes con el día largo", () => {
    expect(textoRecordatorioCita(
      { date: "2026-09-29", time: "15:00", clientName: "Juan", serviceName: "Corte" },
      suena("2026-09-29", "15:00", 2),
      BOG,
    ).body).toBe("Recuerda: hoy a las 3:00 PM tienes una cita con Juan para Corte.");

    expect(textoRecordatorioCita(
      { date: "2026-10-03", time: "15:00", clientName: "Juan", serviceName: "Corte" },
      suena("2026-10-03", "15:00", 48),
      BOG,
    ).body).toBe("Recuerda: el sábado 3 de octubre a las 3:00 PM tienes una cita con Juan para Corte.");
  });

  test("sin cliente dice 'con un cliente'; sin servicio no lo nombra", () => {
    const disparo = suena("2026-09-29", "15:00", 1);
    expect(textoRecordatorioCita({ date: "2026-09-29", time: "15:00", clientName: null, serviceName: "Corte" }, disparo, BOG).body)
      .toBe("Recuerda: hoy a las 3:00 PM tienes una cita con un cliente para Corte.");
    expect(textoRecordatorioCita({ date: "2026-09-29", time: "15:00", clientName: "  ", serviceName: "" }, disparo, BOG).body)
      .toBe("Recuerda: hoy a las 3:00 PM tienes una cita con un cliente.");
    expect(textoRecordatorioCita({ date: "2026-09-29", time: "15:00", clientName: "Ana" }, disparo, BOG).body)
      .toBe("Recuerda: hoy a las 3:00 PM tienes una cita con Ana.");
  });

  test("la una va en singular", () => {
    expect(cuandoEsLaCita("2026-09-29", "13:30", suena("2026-09-29", "13:30", 1), BOG)).toBe("hoy a la 1:30 PM");
    expect(cuandoEsLaCita("2026-09-29", "01:00", suena("2026-09-29", "01:00", 24), BOG)).toBe("mañana a la 1:00 AM");
    expect(cuandoEsLaCita("2026-09-29", "10:00", suena("2026-09-29", "10:00", 1), BOG)).toBe("hoy a las 10:00 AM");
  });

  test("hoy y mañana en la zona del NEGOCIO, no en UTC", () => {
    // 9:00 PM del 28 en Bogotá = 02:00 UTC del 29: en UTC la cita del 29 sería "hoy".
    expect(cuandoEsLaCita("2026-09-29", "09:00", new Date("2026-09-29T02:00:00Z"), BOG)).toBe("mañana a las 9:00 AM");
    // 7:00 PM del 28 en Bogotá = 00:00 UTC del 29: en UTC la cita del 28 sería "ayer".
    expect(cuandoEsLaCita("2026-09-28", "20:00", new Date("2026-09-29T00:00:00Z"), BOG)).toBe("hoy a las 8:00 PM");
    // Negocio en Madrid: 00:30 del 29 (UTC+2) = 22:30 UTC del 28; en UTC la cita del 29 sería "mañana".
    expect(cuandoEsLaCita("2026-09-29", "10:00", new Date("2026-09-28T22:30:00Z"), MAD)).toBe("hoy a las 10:00 AM");
  });
});

// ─── Campana ─────────────────────────────────────────────────────────────────

const cita = (id: string, extra: Partial<CitaAviso>): CitaAviso => ({
  id,
  appointment_date: "2026-09-28",
  appointment_time: "10:00:00",
  status: "pending",
  professional_id: "pro-1",
  clients: { name: `Cliente ${id}` },
  services: { name: "Corte" },
  ...extra,
});

// Lunes 28-sep-2026, 3:00 PM en Bogotá.
const AHORA = new Date("2026-09-28T20:00:00Z");
const hace = (min: number) => new Date(AHORA.getTime() - min * 60000).toISOString();

describe("armarAvisos (reglas de la campana del portal)", () => {
  const recientes: CitaAviso[] = [
    cita("r1", { appointment_date: "2026-09-29", appointment_time: "10:00:00", created_at: hace(30) }),
    cita("r2", { appointment_date: "2026-10-03", appointment_time: "15:00:00", status: "cancelled", created_at: hace(60) }),
    cita("r3", { created_at: hace(150) }),   // fuera de la ventana de 2 h
    cita("r4", { appointment_time: "16:00:00", professional_id: null, created_at: hace(1) }),
  ];
  const proximas: CitaAviso[] = [
    cita("p1", { appointment_time: "16:30:00" }),                          // pendiente, faltan 90 min
    cita("p2", { appointment_time: "17:30:00" }),                          // pendiente, faltan 150 min
    cita("p3", { appointment_time: "17:45:00", status: "confirmed" }),     // confirmada, faltan 165 min
    cita("p4", { appointment_time: "14:00:00", status: "confirmed" }),     // ya pasó
    cita("p5", { appointment_time: "16:10:00", status: "cancelled" }),     // no vigente
    recientes[3],                                                          // r4: también sin profesional
    cita("s1", { appointment_date: "2026-09-30", appointment_time: "09:00:00", status: "confirmed", professional_id: null }),
    cita("s2", { appointment_date: "2026-10-01", appointment_time: "11:00:00", professional_id: null }),
    cita("s3", { appointment_date: "2026-10-02", appointment_time: "12:00:00", professional_id: null }),
    cita("s4", { appointment_date: "2026-10-04", appointment_time: "12:00:00", professional_id: null }),
    cita("s5", { appointment_date: "2026-10-06", appointment_time: "12:00:00", professional_id: null }), // hoy + 8
  ];

  const avisos = armarAvisos({ proximas, recientes, ahora: AHORA, timeZone: BOG });

  test("mismos ids y orden que el portal, un aviso por cita", () => {
    expect(avisos.map(a => a.id)).toEqual([
      "D_r4", "D_r1", "Dcancel_r2", "B_p1", "A_p3", "C_s1", "C_s2", "C_s3",
    ]);
  });

  test("nueva cita y cancelación: con hace cuánto y el día de la cita", () => {
    const [r4, r1, r2] = avisos;
    expect(r4).toMatchObject({ tipo: "nueva_cita", grupo: "actividad", cuando: "Hoy · 4:00 PM", etiqueta: "Ahora", fecha: "2026-09-28", citaId: "r4" });
    expect(r1).toMatchObject({ tipo: "nueva_cita", cuando: "Mañana · 10:00 AM", etiqueta: "Hace 30 min", cliente: "Cliente r1", servicio: "Corte" });
    // Como el portal: la cancelación no dice cuándo era, pero sí lleva al día.
    expect(r2).toMatchObject({ tipo: "cancelacion", grupo: "actividad", cuando: "", etiqueta: "Hace 1 h", fecha: "2026-10-03" });
  });

  test("sin confirmar (≤ 2 h) y por presentarse (≤ 3 h), solo hoy", () => {
    expect(avisos.find(a => a.id === "B_p1")).toMatchObject({ tipo: "sin_confirmar", grupo: "urgente", cuando: "Hoy · 4:30 PM", etiqueta: "En 1 h 30 min" });
    expect(avisos.find(a => a.id === "A_p3")).toMatchObject({ tipo: "inasistencia", grupo: "urgente", etiqueta: "En 2 h 45 min" });
    expect(avisos.some(a => a.citaId === "p2" || a.citaId === "p4" || a.citaId === "p5")).toBe(false);
  });

  test("sin profesional: las 4 más próximas de la semana (el tope va antes de descartar repetidas)", () => {
    const c = avisos.filter(a => a.tipo === "sin_profesional");
    // r4 era una de las 4 pero ya salió como nueva cita; s4 quedó fuera del tope y s5 de la semana.
    expect(c.map(a => a.citaId)).toEqual(["s1", "s2", "s3"]);
    expect(c[0]).toMatchObject({ grupo: "accion", etiqueta: "Próxima", cuando: "mié 30 sep · 9:00 AM" });
  });

  test("sin nombres: Cliente / Servicio, como el portal", () => {
    const [a] = armarAvisos({
      proximas: [cita("x", { appointment_time: "16:00:00", clients: null, services: { name: " " } })],
      recientes: [], ahora: AHORA, timeZone: BOG,
    });
    expect(a).toMatchObject({ cliente: "Cliente", servicio: "Servicio" });
  });

  test("agrupa Urgente → Requiere acción → Actividad reciente", () => {
    const g = agruparAvisos(avisos);
    expect(g.map(x => [x.titulo, x.avisos.length])).toEqual([
      ["Urgente", 2], ["Requiere acción", 3], ["Actividad reciente", 3],
    ]);
  });

  test("'hoy' y los minutos son del NEGOCIO: a las 8 PM de Bogotá el UTC ya es mañana", () => {
    const noche = new Date("2026-09-29T01:00:00Z"); // 8:00 PM del 28 en Bogotá
    const lista = armarAvisos({
      proximas: [
        cita("n1", { appointment_date: "2026-09-28", appointment_time: "21:30:00" }),
        // En UTC serían las 02:00 de "hoy" (faltaría 1 h): es mañana en el negocio.
        cita("n2", { appointment_date: "2026-09-29", appointment_time: "02:00:00" }),
      ],
      recientes: [], ahora: noche, timeZone: BOG,
    });
    expect(lista.map(a => [a.id, a.etiqueta])).toEqual([["B_n1", "En 1 h 30 min"]]);
  });

  test("las ventanas se recalculan con la hora: sin volver a consultar, una nueva cita vence a las 2 h", () => {
    const r = [cita("v1", { appointment_date: "2026-09-30", created_at: hace(119) })];
    expect(armarAvisos({ proximas: [], recientes: r, ahora: AHORA, timeZone: BOG })).toHaveLength(1);
    const despues = new Date(AHORA.getTime() + 2 * 60000);
    expect(armarAvisos({ proximas: [], recientes: r, ahora: despues, timeZone: BOG })).toHaveLength(0);
  });

  test("como mucho 10 recientes, las más nuevas", () => {
    const muchas = Array.from({ length: 14 }, (_, i) =>
      cita(`m${i}`, { appointment_date: "2026-10-01", created_at: hace(i + 5) }));
    const lista = armarAvisos({ proximas: [], recientes: muchas, ahora: AHORA, timeZone: BOG });
    expect(lista).toHaveLength(10);
    expect(lista[0].citaId).toBe("m0");
    expect(lista[9].citaId).toBe("m9");
  });
});

describe("textos cortos de la campana", () => {
  test("cuándo, hace cuánto y en cuánto", () => {
    expect(cuandoCorto("2026-09-28", "09:05:00", "2026-09-28")).toBe("Hoy · 9:05 AM");
    expect(cuandoCorto("2026-09-29", "18:00", "2026-09-28")).toBe("Mañana · 6:00 PM");
    expect(cuandoCorto("2026-10-03", "12:00", "2026-09-28")).toBe(`${fmtDia("2026-10-03", "semana-dia-mes")} · 12:00 PM`);
    expect(haceCuanto(hace(0), AHORA)).toBe("Ahora");
    expect(haceCuanto(hace(-5), AHORA)).toBe("Ahora"); // reloj adelantado
    expect(haceCuanto(hace(59), AHORA)).toBe("Hace 59 min");
    expect(haceCuanto(hace(125), AHORA)).toBe("Hace 2 h");
    expect(haceCuanto(hace(60 * 50), AHORA)).toBe("Hace 2 d");
    expect(haceCuanto(null, AHORA)).toBe("");
    expect(enCuanto(0)).toBe("Ahora");
    expect(enCuanto(45)).toBe("En 45 min");
    expect(enCuanto(120)).toBe("En 2 h");
    expect(enCuanto(95)).toBe("En 1 h 35 min");
  });
});

describe("leídos y descartados (por teléfono y negocio)", () => {
  const DIA = 24 * HORA;
  const ahoraMs = AHORA.getTime();

  test("se podan por antigüedad y con tope", () => {
    expect(podarMarcas({ viejo: ahoraMs - 11 * DIA, ayer: ahoraMs - DIA, hoy: ahoraMs }, ahoraMs)).toEqual({ ayer: ahoraMs - DIA, hoy: ahoraMs });
    const cinco = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`a${i}`, ahoraMs - i * 1000]));
    expect(Object.keys(podarMarcas(cinco, ahoraMs, 3))).toEqual(["a0", "a1", "a2"]);
  });

  test("lo guardado roto o raro se lee como vacío", () => {
    expect(leerEstadoAvisos(null)).toEqual({ leidas: {}, descartadas: {} });
    expect(leerEstadoAvisos("no es json")).toEqual({ leidas: {}, descartadas: {} });
    expect(leerEstadoAvisos(JSON.stringify(["D_1"]))).toEqual({ leidas: {}, descartadas: {} });
    expect(leerEstadoAvisos(JSON.stringify({ leidas: { D_1: 5, D_2: "x" }, descartadas: [] })))
      .toEqual({ leidas: { D_1: 5 }, descartadas: {} });
  });

  test("marcar leído y descartar: el contador cuenta solo lo visible sin leer", () => {
    const avisos = armarAvisos({
      proximas: [cita("p1", { appointment_time: "16:30:00" }), cita("p3", { appointment_time: "17:45:00", status: "confirmed" })],
      recientes: [cita("r1", { appointment_date: "2026-09-29", created_at: hace(10) })],
      ahora: AHORA, timeZone: BOG,
    });
    expect(avisosVisibles(avisos, ESTADO_AVISOS_VACIO).noLeidos).toBe(3);

    let e = marcar(ESTADO_AVISOS_VACIO, "leidas", ["D_r1"], ahoraMs);
    e = marcar(e, "descartadas", ["A_p3"], ahoraMs);
    const { visibles, noLeidos } = avisosVisibles(avisos, e);
    expect(visibles.map(a => [a.id, a.leido])).toEqual([["D_r1", true], ["B_p1", false]]);
    expect(noLeidos).toBe(1);
    // "constructor" y compañía no cuentan como marcados.
    expect(avisosVisibles([{ ...avisos[0], id: "constructor" }], ESTADO_AVISOS_VACIO).noLeidos).toBe(1);
  });
});
