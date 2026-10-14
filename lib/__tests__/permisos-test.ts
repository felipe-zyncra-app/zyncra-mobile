import { DEFAULT_PERMISSIONS, RESTRICTIVE_PERMISSIONS, parsePermissions } from "@/lib/permissions";

// parsePermissions no toca la red; se simulan supabase y auth solo para que
// importar el módulo no cree un cliente real.
jest.mock("@/lib/supabase", () => ({ supabase: {} }));
jest.mock("@/lib/auth", () => ({ useAuth: () => ({ user: null, role: null, professionalId: null }) }));

describe("parsePermissions", () => {
  test("sin permisos guardados: ve todo pero no tiene agenda completa ni caja", () => {
    for (const raw of [null, undefined, "basura", 3, []]) {
      expect(parsePermissions(raw)).toEqual(DEFAULT_PERMISSIONS);
    }
    expect(DEFAULT_PERMISSIONS.full_agenda).toBe(false);
    expect(DEFAULT_PERMISSIONS.manage_pos).toBe(false);
  });

  test("el restrictivo niega todo, también full_agenda y manage_pos", () => {
    expect(Object.values(RESTRICTIVE_PERMISSIONS).every(v => v === false)).toBe(true);
  });

  test("full_agenda y manage_pos aceptan true y el string 'true', como la RLS", () => {
    expect(parsePermissions({ full_agenda: true, manage_pos: "true" })).toMatchObject({ full_agenda: true, manage_pos: true });
    expect(parsePermissions({ full_agenda: "false", manage_pos: false })).toMatchObject({ full_agenda: false, manage_pos: false });
    expect(parsePermissions({ full_agenda: "si", manage_pos: 1 })).toMatchObject({ full_agenda: false, manage_pos: false });
  });

  test("los de visibilidad: null o ausente = visible; 'false' oculta", () => {
    expect(parsePermissions({ contact: null, amounts: "false", clients_tab: false })).toMatchObject({
      contact: true, amounts: false, clients_tab: false,
    });
  });

  test("conserva web_modules para que guardar desde Ajustes → Equipo no borre el acceso al portal", () => {
    const web_modules = { "/admin": true, "/admin/pos": true };
    const perms = parsePermissions({ contact: false, full_agenda: true, web_modules });
    expect(perms).toMatchObject({ contact: false, full_agenda: true });
    expect((perms as unknown as { web_modules: unknown }).web_modules).toEqual(web_modules);
  });
});

describe("permisos de su propia ficha", () => {
  it("por defecto el colaborador no cambia su nombre ni su horario", () => {
    expect(parsePermissions(null).edit_profile).toBe(false);
    expect(parsePermissions({}).edit_schedule).toBe(false);
    expect(RESTRICTIVE_PERMISSIONS.edit_schedule).toBe(false);
  });
  it("lee los permisos que da el dueño, también como texto", () => {
    const p = parsePermissions({ edit_profile: true, edit_schedule: "true" });
    expect(p.edit_profile).toBe(true);
    expect(p.edit_schedule).toBe(true);
  });
});
