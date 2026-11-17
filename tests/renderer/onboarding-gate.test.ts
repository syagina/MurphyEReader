import { describe, expect, it } from 'vitest';
import { resolveOnboardingVisibility } from '@renderer/lib/onboarding';

describe('resolveOnboardingVisibility', () => {
  it('未看过时返回 open', async () => {
    await expect(
      resolveOnboardingVisibility(async () => ({ onboarded: false })),
    ).resolves.toBe('open');
  });

  it('已看过时返回 closed', async () => {
    await expect(
      resolveOnboardingVisibility(async () => ({ onboarded: true })),
    ).resolves.toBe('closed');
  });

  it('查询失败时返回 closed，不阻塞应用', async () => {
    await expect(
      resolveOnboardingVisibility(async () => {
        throw new Error('db unavailable');
      }),
    ).resolves.toBe('closed');
  });
});
