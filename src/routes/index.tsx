import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { AuthPhone } from "@/components/AuthPhone";
import { LudoBoard } from "@/components/LudoBoard";
import { Lobby } from "@/components/Lobby";
import { Wallet } from "@/components/Wallet";
import { Profile } from "@/components/Profile";
import { api } from "@/lib/api";
import { createPlayer, type PlayerColor } from "@/lib/ludo-engine";
import { Toaster } from "sonner";
import { LogOut, Wallet as WalletIcon, Gamepad2, User } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "NANTER - Aposta e Joga" },
      { name: "description", content: "NANTER - Jogo de Ludo online com apostas em Kwanza. Joga com amigos ou bots e ganha dinheiro!" },
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
  const [view, setView] = useState<'lobby' | 'wallet' | 'game' | 'profile'>('lobby');
  const [gamePlayers, setGamePlayers] = useState<GamePlayer[] | null>(null);
  const [gameBetAmount, setGameBetAmount] = useState(0);
  const [multiplayer, setMultiplayer] = useState<MultiplayerInfo | null>(null);
  const [balance, setBalance] = useState(0);
  const [displayName, setDisplayName] = useState('Jogador');

  useEffect(() => {
    if (!user) return;
    loadProfile();
    loadBalance();
  }, [user, view]);

  const loadProfile = async () => {
    try {
      const profile = await api.profiles.me();
      setDisplayName(profile.display_name);
    } catch {}
  };

  const loadBalance = async () => {
    try {
      const bal = await api.wallet.get();
      setBalance(bal);
    } catch {}
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="text-5xl animate-bounce mb-4">🎲</div>
          <p className="text-muted-foreground">A carregar...</p>
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

  if (view === 'game' && gamePlayers) {
    const players = gamePlayers.map((p) =>
      createPlayer(p.id, p.name, p.color, p.isBot)
    );
    return (
      <>
        <Toaster position="top-center" richColors />
        <div className="min-h-screen bg-background p-4 overflow-hidden">
          <LudoBoard
            players={players}
            betAmount={gameBetAmount}
            balance={balance}
            onBalanceChange={setBalance}
            currentUserId={user!.id}
            multiplayer={multiplayer}
            onGameEnd={(winnerId) => {
              setTimeout(() => {
                setView('lobby');
                setGamePlayers(null);
                setMultiplayer(null);
                loadBalance();
              }, 3000);
            }}
          />
        </div>
      </>
    );
  }

  return (
    <>
      <Toaster position="top-center" richColors />
      <div className="min-h-screen bg-background">
        {/* Header */}
        <header className="sticky top-0 z-40 bg-card/80 backdrop-blur-lg border-b border-border">
          <div className="max-w-lg mx-auto flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-2xl">🎲</span>
              <span className="font-bold text-foreground">NANTER</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 bg-primary/10 text-primary px-3 py-1.5 rounded-full">
                <WalletIcon className="w-3.5 h-3.5" />
                <span className="text-sm font-bold">{balance.toLocaleString()} Kz</span>
              </div>
              <button onClick={signOut} className="text-muted-foreground hover:text-foreground transition-colors">
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="max-w-lg mx-auto px-4 py-6">
          {/* Welcome */}
          <div className="mb-6">
            <h1 className="text-xl font-bold text-foreground">Olá, {displayName}! 👋</h1>
            <p className="text-sm text-muted-foreground">Pronto para jogar?</p>
          </div>

          {view === 'lobby' && (
            <Lobby
              balance={balance}
              onStartGame={(players, bet, mp) => {
                setGamePlayers(players);
                setGameBetAmount(bet);
                setMultiplayer(mp ?? null);
                setView('game');
              }}
            />
          )}

          {view === 'wallet' && <Wallet />}

          {view === 'profile' && <Profile />}
        </main>

        {/* Bottom nav */}
        <nav className="fixed bottom-0 left-0 right-0 bg-card/80 backdrop-blur-lg border-t border-border">
          <div className="max-w-lg mx-auto flex">
            {[
              { key: 'lobby' as const, label: 'Jogar', icon: Gamepad2 },
              { key: 'wallet' as const, label: 'Carteira', icon: WalletIcon },
              { key: 'profile' as const, label: 'Perfil', icon: User },
            ].map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setView(key)}
                className={`flex-1 flex flex-col items-center gap-1 py-3 transition-colors ${
                  view === key ? 'text-primary' : 'text-muted-foreground'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-xs font-medium">{label}</span>
              </button>
            ))}
          </div>
        </nav>
      </div>
    </>
  );
}
