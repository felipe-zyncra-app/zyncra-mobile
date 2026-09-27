import {
  contarVisitas, entregarRecompensa, esVisita, getRewardStatus, idDeEntrega, visitasDelCliente,
  type LoyaltyReward,
} from "@/lib/loyalty";

// Fidelización: qué cuenta como visita (CLI-13) y entregas que no se
// duplican con un doble toque ni con dos dispositivos (CLI-12).

type Fila = Record<string, any>;
const mockDb: { entregas: Fila[]; visitas: number; rpcExiste: boolean; citasCompletadas: number; perderRespuesta: number } = {
  entregas: [], visitas: 0, rpcExiste: true, citasCompletadas: 0, perderRespuesta: 0,
};

jest.mock("@/lib/supabase", () => {
  const cadena = (resolver: (filtros: Record<string, unknown>) => unknown) => {
    const filtros: Record<string, unknown> = {};
    const obj: any = {
      eq(col: string, v: unknown) { filtros[col] = v; return obj; },
      then(ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) {
        return Promise.resolve(resolver(filtros)).then(ok, ko);
      },
    };
    return obj;
  };
  return {
    supabase: {
      rpc: async (fn: string) => {
        if (fn !== "client_visit_count") return { data: null, error: { code: "PGRST202", message: "no existe" } };
        return mockDb.rpcExiste
          ? { data: mockDb.visitas, error: null }
          : { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
      },
      from: (tabla: string) => ({
        select: () => cadena(f => {
          if (tabla === "appointments") return { count: mockDb.citasCompletadas, error: null };
          const n = mockDb.entregas.filter(e => e.client_id === f.client_id && e.reward_id === f.reward_id).length;
          return { count: n, error: null };
        }),
        insert: async (fila: Fila) => {
          if (mockDb.entregas.some(e => e.id === fila.id)) return { error: { code: "23505", message: "duplicate key" } };
          mockDb.entregas.push(fila);
          if (mockDb.perderRespuesta > 0) { mockDb.perderRespuesta--; return { error: { code: "", message: "Network request failed" } }; }
          return { error: null };
        },
      }),
    },
  };
});

const recompensa = (over: Partial<LoyaltyReward> = {}): LoyaltyReward => ({
  id: "r1", tenant_id: "t1", label: "Corte gratis", visits_required: 5, repeats: true,
  reward_type: "free_service", reward_value: null, service_id: null, active: true, created_at: "",
  ...over,
});

beforeEach(() => {
  mockDb.entregas = [];
  mockDb.visitas = 0;
  mockDb.rpcExiste = true;
  mockDb.citasCompletadas = 0;
  mockDb.perderRespuesta = 0;
});

describe("qué es una visita", () => {
  test("solo cuentan las citas completadas", () => {
    expect(esVisita({ status: "completed" })).toBe(true);
    for (const s of ["no_show", "pending", "confirmed", "cancelled", null]) expect(esVisita({ status: s })).toBe(false);
    expect(contarVisitas([{ status: "completed" }, { status: "no_show" }, { status: "pending" }, { status: "completed" }])).toBe(2);
  });

  test("getRewardStatus descuenta las entregas y soporta premios únicos", () => {
    const r = recompensa();
    expect(getRewardStatus(r, 10, [{ reward_id: "r1" }]).available).toBe(1);
    expect(getRewardStatus(recompensa({ repeats: false }), 10, []).available).toBe(1);
    expect(getRewardStatus(recompensa({ repeats: false }), 10, [{ reward_id: "r1" }]).available).toBe(0);
    expect(getRewardStatus(r, 3, []).remaining).toBe(2);
  });
});

describe("idDeEntrega", () => {
  test("es el mismo para la misma entrega y distinto para otra", () => {
    const a = idDeEntrega("c1", "r1", 1);
    expect(idDeEntrega("c1", "r1", 1)).toBe(a);
    expect(idDeEntrega("c1", "r1", 2)).not.toBe(a);
    expect(idDeEntrega("c2", "r1", 1)).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("visitasDelCliente", () => {
  test("usa la RPC del servidor si existe", async () => {
    mockDb.visitas = 7;
    await expect(visitasDelCliente("c1")).resolves.toEqual({ visitas: 7, viaRespaldo: false });
  });

  test("sin la migración cuenta las citas completadas que deja ver la RLS", async () => {
    mockDb.rpcExiste = false;
    mockDb.citasCompletadas = 4;
    await expect(visitasDelCliente("c1")).resolves.toEqual({ visitas: 4, viaRespaldo: true });
  });
});

describe("entregarRecompensa", () => {
  test("registra la entrega disponible", async () => {
    mockDb.visitas = 5;
    const r = await entregarRecompensa({ tenantId: "t1", clientId: "c1", reward: recompensa() });
    expect(r).toEqual({ ok: true, visitas: 5 });
    expect(mockDb.entregas).toHaveLength(1);
    expect(mockDb.entregas[0].id).toBe(idDeEntrega("c1", "r1", 1));
    expect(mockDb.entregas[0].visits_at_redemption).toBe(5);
  });

  test("dos toques seguidos solo registran una entrega", async () => {
    mockDb.visitas = 5;
    const [a, b] = await Promise.all([
      entregarRecompensa({ tenantId: "t1", clientId: "c1", reward: recompensa() }),
      entregarRecompensa({ tenantId: "t1", clientId: "c1", reward: recompensa() }),
    ]);
    expect(mockDb.entregas).toHaveLength(1);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
  });

  test("dos toques simultáneos con dos premios ganados siguen registrando una sola entrega", async () => {
    mockDb.visitas = 10;
    const [a, b] = await Promise.all([
      entregarRecompensa({ tenantId: "t1", clientId: "c1", reward: recompensa() }),
      entregarRecompensa({ tenantId: "t1", clientId: "c1", reward: recompensa() }),
    ]);
    expect(mockDb.entregas).toHaveLength(1);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
  });

  test("si se perdió la respuesta, el reintento no duplica", async () => {
    mockDb.visitas = 5;
    mockDb.perderRespuesta = 1;
    await expect(entregarRecompensa({ tenantId: "t1", clientId: "c1", reward: recompensa() })).rejects.toThrow();
    const r = await entregarRecompensa({ tenantId: "t1", clientId: "c1", reward: recompensa() });
    expect(r.ok).toBe(false);
    expect(mockDb.entregas).toHaveLength(1);
  });

  test("no entrega si el cliente no tiene el premio", async () => {
    mockDb.visitas = 4;
    const r = await entregarRecompensa({ tenantId: "t1", clientId: "c1", reward: recompensa() });
    expect(r).toMatchObject({ ok: false, motivo: "SIN_PREMIO" });
    expect(mockDb.entregas).toHaveLength(0);
  });

  test("con dos premios ganados permite dos entregas", async () => {
    mockDb.visitas = 10;
    await entregarRecompensa({ tenantId: "t1", clientId: "c1", reward: recompensa() });
    const r = await entregarRecompensa({ tenantId: "t1", clientId: "c1", reward: recompensa() });
    expect(r.ok).toBe(true);
    expect(mockDb.entregas.map(e => e.id)).toEqual([idDeEntrega("c1", "r1", 1), idDeEntrega("c1", "r1", 2)]);
  });

  test("si falta una entrega vieja del medio, usa el siguiente número libre", async () => {
    mockDb.visitas = 15;
    // Hay 2 entregas: la #2 y la #3 (la #1 se borró). Conteo = 2 → probaría #3, que existe.
    mockDb.entregas = [
      { id: idDeEntrega("c1", "r1", 2), client_id: "c1", reward_id: "r1" },
      { id: idDeEntrega("c1", "r1", 3), client_id: "c1", reward_id: "r1" },
    ];
    const r = await entregarRecompensa({ tenantId: "t1", clientId: "c1", reward: recompensa() });
    expect(r.ok).toBe(true);
    expect(mockDb.entregas).toHaveLength(3);
  });
});
