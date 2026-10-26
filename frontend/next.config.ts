import type { NextConfig } from 'next';
import { securityHeaders } from './src/lib/security-headers';

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  headers: () => Promise.resolve(securityHeaders()),
};

export default nextConfig;
