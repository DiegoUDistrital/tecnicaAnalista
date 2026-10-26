export interface Editing {
  id: string;
  title: string;
  description: string;
  errors: { title?: string; description?: string; general?: string };
}

export interface UiState {
  notice: string | undefined;
  taskErrors: Record<string, string>;
  busy: readonly string[];
  editing: Editing | undefined;
}

export type UiAction =
  | { type: 'noticeSet'; notice: string }
  | { type: 'noticeCleared' }
  | { type: 'taskErrorSet'; id: string; message: string }
  | { type: 'taskErrorCleared'; id: string }
  | { type: 'busyAdd'; id: string }
  | { type: 'busyRemove'; id: string }
  | { type: 'editOpen'; id: string; title: string; description: string }
  | { type: 'taskGone'; id: string }
  | { type: 'listArrived'; ids: readonly string[] };

export const initialUiState: UiState = { notice: undefined, taskErrors: {}, busy: [], editing: undefined };

function withoutKey(errors: Record<string, string>, id: string): Record<string, string> {
  return Object.fromEntries(Object.entries(errors).filter(([key]) => key !== id));
}

/**
 * Estado por tarea (avisos, errores, ocupadas y la edición abierta) en un solo lugar: un 404 toca varias cosas a la
 * vez y así no se descuadran. Puro, sin DOM ni React: se prueba en entorno node.
 */
export function uiReducer(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case 'noticeSet':
      return { ...state, notice: action.notice };
    case 'noticeCleared':
      return { ...state, notice: undefined };
    case 'taskErrorSet':
      return { ...state, taskErrors: { ...state.taskErrors, [action.id]: action.message } };
    case 'taskErrorCleared':
      return action.id in state.taskErrors ? { ...state, taskErrors: withoutKey(state.taskErrors, action.id) } : state;
    case 'busyAdd':
      return state.busy.includes(action.id) ? state : { ...state, busy: [...state.busy, action.id] };
    case 'busyRemove':
      return { ...state, busy: state.busy.filter((id) => id !== action.id) };
    case 'editOpen':
      return { ...state, editing: { id: action.id, title: action.title, description: action.description, errors: {} } };
    case 'taskGone':
      return {
        ...state,
        taskErrors: withoutKey(state.taskErrors, action.id),
        busy: state.busy.filter((id) => id !== action.id),
        editing: state.editing?.id === action.id ? undefined : state.editing,
      };
    case 'listArrived': {
      const present = new Set(action.ids);
      return {
        ...state,
        taskErrors: Object.fromEntries(Object.entries(state.taskErrors).filter(([id]) => present.has(id))),
        editing: state.editing !== undefined && present.has(state.editing.id) ? state.editing : undefined,
      };
    }
  }
}
