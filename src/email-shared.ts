import type { Ctx } from "./bot.js";
import { adminChatId } from "./toolkit/index.js";

type Binding = NonNullable<import("./bot.js").Session["binding"]>;
type DomainRedis = { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<unknown>; del(key: string): Promise<unknown>; sadd(key: string, member: string): Promise<unknown>; srem(key: string, member: string): Promise<unknown>; smembers(key: string): Promise<string[]> };

export const now = (): Date => new Date();
export const TTL_MS = 15 * 60 * 1000;
export const MAX_RESENDS = 3;
export function displayName(ctx: Ctx): string { return ctx.from?.first_name ?? "Telegram user"; }
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "hidden email";
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visible}${"•".repeat(Math.max(1, local.length - visible.length))}@${domain}`;
}
export function validEmail(value: string): boolean { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(value.trim()) && value.length <= 254; }
export function makeCode(): string { const bytes = new Uint32Array(1); crypto.getRandomValues(bytes); return String(bytes[0] % 1_000_000).padStart(6, "0"); }
export function audit(ctx: Ctx, event: string, email: string, actor: string): void {
  const list = ctx.session.audit ?? (ctx.session.audit = []);
  list.push({ event, timestamp: now().toISOString(), email, actor });
  if (list.length > 200) list.splice(0, list.length - 200);
}
export async function notifyAdmin(ctx: Ctx, message: string): Promise<boolean> {
  const target = adminChatId(ctx as unknown as { env?: Record<string, unknown> });
  if (!target) return false;
  try { await ctx.api.sendMessage(target, message); return true; } catch { return false; }
}
export async function deliverCode(ctx: Ctx, email: string, code: string): Promise<boolean> {
  const env = (ctx as Ctx & { env?: Record<string, unknown> }).env;
  const url = typeof env?.EMAIL_RELAY_URL === "string" ? env.EMAIL_RELAY_URL : undefined;
  const key = typeof env?.EMAIL_RELAY_KEY === "string" ? env.EMAIL_RELAY_KEY : undefined;
  if (!url || !key) return false;
  try {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ to: email, subject: "Your verification code", text: `Your verification code is ${code}. It expires in 15 minutes.` }) });
    return response.ok;
  } catch { return false; }
}
export const emailPrompt = () => ({ force_reply: true as const, input_field_placeholder: "name@example.com" });
export const codePrompt = () => ({ force_reply: true as const, input_field_placeholder: "6-digit code" });

async function redisFor(ctx: Ctx): Promise<DomainRedis | undefined> {
  const runtimeEnv = (ctx as Ctx & { env?: Record<string, unknown> }).env;
  const url = typeof runtimeEnv?.REDIS_URL === "string" ? runtimeEnv.REDIS_URL : (typeof process !== "undefined" ? process.env.REDIS_URL : undefined);
  if (!url) return undefined;
  try {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const imported = require("ioredis") as { default?: new (url: string, opts?: object) => DomainRedis; Redis?: new (url: string, opts?: object) => DomainRedis };
    const Redis = imported.default ?? imported.Redis;
    return Redis ? new Redis(url, { maxRetriesPerRequest: null }) : undefined;
  } catch { return undefined; }
}

/** Durable domain index: one record key per Telegram user plus an explicit set index. */
export async function persistBinding(ctx: Ctx, binding: Binding): Promise<void> {
  const redis = await redisFor(ctx);
  if (!redis) return;
  const id = String(binding.telegramId);
  await redis.set(`email:binding:${id}`, JSON.stringify(binding));
  await redis.sadd("email:binding:index", id);
}
export async function removePersistedBinding(ctx: Ctx, telegramId: number): Promise<void> {
  const redis = await redisFor(ctx);
  if (!redis) return;
  const id = String(telegramId);
  await redis.del(`email:binding:${id}`);
  await redis.srem("email:binding:index", id);
}
export async function listPersistedBindings(ctx: Ctx): Promise<Binding[]> {
  const redis = await redisFor(ctx);
  if (!redis) return ctx.session.binding ? [ctx.session.binding] : [];
  const ids = await redis.smembers("email:binding:index");
  const values = await Promise.all(ids.map((id) => redis.get(`email:binding:${id}`)));
  return values.flatMap((value) => { try { return value ? [JSON.parse(value) as Binding] : []; } catch { return []; } });
}
