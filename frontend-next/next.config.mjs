/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  turbopack: {
    // Keep the build scoped to this app even when a parent package-lock exists
    // on a small production host.
    root: import.meta.dirname,
  },
  experimental: {
    // Lightsail builds must not spawn one worker per detected vCPU while the
    // currently deployed application is serving traffic.
    cpus: Math.max(Number(process.env.NEXT_BUILD_CPUS || 1), 1),
  },
};

if (process.env.ANALYZE === "true") {
  const { default: bundleAnalyzer } = await import("@next/bundle-analyzer");
  const withBundleAnalyzer = bundleAnalyzer({ enabled: true });

  Object.assign(nextConfig, withBundleAnalyzer(nextConfig));
}

export default nextConfig;
