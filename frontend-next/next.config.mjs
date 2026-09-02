const configuredApiProxyTarget = (process.env.NEXT_API_PROXY_TARGET || "http://127.0.0.1:5001")
  .replace(/\/+$/, "")
  .replace(/\/api$/, "");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${configuredApiProxyTarget}/api/:path*`,
      },
    ];
  },
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
