/**
 * Clases de Tailwind compartidas por los controles. Son solo texto: Tailwind las detecta al leer `src/`.
 * Se usan constantes y no `@apply` para que las clases sigan visibles en cada componente y en los tests.
 */

/** Base de todo botón: tamaño táctil mínimo, foco visible con Tab y aspecto atenuado con `aria-disabled`. */
export const BTN_BASE =
  'inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ' +
  'aria-disabled:cursor-not-allowed aria-disabled:opacity-60';

/** Acción principal (Crear, Guardar). */
export const BTN_PRIMARY = `${BTN_BASE} border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700`;

/** Acción secundaria (Editar, Cancelar, Reintentar, Marcar). */
export const BTN_SECONDARY = `${BTN_BASE} border-slate-300 bg-white text-slate-800 hover:bg-slate-100`;

/** Acción destructiva (Eliminar): discreta, en rojo. */
export const BTN_DANGER = `${BTN_BASE} border-red-300 bg-white text-red-700 hover:bg-red-50`;

/** Campo de texto y área de texto. */
export const FIELD =
  'min-h-11 w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600';
