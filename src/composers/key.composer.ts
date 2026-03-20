import { Composer, Markup } from 'telegraf';
import OutlineService from '../services/outline.service';
import { MyContext } from '../types/context';
import { getOrCreateUser } from '../utils/user';
import { keyboards } from '../views/keyboards';
import { keyDetailsView, serverKeysView } from '../views/messages';
import { getActualAccessUrl, getDisplayAccessUrl } from '../utils/accessUrl';
import { getCustomDomainBaseForOwner } from '../utils/userCustomDomain';
import { getOrCreateKeyAlias } from '../utils/keyAlias';
import { USER_STATE } from '../constants/userState';

const composer = new Composer<MyContext>();

composer.action(/view_key_(.+)/, async (context) => {
  await context.answerCbQuery();
  const keyId = context.match[1];
  const user = await getOrCreateUser(context);
  if (!user?.selectedServerId)
    return context.editMessageText(
      'Please select a server first.',
      keyboards.backToServers,
    );

  const server = await context.prisma.server.findUnique({
    where: { id: user.selectedServerId },
  });
  if (!server)
    return context.editMessageText(
      'Selected server not found.',
      keyboards.backToServers,
    );

  await keyDetailsView(context, server, keyId);
});

composer.action(/rename_key_(.+)/, async (context) => {
  await context.answerCbQuery();
  const keyId = context.match[1];
  const user = await getOrCreateUser(context);
  if (!user?.selectedServerId)
    return context.editMessageText(
      'Please select a server first.',
      keyboards.backToServers,
    );

  await context.prisma.user.update({
    where: { telegramId: user.telegramId },
    data: { state: `${USER_STATE.RENAMING_KEY_PREFIX}${keyId}` },
  });

  await context.reply(
    'Please send the new name for this key. Send /start to cancel.',
  );
});

composer.action(/^delete_key_(.+)$/, async (context) => {
  await context.answerCbQuery();
  const keyId = context.match[1];
  const user = await getOrCreateUser(context);
  if (!user?.selectedServerId)
    return context.answerCbQuery('❌ No server selected!');

  const server = await context.prisma.server.findUnique({
    where: { id: user.selectedServerId },
  });
  if (!server) return context.answerCbQuery('❌ Selected server not found!');

  try {
    await context.deleteMessage();
  } catch {
    // ignore delete failures
  }

  await context.reply(
    'Are you sure you want to delete this access key?',
    Markup.inlineKeyboard([
      [Markup.button.callback('Yes, delete it', `confirm_delete_key_${keyId}`)],
      [Markup.button.callback('No', 'cancel_delete_key')],
    ]),
  );
});

composer.action(/^confirm_delete_key_(.+)$/, async (context) => {
  await context.answerCbQuery();
  const keyId = context.match[1];
  const user = await getOrCreateUser(context);
  if (!user?.selectedServerId)
    return context.answerCbQuery('❌ No server selected!', {
      show_alert: true,
    });

  const server = await context.prisma.server.findUnique({
    where: { id: user.selectedServerId },
  });
  if (!server)
    return context.answerCbQuery('❌ Selected server not found!', {
      show_alert: true,
    });

  const loadingMessage = await context.reply(
    'Deleting key from your Outline server, please wait...',
  );
  const success = await new OutlineService(server.apiUrl).deleteKey(keyId);
  try {
    await context.deleteMessage(loadingMessage.message_id);
  } catch {
    // ignore delete failures
  }

  if (success) {
    await context.prisma.accessKeyAlias.deleteMany({
      where: {
        serverId: server.id,
        outlineKeyId: keyId,
      },
    });
    await serverKeysView(context, server);
    await context.answerCbQuery('✅ Key deleted successfully.', {
      show_alert: true,
    });
  } else {
    await context.answerCbQuery('❌ Failed to delete the key.', {
      show_alert: true,
    });
  }
});

composer.action('cancel_delete_key', async (context) => {
  await context.answerCbQuery();
  const user = await getOrCreateUser(context);
  if (!user?.selectedServerId) {
    return context.editMessageText(
      '❌ No server selected.',
      keyboards.backToMain,
    );
  }

  const server = await context.prisma.server.findUnique({
    where: { id: user.selectedServerId },
  });
  if (!server) {
    return context.editMessageText(
      '❌ Selected server not found.',
      keyboards.backToMain,
    );
  }

  await serverKeysView(context, server);
});

composer.action('create_key', async (context) => {
  const user = await getOrCreateUser(context);
  if (!user?.selectedServerId)
    return context.answerCbQuery('❌ No server selected!');

  const server = await context.prisma.server.findUnique({
    where: { id: user.selectedServerId },
  });
  if (!server) return context.answerCbQuery('❌ Selected server not found!');

  const loadingMessage = await context.reply(
    'Creating a new access key on your Outline server, please wait...',
  );
  const newKey = await new OutlineService(server.apiUrl).createKey();
  try {
    await context.deleteMessage(loadingMessage.message_id);
  } catch {
    // ignore delete failures
  }

  if (newKey) {
    const ownerDomain = await getCustomDomainBaseForOwner(
      context.prisma,
      server.userId,
    );
    const keyAlias = ownerDomain
      ? await getOrCreateKeyAlias(context.prisma, server, newKey.id)
      : undefined;
    const displayAccessUrl = getDisplayAccessUrl(
      newKey.accessUrl,
      ownerDomain,
      keyAlias,
    );
    const directAccessUrl = getActualAccessUrl(newKey.accessUrl);
    await context.replyWithHTML(
      ownerDomain
        ? `<b>New Key Created</b>\n\nAccess URL (Custom Domain):\n<pre>${displayAccessUrl}</pre>\n\nAccess URL (Direct):\n<pre>${directAccessUrl}</pre>`
        : `<b>New Key Created</b>\n\nAccess URL:\n<pre>${directAccessUrl}</pre>`,
    );
    await serverKeysView(context, server);
  } else {
    await context.answerCbQuery('❌ Failed to create a new key.');
  }
});

export default composer;
