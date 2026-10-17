import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Gift, Medal, ShoppingBag, Target } from "lucide-react";
import { api, type Mission, type RankEntry, type ShopItem } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { playSound } from "@/utils/sound";

const glass: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)",
  backdropFilter: "blur(16px)",
  WebkitBackdropFilter: "blur(16px)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08), 0 10px 30px rgba(0,0,0,0.35)",
};

const goldBtn: React.CSSProperties = {
  background: "var(--grad-roll-btn)",
  boxShadow: "0 4px 14px rgba(245,158,11,0.35), inset 0 1px 0 rgba(255,255,255,0.45)",
};

function timeLeft(iso?: string) {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "a terminar";
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
}

export function Challenges({ onWalletChange }: { onWalletChange?: () => void }) {
  const { user } = useAuth();
  const [tab, setTab] = useState<"missions" | "ranking" | "shop">("missions");
  const [missions, setMissions] = useState<Mission[]>([]);
  const [board, setBoard] = useState<Awaited<ReturnType<typeof api.rewards.leaderboard>> | null>(
    null,
  );
  const [shop, setShop] = useState<Awaited<ReturnType<typeof api.rewards.shop>> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [m, b, s] = await Promise.allSettled([
      api.rewards.missions(),
      api.rewards.leaderboard(),
      api.rewards.shop(),
    ]);
    if (m.status === "fulfilled") setMissions(m.value);
    if (b.status === "fulfilled") setBoard(b.value);
    if (s.status === "fulfilled") setShop(s.value);
  }, []);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
      playSound("gift-received");
      onWalletChange?.();
      await load();
    } catch (err) {
      toast.error(
        (err as Error)?.message?.includes("insufficient")
          ? "Saldo insuficiente"
          : "Erro, tenta de novo",
      );
    } finally {
      setBusy(null);
    }
  };

  const tabs = [
    { key: "missions" as const, label: "Missões", icon: Target },
    { key: "ranking" as const, label: "Ranking", icon: Medal },
    { key: "shop" as const, label: "Loja", icon: ShoppingBag },
  ];

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-2xl p-1 border border-white/10" style={glass}>
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-bold transition-all ${
              tab === key ? "text-foreground bg-white/10" : "text-muted-foreground"
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === "missions" && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Renovam todos os dias à meia-noite. Só contam partidas a dinheiro. O prémio é saldo
            bónus: serve para apostar e para a loja, mas não pode ser levantado.
          </p>
          {missions.map((m) => {
            const done = m.progress >= m.goal;
            return (
              <div
                key={m.id}
                className="rounded-2xl p-4 border border-white/10 flex items-center gap-3"
                style={glass}
              >
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-foreground text-sm">{m.label}</p>
                  <div className="mt-2 h-2 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${(m.progress / m.goal) * 100}%`,
                        background: "var(--grad-pot)",
                      }}
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {m.progress}/{m.goal} · prémio {m.reward.toLocaleString()} Kz bónus
                  </p>
                </div>
                {m.claimed ? (
                  <span className="text-xs font-extrabold text-emerald-400">✓ Recebido</span>
                ) : (
                  <button
                    disabled={!done || busy === m.id}
                    onClick={() =>
                      run(
                        m.id,
                        () => api.rewards.claim(m.id),
                        `+${m.reward.toLocaleString()} Kz de bónus!`,
                      )
                    }
                    className="px-3 py-2 rounded-xl text-xs font-extrabold text-amber-950 disabled:opacity-40 flex items-center gap-1"
                    style={goldBtn}
                  >
                    <Gift className="w-3.5 h-3.5" />
                    Receber
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {tab === "ranking" && board && (
        <div className="space-y-2">
          <div className="rounded-2xl p-4 border border-amber-500/25" style={glass}>
            <p className="text-sm font-extrabold text-foreground">Torneio semanal</p>
            <p className="text-xs text-muted-foreground mt-1">
              Mais vitórias a dinheiro até domingo. Prémios em bónus: 🥇{" "}
              {board.prizes[0]?.toLocaleString()} · 🥈 {board.prizes[1]?.toLocaleString()} · 🥉{" "}
              {board.prizes[2]?.toLocaleString()} Kz. Termina em {timeLeft(board.endsAt)}.
            </p>
            {board.me && (
              <p className="text-xs font-bold text-amber-200 mt-2">
                Estás em {board.me.rank}º com {board.me.wins}{" "}
                {board.me.wins === 1 ? "vitória" : "vitórias"}
              </p>
            )}
          </div>
          {board.top.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Ainda ninguém ganhou esta semana. Sê o primeiro!
            </p>
          ) : (
            board.top.map((r: RankEntry) => (
              <div
                key={r.userId}
                className={`rounded-xl p-3 border flex items-center gap-3 ${
                  r.userId === user?.id ? "border-amber-400/50" : "border-white/10"
                }`}
                style={glass}
              >
                <span className="w-7 text-center font-extrabold text-foreground">
                  {r.rank <= 3 ? ["🥇", "🥈", "🥉"][r.rank - 1] : r.rank}
                </span>
                <PlayerAvatar name={r.name} size={32} frame={r.frame} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-foreground truncate">{r.name}</p>
                  <p className="text-[10px] text-muted-foreground font-bold uppercase">
                    Nv. {r.level}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-extrabold text-foreground">{r.wins} V</p>
                  <p className="text-[10px] text-emerald-400 font-bold">
                    +{r.won.toLocaleString()} Kz
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === "shop" && shop && (
        <div className="space-y-3">
          <div
            className="rounded-2xl p-4 border border-white/10 flex items-center gap-3"
            style={glass}
          >
            <PlayerAvatar name="Tu" size={44} frame={shop.equipped} />
            <div className="flex-1">
              <p className="text-sm font-bold text-foreground">Nível {shop.level}</p>
              <p className="text-[11px] text-muted-foreground">
                {shop.xp} XP · bónus {shop.bonus.toLocaleString()} Kz · saldo{" "}
                {shop.balance.toLocaleString()} Kz
              </p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            As molduras aparecem a todos os jogadores. Paga-se primeiro com bónus e o resto com
            saldo.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {shop.items.map((it: ShopItem) => {
              const equipped = shop.equipped === it.id;
              return (
                <div
                  key={it.id}
                  className="rounded-2xl p-3 border border-white/10 flex flex-col items-center gap-2 text-center"
                  style={glass}
                >
                  <PlayerAvatar name={it.name} size={48} frame={it.id} />
                  <p className="text-sm font-bold text-foreground">{it.name}</p>
                  {it.owned ? (
                    <button
                      disabled={busy === it.id}
                      onClick={() =>
                        run(
                          it.id,
                          () => api.rewards.equip(equipped ? null : it.id),
                          equipped ? "Moldura retirada" : "Moldura equipada",
                        )
                      }
                      className="w-full py-1.5 rounded-lg text-xs font-extrabold text-white bg-white/10 border border-white/15"
                    >
                      {equipped ? "Retirar" : "Equipar"}
                    </button>
                  ) : (
                    <button
                      disabled={busy === it.id}
                      onClick={() =>
                        run(it.id, () => api.rewards.buy(it.id), `${it.name} comprada!`)
                      }
                      className="w-full py-1.5 rounded-lg text-xs font-extrabold text-amber-950"
                      style={goldBtn}
                    >
                      {it.price.toLocaleString()} Kz
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
