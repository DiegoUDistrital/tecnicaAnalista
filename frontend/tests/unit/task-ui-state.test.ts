import { describe, expect, it } from 'vitest';
import { initialUiState, uiReducer, type UiAction, type UiState } from '../../src/lib/task-ui-state';

const run = (state: UiState, ...actions: UiAction[]) => actions.reduce(uiReducer, state);

describe('uiReducer: estado por tarea', () => {
  it('RF-F6: listArrived descarta errores y edición de tareas que ya no están y conserva los demás', () => {
    const state = run(
      initialUiState,
      { type: 'taskErrorSet', id: 'a', message: 'Falló A.' },
      { type: 'taskErrorSet', id: 'b', message: 'Falló B.' },
      { type: 'editOpen', id: 'a', title: 'T', description: 'D' },
      { type: 'noticeSet', notice: 'Aviso.' },
    );
    const kept = uiReducer(state, { type: 'listArrived', ids: ['a', 'b'] });
    expect(kept).toEqual(state);
    const pruned = uiReducer(state, { type: 'listArrived', ids: ['b'] });
    expect(pruned.taskErrors).toEqual({ b: 'Falló B.' });
    expect(pruned.editing).toBeUndefined();
    expect(pruned.notice).toBe('Aviso.');
    const emptied = uiReducer(state, { type: 'listArrived', ids: [] });
    expect(emptied.taskErrors).toEqual({});
  });

  it('RF-F6: listArrived conserva la edición de una tarea que sigue en la lista', () => {
    const state = run(initialUiState, { type: 'editOpen', id: 'b', title: 'T', description: 'D' });
    expect(uiReducer(state, { type: 'listArrived', ids: ['a', 'b'] }).editing?.id).toBe('b');
  });

  it('RF-F25: taskGone limpia error, ocupado y edición de ese id', () => {
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
  });

  it('RF-F25: taskGone no toca la edición de otra tarea', () => {
    const state = run(initialUiState, { type: 'editOpen', id: 'b', title: 'T', description: 'D' });
    expect(uiReducer(state, { type: 'taskGone', id: 'a' }).editing?.id).toBe('b');
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
    const open = run(initialUiState, { type: 'editOpen', id: 'a', title: 'T', description: 'D' });
    const changed = uiReducer(open, { type: 'editChange', id: 'a', field: 'title', value: 'Nuevo' });
    expect(changed.editing).toEqual({ id: 'a', title: 'Nuevo', description: 'D', errors: {} });
    expect(uiReducer(changed, { type: 'editChange', id: 'a', field: 'description', value: 'X' }).editing).toEqual({
      id: 'a',
      title: 'Nuevo',
      description: 'X',
      errors: {},
    });
    expect(uiReducer(open, { type: 'editChange', id: 'b', field: 'title', value: 'Nuevo' })).toBe(open);
    expect(uiReducer(initialUiState, { type: 'editChange', id: 'a', field: 'title', value: 'N' })).toBe(initialUiState);
  });

  it('RF-F10: editErrors guarda los errores de la edición de ese id y editOpen los limpia', () => {
    const open = run(initialUiState, { type: 'editOpen', id: 'a', title: 'T', description: 'D' });
    const failed = uiReducer(open, { type: 'editErrors', id: 'a', errors: { title: 'Mal.', general: 'Algo.' } });
    expect(failed.editing?.errors).toEqual({ title: 'Mal.', general: 'Algo.' });
    expect(uiReducer(open, { type: 'editErrors', id: 'b', errors: { title: 'Mal.' } })).toBe(open);
    expect(uiReducer(initialUiState, { type: 'editErrors', id: 'a', errors: {} })).toBe(initialUiState);
    expect(uiReducer(failed, { type: 'editOpen', id: 'a', title: 'T', description: 'D' }).editing?.errors).toEqual({});
  });

  it('RF-F12: editClose cierra la edición solo si es la de ese id', () => {
    const open = run(initialUiState, { type: 'editOpen', id: 'a', title: 'T', description: 'D' });
    expect(uiReducer(open, { type: 'editClose', id: 'a' }).editing).toBeUndefined();
    expect(uiReducer(open, { type: 'editClose', id: 'b' })).toBe(open);
  });

  it('RF-F14: busyAdd y busyRemove marcan y desmarcan la tarea sin repetirla', () => {
    const state = run(initialUiState, { type: 'busyAdd', id: 'a' }, { type: 'busyAdd', id: 'a' });
    expect(state.busy).toEqual(['a']);
    expect(uiReducer(state, { type: 'busyRemove', id: 'a' }).busy).toEqual([]);
  });

  it('RF-F25: taskErrorSet y taskErrorCleared guardan y quitan el error de una tarea', () => {
    const state = uiReducer(initialUiState, { type: 'taskErrorSet', id: 'a', message: 'Falló.' });
    expect(state.taskErrors).toEqual({ a: 'Falló.' });
    expect(uiReducer(state, { type: 'taskErrorCleared', id: 'a' }).taskErrors).toEqual({});
    expect(uiReducer(initialUiState, { type: 'taskErrorCleared', id: 'a' })).toBe(initialUiState);
  });

  it('RF-F27: noticeSet y noticeCleared guardan y quitan el aviso global', () => {
    const state = uiReducer(initialUiState, { type: 'noticeSet', notice: 'Tarea creada.' });
    expect(state.notice).toBe('Tarea creada.');
    expect(uiReducer(state, { type: 'noticeCleared' }).notice).toBeUndefined();
  });
});
