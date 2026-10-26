import type { NextConfig } from 'next';
import { securityHeaders } from './src/lib/security-headers';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  headers: () => Promise.resolve(securityHeaders()),
};

export default nextConfig;
