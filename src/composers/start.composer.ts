import { Composer } from 'telegraf';
import { MyContext } from '../types/context';
import { USER_STATE } from '../constants/userState';
import { clearMigrationWizardSession } from '../core/migration-session';
import { getOrCreateUser } from '../utils/user';
import { keyboards } from '../views/keyboards';

const composer = new Composer<MyContext>();

composer.start(async (context) => {
  const user = await getOrCreateUser(context);
  if (!user) return;
  clearMigrationWizardSession(BigInt(context.from!.id));
  await context.prisma.user.update({
    where: { telegramId: context.from!.id },
    data: { state: USER_STATE.IDLE, selectedServerId: null },
  });
  await context.reply(
    `Welcome, ${user.firstName}! I'm your Outline Manager Bot.`,
    keyboards.main,
  );
});

composer.action('go_back_main', async (context) => {
  const user = await getOrCreateUser(context);
  if (!user) return;
  clearMigrationWizardSession(user.telegramId);
  await context.prisma.user.update({
    where: { telegramId: user.telegramId },
    data: { state: USER_STATE.IDLE, selectedServerId: null },
  });
  await context.answerCbQuery();
  await context.editMessageText(
    `Welcome, ${user.firstName}! What would you like to do?`,
    keyboards.main,
  );
});

export default composer;
