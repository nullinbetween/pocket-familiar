import path from 'path';

export const HTML_CACHE_CONTROL = 'no-store, no-cache, must-revalidate';
export const HASHED_ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';
export const REVALIDATE_CACHE_CONTROL = 'public, max-age=0, must-revalidate';

/**
 * A deployment must never leave a browser running an old HTML shell that points
 * at hashed bundles from an earlier Cloud Run revision. Vite's JS/CSS bundles
 * are content-addressed and safe to retain; stable public asset paths must
 * revalidate because their bytes may change without a filename change.
 */
export function cacheControlForStaticFile(filePath: string): string {
  const basename = path.basename(filePath);
  if (basename === 'index.html') return HTML_CACHE_CONTROL;

  const normalized = filePath.replaceAll('\\', '/');
  const isViteBundle = normalized.includes('/assets/') && /[-.][A-Za-z0-9_-]{8,}\.(?:js|css)$/.test(basename);
  return isViteBundle ? HASHED_ASSET_CACHE_CONTROL : REVALIDATE_CACHE_CONTROL;
}
