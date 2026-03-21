import type { User } from '@prisma/client';
import { Composer } from 'telegraf';
import { bot } from '../core/bot';
import OutlineService from '../services/outline.service';
import { MyContext } from '../types/context';
import { getOrCreateUser } from '../utils/user';
import { keyboards } from '../views/keyboards';
import { keyDetailsView } from '../views/messages';
import { USER_STATE } from '../constants/userState';
import { handleMigrateWizardText } from './migrate.composer';

const composer = new Composer<MyContext>();
type EditMessageExtra = Parameters<typeof bot.telegram.editMessageText>[4];

const getIncomingText = (context: MyContext): string | null => {
  const { message } = context;
  if (!message || !('text' in message)) return null;
  return typeof message.text === 'string' ? message.text : null;
};

const handleApiUrlInput = async (context: MyContext, user: User) => {
  const message = getIncomingText(context);
  if (!message) return;

  const tempMessage = await context.reply('Validating URL...');
  const apiUrl = message.trim();

  const editTempMessage = (text: string, extra?: EditMessageExtra) =>
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
    data: { state: USER_STATE.IDLE },
  });
  await editTempMessage('✅ Server added successfully!', keyboards.main);
};

composer.on('text', async (context) => {
  const user = await getOrCreateUser(context);
  if (!user) return;

  if (await handleMigrateWizardText(context, user)) {
    return;
  }

  if (user.state === USER_STATE.AWAITING_API_URL) {
    await handleApiUrlInput(context, user);
    return;
  }

  if (user.state === USER_STATE.AWAITING_CUSTOM_DOMAIN) {
    const incoming =
      (context.message && 'text' in context.message
        ? context.message.text
        : undefined) || '';
    const customDomainRaw = incoming.trim();
    if (!customDomainRaw) {
      await context.reply(
        'No URL provided. Send your custom domain base URL (e.g. https://example.com/path/).',
      );
      return;
    }
    const tempMessage = await context.reply('Saving custom domain...');
    let customDomain = customDomainRaw;
    const editTempMessage = (text: string, extra?: EditMessageExtra) =>
      bot.telegram.editMessageText(
        context.chat!.id,
        tempMessage.message_id,
        context.inlineMessageId,
        text,
        extra,
      );

    try {
      const url = new URL(customDomain);
      customDomain = url.toString();
    } catch {
      return editTempMessage(
        'This does not look like a valid URL. Please try again.',
      );
    }

    await context.prisma.user.update({
      where: { telegramId: user.telegramId },
      data: { state: USER_STATE.IDLE, customDomain },
    });

    await editTempMessage(
      '✅ Custom domain saved. It applies only to your servers in this bot.',
    );
    return;
  }

  if (user.state.startsWith(USER_STATE.RENAMING_KEY_PREFIX)) {
    const incomingName = getIncomingText(context);
    const newName = (incomingName || '').trim();

    if (!newName) {
      await context.reply(
        'Please send a non-empty name for this key, or /start to cancel.',
      );
      return;
    }

    const keyId = user.state.slice(USER_STATE.RENAMING_KEY_PREFIX.length);

    if (!keyId) {
      await context.prisma.user.update({
        where: { telegramId: user.telegramId },
        data: { state: USER_STATE.IDLE },
      });
      await context.reply(
        'No key is currently selected for renaming. Please try again.',
      );
      return;
    }

    if (!user.selectedServerId) {
      await context.prisma.user.update({
        where: { telegramId: user.telegramId },
        data: { state: USER_STATE.IDLE },
      });
      await context.reply(
        'No server is currently selected. Please select a server again.',
      );
      return;
    }

    const server = await context.prisma.server.findUnique({
      where: { id: user.selectedServerId },
    });

    if (!server) {
      await context.prisma.user.update({
        where: { telegramId: user.telegramId },
        data: { state: USER_STATE.IDLE },
      });
      await context.reply(
        'Selected server could not be found. Please select a server again.',
      );
      return;
    }

    const outline = new OutlineService(server.apiUrl);
    const loadingMessage = await context.reply('Renaming key...');
    const success = await outline.renameKey(keyId, newName);

    await context.prisma.user.update({
      where: { telegramId: user.telegramId },
      data: { state: USER_STATE.IDLE },
    });

    try {
      await context.deleteMessage(loadingMessage.message_id);
    } catch {
      // ignore delete failures
    }

    if (!success) {
      await context.reply('❌ Failed to rename the key. Please try again.');
      return;
    }

    await keyDetailsView(context, server, keyId, {
      sendAsNewMessage: true,
      preface: '✅ Key renamed successfully.',
    });
  }
});

export default composer;
