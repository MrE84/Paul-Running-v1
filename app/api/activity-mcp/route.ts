import type { NextRequest } from "next/server";
import { handleActivityMcpRequest } from "../../../lib/mcp/activity-bridge";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return handleActivityMcpRequest(request);
}

export async function GET() {
  return new Response(JSON.stringify({
    name: "Paul’s Running Activity MCP",
    transport: "Streamable HTTP",
    endpoint: "/api/activity-mcp",
    authentication: "OAuth 2.1 authorization code with PKCE",
  }), {
    status: 405,
    headers: { "content-type": "application/json; charset=utf-8", allow: "POST" },
  });
}
