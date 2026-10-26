import type { Express, RequestHandler } from 'express';

// `Express` no declara `handle` en sus tipos (sí existe en tiempo de ejecución, con la forma de un manejador).

/** Key válida de pruebas (43 caracteres, 36 distintos). Es una constante pública: no es un secreto. */
export const TEST_API_KEY = 'Tk3st-Ap1-K3y_0123456789-abcdefghijklmnopqr';

/** Cabecera que pide una petición SIN key: `withTestKey` no inyecta nada y la retira antes de que la vea la app. */
export const OMIT_KEY_HEADER = 'X-Test-Omit-Key';

/**
 * Ajustes de seguridad de la app de pruebas: por ahora solo la key válida. `overrides` los modifica (por ejemplo,
 * para probar la app con otra key).
 */
export function testSecurity(overrides: { apiKey?: string } = {}): { apiKey: string } {
  return { apiKey: TEST_API_KEY, ...overrides };
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
export function withTestKey(app: Express): Express {
  const target = app as Express & { handle: RequestHandler };
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
