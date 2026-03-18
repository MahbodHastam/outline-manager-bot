import type { Server } from '@prisma/client';
import { Markup } from 'telegraf';
import OutlineService, { OutlineKey } from '../services/outline.service';
import { MyContext } from '../types/context';
import { keyboards } from './keyboards';
import { getActualAccessUrl, getDisplayAccessUrl } from '../utils/accessUrl';
import { getOrCreateKeyAlias } from '../utils/keyAlias';

const KEYS_PAGE_SIZE = 10;

export const serverKeysView = async (
  context: MyContext,
  server: Server,
  page = 0,
) => {
  const outline = new OutlineService(server.apiUrl);
  const loadingMessage = await context.reply(
    'Fetching access keys from your Outline server, please wait...',
  );
  const keys = await outline.getKeys();
  try {
    await context.deleteMessage(loadingMessage.message_id);
  } catch {
    // ignore delete failures
  }

  if (!keys) {
    await context.answerCbQuery('❌ Failed to fetch keys from the server.');
    return context.editMessageText(
      'Could not connect to your Outline server. Please check the URL and server status.',
      keyboards.backToServers,
    );
  }

  const totalPages = Math.max(1, Math.ceil(keys.length / KEYS_PAGE_SIZE));
  const clampedPage = Math.min(Math.max(page, 0), totalPages - 1);

  const pageKeys =
    keys.length > 0
      ? keys.slice(
          clampedPage * KEYS_PAGE_SIZE,
          clampedPage * KEYS_PAGE_SIZE + KEYS_PAGE_SIZE,
        )
      : [];

  const keyButtons = pageKeys.map((key: OutlineKey) => [
    Markup.button.callback(key.name || `Key ${key.id}`, `view_key_${key.id}`),
    Markup.button.callback('✏️', `rename_key_${key.id}`),
    Markup.button.callback('❌', `delete_key_${key.id}`),
  ]);

  const firstPage = 0;
  const lastPage = totalPages - 1;
  const prevPage = Math.max(firstPage, clampedPage - 1);
  const nextPage = Math.min(lastPage, clampedPage + 1);

  const canGoPrev = clampedPage > firstPage;
  const canGoNext = clampedPage < lastPage;
  const noop = `keys_page_noop_${server.id}_${clampedPage}`;

  const paginationRow = [
    Markup.button.callback(
      '⏮️',
      canGoPrev ? `keys_page_${server.id}_${firstPage}` : noop,
    ),
    Markup.button.callback(
      '◀️',
      canGoPrev ? `keys_page_${server.id}_${prevPage}` : noop,
    ),
    Markup.button.callback(
      `${clampedPage + 1}/${totalPages}`,
      `keys_page_current_${server.id}_${clampedPage}`,
    ),
    Markup.button.callback(
      '▶️',
      canGoNext ? `keys_page_${server.id}_${nextPage}` : noop,
    ),
    Markup.button.callback(
      '⏭️',
      canGoNext ? `keys_page_${server.id}_${lastPage}` : noop,
    ),
  ];

  const fullKeyboard = Markup.inlineKeyboard([
    ...keyButtons,
    paginationRow,
    [Markup.button.callback('➕ Create New Key', 'create_key')],
    [Markup.button.callback('🌐 Custom Domain Settings', 'custom_domain_menu')],
    [Markup.button.callback('🔙 Back to Server List', 'manage_servers')],
  ]);

  const serverIdentifier = server.alias || new URL(server.apiUrl).hostname;
  const customDomainInfo = server.customDomain
    ? `\n🌐 Custom Domain: <code>${server.customDomain || 'Not Set'}</code>`
    : '';

  await context.editMessageText(
    [
      `Managing <b>${serverIdentifier}</b>${customDomainInfo}`,
      totalPages > 1 ? `\nPage: ${clampedPage + 1}/${totalPages}` : '',
    ].join(''),
    {
      ...fullKeyboard,
      parse_mode: 'HTML',
    },
  );
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

  const keyAlias = server.customDomain
    ? await getOrCreateKeyAlias(context.prisma, server, key.id)
    : undefined;
  const displayAccessUrl = getDisplayAccessUrl(key.accessUrl, server, keyAlias);
  const directAccessUrl = getActualAccessUrl(key.accessUrl);

  const detailsText = [
    `<b>Key Details</b>`,
    `<b>Name:</b> ${key.name || 'Not set'}`,
    `<b>ID:</b> ${key.id}`,
    server.customDomain
      ? `\nAccess URL (Custom Domain):\n<pre>${displayAccessUrl}</pre>\n\nAccess URL (Direct):\n<pre>${directAccessUrl}</pre>`
      : `\nAccess URL:\n<pre>${directAccessUrl}</pre>`,
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
