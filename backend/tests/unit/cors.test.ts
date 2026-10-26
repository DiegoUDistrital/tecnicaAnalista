import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { checkCorsOrigin, createCors } from '../../src/security/cors';

const INVALID = [
  ['ausente', undefined],
  ['vacío', ''],
  ['comodín', '*'],
  ['lista', 'http://localhost:3000,https://app.example.com'],
  ['lista con espacio', 'http://localhost:3000, https://app.example.com'],
  ['con ruta', 'http://localhost:3000/app'],
  ['con barra final', 'http://localhost:3000/'],
  ['con consulta', 'http://localhost:3000?x=1'],
  ['con consulta vacía', 'http://localhost:3000?'],
  ['con fragmento', 'http://localhost:3000#top'],
  ['con fragmento vacío', 'http://localhost:3000#'],
  ['null', 'null'],
  ['otro esquema', 'ftp://localhost:3000'],
  ['sin esquema', 'localhost:3000'],
  ['esquema ws', 'ws://localhost:3000'],
  ['con credenciales', 'http://user:pass@localhost:3000'],
  ['con usuario', 'http://user@localhost:3000'],
  ['host en mayúsculas', 'http://LOCALHOST:3000'],
  ['esquema en mayúsculas', 'HTTP://localhost:3000'],
  ['puerto http por defecto escrito', 'http://localhost:80'],
  ['puerto https por defecto escrito', 'https://app.example.com:443'],
  ['espacio inicial', ' http://localhost:3000'],
  ['espacio final', 'http://localhost:3000 '],
  ['tabulador interior', 'http://local\thost:3000'],
  ['sin host', 'http://'],
  ['host no ASCII', 'http://ejemplo.mañana.com'],
] as const;

describe('RF-G15: checkCorsOrigin', () => {
  it.each(INVALID)('RF-G15: %s es inválido', (_label, raw) => {
    expect(checkCorsOrigin(raw)).toBeDefined();
  });

  it('RF-G15: ausente se nombra «obligatoria» y el resto «origen inválido», sin el valor', () => {
    expect(checkCorsOrigin(undefined)).toBe('CORS_ORIGIN: obligatoria');
    expect(checkCorsOrigin('http://user:secret-pw-9@localhost:3000')).toBe('CORS_ORIGIN: origen inválido');
  });

  it.each(['http://localhost:3000', 'https://app.example.com', 'http://[::1]:3000', 'http://127.0.0.1:8080'])(
    'RF-G15: %s es válido',
    (raw) => {
      expect(checkCorsOrigin(raw)).toBeUndefined();
    },
  );
});

describe('RF-G13: createCors', () => {
  it('RF-G13: res.vary añade Origin al Vary existente sin pisarlo', async () => {
    const app = express();
    app.use((_req, res, next) => {
      res.setHeader('Vary', 'Accept-Encoding');
      next();
    });
    app.use(createCors('http://localhost:3000'));
    app.get('/', (_req, res) => {
      res.send('ok');
    });

    const response = await request(app).get('/').set('Origin', 'http://localhost:3000');

    expect(response.headers['vary']).toBe('Accept-Encoding, Origin');
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });
});
