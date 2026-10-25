import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { HttpError } from '../../src/http/http-error';
import { methodTable } from '../../src/http/route-table';

function fakeResponse(): { res: Response; set: ReturnType<typeof vi.fn> } {
  const set = vi.fn();
  return { res: { set } as unknown as Response, set };
}

function fakeRequest(method: string): Request {
  return { method } as Request;
}

describe('RF-S9: methodTable', () => {
  it('RF-S9: methodTable genera Allow con las claves de la tabla en su orden', () => {
    const { res, set } = fakeResponse();
    const next = vi.fn();
    const noop = (): void => undefined;

    methodTable({ GET: noop, POST: noop })(fakeRequest('DELETE'), res, next);

    expect(set).toHaveBeenCalledWith('Allow', 'GET, POST');
    const error = next.mock.calls[0]?.[0] as HttpError;
    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(405);
  });

  it.each(['constructor', 'toString', 'hasOwnProperty', '__proto__'])(
    'RF-S9: un método con nombre de propiedad heredada (%s) da 405',
    (method) => {
      const { res, set } = fakeResponse();
      const next = vi.fn();

      methodTable({ GET: () => undefined })(fakeRequest(method), res, next);

      expect(set).toHaveBeenCalledWith('Allow', 'GET');
      expect((next.mock.calls[0]?.[0] as HttpError).status).toBe(405);
    },
  );

  it('RF-S9: un método de la tabla ejecuta su manejador protegido por guard', async () => {
    const { res, set } = fakeResponse();
    const boom = new Error('boom');
    const next = vi.fn();

    await methodTable({
      GET: () => {
        throw boom;
      },
    })(fakeRequest('GET'), res, next);

    expect(set).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(boom);
  });
});
