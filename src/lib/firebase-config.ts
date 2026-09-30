import { INTENDED_PROJECT_ID } from '../../server/config';

/**
 * Round 1.2 fix 1: pure, testable browser-side config resolution.
 * FAIL-CLOSED at the exact-project level: a complete configuration whose
 * project id is wrong is rejected — completeness alone is not acceptance.
 */

export interface ClientFirebaseConfig {
  projectId?: string;
  appId?: string;
  apiKey?: string;
  authDomain?: string;
  firestoreDatabaseId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
}

export { INTENDED_PROJECT_ID };

export function isComplete(cfg: ClientFirebaseConfig): boolean {
  return Boolean(cfg.projectId && cfg.appId && cfg.apiKey && cfg.authDomain);
}

/**
 * Resolve the runtime Firebase config.
 *  - complete env config bound to INTENDED_PROJECT_ID -> used;
 *  - complete-but-wrong or incomplete config -> throw.
 */
export function resolveClientConfig(
  envConfig: ClientFirebaseConfig
): { config: ClientFirebaseConfig } {
  if (isComplete(envConfig)) {
    if (envConfig.projectId === INTENDED_PROJECT_ID) {
      return { config: envConfig };
    }
    throw new Error(
      `Firebase configuration is bound to "${envConfig.projectId}", which is not the reviewed ` +
        `submission project "${INTENDED_PROJECT_ID}". Refusing to run against an unreviewed project.`
    );
  }
  throw new Error(
    'Firebase configuration missing: set the VITE_FIREBASE_* build variables for the reviewed ' +
      `submission project "${INTENDED_PROJECT_ID}". There is no automatic fallback.`
  );
}
