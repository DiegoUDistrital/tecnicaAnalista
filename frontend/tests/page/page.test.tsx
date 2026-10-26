import { isValidElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeView } from '../../src/components/home-view';
import type { Counters } from '../../src/server/counters/counters';

const readCounters = vi.fn<() => Promise<Counters>>();
vi.mock('../../src/server/counters/counters', () => ({ readCounters: () => readCounters() }));

const { default: HomePage, dynamic } = await import('../../src/app/page');

beforeEach(() => {
  readCounters.mockReset();
});

describe('HomePage', () => {
  it("RF-F5: page exporta dynamic = 'force-dynamic'", () => {
    expect(dynamic).toBe('force-dynamic');
  });

  it('RF-F1: page lee searchParams (promesa), llama a readCounters y entrega filtro y contadores a HomeView', async () => {
    const counters: Counters = { available: true, completed: 1, pending: 2, all: 3 };
    readCounters.mockResolvedValue(counters);
    const element = await HomePage({ searchParams: Promise.resolve({ filter: 'pending' }) });
    expect(readCounters).toHaveBeenCalledTimes(1);
    expect(isValidElement(element)).toBe(true);
    expect(element.type).toBe(HomeView);
    expect(element.props).toEqual({ filter: 'pending', counters });
  });

  it('RF-F4: si readCounters devuelve available:false la página se genera igual', async () => {
    readCounters.mockResolvedValue({ available: false });
    const element = await HomePage({ searchParams: Promise.resolve({ filter: 'x' }) });
    expect(element.props).toEqual({ filter: 'all', counters: { available: false } });
  });
});
