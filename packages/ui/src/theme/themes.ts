// Theme definitions: typed access over the generated token object.
// Color values live in packages/ui/src/tokens/generated.ts — never here.
import { THEMES } from '../tokens/generated.js';

export type ThemeName = keyof typeof THEMES;
export type Theme = (typeof THEMES)[ThemeName];

export const THEME_NAMES = Object.keys(THEMES) as ThemeName[];
export const DEFAULT_THEME: ThemeName = 'brass-void';
export const LIGHT_THEME: ThemeName = 'parchment';

export function themeLabel(name: ThemeName): string {
  return THEMES[name].label;
}

export function isLight(name: ThemeName): boolean {
  return THEMES[name].kind === 'light';
}

export function colorOf(theme: ThemeName, key: keyof Theme['colors']): string {
  return THEMES[theme].colors[key];
}
