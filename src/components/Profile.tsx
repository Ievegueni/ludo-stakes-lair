import { useState, useEffect, useRef } from "react";
import { api, type Transaction } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Camera,
  Check,
  History,
  ArrowDownLeft,
  ArrowUpRight,
  Gift,
  User,
  Loader2,
} from "lucide-react";

const MAX_AVATAR_BYTES = 400_000;

export function Profile() {
  const { user } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [originalName, setOriginalName] = useState("");
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
      const [profile, txs] = await Promise.all([api.profiles.me(), api.wallet.transactions(50)]);
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
      toast.error("Nome não pode ficar vazio");
      return;
    }
    if (trimmed.length > 24) {
      toast.error("Nome muito longo (máx. 24)");
      return;
    }
    setSavingName(true);
    try {
      await api.profiles.update({ display_name: trimmed });
      setOriginalName(trimmed);
      toast.success("Nome actualizado");
    } catch {
      toast.error("Erro ao guardar");
    } finally {
      setSavingName(false);
    }
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Ficheiro inválido");
      return;
    }
    setUploadingAvatar(true);

    const reader = new FileReader();
    reader.onload = async () => {
      const img = new Image();
      img.onload = async () => {
        const canvas = document.createElement("canvas");
        const size = 256;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          setUploadingAvatar(false);
          return;
        }
        const ratio = Math.max(size / img.width, size / img.height);
        const w = img.width * ratio;
        const h = img.height * ratio;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        let quality = 0.85;
        let dataUrl = canvas.toDataURL("image/jpeg", quality);
        while (dataUrl.length > MAX_AVATAR_BYTES && quality > 0.3) {
          quality -= 0.1;
          dataUrl = canvas.toDataURL("image/jpeg", quality);
        }
        try {
          await api.profiles.update({ avatar_url: dataUrl });
          setAvatarUrl(dataUrl);
          toast.success("Foto actualizada");
        } catch {
          toast.error("Erro ao guardar imagem");
        } finally {
          setUploadingAvatar(false);
        }
      };
      img.onerror = () => {
        setUploadingAvatar(false);
        toast.error("Imagem inválida");
      };
      img.src = reader.result as string;
    };
    reader.onerror = () => {
      setUploadingAvatar(false);
      toast.error("Erro a ler ficheiro");
    };
    reader.readAsDataURL(file);
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
        return "Gift enviado";
      default:
        return type;
    }
  };

  const isCredit = (type: string) => ["deposit", "win", "refund"].includes(type);

  const glass: React.CSSProperties = {
    background: "rgba(255,255,255,0.05)",
    backdropFilter: "blur(16px)",
    WebkitBackdropFilter: "blur(16px)",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08), 0 10px 30px rgba(0,0,0,0.35)",
  };

  return (
    <div className="space-y-4">
      {/* Card Avatar + Nome */}
      <div className="rounded-2xl border border-white/10 p-5" style={glass}>
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingAvatar}
            className="relative group"
          >
            <div
              className="w-24 h-24 rounded-full overflow-hidden flex items-center justify-center"
              style={{
                background: avatarUrl
                  ? "#0b0817"
                  : "linear-gradient(135deg, rgba(124,58,237,0.55), rgba(59,130,246,0.45))",
                boxShadow:
                  "0 0 0 3px rgba(251,191,36,0.55), 0 0 0 6px rgba(251,191,36,0.18), 0 8px 24px rgba(124,58,237,0.45)",
              }}
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                <User className="w-10 h-10 text-white/85" />
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
            className="text-xs font-bold uppercase tracking-wider text-amber-300 hover:text-amber-200 transition-colors"
          >
            Alterar foto
          </button>

          {phone && <p className="text-xs text-muted-foreground font-mono">{phone}</p>}
        </div>

        <div className="mt-5 space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Nome de jogador
          </label>
          <div className="flex gap-2">
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={24}
              placeholder="O teu nome"
              className="bg-white/5 border-white/15 backdrop-blur"
            />
            <button
              onClick={handleSaveName}
              disabled={savingName || displayName.trim() === originalName || !displayName.trim()}
              className="rounded-xl px-3 transition-transform flex items-center justify-center text-emerald-950 font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:scale-[1.04] active:scale-95"
              style={{
                background: "linear-gradient(180deg, #4ade80, #16a34a)",
                boxShadow: "0 4px 12px rgba(34,197,94,0.45), inset 0 1px 0 rgba(255,255,255,0.4)",
                minWidth: "44px",
              }}
              aria-label="Guardar nome"
            >
              {savingName ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Card Histórico */}
      <div className="rounded-2xl border border-white/10 p-5" style={glass}>
        <div className="flex items-center gap-2 mb-3">
          <History className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">
            Histórico da Carteira
          </h3>
        </div>
        {transactions.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6 italic">
            Sem movimentos ainda
          </p>
        ) : (
          <div className="space-y-2 max-h-[55vh] overflow-y-auto">
            {transactions.map((tx) => (
              <div
                key={tx.id}
                className="flex items-center gap-3 rounded-lg p-3 border border-white/5"
                style={{ background: "rgba(255,255,255,0.04)" }}
              >
                {typeIcon(tx.type)}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-foreground">{typeLabel(tx.type)}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {tx.description || new Date(tx.created_at).toLocaleString("pt-PT")}
                  </p>
                </div>
                <span
                  className={`text-sm font-extrabold ${
                    isCredit(tx.type) ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  {isCredit(tx.type) ? "+" : "-"}
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
