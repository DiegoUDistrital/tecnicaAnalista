import { describe, expect, it } from 'vitest';
import { buildDetails, type DetailProblems } from '../../src/validation/details';

const INVALID_BODY = 'El cuerpo debe ser un objeto JSON válido.';
const COMPLETED = 'Debe ser true o false.';

describe('RF-C23: mensajes literales de la tabla', () => {
  const rows: [string, DetailProblems, { field: string; message: string }][] = [
    ['body vacío, UTF-8, JSON o raíz', { body: 'invalid' }, { field: 'body', message: INVALID_BODY }],
    [
      'body con claves no permitidas',
      { body: 'unknownFields' },
      { field: 'body', message: 'El cuerpo contiene campos no permitidos.' },
    ],
    ['GET/DELETE con body', { body: 'noBodyAllowed' }, { field: 'body', message: 'Esta ruta no admite cuerpo.' }],
    [
      'desajuste de longitud',
      { body: 'lengthMismatch' },
      { field: 'body', message: 'El cuerpo no coincide con la longitud declarada.' },
    ],
    ['query', { query: true }, { field: 'query', message: 'Parámetros de consulta no permitidos.' }],
    ['title tipo', { title: 'type' }, { field: 'title', message: 'Debe ser una cadena de texto.' }],
    ['title caracteres', { title: 'characters' }, { field: 'title', message: 'Contiene caracteres no permitidos.' }],
    ['title longitud', { title: 'length' }, { field: 'title', message: 'Debe tener entre 1 y 100 caracteres.' }],
    ['description tipo', { description: 'type' }, { field: 'description', message: 'Debe ser una cadena de texto.' }],
    [
      'description caracteres',
      { description: 'characters' },
      { field: 'description', message: 'Contiene caracteres no permitidos.' },
    ],
    [
      'description longitud',
      { description: 'length' },
      { field: 'description', message: 'Debe tener como máximo 500 caracteres.' },
    ],
    ['completed', { completed: true }, { field: 'completed', message: COMPLETED }],
  ];

  it.each(rows)('RF-C23: %s produce su mensaje literal', (_name, problems, expected) => {
    expect(buildDetails(problems)).toEqual([expected]);
  });
});

describe('RF-C23: orden y acumulación', () => {
  it('RF-C23: el orden es body, query, title, description, completed', () => {
    const details = buildDetails({
      completed: true,
      description: 'length',
      title: 'type',
      query: true,
      body: 'unknownFields',
    });
    expect(details.map((detail) => detail.field)).toEqual(['body', 'query', 'title', 'description', 'completed']);
  });

  it('RF-C23: una entrada por campo, con el primer problema', () => {
    const details = buildDetails({ title: 'characters', description: 'type' });
    expect(details).toHaveLength(2);
    expect(details[0]).toEqual({ field: 'title', message: 'Contiene caracteres no permitidos.' });
    expect(details[1]).toEqual({ field: 'description', message: 'Debe ser una cadena de texto.' });
  });

  it('RF-C23: sin problemas devuelve un arreglo vacío', () => {
    expect(buildDetails({})).toEqual([]);
  });

  it('RF-C23: nunca incluye valores enviados ni nombres de campos o parámetros desconocidos', () => {
    const everything = buildDetails({
      body: 'unknownFields',
      query: true,
      title: 'characters',
      description: 'length',
      completed: true,
    });
    const text = JSON.stringify(everything);
    for (const forbidden of ['secret', 'foo', '__proto__', 'filter', 'SELECT', 'at ']) {
      expect(text).not.toContain(forbidden);
    }
    for (const detail of everything) {
      expect(Object.keys(detail).sort()).toEqual(['field', 'message']);
    }
  });

  it('RF-C23: el ejemplo de la spec produce exactamente los cuatro details esperados', () => {
    // POST /api/tasks?x=1 con {"foo":1,"title":"","description":5}
    expect(buildDetails({ body: 'unknownFields', query: true, title: 'length', description: 'type' })).toEqual([
      { field: 'body', message: 'El cuerpo contiene campos no permitidos.' },
      { field: 'query', message: 'Parámetros de consulta no permitidos.' },
      { field: 'title', message: 'Debe tener entre 1 y 100 caracteres.' },
      { field: 'description', message: 'Debe ser una cadena de texto.' },
    ]);
  });
});
