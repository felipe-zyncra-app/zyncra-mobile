import type * as NotifModulo from "@/lib/notifications";
import { fmtDia, hoyNegocio, sumarDias } from "@/lib/tz";

// Avisos por cita en el teléfono del dueño (lib/notifications): texto para el
// negocio, interruptor por dispositivo que respetan refreshAllReminders,
// scheduleAppointmentReminder y reprogramarRecordatorioCita, y el toque de
// una notificación (también en arranque en frío).

// jest.mock se eleva sobre los imports: solo se leen variables "mock*".
let mockTablas: Record<string, { data: unknown; error: unknown }> = {};
// Almacén compartido entre los módulos aislados de cada test: es "el teléfono".
let mockAlmacen: Record<string, string> = {};
let mockAlmacenRoto = false;

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => {
      if (mockAlmacenRoto) throw new Error("sin almacenamiento");
      return mockAlmacen[k] ?? null;
    }),
    setItem: jest.fn(async (k: string, v: string) => {
      if (mockAlmacenRoto) throw new Error("sin almacenamiento");
      mockAlmacen[k] = v;
    }),
    removeItem: jest.fn(async (k: string) => { delete mockAlmacen[k]; }),
    multiRemove: jest.fn(async (ks: string[]) => { ks.forEach(k => { delete mockAlmacen[k]; }); }),
  },
}));

jest.mock("expo-notifications", () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => null),
  scheduleNotificationAsync: jest.fn(async () => "id"),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  cancelAllScheduledNotificationsAsync: jest.fn(async () => {}),
  dismissAllNotificationsAsync: jest.fn(async () => {}),
  setBadgeCountAsync: jest.fn(async () => true),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponse: jest.fn(() => null),
  clearLastNotificationResponse: jest.fn(),
  DEFAULT_ACTION_IDENTIFIER: "expo.modules.notifications.actions.DEFAULT",
  SchedulableTriggerInputTypes: { DATE: "date", CALENDAR: "calendar" },
  AndroidImportance: { HIGH: 4 },
}));

jest.mock("@/lib/supabase", () => {
  const builder = (tabla: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "gte", "lte", "order", "limit", "update", "is", "maybeSingle", "single"]) {
      b[m] = jest.fn(() => b);
    }
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(mockTablas[tabla] ?? { data: [], error: null }).then(res, rej);
    return b;
  };
  return {
    supabase: {
      from: jest.fn((tabla: string) => builder(tabla)),
      rpc: jest.fn(async () => ({ error: null })),
      auth: { getSession: jest.fn(async () => ({ data: { session: { user: { id: "u-duena" } } } })) },
    },
  };
});

type NotifMock = {
  scheduleNotificationAsync: jest.Mock;
  cancelScheduledNotificationAsync: jest.Mock;
  getAllScheduledNotificationsAsync: jest.Mock;
  addNotificationResponseReceivedListener: jest.Mock;
  getLastNotificationResponse: jest.Mock;
  clearLastNotificationResponse: jest.Mock;
};

/** Módulos frescos por test: el interruptor se recuerda en memoria del módulo. */
function cargar() {
  let n!: typeof NotifModulo;
  let N!: NotifMock;
  let supabase!: { from: jest.Mock };
  jest.isolateModules(() => {
    // Copias aisladas del módulo (y de sus mocks): con import se compartirían entre tests.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- copia aislada del módulo
    N = require("expo-notifications") as NotifMock;
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- copia aislada del módulo
    supabase = (require("@/lib/supabase") as { supabase: { from: jest.Mock } }).supabase;
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- copia aislada del módulo
    n = require("@/lib/notifications") as typeof NotifModulo;
  });
  return { n, N, supabase };
}

const BOG = "America/Bogota";
const hoy = hoyNegocio(BOG);
const tablasConsultadas = (supabase: { from: jest.Mock }) => supabase.from.mock.calls.map(c => c[0] as string);

beforeEach(() => {
  mockTablas = {
    reminder_settings: { data: { hours_before: 24 }, error: null },
    appointments: { data: [], error: null },
  };
  mockAlmacen = {};
  mockAlmacenRoto = false;
});

describe("aviso por cita en el teléfono del dueño", () => {
  test("encendido por defecto: programa un recordatorio PARA EL NEGOCIO", async () => {
    const { n, N } = cargar();
    expect(await n.avisosDeCitaActivos()).toBe(true);

    const dia = sumarDias(hoy, 2);
    await n.scheduleAppointmentReminder(
      { id: "c1", date: dia, time: "15:00:00", clientName: "Juan", serviceName: "Corte" },
      24, "¡Hola {{nombre}}! Te recordamos tu cita", BOG,
    );

    expect(N.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    const { identifier, content, trigger } = N.scheduleNotificationAsync.mock.calls[0][0];
    expect(identifier).toBe("appt-c1");
    expect(content.title).toBe("Recordatorio de cita");
    // Suena un día antes: la cita es "mañana" visto desde ese momento.
    expect(content.body).toBe("Recuerda: mañana a las 3:00 PM tienes una cita con Juan para Corte.");
    expect(content.body).not.toContain("Hola");
    expect((trigger.date as Date).toISOString()).toBe(new Date(Date.parse(`${sumarDias(hoy, 1)}T20:00:00Z`)).toISOString());
  });

  test("con 2 días de anticipación nombra el día; sin cliente dice 'con un cliente'", async () => {
    const { n, N } = cargar();
    const dia = sumarDias(hoy, 3);
    await n.scheduleAppointmentReminder({ id: "c2", date: dia, time: "15:00", clientName: null, serviceName: null }, 48, undefined, BOG);
    expect(N.scheduleNotificationAsync.mock.calls[0][0].content.body)
      .toBe(`Recuerda: el ${fmtDia(dia, "largo")} a las 3:00 PM tienes una cita con un cliente.`);
  });

  test("apagado: cancela los avisos 'appt-' (no el resumen diario) y no programa nuevos", async () => {
    const { n, N, supabase } = cargar();
    N.getAllScheduledNotificationsAsync.mockResolvedValue([
      { identifier: "appt-a" }, { identifier: "appt-b" }, { identifier: "daily-briefing" },
    ]);

    await n.activarAvisosDeCita(false, "t1", BOG);
    const canceladas = N.cancelScheduledNotificationAsync.mock.calls.map(c => c[0]);
    expect(canceladas).toEqual(expect.arrayContaining(["appt-a", "appt-b"]));
    expect(canceladas).not.toContain("daily-briefing");
    expect(await n.avisosDeCitaActivos()).toBe(false);

    await n.scheduleAppointmentReminder({ id: "c3", date: sumarDias(hoy, 2), time: "10:00", clientName: "Ana" }, 24, undefined, BOG);
    await n.reprogramarRecordatorioCita("t1", { id: "c4", date: sumarDias(hoy, 2), time: "10:00", status: "confirmed" }, BOG);
    await n.refreshAllReminders("t1", BOG);
    expect(N.scheduleNotificationAsync).not.toHaveBeenCalled();
    // Ni siquiera consulta: apagado no necesita la anticipación ni las citas.
    expect(tablasConsultadas(supabase)).not.toContain("appointments");
    expect(tablasConsultadas(supabase)).not.toContain("reminder_settings");
    expect(N.cancelScheduledNotificationAsync).toHaveBeenCalledWith("appt-c4");
  });

  test("se guarda por dispositivo: al volver a abrir la app sigue apagado", async () => {
    await cargar().n.activarAvisosDeCita(false, "t1", BOG);
    expect(await cargar().n.avisosDeCitaActivos()).toBe(false);
  });

  test("apagarlo mientras se lee lo guardado: gana lo que eligió el dueño", async () => {
    const { n } = cargar();
    const leyendo = n.avisosDeCitaActivos();          // p. ej. Ajustes recién abierto
    const apagado = n.activarAvisosDeCita(false, "t1", BOG);
    expect(await leyendo).toBe(false);
    await apagado;
    expect(await n.avisosDeCitaActivos()).toBe(false);
  });

  test("si el almacenamiento falla, se asume encendido", async () => {
    mockAlmacenRoto = true;
    const { n } = cargar();
    expect(await n.avisosDeCitaActivos()).toBe(true);
  });

  test("encendido otra vez: vuelve a programarlos con refreshAllReminders", async () => {
    const { n, N } = cargar();
    await n.activarAvisosDeCita(false, "t1", BOG);
    mockTablas.appointments = {
      data: [
        { id: "a1", appointment_date: sumarDias(hoy, 2), appointment_time: "15:00:00", status: "confirmed", clients: { name: "Juan" }, services: { name: "Corte" } },
        { id: "a2", appointment_date: sumarDias(hoy, 2), appointment_time: "16:00:00", status: "pending", clients: null, services: { name: "Barba" } },
      ],
      error: null,
    };

    await n.activarAvisosDeCita(true, "t1", BOG);
    expect(await n.avisosDeCitaActivos()).toBe(true);
    const programados = N.scheduleNotificationAsync.mock.calls.map(c => [c[0].identifier, c[0].content.body]);
    expect(programados).toEqual([
      ["appt-a1", "Recuerda: mañana a las 3:00 PM tienes una cita con Juan para Corte."],
      ["appt-a2", "Recuerda: mañana a las 4:00 PM tienes una cita con un cliente para Barba."],
    ]);
  });
});

describe("apagar mientras se programan", () => {
  test("el Panel reprogramando no deja avisos sueltos si lo apagan a mitad de camino", async () => {
    const { n, N } = cargar();
    mockTablas.appointments = {
      data: [
        { id: "a1", appointment_date: sumarDias(hoy, 2), appointment_time: "15:00:00", status: "confirmed", clients: { name: "Juan" }, services: null },
        { id: "a2", appointment_date: sumarDias(hoy, 2), appointment_time: "16:00:00", status: "pending", clients: null, services: null },
      ],
      error: null,
    };
    let apagado: Promise<void> | null = null;
    N.scheduleNotificationAsync.mockImplementationOnce(async () => {
      apagado = n.activarAvisosDeCita(false, "t1", BOG);   // el dueño lo apaga justo ahora
      return "id";
    });

    await n.refreshAllReminders("t1", BOG);
    await apagado;

    expect(N.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    const ultimaCancelada = N.cancelScheduledNotificationAsync.mock.calls.at(-1)?.[0];
    expect(ultimaCancelada).toBe("appt-a1");
    expect(await n.avisosDeCitaActivos()).toBe(false);
  });
});

describe("cerrar sesión mientras se programan", () => {
  test("no deja avisos con nombres de clientes en el teléfono sin sesión", async () => {
    const { n, N } = cargar();
    mockTablas.appointments = {
      data: [
        { id: "a1", appointment_date: sumarDias(hoy, 2), appointment_time: "15:00:00", status: "confirmed", clients: { name: "Juan" }, services: null },
        { id: "a2", appointment_date: sumarDias(hoy, 2), appointment_time: "16:00:00", status: "pending", clients: { name: "Ana" }, services: null },
      ],
      error: null,
    };
    let salida: Promise<void> | null = null;
    N.scheduleNotificationAsync.mockImplementationOnce(async () => {
      salida = n.cancelarTodasLasNotificaciones();   // el dueño cierra sesión justo ahora
      return "id";
    });

    await n.refreshAllReminders("t1", BOG);
    await salida;

    // El segundo no se programa y el primero se cancela al terminar.
    expect(N.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(N.cancelScheduledNotificationAsync.mock.calls.at(-1)?.[0]).toBe("appt-a1");
  });
});

describe("tocar una notificación", () => {
  const respuesta = (id: string, accion = "expo.modules.notifications.actions.DEFAULT") => ({
    actionIdentifier: accion,
    notification: { date: 1_790_000_000_000, request: { identifier: id, content: { data: { type: "new_booking", appointment_id: "x" } } } },
  });

  test("abre con el toque y con la del arranque en frío, una sola vez cada una", () => {
    const { n, N } = cargar();
    N.getLastNotificationResponse.mockReturnValue(respuesta("push-1"));
    const alTocar = jest.fn();

    const dejar = n.alTocarNotificacion(alTocar);
    // Arranque en frío: la notificación que abrió la app.
    expect(alTocar).toHaveBeenCalledTimes(1);
    expect(alTocar).toHaveBeenCalledWith({ type: "new_booking", appointment_id: "x" });
    expect(N.clearLastNotificationResponse).toHaveBeenCalled();

    const oyente = N.addNotificationResponseReceivedListener.mock.calls[0][0] as (r: unknown) => void;
    oyente(respuesta("push-1"));                  // la misma otra vez: no repite
    oyente(respuesta("appt-9"));                  // un aviso local
    oyente(respuesta("appt-9", "descartar"));     // otra acción: no abre
    expect(alTocar).toHaveBeenCalledTimes(2);

    dejar();
    const sub = N.addNotificationResponseReceivedListener.mock.results[0].value as { remove: jest.Mock };
    expect(sub.remove).toHaveBeenCalled();
  });
});
