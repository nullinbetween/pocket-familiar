import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Navbar } from '../src/components/Navbar';
import { MEMORY_COLUMNS, PRODUCT_NAME } from '../src/lib/brand';

describe('responsive signed-in shell', () => {
  it('keeps the full brand, all four destinations and privacy access in one shared header', () => {
    const html = renderToStaticMarkup(createElement(Navbar, {
      user: { uid: 'u1', displayName: 'Sora', email: 'sora@example.com', photoURL: null },
      activeTab: 'journal',
      onTabChange: () => {},
      onNewEntry: () => {},
      onSignOut: () => {},
      memoryCount: 5,
    }));

    expect(html).toContain(PRODUCT_NAME);
    expect(html).toContain('class="pf-navbar');
    expect(html).toContain('id="security-badge-toggle-btn"');
    expect(html.match(/id="nav-tab-/g)).toHaveLength(4);
  });

  it('defines every Memory column as a separate scene base and transparent familiar layer', () => {
    expect(MEMORY_COLUMNS).toHaveLength(3);
    for (const column of MEMORY_COLUMNS) {
      expect(column.scene).toMatch(/\/memory-columns\/(story|told|thought)\.jpg$/);
      expect(column.familiar).toMatch(/\/familiar\/(quiet|neutral|thinking)\.png$/);
      expect(column.scene).not.toBe(column.familiar);
    }
  });
});
