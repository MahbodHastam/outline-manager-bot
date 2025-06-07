import { User, UserState } from '@prisma/client';
import { Composer } from 'telegraf';
import { bot } from '../core/bot';
import OutlineService from '../services/outline.service';
import { MyContext } from '../types/context';
import { getOrCreateUser } from '../utils/user';
import { keyboards } from '../views/keyboards';

const composer = new Composer<MyContext>();

const handleApiUrlInput = async (context: MyContext, user: User) => {
  const message = (context.message as any)?.text as string;
  if (!message) return;

  const tempMessage = await context.reply('Validating URL...');
  const apiUrl = message.trim();

  const editTempMessage = (text: string, extra?: any) =>
    bot.telegram.editMessageText(
      context.chat!.id,
      tempMessage.message_id,
      context.inlineMessageId,
      text,
      extra,
    );

  if (!apiUrl.startsWith('http')) {
    return editTempMessage(
      'This does not look like a valid Outline API URL. Please try again.',
    );
  }

  const outline = new OutlineService(apiUrl);
  if (!(await outline.validate())) {
    return editTempMessage(
      'Could not connect to this API URL. Please check if it is correct and the server is online.',
    );
  }

  await context.prisma.server.create({
    data: { apiUrl, userId: user.telegramId },
  });
  await context.prisma.user.update({
    where: { telegramId: user.telegramId },
    data: { state: UserState.IDLE },
  });
  await editTempMessage('✅ Server added successfully!', keyboards.main);
};

composer.on('text', async (context) => {
  const user = await getOrCreateUser(context);
  if (!user || user.state !== UserState.AWAITING_API_URL) return;

  await handleApiUrlInput(context, user);
});

export default composer;
