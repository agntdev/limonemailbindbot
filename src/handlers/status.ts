import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { maskEmail } from "../email-shared.js";

registerMainMenuItem({ label: "Check status", data: "status:show", order: 30 });
const composer = new Composer<Ctx>();
async function show(ctx: Ctx): Promise<void> {
  const b = ctx.session.binding;
  if (!b) {
    await ctx.reply("No email is bound yet. Tap Bind email to add one.", { reply_markup: inlineKeyboard([[inlineButton("Bind email", "bind:start")]]) });
    return;
  }
  const verifiedAt = b.verifiedAt ? `\nVerified at: ${b.verifiedAt}` : "";
  await ctx.reply(`Telegram ID: ${b.telegramId}\nEmail: ${maskEmail(b.email)}\nVerified: ${b.verified ? "yes" : "no"}${verifiedAt}`, { reply_markup: inlineKeyboard([[inlineButton("Enter code", "verify:start"), inlineButton("Unbind", "unbind:confirm")]]) });
}
composer.command("status", (ctx) => show(ctx));
composer.callbackQuery("status:show", async (ctx) => { await ctx.answerCallbackQuery(); await show(ctx); });
export default composer;
