import type { Counters } from '../server/counters/counters';
import type { TaskFilter } from '../lib/task-filter';
import { FilterNav } from './filter-nav';

/** Contenido de la página principal: solo recibe datos ya validados (el filtro nunca es texto de la dirección). */
export function HomeView({ filter, counters }: { filter: TaskFilter; counters: Counters }) {
  return (
    <main className="mx-auto max-w-2xl p-4">
      <h1 className="mb-4 text-2xl font-bold">To-Do App</h1>
      <FilterNav filter={filter} counters={counters} />
      {counters.available ? null : (
        <p role="status" className="mt-2 text-sm text-red-700">
          No se pudieron cargar los contadores.
        </p>
      )}
    </main>
  );
}
