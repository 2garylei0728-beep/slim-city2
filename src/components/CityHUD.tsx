import React, { useEffect, useState } from 'react';
import {
  Activity,
  Anchor,
  ArrowDown,
  ArrowUp,
  BarChart3,
  Briefcase,
  Building2,
  Bus,
  ChevronDown,
  ChevronUp,
  CircleDot,
  Coins,
  Coffee,
  Compass,
  Crown,
  Flag,
  Hammer,
  HeartPulse,
  Home,
  Landmark,
  Layers,
  Magnet,
  Map as MapIcon,
  MapPin,
  MessageSquare,
  Minus,
  MousePointer,
  Mountain,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Route,
  Smile,
  Sparkles,
  Sun,
  Target,
  Trash2,
  Trees,
  TrendingUp,
  Users,
  Waves,
  Wind,
  Zap,
} from 'lucide-react';
import { isTileAdjacentToUnlocked } from '../sim/geometry';
import { DIRECT_BUILD_COST, LANDMARK_SPECS, TERRAFORM_SPECS } from '../sim/economy';
import { AiDirectorDrawer } from './AiDirectorDrawer';
import { BudgetOverlay } from './BudgetOverlay';
import { PopulationTrendSparkline } from './PopulationTrendSparkline';
import { TrafficDensityOverlay } from './TrafficDensityOverlay';
import type {
  CityState,
  ClientAction,
  LandmarkType,
  OverlayMode,
  PlayMode,
  TerrainOpKind,
  ToolMode,
  ZoneType,
} from '../sim/types';

const LANDMARK_CATALOG_ITEMS: Array<{
  tool: ToolMode;
  type: LandmarkType;
  shortLabel: string;
  categoryLabel: string;
  icon: React.ReactNode;
}> = [
  { tool: 'landmark_tower', type: 'macau_tower', shortLabel: '澳門觀光塔', categoryLabel: '地標', icon: <Landmark className="h-4 w-4 text-amber-300" /> },
  { tool: 'landmark_resort', type: 'grand_casino_resort', shortLabel: '路氹綜合度假宮', categoryLabel: '地標', icon: <Crown className="h-4 w-4 text-amber-400" /> },
  { tool: 'landmark_plaza', type: 'lotus_plaza', shortLabel: '金蓮花廣場', categoryLabel: '地標', icon: <MapPin className="h-4 w-4 text-yellow-300" /> },
  { tool: 'landmark_ferris', type: 'coastal_promenade', shortLabel: '觀景摩天輪', categoryLabel: '休閒', icon: <Sun className="h-4 w-4 text-pink-300" /> },
  { tool: 'landmark_grandprix', type: 'grand_prix_stand', shortLabel: '東望洋賽車台', categoryLabel: '休閒', icon: <Flag className="h-4 w-4 text-rose-400" /> },
  { tool: 'landmark_park', type: 'harbor_park', shortLabel: '南灣海濱公園', categoryLabel: '休閒', icon: <Trees className="h-4 w-4 text-emerald-300" /> },
  { tool: 'landmark_heritage', type: 'heritage_pavilion', shortLabel: '葡韻議事亭書院', categoryLabel: '市政', icon: <Building2 className="h-4 w-4 text-amber-200" /> },
  { tool: 'landmark_hospital', type: 'fire_hospital_hub', shortLabel: '醫療消防中心', categoryLabel: '市政', icon: <HeartPulse className="h-4 w-4 text-rose-400" /> },
  { tool: 'landmark_ferry', type: 'ferry_terminal', shortLabel: '港澳水岸碼頭', categoryLabel: '交通', icon: <Anchor className="h-4 w-4 text-cyan-300" /> },
  { tool: 'landmark_solar', type: 'eco_solar_plant', shortLabel: '綠能潔淨電站', categoryLabel: '能源', icon: <Wind className="h-4 w-4 text-emerald-400" /> },
];

const TERRAFORM_CATALOG_ITEMS: Array<{
  tool: ToolMode;
  kind: TerrainOpKind;
  icon: React.ReactNode;
}> = [
  { tool: 'terraform_reclaim', kind: 'reclaim', icon: <Plus className="h-4 w-4 text-emerald-400" /> },
  { tool: 'terraform_canal', kind: 'canal', icon: <Waves className="h-4 w-4 text-cyan-400" /> },
  { tool: 'terraform_raise', kind: 'raise', icon: <ArrowUp className="h-4 w-4 text-amber-400" /> },
  { tool: 'terraform_flatten', kind: 'flatten', icon: <Minus className="h-4 w-4 text-sky-400" /> },
  { tool: 'terraform_lower', kind: 'lower', icon: <ArrowDown className="h-4 w-4 text-indigo-300" /> },
];

interface CityHUDProps {
  cityState: CityState;
  playMode: PlayMode;
  tool: ToolMode;
  overlay: OverlayMode;
  showCitizenNav: boolean;
  snapEnabled: boolean;
  localPlayerId: string;
  connected: boolean;
  errorToast: string | null;
  snapHint: { text: string; screenX: number; screenY: number } | null;
  selectedInfo: {
    kind: string;
    title: string;
    subtitle: string;
    id?: string;
    canBuy?: boolean;
    canSell?: boolean;
    hasBuilding?: boolean;
    buildingLevel?: number;
  } | null;
  onSetPlayMode: (mode: PlayMode) => void;
  onSetTool: (tool: ToolMode) => void;
  onSetOverlay: (ov: OverlayMode) => void;
  onToggleCitizenNav: () => void;
  onToggleSnap: () => void;
  onPauseModal: () => void;
  onAction: (action: ClientAction) => void;
  onErrorToast: (msg: string) => void;
  onClearSelection: () => void;
}

type DrawerTab = 'none' | 'map' | 'merchants' | 'milestones' | 'multiplayer' | 'ai_director';

export const CityHUD: React.FC<CityHUDProps> = ({
  cityState,
  playMode,
  tool,
  overlay,
  showCitizenNav,
  snapEnabled,
  localPlayerId,
  connected,
  errorToast,
  snapHint,
  selectedInfo,
  onSetPlayMode,
  onSetTool,
  onSetOverlay,
  onToggleCitizenNav,
  onToggleSnap,
  onPauseModal,
  onAction,
  onErrorToast,
  onClearSelection,
}) => {
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [dockPalette, setDockPalette] = useState<'none' | 'buildings' | 'terraform'>('none');
  const [activeDrawer, setActiveDrawer] = useState<DrawerTab>('none');
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');

  useEffect(() => {
    if (playMode !== 'mayor') {
      if (budgetOpen) setBudgetOpen(false);
      if (dockPalette !== 'none') setDockPalette('none');
    }
  }, [playMode, budgetOpen, dockPalette]);

  const activeLandmarkItem = LANDMARK_CATALOG_ITEMS.find((item) => item.tool === tool);
  const activeTerraformItem = TERRAFORM_CATALOG_ITEMS.find((item) => item.tool === tool);

  const { stats, milestones, merchants, transactions, activeEvent, players, chat } = cityState;
  const localSim = players[localPlayerId];
  const playerList = Object.values(players);
  const netIncome = stats.lastIncome - stats.lastUpkeep;
  const completedMilestones = milestones.filter((m) => m.completed).length;

  const toggleDrawer = (tab: DrawerTab) => {
    setActiveDrawer((prev) => (prev === tab ? 'none' : tab));
  };

  const sendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    onAction({ type: 'chat', text: chatInput });
    setChatInput('');
  };

  return (
    <div className="fixed inset-0 z-20 pointer-events-none flex flex-col justify-between p-3 sm:p-4">
      {/* TOP BAR */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        {/* City Telemetry Cluster */}
        <div className="pointer-events-auto flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-white/15 bg-slate-950/90 px-4 py-2 shadow-lg">
          <div className="flex items-center gap-2 pr-2 border-r border-slate-800">
            <span className="font-display text-sm font-bold text-white whitespace-nowrap">
              澳門天際線
            </span>
            <span className="text-xs text-slate-400 font-mono-num whitespace-nowrap">
              #{cityState.roomId}
            </span>
            <span
              className={`rounded px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${
                playMode === 'mayor'
                  ? 'bg-sky-500/20 text-sky-300 border border-sky-400/30'
                  : 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30'
              }`}
            >
              {playMode === 'mayor' ? '🏛️ 市長角色' : '🧑 市民角色'}
            </span>
          </div>

          <div className="flex items-center gap-3.5 text-xs font-mono-num">
            <div>
              <span className="text-slate-400 mr-1">庫房</span>
              <span className="font-semibold text-amber-300">${Math.round(stats.treasury).toLocaleString()}</span>
              <span className={`ml-1 ${netIncome >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                ({netIncome >= 0 ? '+' : ''}{netIncome})
              </span>
            </div>

            <div>
              <span className="text-slate-400 mr-1">人口</span>
              <span className="font-semibold text-white">{stats.population.toLocaleString()}</span>
            </div>

            <div>
              <span className="text-slate-400 mr-1">版圖</span>
              <span className="font-semibold text-cyan-300">
                {stats.unlockedTileCount}/{cityState.mapTiles.length}區
              </span>
            </div>

            <div>
              <span className="text-slate-400 mr-1">交通流暢</span>
              <span
                className={`font-semibold ${
                  stats.trafficFlowPct >= 75
                    ? 'text-emerald-400'
                    : stats.trafficFlowPct >= 55
                      ? 'text-amber-300'
                      : 'text-rose-400'
                }`}
              >
                {stats.trafficFlowPct}%
              </span>
            </div>

            <div>
              <span className="text-slate-400 mr-1">平均地價</span>
              <span className="font-semibold text-sky-300">{stats.avgLandValue}</span>
            </div>

            <div>
              <span className="text-slate-400 mr-1">滿意</span>
              <span className="font-semibold text-emerald-300">{stats.happiness}%</span>
            </div>

            <div className="hidden md:block text-slate-300">
              第 {stats.day} 日
            </div>
          </div>
        </div>

        {/* Right Mode, Overlay, Speed & Utility Controls */}
        <div className="pointer-events-auto flex flex-wrap items-center gap-2">
          {/* Mayor Role vs Citizen Role */}
          <div className="flex items-center rounded-lg border border-white/15 bg-slate-950/90 p-1 shadow-lg">
            <button
              type="button"
              onClick={() => onSetPlayMode('mayor')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                playMode === 'mayor'
                  ? 'bg-sky-500 text-slate-950 font-semibold'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Compass className="h-3.5 w-3.5" />
              市長角色
            </button>
            <button
              type="button"
              onClick={() => onSetPlayMode('citizen')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                playMode === 'citizen'
                  ? 'bg-emerald-500 text-slate-950 font-semibold'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Smile className="h-3.5 w-3.5" />
              市民角色
            </button>
          </div>

          {/* Heatmap Overlay Switch */}
          <div
            role="group"
            aria-label="地圖疊加圖層設定"
            className="flex items-center rounded-lg border border-white/15 bg-slate-950/90 p-1 shadow-lg"
          >
            <button
              type="button"
              aria-pressed={overlay === 'normal'}
              onClick={() => onSetOverlay('normal')}
              className={`px-2.5 py-1.5 rounded text-xs font-medium whitespace-nowrap cursor-pointer ${
                overlay === 'normal' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              一般
            </button>
            <button
              type="button"
              data-traffic-overlay-btn="true"
              aria-pressed={overlay === 'traffic'}
              title="切換交通密度視覺疊加圖層 (D3 綠→紅飽和度映射)"
              onClick={() => onSetOverlay(overlay === 'traffic' ? 'normal' : 'traffic')}
              className={`px-2.5 py-1.5 rounded text-xs font-medium whitespace-nowrap cursor-pointer ${
                overlay === 'traffic' ? 'bg-amber-500 text-slate-950 font-semibold' : 'text-slate-400 hover:text-white'
              }`}
            >
              交通密度
            </button>
            <button
              type="button"
              aria-pressed={overlay === 'land_value'}
              onClick={() => onSetOverlay(overlay === 'land_value' ? 'normal' : 'land_value')}
              className={`px-2.5 py-1.5 rounded text-xs font-medium whitespace-nowrap cursor-pointer ${
                overlay === 'land_value' ? 'bg-sky-400 text-slate-950 font-semibold' : 'text-slate-400 hover:text-white'
              }`}
            >
              地價熱圖
            </button>
            <button
              type="button"
              data-citizen-nav-btn="true"
              onClick={onToggleCitizenNav}
              className={`px-2.5 py-1.5 rounded text-xs font-medium whitespace-nowrap cursor-pointer ${
                showCitizenNav ? 'bg-emerald-400 text-slate-950 font-semibold' : 'text-slate-400 hover:text-white'
              }`}
            >
              行人導航
            </button>
          </div>

          {/* Speed Controls */}
          <div className="flex items-center rounded-lg border border-white/15 bg-slate-950/90 p-1 shadow-lg">
            {([0, 1, 2, 3] as const).map((spd) => (
              <button
                key={spd}
                type="button"
                aria-label={spd === 0 ? '暫停模擬' : `${spd}倍速`}
                onClick={() => onAction({ type: 'set_speed', speed: spd })}
                className={`px-2.5 py-1.5 rounded text-xs font-mono-num font-medium cursor-pointer ${
                  cityState.simSpeed === spd
                    ? 'bg-sky-500 text-slate-950 font-bold'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                {spd === 0 ? <Pause className="h-3.5 w-3.5" /> : `${spd}x`}
              </button>
            ))}
          </div>

          <button
            type="button"
            aria-label="遊戲選單"
            onClick={(e) => {
              e.currentTarget.blur();
              onPauseModal();
            }}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 bg-slate-950/90 text-slate-200 hover:bg-slate-800 cursor-pointer"
          >
            <Layers className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* MIDDLE ROW: Compact Left Drawer Toggle + Drawer (never blocks center 85%) */}
      <div className="flex-1 flex items-start justify-between my-3 overflow-hidden">
        <div className="pointer-events-auto flex flex-col items-start gap-2 max-h-full">
          {/* Drawer Tabs */}
          <div className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-slate-950/90 p-1 shadow-md">
            <button
              type="button"
              onClick={() => toggleDrawer('map')}
              className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium whitespace-nowrap cursor-pointer ${
                activeDrawer === 'map'
                  ? 'bg-cyan-400 text-slate-950 font-semibold'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <MapIcon className="h-3.5 w-3.5" />
              擴展地圖 ({stats.unlockedTileCount}/{cityState.mapTiles.length})
            </button>
            <button
              type="button"
              onClick={() => toggleDrawer('merchants')}
              className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium whitespace-nowrap cursor-pointer ${
                activeDrawer === 'merchants'
                  ? 'bg-amber-500 text-slate-950 font-semibold'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <TrendingUp className="h-3.5 w-3.5" />
              地產商 ({transactions.length})
            </button>
            <button
              type="button"
              onClick={() => toggleDrawer('milestones')}
              className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium whitespace-nowrap cursor-pointer ${
                activeDrawer === 'milestones'
                  ? 'bg-sky-500 text-slate-950 font-semibold'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Target className="h-3.5 w-3.5" />
              任務 ({completedMilestones}/{milestones.length})
            </button>
            <button
              type="button"
              onClick={() => toggleDrawer('multiplayer')}
              className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium whitespace-nowrap cursor-pointer ${
                activeDrawer === 'multiplayer'
                  ? 'bg-emerald-500 text-slate-950 font-semibold'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Users className="h-3.5 w-3.5" />
              連線 ({playerList.length})
            </button>
            <button
              type="button"
              data-testid="ai-director-tab-btn"
              onClick={() => toggleDrawer('ai_director')}
              className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium whitespace-nowrap cursor-pointer ${
                activeDrawer === 'ai_director'
                  ? 'bg-fuchsia-500 text-slate-950 font-semibold'
                  : 'text-fuchsia-300 hover:bg-slate-800 hover:text-fuchsia-200'
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              AI 城市導演 ({cityState.dynamicElements.length})
            </button>
            {playMode === 'mayor' && (
              <button
                type="button"
                data-budget-btn="true"
                onClick={() => setBudgetOpen((v) => !v)}
                className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium whitespace-nowrap cursor-pointer ${
                  budgetOpen
                    ? 'bg-amber-400 text-slate-950 font-semibold'
                    : 'text-amber-300 hover:bg-slate-800 hover:text-amber-200'
                }`}
              >
                <BarChart3 className="h-3.5 w-3.5" />
                財政預算
              </button>
            )}
          </div>

          {activeDrawer === 'ai_director' && (
            <AiDirectorDrawer
              cityState={cityState}
              playMode={playMode}
              localPlayerId={localPlayerId}
              onAction={onAction}
              onErrorToast={onErrorToast}
              onClose={() => setActiveDrawer('none')}
            />
          )}
          {activeDrawer === 'map' && (
            <div className="w-[650px] max-w-[calc(100vw-2rem)] max-h-full overflow-y-auto rounded-xl border border-white/15 bg-slate-950/94 p-3.5 shadow-xl space-y-2.5">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <div>
                  <h2 className="text-xs font-semibold text-white">真實全澳門版圖 · 5×5 分區漸進解鎖 (420m × 420m)</h2>
                  <p className="text-[11px] text-slate-400">
                    北起關閘青洲、新城A區與港珠澳口岸，經半島與四座跨海大橋，南至氹仔、澳門機場、澳大橫琴及路環黑沙九澳
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="關閉擴展地圖"
                  onClick={() => setActiveDrawer('none')}
                  className="text-xs text-slate-400 hover:text-white cursor-pointer shrink-0 ml-2"
                >
                  收起
                </button>
              </div>
              <div className="flex items-center justify-between text-[10px] font-mono-num text-cyan-300/80 px-1">
                <span>↖ 西北：青洲・內港・澳大橫琴</span>
                <span>▲ 北：關閘・澳門半島</span>
                <span>東北：新城A區・港珠澳・機場 ↗</span>
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {[...cityState.mapTiles]
                  .sort((a, b) => (a.row !== b.row ? a.row - b.row : a.col - b.col))
                  .map((tile) => {
                    const adjacent = isTileAdjacentToUnlocked(tile, cityState.mapTiles);
                    const popMet = stats.population >= tile.minPopulation;
                    const costMet = stats.treasury >= tile.unlockCost;
                    const canUnlock = !tile.unlocked && adjacent && popMet && costMet && playMode === 'mayor';
                    return (
                      <div
                        key={tile.id}
                        title={`${tile.name} — ${tile.subtitle}`}
                        className={`rounded-lg border p-1.5 flex flex-col justify-between gap-1 ${
                          tile.unlocked
                            ? 'border-emerald-500/45 bg-emerald-950/35'
                            : adjacent
                              ? 'border-sky-400/55 bg-slate-900/95'
                              : 'border-slate-800 bg-slate-950/80 opacity-75'
                        }`}
                      >
                        <div>
                          <div className="text-[10px] font-semibold text-white leading-tight">
                            {tile.name}
                          </div>
                          <div className="mt-0.5 text-[9px] text-slate-400 leading-tight line-clamp-2">
                            {tile.subtitle}
                          </div>
                        </div>
                        {tile.unlocked ? (
                          <div className="text-[9.5px] font-semibold text-emerald-300">
                            ✓ 已開放
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <div className="text-[9.5px] font-mono-num text-slate-300">
                              ${tile.unlockCost.toLocaleString()}
                              {tile.minPopulation > 0 ? ` · ${tile.minPopulation}人` : ''}
                            </div>
                            {adjacent ? (
                              playMode === 'mayor' ? (
                                <button
                                  type="button"
                                  data-unlock-tile={tile.id}
                                  disabled={!canUnlock}
                                  onClick={() => onAction({ type: 'unlock_tile', tileId: tile.id })}
                                  className={`w-full rounded px-1.5 py-0.5 text-[9.5px] font-semibold transition-colors ${
                                    canUnlock
                                      ? 'bg-sky-500 text-slate-950 hover:bg-sky-400 cursor-pointer'
                                      : 'bg-slate-800 text-slate-400 cursor-not-allowed'
                                  }`}
                                >
                                  {!popMet ? `需${tile.minPopulation}人` : !costMet ? '庫房不足' : '解鎖擴建'}
                                </button>
                              ) : (
                                <div className="text-[9.5px] text-sky-300">市長可解鎖</div>
                              )
                            ) : (
                              <div className="text-[9.5px] text-slate-500">需先解鎖鄰區</div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
              <div className="flex items-center justify-between text-[10px] font-mono-num text-slate-400 px-1 pt-0.5">
                <span>↙ 路環西岸・荔枝碗</span>
                <span>▼ 南：疊石塘山・竹灣</span>
                <span>東南：黑沙海灘・九澳港 ↘</span>
              </div>
            </div>
          )}
          {activeDrawer === 'merchants' && (
            <div className="w-80 max-h-full overflow-y-auto rounded-xl border border-white/15 bg-slate-950/92 p-3.5 shadow-xl space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <h2 className="text-xs font-semibold text-white">澳門地產商與即時土地交易</h2>
                <button
                  type="button"
                  aria-label="關閉地產商抽屜"
                  onClick={() => setActiveDrawer('none')}
                  className="text-xs text-slate-400 hover:text-white cursor-pointer"
                >
                  收起
                </button>
              </div>
              <div className="space-y-2">
                {merchants.map((m) => (
                  <div key={m.id} className="rounded-lg bg-slate-900/90 p-2 border border-slate-800">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold" style={{ color: m.color }}>
                        {m.name}
                      </span>
                      <span className="font-mono-num text-slate-300">
                        資金 ${m.capital.toLocaleString()}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400">
                      {m.lastActionText} · 持地 {m.holdingsCount} · 建案 {m.buildingsBuilt}
                    </p>
                  </div>
                ))}
              </div>
              <div className="border-t border-slate-800 pt-2">
                <h3 className="text-[11px] font-medium text-slate-400 mb-1.5">最新地產成交動態</h3>
                <div className="space-y-1.5">
                  {transactions.slice(0, 6).map((tx) => (
                    <div key={tx.id} className="text-[11px] text-slate-300 leading-snug">
                      <span className="text-amber-300 font-mono-num">[D{Math.floor(tx.tick / 4) + 1}]</span>{' '}
                      {tx.summary}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeDrawer === 'milestones' && (
            <div className="w-80 max-h-full overflow-y-auto rounded-xl border border-white/15 bg-slate-950/92 p-3.5 shadow-xl space-y-2.5">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <h2 className="text-xs font-semibold text-white">城市發展里程碑</h2>
                <button
                  type="button"
                  aria-label="關閉任務抽屜"
                  onClick={() => setActiveDrawer('none')}
                  className="text-xs text-slate-400 hover:text-white cursor-pointer"
                >
                  收起
                </button>
              </div>
              {milestones.map((ms) => (
                <div
                  key={ms.id}
                  className={`rounded-lg p-2.5 border ${
                    ms.completed
                      ? 'border-emerald-500/40 bg-emerald-950/40'
                      : 'border-slate-800 bg-slate-900/90'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span className={ms.completed ? 'text-emerald-300' : 'text-white'}>
                      {ms.completed ? '✓ ' : ''}{ms.title}
                    </span>
                    <span className="font-mono-num text-amber-300">+${ms.rewardTreasury.toLocaleString()}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-400">{ms.description}</p>
                  <div className="mt-2 h-1.5 w-full rounded bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full ${ms.completed ? 'bg-emerald-400' : 'bg-sky-400'}`}
                      style={{ width: `${Math.round(ms.progressRatio * 100)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[11px] font-mono-num text-slate-300">{ms.progressText}</p>
                </div>
              ))}
            </div>
          )}

          {activeDrawer === 'multiplayer' && (
            <div className="w-80 max-h-full flex flex-col rounded-xl border border-white/15 bg-slate-950/92 p-3.5 shadow-xl space-y-2.5">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <h2 className="text-xs font-semibold text-white">
                  多人連線角色 ({connected ? '已連線' : '重連中'})
                </h2>
                <button
                  type="button"
                  aria-label="關閉多人連線抽屜"
                  onClick={() => setActiveDrawer('none')}
                  className="text-xs text-slate-400 hover:text-white cursor-pointer"
                >
                  收起
                </button>
              </div>
              <div className="space-y-1 max-h-24 overflow-y-auto">
                {playerList.map((pl) => (
                  <div key={pl.id} className="flex items-center justify-between text-xs py-0.5">
                    <span className="font-medium flex items-center gap-1" style={{ color: pl.color }}>
                      <span>{pl.role === 'mayor' ? '🏛️' : '🧑'}</span>
                      <span>{pl.name}</span>
                      <span className="text-[10px] text-slate-400">
                        [{pl.role === 'mayor' ? '市長' : '市民'}{pl.id === localPlayerId ? '·你' : ''}]
                      </span>
                    </span>
                    <span className="text-[11px] text-slate-400 truncate max-w-[125px]">
                      {pl.activityBubble}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-800">
                {['👋 打招呼', '🎉 慶祝', '🛣️ 請求擴建', '🏗️ 一起建設'].map((em) => (
                  <button
                    key={em}
                    type="button"
                    onClick={() => onAction({ type: 'sim_emote', emoteText: em })}
                    className="rounded bg-slate-800 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700 cursor-pointer"
                  >
                    {em}
                  </button>
                ))}
              </div>
              <div className="flex-1 min-h-[100px] max-h-36 overflow-y-auto space-y-1.5 rounded bg-slate-900 p-2 text-xs">
                {chat.slice(-12).map((msg) => (
                  <div key={msg.id} className="leading-snug">
                    <span className="font-semibold" style={{ color: msg.senderColor }}>
                      {msg.senderName}：
                    </span>
                    <span className="text-slate-200">{msg.text}</span>
                  </div>
                ))}
              </div>
              <form onSubmit={sendChat} className="flex gap-1.5">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="輸入聊天訊息..."
                  className="flex-1 rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white focus:border-sky-400 focus:outline-none"
                />
                <button
                  type="submit"
                  className="rounded bg-sky-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400 cursor-pointer"
                >
                  傳送
                </button>
              </form>
            </div>
          )}
        </div>

        {/* Right side: Error Toast, 24h Population Sparkline, Traffic Density Legend & Selected Entity Card */}
        <div className="pointer-events-auto flex flex-col items-end gap-2 max-h-full overflow-y-auto">
          {errorToast && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-950/95 px-3.5 py-2 text-xs font-medium text-rose-200 shadow-lg">
              {errorToast}
            </div>
          )}

          <PopulationTrendSparkline cityState={cityState} />

          {overlay === 'traffic' && (
            <TrafficDensityOverlay
              cityState={cityState}
              onClose={() => onSetOverlay('normal')}
            />
          )}

          {selectedInfo && (
            <div className="w-72 rounded-xl border border-white/15 bg-slate-950/92 p-3 shadow-xl space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-xs font-semibold text-white">{selectedInfo.title}</h3>
                  <p className="mt-0.5 text-[11px] text-slate-300">{selectedInfo.subtitle}</p>
                </div>
                <button
                  type="button"
                  onClick={onClearSelection}
                  className="text-xs text-slate-400 hover:text-white cursor-pointer"
                >
                  ✕
                </button>
              </div>
              {selectedInfo.kind === 'parcel' && selectedInfo.id && (
                playMode === 'citizen' ? (
                  <div className="flex gap-2 pt-1">
                    {selectedInfo.canBuy && (
                      <button
                        type="button"
                        onClick={() =>
                          onAction({
                            type: 'sim_action',
                            kind: 'buy_parcel',
                            targetId: selectedInfo.id,
                          })
                        }
                        className="flex-1 rounded bg-amber-500 px-2.5 py-1.5 text-[11px] font-semibold text-slate-950 hover:bg-amber-400 cursor-pointer"
                      >
                        市民個人買地
                      </button>
                    )}
                    {selectedInfo.canSell && (
                      <button
                        type="button"
                        onClick={() =>
                          onAction({
                            type: 'sim_action',
                            kind: 'sell_parcel',
                            targetId: selectedInfo.id,
                          })
                        }
                        className="flex-1 rounded bg-emerald-500 px-2.5 py-1.5 text-[11px] font-semibold text-slate-950 hover:bg-emerald-400 cursor-pointer"
                      >
                        轉手出售地塊
                      </button>
                    )}
                  </div>
                ) : !selectedInfo.hasBuilding ? (
                  <div className="pt-1 border-t border-slate-800 space-y-1.5">
                    <div className="text-[10.5px] font-medium text-sky-300">
                      市長直接興建建築（立即動工）：
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {(
                        [
                          { zone: 'residential', label: '直建住宅', cls: 'border-emerald-500/40 bg-emerald-950/50 text-emerald-200 hover:bg-emerald-900/70' },
                          { zone: 'commercial', label: '直建商業', cls: 'border-sky-500/40 bg-sky-950/50 text-sky-200 hover:bg-sky-900/70' },
                          { zone: 'tourism', label: '直建文旅', cls: 'border-amber-500/40 bg-amber-950/50 text-amber-200 hover:bg-amber-900/70' },
                          { zone: 'industrial', label: '直建科創', cls: 'border-violet-500/40 bg-violet-950/50 text-violet-200 hover:bg-violet-900/70' },
                        ] as Array<{ zone: Exclude<ZoneType, 'none'>; label: string; cls: string }>
                      ).map((opt) => (
                        <button
                          key={opt.zone}
                          type="button"
                          onClick={() => {
                            onAction({
                              type: 'construct_building',
                              parcelId: selectedInfo.id!,
                              zone: opt.zone,
                            });
                            onClearSelection();
                          }}
                          className={`rounded border px-2 py-1 text-[10.5px] font-semibold transition-colors cursor-pointer flex items-center justify-between ${opt.cls}`}
                        >
                          <span>{opt.label}</span>
                          <span className="font-mono-num opacity-90">
                            ${(DIRECT_BUILD_COST[opt.zone] / 1000).toFixed(1)}k
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null
              )}
              {selectedInfo.kind === 'building' &&
                selectedInfo.id &&
                playMode === 'mayor' &&
                (selectedInfo.buildingLevel ?? 3) < 3 && (
                  <div className="pt-1 border-t border-slate-800">
                    <button
                      type="button"
                      onClick={() => {
                        onAction({
                          type: 'upgrade_building',
                          buildingId: selectedInfo.id!,
                        });
                        onClearSelection();
                      }}
                      className="w-full rounded bg-sky-500 px-2.5 py-1.5 text-[11px] font-semibold text-slate-950 hover:bg-sky-400 cursor-pointer"
                    >
                      市政加建升級 Lv.{(selectedInfo.buildingLevel ?? 1) + 1} ($
                      {selectedInfo.buildingLevel === 1 ? '2,800' : '4,800'})
                    </button>
                  </div>
                )}
            </div>
          )}
        </div>
      </div>

      {/* MAYOR-EXCLUSIVE BUDGET VIEW OVERLAY */}
      {budgetOpen && playMode === 'mayor' && (
        <BudgetOverlay cityState={cityState} onClose={() => setBudgetOpen(false)} />
      )}

      {/* RANDOM MACAU CITY EVENT MODAL */}
      {activeEvent && (
        <div className="fixed inset-0 z-40 flex items-center justify-center pointer-events-auto bg-slate-950/60 p-4">
          <div className="w-full max-w-lg rounded-xl border border-amber-400/35 bg-slate-950 p-6 shadow-2xl">
            <div className="text-xs font-semibold text-amber-400 mb-1">
              澳門城市突發事件 · 第 {stats.day} 日
            </div>
            <h2 className="font-display text-xl font-bold text-white mb-2">
              {activeEvent.title}
            </h2>
            <p className="text-sm text-slate-300 leading-relaxed mb-5">
              {activeEvent.description}
            </p>
            <div className="space-y-2.5">
              {activeEvent.choices.map((ch) => (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() => onAction({ type: 'resolve_event', choiceId: ch.id })}
                  className="w-full text-left rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 hover:border-sky-400 hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <div className="text-sm font-semibold text-white">{ch.label}</div>
                  <div className="mt-1 text-xs text-slate-400">{ch.effectSummary}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* FLOATING ROAD SNAP CURSOR HINT */}
      {snapHint && (
        <div
          className="fixed z-30 pointer-events-none rounded bg-slate-950/92 border border-sky-400/40 px-2.5 py-1 text-[11px] font-mono-num text-sky-200 shadow-lg whitespace-nowrap"
          style={{
            left: Math.min(window.innerWidth - 220, snapHint.screenX + 14),
            top: Math.max(56, snapHint.screenY - 28),
          }}
        >
          {snapHint.text}
        </div>
      )}

      {/* UNIFIED COLLAPSIBLE BOTTOM CONTROL DOCK */}
      <div className="flex flex-col items-center">
        {/* Floating Building Library (10) or Terraforming (5) Palette */}
        {!dockCollapsed && playMode === 'mayor' && dockPalette === 'buildings' && (
          <div
            data-building-catalog="true"
            className="pointer-events-auto mb-2 w-[680px] max-w-[96vw] rounded-xl border border-amber-400/30 bg-slate-950/95 p-3 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 mb-2">
              <div className="flex items-center gap-2">
                <Landmark className="h-4 w-4 text-amber-300" />
                <span className="text-xs font-semibold text-white">澳門市政建築庫（10 款特色建築）</span>
                <span className="text-[11px] text-slate-400">選擇後點擊陸地或岸線直接興建</span>
              </div>
              <button
                type="button"
                onClick={() => setDockPalette('none')}
                className="text-xs text-slate-400 hover:text-white cursor-pointer"
              >
                收起
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
              {LANDMARK_CATALOG_ITEMS.map((item) => {
                const spec = LANDMARK_SPECS[item.type];
                const isSelected = tool === item.tool;
                const canAfford = stats.treasury >= spec.cost;
                return (
                  <button
                    key={item.type}
                    type="button"
                    data-tool-btn={item.tool}
                    onClick={() => {
                      onSetTool(item.tool);
                      setDockPalette('none');
                    }}
                    className={`rounded-lg border p-2 text-left transition-colors cursor-pointer flex flex-col justify-between gap-1 ${
                      isSelected
                        ? 'border-amber-400 bg-amber-500/20 text-white'
                        : 'border-slate-800 bg-slate-900/90 text-slate-200 hover:border-slate-600 hover:bg-slate-800/90'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="flex items-center gap-1.5 text-[11.5px] font-semibold">
                        {item.icon}
                        {item.shortLabel}
                      </span>
                      <span className="text-[9.5px] rounded bg-slate-800 px-1 py-0.5 text-slate-300">
                        {item.categoryLabel}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-400 leading-snug line-clamp-2">
                      {spec.description}
                    </div>
                    <div className="flex items-center justify-between text-[10px] font-mono-num pt-0.5">
                      <span className={canAfford ? 'text-amber-300 font-semibold' : 'text-rose-400'}>
                        ${spec.cost.toLocaleString()}
                      </span>
                      <span className="text-emerald-300">
                        {spec.taxYield > 0
                          ? `稅+$${spec.taxYield}`
                          : spec.happinessBonus >= 7
                            ? `滿意+${spec.happinessBonus}`
                            : `地價+${spec.landValueBonus}`}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {!dockCollapsed && playMode === 'mayor' && dockPalette === 'terraform' && (
          <div
            data-terraform-catalog="true"
            className="pointer-events-auto mb-2 w-[640px] max-w-[96vw] rounded-xl border border-emerald-400/30 bg-slate-950/95 p-3 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 mb-2">
              <div className="flex items-center gap-2">
                <Mountain className="h-4 w-4 text-emerald-300" />
                <span className="text-xs font-semibold text-white">澳門地形改造工程（填海・運河・造山・平地）</span>
              </div>
              <button
                type="button"
                onClick={() => setDockPalette('none')}
                className="text-xs text-slate-400 hover:text-white cursor-pointer"
              >
                收起
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
              {TERRAFORM_CATALOG_ITEMS.map((item) => {
                const spec = TERRAFORM_SPECS[item.kind];
                const isSelected = tool === item.tool;
                const canAfford = stats.treasury >= spec.cost;
                return (
                  <button
                    key={item.kind}
                    type="button"
                    data-tool-btn={item.tool}
                    onClick={() => {
                      onSetTool(item.tool);
                      setDockPalette('none');
                    }}
                    className={`rounded-lg border p-2 text-left transition-colors cursor-pointer flex flex-col justify-between gap-1 ${
                      isSelected
                        ? 'border-emerald-400 bg-emerald-500/20 text-white'
                        : 'border-slate-800 bg-slate-900/90 text-slate-200 hover:border-slate-600 hover:bg-slate-800/90'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-[11.5px] font-semibold">
                      {item.icon}
                      {spec.name}
                    </div>
                    <div className="text-[10px] text-slate-400 leading-snug">
                      {spec.description}
                    </div>
                    <div className="flex items-center justify-between text-[10px] font-mono-num pt-0.5">
                      <span className={canAfford ? 'text-amber-300 font-semibold' : 'text-rose-400'}>
                        ${spec.cost.toLocaleString()}
                      </span>
                      <span className="text-cyan-300">半徑 {spec.radius}m</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => setDockCollapsed((v) => !v)}
          className="pointer-events-auto mb-1 flex items-center gap-1 rounded-t-lg border border-b-0 border-white/15 bg-slate-950/92 px-3 py-1 text-[11px] font-medium text-slate-300 hover:text-white cursor-pointer"
        >
          {dockCollapsed ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {dockCollapsed ? '展開工具列' : '收起工具列'}
        </button>

        {!dockCollapsed && (
          <div className="pointer-events-auto max-w-[96vw] overflow-x-auto rounded-xl border border-white/15 bg-slate-950/92 px-3.5 py-2.5 shadow-2xl">
            {playMode === 'mayor' ? (
              <div className="flex items-center gap-3">
                {/* RCI + Tourism Demand Bars */}
                <div className="flex items-end gap-1.5 pr-3 border-r border-slate-800" title="城市需求 (住/商/旅/科)">
                  {[
                    { label: '住', val: stats.demand.residential, color: 'bg-emerald-400' },
                    { label: '商', val: stats.demand.commercial, color: 'bg-sky-400' },
                    { label: '旅', val: stats.demand.tourism, color: 'bg-amber-400' },
                    { label: '科', val: stats.demand.industrial, color: 'bg-violet-400' },
                  ].map((d) => (
                    <div key={d.label} className="flex flex-col items-center gap-0.5">
                      <div className="h-9 w-2.5 rounded-sm bg-slate-800 flex items-end overflow-hidden">
                        <div className={`w-full ${d.color}`} style={{ height: `${d.val}%` }} />
                      </div>
                      <span className="text-[10px] text-slate-400">{d.label}</span>
                    </div>
                  ))}
                </div>

                {/* Road & Traffic Tools */}
                <div className="flex items-center gap-1 pr-3 border-r border-slate-800">
                  <ToolBtn
                    active={tool === 'select'}
                    icon={<MousePointer className="h-3.5 w-3.5" />}
                    label="檢視"
                    onClick={() => {
                      onSetTool('select');
                      setDockPalette('none');
                    }}
                  />
                  <button
                    type="button"
                    onClick={onToggleSnap}
                    className={`flex flex-col items-center justify-center rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
                      snapEnabled
                        ? 'bg-sky-500/20 text-sky-300 border border-sky-400/40'
                        : 'text-slate-400 hover:bg-slate-800'
                    }`}
                  >
                    <Magnet className="h-3.5 w-3.5 mb-0.5" />
                    {snapEnabled ? '對齊開' : '自由'}
                  </button>
                  <ToolBtn
                    active={tool === 'road_street'}
                    icon={<Route className="h-3.5 w-3.5" />}
                    label="二線街"
                    onClick={() => {
                      onSetTool('road_street');
                      setDockPalette('none');
                    }}
                  />
                  <ToolBtn
                    active={tool === 'road_avenue'}
                    icon={<Route className="h-3.5 w-3.5 text-amber-300" />}
                    label="四線大道"
                    onClick={() => {
                      onSetTool('road_avenue');
                      setDockPalette('none');
                    }}
                  />
                  <ToolBtn
                    active={tool === 'road_bus'}
                    icon={<Bus className="h-3.5 w-3.5 text-emerald-300" />}
                    label="巴士專線"
                    onClick={() => {
                      onSetTool('road_bus');
                      setDockPalette('none');
                    }}
                  />
                  <ToolBtn
                    active={tool === 'upgrade_roundabout'}
                    icon={<CircleDot className="h-3.5 w-3.5 text-amber-300" />}
                    label="圓形地"
                    onClick={() => {
                      onSetTool('upgrade_roundabout');
                      setDockPalette('none');
                    }}
                  />
                  <ToolBtn
                    active={tool === 'upgrade_bus'}
                    icon={<Bus className="h-3.5 w-3.5 text-sky-300" />}
                    label="升級巴士"
                    onClick={() => {
                      onSetTool('upgrade_bus');
                      setDockPalette('none');
                    }}
                  />
                </div>

                {/* Zoning Tools */}
                <div className="flex items-center gap-1 pr-3 border-r border-slate-800">
                  <ToolBtn
                    active={tool === 'zone_residential'}
                    icon={<Home className="h-3.5 w-3.5 text-emerald-400" />}
                    label="住宅區"
                    onClick={() => {
                      onSetTool('zone_residential');
                      setDockPalette('none');
                    }}
                  />
                  <ToolBtn
                    active={tool === 'zone_commercial'}
                    icon={<Building2 className="h-3.5 w-3.5 text-sky-400" />}
                    label="商業區"
                    onClick={() => {
                      onSetTool('zone_commercial');
                      setDockPalette('none');
                    }}
                  />
                  <ToolBtn
                    active={tool === 'zone_tourism'}
                    icon={<Sparkles className="h-3.5 w-3.5 text-amber-400" />}
                    label="文旅娛樂"
                    onClick={() => {
                      onSetTool('zone_tourism');
                      setDockPalette('none');
                    }}
                  />
                  <ToolBtn
                    active={tool === 'zone_industrial'}
                    icon={<Hammer className="h-3.5 w-3.5 text-violet-400" />}
                    label="科創工業"
                    onClick={() => {
                      onSetTool('zone_industrial');
                      setDockPalette('none');
                    }}
                  />
                </div>

                {/* Building Library (10), Terraforming (5), Map Expansion & Bulldoze */}
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    data-building-catalog-btn="true"
                    onClick={() => setDockPalette((p) => (p === 'buildings' ? 'none' : 'buildings'))}
                    className={`flex flex-col items-center justify-center rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer border ${
                      dockPalette === 'buildings' || activeLandmarkItem
                        ? 'border-amber-400/70 bg-amber-500/20 text-amber-200 font-semibold'
                        : 'border-transparent text-slate-200 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    <Landmark className="h-3.5 w-3.5 mb-0.5 text-amber-300" />
                    <span>{activeLandmarkItem ? activeLandmarkItem.shortLabel : '建築庫 (10)'}</span>
                  </button>

                  <button
                    type="button"
                    data-terraform-catalog-btn="true"
                    onClick={() => setDockPalette((p) => (p === 'terraform' ? 'none' : 'terraform'))}
                    className={`flex flex-col items-center justify-center rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer border ${
                      dockPalette === 'terraform' || activeTerraformItem
                        ? 'border-emerald-400/70 bg-emerald-500/20 text-emerald-200 font-semibold'
                        : 'border-transparent text-slate-200 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    <Mountain className="h-3.5 w-3.5 mb-0.5 text-emerald-300" />
                    <span>
                      {activeTerraformItem
                        ? TERRAFORM_SPECS[activeTerraformItem.kind].name
                        : '改造地形 (5)'}
                    </span>
                  </button>

                  <ToolBtn
                    active={tool === 'unlock_tile'}
                    icon={<MapIcon className="h-3.5 w-3.5 text-cyan-300" />}
                    label="擴展地圖"
                    onClick={() => {
                      onSetTool('unlock_tile');
                      setDockPalette('none');
                    }}
                  />
                  <ToolBtn
                    active={tool === 'bulldoze'}
                    icon={<Trash2 className="h-3.5 w-3.5 text-rose-400" />}
                    label="拆除"
                    onClick={() => {
                      onSetTool('bulldoze');
                      setDockPalette('none');
                    }}
                  />
                </div>
              </div>
            ) : (
              /* THE SIMS (模擬人生) LIFE DOCK */
              <div className="flex flex-wrap items-center gap-3">
                {localSim && (
                  <>
                    <div className="pr-3 border-r border-slate-800">
                      <div className="flex items-center gap-2 text-xs font-semibold text-white">
                        <span style={{ color: localSim.color }}>{localSim.name}</span>
                        <span className="text-slate-400">·</span>
                        <span className="text-sky-300">{localSim.career.title}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-3 text-[11px] font-mono-num text-slate-300">
                        <span className="text-amber-300 font-semibold">
                          個人 MOP ${localSim.wallet.toLocaleString()}
                        </span>
                        <span>持有地塊 {localSim.ownedParcelIds.length}</span>
                        <span>經驗 {localSim.career.xp}/{localSim.career.nextXp}</span>
                      </div>
                    </div>

                    {/* 5 Sims Needs Meters */}
                    <div className="flex items-center gap-2.5 pr-3 border-r border-slate-800">
                      {[
                        { label: '精力', val: localSim.needs.energy },
                        { label: '飽食', val: localSim.needs.hunger },
                        { label: '娛樂', val: localSim.needs.fun },
                        { label: '社交', val: localSim.needs.social },
                        { label: '舒適', val: localSim.needs.comfort },
                      ].map((n) => (
                        <div key={n.label} className="w-12">
                          <div className="flex justify-between text-[10px] text-slate-300 mb-0.5">
                            <span>{n.label}</span>
                            <span className="font-mono-num">{Math.round(n.val)}</span>
                          </div>
                          <div className="h-1.5 w-full rounded bg-slate-800 overflow-hidden">
                            <div
                              className={`h-full ${
                                n.val > 55 ? 'bg-emerald-400' : n.val > 30 ? 'bg-amber-400' : 'bg-rose-500'
                              }`}
                              style={{ width: `${Math.round(n.val)}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Sim Life Actions */}
                    <div className="flex items-center gap-1.5">
                      <ToolBtn
                        active={false}
                        icon={<Briefcase className="h-3.5 w-3.5 text-sky-300" />}
                        label="上班賺錢"
                        onClick={() => onAction({ type: 'sim_action', kind: 'work' })}
                      />
                      <ToolBtn
                        active={false}
                        icon={<Coffee className="h-3.5 w-3.5 text-amber-300" />}
                        label="茶餐廳"
                        onClick={() => onAction({ type: 'sim_action', kind: 'dine' })}
                      />
                      <ToolBtn
                        active={false}
                        icon={<Home className="h-3.5 w-3.5 text-emerald-300" />}
                        label="回家休息"
                        onClick={() => onAction({ type: 'sim_action', kind: 'rest' })}
                      />
                      <ToolBtn
                        active={false}
                        icon={<Zap className="h-3.5 w-3.5 text-amber-400" />}
                        label="觀光娛樂"
                        onClick={() => onAction({ type: 'sim_action', kind: 'entertain' })}
                      />
                      <ToolBtn
                        active={false}
                        icon={<MessageSquare className="h-3.5 w-3.5 text-pink-300" />}
                        label="市民社交"
                        onClick={() => onAction({ type: 'sim_action', kind: 'social' })}
                      />
                      <ToolBtn
                        active={false}
                        icon={<Coins className="h-3.5 w-3.5 text-yellow-300" />}
                        label="買地投資"
                        onClick={() => onAction({ type: 'sim_action', kind: 'buy_parcel' })}
                      />
                      {localSim.ownedParcelIds.length > 0 && (
                        <ToolBtn
                          active={false}
                          icon={<TrendingUp className="h-3.5 w-3.5 text-emerald-400" />}
                          label="售地獲利"
                          onClick={() => onAction({ type: 'sim_action', kind: 'sell_parcel' })}
                        />
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          onAction({ type: 'sim_autonomy', enabled: !localSim.autonomy })
                        }
                        className={`flex flex-col items-center justify-center rounded-lg px-2 py-1.5 text-[11px] font-medium whitespace-nowrap cursor-pointer ${
                          localSim.autonomy
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/40'
                            : 'text-slate-400 hover:bg-slate-800'
                        }`}
                      >
                        <Activity className="h-3.5 w-3.5 mb-0.5" />
                        {localSim.autonomy ? '自主開' : '手動'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

interface ToolBtnProps {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}

const ToolBtn: React.FC<ToolBtnProps> = ({ active, icon, label, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex flex-col items-center justify-center rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
      active
        ? 'bg-sky-500 text-slate-950 font-semibold'
        : 'text-slate-300 hover:bg-slate-800 hover:text-white'
    }`}
  >
    <span className="mb-0.5">{icon}</span>
    <span>{label}</span>
  </button>
);

interface StatusModalProps {
  mode: 'paused' | 'gameover';
  cityState: CityState;
  onResume: () => void;
  onRestart: () => void;
  onReturnTitle: () => void;
}

export const StatusModal: React.FC<StatusModalProps> = ({
  mode,
  cityState,
  onResume,
  onRestart,
  onReturnTitle,
}) => {
  const { stats } = cityState;
  const isVictory = stats.gameOverReason === 'victory';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4">
      <div className="w-full max-w-md rounded-xl border border-white/15 bg-slate-950 p-6 shadow-2xl">
        <h2 className="font-display text-2xl font-bold text-white mb-1">
          {mode === 'paused'
            ? '遊戲選單 · 已暫停'
            : isVictory
              ? '璀璨澳門大都會達成'
              : '市政庫房破產'}
        </h2>
        <p className="text-sm text-slate-300 mb-5">
          {mode === 'paused'
            ? `房間 #${cityState.roomId} · 第 ${stats.day} 日`
            : isVictory
              ? '恭喜完成所有澳門天際線發展里程碑！'
              : '城市債務超過負荷，可重新規劃路網與地產稅收。'}
        </p>

        <div className="grid grid-cols-3 gap-2.5 mb-6">
          <div className="rounded-lg bg-slate-900 p-3 border border-slate-800">
            <div className="text-[11px] text-slate-400">城市人口</div>
            <div className="mt-0.5 text-base font-bold font-mono-num text-white">
              {stats.population.toLocaleString()}
            </div>
          </div>
          <div className="rounded-lg bg-slate-900 p-3 border border-slate-800">
            <div className="text-[11px] text-slate-400">交通流暢</div>
            <div className="mt-0.5 text-base font-bold font-mono-num text-emerald-400">
              {stats.trafficFlowPct}%
            </div>
          </div>
          <div className="rounded-lg bg-slate-900 p-3 border border-slate-800">
            <div className="text-[11px] text-slate-400">庫房餘額</div>
            <div className="mt-0.5 text-base font-bold font-mono-num text-amber-300">
              ${Math.round(stats.treasury).toLocaleString()}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          {mode === 'paused' && (
            <button
              type="button"
              onClick={onResume}
              className="flex items-center justify-center gap-2 rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-sky-400 cursor-pointer"
            >
              <Play className="h-4 w-4" />
              繼續建設與模擬
            </button>
          )}
          <button
            type="button"
            data-start={mode === 'gameover' ? 'true' : undefined}
            onClick={onRestart}
            className="flex items-center justify-center gap-2 rounded-lg bg-slate-800 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-700 cursor-pointer"
          >
            <RotateCcw className="h-4 w-4" />
            重建城市
          </button>
          <button
            type="button"
            onClick={onReturnTitle}
            className="rounded-lg border border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-300 hover:bg-slate-900 cursor-pointer"
          >
            返回主畫面
          </button>
        </div>
      </div>
    </div>
  );
};
