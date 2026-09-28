// Tests unitarios con el preset oficial de Expo SDK 54 (jest-expo).
// Los tests van en carpetas __tests__/ y se llaman *-test.ts(x), como en la doc
// de Expo. Nunca dentro de app/: expo-router tomaría el archivo como una ruta.
/** @type {import('jest').Config} */
module.exports = {
  preset: "jest-expo",
  testMatch: ["**/__tests__/**/*-test.[jt]s?(x)"],
  // ios/ y android/ son carpetas nativas generadas (no versionadas): sus
  // package.json duplicados confunden al mapa de módulos de Jest.
  modulePathIgnorePatterns: ["<rootDir>/ios/", "<rootDir>/android/", "<rootDir>/.expo/"],
  // Las edge functions son Deno (imports jsr:/npm:), no corren en Jest.
  testPathIgnorePatterns: ["/node_modules/", "<rootDir>/supabase/functions/"],
  setupFiles: ["<rootDir>/jest.setup.js"],
};
