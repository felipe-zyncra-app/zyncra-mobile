// Correo al cliente al crear, cambiar o cancelar una cita (/api/send-confirmation).

const mockCita: { data: unknown; error: unknown } = { data: null, error: null };
const mockFetch = jest.fn();

jest.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => mockCita }) }),
    }),
  },
}));

jest.mock("@/lib/config", () => ({
  Config: { api: { sendConfirmation: "https://www.zyncra.app/api/send-confirmation" } },
  authedFetch: (...args: unknown[]) => mockFetch(...args),
}));

import { cambioAvisable, enviarCorreoCita, leerRespuestaCorreo } from "@/lib/correo-cita";

const respuesta = (status: number, cuerpo: unknown) => ({ status, json: async () => cuerpo });

beforeEach(() => {
  mockFetch.mockReset();
  mockCita.data = { manage_token: "0b7d7e0c-1f2a-4c3b-9d8e-111122223333" };
  mockCita.error = null;
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe("leerRespuestaCorreo", () => {
  test("200 es enviado", () => {
    expect(leerRespuestaCorreo(200, { ok: true })).toBe("enviado");
  });
  test("un cliente sin correo no es un error", () => {
    expect(leerRespuestaCorreo(400, { code: "no_email" })).toBe("sin-correo");
  });
  test("lo demás es error", () => {
    expect(leerRespuestaCorreo(400, { error: "Faltan campos requeridos" })).toBe("error");
    expect(leerRespuestaCorreo(403, null)).toBe("error");
    expect(leerRespuestaCorreo(429, null)).toBe("error");
  });
});

describe("enviarCorreoCita", () => {
  test("manda el tipo y el manage_token de la cita, y nada más", async () => {
    mockFetch.mockResolvedValue(respuesta(200, { ok: true }));
    await expect(enviarCorreoCita("confirmation", "cita-1")).resolves.toBe("enviado");
    const [url, opciones] = mockFetch.mock.calls[0];
    expect(url).toBe("https://www.zyncra.app/api/send-confirmation");
    expect(opciones.method).toBe("POST");
    expect(JSON.parse(opciones.body)).toEqual({ type: "confirmation", manageToken: "0b7d7e0c-1f2a-4c3b-9d8e-111122223333" });
  });

  test("sin manage_token no llama al servidor", async () => {
    mockCita.data = { manage_token: null };
    await expect(enviarCorreoCita("cancellation", "cita-1")).resolves.toBe("sin-token");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("un fallo de red no lanza: la cita ya está guardada", async () => {
    mockFetch.mockRejectedValue(new Error("Network request failed"));
    await expect(enviarCorreoCita("modification", "cita-1")).resolves.toBe("error");
  });

  test("sin correo del cliente no se registra como error", async () => {
    mockFetch.mockResolvedValue(respuesta(400, { code: "no_email" }));
    await expect(enviarCorreoCita("confirmation", "cita-1")).resolves.toBe("sin-correo");
    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe("cambioAvisable", () => {
  const base = { appointment_date: "2026-10-02", appointment_time: "10:30:00", service_id: "s1", professional_id: "p1" };
  test("mismo horario, servicio y profesional: no se avisa", () => {
    expect(cambioAvisable(base, { ...base, appointment_time: "10:30" })).toBe(false);
  });
  test("cambia fecha, hora, servicio o profesional: se avisa", () => {
    expect(cambioAvisable(base, { ...base, appointment_date: "2026-10-03" })).toBe(true);
    expect(cambioAvisable(base, { ...base, appointment_time: "12:00:00" })).toBe(true);
    expect(cambioAvisable(base, { ...base, service_id: "s2" })).toBe(true);
    expect(cambioAvisable(base, { ...base, professional_id: "p2" })).toBe(true);
  });
});
