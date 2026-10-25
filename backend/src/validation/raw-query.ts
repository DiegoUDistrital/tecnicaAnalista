/** Resultado de evaluar la cadena de consulta cruda de `GET /api/tasks`. */
export interface RawQueryEvaluation {
  /** El valor de `completed` cuando aparece una sola vez y es exactamente `true` o `false`; si no, `undefined`. */
  readonly completed: boolean | undefined;
  /** `completed` repetido, usado como arreglo u objeto (`completed[]`), sin valor, vacío o con otro valor. */
  readonly completedInvalid: boolean;
  /** Algún parámetro que no es `completed` (incluidos los nombres vacíos o no decodificables). */
  readonly unknownParameters: boolean;
}

// `completed` seguido de uno o más grupos `[...]` completos (sin corchetes interiores): uso como arreglo u objeto.
const COMPLETED_AS_COLLECTION = /^completed(?:\[[^[\]]*\])+$/;

/** Parámetros de la consulta cruda: cada segmento no vacío separado por `&` (`&&` y `?` solo no aportan ninguno). */
function segments(raw: string): string[] {
  return raw.split('&').filter((segment) => segment !== '');
}

/**
 * Decodificación normal de la consulta: `+` es un espacio y el porcentaje se decodifica UNA vez. `undefined` si falla.
 */
function decode(text: string): string | undefined {
  try {
    return decodeURIComponent(text.replaceAll('+', ' '));
  } catch {
    return undefined;
  }
}

/**
 * Evalúa la consulta CRUDA sin usar el intérprete de Express (que descarta claves como `__proto__` y trunca a 1 000
 * parámetros): se miran TODOS los segmentos. Nunca lanza. Solo se admite `completed`, una vez y con el valor exacto
 * `true` o `false`; cualquier otro nombre es un parámetro desconocido y no se refleja en ninguna parte.
 */
export function evaluateQuery(raw: string): RawQueryEvaluation {
  const values: (string | undefined)[] = [];
  let completedAsCollection = false;
  let unknownParameters = false;
  for (const segment of segments(raw)) {
    const equals = segment.indexOf('=');
    const name = decode(equals === -1 ? segment : segment.slice(0, equals));
    const value = decode(equals === -1 ? '' : segment.slice(equals + 1));
    if (name === 'completed') {
      values.push(value);
    } else if (name !== undefined && COMPLETED_AS_COLLECTION.test(name)) {
      completedAsCollection = true;
    } else {
      unknownParameters = true;
    }
  }
  const [only] = values;
  const valid = values.length === 1 && (only === 'true' || only === 'false');
  return {
    completed: valid ? only === 'true' : undefined,
    completedInvalid: completedAsCollection || (values.length > 0 && !valid),
    unknownParameters,
  };
}

/** `true` si la consulta cruda trae algún parámetro (para `POST`, `PUT` y `DELETE`, que no admiten ninguno). */
export function hasQueryParameters(raw: string): boolean {
  return segments(raw).length > 0;
}
