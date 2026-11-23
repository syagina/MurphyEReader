import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEEPSEEK_API_KEY_URL,
  DEEPSEEK_BASE_URL,
  DEEPSEEK_CHAT_MODEL,
} from '@shared/ai-providers';
import type {
  AiProfile,
  AiProfileInput,
  AiSettingsInput,
  AiSpeedTestResult,
} from '@shared/types';
import { confirm } from '../../stores/confirm';
import { useSettingsStore } from '../../stores/settings';

export interface AiSettingsTabProps {
  onClose(): void;
}

const DEFAULT_TEMPERATURE_TEXT = '0.3';
const DEFAULT_TOKEN_BUDGET_TEXT = '100000';

function formatSeconds(ms: number | undefined): string {
  return ms === undefined ? '—' : `${(ms / 1000).toFixed(2)}s`;
}

function speedLabel(result: AiSpeedTestResult | undefined): string {
  if (result === undefined) {
    return '未测速';
  }
  if (!result.ok) {
    return `失败：${result.error ?? '未知错误'}`;
  }
  return `首字 ${formatSeconds(result.firstTokenMs)} · 总 ${formatSeconds(result.totalMs)}`;
}

/**
 * AI endpoint form inside the settings shell. Mounted for the lifetime of the
 * dialog (the inactive panel is only hidden), so an unsaved draft survives tab
 * switches. Profiles list, speed probes and the editor all live here; the API
 * key is never read back — blank means "keep the stored key".
 */
export function AiSettingsTab({ onClose }: AiSettingsTabProps): React.JSX.Element {
  const profiles = useSettingsStore((state) => state.profiles);
  const loading = useSettingsStore((state) => state.loading);
  const storeError = useSettingsStore((state) => state.error);
  const testing = useSettingsStore((state) => state.testing);
  const testingAll = useSettingsStore((state) => state.testingAll);
  const speedResults = useSettingsStore((state) => state.speedResults);
  const load = useSettingsStore((state) => state.load);
  const createProfile = useSettingsStore((state) => state.create);
  const updateProfile = useSettingsStore((state) => state.update);
  const removeProfile = useSettingsStore((state) => state.remove);
  const activateProfile = useSettingsStore((state) => state.activate);
  const testConnection = useSettingsStore((state) => state.test);
  const speedTestAll = useSettingsStore((state) => state.speedTestAll);
  const clearError = useSettingsStore((state) => state.clearError);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [chatModel, setChatModel] = useState('');
  const [visionModel, setVisionModel] = useState('');
  const [temperatureText, setTemperatureText] = useState(DEFAULT_TEMPERATURE_TEXT);
  const [tokenBudgetText, setTokenBudgetText] = useState(DEFAULT_TOKEN_BUDGET_TEXT);
  const [apiKey, setApiKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const loadedProfileId = useRef<number | null>(null);

  const selected = useMemo(
    () => profiles.find((profile) => profile.id === selectedId) ?? null,
    [profiles, selectedId],
  );
  const isNew = creating || selected === null;

  useEffect(() => {
    void load();
  }, [load]);

  // Default the selection to the active profile once profiles arrive.
  useEffect(() => {
    if (creating) {
      return;
    }
    if (selectedId !== null && profiles.some((profile) => profile.id === selectedId)) {
      return;
    }
    const next = profiles.find((profile) => profile.active) ?? profiles[0] ?? null;
    setSelectedId(next?.id ?? null);
  }, [profiles, selectedId, creating]);

  // Fill the form only when the selected profile changes, so background
  // reloads (activation, speed test bookkeeping) never clobber a draft.
  useEffect(() => {
    if (selected === null || loadedProfileId.current === selected.id) {
      return;
    }
    loadedProfileId.current = selected.id;
    setName(selected.name);
    setBaseUrl(selected.baseUrl);
    setChatModel(selected.chatModel);
    setVisionModel(selected.visionModel);
    setTemperatureText(String(selected.temperature));
    setTokenBudgetText(String(selected.tokenBudget));
    setApiKey('');
    setClearKey(false);
    setTestResult(null);
    setFormError(null);
    setSaveNotice(null);
  }, [selected]);

  /** Clears feedback that a field edit just made stale. */
  const touch = (): void => {
    setSaveNotice(null);
    setTestResult(null);
  };

  const resetForm = (): void => {
    setName('');
    setBaseUrl('');
    setChatModel('');
    setVisionModel('');
    setTemperatureText(DEFAULT_TEMPERATURE_TEXT);
    setTokenBudgetText(DEFAULT_TOKEN_BUDGET_TEXT);
    setApiKey('');
    setClearKey(false);
    setTestResult(null);
    setFormError(null);
    setSaveNotice(null);
  };

  const isDirty = (): boolean => {
    if (isNew || selected === null) {
      return (
        name.trim() !== '' ||
        baseUrl.trim() !== '' ||
        chatModel.trim() !== '' ||
        visionModel.trim() !== '' ||
        temperatureText !== DEFAULT_TEMPERATURE_TEXT ||
        tokenBudgetText !== DEFAULT_TOKEN_BUDGET_TEXT ||
        apiKey !== '' ||
        clearKey
      );
    }
    return (
      name !== selected.name ||
      baseUrl !== selected.baseUrl ||
      chatModel !== selected.chatModel ||
      visionModel !== selected.visionModel ||
      temperatureText !== String(selected.temperature) ||
      tokenBudgetText !== String(selected.tokenBudget) ||
      apiKey !== '' ||
      clearKey
    );
  };

  const confirmDiscard = async (): Promise<boolean> => {
    if (!isDirty()) {
      return true;
    }
    const discard = await confirm({
      title: '放弃未保存的修改？',
      message: '当前表单有未保存的内容，切换后会丢失。',
      confirmLabel: '放弃修改',
      tone: 'danger',
    });
    if (discard) {
      clearError();
    }
    return discard;
  };

  const handleSelect = async (profile: AiProfile): Promise<void> => {
    if (!creating && selectedId === profile.id) {
      return;
    }
    if (!(await confirmDiscard())) {
      return;
    }
    setCreating(false);
    setSelectedId(profile.id);
  };

  const handleStartCreate = async (): Promise<void> => {
    if (!(await confirmDiscard())) {
      return;
    }
    setCreating(true);
    setSelectedId(null);
    loadedProfileId.current = null;
    resetForm();
  };

  const parseNumbers = (): { temperature: number; tokenBudget: number } | null => {
    const temperature = Number(temperatureText);
    const tokenBudget = Number(tokenBudgetText);
    if (temperatureText.trim() === '' || !Number.isFinite(temperature)) {
      setFormError('温度必须是有效数字');
      return null;
    }
    if (tokenBudgetText.trim() === '' || !Number.isFinite(tokenBudget)) {
      setFormError('上下文预算必须是有效数字');
      return null;
    }
    return { temperature, tokenBudget };
  };

  /** Blank key and no explicit clear omits apiKey so main keeps the stored one. */
  const buildInput = (): AiProfileInput | null => {
    setFormError(null);
    if (name.trim() === '') {
      setFormError('请填写配置名称');
      return null;
    }
    const numbers = parseNumbers();
    if (numbers === null) {
      return null;
    }
    const input: AiProfileInput = {
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      chatModel: chatModel.trim(),
      visionModel: visionModel.trim(),
      temperature: numbers.temperature,
      tokenBudget: numbers.tokenBudget,
    };
    if (clearKey) {
      input.apiKey = '';
    } else if (apiKey !== '') {
      input.apiKey = apiKey;
    }
    return input;
  };

  const buildTestInput = (): AiSettingsInput | null => {
    setFormError(null);
    const numbers = parseNumbers();
    if (numbers === null) {
      return null;
    }
    const input: AiSettingsInput = {
      baseUrl: baseUrl.trim(),
      chatModel: chatModel.trim(),
      visionModel: visionModel.trim(),
      temperature: numbers.temperature,
      tokenBudget: numbers.tokenBudget,
    };
    if (clearKey) {
      input.apiKey = '';
    } else if (apiKey !== '') {
      input.apiKey = apiKey;
    }
    return input;
  };

  const handleTest = async (): Promise<void> => {
    setTestResult(null);
    clearError();
    const input = buildTestInput();
    if (input === null) {
      return;
    }
    const result = await testConnection(input, isNew ? null : selectedId);
    setTestResult(result);
  };

  const handleSave = async (): Promise<void> => {
    clearError();
    const input = buildInput();
    if (input === null) {
      return;
    }
    setSaving(true);
    setSaveNotice(null);
    try {
      if (isNew) {
        const created = await createProfile(input);
        setCreating(false);
        setSelectedId(created.id);
        loadedProfileId.current = created.id;
        setName(created.name);
        setBaseUrl(created.baseUrl);
        setChatModel(created.chatModel);
        setVisionModel(created.visionModel);
        setTemperatureText(String(created.temperature));
        setTokenBudgetText(String(created.tokenBudget));
        setSaveNotice(`已创建「${created.name}」`);
      } else if (selected !== null) {
        const updated = await updateProfile(selected.id, input);
        setName(updated.name);
        setBaseUrl(updated.baseUrl);
        setChatModel(updated.chatModel);
        setVisionModel(updated.visionModel);
        setTemperatureText(String(updated.temperature));
        setTokenBudgetText(String(updated.tokenBudget));
        setSaveNotice(`已保存「${updated.name}」`);
      }
      // Never keep the typed key in component state after a successful save.
      setApiKey('');
      setClearKey(false);
      setTestResult(null);
    } catch {
      // The store already recorded the reason; stay open so the user can retry.
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (selected === null) {
      return;
    }
    const confirmed = await confirm({
      title: '删除这套配置？',
      message: `「${selected.name}」及其保存的 API Key 将被删除，无法恢复。`,
      confirmLabel: '删除',
      tone: 'danger',
    });
    if (!confirmed) {
      return;
    }
    setSaving(true);
    try {
      await removeProfile(selected.id);
      setCreating(false);
      setSelectedId(null);
      loadedProfileId.current = null;
      resetForm();
    } catch {
      // Store error is rendered below.
    } finally {
      setSaving(false);
    }
  };

  const handleActivate = async (profile: AiProfile): Promise<void> => {
    if (profile.active) {
      return;
    }
    try {
      await activateProfile(profile.id);
    } catch {
      // Store error is rendered below.
    }
  };

  /** Only endpoint fields change; a typed key and vision model are preserved. */
  const fillDeepSeek = (): void => {
    setBaseUrl(DEEPSEEK_BASE_URL);
    setChatModel(DEEPSEEK_CHAT_MODEL);
    if (name.trim() === '') {
      setName('DeepSeek');
    }
    setFormError(null);
    setTestResult(null);
    setSaveNotice(null);
  };

  const openDeepSeekConsole = async (): Promise<void> => {
    try {
      await window.api.settings.openDeepSeekConsole();
    } catch {
      setFormError(`无法打开浏览器，请手动访问 ${DEEPSEEK_API_KEY_URL}`);
    }
  };

  const orderedProfiles = useMemo(() => {
    const entries = profiles.map((profile) => ({
      profile,
      result: speedResults[profile.id],
    }));
    const ranked = entries
      .filter((entry) => entry.result?.ok === true)
      .sort(
        (left, right) =>
          (left.result?.firstTokenMs ?? Infinity) -
          (right.result?.firstTokenMs ?? Infinity),
      );
    const failed = entries.filter(
      (entry) => entry.result !== undefined && entry.result.ok === false,
    );
    const untested = entries.filter((entry) => entry.result === undefined);
    return [...ranked, ...failed, ...untested];
  }, [profiles, speedResults]);

  const keyPlaceholder = clearKey
    ? '保存后将清除已存密钥'
    : !isNew && selected?.apiKeySet
      ? '已保存密钥，留空表示不修改'
      : '尚未设置 API Key';

  return (
    <form
      className="settings-ai-form"
      onSubmit={(event) => {
        event.preventDefault();
        void handleSave();
      }}
    >
      <section className="settings-deepseek" aria-label="DeepSeek 快速配置">
        <div className="settings-deepseek-heading">
          <span className="settings-deepseek-badge">推荐</span>
          <h3>推荐使用 DeepSeek API</h3>
        </div>
        <p className="settings-deepseek-text">
          DeepSeek 提供 OpenAI 兼容接口，适合论文问答、划词翻译与整篇翻译。
          填入配置后，粘贴你在 DeepSeek 开放平台创建的 API Key，保存并测试连接即可。
        </p>
        <div className="settings-deepseek-actions">
          <button type="button" className="menu-button" onClick={fillDeepSeek}>
            填入 DeepSeek 配置
          </button>
          <button
            type="button"
            className="menu-button"
            onClick={() => {
              void openDeepSeekConsole();
            }}
          >
            获取 DeepSeek API Key
          </button>
        </div>
        <p className="settings-deepseek-url">{DEEPSEEK_API_KEY_URL}</p>
        <p className="settings-deepseek-note">
          密钥只保存在本机加密存储中，不会上传到 MurphyEReader 服务器。
          如需截图提问，请在下方填写支持图片输入的视觉模型。
        </p>
      </section>

      <section className="ai-profiles" aria-label="配置档案">
        <div className="ai-profiles-head">
          <h3>配置档案</h3>
          <button
            type="button"
            className="menu-button"
            disabled={saving}
            onClick={() => {
              void handleStartCreate();
            }}
          >
            ＋ 新建配置
          </button>
        </div>
        {profiles.length === 0 ? (
          <p className="ai-profiles-empty">
            还没有保存的配置。在下方填写名称、接口地址和 API Key，保存后就能在这里切换和测速。
          </p>
        ) : (
          <ul className="ai-profile-list">
            {orderedProfiles.map(({ profile, result }) => (
              <li
                key={profile.id}
                className={profile.active ? 'ai-profile-row active' : 'ai-profile-row'}
              >
                <button
                  type="button"
                  className="ai-profile-select"
                  aria-pressed={!creating && selectedId === profile.id}
                  onClick={() => {
                    void handleSelect(profile);
                  }}
                >
                  <span className="ai-profile-dot" aria-hidden="true">
                    {profile.active ? '●' : '○'}
                  </span>
                  <span className="ai-profile-name">{profile.name}</span>
                  <span
                    className={
                      result !== undefined && !result.ok
                        ? 'ai-profile-speed error'
                        : 'ai-profile-speed'
                    }
                    title={result?.error}
                  >
                    {speedLabel(result)}
                  </span>
                </button>
                {profile.active ? (
                  <span className="ai-profile-badge">使用中</span>
                ) : (
                  <button
                    type="button"
                    className="menu-button ai-profile-use"
                    disabled={saving || testingAll}
                    onClick={() => {
                      void handleActivate(profile);
                    }}
                  >
                    设为当前
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="ai-profiles-test">
          <button
            type="button"
            className="menu-button"
            disabled={testingAll || profiles.length === 0}
            onClick={() => {
              void speedTestAll();
            }}
          >
            {testingAll ? '测速中…' : '同时测速'}
          </button>
          <p className="ai-profile-hint">
            测速会向每套已保存配置发送一次极短真实对话（约 1 token，可能产生少量费用），
            按首字延迟排序。
          </p>
        </div>
      </section>

      <div className="ai-profile-form-head">
        <h3>{isNew ? '新建配置' : '编辑所选配置'}</h3>
        {!isNew && selected !== null && (
          <button
            type="button"
            className="menu-button ai-profile-delete"
            disabled={saving}
            onClick={() => {
              void handleDelete();
            }}
          >
            删除
          </button>
        )}
      </div>

      <label className="settings-field">
        <span>配置名称</span>
        <input
          className="settings-input"
          type="text"
          value={name}
          placeholder="例如：DeepSeek 官方"
          onChange={(event) => {
            setName(event.target.value);
            touch();
          }}
        />
      </label>

      <label className="settings-field">
        <span>Base URL</span>
        <input
          className="settings-input"
          type="text"
          value={baseUrl}
          placeholder={DEEPSEEK_BASE_URL}
          onChange={(event) => {
            setBaseUrl(event.target.value);
            touch();
          }}
        />
      </label>

      <div className="settings-field">
        <label>
          <span>API Key</span>
          <input
            className="settings-input"
            type="password"
            value={apiKey}
            placeholder={keyPlaceholder}
            autoComplete="off"
            onChange={(event) => {
              const value = event.target.value;
              setApiKey(value);
              touch();
              if (value !== '') {
                // A freshly typed key takes precedence over a pending clear.
                setClearKey(false);
              }
            }}
          />
        </label>
        <div className="settings-key-actions">
          {clearKey ? (
            <button
              type="button"
              className="menu-button"
              onClick={() => {
                setClearKey(false);
                touch();
              }}
            >
              取消清除
            </button>
          ) : (
            <button
              type="button"
              className="menu-button"
              disabled={apiKey === '' && (isNew || selected?.apiKeySet !== true)}
              onClick={() => {
                setApiKey('');
                setClearKey(true);
                touch();
              }}
            >
              清除
            </button>
          )}
          {clearKey && <span className="settings-key-note">保存后将清除已存密钥</span>}
        </div>
      </div>

      <label className="settings-field">
        <span>对话模型</span>
        <input
          className="settings-input"
          type="text"
          value={chatModel}
          placeholder={DEEPSEEK_CHAT_MODEL}
          onChange={(event) => {
            setChatModel(event.target.value);
            touch();
          }}
        />
      </label>

      <label className="settings-field">
        <span>视觉模型</span>
        <input
          className="settings-input"
          type="text"
          value={visionModel}
          placeholder="支持图片输入的模型（可选）"
          onChange={(event) => {
            setVisionModel(event.target.value);
            touch();
          }}
        />
      </label>

      <div className="settings-row">
        <label className="settings-field">
          <span>温度</span>
          <input
            className="settings-input"
            type="number"
            step="0.1"
            min="0"
            max="2"
            value={temperatureText}
            onChange={(event) => {
              setTemperatureText(event.target.value);
              touch();
            }}
          />
        </label>
        <label className="settings-field">
          <span title="每次请求可用的总 token 预算；全文模式超出后会优先挑选相关页">
            上下文预算
          </span>
          <input
            className="settings-input"
            type="number"
            step="1000"
            min="0"
            value={tokenBudgetText}
            onChange={(event) => {
              setTokenBudgetText(event.target.value);
              touch();
            }}
          />
        </label>
      </div>

      <div className="settings-test">
        <button
          type="button"
          className="menu-button"
          disabled={testing || saving}
          onClick={() => {
            void handleTest();
          }}
        >
          {testing ? '测试中…' : '测试连接'}
        </button>
        {testResult !== null && (
          <p
            className={testResult.ok ? 'settings-test-result ok' : 'settings-test-result error'}
            role="status"
          >
            {testResult.ok ? '连接成功' : `连接失败：${testResult.error ?? '未知错误'}`}
          </p>
        )}
        {saveNotice !== null && (
          <p className="settings-test-result ok" role="status">
            {saveNotice}
          </p>
        )}
      </div>

      {(formError !== null || storeError !== null) && (
        <p className="settings-error" role="alert">
          {formError ?? storeError}
        </p>
      )}

      <div className="settings-actions">
        <button type="button" className="menu-button" onClick={onClose}>
          关闭
        </button>
        <button type="submit" className="primary-button settings-save" disabled={saving || loading}>
          {saving ? '保存中…' : isNew ? '保存为新配置' : '保存'}
        </button>
      </div>
    </form>
  );
}
