import React, { useState, useEffect } from 'react';
import { DiaryPage, FamiliarProfile, MemorySeed } from '../types';
import { MIDNIGHT_ORIGIN, FORM_PRESENTATION } from '../lib/familiar-origin';
import { isKeeperReady, readinessPhase, READINESS_COPY } from '../lib/keeper-readiness';
import { FAMILIAR_ART, FAMILIAR_ALT, KEEPER_ART } from '../lib/brand';
import { Sprout, Leaf, Sparkles, Pencil, RotateCcw, Trash2, ArrowUpRight, AlertTriangle, Check, X, ChevronRight, Lock } from 'lucide-react';

/**
 * PF-CORE-01 V1 visual integration: the Familiar route rendered as an
 * illustrated product chapter, not a management dashboard. Composition follows
 * the accepted Pocket Familiar V1 language and the v0.1 Journal desk:
 *   BASE  — a night-garden / archive scene (pf-garden atmosphere + decor);
 *   TOP   — the transparent Companion / Keeper character, inhabiting the scene
 *           as the dominant focal point;
 *   PAPER — a warm-paper sheet that overlaps the lower edge (pf-sheet-overlap),
 *           carrying the chapter, one human sentence and ONE primary action.
 * Behavior, endpoints, selectors and identity are unchanged from d889b5c — this
 * is composition and information architecture only.
 */

interface Props {
  profile: FamiliarProfile | null;
  seeds: MemorySeed[];
  diaryPages: DiaryPage[];
  reducedMotion?: boolean;
  onProposeSeedFromPage: (page: DiaryPage) => void;
  onSaveSeedText: (seed: MemorySeed, text: string) => Promise<void>;
  onRevokeSeed: (seed: MemorySeed) => Promise<void>;
  /** Opens the stale-safe seed-deletion review (server preview → confirm). */
  onRequestSeedDeletion: (seed: MemorySeed) => void;
  onOpenSource: (pageId: string) => void;
  isSourceAvailable: (pageId: string) => boolean;
  onRequestSourceDeletion: (page: DiaryPage) => void;
  onBeginKeeper: () => Promise<void>;
  /** P1b: when set, open/focus this exact seed (e.g. from a Little Memory source link). */
  focusSeedId?: string | null;
  onFocusConsumed?: () => void;
}

/** Small brass four-point constellation — a quiet identity mark, not a score. */
const Constellation: React.FC<{ reducedMotion?: boolean; className?: string }> = ({ reducedMotion, className }) => (
  <svg width="34" height="34" viewBox="0 0 52 52" aria-hidden="true" className={className}>
    <g stroke="var(--pf-brass-soft)" strokeWidth="1" opacity="0.65">
      <line x1="26" y1="8" x2="14" y2="26" /><line x1="26" y1="8" x2="38" y2="26" />
      <line x1="14" y1="26" x2="26" y2="44" /><line x1="38" y1="26" x2="26" y2="44" />
    </g>
    {[[26, 8], [14, 26], [38, 26], [26, 44]].map(([cx, cy], i) => (
      <circle key={i} cx={cx} cy={cy} r="2.4" fill="var(--pf-brass)" className={reducedMotion ? '' : 'pf-twinkle'} />
    ))}
  </svg>
);

/** Decorative night-garden flecks — never required to read state, never block input. */
const SceneDecor: React.FC<{ reducedMotion?: boolean }> = ({ reducedMotion }) => (
  <div className="pf-decor absolute inset-0 overflow-hidden" aria-hidden="true">
    {[
      { top: '14%', left: '12%' }, { top: '22%', left: '82%' }, { top: '38%', left: '62%' }, { top: '10%', left: '46%' },
    ].map((p, i) => (
      <span key={i} className={`absolute w-1 h-1 rounded-full bg-[var(--pf-brass-soft)] ${reducedMotion ? 'opacity-60' : 'pf-twinkle'}`} style={p} />
    ))}
    <Leaf className="absolute -left-2 bottom-2 w-10 h-10 text-[var(--pf-moss)] opacity-25 -rotate-12" />
    <Leaf className="absolute right-1 top-2 w-8 h-8 text-[var(--pf-moss)] opacity-20 rotate-45" />
  </div>
);

export const FamiliarHome: React.FC<Props> = ({
  profile, seeds, diaryPages, reducedMotion = false,
  onProposeSeedFromPage, onSaveSeedText, onRevokeSeed, onRequestSeedDeletion,
  onOpenSource, isSourceAvailable, onRequestSourceDeletion, onBeginKeeper,
  focusSeedId, onFocusConsumed,
}) => {
  const stage = profile?.stage ?? 'companion';
  const form = FORM_PRESENTATION[stage];
  const active = seeds.filter((s) => s.status === 'active');
  const revoked = seeds.filter((s) => s.status === 'revoked');
  const ready = isKeeperReady(seeds);
  const phase = readinessPhase(seeds);

  const [ceremony, setCeremony] = useState(false);
  const [busyKeeper, setBusyKeeper] = useState(false);
  const [openSeedId, setOpenSeedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [busySeedId, setBusySeedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });

  // P1b: open/focus the EXACT seed requested from elsewhere (e.g. a Little Memory
  // source link). Active seeds are expanded; a revoked seed is scrolled to and
  // briefly highlighted. Availability is existence, so revoked seeds focus too.
  const [flashSeedId, setFlashSeedId] = useState<string | null>(null);
  useEffect(() => {
    if (!focusSeedId) return;
    const target = seeds.find((s) => s.id === focusSeedId);
    if (target) {
      if (target.status === 'active') setOpenSeedId(focusSeedId);
      setFlashSeedId(focusSeedId);
      // Let the seed render/expand before scrolling to it.
      requestAnimationFrame(() => scrollTo(`seed-card-${focusSeedId}`));
      const t = setTimeout(() => setFlashSeedId(null), 2000);
      onFocusConsumed?.();
      return () => clearTimeout(t);
    }
    onFocusConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSeedId]);

  const beginKeeper = async () => {
    setBusyKeeper(true); setActionError(null);
    try { await onBeginKeeper(); setCeremony(false); }
    catch (err) { setActionError(err instanceof Error ? err.message : 'The Keeper chapter could not begin. You can try again.'); }
    finally { setBusyKeeper(false); }
  };
  const saveEdit = async (seed: MemorySeed) => {
    if (!editText.trim()) return;
    setBusySeedId(seed.id ?? null); setActionError(null);
    try { await onSaveSeedText(seed, editText.trim()); setEditingId(null); }
    catch (err) { setActionError(err instanceof Error ? err.message : 'That edit did not go through. You can try again.'); }
    finally { setBusySeedId(null); }
  };
  const runSeedAction = async (seed: MemorySeed, fn: (s: MemorySeed) => Promise<void>, label: string) => {
    setBusySeedId(seed.id ?? null); setActionError(null);
    try { await fn(seed); }
    catch (err) { setActionError(err instanceof Error ? err.message : `That ${label} did not go through. You can try again.`); }
    finally { setBusySeedId(null); }
  };

  const characterSrc = stage === 'keeper' ? KEEPER_ART.neutral : FAMILIAR_ART.quiet;
  const characterAlt = stage === 'keeper' ? 'Midnight in Keeper form, at home in the night garden' : FAMILIAR_ALT.quiet;

  return (
    <div id="familiar-home" className="pf-stage pf-page-frame space-y-5">
      {actionError && (
        <div id="familiar-action-error" role="alert" className="rounded-2xl bg-[#FBEFEF] border border-[#E7C9C9] px-3.5 py-2.5 text-xs text-[#8C3232] flex items-center justify-between gap-2">
          <span className="min-w-0">{actionError}</span>
          <button onClick={() => setActionError(null)} aria-label="Dismiss" className="shrink-0 p-1 rounded hover:bg-[#F6E3E3]"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* ── Chapter hero: night-garden scene + character + overlapping paper ─── */}
      <section id="familiar-identity" data-stage={stage} data-origin={profile?.originId ?? 'midnight'} className="pf-journal-stage">
        <div className="pf-journal-scene pf-garden rounded-t-[28px] overflow-hidden border pf-hairline border-b-0 relative h-72 sm:h-80">
          <SceneDecor reducedMotion={reducedMotion} />

          {/* Locked Keeper preview — a distant, obscured future form inside the scene. */}
          {stage === 'companion' && !ceremony && (
            <div className="absolute right-4 top-5 flex flex-col items-center gap-1 w-24 text-center pf-decor">
              <img
                id="familiar-keeper-silhouette"
                src={KEEPER_ART.silhouette}
                alt="A distant, still-hidden Keeper form"
                className={`w-16 h-auto object-contain ${ready ? 'opacity-70' : 'opacity-35'}`}
                style={{ filter: ready ? 'none' : 'blur(1.5px)' }}
                draggable={false}
              />
              <span className="inline-flex items-center gap-1 text-[9px] text-[var(--pf-moon)]/80">
                {!ready && <Lock className="w-2.5 h-2.5" />} a future chapter
              </span>
            </div>
          )}

          {/* The character inhabits the scene as the dominant focal point (~1/3+). */}
          <div className={`absolute inset-x-0 bottom-1 flex items-end justify-center pointer-events-none ${stage === 'keeper' ? 'h-[95%]' : 'h-[74%]'}`}>
            <img
              id={stage === 'keeper' ? 'familiar-keeper-portrait' : 'familiar-companion-portrait'}
              src={characterSrc}
              alt={characterAlt}
              draggable={false}
              className={`h-full w-auto max-w-full object-contain select-none drop-shadow-[0_12px_24px_rgba(16,21,31,0.5)] ${reducedMotion ? '' : 'pf-float'}`}
            />
          </div>

          <Constellation reducedMotion={reducedMotion} className="absolute left-4 top-4" />
          <div className="pf-night-veil absolute inset-x-0 bottom-0 h-24" aria-hidden="true" />
        </div>

        {/* Warm-paper chapter sheet rising over the scene's lower edge. */}
        <div className="pf-sheet pf-sheet-overlap rounded-[26px] border pf-hairline px-5 py-4 mx-1 shadow-lg">
          <div className="flex items-center gap-2">
            <h2 className="text-xl text-[var(--pf-ink)]" style={{ fontFamily: '"Playfair Display", Georgia, serif' }}>{MIDNIGHT_ORIGIN.name}</h2>
            <span id="familiar-form-label" className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--pf-paper-2)] text-[var(--pf-forest-deep)] border pf-hairline">{form.form} chapter</span>
          </div>
          <p id="familiar-growth-motif" className="mt-2 text-sm text-[#4A4A3A] leading-relaxed" style={{ fontFamily: '"Playfair Display", Georgia, serif' }}>
            {stage === 'keeper' ? form.note : READINESS_COPY[phase]}
          </p>

          {/* ONE primary action. Secondary lives below the fold. */}
          <div className="mt-3.5">
            {stage === 'companion' && ready && !ceremony && (
              <button id="familiar-begin-keeper-btn" onClick={() => { setActionError(null); setCeremony(true); }}
                className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-full bg-[var(--pf-brass)] hover:bg-[var(--pf-brass-soft)] text-[#1E2A38] text-sm font-bold shadow-xs transition-colors">
                <Sparkles className="w-4 h-4" /> Begin the Keeper chapter
              </button>
            )}
            {stage === 'companion' && !ready && !ceremony && (
              <button onClick={() => scrollTo('familiar-grow')}
                className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-full bg-[var(--pf-forest)] hover:bg-[var(--pf-forest-deep)] text-[var(--pf-cream)] text-sm font-semibold shadow-xs transition-colors">
                <Sprout className="w-4 h-4" /> Grow a memory
              </button>
            )}
            {stage === 'keeper' && (
              <p id="familiar-form-history" className="text-[11px] text-[#8A8471]">Earlier form: <span className="font-semibold text-[var(--pf-forest-deep)]">Companion</span> — kept intact.</p>
            )}
          </div>
        </div>
      </section>

      {/* ── Keeper transformation: a deliberate full moment ─────────────────── */}
      {stage === 'companion' && ready && ceremony && (
        <section id="familiar-keeper-ceremony" role="dialog" aria-label="Begin the Keeper chapter"
          className="pf-garden rounded-[28px] border border-[rgba(216,190,134,0.45)] overflow-hidden relative">
          <div className="absolute inset-0 bg-[rgba(16,21,31,0.55)]" aria-hidden="true" />
          <SceneDecor reducedMotion={reducedMotion} />
          <div className="relative px-5 pt-5 pb-6 flex flex-col items-center text-center">
            <img id="familiar-keeper-reveal" src={KEEPER_ART.reveal} alt="Midnight revealed in Keeper form"
              draggable={false} className={`h-56 sm:h-64 object-contain drop-shadow-[0_16px_30px_rgba(0,0,0,0.5)] ${reducedMotion ? '' : 'pf-float'}`} />
            <p className="mt-2 text-lg text-[#F0E4C8]" style={{ fontFamily: '"Playfair Display", Georgia, serif' }}>A deliberate step</p>
            <p className="mt-1.5 text-xs text-[var(--pf-moon)] leading-relaxed max-w-sm">
              Midnight will grow from Companion into a Keeper — the same amber-eyed, leaf-marked soul, in a fuller form. Your
              Companion form and every page you kept stay exactly as they are. This is your choice, now or later.
            </p>
            <div className="mt-4 w-full max-w-xs space-y-2">
              <button id="familiar-keeper-confirm-btn" onClick={beginKeeper} disabled={busyKeeper}
                className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-full bg-[var(--pf-brass)] hover:bg-[var(--pf-brass-soft)] disabled:opacity-50 text-[#1E2A38] text-sm font-bold">
                <Check className="w-4 h-4" /> Yes, begin the Keeper chapter
              </button>
              <button id="familiar-keeper-stay-btn" onClick={() => setCeremony(false)} disabled={busyKeeper}
                className="w-full px-4 py-2 rounded-full text-xs font-semibold text-[var(--pf-moon)] hover:text-[#F0E4C8]">
                Stay in Companion form for now
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ── Memories the familiar holds — a small archive of kept paper slips ── */}
      <section id="memory-seed-library" aria-label="Memories your familiar holds">
        <div className="flex items-center gap-2 mb-3 px-1">
          {stage === 'keeper'
            ? <img src={KEEPER_ART.holdingJournal} alt="" aria-hidden="true" className="w-7 h-7 object-contain" draggable={false} />
            : <Leaf className="w-4 h-4 text-[var(--pf-forest)]" />}
          <h3 className="text-sm font-semibold text-[var(--pf-ink)]" style={{ fontFamily: '"Playfair Display", Georgia, serif' }}>Memories your familiar holds</h3>
        </div>

        {active.length === 0 && revoked.length === 0 && (
          <p id="memory-seed-empty" className="text-xs text-[#6A6A5A] rounded-2xl border pf-hairline bg-white/60 px-4 py-8 text-center leading-relaxed">
            No memories kept yet.<br />When a page holds something worth remembering, grow a seed from it below.
          </p>
        )}

        {/* kept-paper slips (not a CRUD table): tap a slip to open its quiet controls */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {active.map((seed) => {
            const ref = seed.sourceRefs.find((r) => r.kind === 'diaryPage');
            const available = ref ? isSourceAvailable(ref.id) && ref.availability === 'available' : false;
            const busy = busySeedId === seed.id;
            const open = openSeedId === seed.id;
            return (
              <div key={seed.id} id={`seed-card-${seed.id}`} data-seed-id={seed.id} data-seed-status={seed.status}
                className={`memory-seed-card pf-note rounded-2xl border shadow-2xs overflow-hidden ${flashSeedId === seed.id ? 'ring-2 ring-[var(--pf-brass)] border-[var(--pf-brass)]' : 'pf-hairline'}`}>
                {editingId === seed.id ? (
                  <div className="p-3.5 space-y-2">
                    <textarea className="w-full rounded-xl border pf-hairline bg-white px-3 py-2 text-sm text-[var(--pf-ink)] resize-none focus:outline-none focus:ring-2 focus:ring-[rgba(124,138,106,0.4)]"
                      rows={3} maxLength={280} value={editText} onChange={(e) => setEditText(e.target.value)} />
                    <div className="flex items-center gap-2">
                      <button className="memory-seed-save-edit-btn inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-[var(--pf-forest)] hover:bg-[var(--pf-forest-deep)] disabled:opacity-50 text-[var(--pf-cream)] text-xs font-semibold"
                        disabled={busy || !editText.trim()} onClick={() => saveEdit(seed)}><Check className="w-3.5 h-3.5" /> Save</button>
                      <button className="px-3 py-1.5 rounded-full text-xs font-semibold text-[#7A7A6A] hover:text-[var(--pf-ink)]" onClick={() => setEditingId(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      className="memory-seed-open-btn w-full text-left px-3.5 py-3"
                      aria-expanded={open}
                      onClick={() => setOpenSeedId(open ? null : (seed.id ?? null))}
                    >
                      <p className="memory-seed-card-text text-sm text-[var(--pf-ink)] leading-relaxed" style={{ fontFamily: '"Playfair Display", Georgia, serif' }}>“{seed.text}”</p>
                      <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-[#8A8A78]">
                        <Leaf className="w-3 h-3 text-[var(--pf-moss)]" /> Kept from {seed.sourceDate}
                        {seed.editedByUser && <span className="text-[#9A9A88]">· edited</span>}
                        <ChevronRight className={`w-3 h-3 ml-auto transition-transform ${open ? 'rotate-90' : ''}`} />
                      </div>
                    </button>
                    {open && (
                      <div className="px-3.5 pb-3 pt-1 border-t pf-hairline flex items-center justify-between gap-2 flex-wrap bg-white/40">
                        {available ? (
                          <button className="memory-seed-source-link inline-flex items-center gap-0.5 text-[11px] text-[var(--pf-forest)] font-semibold hover:underline" onClick={() => ref && onOpenSource(ref.id)}>
                            View source page <ArrowUpRight className="w-3 h-3" />
                          </button>
                        ) : (
                          <span className="memory-seed-source-unavailable inline-flex items-center gap-1 text-[11px] text-[#9A8A6A]"><AlertTriangle className="w-3 h-3" /> source unavailable</span>
                        )}
                        <div className="flex items-center gap-1">
                          <button className="memory-seed-edit-card-btn p-1.5 rounded-lg text-[#7A7A6A] hover:text-[var(--pf-ink)] hover:bg-[var(--pf-paper-2)] disabled:opacity-40" title="Edit" aria-label="Edit this memory" disabled={busy}
                            onClick={() => { setEditingId(seed.id ?? null); setEditText(seed.text); }}><Pencil className="w-3.5 h-3.5" /></button>
                          <button className="memory-seed-revoke-btn p-1.5 rounded-lg text-[#7A7A6A] hover:text-[#8C6527] hover:bg-[#FAF4E8] disabled:opacity-40" title="Stop holding this (keeps the source page)" aria-label="Stop holding this memory" disabled={busy}
                            onClick={() => runSeedAction(seed, onRevokeSeed, 'change')}><RotateCcw className="w-3.5 h-3.5" /></button>
                          <button className="memory-seed-delete-btn p-1.5 rounded-lg text-[#7A7A6A] hover:text-[#8C3232] hover:bg-[#FBEFEF] disabled:opacity-40" title="Delete this memory" aria-label="Delete this memory" disabled={busy}
                            onClick={() => onRequestSeedDeletion(seed)}><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>

        {revoked.length > 0 && (
          <div className="mt-4">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#9A9A88] mb-2 px-1">No longer held</p>
            <ul className="space-y-2">
              {revoked.map((seed) => (
                <li key={seed.id} id={`seed-card-${seed.id}`} data-seed-id={seed.id} data-seed-status={seed.status}
                  className={`memory-seed-card-revoked rounded-2xl border bg-[var(--pf-paper-2)]/40 px-4 py-2.5 flex items-center justify-between gap-2 ${flashSeedId === seed.id ? 'ring-2 ring-[var(--pf-brass)] border-[var(--pf-brass)]' : 'pf-hairline'}`}>
                  <p className="text-xs text-[#8A8A78] italic truncate">{seed.text}</p>
                  <button className="memory-seed-delete-btn p-1.5 rounded-lg text-[#9A9A88] hover:text-[#8C3232] hover:bg-[#FBEFEF] shrink-0 disabled:opacity-40" title="Delete permanently" aria-label="Delete permanently"
                    disabled={busySeedId === seed.id} onClick={() => onRequestSeedDeletion(seed)}><Trash2 className="w-3.5 h-3.5" /></button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* ── Grow a memory from a kept page ─────────────────────────────────── */}
      <section id="familiar-grow" aria-label="Grow a memory from a diary page">
        <div className="flex items-center gap-2 mb-3 px-1">
          <Sprout className="w-4 h-4 text-[var(--pf-forest)]" />
          <h3 className="text-sm font-semibold text-[var(--pf-ink)]" style={{ fontFamily: '"Playfair Display", Georgia, serif' }}>Grow a memory from a kept page</h3>
        </div>
        {diaryPages.length === 0 ? (
          <p className="text-xs text-[#6A6A5A] rounded-2xl border pf-hairline bg-white/60 px-4 py-8 text-center">
            Keep a diary page first, and your familiar can help you notice what to remember.
          </p>
        ) : (
          <ul className="space-y-2">
            {diaryPages.map((page) => (
              <li key={page.id} data-page-id={page.id} className="familiar-grow-row pf-note rounded-2xl border pf-hairline px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--pf-ink)] truncate">{page.title}</p>
                  <p className="text-[10px] text-[#8A8A78]">{page.date}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button className="familiar-propose-seed-btn inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-[var(--pf-forest)] hover:bg-[var(--pf-forest-deep)] text-[var(--pf-cream)] text-xs font-semibold" onClick={() => onProposeSeedFromPage(page)}>
                    <Sprout className="w-3.5 h-3.5" /> Suggest a memory
                  </button>
                  <button className="familiar-delete-source-btn p-1.5 rounded-lg text-[#9AA08E] hover:text-[#8C3232] hover:bg-[#FBEFEF]" title="Delete this page" aria-label="Delete this diary page" onClick={() => onRequestSourceDeletion(page)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};
