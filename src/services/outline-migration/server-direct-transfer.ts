import type { SshEndpoint } from '../../core/migration-session';
import { shSingleQuote } from './docker-recreate';

/** Bracket IPv6 literals for ssh user@host. */
export const sshBracketHost = (host: string): string => {
  const h = host.trim();
  if (h.includes(':') && !h.startsWith('[')) return `[${h}]`;
  return h;
};

const sshLogin = (ep: SshEndpoint): string =>
  `${ep.username}@${sshBracketHost(ep.host)}`;

const sshPortArgs = (ep: SshEndpoint): string =>
  ep.port !== 22 ? `-p ${ep.port} ` : '';

const commonSshOpts =
  '-o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null ' +
  '-o ConnectTimeout=60 -o ServerAliveInterval=30 -o ServerAliveCountMax=6';

/** Encode password so the remote bash script avoids fragile quoting. */
const passB64 = (password: string): string =>
  Buffer.from(password, 'utf8').toString('base64');

const scriptToB64 = (script: string): string =>
  Buffer.from(script, 'utf8').toString('base64');

/**
 * Multiline bash for the NEW host: ensure sshpass, test SSH to OLD, then stream
 * `docker save` on OLD into `docker load` here. Payload never touches the bot.
 */
export const buildNewHostDockerLoadScript = (
  old: SshEndpoint,
  images: string[],
): string => {
  const saveScript = [
    'set -euo pipefail',
    `docker save ${images.map((i) => shSingleQuote(i)).join(' ')}`,
  ].join('\n');
  const innerB64 = scriptToB64(saveScript);
  const passB = passB64(old.password);
  const login = sshLogin(old);
  const port = sshPortArgs(old);

  return [
    'set -euo pipefail',
    'export DEBIAN_FRONTEND=noninteractive',
    'if ! command -v sshpass >/dev/null 2>&1; then',
    '  if sudo -n true 2>/dev/null; then',
    '    sudo apt-get update -qq && sudo apt-get install -y -qq sshpass',
    '  elif [ "$(id -u)" -eq 0 ]; then',
    '    apt-get update -qq && apt-get install -y -qq sshpass',
    '  else',
    '    echo "sshpass is required on the new server for direct old→new transfer. Run: sudo apt-get install -y sshpass" >&2',
    '    exit 127',
    '  fi',
    'fi',
    `export MIGRATE_SSH_PASS=$(echo ${shSingleQuote(passB)} | base64 -d)`,
    `echo "ssh: testing reachability of old host ${login}..."`,
    `sshpass -p "$MIGRATE_SSH_PASS" ssh ${port}${commonSshOpts} ${shSingleQuote(login)} ${shSingleQuote('true')}`,
    `echo "ssh: OK. Streaming docker save (old) → docker load (new); this is direct between servers."`,
    `sshpass -p "$MIGRATE_SSH_PASS" ssh ${port}${commonSshOpts} ${shSingleQuote(login)} ${shSingleQuote(`echo ${shSingleQuote(innerB64)} | base64 -d | bash`)} | docker load`,
    'unset MIGRATE_SSH_PASS',
  ].join('\n');
};

/**
 * Multiline bash for the NEW host: stream `tar` from OLD into local `/opt`.
 */
export const buildNewHostTarRestoreScript = (old: SshEndpoint): string => {
  const tarScript = ['set -euo pipefail', 'tar czf - -C /opt outline'].join(
    '\n',
  );
  const innerB64 = scriptToB64(tarScript);
  const passB = passB64(old.password);
  const login = sshLogin(old);
  const port = sshPortArgs(old);

  return [
    'set -euo pipefail',
    'export DEBIAN_FRONTEND=noninteractive',
    'if ! command -v sshpass >/dev/null 2>&1; then',
    '  if sudo -n true 2>/dev/null; then',
    '    sudo apt-get update -qq && sudo apt-get install -y -qq sshpass',
    '  elif [ "$(id -u)" -eq 0 ]; then',
    '    apt-get update -qq && apt-get install -y -qq sshpass',
    '  else',
    '    echo "sshpass is required. Run: sudo apt-get install -y sshpass" >&2',
    '    exit 127',
    '  fi',
    'fi',
    `export MIGRATE_SSH_PASS=$(echo ${shSingleQuote(passB)} | base64 -d)`,
    `echo "ssh: streaming /opt/outline archive from old host (direct)..."`,
    'mkdir -p /opt',
    `sshpass -p "$MIGRATE_SSH_PASS" ssh ${port}${commonSshOpts} ${shSingleQuote(login)} ${shSingleQuote(`echo ${shSingleQuote(innerB64)} | base64 -d | bash`)} | tar xzf - -C /opt`,
    'unset MIGRATE_SSH_PASS',
  ].join('\n');
};

/** Single-line wrapper: decode script with bash on the remote host. */
export const wrapBashScriptForExec = (script: string): string => {
  const b64 = Buffer.from(script, 'utf8').toString('base64');
  return `echo ${shSingleQuote(b64)} | base64 -d | bash`;
};
