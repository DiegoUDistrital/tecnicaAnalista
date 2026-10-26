import Link from 'next/link';
import type { Counters } from '../server/counters/counters';
import type { TaskFilter } from '../lib/task-filter';

const LINKS: { filter: TaskFilter; label: string; href: string }[] = [
  { filter: 'all', label: 'Todas', href: '/' },
  { filter: 'completed', label: 'Completadas', href: '/?filter=completed' },
  { filter: 'pending', label: 'Pendientes', href: '/?filter=pending' },
];

const quantity = (counters: Counters, filter: TaskFilter) => (counters.available ? String(counters[filter]) : '—');

/** Tres enlaces (navegar es cambiar la dirección) con su cantidad; el del filtro actual se marca. */
export function FilterNav({ filter, counters }: { filter: TaskFilter; counters: Counters }) {
  return (
    <nav aria-label="Filtros" className="flex gap-2">
      {LINKS.map((item) => (
        <Link
          key={item.filter}
          href={item.href}
          aria-current={item.filter === filter ? 'page' : undefined}
          className="rounded border px-3 py-1 aria-[current=page]:bg-gray-900 aria-[current=page]:text-white"
        >
          {item.label} <span>{quantity(counters, item.filter)}</span>
        </Link>
      ))}
    </nav>
  );
}
