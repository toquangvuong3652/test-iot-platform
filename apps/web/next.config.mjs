/** @type {import('next').NextConfig} */
const nextConfig = {
  // The api + consumer run as separate processes (dev: :3000 / :3001,
  // docker: api:3000 / consumer:3001). The browser reaches them through
  // NEXT_PUBLIC_API_URL / NEXT_PUBLIC_WS_URL — CORS is enabled on both.
  // (WebSocket upgrades are NOT proxied through Next rewrites, hence the
  // explicit socket URL instead of same-origin.)
  reactStrictMode: true,
};

export default nextConfig;
