import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { NextRequest } from "next/server";
import {
  authorizeSignedActivityRead,
  canonicalAgentReadRequest,
  SignedAgentReadError,
} from "./signed-agent-read";

const now = Date.parse("2026-09-13T21:10:00.000Z");
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const keyId = "chatgpt-test-key";
const nonce = "abcdefghijklmnopQRSTUV12";

function registry(overrides: Partial<{ enabled: boolean; issuedAt: string; expiresAt: string; scope: string }> = {}) {
  return {
    version: 1,
    keys: [{
      id: keyId,
      publicKeyPem,
      scope: overrides.scope ?? "activities:read",
      enabled: overrides.enabled ?? true,
      issuedAt: overrides.issuedAt ?? "2026-09-13T21:00:00.000Z",
      expiresAt: overrides.expiresAt ?? "2026-09-14T21:00:00.000Z",
    }],
  };
}

function registryFetch(value = registry()) {
  return (async () => new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  })) as typeof fetch;
}

function signedUrl(path = "/api/v1/activities/i185832465/analysis", semantic: Record<string, string> = {}) {
  const url = new URL(`https://paul-running-v1.vercel.app${path}`);
  for (const [key, value] of Object.entries(semantic)) url.searchParams.set(key, value);
  url.searchParams.set("_agentKey", keyId);
  url.searchParams.set("_agentTs", String(Math.floor(now / 1000)));
  url.searchParams.set("_agentNonce", nonce);
  const signature = sign(null, Buffer.from(canonicalAgentReadRequest(url)), privateKey).toString("base64url");
  url.searchParams.set("_agentSig", signature);
  return url;
}

test("signed activity read validates and strips transport credentials before delegation", async () => {
  const url = signedUrl("/api/v1/activities/i185832465/analysis", { recompute: "1" });
  const result = await authorizeSignedActivityRead(new NextRequest(url), { now, fetchImpl: registryFetch() });
  assert.equal(result.keyId, keyId);
  assert.equal(result.cleanUrl.pathname, "/api/v1/activities/i185832465/analysis");
  assert.equal(result.cleanUrl.searchParams.get("recompute"), "1");
  assert.equal(result.cleanUrl.searchParams.has("_agentKey"), false);
  assert.equal(result.cleanUrl.searchParams.has("_agentSig"), false);
});

test("tampering with the signed activity path invalidates the signature", async () => {
  const url = signedUrl("/api/v1/activities/i185832465/sample", { elapsedSeconds: "1123" });
  url.pathname = "/api/v1/activities/iDIFFERENT/sample";
  await assert.rejects(
    () => authorizeSignedActivityRead(new NextRequest(url), { now, fetchImpl: registryFetch() }),
    (error: unknown) => error instanceof SignedAgentReadError && error.code === "AGENT_SIGNATURE_INVALID",
  );
});

test("signed activity query options remain available for server-side validation", async () => {
  const url = signedUrl("/api/v1/activities/i185832465/sample", { elapsedSeconds: "1123" });
  const result = await authorizeSignedActivityRead(new NextRequest(url), { now, fetchImpl: registryFetch() });
  assert.equal(result.cleanUrl.searchParams.get("elapsedSeconds"), "1123");
});

test("signed activity read rejects expired requests", async () => {
  const url = signedUrl();
  url.searchParams.set("_agentTs", String(Math.floor(now / 1000) - 121));
  const signature = sign(null, Buffer.from(canonicalAgentReadRequest(url)), privateKey).toString("base64url");
  url.searchParams.set("_agentSig", signature);
  await assert.rejects(
    () => authorizeSignedActivityRead(new NextRequest(url), { now, fetchImpl: registryFetch() }),
    (error: unknown) => error instanceof SignedAgentReadError && error.code === "AGENT_SIGNATURE_EXPIRED",
  );
});

test("signed activity read rejects disabled or overlong-lived keys", async () => {
  const url = signedUrl();
  await assert.rejects(
    () => authorizeSignedActivityRead(new NextRequest(url), { now, fetchImpl: registryFetch(registry({ enabled: false })) }),
    (error: unknown) => error instanceof SignedAgentReadError && error.code === "AGENT_KEY_NOT_AUTHORIZED",
  );
  await assert.rejects(
    () => authorizeSignedActivityRead(new NextRequest(url), {
      now,
      fetchImpl: registryFetch(registry({ expiresAt: "2026-09-16T21:00:00.000Z" })),
    }),
    (error: unknown) => error instanceof SignedAgentReadError && error.code === "AGENT_KEY_INVALID",
  );
});

test("signed activity auth cannot be used outside the activity API", async () => {
  const url = signedUrl("/api/v1/profile");
  await assert.rejects(
    () => authorizeSignedActivityRead(new NextRequest(url), { now, fetchImpl: registryFetch() }),
    (error: unknown) => error instanceof SignedAgentReadError && error.code === "AGENT_SCOPE_FORBIDDEN",
  );
});
