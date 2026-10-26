import type { Counters } from '../server/counters/counters';
import type { TaskFilter } from '../lib/task-filter';
import { TaskManager } from '../client/task-manager';
import { FilterNav } from './filter-nav';

/** Contenido de la página principal: solo recibe datos ya validados (el filtro nunca es texto de la dirección). */
export function HomeView({ filter, counters }: { filter: TaskFilter; counters: Counters }) {
  // Total del filtro según los contadores; null si no están disponibles (misma regla que FilterNav).
  const total = counters.available ? counters[filter] : null;
  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
      <TaskManager
        filter={filter}
        total={total}
        heading={<h1 className="text-3xl font-bold tracking-tight">To-Do App</h1>}
      >
        <FilterNav filter={filter} counters={counters} />
        {counters.available ? null : (
          <p role="status" className="mt-2 text-sm text-red-800">
            No se pudieron cargar los contadores.
          </p>
        )}
      </TaskManager>
    </main>
  );
}
