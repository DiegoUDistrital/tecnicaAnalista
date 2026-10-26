import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config';
import { securityHeaders } from '../../src/lib/security-headers';

describe('securityHeaders', () => {
  it('RF-F29: securityHeaders() define para /:path* exactamente X-Content-Type-Options: nosniff, Referrer-Policy: no-referrer y X-Frame-Options: DENY', () => {
    expect(securityHeaders()).toEqual([
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ]);
  });

  it('RF-F29: no define Content-Security-Policy ni X-Powered-By', () => {
    const keys = securityHeaders().flatMap((rule) => rule.headers.map((header) => header.key.toLowerCase()));
    expect(keys).not.toContain('content-security-policy');
    expect(keys).not.toContain('x-powered-by');
  });

  it('RF-F29: next.config desactiva poweredByHeader y su headers() devuelve securityHeaders()', async () => {
    expect(nextConfig.poweredByHeader).toBe(false);
    expect(await nextConfig.headers?.()).toEqual(securityHeaders());
  });
});
