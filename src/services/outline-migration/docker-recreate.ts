import type { DockerInspectContainer } from './docker-inspect';
import { sortForStartOrder } from './docker-inspect';

/** Safe single-quoted literal for remote bash. */
export const shSingleQuote = (s: string): string =>
  `'${s.replace(/'/g, `'\\''`)}'`;

const pushNetworkArgs = (
  parts: string[],
  networkMode: string | undefined,
): void => {
  const nm = networkMode ?? '';
  if (nm === 'host') {
    parts.push('--network', 'host');
    return;
  }
  if (nm === 'none') {
    parts.push('--network', 'none');
    return;
  }
  if (nm.startsWith('container:')) {
    parts.push('--network', shSingleQuote(nm));
    return;
  }
  if (nm && nm !== 'default' && nm !== 'bridge') {
    parts.push('--network', shSingleQuote(nm));
  }
};

export const buildDockerRunInvocation = (
  container: DockerInspectContainer,
): string => {
  const parts: string[] = ['docker', 'run', '-d'];

  const name = container.Name.replace(/^\//, '');
  parts.push('--name', shSingleQuote(name));

  const rp = container.HostConfig?.RestartPolicy?.Name;
  if (rp && rp !== 'no') {
    parts.push('--restart', shSingleQuote(rp));
  }

  pushNetworkArgs(parts, container.HostConfig?.NetworkMode);

  if (container.HostConfig?.Privileged) {
    parts.push('--privileged');
  }

  for (const cap of container.HostConfig?.CapAdd ?? []) {
    parts.push('--cap-add', shSingleQuote(cap));
  }
  for (const cap of container.HostConfig?.CapDrop ?? []) {
    parts.push('--cap-drop', shSingleQuote(cap));
  }
  for (const so of container.HostConfig?.SecurityOpt ?? []) {
    parts.push('--security-opt', shSingleQuote(so));
  }
  for (const dns of container.HostConfig?.Dns ?? []) {
    parts.push('--dns', shSingleQuote(dns));
  }
  for (const eh of container.HostConfig?.ExtraHosts ?? []) {
    parts.push('--add-host', shSingleQuote(eh));
  }
  for (const ul of container.HostConfig?.Ulimits ?? []) {
    parts.push('--ulimit', shSingleQuote(`${ul.Name}=${ul.Soft}:${ul.Hard}`));
  }

  const binds = container.HostConfig?.Binds ?? [];
  if (binds.length > 0) {
    for (const b of binds) {
      parts.push('-v', shSingleQuote(b));
    }
  } else if (container.Mounts) {
    for (const m of container.Mounts) {
      if (m.Type === 'bind' && m.Source && m.Destination) {
        const rw = m.RW ? '' : ':ro';
        parts.push('-v', shSingleQuote(`${m.Source}:${m.Destination}${rw}`));
      }
    }
  }

  const nm = container.HostConfig?.NetworkMode ?? '';
  if (nm !== 'host') {
    const pb = container.HostConfig?.PortBindings ?? {};
    for (const [containerPort, bindings] of Object.entries(pb)) {
      for (const b of bindings ?? []) {
        const hp = (b.HostPort ?? '').trim();
        if (!hp) continue;
        const hostIp = b.HostIp && b.HostIp !== '' ? `${b.HostIp}:` : '';
        parts.push('-p', shSingleQuote(`${hostIp}${hp}:${containerPort}`));
      }
    }
  }

  for (const e of container.Config.Env ?? []) {
    parts.push('-e', shSingleQuote(e));
  }

  if (container.Config.User) {
    parts.push('-u', shSingleQuote(container.Config.User));
  }

  const ep = container.Config.Entrypoint;
  if (ep && ep.length > 0) {
    parts.push('--entrypoint', shSingleQuote(ep[0]));
  }

  parts.push(shSingleQuote(container.Config.Image));

  const cmd = container.Config.Cmd ?? [];
  if (ep && ep.length > 1) {
    for (const arg of ep.slice(1)) {
      parts.push(shSingleQuote(arg));
    }
  }
  for (const arg of cmd) {
    parts.push(shSingleQuote(arg));
  }

  return parts.join(' ');
};

export const buildContainerRecreateLines = (
  inspects: DockerInspectContainer[],
): string[] => {
  const ordered = sortForStartOrder(inspects);
  const lines: string[] = [];
  for (const c of ordered) {
    const name = c.Name.replace(/^\//, '');
    lines.push(`docker rm -f ${shSingleQuote(name)} 2>/dev/null || true`);
    lines.push(buildDockerRunInvocation(c));
  }
  return lines;
};
