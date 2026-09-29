import {
  billingAnchorDay, graceStartDay, graceDaysLeft, isSubscriptionBlocked, TRIAL_LAPSE_GRACE_FROM,
  type SubscriptionTiming,
} from "@/lib/mora";

const sub = (s: Partial<SubscriptionTiming>): SubscriptionTiming => ({
  status: "active", trial_ends_at: null, current_period_end: null, is_paid: true, ...s,
});
const dia = (d: string) => new Date(`${d}T15:00:00Z`);

describe("billingAnchorDay", () => {
  test("en prueba vence el fin de la prueba", () => {
    expect(billingAnchorDay(sub({ status: "trial", trial_ends_at: "2026-10-10T05:00:00Z" }))).toBe("2026-10-10");
  });
  test("una prueba vencida sin pagar sigue anclada al fin de la prueba", () => {
    expect(billingAnchorDay(sub({ status: "overdue", trial_ends_at: "2026-10-01T00:00:00Z" }))).toBe("2026-10-01");
  });
  test("active sin período no tiene ancla", () => {
    expect(billingAnchorDay(sub({ status: "active" }))).toBeNull();
  });
});

describe("graceStartDay", () => {
  test("las pruebas atrapadas en overdue antes del arreglo cuentan desde TRIAL_LAPSE_GRACE_FROM", () => {
    expect(graceStartDay(sub({ status: "overdue", trial_ends_at: "2026-08-01T00:00:00Z" }))).toBe(TRIAL_LAPSE_GRACE_FROM);
  });
  test("con período pagado manda el período", () => {
    expect(graceStartDay(sub({ status: "overdue", current_period_end: "2026-08-01" }))).toBe("2026-08-01");
  });
});

describe("graceDaysLeft", () => {
  test("cortesía nunca está en mora", () => {
    expect(graceDaysLeft(sub({ status: "overdue", trial_ends_at: "2026-08-01", is_paid: false }), dia("2026-12-01"))).toBeNull();
  });
  test("cuenta los días que faltan para bloquear", () => {
    const s = sub({ status: "overdue", current_period_end: "2026-10-01" });
    expect(graceDaysLeft(s, dia("2026-10-01"))).toBe(5);
    expect(graceDaysLeft(s, dia("2026-10-04"))).toBe(2);
    expect(graceDaysLeft(s, dia("2026-09-30"))).toBeNull();
  });
});

describe("isSubscriptionBlocked", () => {
  test("manda el estado del cron", () => {
    expect(isSubscriptionBlocked(sub({ status: "suspended" }))).toBe(true);
    expect(isSubscriptionBlocked(sub({ status: "cancelled" }))).toBe(true);
    expect(isSubscriptionBlocked(sub({ status: "suspended", is_paid: false }))).toBe(false);
    expect(isSubscriptionBlocked(null)).toBe(false);
  });
  test("si el cron no corrió, bloquea un día entero después de la gracia", () => {
    const s = sub({ status: "overdue", current_period_end: "2026-10-01" });
    expect(isSubscriptionBlocked(s, dia("2026-10-06"))).toBe(false); // left = 0
    expect(isSubscriptionBlocked(s, dia("2026-10-07"))).toBe(true);  // left = -1
  });
  test("prueba atrapada en overdue: 5 días desde TRIAL_LAPSE_GRACE_FROM", () => {
    const s = sub({ status: "overdue", trial_ends_at: "2026-08-01T00:00:00Z" });
    expect(isSubscriptionBlocked(s, dia("2026-10-04"))).toBe(false);
    expect(isSubscriptionBlocked(s, dia("2026-10-05"))).toBe(true);
  });
});
