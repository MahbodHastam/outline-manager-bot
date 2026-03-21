export type DockerInspectContainer = {
  Id: string;
  Name: string;
  Config: {
    Image: string;
    Hostname?: string;
    User?: string;
    Cmd: string[] | null;
    Entrypoint: string[] | null;
    Env: string[] | null;
  };
  HostConfig: {
    Binds?: string[] | null;
    PortBindings?: Record<
      string,
      Array<{ HostIp?: string; HostPort?: string }>
    > | null;
    NetworkMode?: string;
    RestartPolicy?: { Name?: string; MaximumRetryCount?: number };
    Privileged?: boolean;
    CapAdd?: string[] | null;
    CapDrop?: string[] | null;
    SecurityOpt?: string[] | null;
    Dns?: string[] | null;
    ExtraHosts?: string[] | null;
    Ulimits?: Array<{ Name: string; Soft: number; Hard: number }> | null;
  };
  Mounts?: Array<{
    Type: string;
    Source: string;
    Destination: string;
    RW: boolean;
  }>;
};

export const isOutlineRelatedDockerRow = (
  names: string,
  image: string,
): boolean => {
  const blob = `${names}\t${image}`.toLowerCase();
  return (
    blob.includes('shadowbox') ||
    blob.includes('watchtower') ||
    blob.includes('outline') ||
    blob.includes('jigsaw') ||
    blob.includes('quay.io/outline')
  );
};

export const isWatchtowerContainer = (c: DockerInspectContainer): boolean => {
  const n = c.Name.replace(/^\//, '').toLowerCase();
  const img = (c.Config.Image || '').toLowerCase();
  return n.includes('watchtower') || img.includes('watchtower');
};

/** Stop Watchtower-style helpers before core Outline services. */
export const sortForStopOrder = (
  inspects: DockerInspectContainer[],
): DockerInspectContainer[] =>
  [...inspects].sort(
    (a, b) =>
      Number(isWatchtowerContainer(a)) - Number(isWatchtowerContainer(b)),
  );

/** Start core services before Watchtower. */
export const sortForStartOrder = (
  inspects: DockerInspectContainer[],
): DockerInspectContainer[] =>
  [...inspects].sort(
    (a, b) =>
      Number(isWatchtowerContainer(b)) - Number(isWatchtowerContainer(a)),
  );
