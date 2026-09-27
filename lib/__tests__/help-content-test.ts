import fs from "fs";
import path from "path";
import { HELP_CATEGORIES, allArticles, findArticle } from "@/lib/help-content";

/**
 * El Centro de ayuda describía el portal web (COM-18). Estos tests evitan que
 * vuelva a pasar: sin frases del web y con nombres de pantallas que existen.
 */

const textos = allArticles().flatMap(a => [a.title, a.description, ...a.steps.flatMap(s => [s.title, s.body])]);
const todo = textos.join("\n");

// Etiquetas del menú de Ajustes, leídas del código de la pantalla.
const settingsSrc = fs.readFileSync(path.join(__dirname, "..", "..", "app", "(admin)", "(tabs)", "settings.tsx"), "utf8");
const etiquetasAjustes = Array.from(settingsSrc.matchAll(/label:\s*"([^"]+)"/g), m => m[1]);

describe("Centro de ayuda", () => {
  test("no usa frases del portal web", () => {
    for (const frase of ["menú lateral", "Mi Marca", "Webhook", "webhook", "Haz clic", "Negocio →", "Panel →", "Regional"]) {
      expect(todo).not.toContain(frase);
    }
  });

  test("las variables van con doble llave, como las reemplaza la app", () => {
    // {nombre} suelto (sin la doble llave) solo aparece para advertir que no funciona.
    const sueltas = textos.filter(t => /(^|[^{])\{(nombre|servicio|hora|fecha|negocio|link)\}(?!\})/.test(t));
    expect(sueltas.every(t => t.includes("no funcionan"))).toBe(true);
  });

  test("cada 'Ajustes → X' nombra una entrada real del menú de Ajustes", () => {
    expect(etiquetasAjustes.length).toBeGreaterThan(10);
    const rotos: string[] = [];
    for (const t of textos) {
      let i = t.indexOf("Ajustes → ");
      while (i >= 0) {
        const resto = t.slice(i + "Ajustes → ".length);
        if (!etiquetasAjustes.some(e => resto.startsWith(e))) rotos.push(resto.slice(0, 40));
        i = t.indexOf("Ajustes → ", i + 1);
      }
    }
    expect(rotos).toEqual([]);
  });

  test("no menciona precios ni planes (iOS 3.1.1)", () => {
    expect(todo).not.toMatch(/\bplan(es)?\b|precio del plan|suscripci[oó]n|mejora tu/i);
  });

  test("slugs únicos y categorías coherentes", () => {
    const slugs = allArticles().map(a => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const c of HELP_CATEGORIES) for (const a of c.articles) expect(a.category).toBe(c.id);
    expect(findArticle("recordatorios")?.steps.length).toBeGreaterThan(0);
  });
});
