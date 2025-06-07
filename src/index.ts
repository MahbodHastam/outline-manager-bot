import 'dotenv/config';
import { bot } from './core/bot';
import { prisma } from './core/prisma';
import {
  startComposer,
  serverComposer,
  keyComposer,
  textComposer,
} from './composers';

bot.use((context, next) => {
  context.prisma = prisma;
  return next();
});

bot.use(startComposer);
bot.use(serverComposer);
bot.use(keyComposer);
bot.use(textComposer);

bot.catch((error, context) => {
  console.error(`Error for ${context.updateType} ->`, error);
  context
    .reply(`An unexpected error occurred. Please try again later.`)
    .catch((e) => console.error(`Failed to send error message ->`, e));
});

console.log('Bot is starting...');
bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
