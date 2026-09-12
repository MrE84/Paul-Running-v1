import type { NextRequest } from "next/server";
import { handleMcpRequest } from "../../../lib/mcp/bridge";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return handleMcpRequest(request);
}

export async function GET() {
  return new Response(JSON.stringify({ error: "Paul’s Running MCP uses Streamable HTTP POST requests." }), {
    status: 405,
    headers: { "content-type": "application/json; charset=utf-8", allow: "POST" },
  });
}
