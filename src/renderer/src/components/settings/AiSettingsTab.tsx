import { useEffect, useState } from 'react';
import {
  DEEPSEEK_API_KEY_URL,
  DEEPSEEK_BASE_URL,
  DEEPSEEK_CHAT_MODEL,
} from '@shared/ai-providers';
import type { AiSettingsInput } from '@shared/types';
import { useSettingsStore } from '../../stores/settings';

export interface AiSettingsTabProps {
  onClose(): void;
}

/**
 * AI endpoint form inside the settings shell. Mounted for the lifetime of the
 * dialog (the inactive panel is only hidden), so an unsaved draft survives tab
 * switches. The API key is never read back from anywhere: the field starts
 * empty, blank means "keep the stored key", and an explicit 清除 sends an empty
 * string.
 */
export function AiSettingsTab({ onClose }: AiSettingsTabProps): React.JSX.Element {
  const settings = useSettingsStore((state) => state.settings);
  const loading = useSettingsStore((state) => state.loading);
  const storeError = useSettingsStore((state) => state.error);
  const testing = useSettingsStore((state) => state.testing);
  const save = useSettingsStore((state) => state.save);
  const testConnection = useSettingsStore((state) => state.test);
  const clearError = useSettingsStore((state) => state.clearError);

  const [baseUrl, setBaseUrl] = useState(settings?.baseUrl ?? '');
  const [chatModel, setChatModel] = useState(settings?.chatModel ?? '');
  const [visionModel, setVisionModel] = useState(settings?.visionModel ?? '');
  const [temperatureText, setTemperatureText] = useState(
    settings === null ? '' : String(settings.temperature),
  );
  const [tokenBudgetText, setTokenBudgetText] = useState(
    settings === null ? '' : String(settings.tokenBudget),
  );
  const [apiKey, setApiKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Fill the form when settings arrive (first load) or change.
  useEffect(() => {
    if (settings === null) {
      return;
    }
    setBaseUrl(settings.baseUrl);
    setChatModel(settings.chatModel);
    setVisionModel(settings.visionModel);
    setTemperatureText(String(settings.temperature));
    setTokenBudgetText(String(settings.tokenBudget));
  }, [settings]);

  /** Blank key and no explicit clear omits apiKey so main keeps the stored one. */
  const buildInput = (): AiSettingsInput | null => {
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
    const input: AiSettingsInput = {
      baseUrl: baseUrl.trim(),
      chatModel: chatModel.trim(),
      visionModel: visionModel.trim(),
      temperature,
      tokenBudget,
    };
    if (clearKey) {
      input.apiKey = '';
    } else if (apiKey !== '') {
      input.apiKey = apiKey;
    }
    return input;
  };

  const handleTest = async (): Promise<void> => {
    setFormError(null);
    setTestResult(null);
    clearError();
    const input = buildInput();
    if (input === null) {
      return;
    }
    const result = await testConnection(input);
    setTestResult(result);
  };

  const handleSave = async (): Promise<void> => {
    setFormError(null);
    clearError();
    const input = buildInput();
    if (input === null) {
      return;
    }
    setSaving(true);
    try {
      await save(input);
      // Never keep the typed key in component state after a successful save.
      setApiKey('');
      setClearKey(false);
      onClose();
    } catch {
      // The store already recorded the reason; stay open so the user can retry.
    } finally {
      setSaving(false);
    }
  };

  /** Only endpoint fields change; a typed key and vision model are preserved. */
  const fillDeepSeek = (): void => {
    setBaseUrl(DEEPSEEK_BASE_URL);
    setChatModel(DEEPSEEK_CHAT_MODEL);
    setFormError(null);
    setTestResult(null);
  };

  const openDeepSeekConsole = async (): Promise<void> => {
    try {
      await window.api.settings.openDeepSeekConsole();
    } catch {
      setFormError(`无法打开浏览器，请手动访问 ${DEEPSEEK_API_KEY_URL}`);
    }
  };

  const keyPlaceholder = clearKey
    ? '保存后将清除已存密钥'
    : settings?.apiKeySet
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

      <label className="settings-field">
        <span>Base URL</span>
        <input
          className="settings-input"
          type="text"
          value={baseUrl}
          placeholder={DEEPSEEK_BASE_URL}
          onChange={(event) => setBaseUrl(event.target.value)}
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
              if (value !== '') {
                // A freshly typed key takes precedence over a pending clear.
                setClearKey(false);
              }
            }}
          />
        </label>
        <div className="settings-key-actions">
          {clearKey ? (
            <button type="button" className="menu-button" onClick={() => setClearKey(false)}>
              取消清除
            </button>
          ) : (
            <button
              type="button"
              className="menu-button"
              onClick={() => {
                setApiKey('');
                setClearKey(true);
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
          onChange={(event) => setChatModel(event.target.value)}
        />
      </label>

      <label className="settings-field">
        <span>视觉模型</span>
        <input
          className="settings-input"
          type="text"
          value={visionModel}
          placeholder="支持图片输入的模型（可选）"
          onChange={(event) => setVisionModel(event.target.value)}
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
            onChange={(event) => setTemperatureText(event.target.value)}
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
            onChange={(event) => setTokenBudgetText(event.target.value)}
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
      </div>

      {(formError !== null || storeError !== null) && (
        <p className="settings-error" role="alert">
          {formError ?? storeError}
        </p>
      )}

      <div className="settings-actions">
        <button type="button" className="menu-button" onClick={onClose}>
          取消
        </button>
        <button type="submit" className="primary-button settings-save" disabled={saving || loading}>
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </form>
  );
}
