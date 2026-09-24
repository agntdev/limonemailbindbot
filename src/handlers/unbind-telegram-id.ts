import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { requireOwner } from "../toolkit/index.js";
import { audit, maskEmail, notifyAdmin, removePersistedBinding } from "../email-shared.js";

const composer = new Composer<Ctx>();
composer.command("unbind", async (ctx) => {
  const id = ctx.match?.trim();
  if (!id) {
    if (ctx.session.binding) { await ctx.reply("Tap Unbind in the menu to remove your email."); }
    else await ctx.reply("No email is bound yet. Tap Bind email to add one.");
    return;
  }
  if (!(await requireOwner(ctx as never))) return;
  if (!/^\d+$/.test(id)) { await ctx.reply("Enter a valid Telegram ID."); return; }
  if (!ctx.session.binding || String(ctx.session.binding.telegramId) !== id) { await ctx.reply("No binding was found for that Telegram ID."); return; }
  const b = ctx.session.binding;
  audit(ctx, "unbind", b.email, "admin");
  ctx.session.binding = undefined; ctx.session.token = undefined;
  await removePersistedBinding(ctx, b.telegramId);
  try { await ctx.api.sendMessage(id, "The owner removed your email binding."); } catch { /* the user may have blocked the bot */ }
  await notifyAdmin(ctx, `Binding removed by owner for ${id} (${maskEmail(b.email)}).`);
  await ctx.reply(`Binding removed for Telegram ID ${id}.`);
});
export default composer;
