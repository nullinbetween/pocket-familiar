import React from 'react';
import { PRODUCT_NAME, BRAND_COPY, TRUST_COPY, LANDING_ART } from '../lib/brand';

interface LandingHeroProps {
  onSignIn: () => void;
  isLoading: boolean;
  error: string | null;
}

const GoogleG: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z" />
    <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z" />
    <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z" />
    <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z" />
  </svg>
);

export const LandingHero: React.FC<LandingHeroProps> = ({ onSignIn, isLoading, error }) => {
  return (
    <div className="relative min-h-screen overflow-hidden text-[var(--pf-paper)] flex flex-col">
      {/* Full-bleed night-garden art — familiar + journal as the emotional focus */}
      <img src={LANDING_ART.heroDesktop} alt="Pocket Familiar resting in a moonlit garden beside a closed journal"
        className="absolute inset-0 -z-10 w-full h-full object-cover object-[72%_center] lg:object-center" decoding="async" fetchPriority="high" />
      {/* One canonical CG at every width; only the crop changes. The lighter
          scrim keeps the illustration alive while maintaining text contrast. */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-[#10151F]/48 via-[#10151F]/18 to-[#10151F]/58 lg:bg-gradient-to-r lg:from-[#10151F]/72 lg:via-[#10151F]/24 lg:to-transparent" aria-hidden="true" />

      {/* Brand mark */}
      <header className="relative px-6 sm:px-10 pt-7">
        <span className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight" style={{ fontFamily: '"Playfair Display", Georgia, serif' }}>
          {PRODUCT_NAME}
        </span>
      </header>

      {/* Content — upper-centre on mobile, left cinematic column on desktop */}
      <main className="relative flex-1 flex flex-col justify-between px-6 sm:px-10 py-8">
        <div className="mt-8 lg:mt-16 max-w-lg mx-auto lg:mx-0 text-center lg:text-left">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-[1.08] tracking-tight drop-shadow"
            style={{ fontFamily: '"Playfair Display", Georgia, serif' }}>
            {PRODUCT_NAME}
          </h1>
          <p className="mt-4 text-lg sm:text-xl text-[color-mix(in_srgb,var(--pf-paper)_92%,transparent)] leading-snug">
            {BRAND_COPY.hero}
          </p>
        </div>

        <div className="max-w-lg mx-auto lg:mx-0 w-full text-center lg:text-left space-y-4">
          {error && (
            <div className="mx-auto lg:mx-0 max-w-sm p-3 rounded-xl bg-[#3a2020]/85 border border-[#8C5A5A] text-[#F4C9C9] text-xs font-medium">{error}</div>
          )}
          <button id="landing-google-signin-btn" onClick={onSignIn} disabled={isLoading}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-3 px-6 py-3.5 rounded-2xl bg-[var(--pf-paper)] hover:bg-white text-[var(--pf-ink)] font-semibold text-sm shadow-xl transition-all disabled:opacity-60">
            <GoogleG className="w-5 h-5 shrink-0" />
            <span>{isLoading ? 'Opening…' : BRAND_COPY.cta}</span>
          </button>
          <p className="inline-flex items-center gap-1.5 text-xs text-[color-mix(in_srgb,var(--pf-paper)_78%,transparent)] justify-center lg:justify-start w-full">
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>
            {TRUST_COPY.privateByDesign}
          </p>
        </div>
      </main>
    </div>
  );
};
