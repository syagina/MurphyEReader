export type OnboardingVisibility = 'open' | 'closed';

/**
 * 首次启动的轻量判断。查询失败时按已看过处理：应用可以正常打开，
 * 由现有错误横幅报告更具体的问题，而不是卡在品牌底上。
 */
export async function resolveOnboardingVisibility(
  getOnboarding: () => Promise<{ onboarded: boolean }>,
): Promise<OnboardingVisibility> {
  try {
    const state = await getOnboarding();
    return state.onboarded ? 'closed' : 'open';
  } catch {
    return 'closed';
  }
}
