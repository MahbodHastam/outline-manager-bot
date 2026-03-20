import { Composer, Markup } from 'telegraf';
import { MyContext } from '../types/context';
import { getOrCreateUser } from '../utils/user';
import { keyboards } from '../views/keyboards';
import { serverKeysView } from '../views/messages';
import { USER_STATE } from '../constants/userState';

const composer = new Composer<MyContext>();

const renderManageServersList = async (context: MyContext) => {
  const user = await getOrCreateUser(context);
  if (!user) return;

  const servers = await context.prisma.server.findMany({
    where: { userId: user.telegramId },
  });

  if (servers.length === 0) {
    return context.editMessageText(
      "You haven't added any servers yet.",
      Markup.inlineKeyboard([
        [Markup.button.callback('➕ Add a Server', 'add_server')],
        [Markup.button.callback('🔙 Back to Main Menu', 'go_back_main')],
      ]),
    );
  }

  const serverRows = servers.map((server) => {
    const label = server.alias || new URL(server.apiUrl).hostname;
    return [
      Markup.button.callback(`📡 ${label}`, `select_server_${server.id}`),
      Markup.button.callback('🗑️', `delete_server_${server.id}`),
    ];
  });

  await context.editMessageText(
    'Please select a server to manage:',
    Markup.inlineKeyboard([
      ...serverRows,
      [Markup.button.callback('🔙 Back to Main Menu', 'go_back_main')],
    ]),
  );
};

composer.action('add_server', async (context) => {
  await context.prisma.user.update({
    where: { telegramId: context.from!.id },
    data: { state: USER_STATE.AWAITING_API_URL },
  });
  await context.answerCbQuery();
  await context.editMessageText(
    'Please send me the full API access URL from your Outline Manager. It looks like "`https://<IP>:<PORT>/<SECRET>/`"',
    { parse_mode: 'Markdown', reply_markup: keyboards.backToMain.reply_markup },
  );
});

composer.action('manage_servers', async (context) => {
  await context.answerCbQuery();
  await renderManageServersList(context);
});

composer.action(/select_server_(.+)/, async (context) => {
  await context.answerCbQuery();
  const serverId = parseInt(context.match[1]);
  const user = await getOrCreateUser(context);
  if (!user) return;

  const server = await context.prisma.server.findFirst({
    where: { id: serverId, userId: user.telegramId },
  });
  if (!server)
    return context.editMessageText('Server not found.', keyboards.backToMain);

  await context.prisma.user.update({
    where: { telegramId: user.telegramId },
    data: { selectedServerId: server.id },
  });

  await serverKeysView(context, server);
});

composer.action(/^keys_page_(\d+)_(\d+)$/, async (context) => {
  await context.answerCbQuery();
  const serverId = parseInt(context.match[1]);
  const page = parseInt(context.match[2]);

  const user = await getOrCreateUser(context);
  if (!user) return;

  const server = await context.prisma.server.findFirst({
    where: { id: serverId, userId: user.telegramId },
  });
  if (!server) {
    return context.editMessageText('Server not found.', keyboards.backToMain);
  }

  if (Number.isNaN(page) || page < 0) {
    return serverKeysView(context, server, 0);
  }

  await serverKeysView(context, server, page);
});

composer.action(/^keys_page_current_(\d+)_(\d+)$/, async (context) => {
  await context.answerCbQuery();
});

composer.action(/^keys_page_noop_(\d+)_(\d+)$/, async (context) => {
  await context.answerCbQuery();
});

composer.action(/^delete_server_(\d+)$/, async (context) => {
  await context.answerCbQuery();
  const serverId = parseInt(context.match[1], 10);
  const user = await getOrCreateUser(context);
  if (!user) return;

  const server = await context.prisma.server.findFirst({
    where: { id: serverId, userId: user.telegramId },
  });
  if (!server) {
    return context.editMessageText('Server not found.', keyboards.backToMain);
  }

  const serverLabel = server.alias || new URL(server.apiUrl).hostname;

  await context.editMessageText(
    [
      `<b>Remove this server from the bot?</b>`,
      '',
      `Server: <code>${serverLabel}</code>`,
      '',
      'This only removes the entry from this bot. Keys on your Outline Manager are <b>not</b> deleted.',
    ].join('\n'),
    {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard([
        [
          Markup.button.callback(
            '✅ Yes, remove it',
            `confirm_delete_server_${server.id}`,
          ),
        ],
        [Markup.button.callback('❌ No, keep it', 'manage_servers')],
      ]).reply_markup,
    },
  );
});

composer.action(/^confirm_delete_server_(\d+)$/, async (context) => {
  await context.answerCbQuery();
  const serverId = parseInt(context.match[1], 10);
  const user = await getOrCreateUser(context);
  if (!user) return;

  const result = await context.prisma.server.deleteMany({
    where: { id: serverId, userId: user.telegramId },
  });

  if (result.count === 0) {
    return context.editMessageText(
      'Server not found or already removed.',
      keyboards.backToMain,
    );
  }

  await renderManageServersList(context);
});

composer.action('custom_domain_menu', async (context) => {
  await context.answerCbQuery();
  const user = await getOrCreateUser(context);
  if (!user) return;

  const current = user.customDomain?.trim() || null;
  const customDomainInfo = current
    ? `\n\nYour current custom domain:\n<code>${current}</code>`
    : '\n\nYou have not set a custom domain yet.';

  await context.editMessageText(
    [
      '<b>Custom domain</b>',
      'This URL is used only for <b>your</b> Outline servers (the ones you added in this bot).',
      'Other users are not affected.',
      'Key links look like: <code>https://your-domain/path/&lt;alias&gt;</code>',
      customDomainInfo,
      '',
      'Set or clear it below.',
    ].join('\n'),
    {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard([
        [
          Markup.button.callback(
            '🌐 Set / Update My Domain',
            'set_custom_domain',
          ),
        ],
        [Markup.button.callback('❌ Clear My Domain', 'clear_custom_domain')],
        [Markup.button.callback('🔙 Back to Main Menu', 'go_back_main')],
      ]).reply_markup,
    },
  );
});

composer.action('set_custom_domain', async (context) => {
  await context.answerCbQuery();
  await context.prisma.user.update({
    where: { telegramId: context.from!.id },
    data: { state: USER_STATE.AWAITING_CUSTOM_DOMAIN },
  });

  await context.editMessageText(
    [
      'Send your custom domain <b>base URL</b> (applies only to your servers).',
      '',
      'Example:',
      '<code>https://doomxs-service.fun/vip-user/</code>',
      '',
      'The HTTP server on this bot must be reachable at that host so Outline can resolve each key alias.',
    ].join('\n'),
    {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('🔙 Cancel', 'custom_domain_menu')],
      ]).reply_markup,
    },
  );
});

composer.action('clear_custom_domain', async (context) => {
  await context.answerCbQuery();

  await context.editMessageText(
    'Clear your custom domain? Your key links will use direct URLs only.',
    {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('Yes, clear it', 'confirm_clear_user_domain')],
        [Markup.button.callback('No', 'custom_domain_menu')],
      ]).reply_markup,
    },
  );
});

composer.action('confirm_clear_user_domain', async (context) => {
  await context.answerCbQuery();

  await context.prisma.user.update({
    where: { telegramId: context.from!.id },
    data: { customDomain: null },
  });

  await context.editMessageText('✅ Your custom domain was cleared.', {
    parse_mode: 'HTML',
    reply_markup: Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Back', 'custom_domain_menu')],
    ]).reply_markup,
  });
});

export default composer;
