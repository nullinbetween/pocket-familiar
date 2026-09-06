import { LittleMemory } from '../types';

export type LittleMemoryShareOutcome = 'shared_image' | 'shared_text' | 'copied' | 'cancelled';

export interface LittleMemorySharePort {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data?: ShareData) => boolean;
  clipboard?: { writeText(text: string): Promise<void> };
}

export interface LittleMemoryShareDeps {
  navigator: LittleMemorySharePort;
  appUrl: string;
  loadImage?: () => Promise<string>;
  fetchBlob?: (url: string) => Promise<Blob>;
  composeCard?: (image: Blob, memory: LittleMemory, appUrl: string) => Promise<Blob>;
  makeFile?: (blob: Blob, name: string) => File;
  revokeUrl?: (url: string) => void;
}

export interface LittleMemoryShareCardModel {
  eyebrow: string;
  title: string;
  caption: string;
  date: string;
  footer: string;
  url: string;
}

/** Text placed on the public card. Provenance records deliberately stay out. */
export function littleMemoryShareCardModel(lm: LittleMemory, appUrl: string): LittleMemoryShareCardModel {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(lm.date)
    ? new Date(`${lm.date}T12:00:00`)
    : new Date(lm.confirmedAt || lm.createdAt);
  return {
    eyebrow: 'POCKET FAMILIAR · LITTLE MEMORY',
    title: lm.title,
    caption: lm.caption,
    date: Number.isNaN(parsed.getTime())
      ? lm.date
      : parsed.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
    footer: 'Kept with Pocket Familiar',
    url: appUrl.replace(/\/$/, ''),
  };
}

function coverRect(sourceWidth: number, sourceHeight: number, width: number, height: number) {
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  return { x: (width - drawWidth) / 2, y: (height - drawHeight) / 2, width: drawWidth, height: drawHeight };
}

function wrappedLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
      continue;
    }
    lines.push(line);
    line = word;
    if (lines.length === maxLines - 1) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (words.join(' ').length > lines.join(' ').length && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].replace(/[.…]+$/, '')}…`;
  }
  return lines;
}

/**
 * Compose a public 4:5 keepsake card from the private image bytes. The returned
 * PNG contains only the illustration and public card copy — never source refs.
 */
export async function renderLittleMemoryShareCard(lm: LittleMemory, imageBlob: Blob, appUrl: string): Promise<Blob> {
  const model = littleMemoryShareCardModel(lm, appUrl);
  const imageUrl = URL.createObjectURL(imageBlob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('Could not prepare this Little Memory card.'));
      element.src = imageUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1350;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Sharing cards are not supported in this browser.');

    const rect = coverRect(image.naturalWidth, image.naturalHeight, canvas.width, canvas.height);
    ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height);

    const shade = ctx.createLinearGradient(0, 520, 0, 1350);
    shade.addColorStop(0, 'rgba(12, 20, 31, 0)');
    shade.addColorStop(0.42, 'rgba(12, 20, 31, 0.34)');
    shade.addColorStop(1, 'rgba(12, 20, 31, 0.94)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, 1080, 1350);

    ctx.fillStyle = 'rgba(250, 246, 232, 0.92)';
    ctx.beginPath();
    ctx.roundRect(58, 56, 510, 54, 27);
    ctx.fill();
    ctx.fillStyle = '#334536';
    ctx.font = '600 20px system-ui, sans-serif';
    ctx.letterSpacing = '2px';
    ctx.fillText(model.eyebrow, 84, 91);

    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(250, 246, 232, 0.9)';
    ctx.font = '500 25px system-ui, sans-serif';
    ctx.fillText(model.date, 1018, 91);
    ctx.textAlign = 'left';

    ctx.fillStyle = '#FBF6E8';
    ctx.font = '700 62px Georgia, serif';
    const titleLines = wrappedLines(ctx, model.title, 930, 2);
    titleLines.forEach((line, index) => ctx.fillText(line, 72, 1040 + index * 72));

    const captionY = 1040 + titleLines.length * 72 + 24;
    ctx.font = 'italic 32px Georgia, serif';
    ctx.fillStyle = 'rgba(251, 246, 232, 0.92)';
    wrappedLines(ctx, `“${model.caption}”`, 930, 3)
      .forEach((line, index) => ctx.fillText(line, 72, captionY + index * 44));

    ctx.fillStyle = 'rgba(251, 246, 232, 0.72)';
    ctx.font = '500 22px system-ui, sans-serif';
    ctx.fillText(model.footer, 72, 1300);

    ctx.textAlign = 'right';
    ctx.font = '500 16px system-ui, sans-serif';
    ctx.fillText(model.url, 1008, 1300);
    ctx.textAlign = 'left';

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not export this Little Memory card.')), 'image/png', 0.94);
    });
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

/** Public share copy intentionally excludes every private source record/id. */
export function littleMemoryShareCopy(lm: LittleMemory, appUrl: string): { title: string; text: string; url: string } {
  return {
    title: `${lm.title} · Pocket Familiar`,
    text: `“${lm.caption}”\n\nA Little Memory kept with Pocket Familiar.`,
    url: appUrl,
  };
}

/**
 * Explicit, user-triggered share. Prefer the private illustration as a local
 * file attachment; never share its authenticated URL or provenance records.
 * If file sharing is unsupported, fall back to caption + public app link, then
 * clipboard. Cancelling the native sheet is not presented as an error.
 */
export async function shareLittleMemory(lm: LittleMemory, deps: LittleMemoryShareDeps): Promise<LittleMemoryShareOutcome> {
  const copy = littleMemoryShareCopy(lm, deps.appUrl);
  let objectUrl: string | null = null;
  try {
    if (deps.navigator.share && deps.loadImage && deps.fetchBlob && deps.makeFile) {
      objectUrl = await deps.loadImage();
      const blob = await deps.fetchBlob(objectUrl);
      const card = deps.composeCard
        ? await deps.composeCard(blob, lm, deps.appUrl)
        : await renderLittleMemoryShareCard(lm, blob, deps.appUrl);
      const file = deps.makeFile(card, `pocket-familiar-${lm.id ?? 'memory'}-card.png`);
      const withFile: ShareData = { title: copy.title, text: copy.text, files: [file] };
      if (deps.navigator.canShare?.(withFile)) {
        await deps.navigator.share(withFile);
        return 'shared_image';
      }
    }
    if (deps.navigator.share) {
      await deps.navigator.share(copy);
      return 'shared_text';
    }
    if (deps.navigator.clipboard) {
      await deps.navigator.clipboard.writeText(`${copy.title}\n${copy.text}\n${copy.url}`);
      return 'copied';
    }
    throw new Error('Sharing is not available in this browser.');
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') return 'cancelled';
    throw error;
  } finally {
    if (objectUrl) deps.revokeUrl?.(objectUrl);
  }
}
