import type { CountryCode } from "libphonenumber-js";
import { esErrorDeRed, esFuncionInexistente } from "./db";
import { supabase } from "./supabase";

/**
 * Reglas de cuenta compartidas por el login, el registro, Mi perfil y Equipo.
 * Antes cada pantalla tenía la suya: el registro exigía mayúscula y número y
 * Mi perfil aceptaba "aaaaaa" (AJU-24); el login mostraba los errores de
 * Supabase en inglés (AJU-22).
 */

// ─── Borrador del registro ───────────────────────────────────────────────────

/**
 * Clave del borrador del asistente de registro (nombre del negocio, WhatsApp…).
 * Sobrevive a que el sistema mate la app mientras el dueño busca el código,
 * y se BORRA al cerrar sesión (useAuth().cerrarSesion): si no, quien se
 * registrara después en el mismo teléfono veía los datos del anterior.
 */
export const CLAVE_BORRADOR_REGISTRO = "zyncra_registro_borrador_v1";

// ─── Contraseña ──────────────────────────────────────────────────────────────

/** La misma regla que el registro del portal (passwordRegex en register/page.tsx). */
export const REGLA_CONTRASENA = /^(?=.*[A-Z])(?=.*\d).{6,}$/;
export const AYUDA_CONTRASENA = "Mín. 6 caracteres, 1 mayúscula y 1 número.";

/** null si la contraseña sirve; si no, el motivo en español. */
export function validarContrasena(pw: string): string | null {
  if (!pw) return "Escribe una contraseña.";
  if (!REGLA_CONTRASENA.test(pw)) return `La contraseña no es segura. ${AYUDA_CONTRASENA}`;
  return null;
}

// ─── Errores de Supabase Auth ────────────────────────────────────────────────

type ErrorAuth = { message?: string; code?: string; status?: number; name?: string };

/**
 * Traduce los errores de GoTrue (vienen en inglés). Mira primero `code`
 * (auth-js ≥ 2.60 lo trae) y luego el texto.
 */
export function traducirErrorAuth(err: unknown): string {
  if (!err) return "Ocurrió un error inesperado. Inténtalo de nuevo.";
  const e = (typeof err === "string" ? { message: err } : err) as ErrorAuth;
  const code = (e.code ?? "").toLowerCase();
  const m = (e.message ?? "").toLowerCase();

  if (esErrorDeRed(err) || m.includes("network") || m.includes("failed to fetch")) {
    return "Sin conexión. Revisa tu internet e inténtalo de nuevo.";
  }
  if (code === "invalid_credentials" || m.includes("invalid login credentials")) {
    return "Correo o contraseña incorrectos.";
  }
  if (code === "email_not_confirmed" || m.includes("email not confirmed")) {
    return "Tu correo aún no está confirmado. Revisa tu bandeja de entrada.";
  }
  if (code === "user_already_exists" || code === "email_exists" || m.includes("already registered") || m.includes("already been registered")) {
    return "Ese correo ya tiene una cuenta. Inicia sesión; si no terminaste el registro, al entrar podrás terminarlo.";
  }
  if (code === "same_password" || m.includes("should be different")) {
    return "La nueva contraseña debe ser distinta de la actual.";
  }
  if (code === "weak_password" || m.includes("password should") || m.includes("weak password")) {
    return `La contraseña no es segura. ${AYUDA_CONTRASENA}`;
  }
  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit" || m.includes("rate limit") || m.includes("for security purposes")) {
    return "Hiciste varios intentos seguidos. Espera un minuto e inténtalo de nuevo.";
  }
  if (code === "email_address_invalid" || (m.includes("invalid") && m.includes("email"))) {
    return "El correo no es válido.";
  }
  if (code === "user_banned") return "Esta cuenta está bloqueada. Escríbenos a soporte.";
  if (code === "session_not_found" || m.includes("jwt") || m.includes("session")) {
    return "Tu sesión expiró. Vuelve a iniciar sesión.";
  }
  return "No pudimos completar la operación. Inténtalo de nuevo.";
}

// ─── Slug del link de reservas ───────────────────────────────────────────────

/**
 * "Peluquería Ñandú" → "peluqueria-nandu". Antes \w se comía las letras con
 * tilde ("peluquera-and") y un nombre sin letras ASCII daba un slug vacío
 * (AJU-14). Nunca devuelve vacío.
 */
export function crearSlug(nombre: string): string {
  const base = (nombre ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return base || "negocio";
}

/**
 * Variante del slug para el intento n (0 = el slug tal cual). El nombre del
 * negocio no tiene por qué ser único; el link sí, así que ante un choque se
 * agrega un sufijo en vez de culpar al nombre: -2, -3 y luego 4 caracteres
 * al azar.
 */
export function slugConSufijo(base: string, intento: number, azar: () => number = Math.random): string {
  if (intento <= 0) return base;
  if (intento <= 2) return `${base}-${intento + 1}`;
  const letras = "abcdefghijkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 4; i++) s += letras[Math.floor(azar() * letras.length) % letras.length];
  return `${base}-${s}`;
}

// ─── País, moneda, idioma y zona del negocio ─────────────────────────────────

export type PaisRegistro = {
  code: CountryCode;
  name: string;
  currency: string;
  locale: string;
  /** Zonas IANA del país; la primera es la de por defecto. */
  zonas: string[];
};

/**
 * Mismos países, monedas y locales que el registro del portal
 * (COUNTRIES en src/app/(auth)/register/page.tsx), más su zona horaria.
 */
export const PAISES_REGISTRO: PaisRegistro[] = [
  { code: "CO", name: "Colombia",        currency: "COP", locale: "es-CO", zonas: ["America/Bogota"] },
  { code: "MX", name: "México",          currency: "MXN", locale: "es-MX", zonas: ["America/Mexico_City", "America/Monterrey", "America/Merida", "America/Cancun", "America/Chihuahua", "America/Hermosillo", "America/Mazatlan", "America/Tijuana"] },
  { code: "AR", name: "Argentina",       currency: "ARS", locale: "es-AR", zonas: ["America/Argentina/Buenos_Aires", "America/Argentina/Cordoba", "America/Argentina/Mendoza", "America/Argentina/Salta"] },
  { code: "CL", name: "Chile",           currency: "CLP", locale: "es-CL", zonas: ["America/Santiago", "America/Punta_Arenas", "Pacific/Easter"] },
  { code: "PE", name: "Perú",            currency: "PEN", locale: "es-PE", zonas: ["America/Lima"] },
  { code: "EC", name: "Ecuador",         currency: "USD", locale: "es-EC", zonas: ["America/Guayaquil", "Pacific/Galapagos"] },
  { code: "VE", name: "Venezuela",       currency: "VES", locale: "es-VE", zonas: ["America/Caracas"] },
  { code: "BO", name: "Bolivia",         currency: "BOB", locale: "es-BO", zonas: ["America/La_Paz"] },
  { code: "PY", name: "Paraguay",        currency: "PYG", locale: "es-PY", zonas: ["America/Asuncion"] },
  { code: "UY", name: "Uruguay",         currency: "UYU", locale: "es-UY", zonas: ["America/Montevideo"] },
  { code: "CR", name: "Costa Rica",      currency: "CRC", locale: "es-CR", zonas: ["America/Costa_Rica"] },
  { code: "PA", name: "Panamá",          currency: "PAB", locale: "es-PA", zonas: ["America/Panama"] },
  { code: "GT", name: "Guatemala",       currency: "GTQ", locale: "es-GT", zonas: ["America/Guatemala"] },
  { code: "DO", name: "Rep. Dominicana", currency: "DOP", locale: "es-DO", zonas: ["America/Santo_Domingo"] },
  { code: "US", name: "Estados Unidos",  currency: "USD", locale: "en-US", zonas: ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"] },
  { code: "ES", name: "España",          currency: "EUR", locale: "es-ES", zonas: ["Europe/Madrid", "Atlantic/Canary"] },
];

export const PAIS_REGISTRO_POR_DEFECTO = PAISES_REGISTRO[0];

export function banderaDe(code: string): string {
  return code.toUpperCase().replace(/./g, c => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

/** Zona configurada en el teléfono, o null si el motor no la informa. */
export function zonaDelDispositivo(): string | null {
  try {
    const z = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof z === "string" && z.includes("/") ? z : null;
  } catch {
    return null;
  }
}

/** País al que pertenece una zona (para proponer el país del teléfono). */
export function paisPorZona(zona: string | null | undefined): PaisRegistro | undefined {
  if (!zona) return undefined;
  return PAISES_REGISTRO.find(p => p.zonas.includes(zona));
}

/**
 * Zona del negocio para el país elegido: la del teléfono si es de ese país
 * (México o EE. UU. tienen varias), si no la principal del país.
 */
export function zonaParaPais(pais: PaisRegistro, zonaTelefono: string | null | undefined): string {
  return zonaTelefono && pais.zonas.includes(zonaTelefono) ? zonaTelefono : pais.zonas[0];
}

/** País del negocio a partir de su locale ("es-MX" → "MX"), para validar teléfonos. */
export function paisDeLocale(locale: string | null | undefined): CountryCode {
  const region = (locale ?? "").split("-")[1]?.toUpperCase();
  const p = PAISES_REGISTRO.find(x => x.code === region);
  return p?.code ?? "CO";
}

// ─── Legal ───────────────────────────────────────────────────────────────────

/**
 * Versión de los Términos que se registra en legal_acceptances. Es el espejo
 * de TERMS_VERSION en src/lib/legal.ts del portal: si allá cambia, cámbiala aquí.
 */
export const TERMS_VERSION = "2026-07-13";

// ─── Eliminar la cuenta de un colaborador ────────────────────────────────────

/**
 * ¿El servidor ya protege el historial al eliminar la cuenta de un
 * colaborador? La migración 20260927 trae mi_negocio() junto con el cambio
 * que desactiva la ficha del profesional en vez de borrarla: sin ella,
 * delete-account borra el profesional y, en cascada, todas sus citas y
 * liquidaciones del negocio (SEG-02 / D18).
 *
 * Tres estados: solo una respuesta SIN error prueba que la migración está. Un
 * corte de red o una sesión vencida no prueban nada ("desconocido"). Lo usan
 * Mi perfil del staff y AccountBlocked, que son las dos puertas de salida.
 */
export type EstadoServidorCuentas = { estado: "actualizado" | "pendiente" | "desconocido"; error?: unknown };

export async function estadoServidorCuentas(): Promise<EstadoServidorCuentas> {
  try {
    const { error } = await supabase.rpc("mi_negocio");
    if (!error) return { estado: "actualizado" };
    if (esFuncionInexistente(error)) return { estado: "pendiente" };
    return { estado: "desconocido", error };
  } catch (e) {
    return { estado: "desconocido", error: e };
  }
}

/** Texto para el colaborador mientras el servidor no protege el historial. */
export const AVISO_ELIMINAR_CUENTA_EQUIPO =
  "Para no borrar el historial de citas del negocio, por ahora la eliminación de cuentas del equipo la hacemos nosotros. Escríbenos a soporte@zyncra.app o desde la página de soporte, o pídesela al administrador del negocio.";
