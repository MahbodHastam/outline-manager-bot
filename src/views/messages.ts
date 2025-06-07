import { Server } from '@prisma/client';
import { Markup } from 'telegraf';
import OutlineService, { OutlineKey } from '../services/outline.service';
import { MyContext } from '../types/context';
import { keyboards } from './keyboards';

export const serverKeysView = async (context: MyContext, server: Server) => {
  const outline = new OutlineService(server.apiUrl);
  const keys = await outline.getKeys();

  if (!keys) {
    await context.answerCbQuery('❌ Failed to fetch keys from the server.');
    return context.editMessageText(
      'Could not connect to your Outline server. Please check the URL and server status.',
      keyboards.backToServers,
    );
  }

  const keyButtons = keys.map((key: OutlineKey) => [
    Markup.button.callback(key.name || `Key ${key.id}`, `view_key_${key.id}`),
    Markup.button.callback(`❌`, `delete_key_${key.id}`),
  ]);

  const fullKeyboard = Markup.inlineKeyboard([
    ...keyButtons,
    [Markup.button.callback('➕ Create New Key', 'create_key')],
    [Markup.button.callback('🔙 Back to Server List', 'manage_servers')],
  ]);

  const serverIdentifier = server.alias || new URL(server.apiUrl).hostname;
  await context.editMessageText(`Managing <b>${serverIdentifier}</b>`, {
    ...fullKeyboard,
    parse_mode: 'HTML',
  });
};

export const keyDetailsView = async (
  context: MyContext,
  server: Server,
  keyId: string,
) => {
  const outline = new OutlineService(server.apiUrl);
  const keys = await outline.getKeys();
  const key = keys?.find((k) => k.id === keyId);

  if (!key) {
    await context.answerCbQuery('❌ Key not found or could not be fetched.');
    return serverKeysView(context, server);
  }

  const detailsText = [
    `<b>Key Details</b>`,
    `<b>Name:</b> ${key.name || 'Not set'}`,
    `<b>ID:</b> ${key.id}`,
    `\nAccess URL:`,
    `<pre>${key.accessUrl}</pre>`,
  ].join('\n');

  await context.editMessageText(detailsText, {
    parse_mode: 'HTML',
    reply_markup: Markup.inlineKeyboard([
      [
        Markup.button.callback(
          '🔙 Back to Key List',
          `select_server_${server.id}`,
        ),
      ],
    ]).reply_markup,
  });
};
