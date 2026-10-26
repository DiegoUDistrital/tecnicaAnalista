import { vi } from 'vitest';

/**
 * `router.refresh` simulado. Uso en cada test:
 * `vi.mock('next/navigation', async () => (await import('../helpers/router-mock')).navigationMock)`.
 */
export const refresh = vi.fn();
export const navigationMock = { useRouter: () => ({ refresh }) };
