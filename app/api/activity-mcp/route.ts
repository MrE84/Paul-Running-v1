import type { NextRequest } from "next/server";
import { handleActivityMcpRequest } from "../../../lib/mcp/activity-bridge";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return handleActivityMcpRequest(request);
}

export async function GET() {
  return new Response(JSON.stringify({ error: "Paul’s Running Activity MCP uses Streamable HTTP POST requests." }), {
    status: 405,
    headers: { "content-type": "application/json; charset=utf-8", allow: "POST" },
  });
}
