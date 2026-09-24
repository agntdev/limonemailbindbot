import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { audit, deliverCode, displayName, emailPrompt, makeCode, maskEmail, now, TTL_MS, validEmail, notifyAdmin, persistBinding } from "../email-shared.js";

const composer = new Composer<Ctx>();

async function begin(ctx: Ctx, email: string): Promise<void> {
  const clean = email.trim().toLowerCase();
  if (!validEmail(clean)) {
    await ctx.reply("That email address doesn’t look right. Please check it and try again.", { reply_markup: emailPrompt() });
    return;
  }
  const current = ctx.session.binding;
  if (current?.verified && current.email === clean) {
    await ctx.reply(`This email is already verified: ${maskEmail(clean)}.`);
    return;
  }
  const created = now();
  const code = makeCode();
  ctx.session.binding = current ?? { telegramId: ctx.from!.id, displayName: displayName(ctx), email: clean, verified: false, verifiedAt: null, createdAt: created.toISOString(), lastUpdated: created.toISOString() };
  ctx.session.binding.email = clean;
  ctx.session.binding.verified = false;
  ctx.session.binding.verifiedAt = null;
  ctx.session.binding.lastUpdated = created.toISOString();
  ctx.session.token = { code, createdAt: created.toISOString(), expiresAt: new Date(created.getTime() + TTL_MS).toISOString(), used: false };
  ctx.session.resendTimes = [];
  await persistBinding(ctx, ctx.session.binding);
  audit(ctx, "bind", clean, "user");
  const delivered = await deliverCode(ctx, clean, code);
  if (!delivered) {
    await notifyAdmin(ctx, `Email delivery is unavailable for ${ctx.from!.id}.`);
    await ctx.reply("Your email is saved, but delivery isn’t set up yet. Ask the owner to configure email delivery, then tap Resend.", { reply_markup: { inline_keyboard: [[{ text: "Resend code", callback_data: "verify:resend" }]] } });
    return;
  }
  await ctx.reply("A verification code was sent to your email. It expires in 15 minutes.", { reply_markup: { inline_keyboard: [[{ text: "Enter code", callback_data: "verify:start" }]] } });
}

composer.command("bind", async (ctx) => {
  const email = ctx.match?.trim();
  if (!email) {
    ctx.session.step = "email";
    await ctx.reply("Please enter your email or use /bind <email>", { reply_markup: emailPrompt() });
    return;
  }
  await begin(ctx, email);
});

composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "email") return next();
  ctx.session.step = undefined;
  await begin(ctx, ctx.message.text);
});

export { begin };
export default composer;
