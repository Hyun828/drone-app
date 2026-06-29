/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["192.168.50.199", "10.215.41.69"],
  output: "export",
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
