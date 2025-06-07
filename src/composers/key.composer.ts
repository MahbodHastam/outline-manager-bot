import { Composer } from 'telegraf';
import OutlineService from '../services/outline.service';
import { MyContext } from '../types/context';
import { getOrCreateUser } from '../utils/user';
import { keyboards } from '../views/keyboards';
import { keyDetailsView, serverKeysView } from '../views/messages';

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

composer.action(/delete_key_(.+)/, async (context) => {
  const keyId = context.match[1];
  const user = await getOrCreateUser(context);
  if (!user?.selectedServerId)
    return context.answerCbQuery('❌ No server selected!');

  const server = await context.prisma.server.findUnique({
    where: { id: user.selectedServerId },
  });
  if (!server) return context.answerCbQuery('❌ Selected server not found!');

  await context.answerCbQuery(`Deleting key ${keyId}...`);
  const success = await new OutlineService(server.apiUrl).deleteKey(keyId);

  if (success) {
    await serverKeysView(context, server);
  } else {
    await context.answerCbQuery('❌ Failed to delete the key.');
  }
});

composer.action('create_key', async (context) => {
  const user = await getOrCreateUser(context);
  if (!user?.selectedServerId)
    return context.answerCbQuery('❌ No server selected!');

  const server = await context.prisma.server.findUnique({
    where: { id: user.selectedServerId },
  });
  if (!server) return context.answerCbQuery('❌ Selected server not found!');

  await context.answerCbQuery('Creating new key...');
  const newKey = await new OutlineService(server.apiUrl).createKey();

  if (newKey) {
    await context.replyWithHTML(
      `<b>New Key Created</b>\n\nAccess URL:\n<pre>${newKey.accessUrl}</pre>`,
    );
    await serverKeysView(context, server);
  } else {
    await context.answerCbQuery('❌ Failed to create a new key.');
  }
});

export default composer;
