import { AppError } from './app-error';

/**
 * Configuración inválida. Su `message` es la unión, con `'; '`, de los mensajes fijos de cada variable
 * inválida (solo nombres de variables y textos fijos: nunca valores).
 */
export class ConfigError extends AppError {
  constructor(messages: readonly string[]) {
    super(messages.join('; '));
  }
}
