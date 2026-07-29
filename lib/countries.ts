// Indicativos telefónicos para el selector de país (clientes). Mismo listado
// que src/lib/countries.ts en el panel web — Colombia primero: sigue siendo
// el mercado principal y el default histórico.

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

export function flagEmoji(iso2: string): string {
  return iso2
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

export function countryByDial(dial: string): Country {
  return COUNTRIES.find((c) => c.dial === dial) ?? COUNTRIES[0];
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
