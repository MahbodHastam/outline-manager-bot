export type SshEndpoint = {
  host: string;
  port: number;
  username: string;
  password: string;
};

export type MigrationWizardSession = {
  serverId: number;
  oldHost?: string;
  oldPort?: number;
  oldUsername?: string;
  oldPassword?: string;
  newHost?: string;
  newPort?: number;
  newUsername?: string;
  newPassword?: string;
};

type SessionStore = Map<bigint, MigrationWizardSession>;

const wizardSessions: SessionStore = new Map();

/** Users currently running a migration job (SSH). */
export const migrationLocks: Set<bigint> = new Set();

export const getMigrationWizardSession = (
  telegramId: bigint,
): MigrationWizardSession | undefined => wizardSessions.get(telegramId);

export const setMigrationWizardSession = (
  telegramId: bigint,
  session: MigrationWizardSession,
) => {
  wizardSessions.set(telegramId, session);
};

export const patchMigrationWizardSession = (
  telegramId: bigint,
  patch: Partial<MigrationWizardSession>,
) => {
  const prev = wizardSessions.get(telegramId);
  if (!prev) return;
  wizardSessions.set(telegramId, { ...prev, ...patch });
};

export const clearMigrationWizardSession = (telegramId: bigint) => {
  wizardSessions.delete(telegramId);
};

export const endpointsFromSession = (
  session: MigrationWizardSession,
): { old: SshEndpoint; new: SshEndpoint } | null => {
  const {
    oldHost,
    oldPort,
    oldUsername,
    oldPassword,
    newHost,
    newPort,
    newUsername,
    newPassword,
  } = session;
  if (
    !oldHost ||
    oldPort == null ||
    !oldUsername ||
    !oldPassword ||
    !newHost ||
    newPort == null ||
    !newUsername ||
    !newPassword
  ) {
    return null;
  }
  return {
    old: {
      host: oldHost,
      port: oldPort,
      username: oldUsername,
      password: oldPassword,
    },
    new: {
      host: newHost,
      port: newPort,
      username: newUsername,
      password: newPassword,
    },
  };
};

export const parseHostPort = (
  input: string,
  defaultPort = 22,
): { host: string; port: number } | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']');
    if (end === -1) return null;
    const host = trimmed.slice(1, end);
    const rest = trimmed.slice(end + 1);
    if (rest.startsWith(':')) {
      const port = Number(rest.slice(1));
      if (!Number.isFinite(port) || port < 1 || port > 65535) return null;
      return { host, port };
    }
    return { host, port: defaultPort };
  }
  const lastColon = trimmed.lastIndexOf(':');
  if (lastColon > 0) {
    const hostPart = trimmed.slice(0, lastColon);
    const portPart = trimmed.slice(lastColon + 1);
    if (/^\d+$/.test(portPart)) {
      const port = Number(portPart);
      if (port < 1 || port > 65535) return null;
      return { host: hostPart, port };
    }
  }
  return { host: trimmed, port: defaultPort };
};
