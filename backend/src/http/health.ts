import type { Request, Response } from 'express';

/**
 * `GET /health`: indica que el proceso responde. No consulta la base de datos ni lee el cuerpo, las cabeceras ni la
 * cadena de consulta de la petición.
 */
export function health(_req: Request, res: Response): void {
  res.json({ status: 'ok' });
}
