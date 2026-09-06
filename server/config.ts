/**
 * The one checked-in reviewed submission project.
 * Production accepts exactly this binding: there is one accepted project and
 * no alternate-project opt-in. Reviewed by the owner and CodeX; changing it
 * is a reviewable diff, not an environment agreement.
 */
export const INTENDED_PROJECT_ID = 'gen-lang-client-0835541160';

export interface ProjectIdEnv {
  NODE_ENV?: string;
  FIREBASE_PROJECT_ID?: string;
}

export class ProjectConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectConfigError';
  }
}

/**
 * Resolve the Firebase project id used for ID-token verification.
 *  - production accepts EXACTLY the checked-in INTENDED_PROJECT_ID. Any other
 *    value refuses startup.
 *  - development accepts the intended project as-is; another explicit id
 *    (e.g. a demo-* emulator project) remains available for local tooling.
 *  - a missing FIREBASE_PROJECT_ID never falls back automatically anywhere.
 */
export function resolveProjectId(env: ProjectIdEnv): { projectId: string } {
  const isProduction = env.NODE_ENV === 'production';
  const explicit = env.FIREBASE_PROJECT_ID?.trim();

  if (explicit) {
    if (explicit === INTENDED_PROJECT_ID) {
      return { projectId: explicit };
    }
    if (isProduction) {
      throw new ProjectConfigError(
        `FIREBASE_PROJECT_ID "${explicit}" is not the reviewed submission project ` +
          `"${INTENDED_PROJECT_ID}". Production accepts only the reviewed project.`
      );
    }
    // Development-only: emulator/demo projects for local tooling.
    return { projectId: explicit };
  }

  throw new ProjectConfigError(
    'FIREBASE_PROJECT_ID is not set. Set it to the reviewed submission project ' +
      `"${INTENDED_PROJECT_ID}". There is no automatic fallback.`
  );
}
