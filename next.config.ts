import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Render runs the production server on Node. Keeping postgres external lets
  // its conditional exports select the Node socket adapter at runtime instead
  // of Vinext bundling the Cloudflare Workers adapter.
  serverExternalPackages: ["postgres"],
};

export default nextConfig;
