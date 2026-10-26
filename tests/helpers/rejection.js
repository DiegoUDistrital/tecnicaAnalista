/**
 * Espera una promesa que debe fallar y devuelve su error.
 * @param {Promise<unknown>} promise
 * @returns {Promise<Error>}
 */
export async function rejectionOf(promise) {
  const outcome = await promise.then(
    () => undefined,
    (/** @type {unknown} */ error) => error,
  );
  if (!(outcome instanceof Error)) throw new Error('La promesa debía fallar con un Error');
  return outcome;
}
