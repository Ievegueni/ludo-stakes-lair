import { useState, useEffect, useRef } from 'react';
import { api, type Transaction } from '@/lib/api';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import {
  Camera,
  Check,
  History,
  ArrowDownLeft,
  ArrowUpRight,
  Gift,
  User,
  Loader2,
} from 'lucide-react';

const MAX_AVATAR_BYTES = 400_000;

export function Profile() {
  const { user } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [originalName, setOriginalName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [savingName, setSavingName] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) return;
    load();
  }, [user]);

  const load = async () => {
    try {
      const [profile, txs] = await Promise.all([
        api.profiles.me(),
        api.wallet.transactions(50),
      ]);
      setDisplayName(profile.display_name);
      setOriginalName(profile.display_name);
      setAvatarUrl(profile.avatar_url);
      setPhone(profile.phone);
      setTransactions(txs);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveName = async () => {
    const trimmed = displayName.trim();
    if (!trimmed) {
      toast.error('Nome não pode ficar vazio');
      return;
    }
    if (trimmed.length > 24) {
      toast.error('Nome muito longo (máx. 24)');
      return;
    }
    setSavingName(true);
    try {
      await api.profiles.update({ display_name: trimmed });
      setOriginalName(trimmed);
      toast.success('Nome actualizado');
    } catch {
      toast.error('Erro ao guardar');
    } finally {
      setSavingName(false);
    }
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Ficheiro inválido');
      return;
    }
    setUploadingAvatar(true);

    const reader = new FileReader();
    reader.onload = async () => {
      const img = new Image();
      img.onload = async () => {
        const canvas = document.createElement('canvas');
        const size = 256;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          setUploadingAvatar(false);
          return;
        }
        const ratio = Math.max(size / img.width, size / img.height);
        const w = img.width * ratio;
        const h = img.height * ratio;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        let quality = 0.85;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        while (dataUrl.length > MAX_AVATAR_BYTES && quality > 0.3) {
          quality -= 0.1;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }
        try {
          await api.profiles.update({ avatar_url: dataUrl });
          setAvatarUrl(dataUrl);
          toast.success('Foto actualizada');
        } catch {
          toast.error('Erro ao guardar imagem');
        } finally {
          setUploadingAvatar(false);
        }
      };
      img.onerror = () => {
        setUploadingAvatar(false);
        toast.error('Imagem inválida');
      };
      img.src = reader.result as string;
    };
    reader.onerror = () => {
      setUploadingAvatar(false);
      toast.error('Erro a ler ficheiro');
    };
    reader.readAsDataURL(file);
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
      case 'gift': return 'Gift enviado';
      default: return type;
    }
  };

  const isCredit = (type: string) => ['deposit', 'win', 'refund'].includes(type);

  return (
    <div className="space-y-5">
      <div className="bg-card rounded-2xl border border-border p-5">
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingAvatar}
            className="relative group"
          >
            <div className="w-24 h-24 rounded-full overflow-hidden border-2 border-primary bg-secondary flex items-center justify-center">
              {avatarUrl ? (
                <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                <User className="w-10 h-10 text-muted-foreground" />
              )}
            </div>
            <div className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              {uploadingAvatar ? (
                <Loader2 className="w-6 h-6 text-white animate-spin" />
              ) : (
                <Camera className="w-6 h-6 text-white" />
              )}
            </div>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleAvatarChange}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingAvatar}
            className="text-xs text-primary hover:underline"
          >
            Alterar foto
          </button>

          {phone && (
            <p className="text-xs text-muted-foreground">{phone}</p>
          )}
        </div>

        <div className="mt-5 space-y-2">
          <label className="text-sm font-medium text-foreground">Nome de jogador</label>
          <div className="flex gap-2">
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={24}
              placeholder="O teu nome"
            />
            <Button
              onClick={handleSaveName}
              disabled={savingName || displayName.trim() === originalName || !displayName.trim()}
              size="icon"
            >
              {savingName ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>
      </div>

      <div className="bg-card rounded-2xl border border-border p-5">
        <div className="flex items-center gap-2 mb-3">
          <History className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Histórico da Carteira</h3>
        </div>
        {transactions.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            Sem movimentos ainda
          </p>
        ) : (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {transactions.map((tx) => (
              <div key={tx.id} className="flex items-center gap-3 bg-secondary/40 rounded-lg p-3">
                {typeIcon(tx.type)}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{typeLabel(tx.type)}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {tx.description || new Date(tx.created_at).toLocaleString('pt-PT')}
                  </p>
                </div>
                <span
                  className={`text-sm font-semibold ${
                    isCredit(tx.type) ? 'text-primary' : 'text-destructive'
                  }`}
                >
                  {isCredit(tx.type) ? '+' : '-'}
                  {tx.amount.toLocaleString()} Kz
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
