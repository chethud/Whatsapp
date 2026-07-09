/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    typedRoutes: true,
  },
  transpilePackages: ["@whatsapp/shared", "@whatsapp/ui"],
};

export default nextConfig;
