/** @type {import('next').NextConfig} */
const nextConfig = {
  // analyzer.js spawns the opencode-ai CLI binary via a dynamically-computed
  // path (child_process.spawn), which Vercel's file-tracer can't see — without
  // this it prunes the binary from the deployed function and every review
  // silently falls back to pattern-based analysis ("opencode CLI not found").
  outputFileTracingIncludes: {
    'app/api/review/route.js': ['./node_modules/opencode-ai/**', './node_modules/opencode-*/**'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
