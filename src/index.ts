import 'dotenv/config';
import { bot } from './core/bot';
import { startCustomDomainServer } from './core/custom-domain-server';
import { prisma } from './core/prisma';
import {
  startComposer,
  serverComposer,
  keyComposer,
  migrateComposer,
  textComposer,
} from './composers';

bot.use((context, next) => {
  context.prisma = prisma;
  return next();
});

bot.use(startComposer);
bot.use(serverComposer);
bot.use(keyComposer);
bot.use(migrateComposer);
bot.use(textComposer);

bot.catch((error, context) => {
  console.error(`Error for ${context.updateType} ->`, error);
  context
    .reply(`An unexpected error occurred. Please try again later.`)
    .catch((e) => console.error(`Failed to send error message ->`, e));
});

console.log('Bot is starting...');
bot.launch();
const customDomainServer = startCustomDomainServer();

const shutdown = async (signal: 'SIGINT' | 'SIGTERM') => {
  bot.stop(signal);
  customDomainServer.close();
  await prisma.$disconnect();
};

process.once('SIGINT', () => {
  shutdown('SIGINT').catch((error) => {
    console.error('Graceful shutdown failed on SIGINT ->', error);
  });
});
process.once('SIGTERM', () => {
  shutdown('SIGTERM').catch((error) => {
    console.error('Graceful shutdown failed on SIGTERM ->', error);
  });
});
