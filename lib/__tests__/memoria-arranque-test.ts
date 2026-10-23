import AsyncStorage from "@react-native-async-storage/async-storage";
import { esAccesoGuardado, esNegocioGuardado, guardarNegocio, leerAcceso, leerNegocio } from "@/lib/memoria-arranque";

describe("lib/memoria-arranque", () => {
  beforeEach(async () => { await AsyncStorage.clear(); });

  test("solo acepta un rol con negocio; el staff necesita su ficha", () => {
    expect(esAccesoGuardado({ estado: "admin", tenantId: "t", professionalId: null, permisos: null })).toBe(true);
    expect(esAccesoGuardado({ estado: "staff", tenantId: "t", professionalId: "p", permisos: {} })).toBe(true);
    expect(esAccesoGuardado({ estado: "staff", tenantId: "t", professionalId: null, permisos: {} })).toBe(false);
    expect(esAccesoGuardado({ estado: "sin-rol", tenantId: "t", professionalId: null })).toBe(false);
    expect(esAccesoGuardado({ estado: "admin", tenantId: "", professionalId: null })).toBe(false);
    expect(esAccesoGuardado(null)).toBe(false);
  });

  test("una caché corrupta se ignora", async () => {
    await AsyncStorage.setItem("zyncra_acceso_u1", "{no es json");
    expect(await leerAcceso("u1")).toBeNull();
    await AsyncStorage.setItem("zyncra_negocio_admin_t1", JSON.stringify({ tenant: {} }));
    expect(await leerNegocio("admin", "t1")).toBeNull();
  });

  test("el negocio se guarda por rol y por negocio", async () => {
    const n = { tenant: { name: "Imperio", phone: "", address: "", slug: "imperio", logoUrl: null }, timezone: "America/Bogota", currency: "COP", locale: "es-CO", categoryOrder: ["A"] };
    expect(esNegocioGuardado(n)).toBe(true);
    await guardarNegocio("staff", "t1", n);
    expect(await leerNegocio("staff", "t1")).toEqual(n);
    expect(await leerNegocio("admin", "t1")).toBeNull();
    expect(await leerNegocio("staff", "t2")).toBeNull();
  });
});
