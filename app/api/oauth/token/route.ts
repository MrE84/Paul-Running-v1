import { NextRequest } from "next/server";
import { handleOAuthTokenRequest } from "../../../../lib/mcp/oauth";
import { consumeOAuthAuthorizationCode } from "../../../../lib/mcp/oauth-code-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return handleOAuthTokenRequest(request, { consumeAuthorizationCode: consumeOAuthAuthorizationCode });
}
