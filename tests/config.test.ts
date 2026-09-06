import { describe, expect, it } from 'vitest';
import { INTENDED_PROJECT_ID, ProjectConfigError, resolveProjectId } from '../server/config';

/**
 * Production cannot silently bind an unreviewed project.
 */
describe('resolveProjectId fails closed', () => {
  it('production with no FIREBASE_PROJECT_ID refuses (no automatic fallback)', () => {
    expect(() => resolveProjectId({ NODE_ENV: 'production' })).toThrow(ProjectConfigError);
  });

  it('development with no FIREBASE_PROJECT_ID also refuses', () => {
    expect(() => resolveProjectId({ NODE_ENV: 'development' })).toThrow(ProjectConfigError);
  });

  it('explicit intended project id is used as-is', () => {
    expect(resolveProjectId({ NODE_ENV: 'production', FIREBASE_PROJECT_ID: INTENDED_PROJECT_ID }))
      .toEqual({ projectId: INTENDED_PROJECT_ID });
  });

  it('production refuses ANY project other than the reviewed one (round 1.2)', () => {
    expect(() =>
      resolveProjectId({ NODE_ENV: 'production', FIREBASE_PROJECT_ID: 'wrong-project' })
    ).toThrow(ProjectConfigError);
    expect(() =>
      resolveProjectId({
        NODE_ENV: 'production',
        FIREBASE_PROJECT_ID: 'wrong-project',
      })
    ).toThrow(ProjectConfigError);
  });

  it('production refuses the previously-wrong binding luminous-bond-497709-h6', () => {
    expect(() =>
      resolveProjectId({ NODE_ENV: 'production', FIREBASE_PROJECT_ID: 'luminous-bond-497709-h6' })
    ).toThrow(ProjectConfigError);
  });

  it('development allows demo/emulator project ids for local tooling', () => {
    expect(resolveProjectId({ NODE_ENV: 'development', FIREBASE_PROJECT_ID: 'demo-rules-evidence' }))
      .toEqual({ projectId: 'demo-rules-evidence' });
  });

  it('empty-string project id counts as missing', () => {
    expect(() => resolveProjectId({ NODE_ENV: 'production', FIREBASE_PROJECT_ID: '  ' })).toThrow(
      ProjectConfigError
    );
  });
});
