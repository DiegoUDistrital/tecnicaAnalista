import { trimText } from './task-text';

export interface EditableFields {
  title: string;
  description: string;
}

/**
 * Campos que cambiaron al editar: solo entra el que, recortado, difiere del original (que ya viene recortado del
 * servidor). Así un cambio solo de espacios no genera una petición.
 */
export function changedFields(original: EditableFields, draft: EditableFields): Partial<EditableFields> {
  const changes: Partial<EditableFields> = {};
  const title = trimText(draft.title);
  const description = trimText(draft.description);
  if (title !== original.title) {
    changes.title = title;
  }
  if (description !== original.description) {
    changes.description = description;
  }
  return changes;
}
