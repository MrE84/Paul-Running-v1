import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  ACTIVITY_MCP_SCOPE,
  CHATGPT_CIMD_CLIENT_ID,
  CHATGPT_OAUTH_REDIRECT_URI,
  CODEX_CIMD_CLIENT_ID,
  activityMcpChallenge,
  authorizationServerMetadata,
  handleOAuthAuthorizationRequest,
  handleOAuthTokenRequest,
  protectedResourceMetadata,
  validActivityAccessToken,
  type OAuthOptions,
} from "./oauth";

const origin = "https://example.test";
const resource = `${origin}/api/activity-mcp`;
const verifier = "a".repeat(64);
const challenge = createHash("sha256").update(verifier).digest("base64url");

function options(consumed = new Set<string>()): OAuthOptions {
  return {
    origin,
    secret: "test-oauth-signing-secret",
    now: () => 1_800_000_000_000,
    ownerAuthenticated: true,
    consumeAuthorizationCode: async (jti) => {
      if (consumed.has(jti)) return false;
      consumed.add(jti);
      return true;
    },
  };
}

function authorizationUrl(clientId = CHATGPT_CIMD_CLIENT_ID, redirectUri = CHATGPT_OAUTH_REDIRECT_URI) {
  const url = new URL(`${origin}/api/oauth/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", "state-123");
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("resource", resource);
  url.searchParams.set("scope", ACTIVITY_MCP_SCOPE);
  return url;
}

async function authorize(oauth = options(), clientId = CHATGPT_CIMD_CLIENT_ID, redirectUri = CHATGPT_OAUTH_REDIRECT_URI) {
  const values = authorizationUrl(clientId, redirectUri).searchParams;
  values.set("decision", "approve");
  const response = await handleOAuthAuthorizationRequest(new Request(`${origin}/api/oauth/authorize`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin },
    body: values,
  }), oauth);
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get("location") ?? "");
  assert.equal(location.origin + location.pathname, redirectUri);
  assert.equal(location.searchParams.get("state"), "state-123");
  assert.equal(location.searchParams.get("iss"), origin);
  return location.searchParams.get("code") ?? "";
}

async function exchange(code: string, oauth = options(), clientId = CHATGPT_CIMD_CLIENT_ID, redirectUri = CHATGPT_OAUTH_REDIRECT_URI) {
  return handleOAuthTokenRequest(new Request(`${origin}/api/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      redirect_uri: redirectUri,
      resource,
      code,
      code_verifier: verifier,
    }),
  }), oauth);
}

test("publishes MCP protected-resource and OAuth authorization-server discovery", () => {
  assert.deepEqual(protectedResourceMetadata(`${origin}/.well-known/oauth-protected-resource`, options()), {
    resource,
    authorization_servers: [origin],
    scopes_supported: [ACTIVITY_MCP_SCOPE],
    bearer_methods_supported: ["header"],
    resource_documentation: "https://github.com/MrE84/Paul-Running-v1/blob/main/docs/activity-mcp.md",
  });
  const metadata = authorizationServerMetadata(`${origin}/.well-known/oauth-authorization-server`, options());
  assert.equal(metadata.issuer, origin);
  assert.equal(metadata.client_id_metadata_document_supported, true);
  assert.deepEqual(metadata.code_challenge_methods_supported, ["S256"]);
  assert.deepEqual(metadata.token_endpoint_auth_methods_supported, ["none"]);
});

test("publishes an OAuth challenge that points ChatGPT at protected-resource metadata", () => {
  assert.equal(activityMcpChallenge(`${origin}/api/activity-mcp`, options()),
    `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource", scope="activities:read"`);
});

test("renders read-only consent for the exact ChatGPT CIMD client and rejects another client", async () => {
  const page = await handleOAuthAuthorizationRequest(new Request(authorizationUrl()), options());
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Activities: read/);

  const invalid = authorizationUrl();
  invalid.searchParams.set("client_id", "https://attacker.example/client.json");
  const rejected = await handleOAuthAuthorizationRequest(new Request(invalid), options());
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).error, "invalid_request");
});

test("accepts the official Codex CIMD client with an RFC 8252 loopback redirect", async () => {
  const redirectUri = "http://127.0.0.1:36669/callback";
  const page = await handleOAuthAuthorizationRequest(
    new Request(authorizationUrl(CODEX_CIMD_CLIENT_ID, redirectUri)), options());
  assert.equal(page.status, 200);

  const oauth = options();
  const code = await authorize(oauth, CODEX_CIMD_CLIENT_ID, redirectUri);
  const response = await exchange(code, oauth, CODEX_CIMD_CLIENT_ID, redirectUri);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(validActivityAccessToken(payload.access_token, `${origin}/api/activity-mcp`, oauth), true);

  for (const invalidRedirect of [
    "https://127.0.0.1/callback",
    "http://127.0.0.1:36669/not-callback",
    "http://attacker.example/callback",
  ]) {
    const rejected = await handleOAuthAuthorizationRequest(
      new Request(authorizationUrl(CODEX_CIMD_CLIENT_ID, invalidRedirect)), options());
    assert.equal(rejected.status, 400);
  }
});

test("exchanges a PKCE authorization code for a scoped access token and refresh token", async () => {
  const oauth = options();
  const response = await exchange(await authorize(oauth), oauth);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.token_type, "Bearer");
  assert.equal(payload.scope, ACTIVITY_MCP_SCOPE);
  assert.ok(payload.refresh_token);
  assert.equal(validActivityAccessToken(payload.access_token, `${origin}/api/activity-mcp`, oauth), true);
  assert.equal(validActivityAccessToken(payload.access_token, "https://other.example/api/activity-mcp", {
    ...oauth,
    origin: "https://other.example",
  }), false);
});

test("rejects an incorrect PKCE verifier and authorization-code replay", async () => {
  const oauth = options();
  const code = await authorize(oauth);
  const wrong = await handleOAuthTokenRequest(new Request(`${origin}/api/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code", client_id: CHATGPT_CIMD_CLIENT_ID,
      redirect_uri: CHATGPT_OAUTH_REDIRECT_URI, resource, code, code_verifier: "b".repeat(64),
    }),
  }), oauth);
  assert.equal((await wrong.json()).error, "invalid_grant");

  assert.equal((await exchange(code, oauth)).status, 200);
  const replay = await exchange(code, oauth);
  assert.equal(replay.status, 400);
  assert.equal((await replay.json()).error, "invalid_grant");
});
