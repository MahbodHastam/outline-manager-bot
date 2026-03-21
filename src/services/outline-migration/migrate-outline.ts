import type { Client } from 'ssh2';
import type { SshEndpoint } from '../../core/migration-session';
import { closeSsh, connectSsh, execSsh } from './ssh-exec';
import {
  isOutlineRelatedDockerRow,
  sortForStopOrder,
  type DockerInspectContainer,
} from './docker-inspect';
import { buildContainerRecreateLines, shSingleQuote } from './docker-recreate';
import {
  buildNewHostDockerLoadScript,
  buildNewHostTarRestoreScript,
  wrapBashScriptForExec,
} from './server-direct-transfer';
import { syncAccessTxtAndBuildNewApiUrl } from './access-txt-sync';

const LONG_MS = 4 * 60 * 60 * 1000;
const HEARTBEAT_MS = 25_000;

export const MIGRATION_TOTAL_STEPS = 6;

export type MigratePhaseInfo = {
  step: number;
  totalSteps: number;
  label: string;
};

export type MigrateOutlineParams = {
  old: SshEndpoint;
  new: SshEndpoint;
  signal?: AbortSignal;
  onLog: (line: string) => void;
  onPhase?: (info: MigratePhaseInfo) => void;
};

const MIN_UBUNTU_LTS: [number, number] = [22, 4];

const parseOsRelease = (content: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
};

const parseUbuntuVersionTuple = (
  versionId: string,
): [number, number] | null => {
  const m = versionId.trim().match(/^(\d+)\.(\d+)/);
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10)];
};

const isAtLeastUbuntuVersion = (
  v: [number, number],
  min: [number, number],
): boolean => v[0] > min[0] || (v[0] === min[0] && v[1] >= min[1]);

const verifyNewHostUbuntuLts = async (
  conn: Client,
  onLog: (line: string) => void,
  signal?: AbortSignal,
) => {
  const r = await execSsh(conn, `cat /etc/os-release`, {
    signal,
    timeoutMs: 30000,
  });
  if (r.code !== 0) {
    throw new Error(
      `Could not read /etc/os-release on new host: ${r.stderr || 'unknown error'}`,
    );
  }

  const env = parseOsRelease(r.stdout);
  if ((env.ID || '').toLowerCase() !== 'ubuntu') {
    throw new Error(
      `New host must be Ubuntu LTS (found ID=${env.ID ?? 'unknown'}).`,
    );
  }

  const vid = env.VERSION_ID || '';
  const tuple = parseUbuntuVersionTuple(vid);
  if (!tuple) {
    throw new Error(
      `Could not parse VERSION_ID on new host (got ${vid || 'empty'}).`,
    );
  }
  if (!isAtLeastUbuntuVersion(tuple, MIN_UBUNTU_LTS)) {
    throw new Error(
      `New host must be Ubuntu LTS ${MIN_UBUNTU_LTS[0]}.${String(MIN_UBUNTU_LTS[1]).padStart(2, '0')} or newer (found VERSION_ID=${vid}).`,
    );
  }

  const pretty = env.PRETTY_NAME || '';
  if (!/LTS/i.test(pretty)) {
    throw new Error(
      'New host must be an Ubuntu LTS release (PRETTY_NAME does not indicate LTS). Non-LTS versions are not supported.',
    );
  }

  onLog(`Verified new host: ${pretty || `Ubuntu ${vid} LTS`}.`);
};

const verifyDocker = async (
  conn: Client,
  label: string,
  onLog: (line: string) => void,
  signal?: AbortSignal,
) => {
  const r = await execSsh(
    conn,
    `docker version --format '{{.Server.Version}}'`,
    {
      signal,
      timeoutMs: 120000,
    },
  );
  if (r.code !== 0 || !r.stdout.trim()) {
    throw new Error(
      `${label}: Docker does not appear to be running or accessible (${r.stderr || 'no server version'}). Use a user that can run docker without interactive sudo.`,
    );
  }
  onLog(`${label}: Docker ${r.stdout.trim()}`);
};

const phase = (
  onPhase: MigrateOutlineParams['onPhase'],
  step: number,
  label: string,
) => {
  onPhase?.({ step, totalSteps: MIGRATION_TOTAL_STEPS, label });
};

const fmtMs = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
};

export const runOutlineMigration = async (
  params: MigrateOutlineParams,
): Promise<string> => {
  const { old, new: dest, signal, onLog, onPhase } = params;

  const log = (line: string) => {
    onLog(line);
  };

  let oldConn: Client | null = null;
  let newConn: Client | null = null;

  try {
    phase(onPhase, 1, 'SSH: connect & verify OS / Docker / /opt/outline');
    log('[1/6] Connecting to old host (SSH, via bot only for control)...');
    oldConn = await connectSsh({ ...old, readyTimeoutMs: 45000 });
    log('[1/6] Connecting to new host (SSH)...');
    newConn = await connectSsh({ ...dest, readyTimeoutMs: 45000 });

    await verifyNewHostUbuntuLts(newConn, log, signal);
    await verifyDocker(oldConn, 'Old host', log, signal);
    await verifyDocker(newConn, 'New host', log, signal);

    const outlineCheck = await execSsh(
      oldConn,
      `test -d /opt/outline && echo ok`,
      { signal, timeoutMs: 30000 },
    );
    if (outlineCheck.stdout.trim() !== 'ok') {
      throw new Error(
        'Directory /opt/outline not found on the old host. Is this an Outline server?',
      );
    }

    phase(onPhase, 2, 'Discover & stop Outline containers on old host');
    log('[2/6] Listing Docker containers on old host...');
    const ps = await execSsh(
      oldConn,
      `docker ps -a --no-trunc --format '{{.ID}}\t{{.Names}}\t{{.Image}}'`,
      { signal, timeoutMs: 120000 },
    );
    if (ps.code !== 0) {
      throw new Error(
        `docker ps failed on old host: ${ps.stderr || ps.stdout}`,
      );
    }

    const matchedIds: string[] = [];
    for (const line of ps.stdout.split('\n')) {
      if (!line.trim()) continue;
      const [id, names, image] = line.split('\t');
      if (!id || !names || !image) continue;
      if (isOutlineRelatedDockerRow(names, image)) matchedIds.push(id);
    }

    let inspects: DockerInspectContainer[] = [];
    if (matchedIds.length > 0) {
      const quoted = matchedIds.map((id) => shSingleQuote(id)).join(' ');
      const insp = await execSsh(oldConn, `docker inspect ${quoted}`, {
        signal,
        timeoutMs: 120000,
      });
      if (insp.code !== 0) {
        throw new Error(`docker inspect failed: ${insp.stderr}`);
      }
      inspects = JSON.parse(insp.stdout) as DockerInspectContainer[];
    } else {
      log(
        '[2/6] No Outline-related containers matched; only /opt/outline data will be copied.',
      );
    }

    if (inspects.length > 0) {
      const stopOrder = sortForStopOrder(inspects);
      const stopIds = stopOrder.map((c) => c.Id).join(' ');
      log('[2/6] Stopping containers on old host...');
      const stopRes = await execSsh(oldConn, `docker stop ${stopIds}`, {
        signal,
        timeoutMs: 600000,
        onStdoutLine: log,
        onStderrLine: log,
      });
      if (stopRes.code !== 0) {
        throw new Error(
          `docker stop failed (${stopRes.code}): ${stopRes.stderr}`,
        );
      }
    }

    const images = [
      ...new Set(inspects.map((i) => i.Config.Image).filter(Boolean)),
    ];
    if (images.length > 0) {
      phase(
        onPhase,
        3,
        'Docker images: new host SSH → old host, stream into docker load (not via bot)',
      );
      log(
        `[3/6] Transferring ${images.length} image(s): data path is old server → new server (new host runs ssh to old). May take many minutes.`,
      );
      const script = buildNewHostDockerLoadScript(old, images);
      const cmd = wrapBashScriptForExec(script);
      const imgRes = await execSsh(newConn, cmd, {
        signal,
        timeoutMs: LONG_MS,
        onStdoutLine: log,
        onStderrLine: log,
        heartbeatMs: HEARTBEAT_MS,
        onHeartbeat: (elapsedMs, idleMs) => {
          log(
            `… still streaming Docker layers (${fmtMs(elapsedMs)} elapsed, no log lines for ${fmtMs(idleMs)} — large images are often quiet)`,
          );
        },
      });
      if (imgRes.code !== 0) {
        const tail = (imgRes.stderr || imgRes.stdout).slice(-800);
        throw new Error(
          `docker save/load via direct SSH failed (exit ${imgRes.code}). ` +
            `Ensure the NEW host can reach the OLD host on SSH port ${old.port} and uses the same old-host SSH password. ` +
            `Tail:\n${tail}`,
        );
      }
      log('[3/6] Docker images loaded on new host.');
    }

    phase(
      onPhase,
      4,
      '/opt/outline: new host SSH → old host, tar stream (not via bot)',
    );
    log(
      '[4/6] Streaming /opt/outline archive (old → new direct). May take many minutes.',
    );
    const tarScript = buildNewHostTarRestoreScript(old);
    const tarCmd = wrapBashScriptForExec(tarScript);
    const tarRes = await execSsh(newConn, tarCmd, {
      signal,
      timeoutMs: LONG_MS,
      onStdoutLine: log,
      onStderrLine: log,
      heartbeatMs: HEARTBEAT_MS,
      onHeartbeat: (elapsedMs, idleMs) => {
        log(
          `… tar stream still running (${fmtMs(elapsedMs)} elapsed, quiet for ${fmtMs(idleMs)})`,
        );
      },
    });
    if (tarRes.code !== 0) {
      const tail = (tarRes.stderr || tarRes.stdout).slice(-800);
      throw new Error(
        `Archive transfer failed (exit ${tarRes.code}). ` +
          `Check SSH from new→old and disk space on the new host. Tail:\n${tail}`,
      );
    }
    log('[4/6] Restored /opt/outline on new host.');

    phase(onPhase, 5, 'Recreate containers on new host');
    if (inspects.length > 0) {
      log('[5/6] Recreating containers from saved inspect metadata...');
      const lines = buildContainerRecreateLines(inspects);
      for (const line of lines) {
        if (!line.trim()) continue;
        const r = await execSsh(newConn, line, {
          signal,
          timeoutMs: LONG_MS,
          onStdoutLine: log,
          onStderrLine: log,
        });
        if (r.code !== 0) {
          throw new Error(
            `Command failed (exit ${r.code}): ${line}\n${r.stderr}`,
          );
        }
      }
      log('[5/6] Containers recreated.');
    } else {
      log(
        '[5/6] No containers to recreate — start Outline on the new server manually if needed.',
      );
    }

    phase(
      onPhase,
      6,
      'Update /opt/outline (hosts + access.txt) and new management API URL (automatic)',
    );
    log(
      '[6/6] Replacing old server host(s) under /opt/outline, updating access.txt, building new Management API URL...',
    );
    const newApiUrl = await syncAccessTxtAndBuildNewApiUrl({
      newConn,
      newSsh: dest,
      oldSsh: old,
      oldConn,
      signal,
      onLog: log,
    });
    log(`[6/6] Done. New management API URL: ${newApiUrl}`);
    return newApiUrl;
  } finally {
    if (oldConn) closeSsh(oldConn);
    if (newConn) closeSsh(newConn);
  }
};
