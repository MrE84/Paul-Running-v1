import { createPublicKey, verify } from "node:crypto";
import type { NextRequest } from "next/server";

const REGISTRY_URL = "https://raw.githubusercontent.com/MrE84/Paul-Running-v1/agent-auth/agent-read-keys.json";
const MAX_REQUEST_AGE_SECONDS = 120;
const MAX_FUTURE_SKEW_SECONDS = 30;
const MAX_KEY_LIFETIME_MS = 36 * 60 * 60 * 1000;
const AUTH_KEYS = ["_agentKey", "_agentTs", "_agentNonce", "_agentSig"] as const;

type AgentKey = {
  id: string;
  publicKeyPem: string;
  scope: "activities:read";
  enabled: boolean;
  issuedAt: string;
  expiresAt: string;
};

type Registry = { version: number; keys: AgentKey[] };

export class SignedAgentReadError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

/**
 * Language-neutral signed-read contract. The signature binds the method, exact
 * API path, timestamp and nonce. Query options remain constrained by the signed
 * activity path and the existing server-side API validation/bounds.
 */
export function canonicalAgentReadRequest(url: URL) {
  return [
    "GET",
    url.pathname,
    url.searchParams.get("_agentTs") ?? "",
    url.searchParams.get("_agentNonce") ?? "",
  ].join("\n");
}

function cleanUrl(url: URL) {
  const clean = new URL(url.toString());
  for (const key of AUTH_KEYS) clean.searchParams.delete(key);
  return clean;
}

function parseDate(value: string, label: string) {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new SignedAgentReadError(401, "AGENT_KEY_INVALID", `${label} is invalid.`);
  return milliseconds;
}

async function loadRegistry(fetchImpl: typeof fetch = fetch): Promise<Registry> {
  let response: Response;
  try {
    response = await fetchImpl(REGISTRY_URL, { cache: "no-store", headers: { "user-agent": "paul-running-agent-read/1" } });
  } catch {
    throw new SignedAgentReadError(503, "AGENT_KEY_REGISTRY_UNAVAILABLE", "The signed-read key registry could not be reached.");
  }
  if (!response.ok) {
    throw new SignedAgentReadError(503, "AGENT_KEY_REGISTRY_UNAVAILABLE", `The signed-read key registry returned HTTP ${response.status}.`);
  }
  const value = await response.json().catch(() => null) as Registry | null;
  if (!value || value.version !== 1 || !Array.isArray(value.keys)) {
    throw new SignedAgentReadError(503, "AGENT_KEY_REGISTRY_INVALID", "The signed-read key registry is invalid.");
  }
  return value;
}

function validateKey(key: AgentKey, now: number) {
  if (!key.enabled || key.scope !== "activities:read") {
    throw new SignedAgentReadError(401, "AGENT_KEY_NOT_AUTHORIZED", "The signed-read key is not authorized for activity reads.");
  }
  const issuedAt = parseDate(key.issuedAt, "Key issuedAt");
  const expiresAt = parseDate(key.expiresAt, "Key expiresAt");
  if (expiresAt <= issuedAt || expiresAt - issuedAt > MAX_KEY_LIFETIME_MS) {
    throw new SignedAgentReadError(401, "AGENT_KEY_INVALID", "The signed-read key lifetime is invalid.");
  }
  if (now < issuedAt - 5 * 60 * 1000 || now >= expiresAt) {
    throw new SignedAgentReadError(401, "AGENT_KEY_EXPIRED", "The signed-read key is not currently valid.");
  }
}

export async function authorizeSignedActivityRead(
  request: NextRequest,
  options?: { now?: number; fetchImpl?: typeof fetch },
) {
  if (request.method !== "GET") {
    throw new SignedAgentReadError(405, "AGENT_READ_ONLY", "Signed agent authentication is limited to GET activity reads.");
  }
  const url = new URL(request.url);
  if (url.pathname !== "/api/v1/activities" && !url.pathname.startsWith("/api/v1/activities/")) {
    throw new SignedAgentReadError(403, "AGENT_SCOPE_FORBIDDEN", "Signed agent authentication is limited to activity reads.");
  }

  const keyId = url.searchParams.get("_agentKey") ?? "";
  const timestampRaw = url.searchParams.get("_agentTs") ?? "";
  const nonce = url.searchParams.get("_agentNonce") ?? "";
  const signature = url.searchParams.get("_agentSig") ?? "";
  if (!keyId || !timestampRaw || !nonce || !signature) {
    throw new SignedAgentReadError(401, "AGENT_SIGNATURE_REQUIRED", "A complete signed-read credential is required.");
  }
  if (!/^[A-Za-z0-9._:-]{3,120}$/.test(keyId) || !/^[A-Za-z0-9_-]{16,160}$/.test(nonce) || !/^[A-Za-z0-9_-]{40,160}$/.test(signature)) {
    throw new SignedAgentReadError(401, "AGENT_SIGNATURE_INVALID", "The signed-read credential format is invalid.");
  }
  const timestamp = Number(timestampRaw);
  if (!Number.isInteger(timestamp)) throw new SignedAgentReadError(401, "AGENT_TIMESTAMP_INVALID", "The signed-read timestamp is invalid.");
  const now = options?.now ?? Date.now();
  const nowSeconds = Math.floor(now / 1000);
  if (timestamp < nowSeconds - MAX_REQUEST_AGE_SECONDS || timestamp > nowSeconds + MAX_FUTURE_SKEW_SECONDS) {
    throw new SignedAgentReadError(401, "AGENT_SIGNATURE_EXPIRED", "The signed-read request has expired.");
  }

  const registry = await loadRegistry(options?.fetchImpl);
  const key = registry.keys.find(item => item.id === keyId);
  if (!key) throw new SignedAgentReadError(401, "AGENT_KEY_UNKNOWN", "The signed-read key is unknown.");
  validateKey(key, now);

  let publicKey;
  let signatureBytes: Buffer;
  try {
    publicKey = createPublicKey(key.publicKeyPem);
    signatureBytes = Buffer.from(signature, "base64url");
  } catch {
    throw new SignedAgentReadError(401, "AGENT_SIGNATURE_INVALID", "The signed-read credential could not be decoded.");
  }
  const valid = verify(null, Buffer.from(canonicalAgentReadRequest(url)), publicKey, signatureBytes);
  if (!valid) throw new SignedAgentReadError(401, "AGENT_SIGNATURE_INVALID", "The signed-read signature is invalid.");

  return { keyId, cleanUrl: cleanUrl(url) };
}

export function hasSignedAgentCredential(request: NextRequest) {
  return AUTH_KEYS.some(key => request.nextUrl.searchParams.has(key));
}
