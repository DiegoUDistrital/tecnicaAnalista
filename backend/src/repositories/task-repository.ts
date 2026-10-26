import type { Database } from '../db/pool';

/** Fila de la tabla `tasks` tal como la entrega el repositorio: exactamente cinco campos. */
export interface TaskRow {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  /** ISO 8601 UTC con milisegundos (`YYYY-MM-DDTHH:MM:SS.mmmZ`), truncados por la base de datos. */
  createdAt: string;
}

export interface NewTask {
  title: string;
  description: string;
}

/** Campos que una actualización puede cambiar; solo se escriben los presentes. */
export interface TaskChanges {
  title?: string;
  description?: string;
  completed?: boolean;
}

export interface TaskRepository {
  insert(input: NewTask): Promise<TaskRow>;
  /** Actualiza solo los campos presentes. Devuelve la fila resultante o `undefined` si el id no existe. */
  update(id: string, changes: TaskChanges): Promise<TaskRow | undefined>;
  /** Borra la tarea. Devuelve `true` si había una fila y `false` si no existía. */
  remove(id: string): Promise<boolean>;
  /**
   * Las `limit` tareas más recientes, de la más reciente a la más antigua; con `completed` solo las completadas o
   * solo las pendientes (el tope se aplica después del filtro). El tope es obligatorio: no hay valor por defecto.
   */
  list(completed: boolean | undefined, limit: number): Promise<TaskRow[]>;
}

// `date_trunc` trunca (no redondea) y `AT TIME ZONE 'UTC'` hace el texto independiente de la zona de la sesión.
// El alias "createdAt" coincide con la columna real, por eso el ORDER BY debe calificarla con `tasks.`.
const COLUMNS = `id, title, description, completed,
  to_char(
    date_trunc('milliseconds', tasks."createdAt") AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ) AS "createdAt"`;

const ORDER = `ORDER BY tasks."createdAt" DESC, tasks.id ASC`;

const INSERT_SQL = `INSERT INTO tasks (title, description) VALUES ($1, $2) RETURNING ${COLUMNS}`;
// El tope siempre es el ÚLTIMO parámetro: `$1` sin filtro y `$2` con filtro.
const LIST_SQL = `SELECT ${COLUMNS} FROM tasks ${ORDER} LIMIT $1`;
const LIST_BY_COMPLETED_SQL = `SELECT ${COLUMNS} FROM tasks WHERE completed = $1 ${ORDER} LIMIT $2`;

const DELETE_SQL = 'DELETE FROM tasks WHERE id = $1';

// Lista cerrada y ordenada de columnas que un UPDATE puede escribir: el texto SQL solo se arma con estas constantes.
const UPDATABLE_COLUMNS = ['title', 'description', 'completed'] as const;

/**
 * Arma `UPDATE ... SET` solo con las columnas presentes (sin reescribir las demás) y el id como último parámetro.
 * Los nombres de columna salen de `UPDATABLE_COLUMNS`, nunca de las claves del objeto recibido.
 */
function buildUpdate(id: string, changes: TaskChanges): { sql: string; values: unknown[] } {
  const assignments: string[] = [];
  const values: unknown[] = [];
  for (const column of UPDATABLE_COLUMNS) {
    if (Object.hasOwn(changes, column)) {
      values.push(changes[column]);
      assignments.push(`${column} = $${String(values.length)}`);
    }
  }
  if (assignments.length === 0) {
    throw new TypeError('update requiere al menos un campo.');
  }
  values.push(id);
  const sql = `UPDATE tasks SET ${assignments.join(', ')} WHERE id = $${String(values.length)} RETURNING ${COLUMNS}`;
  return { sql, values };
}

/** Repositorio de tareas: SQL constante y parametrizado; los valores solo viajan en el arreglo de parámetros. */
export function createTaskRepository(database: Pick<Database, 'query'>): TaskRepository {
  return {
    async insert(input: NewTask): Promise<TaskRow> {
      const result = await database.query<TaskRow>(INSERT_SQL, [input.title, input.description]);
      return result.rows[0] as TaskRow;
    },
    async update(id: string, changes: TaskChanges): Promise<TaskRow | undefined> {
      const { sql, values } = buildUpdate(id, changes);
      const result = await database.query<TaskRow>(sql, values);
      return result.rows[0];
    },
    async remove(id: string): Promise<boolean> {
      const result = await database.query(DELETE_SQL, [id]);
      // `rowCount` puede ser null en pg: solo `1` cuenta como «había una fila».
      return result.rowCount === 1;
    },
    async list(completed: boolean | undefined, limit: number): Promise<TaskRow[]> {
      const result =
        completed === undefined
          ? await database.query<TaskRow>(LIST_SQL, [limit])
          : await database.query<TaskRow>(LIST_BY_COMPLETED_SQL, [completed, limit]);
      return result.rows;
    },
  };
}
