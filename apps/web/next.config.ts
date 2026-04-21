import type { NextConfig } from "next";

// Comma-separated hostnames/IPs for cross-origin dev clients (e.g. HMR from a phone on LAN).
// Example: NEXT_ALLOWED_DEV_ORIGINS=192.168.1.132
const extraAllowedDevOrigins =
  process.env.NEXT_ALLOWED_DEV_ORIGINS?.split(",")
    .map((h) => h.trim())
    .filter(Boolean) ?? [];

const allowedDevOrigins = ["*.ngrok-free.app", ...extraAllowedDevOrigins];

const nextConfig: NextConfig = {
  transpilePackages: ["@agents/agent", "@agents/db", "@agents/types"],
  serverExternalPackages: ["@langchain/core", "@langchain/langgraph", "@langchain/openai"],
  allowedDevOrigins,
};

export default nextConfig;
