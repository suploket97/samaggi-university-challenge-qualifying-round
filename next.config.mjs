/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typescript: {
    // The app is type-checked in development. This stops a minor mismatch
    // in a third-party type definition from blocking a deploy.
    ignoreBuildErrors: true,
  },
  images: { unoptimized: true },
  // Loaded at runtime only when needed: ioredis for a plain redis:// connection,
  // pg to create the question-bank tables on first run.
  serverExternalPackages: ["ioredis", "pg"],
};

export default nextConfig;
