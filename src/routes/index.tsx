import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { AuthPhone } from "@/components/AuthPhone";
import { LudoBoard } from "@/components/LudoBoard";
import { Lobby } from "@/components/Lobby";
import { Wallet } from "@/components/Wallet";
import { Profile } from "@/components/Profile";
import { api } from "@/lib/api";
import { createPlayer, type PlayerColor } from "@/lib/ludo-engine";
import { Toaster, toast } from "sonner";
import { LogOut, Wallet as WalletIcon, Gamepad2, User, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { isMuted, setMuted } from "@/utils/sound";
import { requestNotificationPermission } from "@/utils/notifications";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "NANTER - Aposta e Joga" },
      {
        name: "description",
        content:
          "NANTER - Jogo de Ludo online com apostas em Kwanza. Joga com amigos ou bots e ganha dinheiro!",
      },
    ],
  }),
  component: Index,
});

interface GamePlayer {
  id: string;
  name: string;
  color: PlayerColor;
  isBot: boolean;
}

interface MultiplayerInfo {
  gameId: string;
  isHost: boolean;
  initialState: any;
  version: number;
}

function Index() {
  const { user, loading, signOut } = useAuth();
  const [view, setView] = useState<"lobby" | "wallet" | "game" | "profile">("lobby");
  const [gamePlayers, setGamePlayers] = useState<GamePlayer[] | null>(null);
  const [gameBetAmount, setGameBetAmount] = useState(0);
  const [multiplayer, setMultiplayer] = useState<MultiplayerInfo | null>(null);
  const [balance, setBalance] = useState(0);
  const [displayName, setDisplayName] = useState("Jogador");
  const [muted, setMutedState] = useState<boolean>(() => isMuted());

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    setMutedState(next);
  };

  // Bootstrap: carrega tudo em paralelo no primeiro mount (após login). Não
  // refetch ao trocar de tab — só quando o user muda. Isto corta uma cascata
  // de 4-5 round-trips sequenciais para 1 só burst em paralelo.
  const reconnectAttemptedRef = useRef(false);
  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    (async () => {
      // Tudo em paralelo — não há dependências entre estes fetches
      const [profileRes, balanceRes, activeRes] = await Promise.allSettled([
        api.profiles.me(),
        api.wallet.get(),
        // Só corre o reconnect uma vez por sessão de login
        reconnectAttemptedRef.current ? Promise.resolve(null) : api.games.active(),
      ]);

      if (cancelled) return;

      if (profileRes.status === "fulfilled" && profileRes.value) {
        setDisplayName(profileRes.value.display_name);
      }
      if (balanceRes.status === "fulfilled") {
        setBalance(balanceRes.value);
      }

      // Reconnect — só na primeira passagem
      if (!reconnectAttemptedRef.current) {
        reconnectAttemptedRef.current = true;
        if (activeRes.status === "fulfilled" && activeRes.value) {
          const game = activeRes.value;
          const stateAny = game.state as {
            winner?: string | null;
            players?: Array<{ id: string; resigned?: boolean }>;
          };
          if (stateAny.winner) return;
          const me = stateAny.players?.find((p) => p.id === user.id);
          if (!me || me.resigned) return;

          // OK, reentrar — busca a room em paralelo (não bloqueia o gameplay)
          const playersFromState = (game.state.players as any[]).map((p) => ({
            id: p.id,
            name: p.name,
            color: p.color as PlayerColor,
            isBot: p.isBot,
          }));
          const room = await api.rooms.get(game.room_id).catch(() => null);
          if (cancelled) return;
          setGamePlayers(playersFromState);
          setGameBetAmount(room?.bet_amount ?? 0);
          setMultiplayer({
            gameId: game.id,
            isHost: game.host_id === user.id,
            initialState: game.state,
            version: game.version,
          });
          setView("game");
          toast.info("Reconectado ao jogo em curso");
        }
      }

      // Notificações — operação síncrona/idempotente, não precisa estar no caminho crítico
      requestNotificationPermission();
    })();

    return () => {
      cancelled = true;
    };
  }, [user]); // <- só re-corre quando o user muda, NÃO em cada troca de tab

  const loadBalance = async () => {
    try {
      const bal = await api.wallet.get();
      setBalance(bal);
    } catch {}
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <img
            src="/logo.png"
            alt="NANTER"
            className="w-24 h-24 mx-auto mb-4 object-contain anim-float"
            style={{ filter: "drop-shadow(0 6px 20px rgba(124,58,237,0.55))" }}
            draggable={false}
          />
          <p className="text-white/85 font-bold tracking-wider uppercase text-sm">A carregar...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <Toaster position="top-center" richColors />
        <AuthPhone />
      </>
    );
  }

  if (view === "game" && gamePlayers) {
    const players = gamePlayers.map((p) => createPlayer(p.id, p.name, p.color, p.isBot));
    return (
      <>
        <Toaster position="top-center" richColors />
        {/* Mute flutuante — o header do lobby não existe durante o jogo */}
        <button
          onClick={toggleMute}
          className="fixed top-2 right-2 z-50 text-white/70 hover:text-white transition-colors p-2 rounded-full bg-black/40 backdrop-blur-sm"
          aria-label={muted ? "Activar som" : "Silenciar"}
          title={muted ? "Activar som" : "Silenciar"}
        >
          {muted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
        </button>
        <div className="min-h-screen p-4 overflow-hidden">
          <LudoBoard
            players={players}
            betAmount={gameBetAmount}
            balance={balance}
            onBalanceChange={setBalance}
            currentUserId={user!.id}
            multiplayer={multiplayer}
            onGameEnd={() => {
              // Settle no servidor é automático; aqui só refrescamos o saldo
              // local. O modal de vitória fica aberto até o user clicar
              // "Voltar ao Lobby" → onLeaveGame.
              loadBalance();
            }}
            onLeaveGame={() => {
              setView("lobby");
              setGamePlayers(null);
              setMultiplayer(null);
              setGameBetAmount(0);
              loadBalance();
              // Permite que o reconnect volte a tentar (caso o user entre noutro jogo)
              reconnectAttemptedRef.current = true;
            }}
          />
        </div>
      </>
    );
  }

  return (
    <>
      <Toaster position="top-center" richColors />
      <div className="min-h-screen">
        {/* Header — gradiente vertical com fade-out (sem cor sólida) */}
        <header
          className="sticky top-0 z-40 backdrop-blur-md"
          style={{
            background:
              "linear-gradient(180deg, rgba(11,8,23,0.85) 0%, rgba(11,8,23,0.55) 60%, rgba(11,8,23,0) 100%)",
            borderBottom: "none",
          }}
        >
          <div className="max-w-lg mx-auto flex items-center justify-between px-4 py-3">
            <div className="flex items-center">
              <img
                src="/logo.png"
                alt="NANTER"
                className="h-12 w-auto object-contain"
                style={{ filter: "drop-shadow(0 2px 8px rgba(0,0,0,0.55))" }}
                draggable={false}
              />
            </div>
            <div className="flex items-center gap-3">
              <div
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full font-bold text-sm"
                style={{
                  background: "linear-gradient(135deg, #14532d 0%, #166534 100%)",
                  boxShadow:
                    "inset 0 1px 0 rgba(255,255,255,0.15), 0 4px 12px rgba(34,197,94,0.25)",
                  color: "#bbf7d0",
                }}
              >
                <WalletIcon className="w-3.5 h-3.5" />
                <span>{balance.toLocaleString()} Kz</span>
              </div>
              <button
                onClick={toggleMute}
                className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-full hover:bg-white/5"
                aria-label={muted ? "Activar som" : "Silenciar"}
                title={muted ? "Activar som" : "Silenciar"}
              >
                {muted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
              </button>
              <button
                onClick={signOut}
                className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-full hover:bg-white/5"
                aria-label="Sair"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="max-w-lg mx-auto px-4 py-6">
          {/* Welcome — text-shadow para legibilidade sobre a imagem */}
          <div className="mb-6" style={{ textShadow: "0 2px 8px rgba(0,0,0,0.85)" }}>
            <h1 className="text-2xl font-extrabold text-white tracking-tight">
              Olá, {displayName}! <span className="anim-float inline-block">👋</span>
            </h1>
            <p className="text-sm text-white/75 font-medium">Pronto para jogar?</p>
          </div>

          {view === "lobby" && (
            <Lobby
              balance={balance}
              onBalanceRefresh={loadBalance}
              onStartGame={(players, bet, mp) => {
                setGamePlayers(players);
                setGameBetAmount(bet);
                setMultiplayer(mp ?? null);
                setView("game");
              }}
            />
          )}

          {view === "wallet" && <Wallet />}

          {view === "profile" && <Profile />}
        </main>

        {/* Bottom nav — vidro escuro */}
        <nav
          className="fixed bottom-0 left-0 right-0 backdrop-blur-2xl border-t border-white/10"
          style={{
            background: "linear-gradient(180deg, rgba(11,8,23,0.55) 0%, rgba(11,8,23,0.92) 100%)",
            boxShadow: "0 -8px 24px rgba(0,0,0,0.45)",
          }}
        >
          <div className="max-w-lg mx-auto flex">
            {[
              { key: "lobby" as const, label: "Jogar", icon: Gamepad2 },
              { key: "wallet" as const, label: "Carteira", icon: WalletIcon },
              { key: "profile" as const, label: "Perfil", icon: User },
            ].map(({ key, label, icon: Icon }) => {
              const active = view === key;
              return (
                <button
                  key={key}
                  onClick={() => setView(key)}
                  className={`relative flex-1 flex flex-col items-center gap-1 py-3 transition-colors ${
                    active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="bottom-nav-indicator"
                      className="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-12 rounded-full"
                      style={{
                        background: "var(--grad-roll-btn)",
                        boxShadow: "0 0 12px rgba(251,191,36,0.6)",
                      }}
                      transition={{ type: "spring", stiffness: 380, damping: 30 }}
                    />
                  )}
                  <Icon className="w-5 h-5" />
                  <span className="text-xs font-semibold">{label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      </div>
    </>
  );
}
