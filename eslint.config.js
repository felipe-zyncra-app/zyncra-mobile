// https://docs.expo.dev/guides/using-eslint/
// Config oficial de Expo (eslint-config-expo, flat config). Se corre con
// `npm run lint`. Las advertencias no rompen el CI; los errores sí.
const { defineConfig, globalIgnores } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  globalIgnores([
    "dist/*",
    "web-build/*",
    ".expo/*",
    // Carpetas nativas generadas por prebuild (no se versionan).
    "ios/*",
    "android/*",
    // Edge functions: son Deno (imports jsr:/npm:), el resolver de Node no las entiende.
    "supabase/functions/*",
    // Generado por `npm run gen:types`.
    "lib/database.types.ts",
  ]),
  expoConfig,
  {
    // Globales de Jest para el setup y los tests en JS (en TS ya las da @types/jest).
    files: ["jest.setup.js", "**/__tests__/**/*.{js,jsx}"],
    languageOptions: {
      globals: {
        jest: "readonly", describe: "readonly", test: "readonly", it: "readonly", expect: "readonly",
        beforeAll: "readonly", afterAll: "readonly", beforeEach: "readonly", afterEach: "readonly",
      },
    },
  },
  {
    rules: {
      // En React Native el texto de <Text> se pinta tal cual: las comillas de
      // los textos de UI ("Cobrar", 'Nueva cita') no son HTML y no hay que escaparlas.
      "react/no-unescaped-entities": "off",
    },
  },
]);
