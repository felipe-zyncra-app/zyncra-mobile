import {
  esAdministradorDelEquipo, modulosWebDe, pantallaPermitida, pantallaAdminDe, inicioAdministradorEquipo,
} from "../acceso-equipo";

// La administradora del negocio usa la app del dueño con los módulos que
// tiene prendidos en el portal; el resto del equipo sigue en (staff).

test("el rol es toda la agenda y la caja, como el interruptor del portal", () => {
  expect(esAdministradorDelEquipo({ full_agenda: true, manage_pos: true })).toBe(true);
  expect(esAdministradorDelEquipo({ full_agenda: "true", manage_pos: "true" })).toBe(true);
  expect(esAdministradorDelEquipo({ full_agenda: true, manage_pos: false })).toBe(false);
  expect(esAdministradorDelEquipo({ manage_pos: true })).toBe(false);
  expect(esAdministradorDelEquipo(null)).toBe(false);
});

test("módulos: lo guardado manda y lo que falta toma el valor del portal", () => {
  const m = modulosWebDe({ web_modules: { "/admin": false, "/admin/pos": true, "/admin/clients": "true" } });
  expect(m["/admin"]).toBe(false);          // el dueño lo apagó (Imperio)
  expect(m["/admin/calendar"]).toBe(true);  // por defecto
  expect(m["/admin/pos"]).toBe(true);
  expect(m["/admin/clients"]).toBe(true);
  expect(m["/admin/caja"]).toBeUndefined();
});

test("solo abre las pantallas de sus módulos; lo del dueño nunca", () => {
  const m = modulosWebDe({ web_modules: { "/admin": false, "/admin/pos": true, "/admin/caja": true, "/admin/clients": true, "/admin/commissions": true } });
  expect(pantallaPermitida("agenda", m)).toBe(true);
  expect(pantallaPermitida("pos", m)).toBe(true);
  expect(pantallaPermitida("pos-history", m)).toBe(true);
  expect(pantallaPermitida("caja", m)).toBe(true);
  expect(pantallaPermitida("settings", m)).toBe(true);   // es su perfil
  expect(pantallaPermitida("index", m)).toBe(false);     // Panel apagado
  expect(pantallaPermitida("commissions", m)).toBe(false);
  expect(pantallaPermitida("finanzas", m)).toBe(false);
  expect(pantallaPermitida("invoices", m)).toBe(false);
});

test("pantalla de la ruta actual", () => {
  expect(pantallaAdminDe(["(admin)", "(tabs)"])).toBe("index");
  expect(pantallaAdminDe(["(admin)", "(tabs)", "agenda"])).toBe("agenda");
  expect(pantallaAdminDe(["(admin)", "caja"])).toBe("caja");
  expect(pantallaAdminDe(["(staff)", "profile"])).toBeNull();
  expect(pantallaAdminDe(["settings", "team"])).toBeNull();
});

test("entra a la agenda; sin agenda, a lo primero que tenga", () => {
  expect(inicioAdministradorEquipo(modulosWebDe({}))).toBe("/(admin)/(tabs)/agenda");
  expect(inicioAdministradorEquipo(modulosWebDe({ web_modules: { "/admin/calendar": false } }))).toBe("/(admin)/(tabs)");
  expect(inicioAdministradorEquipo(modulosWebDe({ web_modules: { "/admin/calendar": false, "/admin": false } }))).toBe("/(admin)/(tabs)/settings");
});
