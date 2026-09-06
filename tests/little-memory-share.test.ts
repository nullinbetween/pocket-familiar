import { describe, expect, it, vi } from 'vitest';
import { LittleMemory } from '../src/types';
import { littleMemoryShareCardModel, littleMemoryShareCopy, shareLittleMemory } from '../src/lib/little-memory-share';

const memory = {
  id: 'lm-private-id', title: 'A quiet table', caption: 'A small delight in familiar details.',
  sourceRefs: [{ kind: 'diaryPage', id: 'secret-page', label: 'Private page', availability: 'available' }],
} as LittleMemory;

describe('Little Memory explicit social sharing', () => {
  it('public copy contains the caption and app URL but no private provenance', () => {
    const copy = littleMemoryShareCopy(memory, 'https://example.run.app');
    expect(copy.text).toContain(memory.caption);
    expect(copy.url).toBe('https://example.run.app');
    expect(JSON.stringify(copy)).not.toContain('secret-page');
    expect(JSON.stringify(copy)).not.toContain('Private page');
  });

  it('builds branded card copy from image, title, caption and date only', () => {
    const card = littleMemoryShareCardModel(
      { ...memory, date: '2026-09-05', confirmedAt: 1, createdAt: 1 },
      'https://example.run.app/',
    );
    expect(card.eyebrow).toContain('LITTLE MEMORY');
    expect(card.title).toBe(memory.title);
    expect(card.caption).toBe(memory.caption);
    expect(card.date).toBe('Sep 5, 2026');
    expect(card.url).toBe('https://example.run.app');
    expect(JSON.stringify(card)).not.toContain('secret-page');
    expect(JSON.stringify(card)).not.toContain('Private page');
  });

  it('prefers a local image file and never shares its authenticated object URL', async () => {
    const share = vi.fn(async (_data: ShareData) => {});
    const revoke = vi.fn();
    const outcome = await shareLittleMemory(memory, {
      navigator: { share, canShare: (data) => !!data?.files?.length },
      appUrl: 'https://example.run.app',
      loadImage: async () => 'blob:private-image',
      fetchBlob: async () => new Blob(['image'], { type: 'image/png' }),
      composeCard: async () => new Blob(['card'], { type: 'image/png' }),
      makeFile: (blob, name) => ({ name, type: blob.type } as File),
      revokeUrl: revoke,
    });
    expect(outcome).toBe('shared_image');
    expect(share).toHaveBeenCalledOnce();
    expect(share.mock.calls[0][0].files?.[0]?.name).toContain('-card.png');
    expect(JSON.stringify(share.mock.calls[0][0])).not.toContain('blob:private-image');
    expect(revoke).toHaveBeenCalledWith('blob:private-image');
  });

  it('falls back to text share, then clipboard, without source records', async () => {
    const share = vi.fn(async (_data: ShareData) => {});
    expect(await shareLittleMemory(memory, {
      navigator: { share, canShare: () => false }, appUrl: 'https://example.run.app',
      loadImage: async () => 'blob:private', fetchBlob: async () => new Blob(['x']),
      composeCard: async () => new Blob(['card'], { type: 'image/png' }),
      makeFile: () => ({} as File), revokeUrl: () => {},
    })).toBe('shared_text');
    expect(share.mock.calls[0][0]).not.toHaveProperty('files');

    const writeText = vi.fn(async (_text: string) => {});
    expect(await shareLittleMemory(memory, {
      navigator: { clipboard: { writeText } }, appUrl: 'https://example.run.app',
    })).toBe('copied');
    expect(writeText.mock.calls[0][0]).not.toContain('secret-page');
  });
});
