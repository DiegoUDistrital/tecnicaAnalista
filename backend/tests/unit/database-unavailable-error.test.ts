import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/errors/app-error';
import { DatabaseUnavailableError } from '../../src/errors/database-unavailable-error';

describe('RF-D4: DatabaseUnavailableError', () => {
  it('RF-D4: tiene el mensaje fijo «Base de datos no disponible.»', () => {
    expect(new DatabaseUnavailableError().message).toBe('Base de datos no disponible.');
  });

  it('RF-D4: hereda de AppError y de Error y fija name con su clase', () => {
    const error = new DatabaseUnavailableError();
    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('DatabaseUnavailableError');
  });

  it('RF-D4: no incluye datos ni conserva una causa', () => {
    const error = new DatabaseUnavailableError();
    // Única propiedad propia: `name`, fijada por AppError.
    expect(Object.keys(error)).toEqual(['name']);
    expect('cause' in error).toBe(false);
  });
});
