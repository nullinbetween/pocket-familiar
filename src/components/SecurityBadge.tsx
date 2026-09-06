import React, { useState } from 'react';
import { Lock, ChevronDown, ChevronUp, Check } from 'lucide-react';
import { TRUST_COPY } from '../lib/brand';

/**
 * Discreet trust affordance. Skin Round 1 moves security implementation detail
 * out of the primary visual hierarchy: no UID, rules expressions, RBAC labels
 * or engine/model language — only human reassurance about privacy.
 */
export const SecurityBadge: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative inline-block text-left shrink-0" id="security-badge-wrapper">
      <button
        id="security-badge-toggle-btn"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        className="pf-security-button inline-flex items-center justify-center gap-1.5 min-h-9 px-2 sm:px-3 py-1.5 rounded-full text-xs font-medium bg-[color-mix(in_srgb,var(--pf-paper-2)_75%,white)] text-[var(--pf-forest-deep)] border pf-hairline hover:bg-white transition-colors shadow-2xs"
        title="How your journal stays private"
      >
        <Lock className="w-3.5 h-3.5 text-[var(--pf-forest)] shrink-0" />
        <span className="pf-security-label font-semibold">{TRUST_COPY.privateByDesign}</span>
        <span className="sm:hidden sr-only">{TRUST_COPY.privateByDesign}</span>
        {isOpen ? <ChevronUp className="w-3 h-3 hidden sm:block" /> : <ChevronDown className="w-3 h-3 hidden sm:block" />}
      </button>

      {isOpen && (
        <div
          id="security-badge-popover"
          className="fixed left-3 right-3 top-[4.5rem] sm:absolute sm:left-auto sm:right-0 sm:top-auto sm:w-72 mt-2 rounded-2xl bg-white border pf-hairline shadow-xl p-4 z-50 text-[#38382E] text-xs space-y-2.5 animate-in fade-in zoom-in-95 duration-150"
        >
          <div className="flex items-center gap-2 font-semibold text-[var(--pf-ink)] text-sm border-b pf-hairline pb-2" style={{ fontFamily: '"Playfair Display", Georgia, serif' }}>
            <Lock className="w-4 h-4 text-[var(--pf-forest)]" />
            <span>Your journal, kept private</span>
          </div>
          <ul className="space-y-2">
            <li className="flex items-start gap-2">
              <Check className="w-3.5 h-3.5 text-[var(--pf-forest)] mt-0.5 shrink-0" />
              <span>{TRUST_COPY.onlyYou}.</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="w-3.5 h-3.5 text-[var(--pf-forest)] mt-0.5 shrink-0" />
              <span>{TRUST_COPY.approvalFirst}.</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="w-3.5 h-3.5 text-[var(--pf-forest)] mt-0.5 shrink-0" />
              <span>Your words stay yours — export or remove them whenever you like.</span>
            </li>
          </ul>
          <div className="pt-2 border-t pf-hairline text-[11px] text-[#7A7A6A] flex justify-between items-center">
            <span>{TRUST_COPY.gemini}</span>
            <button onClick={() => setIsOpen(false)} className="text-[#555546] hover:text-[var(--pf-ink)] font-medium px-2 py-0.5">
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
