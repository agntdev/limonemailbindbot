import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { audit, maskEmail, notifyAdmin, removePersistedBinding } from "../email-shared.js";

registerMainMenuItem({ label: "Unbind", data: "unbind:confirm", order: 40 });
const composer = new Composer<Ctx>();
async function ask(ctx: Ctx): Promise<void> {
  if (!ctx.session.binding) { await ctx.reply("No email is bound yet. Tap Bind email to add one."); return; }
  ctx.session.step = "confirm_unbind";
  await ctx.reply("Remove your bound email?", { reply_markup: inlineKeyboard([[inlineButton("Yes, unbind", "unbind:yes"), inlineButton("Keep it", "unbind:no")]]) });
}
composer.callbackQuery("unbind:confirm", async (ctx) => { await ctx.answerCallbackQuery(); await ask(ctx); });
composer.callbackQuery("unbind:yes", async (ctx) => {
  await ctx.answerCallbackQuery();
  const b = ctx.session.binding;
  if (!b) { await ctx.reply("No email is bound yet. Tap Bind email to add one."); return; }
  audit(ctx, "unbind", b.email, "user");
  ctx.session.binding = undefined; ctx.session.token = undefined; ctx.session.step = undefined;
  await removePersistedBinding(ctx, b.telegramId);
  await notifyAdmin(ctx, `Email unbound by ${ctx.from!.id} (${maskEmail(b.email)}).`);
  await ctx.reply("Your email has been unbound.");
});
composer.callbackQuery("unbind:no", async (ctx) => { await ctx.answerCallbackQuery(); ctx.session.step = undefined; await ctx.editMessageText("Your email remains bound."); });
export { ask };
export default composer;
