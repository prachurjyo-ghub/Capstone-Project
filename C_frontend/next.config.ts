import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  devIndicators: false,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  turbopack: { root: process.cwd() },
  images: {
    formats: ['image/webp'],
    deviceSizes: [360, 640, 768, 1024, 1280, 1536],
    imageSizes: [64, 96, 160, 240, 320],
    qualities: [70, 82],
    minimumCacheTTL: 31536000,
  },
  async rewrites() {
    const apiOrigin = process.env.API_INTERNAL_URL?.replace(/\/$/, '');
    return apiOrigin
      ? [{ source: '/api/:path*', destination: `${apiOrigin}/api/:path*` }]
      : [];
  },
};
export default nextConfig;
