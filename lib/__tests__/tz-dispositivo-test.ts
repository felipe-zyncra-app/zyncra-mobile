import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as ts from "typescript";

// El teléfono del dueño puede estar en otra zona que su negocio (de viaje, o
// un negocio en Madrid administrado desde Bogotá). Jest no deja cambiar la
// zona del proceso (process.env.TZ es una copia), así que lib/tz.ts y
// lib/format.ts se transpilan y se corren en procesos de Node con TZ real.
// El resultado tiene que ser el mismo en todas las zonas del teléfono.

const RAIZ = path.resolve(__dirname, "..", "..");
const ZONAS_TELEFONO = [
  "America/Bogota", "UTC", "Europe/Madrid", "Asia/Tokyo",
  "Pacific/Kiritimati",   // UTC+14
  "Pacific/Pago_Pago",    // UTC-11
  "America/Santiago", "America/Los_Angeles",
];

// Lo que calcula cada proceso. El reloj se fija en sábado 26-sep-2026 a las
// 7:30 PM de Bogotá (00:30 UTC del domingo 27), la hora en que el UTC ya
// cambió de día.
const PROGRAMA = `
const AHORA = Date.parse("2026-09-27T00:30:00Z");
const DateReal = Date;
class DateFija extends DateReal {
  constructor(...a) { if (a.length === 0) super(AHORA); else super(...a); }
  static now() { return AHORA; }
}
globalThis.Date = DateFija;
const tz = require("./tz.js");
const f = require("./format.js");
const BOG = "America/Bogota", MAD = "Europe/Madrid", SCL = "America/Santiago";
const semana = tz.rangoDePeriodo("semana", BOG);
const pickers = ["2026-09-26", "2026-01-01", "2028-02-29"].map(d => {
  const x = tz.fechaDeDia(d);
  return [x.getFullYear(), x.getMonth() + 1, x.getDate()].join("-");
});
tz.establecerZonaActiva(BOG);
const r = {
  hoyBog: tz.hoyNegocio(BOG),
  hoyMad: tz.hoyNegocio(MAD),
  hoyActiva: tz.hoyNegocio(),
  minutosBog: tz.minutosDelDia(undefined, BOG),
  cobroNoche: tz.diaLocalDe("2026-09-27T00:30:00Z", BOG),
  horaNoche: tz.horaLocalDe("2026-09-27T00:30:00Z", BOG),
  inicioBog: tz.inicioDelDiaUTC("2026-09-26", BOG),
  finBog: tz.finDelDiaUTC("2026-09-26", BOG),
  inicioMadVerano: tz.inicioDelDiaUTC("2026-03-29", MAD),
  inicioSclSalto: tz.inicioDelDiaUTC("2026-09-06", SCL),
  cita: tz.instanteDe("2026-09-26", "19:30", BOG).toISOString(),
  citaMad: tz.instanteDe("2026-09-26", "10:00", MAD).toISOString(),
  semana: [semana.desde, semana.hasta, semana.desdeUTC, semana.hastaUTC],
  incluyeHoy: tz.rangoIncluyeHoy(semana),
  mes: tz.rangoDePeriodo("mes", BOG, "2028-02-10").hasta,
  domingo: tz.inicioDeSemana("2026-09-27"),
  etiqueta: tz.etiquetaRango(tz.rangoDePeriodo("dia", BOG)),
  largo: tz.fmtDia("2026-09-26", "largo"),
  pickers,
  diaCorto: f.fmtDateShort("2026-09-26"),
  diaCompacto: f.fmtDateCompact("2026-09-26"),
  diaCompleto: f.fmtDateFull("2026-09-01"),
  instanteCompacto: f.fmtDateCompact("2026-09-27T00:30:00Z"),
  instanteCompleto: f.fmtDateFull("2026-09-27T00:30:00Z"),
  hora: f.fmtTime("2026-09-27T00:30:00Z"),
  hora12: f.fmt12Hour("19:30:00"),
  zonaTelefono: Intl.DateTimeFormat().resolvedOptions().timeZone,
};
process.stdout.write(JSON.stringify(r));
`;

let dir = "";

// Cada proceso tarda ~100 ms aquí; en el runner del CI, con otras suites en
// paralelo, puede pasar varias veces eso: los 5 s por defecto quedan cortos.
jest.setTimeout(60_000);

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "zyncra-tz-"));
  for (const nombre of ["tz", "format"]) {
    const fuente = fs.readFileSync(path.join(RAIZ, "lib", `${nombre}.ts`), "utf8");
    const js = ts.transpileModule(fuente, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText;
    fs.writeFileSync(path.join(dir, `${nombre}.js`), js);
  }
  fs.writeFileSync(path.join(dir, "programa.js"), PROGRAMA);
});

afterAll(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

// Un proceso por zona: el test que compara todas reutiliza lo ya calculado.
const resultados = new Map<string, Record<string, unknown>>();

function correrCon(zonaTelefono: string): Record<string, unknown> {
  const previo = resultados.get(zonaTelefono);
  if (previo) return previo;
  const salida = execFileSync(process.execPath, [path.join(dir, "programa.js")], {
    cwd: dir,
    env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", TZ: zonaTelefono, NODE_PATH: path.join(RAIZ, "node_modules") },
    encoding: "utf8",
    timeout: 30_000,
  });
  const r = JSON.parse(salida) as Record<string, unknown>;
  resultados.set(zonaTelefono, r);
  return r;
}

const ESPERADO = {
  hoyBog: "2026-09-26",
  hoyMad: "2026-09-27",
  hoyActiva: "2026-09-26",
  minutosBog: 19 * 60 + 30,
  cobroNoche: "2026-09-26",
  horaNoche: "19:30",
  inicioBog: "2026-09-26T05:00:00.000Z",
  finBog: "2026-09-27T04:59:59.999Z",
  inicioMadVerano: "2026-03-28T23:00:00.000Z",
  inicioSclSalto: "2026-09-06T04:00:00.000Z",
  cita: "2026-09-27T00:30:00.000Z",
  citaMad: "2026-09-26T08:00:00.000Z",
  semana: ["2026-09-21", "2026-09-27", "2026-09-21T05:00:00.000Z", "2026-09-28T04:59:59.999Z"],
  incluyeHoy: true,
  mes: "2028-02-29",
  domingo: "2026-09-21",
  etiqueta: "Hoy",
  largo: "sábado 26 de septiembre",
  pickers: ["2026-9-26", "2026-1-1", "2028-2-29"],
  diaCorto: "26 sep 2026",
  hora12: "7:30 PM",
};

describe("teléfono en una zona distinta a la del negocio", () => {
  test.each(ZONAS_TELEFONO)("teléfono en %s: mismas fechas del negocio", (zona) => {
    const r = correrCon(zona);
    expect(r.zonaTelefono).toBe(zona === "UTC" ? "UTC" : zona);   // la simulación sí cambió la zona
    expect(r).toMatchObject(ESPERADO);
    // Un día de calendario ('YYYY-MM-DD') no se corre: antes, con el teléfono
    // en América, fmtDateCompact("2026-09-26") mostraba el 25.
    expect(r.diaCompacto).toMatch(/^26\b/);
    expect(r.diaCompleto).toMatch(/^01\b/);
    // Un instante se muestra en la hora del negocio (Bogotá: sábado 26, 7:30 PM).
    expect(r.instanteCompacto).toMatch(/^26\b/);
    expect(r.instanteCompleto).toMatch(/^26\b/);
    expect(r.hora).toMatch(/^0?7:30\s*p/i);
  });

  test("todas las zonas del teléfono dan exactamente lo mismo", () => {
    const [primera, ...resto] = ZONAS_TELEFONO.map(correrCon).map(({ zonaTelefono: _z, ...r }) => r);
    for (const r of resto) expect(r).toEqual(primera);
  });
});
