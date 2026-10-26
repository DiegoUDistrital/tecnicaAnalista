import { HomeView } from '../components/home-view';
import { readFilter, type SearchParams } from '../lib/task-filter';
import { readCounters } from '../server/counters/counters';

// Se genera en cada petición: `next build` no se conecta a la BD y los contadores no se congelan.
export const dynamic = 'force-dynamic';

export default async function HomePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const filter = readFilter(await searchParams);
  const counters = await readCounters();
  return <HomeView filter={filter} counters={counters} />;
}
