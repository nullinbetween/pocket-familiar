import { describe, expect, it } from 'vitest';
import {
  cacheControlForStaticFile,
  HASHED_ASSET_CACHE_CONTROL,
  HTML_CACHE_CONTROL,
  REVALIDATE_CACHE_CONTROL,
} from '../server/static-cache';

describe('production static cache policy', () => {
  it('never caches the SPA HTML shell across Cloud Run revisions', () => {
    expect(cacheControlForStaticFile('/app/dist/index.html')).toBe(HTML_CACHE_CONTROL);
  });

  it('keeps content-hashed Vite JS/CSS immutable', () => {
    expect(cacheControlForStaticFile('/app/dist/assets/index-AbCd_1234.js')).toBe(HASHED_ASSET_CACHE_CONTROL);
    expect(cacheControlForStaticFile('/app/dist/assets/index-4mR8kL2p.css')).toBe(HASHED_ASSET_CACHE_CONTROL);
  });

  it('revalidates stable public artwork paths', () => {
    expect(cacheControlForStaticFile('/app/dist/assets/pocket-familiar/familiar/neutral.png')).toBe(REVALIDATE_CACHE_CONTROL);
  });
});
