import { describe, expect, it } from 'vitest';
import { INTENDED_PROJECT_ID, resolveClientConfig } from '../src/lib/firebase-config';

/**
 * Round 1.2 fix 1: browser boundary — completeness is not acceptance.
 */
const complete = (projectId: string) => ({
  projectId,
  appId: '1:1:web:x',
  apiKey: 'AIzaSyTESTKEYONLYNOTAREALKEY0000000000',
  authDomain: `${projectId}.firebaseapp.com`,
});

describe('resolveClientConfig binds the exact reviewed project', () => {
  it('accepts a complete config bound to the reviewed submission project', () => {
    const r = resolveClientConfig(complete(INTENDED_PROJECT_ID));
    expect(r.config.projectId).toBe(INTENDED_PROJECT_ID);
  });

  it('rejects a complete config bound to an arbitrary wrong project', () => {
    expect(() => resolveClientConfig(complete('wrong-project'))).toThrow(/not the reviewed/);
  });

  it('rejects a complete config bound to the previously-wrong project luminous-bond-497709-h6', () => {
    expect(() => resolveClientConfig(complete('luminous-bond-497709-h6'))).toThrow(/not the reviewed/);
  });

  it('rejects incomplete config (no automatic fallback)', () => {
    expect(() => resolveClientConfig({})).toThrow(/no automatic fallback/);
    expect(() => resolveClientConfig({ projectId: INTENDED_PROJECT_ID })).toThrow();
  });
});
