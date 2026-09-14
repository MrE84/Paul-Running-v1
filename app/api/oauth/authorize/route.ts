import { NextRequest } from "next/server";
import { handleOAuthAuthorizationRequest } from "../../../../lib/mcp/oauth";
import { ANALYSIS_COOKIE, validBrowserSession } from "../../../../lib/training-api/browser-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function options(request: NextRequest) {
  const secret = process.env.PAUL_RUNNING_API_TOKEN?.trim() ?? "";
  return {
    ownerSecret: secret,
    ownerAuthenticated: Boolean(secret && validBrowserSession(request.cookies.get(ANALYSIS_COOKIE)?.value, secret)),
  };
}

export async function GET(request: NextRequest) {
  return handleOAuthAuthorizationRequest(request, options(request));
}

export async function POST(request: NextRequest) {
  return handleOAuthAuthorizationRequest(request, options(request));
}
