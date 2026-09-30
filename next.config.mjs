/** @type {import('next').NextConfig} */
const nextConfig = {
  // PAU-88: the MCP reads the coaching guide from disk at request time; make sure the
  // serverless bundle for the MCP route includes it.
  outputFileTracingIncludes: {
    "/api/mcp": ["./lib/debriefs/guide/**/*"],
  },
};

export default nextConfig;
