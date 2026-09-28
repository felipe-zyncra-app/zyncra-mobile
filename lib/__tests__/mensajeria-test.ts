import {
  filtrarSegmento, filtroNombreTelefono, fusionarChats, fusionarMensajes, masReciente,
  reemplazarVariables, sinTelefonosRepetidos, textoBusqueda, ultimoConfirmado, ventanaAbierta,
  type ChatResumen, type MensajeChat,
} from "@/lib/mensajeria";

const msg = (id: string, created_at: string, extra: Partial<MensajeChat> = {}): MensajeChat => ({
  id, phone: "573001234567", direction: "in", sender: "client", body: id, created_at, ...extra,
});

describe("fusionarMensajes", () => {
  test("no duplica y deja el orden cronológico", () => {
    const previos = [msg("a", "2026-09-26T10:00:00Z"), msg("b", "2026-09-26T11:00:00Z")];
    const nuevos = [msg("b", "2026-09-26T11:00:00Z"), msg("c", "2026-09-26T10:30:00Z")];
    expect(fusionarMensajes(previos, nuevos).map(m => m.id)).toEqual(["a", "c", "b"]);
  });

  test("el mismo id se actualiza (llega el estado de entrega)", () => {
    const previos = [msg("a", "2026-09-26T10:00:00Z", { direction: "out", status: "sent" })];
    const r = fusionarMensajes(previos, [msg("a", "2026-09-26T10:00:00Z", { direction: "out", status: "read" })]);
    expect(r).toHaveLength(1);
    expect(r[0].status).toBe("read");
  });
});

describe("ultimoConfirmado", () => {
  test("ignora los fallidos y los que se están enviando", () => {
    const lista = [
      msg("a", "2026-09-26T10:00:00Z"),
      msg("b", "2026-09-26T11:00:00Z", { status: "failed" }),
      msg("c", "2026-09-26T12:00:00Z", { status: "sending" }),
    ];
    expect(ultimoConfirmado(lista)).toBe("2026-09-26T10:00:00Z");
    expect(ultimoConfirmado([])).toBeNull();
  });
});

describe("ventanaAbierta", () => {
  const ahora = Date.parse("2026-09-26T12:00:00Z");
  test("abierta con un mensaje del cliente de hace menos de 24 h", () => {
    expect(ventanaAbierta("2026-09-25T13:00:00Z", ahora)).toBe(true);
  });
  test("cerrada si pasaron más de 24 h o no hay mensaje", () => {
    expect(ventanaAbierta("2026-09-25T11:00:00Z", ahora)).toBe(false);
    expect(ventanaAbierta(null, ahora)).toBe(false);
  });
  test("masReciente elige el instante mayor", () => {
    expect(masReciente("2026-09-25T11:00:00Z", "2026-09-25T13:00:00-05:00")).toBe("2026-09-25T13:00:00-05:00");
    expect(masReciente(null, "x")).toBe("x");
  });
});

describe("fusionarChats", () => {
  const chat = (phone: string, last: string, extra: Partial<ChatResumen> = {}): ChatResumen => ({
    tenant_id: "t", phone, client_name: null, bot_paused: false, unread: 0, last_message_at: last, last_message_preview: null, ...extra,
  });
  test("reemplaza por teléfono y ordena del más reciente al más viejo", () => {
    const r = fusionarChats(
      [chat("1", "2026-09-26T10:00:00Z"), chat("2", "2026-09-26T09:00:00Z")],
      [chat("2", "2026-09-26T11:00:00Z", { unread: 3 })],
    );
    expect(r.map(c => c.phone)).toEqual(["2", "1"]);
    expect(r[0].unread).toBe(3);
  });
});

describe("búsqueda segura para PostgREST", () => {
  test("quita comas, paréntesis, comillas y comodines", () => {
    expect(textoBusqueda("ana,(or)*%")).toBe("ana or");
    expect(textoBusqueda("a")).toBeNull();
  });
  test("busca por teléfono solo con los dígitos", () => {
    expect(filtroNombreTelefono("+57 300 12", "client_name", "phone"))
      .toBe("client_name.ilike.%+57 300 12%,phone.ilike.%5730012%");
    expect(filtroNombreTelefono("María")).toBe("name.ilike.%María%");
  });
});

describe("campañas", () => {
  test("reemplaza las variables con o sin espacios", () => {
    expect(reemplazarVariables("Hola {{nombre}} de {{ negocio }}", { nombre: "Ana", negocio: "Zyncra" })).toBe("Hola Ana de Zyncra");
  });

  test("un valor con $ se copia tal cual (no es patrón de reemplazo)", () => {
    expect(reemplazarVariables("{{negocio}}: {{link}}", { negocio: "Barbería $$ & $&", link: "https://x.co/?a=$1" }))
      .toBe("Barbería $$ & $&: https://x.co/?a=$1");
  });

  test("segmentos por cita reciente", () => {
    const clientes = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const activos = new Set(["b"]);
    expect(filtrarSegmento(clientes, activos, "all")).toHaveLength(3);
    expect(filtrarSegmento(clientes, activos, "active").map(c => c.id)).toEqual(["b"]);
    expect(filtrarSegmento(clientes, activos, "inactive").map(c => c.id)).toEqual(["a", "c"]);
  });

  test("quita teléfonos repetidos pero conserva los inválidos", () => {
    const lista = [{ id: "1", t: "+57300" }, { id: "2", t: "+57300" }, { id: "3", t: null }, { id: "4", t: null }];
    expect(sinTelefonosRepetidos(lista, x => x.t).map(x => x.id)).toEqual(["1", "3", "4"]);
  });
});
