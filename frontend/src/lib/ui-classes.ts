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

/** Botón solo icono de la tarjeta (el texto va en un `sr-only`): redondo, sin borde, con fondo al pasar el ratón. */
const ICON_BASE =
  'inline-flex min-h-11 min-w-11 items-center justify-center rounded-full ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ' +
  'aria-disabled:cursor-not-allowed aria-disabled:opacity-60';

export const BTN_ICON = `${ICON_BASE} text-slate-700 hover:bg-slate-100`;

/** Botón solo icono destructivo (Eliminar): rojo y separado de los demás. */
export const BTN_ICON_DANGER = `${ICON_BASE} ml-2 text-red-700 hover:bg-red-50`;

/** Campo de texto y área de texto. */
export const FIELD =
  'min-h-11 w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600';

/** Filtro en forma de píldora: enlace con borde; la página actual (`aria-current`) se rellena de índigo. */
export const PILL =
  'group inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full border border-slate-300 ' +
  'bg-white px-4 py-1 text-sm font-medium text-slate-800 hover:bg-slate-100 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ' +
  'aria-[current=page]:border-indigo-600 aria-[current=page]:bg-indigo-600 aria-[current=page]:text-white ' +
  'aria-[current=page]:hover:bg-indigo-700';

/** Contador pequeño dentro de la píldora; se invierte cuando el enlace es la página actual. */
export const PILL_COUNT =
  'rounded-full bg-slate-100 px-2 text-xs text-slate-700 ' +
  'group-aria-[current=page]:bg-indigo-800 group-aria-[current=page]:text-white';
