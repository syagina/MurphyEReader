// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyTheme,
  DEFAULT_THEME,
  isThemeMode,
  readStoredTheme,
  THEME_STORAGE_KEY,
} from '@renderer/lib/theme';

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isThemeMode', () => {
  it('接受四种界面主题', () => {
    expect(isThemeMode('light')).toBe(true);
    expect(isThemeMode('dark')).toBe(true);
    expect(isThemeMode('eye-care')).toBe(true);
    expect(isThemeMode('paper')).toBe(true);
  });

  it('拒绝其他值', () => {
    expect(isThemeMode('solarized')).toBe(false);
    expect(isThemeMode('')).toBe(false);
    expect(isThemeMode(null)).toBe(false);
    expect(isThemeMode(undefined)).toBe(false);
  });
});

describe('readStoredTheme', () => {
  it('没有缓存时返回浅色', () => {
    expect(readStoredTheme()).toBe(DEFAULT_THEME);
  });

  it('返回缓存中的有效主题', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'eye-care');
    expect(readStoredTheme()).toBe('eye-care');
  });

  it('缓存值无效时回退到浅色', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'solarized');
    expect(readStoredTheme()).toBe(DEFAULT_THEME);
  });

  it('localStorage 读取抛错时回退到浅色', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(readStoredTheme()).toBe(DEFAULT_THEME);
  });
});

describe('applyTheme', () => {
  it('写入 data-theme 并缓存到 localStorage', () => {
    applyTheme('dark');

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('缓存写入失败时仍应用当前页面主题', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    expect(() => applyTheme('eye-care')).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe('eye-care');
  });
});
