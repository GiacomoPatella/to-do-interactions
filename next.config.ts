import type { NextConfig } from "next";

/** Standalone study. Static export so it can be hosted anywhere. */
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
