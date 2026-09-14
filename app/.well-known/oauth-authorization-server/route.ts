import { NextRequest, NextResponse } from "next/server";
import { authorizationServerMetadata } from "../../../lib/mcp/oauth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return NextResponse.json(authorizationServerMetadata(request.url), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
