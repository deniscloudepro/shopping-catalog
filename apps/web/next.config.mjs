/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@catalog/sheets"],
  agentRules: false,
  images: {
    // Product images come from arbitrary shops, so skip the remote-host allowlist.
    unoptimized: true,
  },
};

export default nextConfig;
