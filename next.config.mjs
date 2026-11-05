import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@react-pdf/renderer"],
  webpack: (cfg) => {
    cfg.resolve.alias = { ...(cfg.resolve.alias ?? {}), "@": root };
    return cfg;
  },
};
export default nextConfig;
