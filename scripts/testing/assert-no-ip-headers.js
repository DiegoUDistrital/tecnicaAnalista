/**
 * @typedef {{
 *   method: string,
 *   url: string,
 *   headers: Record<string, string | string[] | undefined>,
 *   rawHeaders: string[],
 *   remoteAddress: string | undefined,
 * }} RecordedRequest
 */

/** Cabeceras que NUNCA deben llegar a Express: de IP y del navegador. */
export const FORBIDDEN_HEADERS = [
  'x-forwarded-for',
  'forwarded',
  'x-real-ip',
  'x-forwarded-host',
  'x-forwarded-proto',
  'cookie',
  'origin',
  'referer',
];

/** Cabeceras que añade el cliente HTTP de Next o el propio protocolo; se ignoran. */
const IGNORED_HEADERS = [
  'host',
  'connection',
  'content-length',
  'content-type',
  'accept',
  'accept-encoding',
  'accept-language',
  'user-agent',
  'sec-fetch-mode',
  'pragma',
  'cache-control',
  // Su valor se comprueba aparte (es la key de la prueba); aquí solo se acepta su presencia.
  'authorization',
];

/**
 * Nombres de cabecera de una petición registrada, en minúsculas: los de `headers` y los de `rawHeaders` (posiciones
 * pares), porque una cabecera repetida o ignorada por el analizador solo se ve en bruto.
 * @param {RecordedRequest} request
 * @returns {Set<string>}
 */
function headerNames(request) {
  const names = new Set(Object.keys(request.headers).map((name) => name.toLowerCase()));
  request.rawHeaders.forEach((entry, index) => {
    if (index % 2 === 0) names.add(entry.toLowerCase());
  });
  return names;
}

/**
 * Falla si la petición registrada trae alguna cabecera de IP o del navegador, o cualquier cabecera que no esté en la
 * lista de las que añade el cliente HTTP. El error nombra la cabecera y nunca incluye su valor.
 * @param {RecordedRequest} request
 * @returns {void}
 */
export function assertNoIpHeaders(request) {
  const names = headerNames(request);
  for (const name of FORBIDDEN_HEADERS) {
    if (names.has(name))
      throw new Error(`Llegó a Express la cabecera prohibida ${name} (${request.method} ${request.url})`);
  }
  for (const name of names) {
    if (!IGNORED_HEADERS.includes(name)) {
      throw new Error(`Llegó a Express una cabecera inesperada ${name} (${request.method} ${request.url})`);
    }
  }
}
