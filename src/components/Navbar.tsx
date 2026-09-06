import React from 'react';
import { UserAuthProfile } from '../types';
import { SecurityBadge } from './SecurityBadge';
import { PenLine, LogOut, BookOpen, Home, Sprout, Sparkles } from 'lucide-react';
import { PRODUCT_NAME, FAMILIAR_HEAD } from '../lib/brand';

export type ActiveTab = 'journal' | 'memory' | 'familiar' | 'little';

interface NavbarProps {
  user: UserAuthProfile;
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  onNewEntry: () => void;
  onSignOut: () => void;
  memoryCount: number;
}

const TABS: Array<{ id: ActiveTab; label: string; icon: React.ElementType }> = [
  { id: 'journal', label: 'Journal', icon: Home },
  { id: 'memory', label: 'Memory', icon: BookOpen },
  { id: 'familiar', label: 'Familiar', icon: Sprout },
  { id: 'little', label: 'Little', icon: Sparkles },
];

export const Navbar: React.FC<NavbarProps> = ({ user, activeTab, onTabChange, onNewEntry, onSignOut, memoryCount }) => {
  return (
    <header className="pf-app-header z-40 bg-[color-mix(in_srgb,var(--pf-paper)_94%,transparent)] backdrop-blur-md border-b pf-hairline">
      <div className="pf-navbar mx-auto">
        <div className="pf-navbar-brand flex items-center gap-2 min-w-0">
          <img src={FAMILIAR_HEAD.ready} alt="" aria-hidden="true" width={30} height={30} className="w-8 h-8 object-contain shrink-0" draggable={false} />
          <span className="font-semibold text-[var(--pf-ink)] tracking-tight whitespace-nowrap" style={{ fontFamily: '"Playfair Display", Georgia, serif' }}>
            {PRODUCT_NAME}
          </span>
        </div>

        <nav className="pf-navbar-tabs bg-[color-mix(in_srgb,var(--pf-paper-2)_80%,white)] p-1 rounded-full border pf-hairline" aria-label="Main navigation">
          {TABS.map((t) => {
            const Icon = t.icon; const on = activeTab === t.id;
            const id = t.id === 'journal' ? 'nav-tab-workspace' : t.id === 'memory' ? 'nav-tab-memory' : t.id === 'familiar' ? 'nav-tab-familiar' : 'nav-tab-little';
            return (
              <button key={t.id} id={id} onClick={() => onTabChange(t.id)} aria-current={on ? 'page' : undefined}
                className={`pf-navbar-tab inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${
                  on ? 'bg-white text-[var(--pf-forest-deep)] shadow-xs' : 'text-[#6A6A5A] hover:text-[var(--pf-ink)]'}`}>
                <Icon className="w-3.5 h-3.5" /><span>{t.label}</span>
                {t.id === 'memory' && memoryCount > 0 && (
                  <span className="pf-nav-count px-1.5 rounded-full text-[10px] bg-[var(--pf-paper-2)] text-[#4A4A3A] font-bold border pf-hairline">{memoryCount}</span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="pf-navbar-actions flex items-center gap-1.5 sm:gap-2">
          <SecurityBadge />
          <button id="nav-new-entry-btn" onClick={onNewEntry} title="New entry" aria-label="New entry"
            className="inline-flex items-center justify-center w-9 h-9 sm:w-auto sm:px-3 sm:h-9 gap-1.5 rounded-full bg-[var(--pf-forest)] hover:bg-[var(--pf-forest-deep)] text-[var(--pf-cream)] text-xs font-semibold shadow-xs transition-colors">
            <PenLine className="w-3.5 h-3.5" /><span className="hidden sm:inline">New</span>
          </button>
          <div className="flex items-center gap-1.5 pl-1.5 border-l pf-hairline">
            {user.photoURL ? (
              <img src={user.photoURL} alt={user.displayName || 'You'} className="w-8 h-8 rounded-full ring-2 ring-[rgba(194,162,94,0.4)] object-cover" referrerPolicy="no-referrer" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-[var(--pf-ink)] text-[var(--pf-cream)] flex items-center justify-center font-bold text-xs">
                {user.displayName ? user.displayName.charAt(0).toUpperCase() : 'U'}
              </div>
            )}
            <button id="nav-logout-btn" onClick={onSignOut} title="Sign out" aria-label="Sign out" className="p-1.5 rounded-lg text-[#7A7A6A] hover:text-[#8C3232] hover:bg-[#FBEFEF] transition-colors">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
