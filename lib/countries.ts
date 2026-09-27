// Indicativos telefónicos para el selector de país (clientes). Mismo listado
// que src/lib/countries.ts en el panel web — Colombia primero: sigue siendo
// el mercado principal y el default histórico.

import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
import { telefonoE164 } from "./format";

export interface Country {
  iso2: string;
  name: string;
  dial: string;
}

export const COUNTRIES: Country[] = [
  { iso2: "CO", name: "Colombia", dial: "57" },
  { iso2: "MX", name: "México", dial: "52" },
  { iso2: "US", name: "Estados Unidos", dial: "1" },
  { iso2: "CA", name: "Canadá", dial: "1" },
  { iso2: "AR", name: "Argentina", dial: "54" },
  { iso2: "CL", name: "Chile", dial: "56" },
  { iso2: "PE", name: "Perú", dial: "51" },
  { iso2: "EC", name: "Ecuador", dial: "593" },
  { iso2: "VE", name: "Venezuela", dial: "58" },
  { iso2: "BO", name: "Bolivia", dial: "591" },
  { iso2: "PY", name: "Paraguay", dial: "595" },
  { iso2: "UY", name: "Uruguay", dial: "598" },
  { iso2: "PA", name: "Panamá", dial: "507" },
  { iso2: "CR", name: "Costa Rica", dial: "506" },
  { iso2: "GT", name: "Guatemala", dial: "502" },
  { iso2: "HN", name: "Honduras", dial: "504" },
  { iso2: "SV", name: "El Salvador", dial: "503" },
  { iso2: "NI", name: "Nicaragua", dial: "505" },
  { iso2: "DO", name: "Rep. Dominicana", dial: "1" },
  { iso2: "PR", name: "Puerto Rico", dial: "1" },
  { iso2: "CU", name: "Cuba", dial: "53" },
  { iso2: "BR", name: "Brasil", dial: "55" },
  { iso2: "ES", name: "España", dial: "34" },
  { iso2: "GB", name: "Reino Unido", dial: "44" },
  { iso2: "FR", name: "Francia", dial: "33" },
  { iso2: "DE", name: "Alemania", dial: "49" },
  { iso2: "IT", name: "Italia", dial: "39" },
  { iso2: "PT", name: "Portugal", dial: "351" },
];

export const DEFAULT_COUNTRY_DIAL = "57";
export const DEFAULT_COUNTRY_ISO = "CO";

export function flagEmoji(iso2: string): string {
  return iso2
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

export function countryByDial(dial: string): Country {
  return COUNTRIES.find((c) => c.dial === dial) ?? COUNTRIES[0];
}

export function countryByIso(iso2: string | null | undefined): Country {
  const code = (iso2 ?? "").toUpperCase();
  return COUNTRIES.find((c) => c.iso2 === code) ?? COUNTRIES[0];
}

// Combina el indicativo elegido con el número nacional en el formato que se
// guarda en clients.phone (indicativo + nacional, sin "+").
export function combinePhone(dialCode: string, national: string): string {
  return `${dialCode.replace(/\D/g, "")}${national.replace(/\D/g, "")}`;
}

// Separa un teléfono guardado en indicativo + número nacional para precargar
// el selector al editar. Si se conoce phone_country_code úsalo directo; si no
// (clientes creados antes de esta feature), un número de 10 dígitos se asume
// colombiano sin indicativo, y si no, se busca el indicativo conocido más
// largo que calce al inicio — mismo criterio que BookingFlow.tsx en la web.
export function splitPhone(raw: string, knownDial?: string | null): { countryCode: string; phone: string } {
  const digits = raw.replace(/\D/g, "");
  if (knownDial && digits.startsWith(knownDial)) {
    return { countryCode: knownDial, phone: digits.slice(knownDial.length) };
  }
  if (digits.length === 10) return { countryCode: DEFAULT_COUNTRY_DIAL, phone: digits };
  const byDialDesc = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);
  for (const c of byDialDesc) {
    if (digits.startsWith(c.dial) && digits.length > c.dial.length) {
      return { countryCode: c.dial, phone: digits.slice(c.dial.length) };
    }
  }
  return { countryCode: DEFAULT_COUNTRY_DIAL, phone: digits };
}

/**
 * Para precargar el formulario de edición: país (iso2), indicativo y número
 * nacional. Primero pregunta a libphonenumber, que distingue +1 de EE. UU.,
 * Canadá o República Dominicana; si no reconoce el número usa splitPhone.
 */
export function separarTelefono(raw: string | null | undefined, knownDial?: string | null): { iso2: string; dial: string; national: string } {
  const e164 = telefonoE164(raw, { indicativo: knownDial ?? undefined });
  const n = e164 ? parsePhoneNumberFromString(e164) : undefined;
  if (n) {
    const iso = n.country && COUNTRIES.some(c => c.iso2 === n.country) ? n.country : countryByDial(n.countryCallingCode).iso2;
    return { iso2: iso, dial: n.countryCallingCode, national: n.nationalNumber };
  }
  const { countryCode, phone } = splitPhone(raw ?? "", knownDial);
  return { iso2: countryByDial(countryCode).iso2, dial: countryCode, national: phone };
}

export type TelefonoCliente = {
  /** Lo que va en clients.phone: indicativo + nacional, sin "+" (E.164 sin el "+"). */
  phone: string;
  /** Lo que va en clients.phone_country_code. */
  countryCode: string;
  /** false si libphonenumber no lo reconoce como número real de ese país. */
  valido: boolean;
};

/**
 * Normaliza lo que escribió el usuario para guardarlo en clients.phone.
 *
 * Antes se pegaba el indicativo a los dígitos tal cual (combinePhone), así que
 * "0300…" o "57 300…" con Colombia elegida quedaban como 570300… o 5757300…,
 * y como hay UNIQUE (tenant_id, phone) el mismo cliente podía existir dos veces.
 * Ahora libphonenumber quita el prefijo nacional y el indicativo repetido. Si
 * el usuario escribe "+52…" se respeta ese país aunque el selector diga otro.
 * Devuelve null si no hay dígitos.
 */
export function telefonoParaGuardar(iso2: string, national: string): TelefonoCliente | null {
  const bruto = (national ?? "").trim();
  const digitos = bruto.replace(/\D/g, "");
  if (!digitos) return null;
  const pais = countryByIso(iso2);
  const internacional = bruto.startsWith("+") || digitos.startsWith("00");
  const n = internacional
    ? parsePhoneNumberFromString(`+${digitos.replace(/^00/, "")}`)
    : parsePhoneNumberFromString(bruto, pais.iso2 as CountryCode);
  if (n && n.isValid()) {
    return { phone: n.number.slice(1), countryCode: n.countryCallingCode, valido: true };
  }
  return { phone: internacional ? digitos.replace(/^00/, "") : combinePhone(pais.dial, digitos), countryCode: pais.dial, valido: false };
}

/**
 * Formas en que el MISMO teléfono puede estar guardado en clients.phone. Hay
 * clientes viejos con los 10 dígitos colombianos sin indicativo, otros con
 * indicativo y algunos con "+" o espacios (reserva pública, WhatsApp, cargues).
 * Sirve para buscar duplicados antes de crear un cliente (el UNIQUE solo
 * detecta la forma exacta). Mismo criterio que phoneOrFilter del web.
 */
export function variantesTelefono(phone: string, countryCode?: string | null): string[] {
  const digitos = (phone ?? "").replace(/\D/g, "");
  const out = new Set<string>();
  if (digitos) out.add(digitos);
  if (phone && phone.trim() !== digitos) out.add(phone.trim());
  const e164 = telefonoE164(phone, { indicativo: countryCode ?? undefined });
  if (e164) {
    out.add(e164.slice(1));
    out.add(e164);
    const n = parsePhoneNumberFromString(e164);
    if (n) {
      out.add(n.nationalNumber);
      out.add(`${n.countryCallingCode}${n.nationalNumber}`);
    }
  }
  if (digitos.length > 10) out.add(digitos.slice(-10));
  return [...out].filter(v => v.replace(/\D/g, "").length >= 6);
}
