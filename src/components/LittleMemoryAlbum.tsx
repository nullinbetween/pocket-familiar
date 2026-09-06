import React, { useEffect, useMemo, useState } from 'react';
import { DiaryPage, LittleMemory, MemorySeed, SceneBriefFields } from '../types';
import { LittleMemoryDraftResult } from '../lib/growth-client';
import { resolveImageStatus, hasViewableImage, currentImageStatus, isGenerating, pendingFailed } from '../lib/little-memory-image';
import { LittleMemoryStudio } from './LittleMemoryStudio';
import { shareLittleMemory } from '../lib/little-memory-share';
import { Sparkles, X, Trash2, ArrowUpRight, Plus, ImageOff, Loader2, AlertCircle, Wand2, RefreshCw, Share2, Check } from 'lucide-react';

/**
 * PF-CORE-03A: the Little Memories album — a separate destination that fits the
 * illustrated product language WITHOUT pretending a CG exists. Every card is
 * honestly shows whether an illustration exists. Internal generation fields are
 * not presented as a user task: the detail view shows only the human-facing
 * caption and each verified source, with exact navigation and honest labels for
 * unavailable records. Delete remains scoped to the Little Memory only.
 */

interface Props {
  littleMemories: LittleMemory[];
  diaryPages: DiaryPage[];
  activeSeeds: MemorySeed[];
  requestDraft: (diaryPageId: string, seedIds: string[]) => Promise<LittleMemoryDraftResult>;
  /** Allocate a pre-allocated Little Memory id (called once per studio mount). */
  allocateId: () => string;
  onApprove: (args: { littleMemoryId: string; sourcePage: DiaryPage; draftFields: SceneBriefFields; approvedFields: SceneBriefFields; seedIds: string[] }) => Promise<void>;
  onDelete: (lm: LittleMemory) => Promise<void>;
  /** PF-CORE-03B: generate one real illustration on explicit action (resolves when the server settles). */
  onGenerate?: (lm: LittleMemory) => Promise<void>;
  /** PF-CORE-03B: authenticated private image load → a per-view object URL. */
  loadImage?: (lm: LittleMemory) => Promise<string>;
  onOpenDiaryPage: (pageId: string) => void;
  onOpenSeed: (seedId: string) => void;
  isDiaryAvailable: (pageId: string) => boolean;
  isSeedAvailable: (seedId: string) => boolean;
  /** When set (e.g. from a Living Memory search result), open that record's detail. */
  focusId?: string | null;
  onFocusConsumed?: () => void;
}

/** Honest placeholder where a future illustration will go — never a fake image. */
const PendingCanvas: React.FC<{ id?: string; tall?: boolean }> = ({ id, tall }) => (
  <div id={id} className={`rounded-xl border border-dashed border-[#D8CEB6] bg-[#F7F4EC]/70 flex flex-col items-center justify-center text-center gap-1 ${tall ? 'h-40' : 'h-28'}`}>
    <ImageOff className="w-5 h-5 text-[#B8AE93]" />
    <span className="text-[10px] font-semibold text-[#9A8F72]">Illustration not generated yet</span>
    <span className="text-[9px] text-[#B0A98F]">Your Little Memory is saved</span>
  </div>
);

/** Loads a generated image through the authenticated private path into an object URL. */
const AuthImage: React.FC<{ id?: string; load: () => Promise<string>; reloadKey: string; alt: string; tall?: boolean }> = ({ id, load, reloadKey, alt, tall }) => {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let url: string | null = null; let cancelled = false;
    setSrc(null); setFailed(false);
    load().then((u) => { if (cancelled) { try { URL.revokeObjectURL(u); } catch { /* data: urls */ } return; } url = u; setSrc(u); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; if (url) { try { URL.revokeObjectURL(url); } catch { /* data: urls */ } } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);
  const box = `w-full ${tall ? 'h-56' : 'h-28'} rounded-xl overflow-hidden bg-[#0f1420]/5 flex items-center justify-center`;
  if (failed) return <div id={id} className={`${box} border pf-hairline text-[10px] text-[#9A5A3A]`}>Couldn’t load the illustration</div>;
  if (!src) return <div id={id} className={`${box} border pf-hairline`}><Loader2 className="w-4 h-4 animate-spin text-[#9A8F72]" /></div>;
  if (tall) {
    return <img id={id} src={src} alt={alt} className="w-full max-h-[70vh] object-contain rounded-xl border pf-hairline bg-[#161D2B]" />;
  }
  return (
    <div className="relative w-full overflow-hidden rounded-xl border pf-hairline bg-[#161D2B]" style={{ aspectRatio: '16 / 9' }}>
      <img src={src} alt="" aria-hidden="true"
        className="absolute inset-0 w-full h-full object-cover scale-105 blur-md opacity-35" />
      <img id={id} src={src} alt={alt}
        className="relative w-full h-full object-contain" />
    </div>
  );
};

const imageReloadKey = (lm: LittleMemory) => `${lm.image?.status ?? 'none'}:${lm.image?.generationId ?? ''}:${lm.image?.generatedAt ?? 0}`;

export const LittleMemoryAlbum: React.FC<Props> = ({
  littleMemories, diaryPages, activeSeeds, requestDraft, allocateId, onApprove, onDelete,
  onGenerate, loadImage, onOpenDiaryPage, onOpenSeed, isDiaryAvailable, isSeedAvailable, focusId, onFocusConsumed,
}) => {
  const [studioPage, setStudioPage] = useState<DiaryPage | null>(null);
  const [picking, setPicking] = useState(false);
  const [detail, setDetail] = useState<LittleMemory | null>(null);

  useEffect(() => {
    if (!focusId) return;
    const target = littleMemories.find((l) => l.id === focusId);
    if (target) setDetail(target);
    onFocusConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);

  const live = useMemo(
    () => (detail ? littleMemories.find((l) => l.id === detail.id) ?? detail : null),
    [detail, littleMemories]
  );

  const dateOf = (l: LittleMemory) => l.date;

  return (
    <div className="pf-page pf-page-frame space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-[var(--pf-ink)] inline-flex items-center gap-2" style={{ fontFamily: '"Playfair Display", Georgia, serif' }}>
            <Sparkles className="w-5 h-5 text-[var(--pf-brass)]" /> Little Memories
          </h1>
          <p className="text-[11px] text-[#8A8471] mt-0.5">{littleMemories.some(hasViewableImage)
            ? 'Small moments from your own records, kept with illustrations by Midnight.'
            : 'Small moments from your own records, waiting for Midnight to illustrate them.'}</p>
        </div>
        <button id="lm-new-btn" onClick={() => setPicking(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-[var(--pf-forest)] hover:bg-[var(--pf-forest-deep)] text-[var(--pf-cream)] text-xs font-semibold shadow-xs shrink-0">
          <Plus className="w-3.5 h-3.5" /> New
        </button>
      </div>

      {littleMemories.length === 0 ? (
        <div id="lm-album-empty" className="text-center space-y-3 py-12">
          <div className="mx-auto w-40"><PendingCanvas tall /></div>
          <h3 className="text-base font-bold text-[var(--pf-ink)]" style={{ fontFamily: '"Playfair Display", Georgia, serif' }}>No Little Memories yet</h3>
          <p className="text-xs text-[#7A7A6A] max-w-xs mx-auto leading-relaxed">
            Choose a diary page and your familiar will draft a scene — a written plan for a future illustration you approve, edit and keep.
          </p>
          <button id="lm-empty-new-btn" onClick={() => setPicking(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--pf-forest)] hover:bg-[var(--pf-forest-deep)] text-[var(--pf-cream)] text-xs font-semibold shadow-xs">
            <Plus className="w-3.5 h-3.5" /> Make your first one
          </button>
        </div>
      ) : (
        <div id="little-memory-album" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {littleMemories.map((l) => (
            <button key={l.id} id={`lm-card-${l.id}`} onClick={() => setDetail(l)}
              className="text-left pf-note rounded-2xl border pf-hairline p-3 shadow-2xs hover:border-[var(--pf-forest)] transition-colors space-y-2">
              {hasViewableImage(l) && loadImage
                ? <AuthImage id={`lm-card-image-${l.id}`} load={() => loadImage(l)} reloadKey={imageReloadKey(l)} alt={`Illustration for ${l.title}`} />
                : <PendingCanvas id={`lm-card-pending-${l.id}`} />}
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-[13px] font-bold text-[var(--pf-ink)] leading-tight line-clamp-2">{l.title}</h3>
                <span className="shrink-0 text-[9px] font-mono text-[#9A9482]">{dateOf(l)}</span>
              </div>
              <p className="text-[11px] text-[#5A5A4A] italic leading-snug line-clamp-2">“{l.caption}”</p>
              <div className="flex items-center gap-1.5 flex-wrap">
                <CardStatusBadge lm={l} />
                <span className="text-[9px] text-[#8A8471]">Saved by you · {(l.sourceRefs ?? []).length} source{(l.sourceRefs ?? []).length === 1 ? '' : 's'}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {picking && (
        <PagePicker
          diaryPages={diaryPages}
          onPick={(p) => { setPicking(false); setStudioPage(p); }}
          onClose={() => setPicking(false)}
        />
      )}

      {studioPage && (
        <LittleMemoryStudio
          sourcePage={studioPage}
          activeSeeds={activeSeeds}
          allocateId={allocateId}
          requestDraft={(seedIds) => requestDraft(studioPage.id!, seedIds)}
          onApprove={async ({ littleMemoryId, draftFields, approvedFields, seedIds }) => {
            await onApprove({ littleMemoryId, sourcePage: studioPage, draftFields, approvedFields, seedIds });
            setStudioPage(null);
          }}
          onClose={() => setStudioPage(null)}
        />
      )}

      {live && (
        <LittleMemoryDetail
          lm={live}
          onClose={() => setDetail(null)}
          onDelete={async (l) => { await onDelete(l); setDetail(null); }}
          onGenerate={onGenerate}
          loadImage={loadImage}
          onOpenDiaryPage={onOpenDiaryPage}
          onOpenSeed={onOpenSeed}
          isDiaryAvailable={isDiaryAvailable}
          isSeedAvailable={isSeedAvailable}
        />
      )}
    </div>
  );
};

/* ── Page picker: start a Little Memory from a confirmed Diary Page ────────────*/
const PagePicker: React.FC<{ diaryPages: DiaryPage[]; onPick: (p: DiaryPage) => void; onClose: () => void }> = ({ diaryPages, onPick, onClose }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label="Choose a diary page"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[rgba(20,28,43,0.45)] backdrop-blur-sm p-0 sm:p-4" onClick={onClose}>
      <div id="lm-page-picker" onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md max-h-[85vh] overflow-y-auto bg-[var(--pf-paper)] rounded-t-3xl sm:rounded-3xl border pf-hairline shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between px-4 py-3 border-b pf-hairline bg-[var(--pf-paper)]">
          <span className="text-sm font-semibold text-[var(--pf-ink)]">Which day shall we illustrate?</span>
          <button id="lm-page-picker-cancel" onClick={onClose} aria-label="Cancel" className="p-1.5 rounded-lg text-[#7A7A6A] hover:text-[var(--pf-ink)] hover:bg-[var(--pf-paper-2)]"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-4 py-3 space-y-2">
          {diaryPages.length === 0 ? (
            <p className="text-xs text-[#7A7A6A] py-6 text-center">Keep a diary page first — then you can make a Little Memory from it.</p>
          ) : diaryPages.map((p) => (
            <button key={p.id} id={`lm-pick-page-${p.id}`} onClick={() => onPick(p)}
              className="w-full text-left rounded-xl border pf-hairline bg-white/60 hover:bg-white px-3 py-2.5 transition-colors">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[13px] font-bold text-[var(--pf-ink)] line-clamp-1">{p.title}</span>
                <span className="text-[9px] font-mono text-[#9A9482] shrink-0">{p.date}</span>
              </div>
              <p className="text-[11px] text-[#5A5A4A] line-clamp-2 mt-0.5">{p.todayInMyWords}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

/* ── Detail: caption + exact source navigation; internal image direction hidden */
const LittleMemoryDetail: React.FC<{
  lm: LittleMemory;
  onClose: () => void;
  onDelete: (lm: LittleMemory) => Promise<void>;
  onGenerate?: (lm: LittleMemory) => Promise<void>;
  loadImage?: (lm: LittleMemory) => Promise<string>;
  onOpenDiaryPage: (pageId: string) => void;
  onOpenSeed: (seedId: string) => void;
  isDiaryAvailable: (pageId: string) => boolean;
  isSeedAvailable: (seedId: string) => boolean;
}> = ({ lm, onClose, onDelete, onGenerate, loadImage, onOpenDiaryPage, onOpenSeed, isDiaryAvailable, isSeedAvailable }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareNotice, setShareNotice] = useState<string | null>(null);

  useEffect(() => { setConfirmDelete(false); setError(null); setGenError(null); setShareNotice(null); }, [lm]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const remove = async () => {
    setBusy(true); setError(null);
    try { await onDelete(lm); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not delete that yet. You can retry.'); setBusy(false); }
  };

  const generate = async () => {
    if (!onGenerate) return;
    setGenBusy(true); setGenError(null);
    try { await onGenerate(lm); }
    catch (err) { setGenError(err instanceof Error ? err.message : 'The illustration could not be created. Your saved memory is unchanged; you can retry.'); }
    finally { setGenBusy(false); }
  };

  const share = async () => {
    if (shareBusy) return;
    setShareBusy(true); setShareNotice(null);
    try {
      const outcome = await shareLittleMemory(lm, {
        navigator,
        appUrl: window.location.origin,
        loadImage: loadImage ? () => loadImage(lm) : undefined,
        fetchBlob: async (url) => {
          const response = await fetch(url);
          if (!response.ok) throw new Error('Could not prepare the illustration for sharing.');
          return response.blob();
        },
        makeFile: (blob, name) => new File([blob], name, { type: blob.type || 'image/png' }),
        revokeUrl: (url) => URL.revokeObjectURL(url),
      });
      if (outcome === 'shared_image') setShareNotice('Shared with the illustration.');
      else if (outcome === 'shared_text') setShareNotice('Shared the caption and app link.');
      else if (outcome === 'copied') setShareNotice('Caption and app link copied.');
    } catch (err) {
      setShareNotice(err instanceof Error ? err.message : 'Could not open sharing just now.');
    } finally {
      setShareBusy(false);
    }
  };

  // P0-3: the current usable illustration and the pending attempt are independent.
  const cur = currentImageStatus(lm);               // 'none' | 'ready' | 'stale'
  const hasImage = cur !== 'none';
  const generating = genBusy || isGenerating(lm);   // a replacement/first attempt in flight
  const failed = pendingFailed(lm);                 // the last attempt failed (image, if any, preserved)
  const diaryRefs = (lm.sourceRefs ?? []).filter((r) => r.kind === 'diaryPage');
  const seedRefs = (lm.sourceRefs ?? []).filter((r) => r.kind === 'memorySeed');

  return (
    <div role="dialog" aria-modal="true" aria-label="Little Memory detail"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[rgba(20,28,43,0.5)] backdrop-blur-sm p-0 sm:p-4" onClick={onClose}>
      <div id="little-memory-detail" onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto bg-[var(--pf-paper)] rounded-t-3xl sm:rounded-3xl border pf-hairline shadow-2xl">
        <div className="sticky top-0 z-[1] flex items-center justify-between px-4 py-3 border-b pf-hairline bg-[var(--pf-paper)]">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles className="w-4 h-4 text-[var(--pf-brass)] shrink-0" />
            <span className="text-sm font-semibold text-[var(--pf-ink)] truncate">{lm.title}</span>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-[#7A7A6A] hover:text-[var(--pf-ink)] hover:bg-[var(--pf-paper-2)]"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-4 py-4 space-y-3">
          {/* PF-CORE-03B illustration panel. The current image (if any) stays viewable
              even while a replacement is generating or after one fails (P0-3). */}
          <div id="lm-detail-illustration" className="space-y-2">
            {hasImage && loadImage ? (
              <>
                <AuthImage id="lm-detail-image" load={() => loadImage(lm)} reloadKey={imageReloadKey(lm)} alt={`Illustration for ${lm.title}`} tall />
                {cur === 'stale' ? (
                  <p id="lm-illustration-stale" className="text-[10px] text-[#9A5A3A] inline-flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Made from an earlier version — regenerate to reflect the latest memory.</p>
                ) : (
                  <p className="text-[10px] text-[#8A8471]">AI-generated from your saved memory.</p>
                )}
                {generating && (
                  <p id="lm-illustration-generating" className="text-[10px] text-[#7A6E4E] inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Midnight is painting a new version… your current picture stays until it’s ready.</p>
                )}
                {failed && !generating && (
                  <p id="lm-illustration-replace-failed" className="text-[10px] text-[#8C3232] inline-flex items-center gap-1"><AlertCircle className="w-3 h-3" /> The new version didn’t generate — your current illustration is unchanged. You can try again.</p>
                )}
              </>
            ) : generating ? (
              <div id="lm-illustration-generating" className="rounded-xl border border-dashed border-[#D8CEB6] bg-[#F7F4EC]/70 h-56 flex flex-col items-center justify-center gap-2 text-center">
                <Loader2 className="w-6 h-6 animate-spin text-[#9A8F72]" />
                <span className="text-[11px] font-semibold text-[#7A6E4E]">Midnight is painting this memory…</span>
                <span className="text-[9px] text-[#B0A98F]">A little scene is taking shape.</span>
              </div>
            ) : (
              <PendingCanvas id="lm-detail-pending" tall />
            )}

            {genError && <p id="lm-illustration-error" className="text-[11px] text-[#8C3232]">{genError}</p>}

            {onGenerate && !generating && (
              failed ? (
                <button id="lm-generate-retry-btn" onClick={generate}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-full bg-[var(--pf-forest)] hover:bg-[var(--pf-forest-deep)] text-[var(--pf-cream)] text-xs font-semibold shadow-xs">
                  <RefreshCw className="w-3.5 h-3.5" /> Try creating it again
                </button>
              ) : hasImage ? (
                <button id="lm-regenerate-btn" onClick={generate}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-full border pf-hairline text-[var(--pf-ink)] hover:bg-[var(--pf-paper-2)] text-xs font-semibold">
                  <RefreshCw className="w-3.5 h-3.5" /> {cur === 'stale' ? 'Regenerate from this memory' : 'Regenerate this illustration'}
                </button>
              ) : (
                <button id="lm-generate-btn" onClick={generate}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-full bg-[var(--pf-forest)] hover:bg-[var(--pf-forest-deep)] text-[var(--pf-cream)] text-xs font-semibold shadow-xs">
                  <Wand2 className="w-3.5 h-3.5" /> Create illustration
                </button>
              )
            )}
            {onGenerate && !hasImage && !failed && !generating && (
              <p className="text-[9px] text-[#9A9482] text-center">Creates one AI illustration from this saved memory. It may take a moment.</p>
            )}
            {hasImage && loadImage && (
              <div className="space-y-1.5 pt-1">
                <button id="lm-share-btn" onClick={share} disabled={shareBusy}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-full bg-[#EAE2CC] hover:bg-[#DFD2B4] text-[var(--pf-ink)] text-xs font-semibold border border-[#D8C79C] disabled:opacity-60">
                  {shareNotice?.startsWith('Shared') || shareNotice?.includes('copied')
                    ? <Check className="w-3.5 h-3.5" />
                    : <Share2 className="w-3.5 h-3.5" />}
                  {shareBusy ? 'Preparing…' : 'Share this memory'}
                </button>
                <p className="text-[9px] text-[#8A8471] text-center">Shares the illustration and caption when supported. Your source records stay private.</p>
                {shareNotice && <p id="lm-share-notice" aria-live="polite" className="text-[10px] text-center text-[var(--pf-forest-deep)]">{shareNotice}</p>}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {(() => { const [cls, label] = STATUS_BADGE[resolveImageStatus(lm)] ?? STATUS_BADGE.not_generated; return <span id="lm-detail-status" className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${cls}`}>{label}</span>; })()}
            <span className="text-[9px] text-[#8A8471]">Saved by you · {lm.date}</span>
          </div>

          <blockquote id="lm-detail-caption" className="rounded-2xl border pf-hairline bg-white/70 px-4 py-4 text-[15px] italic leading-relaxed text-[#4A4A3A]" style={{ fontFamily: '"Playfair Display", Georgia, serif' }}>
            “{lm.caption}”
          </blockquote>

          <div className="rounded-xl bg-[var(--pf-paper-2)]/60 border pf-hairline px-3 py-2.5 space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#8A8A78]">Grown from your own records</p>
              {diaryRefs.map((r) => {
                const available = r.availability === 'available' && isDiaryAvailable(r.id);
                return (
                  <div key={`d-${r.id}`} className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-[#5A5A4A] min-w-0 truncate">Diary page · {r.label}</span>
                    {available ? (
                      <button id={`lm-detail-source-diaryPage-${r.id}`} onClick={() => onOpenDiaryPage(r.id)}
                        className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--pf-forest-deep)] hover:underline shrink-0"><ArrowUpRight className="w-3 h-3" /> Open</button>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] text-[#9A5A3A] shrink-0"><AlertCircle className="w-3 h-3" /> source unavailable</span>
                    )}
                  </div>
                );
              })}
              {seedRefs.map((r) => {
                const available = r.availability === 'available' && isSeedAvailable(r.id);
                return (
                  <div key={`s-${r.id}`} className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-[#5A5A4A] min-w-0 truncate">Memory seed · {r.label}</span>
                    {available ? (
                      <button id={`lm-detail-source-memorySeed-${r.id}`} onClick={() => onOpenSeed(r.id)}
                        className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--pf-forest-deep)] hover:underline shrink-0"><ArrowUpRight className="w-3 h-3" /> Open</button>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] text-[#9A5A3A] shrink-0"><AlertCircle className="w-3 h-3" /> source unavailable</span>
                    )}
                  </div>
                );
              })}
          </div>

          {error && <p id="lm-detail-error" className="text-xs text-[#8C3232]">{error}</p>}

          <div className="flex items-center gap-2 pt-1 border-t pf-hairline flex-wrap">
            {confirmDelete ? (
                  <span className="inline-flex items-center gap-1.5 ml-auto">
                    <span className="text-[10px] text-[#8C3232]">Delete this Little Memory?</span>
                    <button id="lm-detail-delete-confirm-btn" onClick={remove} disabled={busy}
                      className="px-2.5 py-1.5 rounded-xl text-[11px] font-semibold bg-[#8C3232] hover:bg-[#722727] text-white disabled:opacity-50">{busy ? 'Deleting…' : 'Delete'}</button>
                    <button onClick={() => setConfirmDelete(false)} disabled={busy} className="px-2 py-1.5 rounded-xl text-[11px] text-[#555546] hover:bg-[#FAF8F2]">No</button>
                  </span>
            ) : (
                  <button id="lm-detail-delete-btn" onClick={() => setConfirmDelete(true)} disabled={busy}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold text-[#8C3232] border border-[#E8C9C9] hover:bg-[#FBEFEF] ml-auto"><Trash2 className="w-3 h-3" /> Delete</button>
            )}
          </div>
          <p className="text-[9px] text-[#9A9482]">Deleting a Little Memory never changes the Diary Page or Memory Seeds it grew from.</p>
        </div>
      </div>
    </div>
  );
};

const STATUS_BADGE: Record<string, [string, string]> = {
  not_generated: ['bg-[#F1ECE0] text-[#8A7A55]', 'Illustration not generated'],
  generating: ['bg-[#EAE6D6] text-[#7A6E4E]', 'Midnight is painting…'],
  ready: ['bg-[#E7EFE0] text-[#3F5A31]', 'Illustration ready'],
  stale: ['bg-[#FBF0EC] text-[#9A5A3A]', 'Ready · memory updated since'],
  failed: ['bg-[#FBEFEF] text-[#8C3232]', 'Illustration didn’t generate'],
};
const CardStatusBadge: React.FC<{ lm: LittleMemory }> = ({ lm }) => {
  const [cls, label] = STATUS_BADGE[resolveImageStatus(lm)] ?? STATUS_BADGE.not_generated;
  return <span id={`lm-card-status-${lm.id}`} className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${cls}`}>{label}</span>;
};
