/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    // SRS §24 API lives at /api/* — proxy to the NestJS backend (port 3210).
    return [{ source: '/api/:path*', destination: 'http://localhost:3210/:path*' }];
  },
};

export default nextConfig;
