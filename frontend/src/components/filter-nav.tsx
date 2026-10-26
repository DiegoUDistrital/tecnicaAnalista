import Link from 'next/link';
import type { Counters } from '../server/counters/counters';
import type { TaskFilter } from '../lib/task-filter';
import { PILL, PILL_COUNT } from '../lib/ui-classes';

const LINKS: { filter: TaskFilter; label: string; href: string }[] = [
  { filter: 'all', label: 'Todas', href: '/' },
  { filter: 'completed', label: 'Completadas', href: '/?filter=completed' },
  { filter: 'pending', label: 'Pendientes', href: '/?filter=pending' },
];

const quantity = (counters: Counters, filter: TaskFilter) => (counters.available ? String(counters[filter]) : '—');

/** Tres enlaces (navegar es cambiar la dirección) con su cantidad; el del filtro actual se marca. */
export function FilterNav({ filter, counters }: { filter: TaskFilter; counters: Counters }) {
  return (
    <nav aria-label="Filtros" className="flex flex-wrap gap-2">
      {LINKS.map((item) => (
        <Link
          key={item.filter}
          href={item.href}
          aria-current={item.filter === filter ? 'page' : undefined}
          className={PILL}
        >
          {item.label} <span className={PILL_COUNT}>{quantity(counters, item.filter)}</span>
        </Link>
      ))}
    </nav>
  );
}
