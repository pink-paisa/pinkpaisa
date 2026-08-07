/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

if (process.env.ANALYZE === "true") {
  const { default: bundleAnalyzer } = await import("@next/bundle-analyzer");
  const withBundleAnalyzer = bundleAnalyzer({ enabled: true });

  Object.assign(nextConfig, withBundleAnalyzer(nextConfig));
}

export default nextConfig;
