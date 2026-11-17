import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Veritabanı sürücüleri paketlenmeden Node'dan yüklensin (PGlite WASM dosyaları içerir).
  serverExternalPackages: ["postgres", "@electric-sql/pglite"],
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
