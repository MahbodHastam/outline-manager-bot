import { UserState } from '@prisma/client';
import { Composer, Markup } from 'telegraf';
import { MyContext } from '../types/context';
import { getOrCreateUser } from '../utils/user';
import { keyboards } from '../views/keyboards';
import { serverKeysView } from '../views/messages';

const composer = new Composer<MyContext>();

composer.action('add_server', async (context) => {
  await context.prisma.user.update({
    where: { telegramId: context.from!.id },
    data: { state: UserState.AWAITING_API_URL },
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

export default composer;
