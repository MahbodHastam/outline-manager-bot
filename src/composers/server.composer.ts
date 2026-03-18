import { Composer, Markup } from 'telegraf';
import { MyContext } from '../types/context';
import { getOrCreateUser } from '../utils/user';
import { keyboards } from '../views/keyboards';
import { serverKeysView } from '../views/messages';
import { USER_STATE } from '../constants/userState';

const composer = new Composer<MyContext>();

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

  const serverButtons = servers.map((server) => [
    Markup.button.callback(
      `📡 ${server.alias || new URL(server.apiUrl).hostname}`,
      `select_server_${server.id}`,
    ),
  ]);

  await context.editMessageText(
    'Please select a server to manage:',
    Markup.inlineKeyboard([
      ...serverButtons,
      [Markup.button.callback('🔙 Back to Main Menu', 'go_back_main')],
    ]),
  );
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

composer.action('custom_domain_menu', async (context) => {
  await context.answerCbQuery();
  const user = await getOrCreateUser(context);
  if (!user?.selectedServerId) {
    return context.editMessageText(
      'Please select a server first.',
      keyboards.backToServers,
    );
  }

  const server = await context.prisma.server.findUnique({
    where: { id: user.selectedServerId },
  });
  if (!server)
    return context.editMessageText('Server not found.', keyboards.backToMain);

  const serverIdentifier = server.alias || new URL(server.apiUrl).hostname;
  const customDomainInfo = server.customDomain
    ? `\n\nCurrent custom domain:\n<code>${server.customDomain}</code>`
    : '\n\nNo custom domain is currently set.';

  await context.editMessageText(
    [
      `Custom domain settings for <b>${serverIdentifier}</b>.`,
      customDomainInfo,
      '',
      'You can set or update the custom domain, or clear it completely.',
    ].join('\n'),
    {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard([
        [
          Markup.button.callback(
            '🌐 Set / Update Custom Domain',
            'set_custom_domain',
          ),
        ],
        [
          Markup.button.callback(
            '❌ Clear Custom Domain',
            'clear_custom_domain',
          ),
        ],
        [
          Markup.button.callback(
            '🔙 Back to Keys',
            `select_server_${server.id}`,
          ),
        ],
      ]).reply_markup,
    },
  );
});

composer.action('set_custom_domain', async (context) => {
  await context.answerCbQuery();
  const user = await getOrCreateUser(context);
  if (!user?.selectedServerId)
    return context.editMessageText(
      'Please select a server first.',
      keyboards.backToServers,
    );

  const updatedUser = await context.prisma.user.update({
    where: { telegramId: user.telegramId },
    data: { state: USER_STATE.AWAITING_CUSTOM_DOMAIN },
  });

  console.log('updatedUser', updatedUser);

  await context.editMessageText(
    [
      'Please send the custom domain URL you want to use for this server.',
      '',
      'For example:',
      '<code>https://example.com</code>',
      '',
      'This URL will be used instead of the server IP when generating access links.',
    ].join('\n'),
    {
      parse_mode: 'HTML',
      reply_markup: keyboards.backToServers.reply_markup,
    },
  );
});

composer.action('clear_custom_domain', async (context) => {
  await context.answerCbQuery();
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
    return context.editMessageText('Server not found.', keyboards.backToMain);

  await context.editMessageText(
    'Are you sure you want to clear the custom domain for this server?',
    {
      reply_markup: Markup.inlineKeyboard([
        [
          Markup.button.callback(
            'Yes, delete it',
            `confirm_clear_custom_domain_${server.id}`,
          ),
        ],
        [Markup.button.callback('No', 'custom_domain_menu')],
      ]).reply_markup,
    },
  );
});

composer.action(/confirm_clear_custom_domain_(.+)/, async (context) => {
  await context.answerCbQuery();
  const serverId = parseInt(context.match[1]);
  const user = await getOrCreateUser(context);
  if (!user)
    return context.editMessageText(
      'Please start the bot again.',
      keyboards.backToMain,
    );

  const server = await context.prisma.server.update({
    where: { id: serverId },
    data: { customDomain: null },
  });

  await context.editMessageText('✅ Custom domain cleared for this server.', {
    parse_mode: 'HTML',
    reply_markup: keyboards.backToServers.reply_markup,
  });

  await serverKeysView(context, server);
});

export default composer;
