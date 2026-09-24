import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { registerMainMenuItem } from "../toolkit/index.js";
import { emailPrompt } from "../email-shared.js";

registerMainMenuItem({ label: "Bind email", data: "bind:start", order: 10 });
const composer = new Composer<Ctx>();
composer.callbackQuery("bind:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "email";
  await ctx.reply("Please enter your email or use /bind <email>", { reply_markup: emailPrompt() });
});
export default composer;
