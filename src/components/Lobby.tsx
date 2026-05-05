import { useState, useEffect, useCallback } from 'react';
import { api, type Room, type RoomPlayer } from '@/lib/api';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Users, Plus, DoorOpen, Bot, Play, Copy, LogOut, Wallet } from 'lucide-react';
import type { PlayerColor } from '@/lib/ludo-engine';

const COLORS_AVAILABLE: PlayerColor[] = ['red', 'blue', 'green', 'yellow'];
const COLOR_LABELS: Record<PlayerColor, string> = {
  red: 'Vermelho',
  blue: 'Azul',
  green: 'Verde',
  yellow: 'Amarelo',
};

const BOT_NAMES = ['Robo-1', 'AI-2', 'Bot-3', 'Cyber-4', 'Maquina', 'Jogador-Auto'];
const BET_AMOUNTS = [100, 500, 1000, 5000];

interface LobbyProps {
  onStartGame: (
    players: { id: string; name: string; color: PlayerColor; isBot: boolean }[],
    betAmount: number,
    multiplayer?: { gameId: string; isHost: boolean; initialState: any; version: number },
  ) => void;
  balance: number;
}

export function Lobby({ onStartGame, balance }: LobbyProps) {
  const { user } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [tab, setTab] = useState<'rooms' | 'create' | 'join'>('rooms');
  const [selectedBet, setSelectedBet] = useState(100);
  const [playerNames, setPlayerNames] = useState<Record<string, string>>({});
  const [hasStarted, setHasStarted] = useState(false);

  const loadRooms = useCallback(async () => {
    try {
      const r = await api.rooms.listWaiting();
      setRooms(r);
    } catch (err) {
      console.error(err);
    }
  }, []);

  const loadRoom = useCallback(async (id: string) => {
    try {
      const room = await api.rooms.get(id);
      setCurrentRoom(room);
      const humanIds = room.players.filter((p) => !p.is_bot && p.user_id).map((p) => p.user_id!);
      if (humanIds.length > 0) {
        const profiles = await api.profiles.getMany(humanIds);
        const names: Record<string, string> = {};
        profiles.forEach((p) => { names[p.id] = p.display_name; });
        setPlayerNames(names);
      }
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    loadRooms();
    const unsub = api.realtime.subscribe((ev) => {
      if (ev.table === 'rooms' || ev.table === 'room_players') {
        loadRooms();
        if (currentRoom) loadRoom(currentRoom.id);
      }
    });
    return unsub;
  }, [currentRoom?.id, loadRooms, loadRoom]);

  // Polling fallback: when in a waiting room, poll every 3s to catch status changes
  // (ensures game starts even if SSE is unreliable)
  useEffect(() => {
    if (!currentRoom || currentRoom.status !== 'waiting') return;
    const interval = setInterval(() => {
      loadRoom(currentRoom.id);
    }, 3000);
    return () => clearInterval(interval);
  }, [currentRoom?.id, currentRoom?.status, loadRoom]);

  const createRoom = async () => {
    if (!user) return;
    if (balance < selectedBet) {
      toast.error('Saldo insuficiente!');
      return;
    }
    try {
      const room = await api.rooms.create(selectedBet);
      loadRoom(room.id);
      toast.success(`Sala criada! Código: ${room.code}`);
    } catch {
      toast.error('Erro ao criar sala');
    }
  };

  const joinRoom = async (roomId: string) => {
    if (!user) return;
    try {
      const room = await api.rooms.join(roomId);
      setCurrentRoom(room);
      loadRoom(room.id);
      toast.success('Entraste na sala!');
    } catch (err: any) {
      toast.error(err.message || 'Erro ao entrar na sala');
    }
  };

  const joinByCode = async () => {
    if (!joinCode.trim()) {
      toast.error('Digita o código da sala');
      return;
    }
    try {
      const room = await api.rooms.byCode(joinCode.toUpperCase());
      await joinRoom(room.id);
    } catch {
      toast.error('Sala não encontrada');
    }
  };

  const addBot = async () => {
    if (!currentRoom || !user) return;
    if (currentRoom.host_id !== user.id) {
      toast.error('Só o anfitrião pode adicionar bots');
      return;
    }
    const botName = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
    try {
      const room = await api.rooms.addBot(currentRoom.id, botName);
      setCurrentRoom(room);
      toast.success(`${botName} adicionado!`);
    } catch (err: any) {
      toast.error(err.message || 'Erro ao adicionar bot');
    }
  };

  const leaveRoom = async () => {
    if (!currentRoom || !user) return;
    try {
      await api.rooms.leave(currentRoom.id);
      setCurrentRoom(null);
      loadRooms();
    } catch {}
  };

  const triggerStart = useCallback(async (room: Room) => {
    if (hasStarted || !user) return;
    setHasStarted(true);

    // Try to fetch the synchronized game record
    let gameRecord: { id: string; state: any; version: number; host_id: string } | null = null;
    try {
      const g = await api.games.byRoom(room.id);
      gameRecord = g;
    } catch {
      // Game might not exist yet (e.g. host failed to call start). Fall back.
    }

    if (gameRecord) {
      const players = (gameRecord.state.players as any[]).map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color as PlayerColor,
        isBot: p.isBot,
      }));
      onStartGame(players, room.bet_amount, {
        gameId: gameRecord.id,
        isHost: gameRecord.host_id === user.id,
        initialState: gameRecord.state,
        version: gameRecord.version,
      });
      return;
    }

    // Fallback: local state (should not normally happen)
    const humanIds = room.players.filter((p) => !p.is_bot && p.user_id).map((p) => p.user_id!);
    let names: Record<string, string> = { ...playerNames };
    if (humanIds.length > 0) {
      try {
        const profiles = await api.profiles.getMany(humanIds);
        profiles.forEach((p) => { names[p.id] = p.display_name; });
      } catch {}
    }
    const gamePlayers = room.players
      .sort((a, b) => a.player_index - b.player_index)
      .map((p) => ({
        id: p.is_bot ? `bot-${p.id}` : p.user_id!,
        name: p.is_bot ? (p.bot_name || 'Bot') : (names[p.user_id!] || 'Jogador'),
        color: p.color as PlayerColor,
        isBot: p.is_bot,
      }));
    onStartGame(gamePlayers, room.bet_amount);
  }, [hasStarted, user, playerNames, onStartGame]);

  // Auto-start when room status flips to 'playing' (works for host AND joining players)
  useEffect(() => {
    if (currentRoom?.status === 'playing' && !hasStarted) {
      triggerStart(currentRoom);
    }
  }, [currentRoom?.status, hasStarted, triggerStart, currentRoom]);

  const startGame = async () => {
    if (!currentRoom || !user) return;
    if (currentRoom.host_id !== user.id) {
      toast.error('Só o anfitrião pode iniciar');
      return;
    }
    if (currentRoom.players.length < 2) {
      toast.error('Mínimo 2 jogadores');
      return;
    }
    try {
      // Atomically: server creates game record + flips room.status to 'playing'.
      // The realtime UPDATE on the room then fires our effect on every client.
      await api.games.start(currentRoom.id);
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao iniciar');
    }
  };

  // Room view
  if (currentRoom) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-foreground">Sala de Espera</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm text-muted-foreground">Código:</span>
              <span className="font-mono font-bold text-primary text-lg">{currentRoom.code}</span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(currentRoom.code);
                  toast.success('Código copiado!');
                }}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm text-muted-foreground">Aposta</p>
            <p className="text-lg font-bold text-accent">{currentRoom.bet_amount.toLocaleString()} Kz</p>
          </div>
        </div>

        {/* Players */}
        <div className="space-y-2">
          {currentRoom.players.sort((a, b) => a.player_index - b.player_index).map((p) => (
            <div key={p.id} className="flex items-center gap-3 bg-secondary/50 rounded-lg p-3">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-sm"
                style={{ backgroundColor: p.color === 'red' ? '#ef4444' : p.color === 'blue' ? '#3b82f6' : p.color === 'green' ? '#22c55e' : '#eab308' }}
              >
                {p.is_bot ? '🤖' : '👤'}
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">
                  {p.is_bot ? p.bot_name : (p.user_id === user?.id ? 'Tu' : (playerNames[p.user_id!] || 'Jogador'))}
                </p>
                <p className="text-xs text-muted-foreground">{COLOR_LABELS[p.color as PlayerColor]}</p>
              </div>
              {p.user_id === currentRoom.host_id && (
                <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full">Anfitrião</span>
              )}
            </div>
          ))}

          {/* Empty slots */}
          {Array.from({ length: currentRoom.max_players - currentRoom.players.length }).map((_, i) => (
            <div key={`empty-${i}`} className="flex items-center gap-3 bg-secondary/20 rounded-lg p-3 border border-dashed border-border">
              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                <Users className="w-4 h-4 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">Vaga aberta</p>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          {currentRoom.host_id === user?.id && (
            <>
              <Button onClick={addBot} variant="outline" className="flex-1 gap-2" disabled={currentRoom.players.length >= currentRoom.max_players}>
                <Bot className="w-4 h-4" />
                Adicionar Bot
              </Button>
              <Button onClick={startGame} className="flex-1 gap-2" disabled={currentRoom.players.length < 2}>
                <Play className="w-4 h-4" />
                Iniciar Jogo
              </Button>
            </>
          )}
        </div>

        <Button onClick={leaveRoom} variant="ghost" className="w-full gap-2 text-destructive hover:text-destructive">
          <LogOut className="w-4 h-4" />
          Sair da Sala
        </Button>
      </div>
    );
  }

  // Lobby view
  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-1 bg-secondary rounded-lg p-1">
        {[
          { key: 'rooms' as const, label: 'Salas', icon: Users },
          { key: 'create' as const, label: 'Criar', icon: Plus },
          { key: 'join' as const, label: 'Código', icon: DoorOpen },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'rooms' && (
        <div className="space-y-2">
          {rooms.length === 0 ? (
            <div className="text-center py-8">
              <Users className="w-12 h-12 text-muted-foreground mx-auto mb-2" />
              <p className="text-muted-foreground">Nenhuma sala aberta</p>
              <p className="text-sm text-muted-foreground">Cria uma sala nova!</p>
            </div>
          ) : (
            rooms.map((room) => (
              <div key={room.id} className="bg-card rounded-xl border border-border p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-sm text-muted-foreground">{room.code}</span>
                  <span className="text-sm font-bold text-accent">{room.bet_amount.toLocaleString()} Kz</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <Users className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      {room.players.length}/{room.max_players}
                    </span>
                  </div>
                  <Button size="sm" onClick={() => joinRoom(room.id)} disabled={room.players.length >= room.max_players}>
                    Entrar
                  </Button>
                </div>
              </div>
            ))
          )}
          <Button variant="outline" onClick={loadRooms} className="w-full">
            Actualizar Lista
          </Button>
        </div>
      )}

      {tab === 'create' && (
        <div className="space-y-4">
          <div>
            <p className="text-sm font-medium text-foreground mb-2">Valor da Aposta</p>
            <div className="grid grid-cols-2 gap-2">
              {BET_AMOUNTS.map((amount) => (
                <button
                  key={amount}
                  onClick={() => setSelectedBet(amount)}
                  className={`py-3 rounded-xl border-2 text-sm font-bold transition-all ${
                    selectedBet === amount
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-card text-foreground hover:border-primary/50'
                  }`}
                >
                  {amount.toLocaleString()} Kz
                </button>
              ))}
            </div>
          </div>

          <div className="bg-secondary/50 rounded-lg p-3">
            <p className="text-xs text-muted-foreground">Prémio para o vencedor (estimado)</p>
            <p className="text-lg font-bold text-primary">
              {Math.floor(selectedBet * 4 * 0.95).toLocaleString()} Kz
            </p>
            <p className="text-xs text-muted-foreground">4 jogadores × {selectedBet.toLocaleString()} Kz - 5% taxa</p>
          </div>

          <Button onClick={createRoom} className="w-full gap-2" disabled={balance < selectedBet}>
            <Plus className="w-4 h-4" />
            Criar Sala
          </Button>
          {balance < selectedBet && (
            <p className="text-xs text-destructive text-center">Saldo insuficiente. Adiciona fundos na carteira.</p>
          )}
        </div>
      )}

      {tab === 'join' && (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Código da Sala</label>
            <Input
              placeholder="Ex: ABC123"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              className="text-center font-mono text-lg tracking-widest"
              maxLength={6}
            />
          </div>
          <Button onClick={joinByCode} className="w-full gap-2">
            <DoorOpen className="w-4 h-4" />
            Entrar na Sala
          </Button>
        </div>
      )}
    </div>
  );
}
