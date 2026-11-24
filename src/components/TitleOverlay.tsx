import React, { useEffect } from 'react';
import type { PlayerRole } from '../sim/types';

interface TitleOverlayProps {
  playerName: string;
  roomId: string;
  playerColor: string;
  playerRole: PlayerRole;
  onChangeName: (name: string) => void;
  onChangeRoom: (room: string) => void;
  onChangeColor: (color: string) => void;
  onChangeRole: (role: PlayerRole) => void;
  onStart: () => void;
}

const AVATAR_COLORS = [
  { hex: '#38bdf8', label: '海灣藍' },
  { hex: '#f59e0b', label: '金蓮琥珀' },
  { hex: '#10b981', label: '路環翠綠' },
  { hex: '#fb7185', label: '葡韻粉紅' },
  { hex: '#a78bfa', label: '夜幕紫' },
];

export const TitleOverlay: React.FC<TitleOverlayProps> = ({
  playerName,
  roomId,
  playerColor,
  playerRole,
  onChangeName,
  onChangeRoom,
  onChangeColor,
  onChangeRole,
  onStart,
}) => {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT') {
        if (e.key === 'Enter') {
          e.preventDefault();
          onStart();
        }
        return;
      }
      if (e.key === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        onStart();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onStart]);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-start pointer-events-none px-6 sm:px-14">
      <div className="pointer-events-auto w-full max-w-md rounded-xl border border-white/15 bg-slate-950/92 p-6 shadow-2xl">
        {/* Bespoke inline SVG Macau Skyline Emblem */}
        <div className="mb-4 flex items-center gap-4">
          <svg
            viewBox="0 0 64 64"
            className="h-14 w-14 shrink-0"
            aria-hidden="true"
          >
            <rect width="64" height="64" rx="12" fill="#0f172a" stroke="#38bdf8" strokeWidth="1.5" />
            <path d="M8 46 Q24 38 32 42 T56 46" fill="none" stroke="#38bdf8" strokeWidth="2.2" />
            <rect x="29.5" y="10" width="5" height="36" rx="1.5" fill="#f8fafc" />
            <ellipse cx="32" cy="24" rx="8.5" ry="3.2" fill="#f59e0b" />
            <line x1="32" y1="4" x2="32" y2="11" stroke="#fbbf24" strokeWidth="2.2" strokeLinecap="round" />
            <rect x="14" y="30" width="9" height="16" rx="1" fill="#334155" stroke="#94a3b8" strokeWidth="1" />
            <rect x="41" y="27" width="10" height="19" rx="1" fill="#1e293b" stroke="#94a3b8" strokeWidth="1" />
          </svg>
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight text-white">
              澳門天際線
            </h1>
            <p className="text-sm text-slate-300">
              Macau Slim City · 雙角色線上共建澳門
            </p>
          </div>
        </div>

        <p className="mb-4 text-xs leading-relaxed text-slate-300">
          從南灣西灣起步漸漸解鎖全澳門 25 大分區，見證地產商買賣土地、應對城市事件；一位擔任「市長」掌舵規劃，另一位化身「市民」體驗模擬人生！
        </p>

        {/* Mayor vs Citizen Role Picker */}
        <div className="mb-4">
          <span className="block text-xs font-medium text-slate-300 mb-1.5">
            選擇您的扮演角色
          </span>
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => onChangeRole('mayor')}
              className={`text-left rounded-lg border p-3 transition-colors cursor-pointer ${
                playerRole === 'mayor'
                  ? 'border-sky-400 bg-sky-500/15 text-white'
                  : 'border-slate-800 bg-slate-900/90 text-slate-300 hover:border-slate-600'
              }`}
            >
              <div className="text-sm font-semibold text-sky-300">🏛️ 市長角色</div>
              <div className="mt-1 text-[11px] leading-snug text-slate-400">
                建路劃區、解鎖澳門版圖、決策城市突發事件
              </div>
            </button>
            <button
              type="button"
              onClick={() => onChangeRole('citizen')}
              className={`text-left rounded-lg border p-3 transition-colors cursor-pointer ${
                playerRole === 'citizen'
                  ? 'border-emerald-400 bg-emerald-500/15 text-white'
                  : 'border-slate-800 bg-slate-900/90 text-slate-300 hover:border-slate-600'
              }`}
            >
              <div className="text-sm font-semibold text-emerald-300">🧑 市民角色</div>
              <div className="mt-1 text-[11px] leading-snug text-slate-400">
                模擬人生漫步街頭、上班升職、飲食消費與購地投資
              </div>
            </button>
          </div>
        </div>

        <div className="space-y-3 mb-5">
          <div>
            <label htmlFor="sim-name" className="block text-xs font-medium text-slate-300 mb-1">
              角色名稱
            </label>
            <input
              id="sim-name"
              type="text"
              maxLength={18}
              value={playerName}
              onChange={(e) => onChangeName(e.target.value)}
              placeholder="輸入您的角色名稱"
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-sky-400 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="room-code" className="block text-xs font-medium text-slate-300 mb-1">
                多人房間代碼
              </label>
              <input
                id="room-code"
                type="text"
                maxLength={20}
                value={roomId}
                onChange={(e) => onChangeRoom(e.target.value)}
                placeholder="macau-main"
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-mono-num text-white focus:border-sky-400 focus:outline-none"
              />
            </div>

            <div>
              <span className="block text-xs font-medium text-slate-300 mb-1.5">
                代表配色
              </span>
              <div className="flex items-center gap-2 pt-1">
                {AVATAR_COLORS.map((c) => (
                  <button
                    key={c.hex}
                    type="button"
                    aria-label={`選擇顏色 ${c.label}`}
                    onClick={() => onChangeColor(c.hex)}
                    className={`h-7 w-7 rounded-full border-2 transition-transform ${
                      playerColor === c.hex ? 'border-white scale-110' : 'border-transparent opacity-75 hover:opacity-100'
                    }`}
                    style={{ backgroundColor: c.hex }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        <button
          type="button"
          data-start="true"
          onClick={onStart}
          className="w-full rounded-lg bg-sky-500 px-5 py-3 text-base font-semibold text-slate-950 transition-colors hover:bg-sky-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300 cursor-pointer"
        >
          以「{playerRole === 'mayor' ? '市長角色' : '市民角色'}」進入澳門
        </button>

        <p className="mt-3.5 text-xs text-slate-400">
          左鍵建路/漫步 · 右鍵取消或旋轉視角 · WASD 移動 · 空白鍵切換暫停
        </p>
      </div>
    </div>
  );
};
