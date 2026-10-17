import { useState, useEffect } from "react";
import { api, type Transaction } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Wallet as WalletIcon,
  Plus,
  ArrowDownLeft,
  ArrowUpRight,
  Gift,
  History,
} from "lucide-react";

export function Wallet() {
  const { user } = useAuth();
  const [balance, setBalance] = useState(0);
  const [bonus, setBonus] = useState(0);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    if (!user) return;
    refresh();
  }, [user]);

  const refresh = async () => {
    try {
      const [w, txs] = await Promise.all([api.wallet.getFull(), api.wallet.transactions(20)]);
      setBalance(w.balance);
      setBonus(w.bonus);
      setTransactions(txs);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeposit = async (amount: number) => {
    try {
      const r = await api.wallet.createTransaction({
        type: "deposit",
        amount,
        description: `Depósito simulado de ${amount.toLocaleString()} Kz`,
      });
      setBalance(r.balance);
      toast.success(`+${amount.toLocaleString()} Kz`);
      refresh();
    } catch (err: any) {
      toast.error(err?.message || "Erro");
    }
  };

  const typeIcon = (type: string) => {
    switch (type) {
      case "deposit":
      case "win":
      case "refund":
        return <ArrowDownLeft className="w-4 h-4 text-primary" />;
      case "bet":
      case "withdraw":
        return <ArrowUpRight className="w-4 h-4 text-destructive" />;
      case "gift":
      case "gift_received":
      case "bonus":
        return <Gift className="w-4 h-4 text-amber-500" />;
      default:
        return <History className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const typeLabel = (type: string) => {
    switch (type) {
      case "deposit":
        return "Depósito";
      case "withdraw":
        return "Saque";
      case "bet":
        return "Aposta";
      case "win":
        return "Ganho";
      case "refund":
        return "Reembolso";
      case "gift":
        return "Gift";
      case "gift_received":
        return "Gift recebido";
      case "bonus":
        return "Bónus";
      case "purchase":
        return "Loja";
      default:
        return type;
    }
  };

  const glass: React.CSSProperties = {
    background: "rgba(255,255,255,0.05)",
    backdropFilter: "blur(16px)",
    WebkitBackdropFilter: "blur(16px)",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08), 0 10px 30px rgba(0,0,0,0.35)",
  };

  return (
    <div className="space-y-4">
      {/* Saldo card — gradient roxo+verde com brilho lateral */}
      <div
        className="relative overflow-hidden rounded-2xl p-6 border border-emerald-500/25"
        style={{
          background:
            "linear-gradient(135deg, rgba(20,83,45,0.45) 0%, rgba(124,58,237,0.20) 60%, rgba(34,197,94,0.10) 100%)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.12), 0 10px 30px rgba(34,197,94,0.18)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
        }}
      >
        {/* shine sweep */}
        <span
          aria-hidden
          className="absolute top-0 left-0 h-full w-1/3 pointer-events-none"
          style={{
            background: "linear-gradient(110deg, transparent, rgba(255,255,255,0.18), transparent)",
            animation: "nanter-coin-shine 5s ease-in-out infinite",
          }}
        />
        <div className="flex items-center gap-2 text-emerald-300 mb-2 relative z-10">
          <WalletIcon className="w-5 h-5" />
          <span className="text-xs font-extrabold uppercase tracking-wider">Saldo</span>
        </div>
        <p className="text-4xl font-extrabold text-white relative z-10 tracking-tight">
          {balance.toLocaleString()}{" "}
          <span className="text-lg text-emerald-200/70 font-bold">Kz</span>
        </p>
        {bonus > 0 && (
          <p className="relative z-10 mt-2 text-sm font-bold text-amber-200">
            + {bonus.toLocaleString()} Kz de bónus
            <span className="block text-[11px] font-medium text-white/60">
              Serve para apostar e para a loja. Não pode ser levantado.
            </span>
          </p>
        )}
      </div>

      {/* Botões de depósito glass */}
      <div className="space-y-2">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
          Adicionar Saldo (Simulado)
        </p>
        <div className="grid grid-cols-2 gap-2">
          {[1000, 5000, 10000, 50000].map((amount) => (
            <button
              key={amount}
              onClick={() => handleDeposit(amount)}
              className="rounded-xl px-3 py-3 text-sm font-bold text-white transition-transform flex items-center justify-center gap-2 hover:scale-[1.03] active:scale-95"
              style={{
                background: "linear-gradient(135deg, rgba(34,197,94,0.18), rgba(255,255,255,0.05))",
                border: "1px solid rgba(34,197,94,0.30)",
                backdropFilter: "blur(10px)",
                WebkitBackdropFilter: "blur(10px)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.10), 0 4px 12px rgba(0,0,0,0.25)",
              }}
            >
              <Plus className="w-4 h-4 text-emerald-300" />
              {amount.toLocaleString()} Kz
            </button>
          ))}
        </div>
      </div>

      {/* Histórico glass colapsável */}
      <div className="rounded-2xl p-4 border border-white/10" style={glass}>
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="flex items-center gap-2 text-sm font-bold text-muted-foreground hover:text-foreground transition-colors w-full uppercase tracking-wider"
        >
          <History className="w-4 h-4" />
          <span>Histórico de Transações</span>
          <span className="ml-auto text-xs">{showHistory ? "▾" : "▸"}</span>
        </button>

        {showHistory && (
          <div className="space-y-2 max-h-60 overflow-y-auto mt-3">
            {transactions.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Nenhuma transação ainda
              </p>
            ) : (
              transactions.map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center gap-3 rounded-lg p-3 border border-white/5"
                  style={{ background: "rgba(255,255,255,0.04)" }}
                >
                  {typeIcon(tx.type)}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-foreground">{typeLabel(tx.type)}</p>
                    <p className="text-xs text-muted-foreground truncate">{tx.description}</p>
                  </div>
                  <span
                    className={`text-sm font-extrabold ${
                      ["deposit", "win", "refund", "gift_received", "bonus"].includes(tx.type)
                        ? "text-emerald-400"
                        : "text-rose-400"
                    }`}
                  >
                    {["deposit", "win", "refund", "gift_received", "bonus"].includes(tx.type)
                      ? "+"
                      : "-"}
                    {tx.amount.toLocaleString()} Kz
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
