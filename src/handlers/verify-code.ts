import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { audit, codePrompt, maskEmail, now, notifyAdmin, persistBinding } from "../email-shared.js";

const composer = new Composer<Ctx>();

async function verify(ctx: Ctx, raw: string): Promise<void> {
  const token = ctx.session.token;
  const code = raw.trim();
  if (!/^\d{6}$/.test(code) || !token || token.used || !ctx.session.binding) {
    await ctx.reply("That code isn’t valid. Check it and try again, or tap Resend.", { reply_markup: { inline_keyboard: [[{ text: "Resend code", callback_data: "verify:resend" }]] } });
    return;
  }
  if (new Date(token.expiresAt).getTime() <= now().getTime()) {
    await ctx.reply("That code has expired. Tap Resend to get a new one.", { reply_markup: { inline_keyboard: [[{ text: "Resend code", callback_data: "verify:resend" }]] } });
    return;
  }
  if (token.code !== code) {
    await ctx.reply("That code isn’t valid. Check it and try again.", { reply_markup: { inline_keyboard: [[{ text: "Enter code", callback_data: "verify:start" }]] } });
    return;
  }
  token.used = true;
  const at = now().toISOString();
  ctx.session.binding.verified = true;
  ctx.session.binding.verifiedAt = at;
  ctx.session.binding.lastUpdated = at;
  await persistBinding(ctx, ctx.session.binding);
  ctx.session.step = undefined;
  audit(ctx, "verify", ctx.session.binding.email, "user");
  await notifyAdmin(ctx, `Email verified for ${ctx.from!.id} (${ctx.session.binding.displayName}), ${maskEmail(ctx.session.binding.email)}.`);
  await ctx.reply("Your email is verified and ready for recovery notifications.");
}

composer.command("verify", async (ctx) => {
  const code = ctx.match?.trim();
  if (!code) {
    ctx.session.step = "code";
    await ctx.reply("Please enter the 6-digit verification code.", { reply_markup: codePrompt() });
    return;
  }
  await verify(ctx, code);
});

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "code") return next();
  ctx.session.step = undefined;
  await verify(ctx, ctx.message.text);
});

composer.callbackQuery("verify:resend", async (ctx) => {
  await ctx.answerCallbackQuery();
  const binding = ctx.session.binding;
  if (!binding || binding.verified) {
    await ctx.reply("There is no pending verification. Tap Bind email to begin.");
    return;
  }
  const current = now();
  const recent = (ctx.session.resendTimes ?? []).filter((item) => current.getTime() - new Date(item).getTime() < 15 * 60 * 1000);
  if (recent.length >= 3) {
    await ctx.reply("You’ve reached the resend limit. Please wait a few minutes and try again.");
    return;
  }
  const code = String((crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000)).padStart(6, "0");
  ctx.session.token = { code, used: false, createdAt: current.toISOString(), expiresAt: new Date(current.getTime() + 15 * 60 * 1000).toISOString() };
  ctx.session.resendTimes = [...recent, current.toISOString()];
  audit(ctx, "resend", binding.email, "user");
  const { deliverCode } = await import("../email-shared.js");
  if (!(await deliverCode(ctx, binding.email, code))) {
    await ctx.reply("We couldn’t deliver a new code. Ask the owner to check email delivery, then try again later.");
    return;
  }
  await ctx.reply("A new verification code was sent. It expires in 15 minutes.", { reply_markup: { inline_keyboard: [[{ text: "Enter code", callback_data: "verify:start" }]] } });
});

export { verify };
export default composer;
