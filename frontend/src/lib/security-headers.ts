export interface HeaderRule {
  source: string;
  headers: { key: string; value: string }[];
}

/**
 * Cabeceras de seguridad para todas las rutas. No incluye Content-Security-Policy (limitación documentada).
 */
export function securityHeaders(): HeaderRule[] {
  return [
    {
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'X-Frame-Options', value: 'DENY' },
      ],
    },
  ];
}
