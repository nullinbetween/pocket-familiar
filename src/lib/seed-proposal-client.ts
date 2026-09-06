import { SeedProposal } from './memory-seed-flow';

/**
 * PF-CORE-01 client call for a Memory Seed proposal. Carries a fresh Firebase
 * ID token; the SERVER verifies ownership and fetches the source page itself, so
 * only a diaryPageId is sent — never the page's life text or an ownership claim.
 * Returns a not-yet-durable proposal; nothing is persisted until the user
 * explicitly approves it.
 */
export async function requestSeedProposal(
  getToken: () => Promise<string>,
  args: { diaryPageId: string }
): Promise<SeedProposal> {
  const idToken = await getToken();
  const response = await fetch('/api/gemini/memory-seed-draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ diaryPageId: args.diaryPageId }),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Server responded with status ${response.status}`);
  }
  const data = await response.json();
  return data.proposal as SeedProposal;
}
