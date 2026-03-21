import { Client } from 'ssh2';

export type SshConnectOpts = {
  host: string;
  port: number;
  username: string;
  password: string;
  readyTimeoutMs?: number;
};

export const connectSsh = (opts: SshConnectOpts): Promise<Client> => {
  const readyTimeoutMs = opts.readyTimeoutMs ?? 30000;
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const timer = setTimeout(() => {
      conn.end();
      reject(
        new Error(
          `SSH connection timed out after ${readyTimeoutMs}ms to ${opts.host}`,
        ),
      );
    }, readyTimeoutMs);

    conn
      .on('ready', () => {
        clearTimeout(timer);
        resolve(conn);
      })
      .on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      })
      .connect({
        host: opts.host,
        port: opts.port,
        username: opts.username,
        password: opts.password,
        readyTimeout: readyTimeoutMs,
      });
  });
};

export const closeSsh = (conn: Client) => {
  try {
    conn.end();
  } catch {
    // ignore
  }
};

export type ExecResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

const abortError = () => {
  const e = new Error('Aborted');
  (e as Error & { name: string }).name = 'AbortError';
  return e;
};

export const execSsh = (
  conn: Client,
  command: string,
  options?: {
    timeoutMs?: number;
    onStdoutLine?: (line: string) => void;
    onStderrLine?: (line: string) => void;
    /** If no stdout/stderr for this long, call onHeartbeat (quiet streams like docker save). */
    heartbeatMs?: number;
    onHeartbeat?: (elapsedMs: number, idleMs: number) => void;
    signal?: AbortSignal;
  },
): Promise<ExecResult> =>
  new Promise((resolve, reject) => {
    if (options?.signal?.aborted) return reject(abortError());

    let stdout = '';
    let stderr = '';
    let lineBuf = '';
    let errLineBuf = '';
    const startedAt = Date.now();
    let lastActivityAt = Date.now();

    const bump = () => {
      lastActivityAt = Date.now();
    };

    conn.exec(command, (err, stream) => {
      if (err) return reject(err);

      const onAbort = () => {
        stream.close();
        reject(abortError());
      };
      options?.signal?.addEventListener('abort', onAbort, { once: true });

      let timer: NodeJS.Timeout | undefined;
      if (options?.timeoutMs && options.timeoutMs > 0) {
        timer = setTimeout(() => {
          stream.close();
          const mins = Math.round(options.timeoutMs! / 60000);
          reject(
            new Error(
              `SSH command timed out after ${mins}m (${options.timeoutMs}ms). The step may still be running on the server; check hosts and network.`,
            ),
          );
        }, options.timeoutMs);
      }

      let heartbeatTimer: NodeJS.Timeout | undefined;
      const hbMs = options?.heartbeatMs ?? 0;
      if (hbMs > 0 && options?.onHeartbeat) {
        const tick = Math.min(15000, Math.max(5000, hbMs));
        heartbeatTimer = setInterval(() => {
          if (options?.signal?.aborted) return;
          const idle = Date.now() - lastActivityAt;
          if (idle >= hbMs) {
            options.onHeartbeat!(Date.now() - startedAt, idle);
            lastActivityAt = Date.now();
          }
        }, tick);
      }

      let exitCode: number | null | undefined;
      stream.on('exit', (code: number | null, signal?: string) => {
        if (typeof code === 'number') exitCode = code;
        else if (signal) exitCode = -1;
        else exitCode = null;
      });

      const done = () => {
        if (timer) clearTimeout(timer);
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        options?.signal?.removeEventListener('abort', onAbort);
        if (options?.onStdoutLine && lineBuf.length > 0) {
          options.onStdoutLine(lineBuf);
          lineBuf = '';
        }
        if (options?.onStderrLine && errLineBuf.length > 0) {
          options.onStderrLine(errLineBuf);
          errLineBuf = '';
        }
        resolve({
          code: exitCode !== undefined ? exitCode : null,
          stdout,
          stderr,
        });
      };

      stream.on('close', () => {
        done();
      });

      stream.on('data', (chunk: Buffer) => {
        bump();
        const s = chunk.toString('utf8');
        stdout += s;
        if (options?.onStdoutLine) {
          lineBuf += s;
          const parts = lineBuf.split('\n');
          lineBuf = parts.pop() ?? '';
          for (const line of parts) options.onStdoutLine(line);
        }
      });

      stream.stderr.on('data', (chunk: Buffer) => {
        bump();
        const s = chunk.toString('utf8');
        stderr += s;
        if (options?.onStderrLine) {
          errLineBuf += s;
          const parts = errLineBuf.split('\n');
          errLineBuf = parts.pop() ?? '';
          for (const line of parts) {
            if (line) options.onStderrLine(line);
          }
        }
      });
    });
  });
