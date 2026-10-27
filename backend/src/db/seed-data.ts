/** Tarea de ejemplo con identificador fijo (UUID v4 escrito a mano, para que repetir el comando no duplique). */
export interface SeedTask {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly completed: boolean;
}

/** Fila lista para insertar: la tarea de ejemplo más su fecha de creación. */
export interface SeedTaskRow extends SeedTask {
  readonly createdAt: Date;
}

const MILLISECONDS_PER_HOUR = 3_600_000;

/** Las 15 tareas de ejemplo. Datos inventados: sin datos personales ni secretos. */
export const SEED_TASKS: readonly SeedTask[] = [
  {
    id: 'ce5b9c43-2fcf-4905-b630-d368752bdc01',
    title: 'Comprar víveres',
    description: 'Lista de la compra:\n- Leche\n- Pan integral\n- Frutas 🍎🍌\n- Café',
    completed: false,
  },
  { id: 'a55aaca4-b133-4398-91b9-c8674614dabc', title: 'Llamar al dentista', description: '', completed: true },
  {
    id: '8fecfbc3-2495-47dd-83ac-99d754270034',
    title: 'Revisar y documentar todas las decisiones técnicas del proyecto antes de la sustentación del jueves.',
    description: 'Repasar el README, los roles de la base de datos y la razón de cada decisión.',
    completed: false,
  },
  {
    id: '60f182de-05d3-484a-982a-2acd81613cdd',
    title: 'Preparar la presentación 🎤',
    description: 'Tres diapositivas:\n1. Problema\n2. Solución\n3. Demostración en vivo',
    completed: false,
  },
  {
    id: 'f162a3c6-aa8d-4d95-94a8-8ca486849bc0',
    title: 'Pagar la factura de internet',
    description: '',
    completed: true,
  },
  {
    id: 'bbd45f79-db1a-400b-a83a-09befe7cf1b7',
    title: 'Estudiar TypeScript',
    description: 'Repasar tipos genéricos, uniones discriminadas y el modo estricto.',
    completed: true,
  },
  { id: '06e1cfb0-8715-4aaa-89c1-232b71a56170', title: 'Regar las plantas 🌱', description: '', completed: false },
  {
    id: '8616fd8b-1369-4a92-805a-ea651cf97f84',
    title: 'Planificar el fin de semana',
    description: 'Opciones:\n- Caminata por el cerro\n- Cine en familia 🎬\n- Descansar y leer',
    completed: false,
  },
  { id: 'e95ab33a-7039-4552-94ab-8acf941170e7', title: 'Enviar el informe mensual', description: '', completed: true },
  {
    id: '6c3edbc5-a5c0-4792-b449-5f8c1c19cc7a',
    title: 'Hacer ejercicio 💪',
    description: 'Rutina de 30 minutos: calentamiento, fuerza y estiramiento.',
    completed: false,
  },
  {
    id: '51491158-c9f6-4454-9927-70a2ac7ce65b',
    title: 'Reservar mesa para la cena',
    description: 'Restaurante cercano, mesa para cuatro personas a las 7:30 p. m.',
    completed: true,
  },
  { id: 'ba26f1fd-9e67-4475-b35c-1316a9e37484', title: 'Actualizar el currículum', description: '', completed: false },
  {
    id: 'd7c547dd-d988-469c-b047-b9f9b70cfb94',
    title: 'Leer "El principito" 📖',
    description: 'Ir por el capítulo 5.\nAnotar las frases que más gusten.',
    completed: false,
  },
  {
    id: '777abb81-aad4-4a64-8230-f867595c4d53',
    title: 'Cambiar la bombilla del pasillo',
    description: '',
    completed: true,
  },
  {
    id: 'c07e7e06-a811-434b-a148-86d5d07f5c75',
    title: 'Organizar el escritorio',
    description: 'Ordenar cables, archivar papeles y limpiar la pantalla. ✨',
    completed: false,
  },
];

/**
 * Filas de ejemplo con su fecha de creación: la tarea n-ésima (desde 1) se creó n horas antes de `now`.
 * `now` es parámetro (no se lee el reloj aquí) para poder probar la función.
 */
export function buildSeedTasks(now: Date): SeedTaskRow[] {
  return SEED_TASKS.map((task, index) => ({
    ...task,
    createdAt: new Date(now.getTime() - (index + 1) * MILLISECONDS_PER_HOUR),
  }));
}
