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
 */

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

/** Deja solo dígitos y antepone el indicativo si el usuario no lo escribió. */
export function normalizarTelefono(entrada: unknown, indicativo = "57"): string | null {
  if (typeof entrada !== "string") return null;
  const bruto = entrada.trim();
  if (!bruto) return null;

  const traiaIndicativo = bruto.startsWith("+");
  const digitos = bruto.replace(/\D/g, "");
  if (!digitos) return null;
  if (traiaIndicativo) return digitos;

  // Si ya viene con el indicativo delante y es largo, se respeta:
  // evita convertir 573001112233 en 57573001112233.
  if (digitos.startsWith(indicativo) && digitos.length > 10) return digitos;
  return indicativo + digitos;
}

export function validarTelefono(entrada: unknown, indicativo = "57"): Resultado {
  const bruto = typeof entrada === "string" ? entrada.trim() : "";
  if (!bruto) return { ok: false, error: "El WhatsApp es obligatorio: por ahí te contactamos." };

  const numero = normalizarTelefono(bruto, indicativo);
  if (!numero) return { ok: false, error: "Escribe un número de WhatsApp válido." };

  // E.164: 15 dígitos como máximo, 8 como mínimo razonable con indicativo.
  if (numero.length < 8 || numero.length > 15) {
    return { ok: false, error: "El número no parece válido. Incluye el indicativo (ej: +57 300 123 4567)." };
  }

  const nacional = numero.slice(indicativo.length);

  // Rellenos evidentes: 3000000000, 3333333333, 1234567...
  if (/^(\d)\1+$/.test(nacional) || /^\d{2,3}0{6,}$/.test(nacional) || /^1?234567/.test(nacional)) {
    return { ok: false, error: "Ese número no es real. Escribe tu WhatsApp para poder contactarte." };
  }

  // Colombia: celulares de 10 dígitos que empiezan por 3.
  if (indicativo === "57" && (nacional.length !== 10 || !nacional.startsWith("3"))) {
    return { ok: false, error: "En Colombia el celular tiene 10 dígitos y empieza por 3 (ej: 300 123 4567)." };
  }

  return { ok: true, valor: numero };
}
