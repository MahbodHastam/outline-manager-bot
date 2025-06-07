import { UserState } from '@prisma/client';
import { Composer } from 'telegraf';
import { MyContext } from '../types/context';
import { getOrCreateUser } from '../utils/user';
import { keyboards } from '../views/keyboards';

const composer = new Composer<MyContext>();

composer.start(async (context) => {
  const user = await getOrCreateUser(context);
  if (!user) return;
  await context.prisma.user.update({
    where: { telegramId: context.from!.id },
    data: { state: UserState.IDLE, selectedServerId: null },
  });
  await context.reply(
    `Welcome, ${user.firstName}! I'm your Outline Manager Bot.`,
    keyboards.main,
  );
});

composer.action('go_back_main', async (context) => {
  const user = await getOrCreateUser(context);
  if (!user) return;
  await context.prisma.user.update({
    where: { telegramId: user.telegramId },
    data: { state: UserState.IDLE, selectedServerId: null },
  });
  await context.answerCbQuery();
  await context.editMessageText(
    `Welcome, ${user.firstName}! What would you like to do?`,
    keyboards.main,
  );
});

export default composer;
