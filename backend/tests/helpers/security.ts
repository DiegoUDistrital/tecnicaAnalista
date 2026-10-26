import type { Express, RequestHandler } from 'express';
import type { AppConfig } from '../../src/config/config';
import { parseTrustedProxies, type TrustedProxies } from '../../src/security/trusted-proxies';

// `Express` no declara `handle` en sus tipos (sí existe en tiempo de ejecución, con la forma de un manejador).

/** Key válida de pruebas (43 caracteres, 36 distintos). Es una constante pública: no es un secreto. */
export const TEST_API_KEY = 'Tk3st-Ap1-K3y_0123456789-abcdefghijklmnopqr';

/** Cabecera que pide una petición SIN key: `withTestKey` no inyecta nada y la retira antes de que la vea la app. */
export const OMIT_KEY_HEADER = 'X-Test-Omit-Key';

/** Lista de proxies de confianza a partir del texto de `TRUSTED_PROXIES`; falla si el texto es inválido. */
export function testProxies(raw: string | undefined): TrustedProxies {
  const parsed = parseTrustedProxies(raw);
  if (parsed === undefined) {
    throw new Error(`TRUSTED_PROXIES de prueba inválida: ${JSON.stringify(raw)}`);
  }
  return parsed;
}

/**
 * Cupos de la app de pruebas: tan altos que ningún test que no trate de los límites puede recibir un 429 (los tests
 * de límites piden valores pequeños explícitos).
 */
export const TEST_RATE_LIMIT: AppConfig['security']['rateLimit'] = { windowMs: 900000, max: 10000, postMax: 10000 };

/**
 * Ajustes de seguridad de la app de pruebas: la key válida, `TRUSTED_PROXIES=none` (ninguna cabecera de proxy
 * influye, así que la IP que cuenta es siempre la de la conexión) y cupos altos. `overrides` los modifica (por
 * ejemplo, para probar la app con otra key, otra lista de proxies o cupos pequeños).
 */
export function testSecurity(overrides: Partial<AppConfig['security']> = {}): AppConfig['security'] {
  return { apiKey: TEST_API_KEY, trustedProxies: testProxies('none'), rateLimit: TEST_RATE_LIMIT, ...overrides };
}

/**
 * Hace que toda petición que llegue a `app` lleve `Authorization: Bearer <TEST_API_KEY>`, para que los tests que no
 * tratan de la seguridad no tengan que enviarla. Express llama a `app.handle` en cada petición (también cuando la app
 * se usa con `app.listen`, `http.createServer(app)` o Supertest), así que sobrescribirlo cubre todos los caminos, con
 * independencia de cómo se haga la petición (Supertest, `fetch`, `http.get` o un socket crudo).
 *
 * No inyecta si la petición ya trae `Authorization` (con cualquier mayúscula del nombre) ni si trae el marcador
 * `OMIT_KEY_HEADER`, que además se retira. Se modifican `headers` y `rawHeaders`, que son lo que lee la app.
 */
export function withTestKey<T extends Express>(app: T): T {
  const target = app as Express as Express & { handle: RequestHandler };
  const handle = target.handle.bind(app);
  target.handle = (req, res, next) => {
    const marker = OMIT_KEY_HEADER.toLowerCase();
    let hasAuthorization = false;
    let omit = false;
    const kept: string[] = [];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i] as string;
      const lower = name.toLowerCase();
      if (lower === marker) {
        omit = true;
        continue;
      }
      hasAuthorization ||= lower === 'authorization';
      kept.push(name, req.rawHeaders[i + 1] as string);
    }
    // Node construye `headers` y `headersDistinct` al primer acceso recorriendo tantas posiciones de `rawHeaders` como
    // tenía al llegar: se materializan ANTES de cambiar `rawHeaders` (si no, fallarían o ignorarían el cambio).
    const { headers, headersDistinct } = req;
    if (omit) {
      delete headers[marker];
      delete headersDistinct[marker];
    }
    if (!hasAuthorization && !omit) {
      kept.push('Authorization', `Bearer ${TEST_API_KEY}`);
      headers.authorization = `Bearer ${TEST_API_KEY}`;
      headersDistinct['authorization'] = [`Bearer ${TEST_API_KEY}`];
    }
    req.rawHeaders.splice(0, req.rawHeaders.length, ...kept);
    handle(req, res, next);
  };
  return app;
}
