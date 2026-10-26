import { AppError } from '../errors/app-error';

/** Tabla de estados del contrato de errores: cada estado tiene un `code` y un mensaje fijo en español. */
const STATUS_TABLE = {
  400: { code: 'VALIDATION_ERROR', message: 'Datos inválidos.' },
  401: { code: 'UNAUTHORIZED', message: 'No autorizado.' },
  404: { code: 'NOT_FOUND', message: 'Recurso no encontrado.' },
  405: { code: 'METHOD_NOT_ALLOWED', message: 'Método no permitido.' },
  413: { code: 'PAYLOAD_TOO_LARGE', message: 'El cuerpo de la petición supera el tamaño máximo.' },
  415: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Tipo de contenido no admitido.' },
  500: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor.' },
} as const;

export type HttpErrorStatus = keyof typeof STATUS_TABLE;

/** Entrada de `details` de un 400: el campo y un mensaje fijo (nunca el valor enviado). */
export interface ErrorDetail {
  readonly field: string;
  readonly message: string;
}

export interface ErrorBody {
  readonly error: { readonly code: string; readonly message: string; readonly details: readonly ErrorDetail[] };
}

/**
 * Error conocido: se convierte en su respuesta `{ error: { code, message, details } }`. El mensaje es siempre el
 * literal de la tabla (por eso el logger puede registrarlo). `details` es siempre un arreglo: con entradas solo en el
 * 400 y vacío en los demás estados.
 */
export class HttpError extends AppError {
  readonly status: HttpErrorStatus;
  readonly code: string;
  readonly details: readonly ErrorDetail[];

  constructor(status: HttpErrorStatus, details: readonly ErrorDetail[] = []) {
    if ((status === 400) !== details.length > 0) {
      throw new TypeError('Solo el estado 400 lleva details, y debe llevar al menos una entrada.');
    }
    super(STATUS_TABLE[status].message);
    this.status = status;
    this.code = STATUS_TABLE[status].code;
    this.details = details;
  }

  toBody(): ErrorBody {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }
}
