import type { Request, Response } from 'express';
import { HttpError } from '../http-error';
import { closeConnectionAfterResponse, MAX_BODY_BYTES, readBody } from './body-reader';
import { collectHeader, isIdentityEncoding, isJsonContentType } from './content-headers';

/** Lo que los controladores reciben de la entrada: la consulta CRUDA (sin interpretar) y los bytes del cuerpo. */
export interface RequestInput {
  readonly rawQuery: string;
  readonly body: Buffer;
}

export type InputHandler = (req: Request, res: Response, input: RequestInput) => void | Promise<void>;

function rawQueryOf(req: Request): string {
  const mark = req.originalUrl.indexOf('?');
  return mark === -1 ? '' : req.originalUrl.slice(mark + 1);
}

/** Valor numérico de `Content-Length` (Node ya rechaza los inválidos o duplicados antes de llegar aquí). */
function declaredLength(req: Request): number | undefined {
  const header = req.headers['content-length'];
  return header === undefined ? undefined : Number(header);
}

function checkEncoding(req: Request): void {
  if (!isIdentityEncoding(collectHeader(req.rawHeaders, 'content-encoding'))) {
    throw new HttpError(415);
  }
}

function checkType(req: Request): void {
  if (!isJsonContentType(collectHeader(req.rawHeaders, 'content-type'))) {
    throw new HttpError(415);
  }
}

/**
 * Etapas 2 y 3 de la entrada. Hay cuerpo «presente» solo según las cabeceras (`Content-Length` mayor que 0 o
 * `Transfer-Encoding`), nunca según los bytes. Con `Content-Length` conocido el tamaño y el 415 se deciden sin leer;
 * con fragmentos se lee hasta el final o hasta superar el límite y DESPUÉS se aplican las reglas de 415. Así el 413
 * siempre gana al 415. `Content-Encoding` se comprueba siempre; `Content-Type` solo si hay cuerpo.
 */
async function readRequestInput(req: Request, res: Response): Promise<RequestInput> {
  const rawQuery = rawQueryOf(req);
  const declared = declaredLength(req);
  if (declared !== undefined && declared > MAX_BODY_BYTES) {
    closeConnectionAfterResponse(res);
    throw new HttpError(413);
  }
  const present = (declared !== undefined && declared > 0) || req.headers['transfer-encoding'] !== undefined;
  if (!present) {
    checkEncoding(req);
    return { rawQuery, body: Buffer.alloc(0) };
  }
  if (declared !== undefined) {
    checkEncoding(req);
    checkType(req);
    return { rawQuery, body: await readBody(req, res) };
  }
  const body = await readBody(req, res);
  checkEncoding(req);
  checkType(req);
  return { rawQuery, body };
}

/**
 * Envuelve el manejador de una ruta con la entrada ya comprobada (etapas 2 y 3 de la tubería): le entrega un
 * {@link RequestInput}. Cualquier fallo se lanza como `HttpError` y lo recoge `guard` de la tabla de métodos.
 */
export function withInput(handler: InputHandler): (req: Request, res: Response) => Promise<void> {
  return async (req, res) => {
    const input = await readRequestInput(req, res);
    await handler(req, res, input);
  };
}
