// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PAPER_TEXTURE_DEFAULT,
  normalizePaperTexture,
} from '@shared/appearance';
import {
  applyPaperTexture,
  PAPER_TEXTURE_CSS_VAR,
  PAPER_TEXTURE_STORAGE_KEY,
  readStoredPaperTexture,
} from '@renderer/lib/paper-texture';

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.style.removeProperty(PAPER_TEXTURE_CSS_VAR);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('normalizePaperTexture', () => {
  it('取整并夹紧到 0–100', () => {
    expect(normalizePaperTexture(45)).toBe(45);
    expect(normalizePaperTexture(72.6)).toBe(73);
    expect(normalizePaperTexture(-5)).toBe(0);
    expect(normalizePaperTexture(180)).toBe(100);
  });

  it('非有限值回退到默认强度', () => {
    expect(normalizePaperTexture(Number.NaN)).toBe(PAPER_TEXTURE_DEFAULT);
    expect(normalizePaperTexture(Number.POSITIVE_INFINITY)).toBe(
      PAPER_TEXTURE_DEFAULT,
    );
  });
});

describe('readStoredPaperTexture', () => {
  it('没有缓存时返回默认强度', () => {
    expect(readStoredPaperTexture()).toBe(PAPER_TEXTURE_DEFAULT);
  });

  it('返回缓存中的有效强度', () => {
    window.localStorage.setItem(PAPER_TEXTURE_STORAGE_KEY, '70');
    expect(readStoredPaperTexture()).toBe(70);
  });

  it('缓存值无效时回退到默认强度', () => {
    window.localStorage.setItem(PAPER_TEXTURE_STORAGE_KEY, 'grainy');
    expect(readStoredPaperTexture()).toBe(PAPER_TEXTURE_DEFAULT);
  });

  it('localStorage 读取抛错时回退到默认强度', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(readStoredPaperTexture()).toBe(PAPER_TEXTURE_DEFAULT);
  });
});

describe('applyPaperTexture', () => {
  it('写入 CSS 变量并缓存到 localStorage', () => {
    applyPaperTexture(72.6);

    expect(
      document.documentElement.style.getPropertyValue(PAPER_TEXTURE_CSS_VAR),
    ).toBe('73');
    expect(window.localStorage.getItem(PAPER_TEXTURE_STORAGE_KEY)).toBe('73');
  });

  it('超出范围时写入夹紧后的强度', () => {
    applyPaperTexture(-20);

    expect(
      document.documentElement.style.getPropertyValue(PAPER_TEXTURE_CSS_VAR),
    ).toBe('0');
  });

  it('缓存写入失败时仍应用当前页面强度', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    expect(() => applyPaperTexture(60)).not.toThrow();
    expect(
      document.documentElement.style.getPropertyValue(PAPER_TEXTURE_CSS_VAR),
    ).toBe('60');
  });
});
