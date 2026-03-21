import { Composer, Markup } from 'telegraf';
import type { PrismaClient, User } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { USER_STATE } from '../constants/userState';
import { bot } from '../core/bot';
import type { SshEndpoint } from '../core/migration-session';
import {
  clearMigrationWizardSession,
  endpointsFromSession,
  getMigrationWizardSession,
  migrationLocks,
  parseHostPort,
  patchMigrationWizardSession,
  setMigrationWizardSession,
} from '../core/migration-session';
import { getOrCreateUser } from '../utils/user';
import { MyContext } from '../types/context';
import OutlineService from '../services/outline.service';
import {
  MIGRATION_TOTAL_STEPS,
  runOutlineMigration,
  type MigratePhaseInfo,
} from '../services/outline-migration/migrate-outline';
import {
  createThrottledStatusEditor,
  type MigrationProgressRef,
  type ThrottledStatusEditor,
} from '../services/outline-migration/throttled-status';

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const abortControllers = new Map<bigint, AbortController>();

/**
 * Telegraf wraps handlers in ~90s p-timeout; migration can take much longer.
 * Run this in the background so the callback_query handler returns immediately.
 */
const runOutlineMigrationJob = async (args: {
  chatId: number;
  telegramId: bigint;
  serverId: number;
  old: SshEndpoint;
  new: SshEndpoint;
  ac: AbortController;
  editor: ThrottledStatusEditor;
  progressRef: MigrationProgressRef;
  prisma: PrismaClient;
}) => {
  const {
    chatId,
    telegramId,
    serverId,
    old: oldEp,
    new: newEp,
    ac,
    editor,
    progressRef,
    prisma,
  } = args;

  try {
    const newApiUrl = await runOutlineMigration({
      old: oldEp,
      new: newEp,
      signal: ac.signal,
      onLog: (line) => {
        console.log(`[outline-migration] ${line}`);
        editor.push(line);
      },
      onPhase: (info: MigratePhaseInfo) => {
        progressRef.step = info.step;
        progressRef.totalSteps = info.totalSteps;
        progressRef.phaseLabel = info.label;
        editor.touch();
      },
    });

    try {
      await prisma.server.update({
        where: { id: serverId },
        data: { apiUrl: newApiUrl },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        editor.push(
          `❌ Database: this Management API URL is already used by another server: ${newApiUrl}`,
        );
        await editor.finish();
        await prisma.user.update({
          where: { telegramId },
          data: { state: USER_STATE.IDLE },
        });
        await bot.telegram.sendMessage(
          chatId,
          'Fix the duplicate in the bot or edit access.txt on the server, then update the server entry manually.',
        );
        return;
      }
      throw error;
    }

    const outline = new OutlineService(newApiUrl);
    const reachable = await outline.validate();
    if (reachable) {
      editor.push('✅ Bot verified the new Management API over HTTPS.');
    } else {
      editor.push(
        '⚠️ Bot could not reach the new Management API (TLS/firewall/routing). access.txt on the new server was still updated.',
      );
    }

    editor.push('✅ Migration completed.');
    await editor.finish();

    await prisma.user.update({
      where: { telegramId },
      data: { state: USER_STATE.IDLE },
    });

    await bot.telegram.sendMessage(
      chatId,
      [
        '<b>Migration complete</b>',
        '',
        'Updated <code>/opt/outline/access.txt</code> on the new server and this bot’s <code>apiUrl</code>.',
        '',
        `<code>${escapeHtml(newApiUrl)}</code>`,
      ].join('\n'),
      { parse_mode: 'HTML' },
    );
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    const msg = error instanceof Error ? error.message : String(error);
    if (name === 'AbortError' || msg === 'Aborted') {
      editor.push('⛔ Migration stopped by user.');
    } else {
      editor.push(`❌ ${msg}`);
    }
    try {
      await editor.finish();
    } catch (finishErr) {
      console.error('Migration status editor finish failed ->', finishErr);
    }
  } finally {
    abortControllers.delete(telegramId);
    migrationLocks.delete(telegramId);
  }
};

const composer = new Composer<MyContext>();

const getText = (context: MyContext): string | null => {
  const { message } = context;
  if (!message || !('text' in message)) return null;
  return typeof message.text === 'string' ? message.text : null;
};

composer.action(/^migrate_server_(\d+)$/, async (context) => {
  await context.answerCbQuery();
  const serverId = parseInt(context.match[1], 10);
  const user = await getOrCreateUser(context);
  if (!user) return;

  if (migrationLocks.has(user.telegramId)) {
    return context.reply(
      'A migration is already running for your account. Wait for it to finish or cancel it first.',
    );
  }

  const server = await context.prisma.server.findFirst({
    where: { id: serverId, userId: user.telegramId },
  });
  if (!server) {
    return context.reply('Server not found.');
  }

  clearMigrationWizardSession(user.telegramId);
  setMigrationWizardSession(user.telegramId, { serverId });
  await context.prisma.user.update({
    where: { telegramId: user.telegramId },
    data: { state: USER_STATE.MIGRATE_AWAIT_OLD_HOST },
  });

  await context.reply(
    [
      '<b>Migrate Outline server (SSH)</b>',
      '',
      'You will enter SSH details for the <b>current</b> host and the <b>new</b> Ubuntu LTS host (22.04 or newer, e.g. 24.04).',
      'The <b>new</b> server must reach the <b>old</b> server on its SSH port: Docker images and <code>/opt/outline</code> stream <b>directly old→new</b> (the bot does not relay that traffic).',
      'Use an account that can run <code>docker</code> and access <code>/opt/outline</code> without interactive sudo (often <code>root</code> or passwordless sudo).',
      '',
      '<b>Security:</b> Telegram keeps chat history. Use a <b>temporary SSH password</b> and change it after migration.',
      '',
      'Send the <b>old server</b> SSH target: hostname or IP, optional port (e.g. <code>203.0.113.10</code> or <code>vpn.example.com:2222</code>).',
    ].join('\n'),
    {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('Cancel', 'migrate_cancel')],
      ]).reply_markup,
    },
  );
});

composer.action('migrate_cancel', async (context) => {
  await context.answerCbQuery();
  const user = await getOrCreateUser(context);
  if (!user) return;
  clearMigrationWizardSession(user.telegramId);
  await context.prisma.user.update({
    where: { telegramId: user.telegramId },
    data: { state: USER_STATE.IDLE },
  });
  await context.reply('Migration cancelled.', {
    reply_markup: Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Main menu', 'go_back_main')],
    ]).reply_markup,
  });
});

composer.action('migrate_abort', async (context) => {
  const user = await getOrCreateUser(context);
  if (!user) return;
  const ac = abortControllers.get(user.telegramId);
  if (ac) {
    ac.abort();
    await context.answerCbQuery('Stopping migration…');
  } else {
    await context.answerCbQuery('No active migration.');
  }
});

composer.action(/^migrate_run_(\d+)$/, async (context) => {
  await context.answerCbQuery();
  const serverId = parseInt(context.match[1], 10);
  const user = await getOrCreateUser(context);
  if (!user) return;

  if (migrationLocks.has(user.telegramId)) {
    return context.reply('A migration is already in progress.');
  }

  const session = getMigrationWizardSession(user.telegramId);
  if (!session || session.serverId !== serverId) {
    await context.prisma.user.update({
      where: { telegramId: user.telegramId },
      data: { state: USER_STATE.IDLE },
    });
    return context.reply(
      'Session expired. Start migration again from the server menu.',
    );
  }

  const endpoints = endpointsFromSession(session);
  if (!endpoints) {
    return context.reply('Missing SSH details. Start the wizard again.');
  }

  const server = await context.prisma.server.findFirst({
    where: { id: serverId, userId: user.telegramId },
  });
  if (!server) {
    clearMigrationWizardSession(user.telegramId);
    await context.prisma.user.update({
      where: { telegramId: user.telegramId },
      data: { state: USER_STATE.IDLE },
    });
    return context.reply('Server not found.');
  }

  clearMigrationWizardSession(user.telegramId);
  await context.prisma.user.update({
    where: { telegramId: user.telegramId },
    data: { state: USER_STATE.IDLE },
  });

  const ac = new AbortController();
  abortControllers.set(user.telegramId, ac);
  migrationLocks.add(user.telegramId);

  const statusMsg = await context.reply(
    ['Migration status', 'Connecting…', '', 'Logs will appear here.'].join(
      '\n',
    ),
    {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('⛔ Stop migration', 'migrate_abort')],
      ]).reply_markup,
    },
  );

  const progressRef: MigrationProgressRef = {
    startedAt: Date.now(),
    step: 1,
    totalSteps: MIGRATION_TOTAL_STEPS,
    phaseLabel: 'Starting…',
  };

  const editor = createThrottledStatusEditor(
    context.chat!.id,
    statusMsg.message_id,
    1000,
    'Migration status',
    progressRef,
  );

  const chatId = context.chat!.id;
  const telegramId = user.telegramId;
  const prisma = context.prisma;

  void runOutlineMigrationJob({
    chatId,
    telegramId,
    serverId,
    old: endpoints.old,
    new: endpoints.new,
    ac,
    editor,
    progressRef,
    prisma,
  }).catch((err) => {
    console.error('Outline migration job crashed ->', err);
    abortControllers.delete(telegramId);
    migrationLocks.delete(telegramId);
  });
});

export const handleMigrateWizardText = async (
  context: MyContext,
  user: User,
): Promise<boolean> => {
  const text = getText(context);
  if (!text) return false;

  const replyKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('Cancel migration', 'migrate_cancel')],
  ]).reply_markup;

  if (user.state === USER_STATE.MIGRATE_PENDING_START) {
    await context.reply(
      'Use the <b>Start migration</b> or <b>Cancel</b> buttons on the previous message.',
      { parse_mode: 'HTML', reply_markup: replyKeyboard },
    );
    return true;
  }

  const session = getMigrationWizardSession(user.telegramId);
  const wizardStatesNeedingSession = new Set<string>([
    USER_STATE.MIGRATE_AWAIT_OLD_HOST,
    USER_STATE.MIGRATE_AWAIT_OLD_USER,
    USER_STATE.MIGRATE_AWAIT_OLD_PASSWORD,
    USER_STATE.MIGRATE_AWAIT_NEW_HOST,
    USER_STATE.MIGRATE_AWAIT_NEW_USER,
    USER_STATE.MIGRATE_AWAIT_NEW_PASSWORD,
    USER_STATE.MIGRATE_PENDING_START,
  ]);

  if (!session) {
    if (wizardStatesNeedingSession.has(user.state)) {
      await context.prisma.user.update({
        where: { telegramId: user.telegramId },
        data: { state: USER_STATE.IDLE },
      });
      await context.reply(
        'Migration session expired. Open the server from the menu and start again.',
      );
      return true;
    }
    return false;
  }

  switch (user.state) {
    case USER_STATE.MIGRATE_AWAIT_OLD_HOST: {
      const parsed = parseHostPort(text);
      if (!parsed) {
        await context.reply(
          'Could not parse host (and optional port). Try again.',
          {
            reply_markup: replyKeyboard,
          },
        );
        return true;
      }
      patchMigrationWizardSession(user.telegramId, {
        oldHost: parsed.host,
        oldPort: parsed.port,
      });
      await context.prisma.user.update({
        where: { telegramId: user.telegramId },
        data: { state: USER_STATE.MIGRATE_AWAIT_OLD_USER },
      });
      await context.reply('Send the <b>SSH username</b> for the old server.', {
        parse_mode: 'HTML',
        reply_markup: replyKeyboard,
      });
      return true;
    }
    case USER_STATE.MIGRATE_AWAIT_OLD_USER: {
      const u = text.trim();
      if (!u) {
        await context.reply('Username cannot be empty.', {
          reply_markup: replyKeyboard,
        });
        return true;
      }
      patchMigrationWizardSession(user.telegramId, { oldUsername: u });
      await context.prisma.user.update({
        where: { telegramId: user.telegramId },
        data: { state: USER_STATE.MIGRATE_AWAIT_OLD_PASSWORD },
      });
      await context.reply(
        'Send the <b>SSH password</b> for the old server (consider a temporary password).',
        { parse_mode: 'HTML', reply_markup: replyKeyboard },
      );
      return true;
    }
    case USER_STATE.MIGRATE_AWAIT_OLD_PASSWORD: {
      patchMigrationWizardSession(user.telegramId, { oldPassword: text });
      await context.prisma.user.update({
        where: { telegramId: user.telegramId },
        data: { state: USER_STATE.MIGRATE_AWAIT_NEW_HOST },
      });
      await context.reply(
        'Send the <b>new server</b> SSH target (Ubuntu LTS 22.04+): hostname or IP, optional port.',
        { parse_mode: 'HTML', reply_markup: replyKeyboard },
      );
      return true;
    }
    case USER_STATE.MIGRATE_AWAIT_NEW_HOST: {
      const parsed = parseHostPort(text);
      if (!parsed) {
        await context.reply(
          'Could not parse host (and optional port). Try again.',
          {
            reply_markup: replyKeyboard,
          },
        );
        return true;
      }
      patchMigrationWizardSession(user.telegramId, {
        newHost: parsed.host,
        newPort: parsed.port,
      });
      await context.prisma.user.update({
        where: { telegramId: user.telegramId },
        data: { state: USER_STATE.MIGRATE_AWAIT_NEW_USER },
      });
      await context.reply('Send the <b>SSH username</b> for the new server.', {
        parse_mode: 'HTML',
        reply_markup: replyKeyboard,
      });
      return true;
    }
    case USER_STATE.MIGRATE_AWAIT_NEW_USER: {
      const u = text.trim();
      if (!u) {
        await context.reply('Username cannot be empty.', {
          reply_markup: replyKeyboard,
        });
        return true;
      }
      patchMigrationWizardSession(user.telegramId, { newUsername: u });
      await context.prisma.user.update({
        where: { telegramId: user.telegramId },
        data: { state: USER_STATE.MIGRATE_AWAIT_NEW_PASSWORD },
      });
      await context.reply(
        'Send the <b>SSH password</b> for the new server (consider a temporary password).',
        { parse_mode: 'HTML', reply_markup: replyKeyboard },
      );
      return true;
    }
    case USER_STATE.MIGRATE_AWAIT_NEW_PASSWORD: {
      patchMigrationWizardSession(user.telegramId, { newPassword: text });
      const updated = getMigrationWizardSession(user.telegramId);
      if (!updated || !endpointsFromSession(updated)) {
        await context.reply(
          'Something went wrong; start again from the server menu.',
        );
        clearMigrationWizardSession(user.telegramId);
        await context.prisma.user.update({
          where: { telegramId: user.telegramId },
          data: { state: USER_STATE.IDLE },
        });
        return true;
      }
      await context.prisma.user.update({
        where: { telegramId: user.telegramId },
        data: { state: USER_STATE.MIGRATE_PENDING_START },
      });
      await context.reply(
        [
          '<b>Ready to migrate</b>',
          '',
          `<b>Old:</b> ${updated.oldUsername}@${updated.oldHost}:${updated.oldPort}`,
          `<b>New:</b> ${updated.newUsername}@${updated.newHost}:${updated.newPort} (Ubuntu LTS 22.04+)`,
          '',
          'This will stop Outline on the old host, stream Docker images and <code>/opt/outline</code> to the new host, and recreate containers there.',
        ].join('\n'),
        {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard([
            [
              Markup.button.callback(
                '▶️ Start migration',
                `migrate_run_${updated.serverId}`,
              ),
            ],
            [Markup.button.callback('Cancel', 'migrate_cancel')],
          ]).reply_markup,
        },
      );
      return true;
    }
    default:
      return false;
  }
};

export default composer;
