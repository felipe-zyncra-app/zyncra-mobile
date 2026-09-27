// Mocks globales de los tests (se cargan antes de cada archivo de test).

// AsyncStorage es nativo y no existe en Node: el mock oficial guarda en memoria.
// Sin esto, importar lib/theme, lib/supabase o cualquier cosa que los use revienta.
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);
