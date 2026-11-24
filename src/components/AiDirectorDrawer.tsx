import React, { useState } from 'react';
import {
  Anchor,
  Bot,
  CheckCircle2,
  Loader2,
  Sparkles,
  Store,
  Target,
  Truck,
  Wand2,
} from 'lucide-react';
import type { CityState, ClientAction, DynamicWorldElementKind, PlayMode } from '../sim/types';

interface AiDirectorDrawerProps {
  cityState: CityState;
  playMode: PlayMode;
  localPlayerId: string;
  onAction: (action: ClientAction) => void;
  onErrorToast: (msg: string) => void;
  onClose: () => void;
}

const PRESET_THEMES = [
  '澳門美食節與夜市',
  '格蘭披治花車巡遊',
  '南灣光影無人機秀',
  '海港國際龍舟節',
];

const KIND_META: Record<
  DynamicWorldElementKind,
  { label: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  parade_float: { label: '道路花車巡遊', Icon: Truck },
  drone_show: { label: '空中無人機秀', Icon: Sparkles },
  street_market: { label: '快閃文創市集', Icon: Store },
  harbor_flotilla: { label: '海港龍舟船隊', Icon: Anchor },
};

export const AiDirectorDrawer: React.FC<AiDirectorDrawerProps> = ({
  cityState,
  playMode,
  localPlayerId,
  onAction,
  onErrorToast,
  onClose,
}) => {
  const [theme, setTheme] = useState('');
  const [includeEvent, setIncludeEvent] = useState(true);
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [lastSummary, setLastSummary] = useState<string | null>(null);

  const generateDynamicContent = async (overrideTheme?: string) => {
    if (playMode !== 'mayor' || loading) return;
    setLoading(true);
    setApiError(null);
    setLastSummary(null);

    try {
      const resp = await fetch('/api/ai/director', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: cityState.roomId,
          playerId: localPlayerId,
          theme: (overrideTheme ?? theme).trim(),
          includeEvent,
        }),
      });
      const data = (await resp.json()) as {
        ok?: boolean;
        error?: string;
        headline?: string;
        element?: { title: string; districtName: string };
      };
      if (!resp.ok || !data.ok) {
        const errMsg = data.error || `AI 城市導演回應錯誤 (${resp.status})`;
        setApiError(errMsg);
        onErrorToast(errMsg);
        return;
      }
      setLastSummary(
        data.element
          ? `已生成「${data.element.title}」並投放至${data.element.districtName}，同步新增 AI 挑戰任務`
          : data.headline || '已生成最新城市動態元素',
      );
      if (overrideTheme) setTheme(overrideTheme);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '無法連線至 AI 城市導演伺服器';
      setApiError(msg);
      onErrorToast(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      data-testid="ai-director-drawer"
      className="w-[380px] max-w-[calc(100vw-2rem)] max-h-full overflow-y-auto rounded-xl border border-fuchsia-400/25 bg-slate-950/94 p-3.5 shadow-2xl space-y-3"
    >
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-fuchsia-500/20 text-fuchsia-300">
            <Bot className="h-3.5 w-3.5" />
          </div>
          <div>
            <h2 className="text-xs font-semibold text-white">AI 城市導演 · 動態實景引擎</h2>
            <p className="text-[10.5px] text-slate-400">
              依據澳門現況自動生成 3D 巡遊實景、挑戰任務與決策事件
            </p>
          </div>
        </div>
        <button
          type="button"
          aria-label="關閉 AI 城市導演"
          onClick={onClose}
          className="text-xs text-slate-400 hover:text-white cursor-pointer shrink-0 ml-2"
        >
          收起
        </button>
      </div>

      {/* Generation Controls */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/90 p-2.5 space-y-2">
        <label htmlFor="ai-director-theme-input" className="block text-[11px] font-medium text-slate-300">
          動態元素創作主題（可留白由 AI 自動判斷）
        </label>
        <input
          id="ai-director-theme-input"
          type="text"
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
          placeholder="例如：南灣夜市嘉年華、跨海無人機秀..."
          maxLength={80}
          className="w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-fuchsia-400 focus:outline-none"
        />

        <div className="flex flex-wrap gap-1.5">
          {PRESET_THEMES.map((preset) => (
            <button
              key={preset}
              type="button"
              disabled={loading || playMode !== 'mayor'}
              onClick={() => generateDynamicContent(preset)}
              className="rounded border border-slate-700 bg-slate-800/80 px-2 py-0.5 text-[10.5px] text-slate-200 hover:border-fuchsia-400/60 hover:text-white disabled:opacity-50 cursor-pointer"
            >
              {preset}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between pt-0.5">
          <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={includeEvent}
              onChange={(e) => setIncludeEvent(e.target.checked)}
              className="rounded border-slate-600 bg-slate-900 accent-fuchsia-400"
            />
            同時觸發 AI 政策決策事件
          </label>

          <button
            type="button"
            disabled={playMode !== 'mayor'}
            onClick={() =>
              onAction({ type: 'toggle_ai_director', enabled: !cityState.aiAutoDirector })
            }
            className={`rounded px-2 py-0.5 text-[10.5px] font-medium border transition-colors ${
              cityState.aiAutoDirector
                ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-300'
                : 'border-slate-700 bg-slate-800 text-slate-400 hover:text-slate-200'
            } ${playMode === 'mayor' ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}
          >
            自動導演：{cityState.aiAutoDirector ? '開' : '關'}
          </button>
        </div>

        <button
          type="button"
          data-testid="ai-director-generate-btn"
          disabled={loading || playMode !== 'mayor'}
          onClick={() => generateDynamicContent()}
          className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-fuchsia-500 to-sky-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:brightness-110 disabled:opacity-55 cursor-pointer transition-all"
        >
          {loading ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Gemini AI 正在編排澳門動態實景...
            </>
          ) : (
            <>
              <Wand2 className="h-3.5 w-3.5" />
              {playMode === 'mayor' ? 'AI 立即生成動態元素' : '請先切換「市長角色」啟用 AI 導演'}
            </>
          )}
        </button>

        {apiError && (
          <div
            role="alert"
            className="rounded-md border border-rose-500/40 bg-rose-950/75 px-2.5 py-1.5 text-[11px] text-rose-200"
          >
            {apiError}
          </div>
        )}

        {lastSummary && (
          <div className="rounded-md border border-emerald-500/35 bg-emerald-950/60 px-2.5 py-1.5 text-[11px] text-emerald-200">
            {lastSummary}
          </div>
        )}
      </div>

      {cityState.aiDirectorHeadline && (
        <div className="rounded-lg border border-sky-400/25 bg-sky-950/35 px-2.5 py-2 text-[11px] text-sky-100">
          <span className="font-semibold text-sky-300">市政動態快訊：</span>
          {cityState.aiDirectorHeadline}
        </div>
      )}

      {/* Active 3D Dynamic World Elements */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px] font-semibold text-slate-300">
          <span>場上 3D 動態城市實景 ({cityState.dynamicElements.length})</span>
          <span className="text-[10px] font-normal text-slate-400">即時提升滿意度與文旅收入</span>
        </div>

        {cityState.dynamicElements.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-800 px-3 py-2.5 text-[11px] text-slate-400">
            目前尚未投放 AI 動態實景，點擊上方「AI 立即生成動態元素」即可在地圖中出現花車巡遊、無人機秀或水上船隊！
          </div>
        ) : (
          <div className="space-y-1.5">
            {cityState.dynamicElements.map((el) => {
              const meta = KIND_META[el.kind];
              const Icon = meta.Icon;
              const pct = Math.max(0, Math.min(100, Math.round((el.remainingTicks / el.maxTicks) * 100)));
              return (
                <div
                  key={el.id}
                  className="rounded-lg border border-slate-800 bg-slate-900/90 p-2 space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className="flex h-5 w-5 items-center justify-center rounded shrink-0"
                        style={{ backgroundColor: `${el.accentColor}26`, color: el.accentColor }}
                      >
                        <Icon className="h-3 w-3" />
                      </span>
                      <span className="text-xs font-semibold text-white truncate">{el.title}</span>
                    </div>
                    <span className="text-[10px] font-mono-num text-slate-300 shrink-0">
                      剩 {el.remainingTicks} 期
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[10.5px] text-slate-400">
                    <span>{meta.label} · {el.districtName}</span>
                    <span className="font-mono-num text-emerald-300">
                      滿意+{el.happinessBonus} 文旅+{el.tourismBonus}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-300 leading-snug">{el.description}</p>
                  <div className="h-1 w-full rounded bg-slate-800 overflow-hidden">
                    <div
                      className="h-full transition-all"
                      style={{ width: `${pct}%`, backgroundColor: el.accentColor }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* AI Dynamic Quests */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-300">
          <Target className="h-3.5 w-3.5 text-amber-300" />
          <span>AI 動態限時挑戰 ({cityState.aiQuests.length})</span>
        </div>

        {cityState.aiQuests.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-800 px-3 py-2 text-[11px] text-slate-400">
            每次生成皆會自動搭配一個可即時追蹤進度的都市挑戰與庫房獎勵。
          </div>
        ) : (
          <div className="space-y-1.5">
            {cityState.aiQuests.map((q) => (
              <div
                key={q.id}
                className={`rounded-lg border p-2 space-y-1 ${
                  q.completed
                    ? 'border-emerald-500/40 bg-emerald-950/35'
                    : 'border-slate-800 bg-slate-900/90'
                }`}
              >
                <div className="flex items-center justify-between gap-2 text-xs font-semibold">
                  <span className="flex items-center gap-1 text-white truncate">
                    {q.completed && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />}
                    {q.title}
                  </span>
                  <span className="font-mono-num text-[11px] text-amber-300 shrink-0">
                    +${q.rewardTreasury.toLocaleString()}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 leading-snug">{q.description}</p>
                <div className="h-1.5 w-full rounded bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full transition-all ${q.completed ? 'bg-emerald-400' : 'bg-fuchsia-400'}`}
                    style={{ width: `${Math.round(q.progressRatio * 100)}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[10.5px] font-mono-num text-slate-300">
                  <span>{q.progressText}</span>
                  <span>{q.completed ? '✓ 已領取獎勵' : `剩 ${q.remainingTicks} 期`}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
