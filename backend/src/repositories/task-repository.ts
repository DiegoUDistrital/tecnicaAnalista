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

export interface TaskRepository {
  insert(input: NewTask): Promise<TaskRow>;
  /** Lista de la más reciente a la más antigua; con `completed` solo las completadas o solo las pendientes. */
  list(completed?: boolean): Promise<TaskRow[]>;
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
const LIST_SQL = `SELECT ${COLUMNS} FROM tasks ${ORDER}`;
const LIST_BY_COMPLETED_SQL = `SELECT ${COLUMNS} FROM tasks WHERE completed = $1 ${ORDER}`;

/** Repositorio de tareas: SQL constante y parametrizado; los valores solo viajan en el arreglo de parámetros. */
export function createTaskRepository(database: Pick<Database, 'query'>): TaskRepository {
  return {
    async insert(input: NewTask): Promise<TaskRow> {
      const result = await database.query<TaskRow>(INSERT_SQL, [input.title, input.description]);
      return result.rows[0] as TaskRow;
    },
    async list(completed?: boolean): Promise<TaskRow[]> {
      const result =
        completed === undefined
          ? await database.query<TaskRow>(LIST_SQL)
          : await database.query<TaskRow>(LIST_BY_COMPLETED_SQL, [completed]);
      return result.rows;
    },
  };
}
