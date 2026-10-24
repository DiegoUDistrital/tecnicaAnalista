/**
 * Clase base de los errores propios del proyecto. «Error propio» significa `instanceof AppError`.
 * Fija `name` con el nombre de la subclase concreta; el mensaje de cada subclase debe ser fijo
 * (nunca incluye datos de usuario ni secretos), porque el logger puede registrarlo.
 */
export class AppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
