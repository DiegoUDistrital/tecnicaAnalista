/** Crea un `Request` de prueba. En este Node el constructor conserva `Origin`, `Host`, `Sec-Fetch-Site`, etc. */
export function makeRequest(
  url: string,
  { method = 'GET', headers = {}, body }: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Request {
  return new Request(url, { method, headers, body });
}
