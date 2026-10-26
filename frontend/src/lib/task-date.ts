/**
 * Fecha de creación para mostrar. El locale es fijo (`es-CO`) para que el servidor y el navegador no discrepen; la
 * zona es la del navegador salvo que se pase otra (las pruebas usan `America/Bogota`).
 */
export function formatCreatedAt(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(iso));
}
