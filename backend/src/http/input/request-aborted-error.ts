import { AppError } from '../../errors/app-error';

/**
 * El cliente se fue (cerró o abortó la conexión) antes de terminar de enviar el cuerpo. No hay a quién responder:
 * `withInput` la recoge y termina la petición sin respuesta y sin registrarla como error del servidor.
 */
export class RequestAbortedError extends AppError {
  constructor() {
    super('La petición se interrumpió antes de recibir el cuerpo completo.');
  }
}
