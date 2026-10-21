import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Iris is a client-only demo backed by localStorage. Route-level Activity
  // preservation (cacheComponents) would keep modals open across navigations
  // and stop page entrance animations from replaying, so it stays off.
  cacheComponents: false,
  devIndicators: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
