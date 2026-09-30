/*
 * Pocket Familiar — prompt loader · PUBLIC SHOWCASE EDITION
 * Copyright (c) 2026 Meredith Cheung (nullinbetween). All rights reserved.
 *
 * System prompts are loaded from server/prompts/*.md at startup. They are not part
 * of the public showcase, so startup fails closed without them. See WITHHELD.md.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const PROMPTS_DIR = path.join(process.cwd(), 'server', 'prompts');

export function loadPrompt(name: string): string {
  const file = path.join(PROMPTS_DIR, `${name}.md`);
  if (!existsSync(file)) {
    throw new Error(`Prompt "${name}" is withheld from the public showcase. See WITHHELD.md.`);
  }
  return readFileSync(file, 'utf8');
}

export function loadPromptSet(name: string): Record<string, string> {
  return JSON.parse(loadPrompt(name)) as Record<string, string>;
}
