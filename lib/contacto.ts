/**
 * Validación de correo y teléfono del dueño al registrar un negocio.
 *
 * Existe porque el registro de esta app dejaba pasar altas sin datos: la
 * condición para avanzar solo miraba correo y contraseña, el teléfono era
 * opcional y nadie comprobaba que el correo pudiera recibir algo. Entraron
 * negocios con "testuser123@example.com" y sin ningún teléfono, imposibles de
 * contactar para cobrar o dar soporte.
 *
 * Es el gemelo de src/lib/contacto.ts en el repo web. Si cambias las reglas
 * aquí, cámbialas allá — y recuerda que el candado real está en la base
 * (trigger tenants_exigir_contacto), que rechaza el insert de cualquier forma.
 *
 * El teléfono ya no es solo colombiano. La app se publicó en todo el mundo y la
 * regla anterior ("10 dígitos que empiecen por 3") rechazaba a cualquiera fuera
 * de Colombia: un +52 55 1234 5678 se leía como celular colombiano inválido.
 * Ahora valida libphonenumber-js, que conoce el formato real de cada país; se
 * escribe el número con indicativo (+52...) o, si no lo lleva, se asume el país
 * por defecto para no romper a quien siempre escribió sus 10 dígitos.
 */

import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

const DOMINIOS_FALSOS = new Set([
  "example.com", "example.org", "example.net", "example.edu",
  "test.com", "test.test", "test.co", "prueba.com", "correo.com",
  "email.com", "mail.com", "asdf.com", "aaa.com", "abc.com",
  "mailinator.com", "tempmail.com", "temp-mail.org", "10minutemail.com",
  "guerrillamail.com", "yopmail.com", "throwawaymail.com", "trashmail.com",
  "fakeinbox.com", "sharklasers.com", "getnada.com", "dispostable.com",
  "maildrop.cc", "mailnesia.com", "spam4.me", "grr.la",
]);

export interface Resultado {
  ok: boolean;
  error?: string;
  /** Teléfono en dígitos con indicativo, listo para guardar. */
  valor?: string;
}

const FORMA_CORREO = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function validarCorreo(entrada: unknown): Resultado {
  const correo = typeof entrada === "string" ? entrada.trim().toLowerCase() : "";
  if (!correo)                    return { ok: false, error: "El correo es obligatorio." };
  if (correo.length > 254)        return { ok: false, error: "El correo es demasiado largo." };
  if (!FORMA_CORREO.test(correo)) return { ok: false, error: "Escribe un correo válido (ej: nombre@gmail.com)." };

  const dominio = correo.split("@")[1];
  if (DOMINIOS_FALSOS.has(dominio)) {
    return { ok: false, error: "Necesitamos un correo real: ahí te enviamos el código de verificación." };
  }
  const extension = dominio.split(".").pop() ?? "";
  if (extension.length < 2 || !/^[a-z]+$/.test(extension)) {
    return { ok: false, error: "Escribe un correo válido (ej: nombre@gmail.com)." };
  }
  return { ok: true, valor: correo };
}

/**
 * Devuelve el número en E.164 sin el "+" (573001234567), listo para guardar en
 * tenants.phone, o null si no es un número real en ningún formato conocido.
 */
export function normalizarTelefono(entrada: unknown, paisPorDefecto: CountryCode = "CO"): string | null {
  const bruto = typeof entrada === "string" ? entrada.trim() : "";
  if (!bruto) return null;

  // Con "+" se respeta el país que escribió el usuario; sin él se asume el de
  // por defecto, que es lo que hace la mayoría escribiendo su número local.
  const numero = bruto.startsWith("+")
    ? parsePhoneNumberFromString(bruto)
    : parsePhoneNumberFromString(bruto, paisPorDefecto);

  if (!numero || !numero.isValid()) return null;
  return numero.number.slice(1); // quita el "+"
}

export function validarTelefono(entrada: unknown, paisPorDefecto: CountryCode = "CO"): Resultado {
  const bruto = typeof entrada === "string" ? entrada.trim() : "";
  if (!bruto) return { ok: false, error: "El WhatsApp es obligatorio: por ahí te contactamos." };

  const numero = normalizarTelefono(bruto, paisPorDefecto);
  if (!numero) {
    return {
      ok: false,
      error: "Ese número no existe. Si estás fuera de Colombia, escríbelo con indicativo (ej: +52 55 1234 5678).",
    };
  }

  // libphonenumber acepta patrones que existen aunque nadie los tenga: 3000000000
  // es un celular colombiano "válido" y entró más de una vez como relleno. El
  // número nacional lo da la propia librería, que sabe dónde termina el
  // indicativo de cada país (España son 9 dígitos, México 10, Chile 9...).
  const nacional = (bruto.startsWith("+")
    ? parsePhoneNumberFromString(bruto)
    : parsePhoneNumberFromString(bruto, paisPorDefecto))!.nationalNumber;
  if (/^(\d)\1+$/.test(nacional) || /^\d{2,3}0{6,}$/.test(nacional) || /^1?234567/.test(nacional)) {
    return { ok: false, error: "Ese número no es real. Escribe tu WhatsApp para poder contactarte." };
  }

  return { ok: true, valor: numero };
}
