import { NextRequest, NextResponse } from "next/server";
import { protectedResourceMetadata } from "../../../lib/mcp/oauth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return NextResponse.json(protectedResourceMetadata(request.url), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
