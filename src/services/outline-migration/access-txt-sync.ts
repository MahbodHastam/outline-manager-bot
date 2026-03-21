import type { Client } from 'ssh2';
import type { SshEndpoint } from '../../core/migration-session';
import OutlineService from '../outline.service';
import { execSsh } from './ssh-exec';
import { shSingleQuote } from './docker-recreate';

const OPT_OUTLINE_ROOT = '/opt/outline';

const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;

export type AccessTxtCredentials = {
  certSha256: string;
  apiUrl: string;
};

const ACCESS_PATHS = [
  '/opt/outline/access.txt',
  '/opt/outline/persisted-state/access.txt',
];

/** Outline Shadowbox persisted server config (hostname for access keys / advertising). */
export const SHADOWBOX_SERVER_CONFIG_PATH =
  '/opt/outline/persisted-state/shadowbox_server_config.json';

export const parseAccessTxt = (raw: string): AccessTxtCredentials => {
  const t = raw.trim();
  if (!t) {
    throw new Error('access.txt is empty');
  }
  if (t.startsWith('{')) {
    const j = JSON.parse(t) as { apiUrl?: string; certSha256?: string };
    if (j.apiUrl && j.certSha256) {
      return { certSha256: j.certSha256.trim(), apiUrl: j.apiUrl.trim() };
    }
  }
  let certSha256 = '';
  let apiUrl = '';
  for (const line of raw.split('\n')) {
    const c = line.match(/^certSha256:\s*(.+)\s*$/i);
    const a = line.match(/^apiUrl:\s*(.+)\s*$/i);
    if (c) certSha256 = c[1].trim();
    if (a) apiUrl = a[1].trim();
  }
  if (certSha256 && apiUrl) {
    return { certSha256, apiUrl };
  }
  throw new Error(
    'Could not parse access.txt (expected JSON or certSha256:/apiUrl: lines)',
  );
};

/** Build new management API URL: same port, path, and trailing slash as `baseUrl`, new host. */
export const replaceApiUrlHost = (baseUrl: string, newHost: string): string => {
  const trimmed = baseUrl.trim();
  const u = new URL(trimmed);
  u.hostname = newHost.replace(/^\[|\]$/g, '');
  let out = u.toString();
  if (trimmed.endsWith('/')) {
    if (!out.endsWith('/')) out += '/';
  } else {
    out = out.replace(/\/+$/, '');
  }
  return out;
};

/**
 * Host strings to replace under /opt/outline (longest first). Uses old SSH target
 * and the hostname from the pre-migrate management `apiUrl` (may differ, e.g. IP vs DNS).
 */
export const buildOutlineHostReplacementNeedles = (
  oldSsh: SshEndpoint,
  managementApiUrl: string,
): string[] => {
  const seen = new Set<string>();
  const add = (s: string) => {
    const t = s.trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
  };

  let sshH = oldSsh.host.trim();
  if (sshH.startsWith('[') && sshH.endsWith(']')) sshH = sshH.slice(1, -1);
  add(sshH);
  if (sshH.includes(':') && !sshH.includes('.')) {
    add(`[${sshH}]`);
  }

  try {
    const u = new URL(managementApiUrl.trim());
    const uh = u.hostname;
    add(uh);
    if (uh.includes(':') && !uh.includes('.')) {
      add(`[${uh}]`);
    }
  } catch {
    /* ignore bad URL */
  }

  const list = [...seen];
  list.sort((a, b) => b.length - a.length);
  return list;
};

/** Dedupe, add bracketed IPv6 variants, longest-first for safe multi-needle replace. */
const mergeHostNeedles = (...groups: string[][]): string[] => {
  const seen = new Set<string>();
  const add = (raw: string) => {
    const t = raw.trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    if (t.includes(':') && !t.includes('.')) {
      const br = `[${t}]`;
      if (!seen.has(br)) seen.add(br);
    }
  };
  for (const g of groups) {
    for (const x of g) add(x);
  }
  const list = [...seen];
  list.sort((a, b) => b.length - a.length);
  return list;
};

/**
 * Public + local IPs reported on the old host (helps when SSH used a different address than
 * the one stored in Outline files).
 */
const gatherOldServerIpNeedles = async (
  oldConn: Client,
  options?: { signal?: AbortSignal; onLog?: (line: string) => void },
): Promise<string[]> => {
  const log = options?.onLog ?? (() => {});
  const r = await execSsh(
    oldConn,
    `(curl -4sSf --max-time 12 https://api.ipify.org 2>/dev/null || true); printf '\\n'; hostname -I 2>/dev/null || true`,
    { signal: options?.signal, timeoutMs: 25000 },
  );
  const parts = r.stdout
    .split(/\s+/g)
    .map((x) => x.trim())
    .filter(Boolean);
  const out = new Set<string>();
  for (const p of parts) {
    if (IPV4_RE.test(p) && !p.startsWith('127.')) {
      out.add(p);
      continue;
    }
    if (p.includes(':') && !p.startsWith('fe80:')) {
      out.add(p);
    }
  }
  const list = [...out];
  if (list.length > 0) {
    log(
      `Old host IP(s) from OS (also searched under /opt/outline): ${list.join(', ')}`,
    );
  }
  return list;
};

const serializeAccessTxt = (c: AccessTxtCredentials): string =>
  `${JSON.stringify({ certSha256: c.certSha256, apiUrl: c.apiUrl })}\n`;

/**
 * Prefer a literal IP from SSH target; otherwise ask the new host for its public IP,
 * then a local primary IP, then fall back to the SSH hostname.
 */
export const resolveManagementHostForUrl = async (
  conn: Client,
  sshHost: string,
  options?: { signal?: AbortSignal; onLog?: (line: string) => void },
): Promise<string> => {
  const h = sshHost.trim();
  const log = options?.onLog ?? (() => {});

  if (IPV4_RE.test(h)) {
    log(`Using new server IPv4 from SSH target: ${h}`);
    return h;
  }
  if (h.startsWith('[') && h.endsWith(']')) {
    const inner = h.slice(1, -1);
    log(`Using new server host from SSH target: ${inner}`);
    return inner;
  }
  if (h.includes(':') && !h.includes('.')) {
    log(`Using new server IPv6 from SSH target: ${h}`);
    return h;
  }

  log(
    'Resolving public IPv4 on new server (SSH target is not a literal IP)...',
  );
  const pub = await execSsh(
    conn,
    `(curl -4sSf --max-time 15 https://api.ipify.org || curl -4sSf --max-time 15 https://ifconfig.me || true) | head -c 64`,
    { signal: options?.signal, timeoutMs: 25000 },
  );
  const pubIp = pub.stdout.trim();
  if (IPV4_RE.test(pubIp)) {
    log(`Using public IPv4 from new server: ${pubIp}`);
    return pubIp;
  }

  log('Public IP lookup failed; trying first local IPv4 on new server...');
  const loc = await execSsh(
    conn,
    `hostname -I 2>/dev/null | awk '{print $1}'`,
    {
      signal: options?.signal,
      timeoutMs: 15000,
    },
  );
  const locIp = loc.stdout.trim();
  if (IPV4_RE.test(locIp) && !locIp.startsWith('127.')) {
    log(`Using primary local IPv4 on new server: ${locIp}`);
    return locIp;
  }

  log(`Falling back to SSH hostname for API URL: ${h}`);
  return h;
};

export const readAccessTxtFromNewHost = async (
  conn: Client,
  options?: { signal?: AbortSignal },
): Promise<{ path: string; content: string }> => {
  for (const path of ACCESS_PATHS) {
    const r = await execSsh(
      conn,
      `test -r ${shSingleQuote(path)} && cat ${shSingleQuote(path)}`,
      { signal: options?.signal, timeoutMs: 30000 },
    );
    if (r.code === 0 && r.stdout.trim()) {
      return { path, content: r.stdout };
    }
  }
  throw new Error(
    `Could not read access.txt (tried ${ACCESS_PATHS.join(', ')}). Is Outline installed on the new host?`,
  );
};

export const writeUtf8FileOnNewHost = async (
  conn: Client,
  targetPath: string,
  utf8Body: string,
  options?: { signal?: AbortSignal },
): Promise<void> => {
  const b64 = Buffer.from(utf8Body, 'utf8').toString('base64');
  const cmd = `echo ${shSingleQuote(b64)} | base64 -d > ${shSingleQuote(targetPath)} && chmod 0644 ${shSingleQuote(targetPath)}`;
  const r = await execSsh(conn, cmd, {
    signal: options?.signal,
    timeoutMs: 60000,
  });
  if (r.code !== 0) {
    throw new Error(
      `Failed to write ${targetPath} on new host (exit ${r.code}): ${r.stderr}`,
    );
  }
};

export const writeAccessTxtOnNewHost = async (
  conn: Client,
  targetPath: string,
  credentials: AccessTxtCredentials,
  options?: { signal?: AbortSignal },
): Promise<void> => {
  await writeUtf8FileOnNewHost(
    conn,
    targetPath,
    serializeAccessTxt(credentials),
    options,
  );
};

/**
 * Replaces every occurrence of known old-server host strings with `newHost` in all UTF-8 text
 * files under `/opt/outline` (skips binary / non-UTF-8). Runs on the new host via Python 3.
 */
export const replaceOldHostRefsUnderOptOutline = async (
  conn: Client,
  needles: string[],
  newHost: string,
  options?: { signal?: AbortSignal; onLog?: (line: string) => void },
): Promise<void> => {
  const log = options?.onLog ?? (() => {});

  const filtered = needles.filter((n) => {
    if (n === newHost) return false;
    if (
      newHost.includes(':') &&
      !newHost.includes('.') &&
      n === `[${newHost}]`
    ) {
      return false;
    }
    return true;
  });
  if (filtered.length === 0) {
    log('No old host strings to replace under /opt/outline (skipped).');
    return;
  }

  const payload = {
    needles: filtered,
    newHost,
    root: OPT_OUTLINE_ROOT,
  };
  const b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');

  const py = [
    'import base64, json, os, sys',
    `p = json.loads(base64.b64decode("""${b64}"""))`,
    'needles = [n for n in p["needles"] if isinstance(n, str) and n]',
    'needles.sort(key=len, reverse=True)',
    'new_host, root = p["newHost"], p["root"]',
    'changed = scanned = 0',
    'for dirpath, _, filenames in os.walk(root):',
    '    for fn in filenames:',
    '        path = os.path.join(dirpath, fn)',
    '        scanned += 1',
    '        try:',
    '            with open(path, "rb") as f:',
    '                raw = f.read()',
    '        except OSError:',
    '            continue',
    '        if not raw or b"\\x00" in raw:',
    '            continue',
    '        try:',
    '            text = raw.decode("utf-8")',
    '        except UnicodeDecodeError:',
    '            continue',
    '        if not any(n in text for n in needles):',
    '            continue',
    '        orig = text',
    '        for n in needles:',
    '            text = text.replace(n, new_host)',
    '        if text == orig:',
    '            continue',
    '        try:',
    '            with open(path, "w", encoding="utf-8", newline="") as f:',
    '                f.write(text)',
    '        except OSError as e:',
    '            sys.stderr.write(f"write failed {path}: {e}\\n")',
    '            sys.exit(1)',
    '        changed += 1',
    'print(f"outline-host-replace: scanned={scanned} files_changed={changed}")',
  ].join('\n');

  const r = await execSsh(conn, `python3 -c ${shSingleQuote(py)}`, {
    signal: options?.signal,
    timeoutMs: 600_000,
    onStdoutLine: log,
    onStderrLine: log,
  });
  if (r.code !== 0) {
    throw new Error(
      `Replacing old host references under ${OPT_OUTLINE_ROOT} failed (exit ${r.code}): ${r.stderr || r.stdout}`,
    );
  }
};

/**
 * Sets `hostname` in shadowbox_server_config.json to match the new server (same value as access URLs).
 * Skips quietly if the file is missing.
 */
export const syncShadowboxServerConfigHostname = async (
  conn: Client,
  hostname: string,
  options?: { signal?: AbortSignal; onLog?: (line: string) => void },
): Promise<void> => {
  const log = options?.onLog ?? (() => {});
  const path = SHADOWBOX_SERVER_CONFIG_PATH;
  const r = await execSsh(
    conn,
    `test -r ${shSingleQuote(path)} && cat ${shSingleQuote(path)}`,
    { signal: options?.signal, timeoutMs: 30000 },
  );
  if (r.code !== 0 || !r.stdout.trim()) {
    log(`No readable ${path} — skipped shadowbox hostname update.`);
    return;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(r.stdout) as Record<string, unknown>;
  } catch {
    throw new Error(`${path} is not valid JSON; cannot update hostname.`);
  }

  const prev =
    typeof parsed.hostname === 'string'
      ? parsed.hostname
      : String(parsed.hostname ?? '');
  parsed.hostname = hostname;
  const out = `${JSON.stringify(parsed)}\n`;

  log(
    `Updating Shadowbox hostname in ${path}: ${prev || '(none)'} → ${hostname}`,
  );
  await writeUtf8FileOnNewHost(conn, path, out, { signal: options?.signal });
  log(`Wrote ${path}`);
};

export type SyncAccessTxtParams = {
  newConn: Client;
  newSsh: SshEndpoint;
  /** Used to find old IP/hostname strings under /opt/outline to replace with the new host. */
  oldSsh: SshEndpoint;
  /** Still connected during step 6 so we can discover extra IPs on the old host. */
  oldConn: Client;
  signal?: AbortSignal;
  onLog: (line: string) => void;
};

/**
 * Reads access.txt on the new host, swaps the API hostname for the resolved new-server IP/host,
 * rewrites persisted files under `/opt/outline`, then calls the Management API
 * `PUT server/hostname-for-access-keys`, then `docker restart shadowbox` on the new host so
 * Shadowbox reloads persisted state cleanly.
 * Returns the new management API URL for the database.
 */
export const syncAccessTxtAndBuildNewApiUrl = async (
  params: SyncAccessTxtParams,
): Promise<string> => {
  const { newConn, newSsh, oldSsh, oldConn, signal, onLog } = params;

  const hostForUrl = await resolveManagementHostForUrl(newConn, newSsh.host, {
    signal,
    onLog,
  });

  const { path, content } = await readAccessTxtFromNewHost(newConn, { signal });
  onLog(`Found Outline credentials at ${path}`);

  const parsed = parseAccessTxt(content);
  const needles = mergeHostNeedles(
    buildOutlineHostReplacementNeedles(oldSsh, parsed.apiUrl),
    await gatherOldServerIpNeedles(oldConn, { signal, onLog }),
  );
  onLog(
    `Replacing old host string(s) under ${OPT_OUTLINE_ROOT}: ${needles.join(', ')} → ${hostForUrl}`,
  );
  await replaceOldHostRefsUnderOptOutline(newConn, needles, hostForUrl, {
    signal,
    onLog,
  });

  const newApiUrl = replaceApiUrlHost(parsed.apiUrl, hostForUrl);

  const credentials = {
    certSha256: parsed.certSha256,
    apiUrl: newApiUrl,
  };

  onLog(
    `Updating apiUrl host → ${hostForUrl} (management URL for bot & Outline Manager)`,
  );
  await writeAccessTxtOnNewHost(newConn, path, credentials, { signal });
  onLog(`Wrote ${path}`);

  const canonical = '/opt/outline/access.txt';
  if (path !== canonical) {
    await execSsh(newConn, `mkdir -p ${shSingleQuote('/opt/outline')}`, {
      signal,
      timeoutMs: 30000,
    });
    await writeAccessTxtOnNewHost(newConn, canonical, credentials, { signal });
    onLog(`Wrote ${canonical}`);
  }

  await syncShadowboxServerConfigHostname(newConn, hostForUrl, {
    signal,
    onLog,
  });

  onLog(
    'Calling Management API: PUT server/hostname-for-access-keys (ss:// host is in-memory until this runs)',
  );
  const outline = new OutlineService(newApiUrl);
  const hostnameOk = await outline.setHostnameForAccessKeys(hostForUrl);
  if (!hostnameOk) {
    throw new Error(
      'Could not update hostname for access keys via the Management API. The bot must reach the new server HTTPS URL; until this succeeds or Shadowbox is restarted, ss:// keys may still show the old IP.',
    );
  }
  onLog('Management API: hostname for access keys updated.');

  onLog('Restarting shadowbox on new host: docker restart shadowbox');
  const restartRes = await execSsh(newConn, `docker restart shadowbox`, {
    signal,
    timeoutMs: 180_000,
    onStdoutLine: onLog,
    onStderrLine: onLog,
  });
  if (restartRes.code !== 0) {
    throw new Error(
      `docker restart shadowbox failed (exit ${restartRes.code}): ${restartRes.stderr || restartRes.stdout}`,
    );
  }
  onLog('docker restart shadowbox: done.');

  return newApiUrl;
};
