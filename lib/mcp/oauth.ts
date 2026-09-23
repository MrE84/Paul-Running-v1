import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const ACTIVITY_MCP_SCOPE = "activities:read";
export const TRAINING_MCP_SCOPE = "training:write";
export const CHATGPT_CIMD_CLIENT_ID = "https://chatgpt.com/oauth/client.json";
export const CHATGPT_OAUTH_REDIRECT_URI = "https://chatgpt.com/connector_platform_oauth_redirect";
export const CODEX_CIMD_CLIENT_ID = "https://chatgpt.com/oauth/codex/client.json";

const ACCESS_TOKEN_SECONDS = 60 * 60;
const REFRESH_TOKEN_SECONDS = 30 * 24 * 60 * 60;
const AUTHORIZATION_CODE_SECONDS = 5 * 60;

type TokenKind = "authorization_code" | "access_token" | "refresh_token";

type SignedPayload = {
  typ: TokenKind;
  iss: string;
  aud: string;
  client_id: string;
  scope: string;
  sub: string;
  iat: number;
  exp: number;
  jti: string;
  redirect_uri?: string;
  code_challenge?: string;
};

export type OAuthOptions = {
  origin?: string;
  secret?: string;
  now?: () => number;
  ownerAuthenticated?: boolean;
  ownerSecret?: string;
  activityOwnerSecret?: string;
  trainingOwnerSecret?: string;
  consumeAuthorizationCode?: (jti: string, expiresAt: number) => Promise<boolean>;
};

const globalCodeUses = globalThis as typeof globalThis & {
  __paulRunningOAuthCodeUses?: Map<string, number>;
};

function unixNow(options?: OAuthOptions) {
  return Math.floor((options?.now?.() ?? Date.now()) / 1000);
}

function configuredSecret(options?: OAuthOptions): string {
  const secret = options?.secret
    ?? process.env.PAUL_RUNNING_OAUTH_SIGNING_SECRET?.trim()
    ?? process.env.PAUL_RUNNING_MCP_TOKEN?.trim()
    ?? process.env.PAUL_RUNNING_API_TOKEN?.trim();
  if (!secret) throw new Error("OAuth signing is not configured.");
  return secret;
}

function secureEqual(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function originFor(requestUrl: string, options?: OAuthOptions) {
  return (options?.origin ?? new URL(requestUrl).origin).replace(/\/$/, "");
}

export function activityMcpResource(requestUrl: string, options?: OAuthOptions) {
  return `${originFor(requestUrl, options)}/api/activity-mcp`;
}

export function trainingMcpResource(requestUrl: string, options?: OAuthOptions) {
  return `${originFor(requestUrl, options)}/api/mcp`;
}

export function protectedResourceUrl(requestUrl: string, options?: OAuthOptions) {
  return `${originFor(requestUrl, options)}/.well-known/oauth-protected-resource`;
}

export function activityMcpChallenge(requestUrl: string, options?: OAuthOptions) {
  return `Bearer resource_metadata="${protectedResourceUrl(requestUrl, options)}", scope="${ACTIVITY_MCP_SCOPE}"`;
}

export function trainingMcpChallenge(requestUrl: string, options?: OAuthOptions) {
  return `Bearer resource_metadata="${originFor(requestUrl, options)}/.well-known/oauth-protected-resource/api/mcp", scope="${TRAINING_MCP_SCOPE}"`;
}

export function protectedResourceMetadata(requestUrl: string, options?: OAuthOptions) {
  const origin = originFor(requestUrl, options);
  return {
    resource: activityMcpResource(requestUrl, options),
    authorization_servers: [origin],
    scopes_supported: [ACTIVITY_MCP_SCOPE],
    bearer_methods_supported: ["header"],
    resource_documentation: "https://github.com/MrE84/Paul-Running-v1/blob/main/docs/activity-mcp.md",
  };
}

export function trainingProtectedResourceMetadata(requestUrl: string, options?: OAuthOptions) {
  const origin = originFor(requestUrl, options);
  return {
    resource: trainingMcpResource(requestUrl, options),
    authorization_servers: [origin],
    scopes_supported: [TRAINING_MCP_SCOPE],
    bearer_methods_supported: ["header"],
    resource_documentation: "https://github.com/MrE84/Paul-Running-v1/blob/main/docs/chatgpt-mcp-bridge.md",
  };
}

export function authorizationServerMetadata(requestUrl: string, options?: OAuthOptions) {
  const origin = originFor(requestUrl, options);
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/api/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: [ACTIVITY_MCP_SCOPE, TRAINING_MCP_SCOPE],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  };
}

function encode(payload: SignedPayload, options?: OAuthOptions) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", configuredSecret(options)).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function decode(value: string, expectedType: TokenKind, options?: OAuthOptions): SignedPayload | null {
  const [encoded, signature, extra] = value.split(".");
  if (!encoded || !signature || extra) return null;
  const expected = createHmac("sha256", configuredSecret(options)).update(encoded).digest("base64url");
  if (!secureEqual(signature, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SignedPayload;
    const now = unixNow(options);
    if (payload.typ !== expectedType || payload.exp <= now || payload.iat > now + 30) return null;
    return payload;
  } catch {
    return null;
  }
}

function scopeForResource(resource: string, requestUrl: string, options?: OAuthOptions): string | null {
  if (resource === activityMcpResource(requestUrl, options)) return ACTIVITY_MCP_SCOPE;
  if (resource === trainingMcpResource(requestUrl, options)) return TRAINING_MCP_SCOPE;
  return null;
}

function exactScope(scope: string, resource: string, requestUrl: string, options?: OAuthOptions) {
  const expected = scopeForResource(resource, requestUrl, options);
  return expected !== null && scope === expected;
}

function normalizeAuthorizationScope(params: AuthorizationParams, requestUrl: string, options?: OAuthOptions): AuthorizationParams {
  const expected = scopeForResource(params.resource, requestUrl, options);
  if (!expected) return params;

  // The Activity MCP has exactly one permission and one audience. OAuth clients
  // may request broader authorization-server scopes, but this resource can only
  // ever issue activities:read. Down-scope the grant to that single permission.
  if (expected === ACTIVITY_MCP_SCOPE) {
    return { ...params, scope: ACTIVITY_MCP_SCOPE };
  }

  // Training is privileged: only default an omitted scope; any explicit scope
  // must continue to match training:write exactly.
  return !params.scope ? { ...params, scope: expected } : params;
}

function validCodexLoopbackRedirect(redirectUri: string) {
  try {
    const redirect = new URL(redirectUri);
    return redirect.protocol === "http:"
      && (redirect.hostname === "127.0.0.1" || redirect.hostname === "localhost")
      && redirect.pathname === "/callback"
      && !redirect.username
      && !redirect.password
      && !redirect.search
      && !redirect.hash;
  } catch {
    return false;
  }
}

function validClient(clientId: string, redirectUri: string) {
  return (clientId === CHATGPT_CIMD_CLIENT_ID && redirectUri === CHATGPT_OAUTH_REDIRECT_URI)
    || (clientId === CODEX_CIMD_CLIENT_ID && validCodexLoopbackRedirect(redirectUri));
}

function recognizedClient(clientId: string) {
  return clientId === CHATGPT_CIMD_CLIENT_ID || clientId === CODEX_CIMD_CLIENT_ID;
}

function validResource(resource: string, requestUrl: string, options?: OAuthOptions) {
  return resource === activityMcpResource(requestUrl, options) || resource === trainingMcpResource(requestUrl, options);
}

function oauthJson(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      pragma: "no-cache",
    },
  });
}

function oauthError(error: string, description: string, status = 400) {
  return oauthJson({ error, error_description: description }, status);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

type AuthorizationParams = {
  responseType: string;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  resource: string;
  scope: string;
};

function authorizationParams(values: URLSearchParams | FormData): AuthorizationParams {
  const get = (key: string) => String(values.get(key) ?? "");
  return {
    responseType: get("response_type"),
    clientId: get("client_id"),
    redirectUri: get("redirect_uri"),
    state: get("state"),
    codeChallenge: get("code_challenge"),
    codeChallengeMethod: get("code_challenge_method"),
    resource: get("resource"),
    scope: get("scope"),
  };
}

function validateAuthorizationParams(params: AuthorizationParams, requestUrl: string, options?: OAuthOptions): string | null {
  if (params.responseType !== "code") return "Only the authorization-code response type is supported.";
  if (!validClient(params.clientId, params.redirectUri)) return "The OAuth client or redirect URI is not authorized.";
  if (!params.state) return "OAuth state is required.";
  if (params.codeChallengeMethod !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(params.codeChallenge)) {
    return "A valid S256 PKCE challenge is required.";
  }
  if (!validResource(params.resource, requestUrl, options)) return "The requested OAuth resource is not this Activity MCP server.";
  if (!exactScope(params.scope, params.resource, requestUrl, options)) return "The scope is not available for this MCP resource.";
  return null;
}

function ownerSecretForResource(resource: string, requestUrl: string, options?: OAuthOptions): string {
  if (resource === activityMcpResource(requestUrl, options)) {
    return options?.activityOwnerSecret
      ?? process.env.PAUL_RUNNING_ACTIVITY_READ_TOKEN?.trim()
      ?? options?.ownerSecret
      ?? process.env.PAUL_RUNNING_API_TOKEN?.trim()
      ?? "";
  }
  if (resource === trainingMcpResource(requestUrl, options)) {
    return options?.trainingOwnerSecret
      ?? options?.ownerSecret
      ?? process.env.PAUL_RUNNING_API_TOKEN?.trim()
      ?? "";
  }
  return "";
}

function authorizationPage(params: AuthorizationParams, requestUrl: string, authenticated: boolean, message?: string) {
  const training = params.scope === TRAINING_MCP_SCOPE;
  const consent = training
    ? { title: "Training: read and write", detail: "Read your profile, zones, workouts, plans and calendar; create and revise workouts and plans; publish scheduled workouts to Intervals.icu for Garmin delivery. No arbitrary network, database or account administration." }
    : { title: "Activities: read", detail: "Activity summaries, full sample streams, GPS, raw decoded FIT data and point lookups. No training-plan or workout writes." };
  const hidden = [
    ["response_type", params.responseType],
    ["client_id", params.clientId],
    ["redirect_uri", params.redirectUri],
    ["state", params.state],
    ["code_challenge", params.codeChallenge],
    ["code_challenge_method", params.codeChallengeMethod],
    ["resource", params.resource],
    ["scope", params.scope],
  ].map(([name, value]) => `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`).join("");
  const credentialLabel = training ? "Paul’s Running access token" : "Paul’s Running activity read token";
  const credential = authenticated ? "" : `
    <label>${credentialLabel}<input name="owner_token" type="password" autocomplete="current-password" required></label>
    <small>The token is submitted only to Paul’s Running and is never sent to ChatGPT.</small>`;
  const warning = message ? `<p class="error">${escapeHtml(message)}</p>` : "";
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Paul’s Running</title><style>
    :root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#08111d;color:#eef6ff;font:16px/1.5 system-ui,sans-serif}.card{width:min(520px,calc(100% - 32px));box-sizing:border-box;padding:32px;border:1px solid #28425f;border-radius:20px;background:#101e2e;box-shadow:0 24px 80px #0008}h1{margin:0 0 8px;font-size:28px}p{color:#b9cadc}.scope{margin:24px 0;padding:16px;border-radius:12px;background:#0a1725}.scope strong{display:block;color:#6fe7c8}.scope span{font-size:14px;color:#b9cadc}label{display:grid;gap:8px;margin:18px 0 6px;font-weight:700}input{padding:13px;border:1px solid #45617f;border-radius:9px;background:#07111d;color:#fff;font:inherit}small{display:block;color:#90a6bc}.actions{display:flex;gap:12px;margin-top:26px}button{flex:1;padding:13px;border:0;border-radius:9px;background:#5de0bd;color:#06231b;font:700 16px system-ui;cursor:pointer}.deny{background:#263b51;color:#e7f0f8}.error{color:#ff9c9c}
  </style></head><body><main class="card"><h1>Connect Paul’s Running</h1><p>ChatGPT is requesting ${training ? "training read and write" : "read-only activity"} access.</p><div class="scope"><strong>${consent.title}</strong><span>${consent.detail}</span></div>${warning}<form method="post" action="${escapeHtml(new URL(requestUrl).pathname)}">${hidden}${credential}<div class="actions"><button class="deny" name="decision" value="deny" formnovalidate>Cancel</button><button name="decision" value="approve">Allow access</button></div></form></main></body></html>`, {
    status: message ? 401 : 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}

function redirectAuthorization(params: AuthorizationParams, requestUrl: string, values: Record<string, string>, options?: OAuthOptions) {
  const target = new URL(params.redirectUri);
  target.searchParams.set("state", params.state);
  target.searchParams.set("iss", originFor(requestUrl, options));
  for (const [key, value] of Object.entries(values)) target.searchParams.set(key, value);
  return Response.redirect(target, 302);
}

export async function handleOAuthAuthorizationRequest(request: Request, options?: OAuthOptions): Promise<Response> {
  const values = request.method === "POST" ? await request.formData() : new URL(request.url).searchParams;
  const parsed = authorizationParams(values);
  const params = normalizeAuthorizationScope(parsed, request.url, options);
  const validationError = validateAuthorizationParams(params, request.url, options);
  if (validationError) {
    console.warn("OAuth authorization rejected", {
      method: request.method,
      clientId: params.clientId,
      resource: params.resource,
      requestedScope: parsed.scope,
      effectiveScope: params.scope,
      error: validationError,
    });
    return oauthError("invalid_request", validationError);
  }

  if (request.method !== "POST") return authorizationPage(params, request.url, Boolean(options?.ownerAuthenticated));
  if (request.headers.get("origin") !== new URL(request.url).origin) return oauthError("access_denied", "Same-origin approval is required.", 403);
  if (String(values.get("decision") ?? "") !== "approve") {
    return redirectAuthorization(params, request.url, { error: "access_denied", error_description: "The user declined access." }, options);
  }
  const supplied = String(values.get("owner_token") ?? "");
  const ownerSecret = ownerSecretForResource(params.resource, request.url, options);
  if (!options?.ownerAuthenticated && (!ownerSecret || !supplied || !secureEqual(supplied, ownerSecret))) {
    return authorizationPage(params, request.url, false, "The Paul’s Running access token was not valid.");
  }

  const now = unixNow(options);
  const code = encode({
    typ: "authorization_code",
    iss: originFor(request.url, options),
    aud: params.resource,
    client_id: params.clientId,
    scope: params.scope,
    sub: "primary-athlete",
    iat: now,
    exp: now + AUTHORIZATION_CODE_SECONDS,
    jti: randomUUID(),
    redirect_uri: params.redirectUri,
    code_challenge: params.codeChallenge,
  }, options);
  return redirectAuthorization(params, request.url, { code }, options);
}

async function consumeOnce(jti: string, expiresAt: number, options?: OAuthOptions) {
  if (options?.consumeAuthorizationCode) return options.consumeAuthorizationCode(jti, expiresAt);
  const uses = globalCodeUses.__paulRunningOAuthCodeUses ?? new Map<string, number>();
  globalCodeUses.__paulRunningOAuthCodeUses = uses;
  const now = unixNow(options);
  for (const [key, expiry] of uses) if (expiry <= now) uses.delete(key);
  if (uses.has(jti)) return false;
  uses.set(jti, expiresAt);
  return true;
}

function pkceChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

function issueTokens(base: Pick<SignedPayload, "iss" | "aud" | "client_id" | "scope" | "sub">, options?: OAuthOptions) {
  const now = unixNow(options);
  const accessToken = encode({ ...base, typ: "access_token", iat: now, exp: now + ACCESS_TOKEN_SECONDS, jti: randomUUID() }, options);
  const refreshToken = encode({ ...base, typ: "refresh_token", iat: now, exp: now + REFRESH_TOKEN_SECONDS, jti: randomUUID() }, options);
  return oauthJson({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_SECONDS,
    refresh_token: refreshToken,
    scope: base.scope,
  });
}

export async function handleOAuthTokenRequest(request: Request, options?: OAuthOptions): Promise<Response> {
  if (request.method !== "POST") return oauthError("invalid_request", "The token endpoint requires POST.", 405);
  const form = await request.formData().catch(() => null);
  if (!form) return oauthError("invalid_request", "A form-encoded token request is required.");
  const grantType = String(form.get("grant_type") ?? "");
  const clientId = String(form.get("client_id") ?? "");
  const requestedResource = String(form.get("resource") ?? "");
  if (!recognizedClient(clientId)) {
    return oauthError("invalid_client", "The OAuth client is not authorized.", 401);
  }

  if (grantType === "authorization_code") {
    const code = decode(String(form.get("code") ?? ""), "authorization_code", options);
    const resource = requestedResource || code?.aud || "";
    const redirectUri = String(form.get("redirect_uri") ?? "");
    const verifier = String(form.get("code_verifier") ?? "");
    if (!validResource(resource, request.url, options)
      || !code || code.iss !== originFor(request.url, options) || code.aud !== resource || code.client_id !== clientId
      || code.redirect_uri !== redirectUri || !validClient(clientId, redirectUri) || !code.code_challenge
      || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !secureEqual(pkceChallenge(verifier), code.code_challenge)) {
      return oauthError("invalid_grant", "The authorization code or PKCE verifier is invalid.");
    }
    if (!await consumeOnce(code.jti, code.exp, options)) return oauthError("invalid_grant", "The authorization code has already been used.");
    return issueTokens(code, options);
  }

  if (grantType === "refresh_token") {
    const refresh = decode(String(form.get("refresh_token") ?? ""), "refresh_token", options);
    const resource = requestedResource || refresh?.aud || "";
    if (!validResource(resource, request.url, options)
      || !refresh || refresh.iss !== originFor(request.url, options) || refresh.aud !== resource
      || refresh.client_id !== clientId || !exactScope(refresh.scope, resource, request.url, options)) {
      return oauthError("invalid_grant", "The refresh token is invalid or expired.");
    }
    return issueTokens(refresh, options);
  }

  return oauthError("unsupported_grant_type", "Only authorization_code and refresh_token grants are supported.");
}

export function validActivityAccessToken(token: string, requestUrl: string, options?: OAuthOptions) {
  try {
    if (new URL(requestUrl).pathname !== "/api/activity-mcp") return false;
    const access = decode(token, "access_token", options);
    return Boolean(access
      && access.iss === originFor(requestUrl, options)
      && access.aud === activityMcpResource(requestUrl, options)
      && recognizedClient(access.client_id)
      && exactScope(access.scope, access.aud, requestUrl, options));
  } catch {
    return false;
  }
}

export function validTrainingAccessToken(token: string, requestUrl: string, options?: OAuthOptions) {
  try {
    if (new URL(requestUrl).pathname !== "/api/mcp") return false;
    const access = decode(token, "access_token", options);
    return Boolean(access
      && access.iss === originFor(requestUrl, options)
      && access.aud === trainingMcpResource(requestUrl, options)
      && recognizedClient(access.client_id)
      && access.scope === TRAINING_MCP_SCOPE);
  } catch {
    return false;
  }
}
