/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The dashboard is a pure client of the FastAPI backend and the RPC node,
  // so it can be exported statically for hosting anywhere.
  eslint: { ignoreDuringBuilds: false },
  // Do not emit AGENTS.md / CLAUDE.md into the repo on every build.
  agentRules: false,
  // Dev-server origins allowed to request build assets. Without these, opening
  // the dashboard on 127.0.0.1 or a LAN IP makes Next 403 its own chunks.
  allowedDevOrigins: ["127.0.0.1", "localhost", "0.0.0.0"],
  // The floating dev badge overlaps the live feed when recording the demo.
  devIndicators: false,
};

export default nextConfig;
