import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { registerMainMenuItem } from "../toolkit/index.js";
import { codePrompt } from "../email-shared.js";

registerMainMenuItem({ label: "Enter code", data: "verify:start", order: 20 });
const composer = new Composer<Ctx>();
composer.callbackQuery("verify:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "code";
  await ctx.reply("Please enter the 6-digit verification code.", { reply_markup: codePrompt() });
});
export default composer;
