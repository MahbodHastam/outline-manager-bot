import { Telegraf } from 'telegraf';
import { MyContext } from '../types/context';

if (!process.env.BOT_TOKEN) {
  throw new Error(`BOT_TOKEN is not defined in the env vars.`);
}

export const bot = new Telegraf<MyContext>(process.env.BOT_TOKEN);
