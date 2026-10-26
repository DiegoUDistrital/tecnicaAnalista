import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HomeView } from '../../src/components/home-view';
import type { Counters } from '../../src/server/counters/counters';
import type { TaskFilter } from '../../src/lib/task-filter';

const available: Counters = { available: true, completed: 3, pending: 5, all: 8 };
const render = (filter: TaskFilter, counters: Counters) =>
  renderToStaticMarkup(<HomeView filter={filter} counters={counters} />);
const links = (html: string) =>
  [...html.matchAll(/<a ([^>]*)>(.*?)<\/a>/g)].map((m) => ({ attrs: m[1] ?? '', text: m[2] ?? '' }));

describe('HomeView', () => {
  it('RF-F2: los tres enlaces llevan a /, /?filter=completed y /?filter=pending', () => {
    const hrefs = links(render('all', available)).map((l) => /href="([^"]*)"/.exec(l.attrs)?.[1]);
    expect(hrefs).toEqual(['/', '/?filter=completed', '/?filter=pending']);
  });

  it.each([
    ['all', 0],
    ['completed', 1],
    ['pending', 2],
  ] as const)('RF-F2: el enlace del filtro actual lleva aria-current="page" (%s)', (filter, index) => {
    const found = links(render(filter, available));
    found.forEach((link, i) => {
      expect(link.attrs.includes('aria-current="page"')).toBe(i === index);
    });
  });

  it('RF-F3: junto a cada enlace sale su cantidad (3 completadas, 5 pendientes, 8 todas) sin depender del filtro', () => {
    for (const filter of ['all', 'completed', 'pending'] as const) {
      const texts = links(render(filter, available)).map((l) => l.text.replace(/<[^>]*>/g, ''));
      expect(texts).toEqual(['Todas 8', 'Completadas 3', 'Pendientes 5']);
    }
  });

  it('RF-F4: con contadores no disponibles cada cantidad es — y aparece el aviso con role="status"', () => {
    const html = render('pending', { available: false });
    expect(links(html).map((l) => l.text.replace(/<[^>]*>/g, ''))).toEqual([
      'Todas —',
      'Completadas —',
      'Pendientes —',
    ]);
    expect(html).toMatch(/<p[^>]*role="status"[^>]*>No se pudieron cargar los contadores\.<\/p>/);
    expect(links(html)).toHaveLength(3);
  });

  it('RF-F4: con contadores disponibles no hay aviso', () => {
    expect(render('all', available)).not.toContain('role="status"');
  });

  it('RF-F1: el valor de la dirección no se refleja en el HTML', () => {
    const html = render('all', available);
    expect(html).not.toContain('script');
    expect(html).not.toContain('__proto__');
  });

  it('RF-F28: hay un único h1', () => {
    expect(render('all', available).match(/<h1[ >]/g)).toHaveLength(1);
  });
});
