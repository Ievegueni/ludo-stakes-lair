import { useState, useEffect } from 'react';
import { api, type Transaction } from '@/lib/api';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  Wallet as WalletIcon,
  Plus,
  ArrowDownLeft,
  ArrowUpRight,
  Gift,
  History,
} from 'lucide-react';

export function Wallet() {
  const { user } = useAuth();
  const [balance, setBalance] = useState(0);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    if (!user) return;
    refresh();
  }, [user]);

  const refresh = async () => {
    try {
      const [bal, txs] = await Promise.all([
        api.wallet.get(),
        api.wallet.transactions(20),
      ]);
      setBalance(bal);
      setTransactions(txs);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeposit = async (amount: number) => {
    try {
      const r = await api.wallet.createTransaction({
        type: 'deposit',
        amount,
        description: `Depósito simulado de ${amount.toLocaleString()} Kz`,
      });
      setBalance(r.balance);
      toast.success(`+${amount.toLocaleString()} Kz`);
      refresh();
    } catch (err: any) {
      toast.error(err?.message || 'Erro');
    }
  };

  const typeIcon = (type: string) => {
    switch (type) {
      case 'deposit':
      case 'win':
      case 'refund':
        return <ArrowDownLeft className="w-4 h-4 text-primary" />;
      case 'bet':
      case 'withdraw':
        return <ArrowUpRight className="w-4 h-4 text-destructive" />;
      case 'gift':
        return <Gift className="w-4 h-4 text-amber-500" />;
      default:
        return <History className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const typeLabel = (type: string) => {
    switch (type) {
      case 'deposit': return 'Depósito';
      case 'withdraw': return 'Saque';
      case 'bet': return 'Aposta';
      case 'win': return 'Ganho';
      case 'refund': return 'Reembolso';
      case 'gift': return 'Gift';
      default: return type;
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-br from-primary/20 to-primary/5 rounded-2xl p-6 border border-primary/20">
        <div className="flex items-center gap-2 text-primary mb-2">
          <WalletIcon className="w-5 h-5" />
          <span className="text-sm font-medium">Saldo</span>
        </div>
        <p className="text-3xl font-bold text-foreground">
          {balance.toLocaleString()} <span className="text-lg text-muted-foreground">Kz</span>
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">Adicionar Saldo (Simulado)</p>
        <div className="grid grid-cols-2 gap-2">
          {[1000, 5000, 10000, 50000].map((amount) => (
            <Button
              key={amount}
              variant="outline"
              onClick={() => handleDeposit(amount)}
              className="gap-2"
            >
              <Plus className="w-4 h-4" />
              {amount.toLocaleString()} Kz
            </Button>
          ))}
        </div>
      </div>

      <div>
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors mb-2"
        >
          <History className="w-4 h-4" />
          Histórico de Transações
        </button>

        {showHistory && (
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {transactions.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Nenhuma transação ainda
              </p>
            ) : (
              transactions.map((tx) => (
                <div key={tx.id} className="flex items-center gap-3 bg-secondary/50 rounded-lg p-3">
                  {typeIcon(tx.type)}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{typeLabel(tx.type)}</p>
                    <p className="text-xs text-muted-foreground truncate">{tx.description}</p>
                  </div>
                  <span className={`text-sm font-semibold ${
                    ['deposit', 'win', 'refund'].includes(tx.type) ? 'text-primary' : 'text-destructive'
                  }`}>
                    {['deposit', 'win', 'refund'].includes(tx.type) ? '+' : '-'}
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
