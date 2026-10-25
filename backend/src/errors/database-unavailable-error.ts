import { AppError } from './app-error';

/**
 * La base de datos no está disponible (conexión rechazada, plazo agotado, credenciales rechazadas, sesión
 * terminada o Pool cerrado). El mensaje es fijo y NO conserva el error original: así nunca revela host, URL ni
 * texto del driver. El diagnóstico queda en el log del Pool y en la capa que traduce este error.
 */
export class DatabaseUnavailableError extends AppError {
  constructor() {
    super('Base de datos no disponible.');
  }
}
