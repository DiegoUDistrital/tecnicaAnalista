import { DatabaseError } from 'pg';
import { AppError } from '../errors/app-error';

/** Máximo de líneas de traza que se registran. */
export const MAX_STACK_LINES = 30;

// Ruta de un marco: <anonymous>, node:..., archivo file:/// o ruta absoluta (Windows o POSIX).
const PATH = String.raw`(?:<anonymous>|node:[^\s():]+|file:///[^()\r\n]+?|[A-Za-z]:[\\/][^()\r\n]*?|/[^()\r\n]*?)`;
const POSITION = String.raw`${PATH}:[0-9]+:[0-9]+`;
// El texto de función NO admite «-» ni «:», para que un UUID no pase como nombre de función.
const FUNCTION_TEXT = String.raw`[A-Za-z0-9_$.<>\[\] ]+`;

/**
 * Forma de un marco de pila: `at <texto> (<ruta>:<línea>:<columna>)` o `at [async ]<ruta>:<línea>:<columna>`.
 * Exige ruta absoluta, línea y columna: `at secreto` o `at secreto:1:1` no son marcos.
 */
export const FRAME_PATTERN = new RegExp(`^at (?:${FUNCTION_TEXT} \\(${POSITION}\\)|(?:async )?${POSITION})$`);

const SQLSTATE_PATTERN = /^(?=.*[0-9])[0-9A-Z]{5}$/;
const SYSTEM_CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const CLASS_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;

type ErrorFields = Readonly<Record<string, string>>;

function readCode(error: Error): unknown {
  return 'code' in error ? error.code : undefined;
}

/** SQLSTATE: `code` de 5 caracteres [0-9A-Z] con algún dígito, en un error de base de datos de `pg`. */
function readSqlstate(error: Error): string | undefined {
  const code = readCode(error);
  return error instanceof DatabaseError && typeof code === 'string' && SQLSTATE_PATTERN.test(code) ? code : undefined;
}

/** Nombre de la clase tomado del prototipo (`error.name` es mutable y podría llevar datos). */
function readClassName(error: Error): string {
  const prototype: unknown = Object.getPrototypeOf(error);
  const constructorFn: unknown =
    typeof prototype === 'object' && prototype !== null ? Reflect.get(prototype, 'constructor') : undefined;
  const name: unknown = typeof constructorFn === 'function' ? constructorFn.name : undefined;
  return typeof name === 'string' && CLASS_NAME_PATTERN.test(name) ? name : 'Error';
}

/** Traza sin el texto del message: se retira de la pila ANTES de filtrar y solo quedan líneas con forma de marco. */
function buildStack(error: Error): string {
  let stack = typeof error.stack === 'string' ? error.stack : '';
  if (typeof error.message === 'string' && error.message !== '') {
    stack = stack.split(error.message).join('');
  }
  return stack
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => FRAME_PATTERN.test(line))
    .slice(0, MAX_STACK_LINES)
    .join('\n');
}

/**
 * Campos de salida de lo lanzado, con lista cerrada: `errorClass`, `sqlstate`, `errorCode`, `message` y `stack`.
 * Si no es un `Error`, solo `thrownType`. Nunca `detail`, `hint`, `where`, `cause` ni parámetros.
 */
export function describeThrown(thrown: unknown): ErrorFields {
  if (!(thrown instanceof Error)) {
    return { thrownType: typeof thrown };
  }
  const sqlstate = readSqlstate(thrown);
  const code = readCode(thrown);
  const fields: Record<string, string> = { errorClass: readClassName(thrown) };
  if (sqlstate !== undefined) {
    fields['sqlstate'] = sqlstate;
  } else if (typeof code === 'string' && SYSTEM_CODE_PATTERN.test(code)) {
    fields['errorCode'] = code;
  }
  const messageAllowed = thrown instanceof AppError || (sqlstate !== undefined && !sqlstate.startsWith('22'));
  if (messageAllowed && typeof thrown.message === 'string') {
    fields['message'] = thrown.message;
  }
  const stack = buildStack(thrown);
  if (stack !== '') {
    fields['stack'] = stack;
  }
  return fields;
}
