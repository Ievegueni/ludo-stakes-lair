import { useState, useEffect, useCallback } from "react";
import { api, type Room, type RoomPlayer } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Users,
  Plus,
  DoorOpen,
  UserPlus,
  Play,
  Copy,
  LogOut,
  Wallet,
  Lock,
  Globe,
} from "lucide-react";
import type { PlayerColor } from "@/lib/ludo-engine";
import { PlayerAvatar } from "@/components/PlayerAvatar";

const COLORS_AVAILABLE: PlayerColor[] = ["red", "blue", "green", "yellow"];
const COLOR_LABELS: Record<PlayerColor, string> = {
  red: "Vermelho",
  blue: "Azul",
  green: "Verde",
  yellow: "Amarelo",
};

// Nomes próprios + apelidos típicos angolanos. Os "bots" são apresentados
// como humanos (sem badge "🤖") para criar a sensação de jogo realista.
const FIRST_NAMES = [
  "Pedro",
  "João",
  "Manuel",
  "António",
  "Carlos",
  "Paulo",
  "Francisco",
  "José",
  "Rui",
  "Diogo",
  "André",
  "Ricardo",
  "Bruno",
  "Tiago",
  "Hugo",
  "Miguel",
  "Luís",
  "Nuno",
  "Vasco",
  "Filipe",
  "Sérgio",
  "Henrique",
  "Bernardo",
  "Domingos",
  "Mateus",
  "Lourenço",
  "Marcelo",
  "Romeu",
  "Tomás",
  "Wilson",
  "Maria",
  "Ana",
  "Beatriz",
  "Carla",
  "Catarina",
  "Cláudia",
  "Cristina",
  "Daniela",
  "Diana",
  "Helena",
  "Inês",
  "Joana",
  "Júlia",
  "Laura",
  "Leonor",
  "Luísa",
  "Mariana",
  "Marta",
  "Mónica",
  "Patrícia",
  "Raquel",
  "Rita",
  "Rosa",
  "Sandra",
  "Sara",
  "Sílvia",
  "Sofia",
  "Susana",
  "Teresa",
  "Vanessa",
  "Yolanda",
];
const LAST_NAMES = [
  "Silva",
  "Santos",
  "Sousa",
  "Pereira",
  "Oliveira",
  "Costa",
  "Carvalho",
  "Almeida",
  "Lima",
  "Rodrigues",
  "Ferreira",
  "Martins",
  "Gomes",
  "Cardoso",
  "Mendes",
  "Pinto",
  "Barbosa",
  "Cunha",
  "Vieira",
  "Tavares",
  "Domingos",
  "Quissende",
  "Bonga",
  "Mungunza",
  "Capapelo",
  "Tchindande",
];

function generateRandomName(): string {
  const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)]!;
  const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)]!;
  return `${first} ${last}`;
}
const BET_AMOUNTS = [500, 1000, 5000];
const MIN_BET = 500;

interface LobbyProps {
  onStartGame: (
    players: { id: string; name: string; color: PlayerColor; isBot: boolean }[],
    betAmount: number,
    multiplayer?: { gameId: string; isHost: boolean; initialState: any; version: number },
  ) => void;
  balance: number;
  onBalanceRefresh?: () => void;
}

export function Lobby({ onStartGame, balance, onBalanceRefresh }: LobbyProps) {
  const { user } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [tab, setTab] = useState<"rooms" | "create" | "join">("rooms");
  const [selectedBet, setSelectedBet] = useState(500);
  const [customBet, setCustomBet] = useState("");
  const [showCustomBet, setShowCustomBet] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
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
        profiles.forEach((p) => {
          names[p.id] = p.display_name;
        });
        setPlayerNames(names);
      }
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    loadRooms();
    const unsub = api.realtime.subscribe((ev) => {
      if (ev.table === "rooms" || ev.table === "room_players") {
        loadRooms();
        if (currentRoom) loadRoom(currentRoom.id);
      }
    });
    return unsub;
  }, [currentRoom?.id, loadRooms, loadRoom]);

  // Polling fallback: when in a waiting room, poll every 3s to catch status changes
  // (ensures game starts even if SSE is unreliable)
  useEffect(() => {
    if (!currentRoom || currentRoom.status !== "waiting") return;
    const interval = setInterval(() => {
      loadRoom(currentRoom.id);
    }, 3000);
    return () => clearInterval(interval);
  }, [currentRoom?.id, currentRoom?.status, loadRoom]);

  const createRoom = async () => {
    if (!user) return;
    if (selectedBet < MIN_BET) {
      toast.error(`Aposta mínima: ${MIN_BET.toLocaleString()} Kz`);
      return;
    }
    if (balance < selectedBet) {
      toast.error("Saldo insuficiente!");
      return;
    }
    try {
      const room = await api.rooms.create(selectedBet, isPrivate);
      loadRoom(room.id);
      onBalanceRefresh?.();
      toast.success(
        isPrivate
          ? `Sala privada criada! Partilha o código: ${room.code}`
          : `Sala criada! Aposta debitada: ${selectedBet.toLocaleString()} Kz`,
      );
    } catch (err: any) {
      const msg = err?.message || "";
      toast.error(msg.includes("insufficient") ? "Saldo insuficiente!" : "Erro ao criar sala");
    }
  };

  const joinRoom = async (roomId: string) => {
    if (!user) return;
    try {
      const room = await api.rooms.join(roomId);
      setCurrentRoom(room);
      loadRoom(room.id);
      onBalanceRefresh?.();
      toast.success(`Entraste! Aposta de ${room.bet_amount.toLocaleString()} Kz debitada.`);
    } catch (err: any) {
      const msg = err?.message || "";
      const data = err?.data as { required?: number; available?: number } | undefined;
      if (msg.includes("insufficient") || data?.required !== undefined) {
        const need = data?.required ?? 0;
        const have = data?.available ?? balance;
        toast.error(
          need > 0
            ? `Saldo insuficiente. Precisas de ${need.toLocaleString()} Kz (tens ${have.toLocaleString()} Kz).`
            : "Saldo insuficiente para esta aposta",
        );
      } else {
        toast.error(msg || "Erro ao entrar na sala");
      }
    }
  };

  const joinByCode = async () => {
    if (!joinCode.trim()) {
      toast.error("Digita o código da sala");
      return;
    }
    try {
      const room = await api.rooms.byCode(joinCode.toUpperCase());
      await joinRoom(room.id);
    } catch {
      toast.error("Sala não encontrada");
    }
  };

  /**
   * Preenche todas as vagas restantes da sala com "jogadores" — internamente
   * são bots, mas com nomes humanos aleatórios para parecerem reais.
   */
  const fillSeats = async () => {
    if (!currentRoom || !user) return;
    if (currentRoom.host_id !== user.id) {
      toast.error("Só o anfitrião pode preencher vagas");
      return;
    }
    const slotsToFill = currentRoom.max_players - currentRoom.players.length;
    if (slotsToFill <= 0) {
      toast.error("Sala já está cheia");
      return;
    }
    // Adiciona em sequência para evitar colisões de cor/index no servidor
    let lastRoom = currentRoom;
    const usedNames = new Set(lastRoom.players.map((p) => p.bot_name).filter(Boolean));
    let added = 0;
    for (let i = 0; i < slotsToFill; i++) {
      // Garantir nome único
      let name = generateRandomName();
      let attempts = 0;
      while (usedNames.has(name) && attempts < 10) {
        name = generateRandomName();
        attempts++;
      }
      usedNames.add(name);
      try {
        lastRoom = await api.rooms.addBot(currentRoom.id, name);
        setCurrentRoom(lastRoom);
        added++;
      } catch (err: any) {
        toast.error(err.message || "Erro ao preencher vaga");
        break;
      }
    }
    if (added > 0) {
      toast.success(`${added} ${added === 1 ? "jogador adicionado" : "jogadores adicionados"}`);
    }
  };

  const leaveRoom = async () => {
    if (!currentRoom || !user) return;
    try {
      const r = await api.rooms.leave(currentRoom.id);
      setCurrentRoom(null);
      setHasStarted(false);
      // Refresca saldo e mostra mensagem coerente com o que o servidor decidiu.
      // O servidor é a fonte da verdade — só faz refund se a sala ainda
      // estava em 'waiting' E não havia game record.
      onBalanceRefresh?.();
      if (r.refunded) {
        toast.success("Saíste da sala. Aposta reembolsada.");
      } else {
        toast.info("Saíste da sala.");
      }
      loadRooms();
    } catch {}
  };

  const triggerStart = useCallback(
    async (room: Room) => {
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
          profiles.forEach((p) => {
            names[p.id] = p.display_name;
          });
        } catch {}
      }
      const gamePlayers = room.players
        .sort((a, b) => a.player_index - b.player_index)
        .map((p) => ({
          id: p.is_bot ? `bot-${p.id}` : p.user_id!,
          name: p.is_bot ? p.bot_name || "Jogador" : names[p.user_id!] || "Jogador",
          color: p.color as PlayerColor,
          isBot: p.is_bot,
        }));
      onStartGame(gamePlayers, room.bet_amount);
    },
    [hasStarted, user, playerNames, onStartGame],
  );

  // Auto-start when room status flips to 'playing' (works for host AND joining players)
  useEffect(() => {
    if (currentRoom?.status === "playing" && !hasStarted) {
      triggerStart(currentRoom);
    }
  }, [currentRoom?.status, hasStarted, triggerStart, currentRoom]);

  const startGame = async () => {
    if (!currentRoom || !user) return;
    if (currentRoom.host_id !== user.id) {
      toast.error("Só o anfitrião pode iniciar");
      return;
    }
    if (currentRoom.players.length < 2) {
      toast.error("Mínimo 2 jogadores");
      return;
    }
    try {
      // Atomically: server creates game record + flips room.status to 'playing'.
      // The realtime UPDATE on the room then fires our effect on every client.
      await api.games.start(currentRoom.id);
    } catch (err: any) {
      toast.error(err?.message || "Erro ao iniciar");
    }
  };

  // Room view — vidro + acentos dourados
  if (currentRoom) {
    const glassCard: React.CSSProperties = {
      background: "rgba(255,255,255,0.05)",
      backdropFilter: "blur(16px)",
      WebkitBackdropFilter: "blur(16px)",
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08), 0 10px 30px rgba(0,0,0,0.35)",
    };

    return (
      <div className="space-y-3">
        {/* Header da sala */}
        <div
          className="rounded-2xl p-4 border border-white/10 flex items-center justify-between"
          style={glassCard}
        >
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold flex items-center gap-1.5">
              Sala de Espera
              {currentRoom.is_private && (
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-extrabold"
                  style={{
                    background:
                      "linear-gradient(135deg, rgba(124,58,237,0.55), rgba(59,130,246,0.40))",
                    border: "1px solid rgba(124,58,237,0.60)",
                    color: "#e9d5ff",
                  }}
                >
                  <Lock className="w-2.5 h-2.5" />
                  PRIVADA
                </span>
              )}
            </p>
            <div className="flex items-center gap-2 mt-1">
              <span
                className="font-mono font-extrabold text-lg tracking-[0.2em]"
                style={{
                  background: "var(--grad-pot)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                {currentRoom.code}
              </span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(currentRoom.code);
                  toast.success("Código copiado!");
                }}
                className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-white/5"
                aria-label="Copiar código"
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
              Aposta
            </p>
            <p
              className="text-lg font-extrabold"
              style={{
                background: "var(--grad-pot)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              {currentRoom.bet_amount.toLocaleString()} Kz
            </p>
          </div>
        </div>

        {/* Players + vagas */}
        <div className="space-y-2 rounded-2xl p-3 border border-white/10" style={glassCard}>
          {currentRoom.players
            .sort((a, b) => a.player_index - b.player_index)
            .map((p) => {
              const displayName = p.is_bot
                ? p.bot_name || "Bot"
                : p.user_id === user?.id
                  ? "Tu"
                  : playerNames[p.user_id!] || "Jogador";
              return (
                <div
                  key={p.id}
                  className="flex items-center gap-3 rounded-xl p-2.5 border border-white/8"
                  style={{ background: "rgba(255,255,255,0.04)" }}
                >
                  <PlayerAvatar
                    name={displayName}
                    color={p.color as PlayerColor}
                    size={36}
                    isBot={p.is_bot}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-foreground truncate">{displayName}</p>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                      {COLOR_LABELS[p.color as PlayerColor]}
                    </p>
                  </div>
                  {/* Estado de pagamento — bots não pagam, humanos sim */}
                  {!p.is_bot && (
                    <span
                      className={`text-[9px] px-2 py-0.5 rounded-full font-extrabold uppercase tracking-wider flex items-center gap-1 ${
                        p.bet_paid ? "text-emerald-300" : "text-amber-300"
                      }`}
                      style={{
                        background: p.bet_paid ? "rgba(16,185,129,0.15)" : "rgba(251,191,36,0.15)",
                        border: p.bet_paid
                          ? "1px solid rgba(16,185,129,0.40)"
                          : "1px solid rgba(251,191,36,0.40)",
                      }}
                      title={
                        p.bet_paid
                          ? `Aposta de ${currentRoom.bet_amount.toLocaleString()} Kz já debitada`
                          : "Aposta ainda não debitada"
                      }
                    >
                      {p.bet_paid ? "✓ Pago" : "⏳ Pendente"}
                    </span>
                  )}
                  {p.user_id === currentRoom.host_id && (
                    <span
                      className="text-[9px] px-2 py-0.5 rounded-full font-extrabold uppercase tracking-wider text-amber-950"
                      style={{
                        background: "var(--grad-pot)",
                        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.4)",
                      }}
                    >
                      Anfitrião
                    </span>
                  )}
                </div>
              );
            })}

          {/* Vagas abertas */}
          {Array.from({
            length: currentRoom.max_players - currentRoom.players.length,
          }).map((_, i) => (
            <div
              key={`empty-${i}`}
              className="flex items-center gap-3 rounded-xl p-2.5 border border-dashed border-white/15"
              style={{ background: "rgba(255,255,255,0.02)" }}
            >
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px dashed rgba(255,255,255,0.15)",
                }}
              >
                <Users className="w-4 h-4 text-muted-foreground/70" />
              </div>
              <p className="text-sm text-muted-foreground italic">Vaga aberta</p>
            </div>
          ))}
        </div>

        {/* Actions (host) */}
        {currentRoom.host_id === user?.id && (
          <div className="flex gap-2">
            <button
              onClick={fillSeats}
              disabled={currentRoom.players.length >= currentRoom.max_players}
              className="flex-1 py-3 rounded-2xl font-bold text-sm uppercase tracking-wider transition-transform flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.12)",
                backdropFilter: "blur(12px)",
                WebkitBackdropFilter: "blur(12px)",
                color: "#fff",
              }}
            >
              <UserPlus className="w-4 h-4" />
              Preencher
            </button>
            <button
              onClick={startGame}
              disabled={currentRoom.players.length < 2}
              className="flex-1 py-3 rounded-2xl font-extrabold text-sm uppercase tracking-wider transition-transform flex items-center justify-center gap-2 text-amber-950 hover:scale-[1.02] active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: "var(--grad-roll-btn)",
                boxShadow: "0 6px 20px rgba(245,158,11,0.45), inset 0 1px 0 rgba(255,255,255,0.45)",
              }}
            >
              <Play className="w-4 h-4" />
              Iniciar
            </button>
          </div>
        )}

        <button
          onClick={leaveRoom}
          className="w-full py-2.5 rounded-2xl font-bold text-sm uppercase tracking-wider transition-transform flex items-center justify-center gap-2 text-destructive hover:scale-[1.02] active:scale-95"
          style={{
            background: "rgba(220,38,38,0.10)",
            border: "1px solid rgba(220,38,38,0.30)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
          }}
        >
          <LogOut className="w-4 h-4" />
          Sair da Sala
        </button>
      </div>
    );
  }

  // Lobby view
  return (
    <div className="space-y-4">
      {/* Tabs — glassmorphism */}
      <div
        className="flex gap-1 rounded-2xl p-1 border border-white/10"
        style={{
          background: "rgba(255,255,255,0.04)",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06)",
        }}
      >
        {[
          { key: "rooms" as const, label: "Salas", icon: Users },
          { key: "create" as const, label: "Criar", icon: Plus },
          { key: "join" as const, label: "Código", icon: DoorOpen },
        ].map(({ key, label, icon: Icon }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-bold transition-all ${
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
              style={
                active
                  ? {
                      background:
                        "linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.06) 100%)",
                      boxShadow:
                        "0 4px 12px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.20)",
                    }
                  : undefined
              }
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          );
        })}
      </div>

      {tab === "rooms" && (
        <div className="space-y-2">
          {rooms.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center text-center py-10 px-6 rounded-2xl border border-white/10"
              style={{
                background: "rgba(255,255,255,0.04)",
                backdropFilter: "blur(16px)",
                WebkitBackdropFilter: "blur(16px)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08), 0 10px 30px rgba(0,0,0,0.35)",
              }}
            >
              <div
                className="w-16 h-16 rounded-full mb-3 flex items-center justify-center"
                style={{
                  background:
                    "linear-gradient(135deg, rgba(124,58,237,0.35), rgba(59,130,246,0.25))",
                  boxShadow:
                    "inset 0 1px 0 rgba(255,255,255,0.15), 0 4px 14px rgba(124,58,237,0.35)",
                }}
              >
                <Users className="w-7 h-7 text-white/85" />
              </div>
              <p className="font-bold text-foreground">Nenhuma sala aberta</p>
              <p className="text-sm text-muted-foreground mt-1">
                Cria uma sala nova ou entra com código!
              </p>
            </div>
          ) : (
            rooms.map((room) => (
              <div
                key={room.id}
                className="rounded-2xl p-4 border border-white/10 transition-transform hover:scale-[1.01]"
                style={{
                  background: "rgba(255,255,255,0.05)",
                  backdropFilter: "blur(14px)",
                  WebkitBackdropFilter: "blur(14px)",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08), 0 6px 18px rgba(0,0,0,0.35)",
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-sm font-bold text-foreground/90 tracking-wider">
                    {room.code}
                  </span>
                  <span
                    className="text-xs font-extrabold px-2 py-0.5 rounded-full"
                    style={{
                      background: "var(--grad-pot)",
                      color: "#3f2a07",
                      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.45)",
                    }}
                  >
                    {room.bet_amount.toLocaleString()} Kz
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-semibold text-muted-foreground">
                      {room.players.length}/{room.max_players}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => joinRoom(room.id)}
                    disabled={room.players.length >= room.max_players}
                  >
                    Entrar
                  </Button>
                </div>
              </div>
            ))
          )}
          {/* Actualizar Lista — gradient dourado */}
          <button
            onClick={loadRooms}
            className="w-full py-3 rounded-2xl font-extrabold uppercase tracking-wider text-amber-950 transition-transform hover:scale-[1.02] active:scale-95"
            style={{
              background: "var(--grad-roll-btn)",
              boxShadow: "0 6px 20px rgba(245,158,11,0.35), inset 0 1px 0 rgba(255,255,255,0.45)",
            }}
          >
            Actualizar Lista
          </button>
        </div>
      )}

      {tab === "create" && (
        <div
          className="space-y-4 rounded-2xl p-5 border border-white/10"
          style={{
            background: "rgba(255,255,255,0.04)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08), 0 10px 30px rgba(0,0,0,0.35)",
          }}
        >
          <div>
            <p className="text-sm font-bold text-foreground mb-2.5 uppercase tracking-wider">
              Valor da Aposta
            </p>
            <div className="grid grid-cols-2 gap-2">
              {BET_AMOUNTS.map((amount) => {
                const sel = !showCustomBet && selectedBet === amount;
                return (
                  <button
                    key={amount}
                    onClick={() => {
                      setSelectedBet(amount);
                      setShowCustomBet(false);
                      setCustomBet("");
                    }}
                    className="py-3 rounded-xl text-sm font-bold transition-all hover:scale-[1.02] active:scale-95"
                    style={
                      sel
                        ? {
                            background: "var(--grad-pot)",
                            color: "#3f2a07",
                            boxShadow:
                              "0 4px 14px rgba(245,158,11,0.45), inset 0 1px 0 rgba(255,255,255,0.45)",
                          }
                        : {
                            background: "rgba(255,255,255,0.05)",
                            color: "#fff",
                            border: "1px solid rgba(255,255,255,0.10)",
                            backdropFilter: "blur(8px)",
                            WebkitBackdropFilter: "blur(8px)",
                          }
                    }
                  >
                    {amount.toLocaleString()} Kz
                  </button>
                );
              })}
              <button
                onClick={() => setShowCustomBet(true)}
                className="py-3 rounded-xl text-sm font-bold transition-all hover:scale-[1.02] active:scale-95"
                style={
                  showCustomBet
                    ? {
                        background: "var(--grad-pot)",
                        color: "#3f2a07",
                        boxShadow:
                          "0 4px 14px rgba(245,158,11,0.45), inset 0 1px 0 rgba(255,255,255,0.45)",
                      }
                    : {
                        background: "rgba(255,255,255,0.05)",
                        color: "#fff",
                        border: "1px solid rgba(255,255,255,0.10)",
                        backdropFilter: "blur(8px)",
                        WebkitBackdropFilter: "blur(8px)",
                      }
                }
              >
                Outro valor
              </button>
            </div>
            {showCustomBet && (
              <div className="mt-2.5 flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={MIN_BET}
                    step={100}
                    value={customBet}
                    onChange={(e) => {
                      setCustomBet(e.target.value);
                      const val = Number(e.target.value);
                      if (val >= MIN_BET) setSelectedBet(val);
                    }}
                    placeholder={`Mín. ${MIN_BET.toLocaleString()} Kz`}
                    className="w-full py-2.5 px-3 pr-10 rounded-xl text-sm font-bold bg-white/5 border border-white/10 text-white placeholder:text-white/40 outline-none focus:border-amber-500/50 transition-colors"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/40 font-bold">
                    Kz
                  </span>
                </div>
              </div>
            )}
            {showCustomBet && customBet && Number(customBet) < MIN_BET && (
              <p className="text-xs text-destructive mt-1 font-bold">
                Aposta mínima: {MIN_BET.toLocaleString()} Kz
              </p>
            )}
          </div>

          <div
            className="rounded-xl p-3 border border-amber-500/25"
            style={{
              background: "linear-gradient(135deg, rgba(245,158,11,0.10), rgba(124,58,237,0.06))",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06)",
            }}
          >
            <p className="text-[10px] uppercase tracking-wider text-amber-200/80 font-bold">
              Prémio para o vencedor
            </p>
            <p
              className="text-2xl font-extrabold"
              style={{
                background: "var(--grad-pot)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              {Math.floor(selectedBet * 4 * 0.95).toLocaleString()} Kz
            </p>
            <p className="text-[11px] text-muted-foreground">
              4 jogadores × {selectedBet.toLocaleString()} Kz · 5% taxa
            </p>
          </div>

          {/* Toggle: Pública vs Privada */}
          <div>
            <p className="text-sm font-bold text-foreground mb-2.5 uppercase tracking-wider">
              Visibilidade
            </p>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { val: false, icon: Globe, label: "Pública", desc: "Aparece a todos" },
                  { val: true, icon: Lock, label: "Privada", desc: "Só por código" },
                ] as const
              ).map(({ val, icon: Icon, label, desc }) => {
                const sel = isPrivate === val;
                return (
                  <button
                    key={String(val)}
                    onClick={() => setIsPrivate(val)}
                    className="flex flex-col items-center gap-1 py-2.5 rounded-xl text-xs font-bold transition-all hover:scale-[1.02] active:scale-95"
                    style={
                      sel
                        ? {
                            background:
                              "linear-gradient(135deg, rgba(124,58,237,0.45), rgba(59,130,246,0.30))",
                            border: "1px solid rgba(124,58,237,0.60)",
                            color: "#fff",
                            boxShadow:
                              "0 4px 14px rgba(124,58,237,0.40), inset 0 1px 0 rgba(255,255,255,0.18)",
                          }
                        : {
                            background: "rgba(255,255,255,0.05)",
                            border: "1px solid rgba(255,255,255,0.10)",
                            color: "rgba(255,255,255,0.6)",
                          }
                    }
                  >
                    <Icon className="w-4 h-4" />
                    <span>{label}</span>
                    <span className="text-[9px] font-medium opacity-80">{desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <button
            onClick={createRoom}
            disabled={balance < selectedBet || selectedBet < MIN_BET}
            className="w-full py-3 rounded-2xl font-extrabold uppercase tracking-wider text-amber-950 transition-transform disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-95"
            style={{
              background: "var(--grad-roll-btn)",
              boxShadow: "0 6px 20px rgba(245,158,11,0.35), inset 0 1px 0 rgba(255,255,255,0.45)",
            }}
          >
            {isPrivate ? <Lock className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {isPrivate ? "Criar Sala Privada" : "Criar Sala"}
          </button>
          {balance < selectedBet && (
            <p className="text-xs text-destructive text-center font-bold">
              Saldo insuficiente. Adiciona fundos na carteira.
            </p>
          )}
        </div>
      )}

      {tab === "join" && (
        <div
          className="space-y-4 rounded-2xl p-5 border border-white/10"
          style={{
            background: "rgba(255,255,255,0.04)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08), 0 10px 30px rgba(0,0,0,0.35)",
          }}
        >
          <div className="space-y-2">
            <label className="text-sm font-bold text-foreground uppercase tracking-wider">
              Código da Sala
            </label>
            <Input
              placeholder="Ex: ABC123"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              className="text-center font-mono text-lg tracking-[0.4em] font-bold bg-white/5 border-white/15 backdrop-blur"
              maxLength={6}
            />
          </div>
          <button
            onClick={joinByCode}
            className="w-full py-3 rounded-2xl font-extrabold uppercase tracking-wider text-amber-950 transition-transform flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-95"
            style={{
              background: "var(--grad-roll-btn)",
              boxShadow: "0 6px 20px rgba(245,158,11,0.35), inset 0 1px 0 rgba(255,255,255,0.45)",
            }}
          >
            <DoorOpen className="w-4 h-4" />
            Entrar na Sala
          </button>
        </div>
      )}
    </div>
  );
}
