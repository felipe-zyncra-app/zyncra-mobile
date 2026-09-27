import { existsSync } from "node:fs";
import type { ConfigContext, ExpoConfig } from "expo/config";

// Push en Android (FCM): el google-services.json de Firebase no se versiona,
// porque el repo es público. En EAS llega como variable de tipo archivo
// GOOGLE_SERVICES_JSON (entorno production); en local, el archivo en la raíz,
// que está en .gitignore. Si no existe ninguno, la app compila igual, pero
// Android no recibe push (getExpoPushTokenAsync falla y queda en el log).
function googleServicesFile(): string | undefined {
  const desdeEas = process.env.GOOGLE_SERVICES_JSON;
  if (desdeEas && existsSync(desdeEas)) return desdeEas;
  if (existsSync("./google-services.json")) return "./google-services.json";
  return undefined;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const archivo = googleServicesFile();
  return {
    ...(config as ExpoConfig),
    android: {
      ...config.android,
      ...(archivo ? { googleServicesFile: archivo } : {}),
    },
  };
};
