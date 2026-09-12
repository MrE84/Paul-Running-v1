import assert from "node:assert/strict";
import test from "node:test";
import { handleMcpRequest, mcpTools } from "./bridge";

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
