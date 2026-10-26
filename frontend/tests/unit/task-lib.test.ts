import { describe, expect, it } from 'vitest';
import { formatCreatedAt } from '../../src/lib/task-date';
import { changedFields } from '../../src/lib/task-edit';
import { readFilter } from '../../src/lib/task-filter';
import { isTask } from '../../src/lib/task';
import { countCodePoints, trimText, validateDescription, validateTitle } from '../../src/lib/task-text';
import { initialUiState, uiReducer, type UiAction, type UiState } from '../../src/lib/task-ui-state';
import { toTask } from '../../src/server/proxy/task-shape';

const VALID = {
  id: '3f2b8c1e-5a4d-4e6f-9a0b-1c2d3e4f5a6b',
  title: 'Comprar pan',
  description: '',
  completed: false,
  createdAt: '2026-01-31T10:00:00.000Z',
};

describe('task-text: validación de texto del cliente', () => {
  // Misma tabla que la validación de Express (RF-C9 del backend): el cliente solo es una comodidad.
  const TRIMMED = [
    0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x00a0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005,
    0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
  ];
  const hex = (code: number): string => `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
  const spaces = TRIMMED.map((code): [string, string] => [hex(code), String.fromCodePoint(code)]);
  const TITLE_LENGTH = 'Debe tener entre 1 y 100 caracteres.';
  const DESCRIPTION_LENGTH = 'Debe tener como máximo 500 caracteres.';
  const FORBIDDEN = 'Contiene caracteres no permitidos.';
  const EMOJI = '\u{1F600}';

  it.each(spaces)(
    'RF-F10: espacio %s: solo espacios da error de longitud y en los extremos se recorta',
    (_n, space) => {
      expect(validateTitle('')).toEqual({ ok: false, message: TITLE_LENGTH });
      expect(validateTitle(space.repeat(3))).toEqual({ ok: false, message: TITLE_LENGTH });
      expect(validateTitle(`${space}abc${space}`)).toEqual({ ok: true, value: 'abc' });
      expect(validateDescription(`${space}abc${space}`)).toEqual({ ok: true, value: 'abc' });
    },
  );

  it('RF-F10: U+0085, U+200B y U+180E en los extremos no se recortan', () => {
    for (const character of ['\u0085', '​', '᠎']) {
      expect(validateTitle(`${character}abc${character}`)).toEqual({ ok: true, value: `${character}abc${character}` });
    }
  });

  it('RF-F10: título 100 válido y 101 no; descripción 500 válida, 501 no y vacía válida (ASCII y emojis)', () => {
    expect(validateTitle('a'.repeat(100)).ok).toBe(true);
    expect(validateTitle('a'.repeat(101))).toEqual({ ok: false, message: TITLE_LENGTH });
    expect(validateTitle(EMOJI.repeat(100)).ok).toBe(true);
    expect(validateTitle(EMOJI.repeat(101))).toEqual({ ok: false, message: TITLE_LENGTH });
    expect(validateDescription('a'.repeat(500)).ok).toBe(true);
    expect(validateDescription(EMOJI.repeat(500)).ok).toBe(true);
    expect(validateDescription('a'.repeat(501))).toEqual({ ok: false, message: DESCRIPTION_LENGTH });
    expect(validateDescription(EMOJI.repeat(501))).toEqual({ ok: false, message: DESCRIPTION_LENGTH });
    expect(validateDescription('')).toEqual({ ok: true, value: '' });
  });

  it.each([
    ['NUL', 'a\u0000b'],
    ['sustituto alto suelto', 'a\ud800b'],
    ['sustituto bajo suelto', 'a\udc00b'],
  ])('RF-F10: %s da el mensaje de caracteres no permitidos antes que la longitud', (_name, text) => {
    expect(validateTitle(text)).toEqual({ ok: false, message: FORBIDDEN });
    expect(validateDescription(text)).toEqual({ ok: false, message: FORBIDDEN });
    expect(validateTitle(`${text}${'a'.repeat(200)}`)).toEqual({ ok: false, message: FORBIDDEN });
    expect(validateDescription(`${text}${'a'.repeat(600)}`)).toEqual({ ok: false, message: FORBIDDEN });
  });

  it('RF-F10: devuelve el valor recortado, acepta emoji y cuenta puntos de código (ZWJ cuenta varios)', () => {
    const family = '\u{1F468}‍\u{1F469}‍\u{1F467}';
    expect(validateTitle(EMOJI)).toEqual({ ok: true, value: EMOJI });
    expect(validateDescription('\n línea1\nlínea2 \n')).toEqual({ ok: true, value: 'línea1\nlínea2' });
    expect(trimText('  ab  ')).toBe('ab');
    expect(countCodePoints(trimText('   ab   '))).toBe(2);
    expect(countCodePoints(EMOJI)).toBe(1);
    expect(countCodePoints(family)).toBe(5);
    expect(countCodePoints('')).toBe(0);
  });
});

describe('task-ui-state: uiReducer', () => {
  const run = (state: UiState, ...actions: UiAction[]) => actions.reduce(uiReducer, state);
  const open = (id: string) => run(initialUiState, { type: 'editOpen', id, title: 'T', description: 'D' });

  it('RF-F6: listArrived descarta errores y edición de tareas que ya no están y conserva los demás', () => {
    const state = run(
      initialUiState,
      { type: 'taskErrorSet', id: 'a', message: 'Falló A.' },
      { type: 'taskErrorSet', id: 'b', message: 'Falló B.' },
      { type: 'editOpen', id: 'a', title: 'T', description: 'D' },
      { type: 'noticeSet', notice: 'Aviso.' },
    );
    expect(uiReducer(state, { type: 'listArrived', ids: ['a', 'b'] })).toEqual(state);
    const pruned = uiReducer(state, { type: 'listArrived', ids: ['b'] });
    expect(pruned.taskErrors).toEqual({ b: 'Falló B.' });
    expect(pruned.editing).toBeUndefined();
    expect(pruned.notice).toBe('Aviso.');
    expect(uiReducer(state, { type: 'listArrived', ids: [] }).taskErrors).toEqual({});
    expect(uiReducer(open('b'), { type: 'listArrived', ids: ['a', 'b'] }).editing?.id).toBe('b');
  });

  it('RF-F25: taskGone limpia error, ocupado y edición de ese id y no toca la edición de otra tarea', () => {
    const state = run(
      initialUiState,
      { type: 'taskErrorSet', id: 'a', message: 'Falló A.' },
      { type: 'taskErrorSet', id: 'b', message: 'Falló B.' },
      { type: 'busyAdd', id: 'a' },
      { type: 'busyAdd', id: 'b' },
      { type: 'editOpen', id: 'a', title: 'T', description: 'D' },
    );
    const gone = uiReducer(state, { type: 'taskGone', id: 'a' });
    expect(gone.taskErrors).toEqual({ b: 'Falló B.' });
    expect(gone.busy).toEqual(['b']);
    expect(gone.editing).toBeUndefined();
    expect(uiReducer(open('b'), { type: 'taskGone', id: 'a' }).editing?.id).toBe('b');
  });

  it('RF-F12: editOpen sustituye la edición anterior', () => {
    const state = run(
      initialUiState,
      { type: 'editOpen', id: 'a', title: 'Uno', description: 'D1' },
      { type: 'editOpen', id: 'b', title: 'Dos', description: 'D2' },
    );
    expect(state.editing).toEqual({ id: 'b', title: 'Dos', description: 'D2', errors: {} });
  });

  it('RF-F12: editChange cambia solo el campo indicado de la edición de ese id', () => {
    const opened = open('a');
    const changed = uiReducer(opened, { type: 'editChange', id: 'a', field: 'title', value: 'Nuevo' });
    expect(changed.editing).toEqual({ id: 'a', title: 'Nuevo', description: 'D', errors: {} });
    expect(uiReducer(changed, { type: 'editChange', id: 'a', field: 'description', value: 'X' }).editing).toEqual({
      id: 'a',
      title: 'Nuevo',
      description: 'X',
      errors: {},
    });
    expect(uiReducer(opened, { type: 'editChange', id: 'b', field: 'title', value: 'Nuevo' })).toBe(opened);
    expect(uiReducer(initialUiState, { type: 'editChange', id: 'a', field: 'title', value: 'N' })).toBe(initialUiState);
  });

  it('RF-F10: editErrors guarda los errores de la edición de ese id y editOpen los limpia', () => {
    const opened = open('a');
    const failed = uiReducer(opened, { type: 'editErrors', id: 'a', errors: { title: 'Mal.', general: 'Algo.' } });
    expect(failed.editing?.errors).toEqual({ title: 'Mal.', general: 'Algo.' });
    expect(uiReducer(opened, { type: 'editErrors', id: 'b', errors: { title: 'Mal.' } })).toBe(opened);
    expect(uiReducer(initialUiState, { type: 'editErrors', id: 'a', errors: {} })).toBe(initialUiState);
    expect(uiReducer(failed, { type: 'editOpen', id: 'a', title: 'T', description: 'D' }).editing?.errors).toEqual({});
  });

  it('RF-F12: editClose cierra la edición solo si es la de ese id', () => {
    const opened = open('a');
    expect(uiReducer(opened, { type: 'editClose', id: 'a' }).editing).toBeUndefined();
    expect(uiReducer(opened, { type: 'editClose', id: 'b' })).toBe(opened);
  });

  it('RF-F14: busyAdd y busyRemove marcan y desmarcan la tarea sin repetirla', () => {
    const state = run(initialUiState, { type: 'busyAdd', id: 'a' }, { type: 'busyAdd', id: 'a' });
    expect(state.busy).toEqual(['a']);
    expect(uiReducer(state, { type: 'busyRemove', id: 'a' }).busy).toEqual([]);
  });

  it('RF-F25 y RF-F27: error por tarea y aviso global se guardan y se quitan', () => {
    const state = uiReducer(initialUiState, { type: 'taskErrorSet', id: 'a', message: 'Falló.' });
    expect(state.taskErrors).toEqual({ a: 'Falló.' });
    expect(uiReducer(state, { type: 'taskErrorCleared', id: 'a' }).taskErrors).toEqual({});
    expect(uiReducer(initialUiState, { type: 'taskErrorCleared', id: 'a' })).toBe(initialUiState);
    const noticed = uiReducer(initialUiState, { type: 'noticeSet', notice: 'Tarea creada.' });
    expect(noticed.notice).toBe('Tarea creada.');
    expect(uiReducer(noticed, { type: 'noticeCleared' }).notice).toBeUndefined();
  });
});

describe('task-filter: readFilter', () => {
  it('RF-F1: devuelve completed y pending para esos valores exactos', () => {
    expect(readFilter({ filter: 'completed' })).toBe('completed');
    expect(readFilter({ filter: 'pending' })).toBe('pending');
  });

  it.each([
    ['undefined', { filter: undefined }],
    ['all', { filter: 'all' }],
    ['COMPLETED', { filter: 'COMPLETED' }],
    ['con espacio', { filter: 'completed ' }],
    ['vacío', { filter: '' }],
    ['<script>', { filter: '<script>' }],
    ['arreglo de dos', { filter: ['completed', 'pending'] }],
    ['arreglo de uno', { filter: ['completed'] }],
    ['parámetro adicional (P6)', { filter: 'completed', x: '1' }],
    ['solo otro parámetro', { x: '1' }],
    ['sin parámetros', {}],
  ])('RF-F1: %s da all sin lanzar', (_name, params) => {
    expect(readFilter(params)).toBe('all');
  });
});

describe('task-shape: toTask', () => {
  it('RF-F20: una tarea de cinco claves válidas pasa y la salida conserva las claves en orden fijo', () => {
    expect(toTask(VALID)).toEqual(VALID);
    expect(toTask({ ...VALID, createdAt: '2026-01-31T10:00:00+02:00', title: 'a'.repeat(100) })).toBeDefined();
    expect(toTask({ ...VALID, description: 'é'.repeat(500), id: VALID.id.toUpperCase() })).toBeDefined();
    expect(toTask({ ...VALID, title: '😀'.repeat(100) })).toBeDefined();
    expect(toTask({ ...VALID, createdAt: '2024-02-29T23:59:59Z' })).toBeDefined();
    const shuffled = {
      createdAt: VALID.createdAt,
      completed: VALID.completed,
      description: VALID.description,
      title: VALID.title,
      id: VALID.id,
    };
    expect(Object.keys(toTask(shuffled) ?? {})).toEqual(['id', 'title', 'description', 'completed', 'createdAt']);
  });

  it.each([
    ['seis claves', { ...VALID, extra: 1 }],
    ['cinco claves con otro nombre', { ...VALID, createdAt: undefined, created: VALID.createdAt }],
    ['id no UUID', { ...VALID, id: '3f2b8c1e-5a4d-4e6f-9a0b' }],
    ['id con sufijo', { ...VALID, id: `${VALID.id}x` }],
    ['id no cadena', { ...VALID, id: 7 }],
    ['title vacío', { ...VALID, title: '' }],
    ['title de 101', { ...VALID, title: 'a'.repeat(101) }],
    ['title no cadena', { ...VALID, title: 5 }],
    ['description de 501', { ...VALID, description: 'a'.repeat(501) }],
    ['description no cadena', { ...VALID, description: null }],
    ['completed no booleano', { ...VALID, completed: 'false' }],
    ['createdAt sin zona', { ...VALID, createdAt: '2026-01-31T10:00:00' }],
    ['createdAt no ISO 8601', { ...VALID, createdAt: '31/01/2026' }],
    ['createdAt con fecha imposible', { ...VALID, createdAt: '2026-02-31T00:00:00Z' }],
    ['createdAt 29 de febrero sin bisiesto', { ...VALID, createdAt: '2026-02-29T00:00:00Z' }],
    ['createdAt con hora 24', { ...VALID, createdAt: '2026-01-31T24:00:00Z' }],
    ['createdAt con minutos 60', { ...VALID, createdAt: '2026-01-31T10:60:00Z' }],
    ['createdAt con desfase imposible', { ...VALID, createdAt: '2026-01-31T10:00:00+25:00' }],
    ['createdAt no cadena', { ...VALID, createdAt: 1769853600000 }],
    ['arreglo', [VALID]],
    ['null', null],
    ['cadena', 'tarea'],
  ])('RF-F20: %s falla', (_name, value) => {
    expect(toTask(value)).toBeUndefined();
  });
});

describe('task-date: formatCreatedAt', () => {
  it('RF-F7: formatea con es-CO, dateStyle medium y timeStyle short en America/Bogota', () => {
    const iso = '2026-01-31T15:05:00.000Z';
    const expected = new Intl.DateTimeFormat('es-CO', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'America/Bogota',
    }).format(new Date(iso));
    expect(formatCreatedAt(iso, 'America/Bogota')).toBe(expected);
    // Node puede usar U+202F antes de «a. m.»: se normaliza cualquier espacio para comparar con el valor fijo.
    expect(formatCreatedAt(iso, 'America/Bogota').replace(/\s/g, ' ')).toBe('31/01/2026, 10:05 a. m.');
  });
});

describe('task-edit: changedFields', () => {
  const original = { title: 'Comprar pan', description: 'Integral' };

  it('RF-F12: solo se incluye el campo cuyo valor recortado difiere del original', () => {
    expect(changedFields(original, { title: ' Comprar leche ', description: 'Integral' })).toEqual({
      title: 'Comprar leche',
    });
    expect(changedFields(original, { title: 'Comprar pan', description: '' })).toEqual({ description: '' });
    expect(changedFields(original, { title: 'a', description: 'b' })).toEqual({ title: 'a', description: 'b' });
  });

  it('RF-F12: sin cambios o con cambios solo de espacios devuelve un objeto vacío', () => {
    expect(changedFields(original, { ...original })).toEqual({});
    expect(changedFields(original, { title: '  Comprar pan  ', description: '\nIntegral　' })).toEqual({});
  });
});

describe('task: isTask', () => {
  it('RF-F6: una tarea con los cinco campos y su tipo pasa; los casos inválidos no', () => {
    expect(isTask(VALID)).toBe(true);
    expect(isTask({ ...VALID, completed: true })).toBe(true);
    for (const value of [
      null,
      'tarea',
      [VALID],
      { ...VALID, createdAt: undefined },
      { ...VALID, completed: 'false' },
    ]) {
      expect(isTask(value)).toBe(false);
    }
  });
});
