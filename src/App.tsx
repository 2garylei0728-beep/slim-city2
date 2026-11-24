import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createInitialCityState } from './sim/economy';
import type {
  CityState,
  ClientAction,
  GamePhase,
  OverlayMode,
  PlayerRole,
  ToolMode,
} from './sim/types';
import { CityViewport } from './render/CityViewport';
import { TitleOverlay } from './components/TitleOverlay';
import { CityHUD, StatusModal } from './components/CityHUD';

function getOrCreatePlayerId(): string {
  const key = 'macau_slim_player_id';
  try {
    let id = sessionStorage.getItem(key);
    if (!id) {
      id = `sim_${Math.random().toString(36).slice(2, 9)}`;
      sessionStorage.setItem(key, id);
    }
    return id;
  } catch {
    return `sim_${Math.random().toString(36).slice(2, 9)}`;
  }
}

export const App: React.FC = () => {
  const urlParams = new URLSearchParams(window.location.search);
  const autoStart = urlParams.get('autostart') === '1';
  const initialRoom = urlParams.get('room') || 'macau-main';
  const initialRole: PlayerRole = urlParams.get('role') === 'citizen' ? 'citizen' : 'mayor';

  const [phase, setPhase] = useState<GamePhase>(autoStart ? 'playing' : 'title');
  const [playerRole, setPlayerRole] = useState<PlayerRole>(initialRole);
  const [tool, setTool] = useState<ToolMode>('road_street');
  const initialOverlay = urlParams.get('overlay');
  const [overlay, setOverlay] = useState<OverlayMode>(
    initialOverlay === 'traffic' || initialOverlay === 'land_value' ? initialOverlay : 'normal',
  );
  const [showCitizenNav, setShowCitizenNav] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);

  const [playerId] = useState<string>(getOrCreatePlayerId);
  const [playerName, setPlayerName] = useState(initialRole === 'citizen' ? '澳門市民' : '濠江市長');
  const [roomId, setRoomId] = useState(initialRoom);
  const [playerColor, setPlayerColor] = useState(initialRole === 'citizen' ? '#10b981' : '#38bdf8');

  const [cityState, setCityState] = useState<CityState>(() => createInitialCityState(initialRoom));
  const [connected, setConnected] = useState(false);
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const [snapHint, setSnapHint] = useState<{ text: string; screenX: number; screenY: number } | null>(
    null,
  );
  const [selectedInfo, setSelectedInfo] = useState<{
    kind: string;
    title: string;
    subtitle: string;
    id?: string;
    canBuy?: boolean;
    canSell?: boolean;
    hasBuilding?: boolean;
    buildingLevel?: number;
  } | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const phaseRef = useRef<GamePhase>(phase);
  phaseRef.current = phase;

  const showErrorToast = useCallback((msg: string) => {
    setErrorToast(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setErrorToast(null), 3200);
  }, []);

  // Sync body dataset state for state-machine & testability
  useEffect(() => {
    document.body.dataset.state = phase;
    document.body.dataset.overlay = overlay;
  }, [phase, overlay]);

  // Connect & maintain WebSocket session to authoritative server
  const connectWebSocket = useCallback(
    (targetRoom: string, name: string, color: string, role: PlayerRole) => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        ws.send(
          JSON.stringify({
            type: 'join',
            roomId: targetRoom,
            playerId,
            name,
            color,
            role,
          } satisfies ClientAction),
        );
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === 'init' || msg.type === 'state') {
            const incoming = msg.state as CityState;
            setCityState(incoming);
            const me = incoming.players[playerId];
            if (me && phaseRef.current !== 'title') {
              setPlayerRole(me.role);
            }
            if (incoming.stats.gameOverReason) {
              setPhase('gameover');
            }
          } else if (msg.type === 'cursor') {
            setCityState((prev) => {
              const target = prev.players[msg.playerId];
              if (!target) return prev;
              return {
                ...prev,
                players: {
                  ...prev.players,
                  [msg.playerId]: { ...target, cursorPos: msg.pos },
                },
              };
            });
          } else if (msg.type === 'error') {
            showErrorToast(msg.message);
          }
        } catch {
          // Ignore malformed packets
        }
      };

      ws.onclose = () => {
        setConnected(false);
        if (wsRef.current === ws) {
          reconnectTimerRef.current = window.setTimeout(() => {
            connectWebSocket(targetRoom, name, color, role);
          }, 1500);
        }
      };
    },
    [playerId, showErrorToast],
  );

  useEffect(() => {
    connectWebSocket(initialRoom, playerName, playerColor, playerRole);
    return () => {
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        const ws = wsRef.current;
        wsRef.current = null;
        ws.close();
      }
    };
    // Only connect once on mount; room switches call connectWebSocket explicitly
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendAction = useCallback((action: ClientAction) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(action));
    }
  }, []);

  const handleStart = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    const cleanRoom = roomId.trim() || 'macau-main';
    if (cleanRoom !== cityState.roomId || !connected) {
      connectWebSocket(cleanRoom, playerName, playerColor, playerRole);
    } else {
      sendAction({
        type: 'join',
        roomId: cleanRoom,
        playerId,
        name: playerName,
        color: playerColor,
        role: playerRole,
      });
    }
    setSelectedInfo(null);
    setSnapHint(null);
    setPhase('playing');
  }, [cityState.roomId, connectWebSocket, connected, playerColor, playerId, playerName, playerRole, roomId, sendAction]);

  // Global keyboard shortcuts (Escape / P pause modal, Space simulation pause toggle)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        return;
      }
      if (phase === 'playing') {
        if (e.code === 'KeyP') {
          e.preventDefault();
          setPhase('paused');
        } else if (e.code === 'Space') {
          e.preventDefault();
          sendAction({ type: 'set_speed', speed: cityState.simSpeed === 0 ? 1 : 0 });
        }
      } else if (phase === 'paused' && (e.code === 'Escape' || e.code === 'KeyP')) {
        e.preventDefault();
        setPhase('playing');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cityState.simSpeed, phase, sendAction]);

  const activePlayMode: PlayerRole = cityState.players[playerId]?.role ?? playerRole;

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-slate-950">
      <CityViewport
        cityState={cityState}
        phase={phase}
        playMode={activePlayMode}
        tool={tool}
        overlay={overlay}
        showCitizenNav={showCitizenNav}
        snapEnabled={snapEnabled}
        localPlayerId={playerId}
        onAction={sendAction}
        onSelectEntity={setSelectedInfo}
        onSnapHintChange={setSnapHint}
      />

      {phase === 'title' && (
        <TitleOverlay
          playerName={playerName}
          roomId={roomId}
          playerColor={playerColor}
          playerRole={playerRole}
          onChangeName={setPlayerName}
          onChangeRoom={setRoomId}
          onChangeColor={setPlayerColor}
          onChangeRole={(r) => {
            setPlayerRole(r);
            if (playerName === '濠江市長' && r === 'citizen') setPlayerName('澳門市民');
            if (playerName === '澳門市民' && r === 'mayor') setPlayerName('濠江市長');
          }}
          onStart={handleStart}
        />
      )}

      {(phase === 'playing' || phase === 'paused') && (
        <CityHUD
          cityState={cityState}
          playMode={activePlayMode}
          tool={tool}
          overlay={overlay}
          showCitizenNav={showCitizenNav}
          snapEnabled={snapEnabled}
          localPlayerId={playerId}
          connected={connected}
          errorToast={errorToast}
          snapHint={snapHint}
          selectedInfo={selectedInfo}
          onSetPlayMode={(m) => {
            setSnapHint(null);
            setSelectedInfo(null);
            if (connected) {
              sendAction({ type: 'switch_role', role: m });
            } else {
              setPlayerRole(m);
            }
          }}
          onSetTool={(t) => {
            setTool(t);
            setSnapHint(null);
          }}
          onSetOverlay={setOverlay}
          onToggleCitizenNav={() => setShowCitizenNav((v) => !v)}
          onToggleSnap={() => setSnapEnabled((s) => !s)}
          onPauseModal={() => setPhase('paused')}
          onAction={sendAction}
          onErrorToast={showErrorToast}
          onClearSelection={() => setSelectedInfo(null)}
        />
      )}

      {(phase === 'paused' || phase === 'gameover') && (
        <StatusModal
          mode={phase}
          cityState={cityState}
          onResume={() => setPhase('playing')}
          onRestart={() => {
            sendAction({ type: 'reset_city' });
            setSelectedInfo(null);
            setSnapHint(null);
            setPhase('playing');
          }}
          onReturnTitle={() => setPhase('title')}
        />
      )}
    </main>
  );
};

export default App;
