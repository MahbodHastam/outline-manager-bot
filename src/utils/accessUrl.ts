export const getActualAccessUrl = (accessUrl: string) => {
  try {
    const normalizedUrl = new URL(accessUrl);
    normalizedUrl.searchParams.delete('outline');
    return normalizedUrl.toString();
  } catch {
    return accessUrl
      .replace(/\?outline=1$/, '')
      .replace(/&outline=1$/, '')
      .replace(/\?outline=1&/, '?')
      .replace(/&outline=1&/, '&');
  }
};

/** Plain `ss://...` for bot UI; strips `outline` if present. */
export const getDisplayAccessUrl = (
  accessUrl: string,
  customDomainBase: string | null | undefined,
  keyAlias?: string,
) => {
  const actualAccessUrl = getActualAccessUrl(accessUrl);
  if (!customDomainBase?.trim() || !keyAlias) return actualAccessUrl;

  try {
    const base = customDomainBase.trim();
    const customBase = new URL(base.endsWith('/') ? base : `${base}/`);

    const result = new URL(keyAlias, customBase.toString());
    return result.toString();
  } catch {
    return actualAccessUrl;
  }
};

/**
 * Response body for the custom-domain HTTP handler / Outline client:
 * sanitized key URL with `?outline=1` (or `&outline=1`) appended.
 */
export const getAccessUrlForOutlineClient = (accessUrl: string) => {
  const base = getActualAccessUrl(accessUrl);
  return base.includes('?') ? `${base}&outline=1` : `${base}?outline=1`;
};
