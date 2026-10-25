import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/errors/app-error';
import { ConfigError } from '../../src/errors/config-error';

describe('RF-D18: clase base de errores propios', () => {
  it('RF-D18: AppError fija name con el nombre de la subclase y es instancia de Error', () => {
    class CustomError extends AppError {}
    const base = new AppError('fijo');
    const derived = new CustomError('otro');

    expect(base).toBeInstanceOf(Error);
    expect(base.name).toBe('AppError');
    expect(base.message).toBe('fijo');
    expect(derived).toBeInstanceOf(AppError);
    expect(derived.name).toBe('CustomError');
  });
});

describe('RF-D1: error de configuración', () => {
  it("RF-D1: ConfigError es instancia de AppError y su message es la unión de los mensajes con '; '", () => {
    const error = new ConfigError(['A: obligatoria', 'B: entero inválido o fuera de rango']);

    expect(error).toBeInstanceOf(AppError);
    expect(error.name).toBe('ConfigError');
    expect(error.message).toBe('A: obligatoria; B: entero inválido o fuera de rango');
  });
});
