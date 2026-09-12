import { NextRequest, NextResponse } from "next/server";
import { ANALYSIS_COOKIE, createBrowserSession, equalSecret, SESSION_SECONDS, validBrowserSession } from "../../../lib/training-api/browser-session";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const secret = process.env.PAUL_RUNNING_API_TOKEN;
  return NextResponse.json({ authenticated: Boolean(secret && validBrowserSession(request.cookies.get(ANALYSIS_COOKIE)?.value, secret)) }, { headers: { "Cache-Control": "private, no-store" } });
}
export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "Same-origin request required." }, { status: 403 });
  const secret = process.env.PAUL_RUNNING_API_TOKEN;
  if (!secret) return NextResponse.json({ error: "Activity access is not configured on this server." }, { status: 503 });
  const body = await request.json().catch(() => null);
  if (typeof body?.token !== "string" || !equalSecret(body.token, secret)) return NextResponse.json({ error: "The access token is not valid." }, { status: 401 });
  const response = NextResponse.json({ authenticated: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(ANALYSIS_COOKIE, createBrowserSession(secret), { httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "strict", maxAge: SESSION_SECONDS, path: "/api" });
  return response;
}
export async function DELETE(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return NextResponse.json({ error: "Same-origin request required." }, { status: 403 });
  const response = NextResponse.json({ authenticated: false });
  response.cookies.set(ANALYSIS_COOKIE, "", { httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "strict", maxAge: 0, path: "/api" });
  return response;
}
