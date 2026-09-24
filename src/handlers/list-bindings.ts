import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { requireOwner } from "../toolkit/index.js";
import { listPersistedBindings, maskEmail } from "../email-shared.js";

const composer = new Composer<Ctx>();
composer.command("list_bindings", async (ctx) => {
  if (!(await requireOwner(ctx as never))) return;
  const bindings = await listPersistedBindings(ctx);
  if (bindings.length === 0) { await ctx.reply("No bindings yet."); return; }
  const lines = bindings.map((b) => `${b.telegramId} · ${b.displayName} · ${maskEmail(b.email)} · ${b.verified ? "verified" : "pending"}`);
  await ctx.reply(`Current bindings\n${lines.join("\n")}`);
});
export default composer;
