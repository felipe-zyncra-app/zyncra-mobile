# Expo SDK 54

Este proyecto usa Expo SDK 54 (React Native 0.81, React 19.1, expo-router 6,
expo-notifications 0.32). Lee la doc de ESA versión antes de escribir código:
https://docs.expo.dev/versions/v54.0.0/

No uses la doc de "latest" ni la de versiones más nuevas: traen APIs que aquí
no existen y el error solo aparece al compilar o en el teléfono. Instala
dependencias con `npx expo install <paquete>` para que Expo elija la versión
compatible con el SDK 54.

## Antes de dar algo por terminado

- `npx tsc --noEmit` sin errores.
- `npm run lint` sin errores (las advertencias existentes son deuda conocida;
  no agregues nuevas).
- `npm test` en verde. El CI (`.github/workflows/ci.yml`) corre los tres en
  cada push y PR.

## Tests

- Jest con el preset `jest-expo` y React Native Testing Library 14
  (`render`, `fireEvent` y `userEvent` son async: usa `await`).
- Van en carpetas `__tests__/` (en la raíz o junto al código, p. ej.
  `lib/__tests__/`) y se llaman `*-test.ts` o `*-test.tsx`.
- Nunca dentro de `app/`: expo-router tomaría el archivo como una ruta.
- AsyncStorage ya está simulado en `jest.setup.js`. No llames a Supabase de
  verdad: simula `@/lib/supabase` con `jest.mock`.

## Base de datos

- Supabase es compartido con el portal web. Los tipos generados están en
  `lib/database.types.ts`; se regeneran con `npm run gen:types` (Supabase CLI
  con sesión iniciada) después de cada migración.

## Fuera del código

- Push en Android: no hay Firebase configurado (falta `google-services.json`
  y la credencial FCM v1 en EAS). Es una acción del dueño en la consola de
  Firebase/EAS; no inventes esa configuración en `app.json`.
- `store.config.json` lleva la cuenta demo de App Review y nunca se versiona.
