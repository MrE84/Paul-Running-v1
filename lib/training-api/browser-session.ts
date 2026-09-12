import { createHmac, timingSafeEqual } from "node:crypto";

export const ANALYSIS_COOKIE = "paul-analysis-session";
export const SESSION_SECONDS = 12 * 60 * 60;
export function equalSecret(actual: string, expected: string) {
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function createBrowserSession(secret: string, now = Date.now()) {
  const expires = String(Math.floor(now / 1000) + SESSION_SECONDS);
  return `${expires}.${createHmac("sha256", secret).update(`analysis-session:${expires}`).digest("hex")}`;
}
export function validBrowserSession(value: string | undefined, secret: string, now = Date.now()) {
  if (!value) return false;
  const [expires, signature, extra] = value.split(".");
  const seconds = Number(expires);
  if (extra || !/^\d+$/.test(expires) || !Number.isFinite(seconds) || seconds <= now / 1000 || seconds > now / 1000 + SESSION_SECONDS + 1 || !signature) return false;
  const expected = createHmac("sha256", secret).update(`analysis-session:${expires}`).digest("hex");
  return equalSecret(signature, expected);
}
