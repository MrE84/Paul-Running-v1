import assert from "node:assert/strict";
import test from "node:test";
import { handleMcpRequest, mcpTools } from "./bridge";
import { createHash } from "node:crypto";
import { CHATGPT_CIMD_CLIENT_ID, CHATGPT_OAUTH_REDIRECT_URI, handleOAuthAuthorizationRequest, handleOAuthTokenRequest, type OAuthOptions } from "./oauth";

function request(body: unknown, token = "test-token") {
  return new Request("https://example.test/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

test("MCP bridge requires bearer authentication", async () => {
  const response = await handleMcpRequest(
    new Request("https://example.test/api/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }),
    { token: "test-token" },
  );
  assert.equal(response.status, 401);
  const payload = await response.json();
  assert.equal(payload.error.data.code, "UNAUTHORIZED");
});

test("MCP bridge accepts the dedicated training write bearer token before legacy fallbacks", async () => {
  const previousTraining = process.env.PAUL_RUNNING_TRAINING_WRITE_TOKEN;
  const previousMcp = process.env.PAUL_RUNNING_MCP_TOKEN;
  const previousApi = process.env.PAUL_RUNNING_API_TOKEN;
  try {
    process.env.PAUL_RUNNING_TRAINING_WRITE_TOKEN = "dedicated-training-token";
    process.env.PAUL_RUNNING_MCP_TOKEN = "legacy-mcp-token";
    process.env.PAUL_RUNNING_API_TOKEN = "legacy-api-token";

    const response = await handleMcpRequest(new Request("https://example.test/api/mcp", {
      method: "POST",
      headers: { authorization: "Bearer dedicated-training-token", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    }));
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.ok(Array.isArray(payload.result.tools));

    const rejectedLegacy = await handleMcpRequest(new Request("https://example.test/api/mcp", {
      method: "POST",
      headers: { authorization: "Bearer legacy-mcp-token", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    }));
    assert.equal(rejectedLegacy.status, 401);
  } finally {
    if (previousTraining === undefined) delete process.env.PAUL_RUNNING_TRAINING_WRITE_TOKEN;
    else process.env.PAUL_RUNNING_TRAINING_WRITE_TOKEN = previousTraining;
    if (previousMcp === undefined) delete process.env.PAUL_RUNNING_MCP_TOKEN;
    else process.env.PAUL_RUNNING_MCP_TOKEN = previousMcp;
    if (previousApi === undefined) delete process.env.PAUL_RUNNING_API_TOKEN;
    else process.env.PAUL_RUNNING_API_TOKEN = previousApi;
  }
});

test("MCP bridge initializes legacy clients and exposes only the constrained tool catalog", async () => {
  const init = await handleMcpRequest(
    request({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } } }),
    { token: "test-token" },
  );
  assert.equal(init.status, 200);
  const initPayload = await init.json();
  assert.equal(initPayload.result.serverInfo.name, "pauls-running");
  assert.equal(initPayload.result.protocolVersion, "2025-11-25");

  const listed = await handleMcpRequest(request({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }), { token: "test-token" });
  const payload = await listed.json();
  const names = payload.result.tools.map((tool: { name: string }) => tool.name);
  assert.deepEqual(names, mcpTools.map((tool) => tool.name));
  assert.ok(names.includes("publish_calendar_item"));
  assert.ok(names.includes("create_advanced_lunch_break_walk"));
  assert.equal(names.includes("fetch_url"), false);
  assert.equal(names.includes("sql"), false);
});

test("MCP bridge supports modern stateless discovery", async () => {
  const response = await handleMcpRequest(request({ jsonrpc: "2.0", id: 3, method: "server/discover", params: { _meta: {} } }), { token: "test-token" });
  const payload = await response.json();
  assert.equal(payload.result.protocolVersion, "2026-07-28");
  assert.equal(payload.result.capabilities.tools.listChanged, false);
});

test("scoped ChatGPT OAuth grants access to training tools, activity grants do not", async () => {
  const origin = "https://example.test";
  const oauth: OAuthOptions = { origin, secret: "isolated-test-oauth-signing-key", ownerAuthenticated: true,
    consumeAuthorizationCode: async () => true };
  const verifier = "a".repeat(64);
  async function grant(resource: string, scope: string) {
    const params = new URLSearchParams({ response_type: "code", client_id: CHATGPT_CIMD_CLIENT_ID,
      redirect_uri: CHATGPT_OAUTH_REDIRECT_URI, state: "test", code_challenge_method: "S256",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"), resource, scope, decision: "approve" });
    const approved = await handleOAuthAuthorizationRequest(new Request(`${origin}/api/oauth/authorize`, {
      method: "POST", headers: { origin, "content-type": "application/x-www-form-urlencoded" }, body: params,
    }), oauth);
    const code = new URL(approved.headers.get("location")!).searchParams.get("code")!;
    const exchanged = await handleOAuthTokenRequest(new Request(`${origin}/api/oauth/token`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", client_id: CHATGPT_CIMD_CLIENT_ID,
        redirect_uri: CHATGPT_OAUTH_REDIRECT_URI, resource, code, code_verifier: verifier }),
    }), oauth);
    return (await exchanged.json()).access_token as string;
  }
  const training = await grant(`${origin}/api/mcp`, "training:write");
  const activity = await grant(`${origin}/api/activity-mcp`, "activities:read");
  const body = { jsonrpc: "2.0", id: 1, method: "tools/list" };
  const accepted = await handleMcpRequest(request(body, training), { token: "legacy-token", oauth });
  assert.equal(accepted.status, 200);
  const listed = (await accepted.json()).result.tools;
  assert.equal(listed.find((tool: { name: string }) => tool.name === "get_profile").annotations.readOnlyHint, true);
  assert.equal(listed.find((tool: { name: string }) => tool.name === "publish_calendar_item").annotations.readOnlyHint, false);
  const rejected = await handleMcpRequest(request(body, activity), { token: "legacy-token", oauth });
  assert.equal(rejected.status, 401);
  assert.match(rejected.headers.get("WWW-Authenticate")!, /scope="training:write"/);
});
