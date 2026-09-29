import assert from "node:assert/strict";
import test from "node:test";
import { handleMcpRequest, mcpTools } from "./bridge";
import { createHash } from "node:crypto";
import type { TrainingApiRuntimeBundle } from "../training-api/runtime";
import { CHATGPT_CIMD_CLIENT_ID, CHATGPT_OAUTH_REDIRECT_URI, handleOAuthAuthorizationRequest, handleOAuthTokenRequest, type OAuthOptions } from "./oauth";

function request(body: unknown, token = "test-token") {
  return new Request("https://example.test/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

test("MCP bridge exposes tool metadata before authentication and challenges on tool calls", async () => {
  const listed = await handleMcpRequest(
    new Request("https://example.test/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    }),
    { token: "test-token" },
  );
  assert.equal(listed.status, 200);
  const catalog = await listed.json();
  assert.equal(catalog.result.tools[0].securitySchemes[0].type, "oauth2");
  assert.deepEqual(catalog.result.tools[0].securitySchemes[0].scopes, ["training:write"]);

  const called = await handleMcpRequest(
    new Request("https://example.test/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_profile", arguments: {} } }),
    }),
    { token: "test-token" },
  );
  assert.equal(called.status, 200);
  const payload = await called.json();
  assert.equal(payload.result.isError, true);
  assert.match(payload.result._meta["mcp/www_authenticate"][0], /scope="training:write"/);
  assert.match(payload.result._meta["mcp/www_authenticate"][0], /error="invalid_token"/);
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

test("MCP bridge supports 2026-07-28 discovery and tool listing", async () => {
  const meta = { "io.modelcontextprotocol/protocolVersion": "2026-07-28" };
  const response = await handleMcpRequest(
    request({ jsonrpc: "2.0", id: 3, method: "server/discover", params: { _meta: meta } }),
    { token: "test-token" },
  );
  const payload = await response.json();
  assert.equal(payload.result.resultType, "complete");
  assert.deepEqual(payload.result.supportedVersions, ["2026-07-28"]);
  assert.equal(payload.result.capabilities.tools.listChanged, false);
  assert.equal(payload.result.cacheScope, "private");
  assert.equal(payload.result.ttlMs, 0);
  assert.equal(payload.result._meta["io.modelcontextprotocol/serverInfo"].name, "pauls-running");

  const listed = await handleMcpRequest(
    request({ jsonrpc: "2.0", id: 4, method: "tools/list", params: { _meta: meta } }),
    { token: "test-token" },
  );
  const listedPayload = await listed.json();
  assert.equal(listedPayload.result.resultType, "complete");
  assert.equal(listedPayload.result.cacheScope, "private");
  assert.ok(listedPayload.result.tools.some((tool: { name: string }) => tool.name === "get_profile"));
  assert.ok(listedPayload.result.tools.some((tool: { name: string }) => tool.name === "publish_calendar_item"));
  assert.deepEqual(
    listedPayload.result.tools.find((tool: { name: string }) => tool.name === "get_profile").securitySchemes[0].scopes,
    ["training:write"],
  );
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
  assert.equal(listed.find((tool: { name: string }) => tool.name === "set_zones").annotations.readOnlyHint, false);
  const rejected = await handleMcpRequest(request(body, activity), { token: "legacy-token", oauth });
  assert.equal(rejected.status, 401);
  assert.match(rejected.headers.get("WWW-Authenticate")!, /scope="training:write"/);
});

test("sync_activities imports recent activities through the configured importer", async () => {
  const calls: number[] = [];
  const result = { items: [], pagesProcessed: 1, imported: 1, repaired: 0, alreadyComplete: 3, alreadyImported: 3, failed: 0 };
  const runtime = {
    primaryAthleteId: "primary-athlete",
    service: {},
    activityImporter: { importRecent: async (maxPages: number) => { calls.push(maxPages); return result; } },
  } as unknown as TrainingApiRuntimeBundle;

  const call = (args: Record<string, unknown>) => handleMcpRequest(
    request({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "sync_activities", arguments: args } }),
    { token: "test-token", runtime },
  ).then(response => response.json());

  const defaulted = await call({});
  assert.equal(defaulted.result.isError, undefined);
  assert.equal(defaulted.result.structuredContent.imported, 1);
  const wider = await call({ maxPages: 3 });
  assert.equal(wider.result.structuredContent.alreadyComplete, 3);
  assert.deepEqual(calls, [1, 3]);

  const invalid = await call({ maxPages: 4 });
  assert.equal(invalid.result.isError, true);
  assert.equal(invalid.result.structuredContent.error.code, "VALIDATION_FAILED");
  assert.deepEqual(calls, [1, 3]);

  const listed = await (await handleMcpRequest(request({ jsonrpc: "2.0", id: 2, method: "tools/list" }), { token: "test-token" })).json();
  assert.equal(listed.result.tools.find((tool: { name: string }) => tool.name === "sync_activities").annotations.readOnlyHint, false);
});

test("sync_activities reports a clear error when import is not configured", async () => {
  const runtime = { primaryAthleteId: "primary-athlete", service: {} } as unknown as TrainingApiRuntimeBundle;
  const payload = await (await handleMcpRequest(
    request({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "sync_activities", arguments: {} } }),
    { token: "test-token", runtime },
  )).json();
  assert.equal(payload.result.isError, true);
  assert.equal(payload.result.structuredContent.error.code, "INTERVALS_ICU_ACTIVITY_IMPORT_NOT_CONFIGURED");
});
