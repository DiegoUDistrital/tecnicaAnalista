import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/errors/app-error';

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
