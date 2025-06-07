import { Markup } from 'telegraf';

export const keyboards = {
  main: Markup.inlineKeyboard([
    [Markup.button.callback('➕ Add a Server', 'add_server')],
    [Markup.button.callback('🖥️ Manage Servers', 'manage_servers')],
  ]),
  backToMain: Markup.inlineKeyboard([
    [Markup.button.callback('🔙 Back to Main Menu', 'go_back_main')],
  ]),
  backToServers: Markup.inlineKeyboard([
    [Markup.button.callback('🔙 Back to Server List', 'manage_servers')],
  ]),
};
