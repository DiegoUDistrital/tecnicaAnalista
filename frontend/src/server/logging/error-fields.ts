const CLASS_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,59}$/;
const CODE_PATTERN = /^[A-Z0-9_]{1,40}$/;

/** Ejecuta una lectura y, si lanza (por ejemplo, un getter hostil), devuelve undefined en lugar de propagar. */
function safely<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

/** Lee una propiedad sin fiarse de que sea un dato: un getter que lanza no tumba el registro. */
function readProperty(target: object, key: string): unknown {
  return safely(() => (target as Record<string, unknown>)[key]);
}

/** Nombre de la clase tomado del constructor del prototipo (`name` de la instancia puede llevar datos). */
function constructorName(error: Error): unknown {
  return safely(() => {
    const prototype: unknown = Object.getPrototypeOf(error);
    const constructorFn: unknown =
      typeof prototype === 'object' && prototype !== null ? Reflect.get(prototype, 'constructor') : undefined;
    return typeof constructorFn === 'function' ? constructorFn.name : undefined;
  });
}

function className(error: Error): string {
  const name = constructorName(error);
  return typeof name === 'string' && CLASS_NAME_PATTERN.test(name) ? name : 'Error';
}

function validCode(value: unknown): string | undefined {
  return typeof value === 'string' && CODE_PATTERN.test(value) ? value : undefined;
}

/** Nombre para el registro: la clase de un `Error` (`Error` si el nombre no es válido) o, si no es `Error`, su tipo. */
export function describeError(thrown: unknown): string {
  return thrown instanceof Error ? className(thrown) : typeof thrown;
}

/** Código del error (`code`, o `cause.code` si el primero no es válido). Solo sale si cumple el patrón. */
export function errorCode(thrown: unknown): string | undefined {
  if (!(thrown instanceof Error)) {
    return undefined;
  }
  const cause = readProperty(thrown, 'cause');
  const causeCode = typeof cause === 'object' && cause !== null ? validCode(readProperty(cause, 'code')) : undefined;
  return validCode(readProperty(thrown, 'code')) ?? causeCode;
}
