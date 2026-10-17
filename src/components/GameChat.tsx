import { useState, useRef, useEffect } from "react";
import { MessageCircle, Send, Smile, Gift, X, Wallet as WalletIcon } from "lucide-react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { playSound } from "@/utils/sound";
import { notify } from "@/utils/notifications";
import type { Player, PlayerColor } from "@/lib/ludo-engine";

const COLORS: Record<PlayerColor, string> = {
  red: "#ef4444",
  blue: "#3b82f6",
  green: "#22c55e",
  yellow: "#eab308",
};

// Os emojis rápidos estão na barra "EMOJI" do LudoBoard (botão dedicado).

const EMOJI_PICKER = [
  "😀",
  "😂",
  "🤣",
  "😎",
  "😍",
  "🥳",
  "😜",
  "🤪",
  "😏",
  "😒",
  "😭",
  "😱",
  "🥶",
  "🤯",
  "🤔",
  "🤨",
  "😡",
  "🤬",
  "🤡",
  "💀",
  "👻",
  "👽",
  "🤖",
  "🎲",
  "🎯",
  "🏆",
  "🥇",
  "🥈",
  "🥉",
  "🔥",
  "💥",
  "⭐",
  "👍",
  "👎",
  "👏",
  "🙌",
  "🤝",
  "💪",
  "🫡",
  "🤞",
  "✌️",
  "🤟",
  "🫶",
  "👑",
  "💎",
  "💰",
  "💸",
  "🚀",
];

interface GiftItem {
  id: string;
  emoji: string;
  name: string;
  price: number;
}

const GIFT_CATALOG: GiftItem[] = [
  { id: "rose", emoji: "🌹", name: "Rosa", price: 50 },
  { id: "choco", emoji: "🍫", name: "Chocolate", price: 100 },
  { id: "beer", emoji: "🍻", name: "Cerveja", price: 200 },
  { id: "cake", emoji: "🎂", name: "Bolo", price: 500 },
  { id: "fire", emoji: "🔥", name: "Em Chamas", price: 750 },
  { id: "diamond", emoji: "💎", name: "Diamante", price: 1000 },
  { id: "car", emoji: "🚗", name: "Carro", price: 2000 },
  { id: "rocket", emoji: "🚀", name: "Foguete", price: 5000 },
  { id: "crown", emoji: "👑", name: "Coroa", price: 10000 },
];

const BOT_REACTIONS = [
  "😎 Vamos lá!",
  "🎲 Sorte minha!",
  "🔥 Estou em chamas!",
  "😂 Boa jogada!",
  "👀 Cuidado...",
  "💪 Não desistas!",
  "🤖 Calculando...",
  "🏆 Vou ganhar!",
  "😱 Não!",
  "👏 Bem jogado!",
];

interface ChatMessage {
  id: string;
  authorId: string;
  authorName: string;
  color: PlayerColor;
  text: string;
  timestamp: number;
  gift?: { emoji: string; name: string; price: number; toName: string; toColor: PlayerColor };
}

interface GameChatProps {
  players: Player[];
  currentUserId: string;
  balance: number;
  onBalanceChange: (newBalance: number) => void;
  gameId?: string;
}

export function GameChat({
  players,
  currentUserId,
  balance,
  onBalanceChange,
  gameId,
}: GameChatProps) {
  const isSync = !!gameId;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [showEmojis, setShowEmojis] = useState(false);
  const [showGifts, setShowGifts] = useState(false);
  const [selectedGift, setSelectedGift] = useState<GiftItem | null>(null);
  const [selectedRecipient, setSelectedRecipient] = useState<string | null>(null);
  const [sendingGift, setSendingGift] = useState(false);
  const [floatingGift, setFloatingGift] = useState<{ emoji: string; key: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastBotReplyRef = useRef<number>(0);

  const me = players.find((p) => p.id === currentUserId) || players[0];

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Permite que o LudoBoard envie um emoji rápido sem precisar de abrir
  // o input do chat. Disparado pelo botão EMOJI da barra.
  // O ref garante que o listener (registado uma só vez) chama sempre a
  // versão mais recente de sendMessage, sem re-registos nem closures velhas.
  const sendMessageRef = useRef<(text: string) => Promise<void>>(async () => {});
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (typeof detail === "string" && detail.length > 0) {
        void sendMessageRef.current(detail);
      }
    };
    window.addEventListener("nanter-quick-emoji", handler);
    return () => window.removeEventListener("nanter-quick-emoji", handler);
  }, []);

  // Sync mode: load history + subscribe realtime
  useEffect(() => {
    if (!isSync || !gameId) return;
    let cancelled = false;

    const mapRow = (r: any): ChatMessage => ({
      id: r.id,
      authorId: r.user_id ?? "",
      authorName: r.author_name,
      color: r.color as PlayerColor,
      text: r.text ?? "",
      timestamp: new Date(r.created_at).getTime(),
      gift: r.gift_emoji
        ? {
            emoji: r.gift_emoji,
            name: r.gift_name,
            price: Number(r.gift_price),
            toName: r.gift_to_name,
            toColor: r.gift_to_color as PlayerColor,
          }
        : undefined,
    });

    api.chat
      .list(gameId)
      .then((rows) => {
        if (cancelled) return;
        setMessages(rows.map(mapRow));
      })
      .catch(() => {});

    const off = api.realtime.subscribe((ev) => {
      if (ev.table !== "chat_messages") return;
      if (ev.event !== "INSERT") return;
      if ((ev.row as any).game_id !== gameId) return;
      const msg = mapRow(ev.row);
      setMessages((prev) => {
        if (prev.find((m) => m.id === msg.id)) return prev;
        if (msg.authorId !== currentUserId) {
          playSound(msg.gift ? "gift-received" : "chat-message");
          // Notificar (apenas em background)
          if (msg.gift) {
            notify(`🎁 ${msg.authorName} enviou-te um gift`, {
              body: `${msg.gift.emoji} ${msg.gift.name}`,
              tag: "nanter-chat",
            });
          } else {
            notify(`💬 ${msg.authorName}`, {
              body: msg.text || "...",
              tag: "nanter-chat",
            });
          }
        }
        return [...prev, msg];
      });
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [isSync, gameId, currentUserId]);

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !me) return;

    if (isSync && gameId) {
      setInput("");
      setShowEmojis(false);
      try {
        await api.chat.send(gameId, trimmed);
      } catch (err: any) {
        toast.error(err?.message || "Erro ao enviar");
      }
      return;
    }

    // Local mode (single player)
    const msg: ChatMessage = {
      id: `${Date.now()}-${Math.random()}`,
      authorId: me.id,
      authorName: me.name,
      color: me.color,
      text: trimmed,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, msg]);
    setInput("");
    setShowEmojis(false);

    const bots = players.filter((p) => p.isBot);
    if (bots.length > 0 && Date.now() - lastBotReplyRef.current > 2000) {
      lastBotReplyRef.current = Date.now();
      const bot = bots[Math.floor(Math.random() * bots.length)];
      const delay = 800 + Math.random() * 1800;
      setTimeout(() => {
        const reply = BOT_REACTIONS[Math.floor(Math.random() * BOT_REACTIONS.length)];
        setMessages((prev) => [
          ...prev,
          {
            id: `${Date.now()}-${Math.random()}`,
            authorId: bot.id,
            authorName: bot.name,
            color: bot.color,
            text: reply,
            timestamp: Date.now(),
          },
        ]);
      }, delay);
    }
  };

  sendMessageRef.current = sendMessage;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const sendGift = async () => {
    if (!selectedGift || !selectedRecipient || !me || sendingGift || !gameId) return;
    if (balance < selectedGift.price) {
      toast.error("Saldo insuficiente!");
      return;
    }
    const recipient = players.find((p) => p.id === selectedRecipient);
    if (!recipient) return;

    setSendingGift(true);
    try {
      const r = await api.chat.gift(gameId, selectedGift.id, recipient.id);
      onBalanceChange(r.balance);

      setFloatingGift({ emoji: selectedGift.emoji, key: Date.now() });
      setTimeout(() => setFloatingGift(null), 2500);

      toast.success(`Enviaste ${selectedGift.emoji} para ${recipient.name}`);
      setSelectedGift(null);
      setSelectedRecipient(null);
      setShowGifts(false);
    } catch {
      toast.error("Erro ao enviar gift");
    } finally {
      setSendingGift(false);
    }
  };

  // Gifts só para humanos num jogo sincronizado — o servidor credita o destinatário.
  const others = isSync ? players.filter((p) => p.id !== currentUserId && !p.isBot) : [];

  return (
    <div className="w-full bg-card border border-border rounded-xl shadow-lg flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-secondary/50">
        <MessageCircle className="w-4 h-4 text-primary" />
        <span className="font-semibold text-sm text-foreground">Chat do jogo</span>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="h-36 overflow-y-auto p-2 space-y-1.5">
        {messages.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground py-8">
            Sem mensagens ainda. Manda algo! 🎲
          </div>
        ) : (
          messages.map((m) => {
            const isMe = m.authorId === currentUserId;
            return (
              <div key={m.id} className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: COLORS[m.color] }}
                  />
                  <span className="text-[10px] font-medium text-muted-foreground">
                    {m.authorName}
                  </span>
                </div>
                {m.gift ? (
                  <div className="max-w-[85%] flex items-center gap-2 px-3 py-2 rounded-2xl bg-gradient-to-br from-amber-500/20 via-pink-500/20 to-purple-500/20 border border-amber-400/40">
                    <span className="text-3xl drop-shadow-[0_0_8px_rgba(255,200,80,0.6)] animate-pulse">
                      {m.gift.emoji}
                    </span>
                    <div className="text-xs">
                      <p className="font-semibold text-foreground">
                        {m.authorName} →{" "}
                        <span style={{ color: COLORS[m.gift.toColor] }}>{m.gift.toName}</span>
                      </p>
                      <p className="text-muted-foreground">
                        {m.gift.name} · {m.gift.price.toLocaleString()} Kz
                      </p>
                    </div>
                  </div>
                ) : (
                  <div
                    className={`max-w-[80%] px-3 py-1.5 rounded-2xl text-sm break-words ${
                      isMe
                        ? "bg-primary text-primary-foreground rounded-br-sm"
                        : "bg-secondary text-foreground rounded-bl-sm"
                    }`}
                  >
                    {m.text}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Quick emojis bar removida — usar o botão EMOJI da barra principal. */}

      {/* Emoji picker */}
      {showEmojis && (
        <div className="px-2 py-2 border-t border-border max-h-40 overflow-y-auto">
          <div className="grid grid-cols-8 gap-1">
            {EMOJI_PICKER.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => {
                  setInput((prev) => prev + e);
                  setShowEmojis(false);
                }}
                className="text-xl hover:bg-secondary rounded p-1 transition-colors"
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSubmit} className="flex items-center gap-1 p-2 border-t border-border">
        {others.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setShowGifts(true);
              setSelectedGift(null);
              setSelectedRecipient(others.length === 1 ? others[0].id : null);
            }}
            className="p-2 rounded-lg text-amber-500 hover:bg-amber-500/10 transition-colors"
            aria-label="Enviar gift"
          >
            <Gift className="w-5 h-5" />
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowEmojis((s) => !s)}
          className={`p-2 rounded-lg transition-colors ${
            showEmojis
              ? "bg-primary/20 text-primary"
              : "text-muted-foreground hover:text-foreground"
          }`}
          aria-label="Abrir emojis"
        >
          <Smile className="w-5 h-5" />
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Escreve uma mensagem..."
          maxLength={200}
          className="flex-1 bg-secondary rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <button
          type="submit"
          disabled={!input.trim()}
          className="p-2 rounded-lg bg-primary text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
          aria-label="Enviar"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>

      {/* Floating gift animation */}
      {floatingGift && (
        <div
          key={floatingGift.key}
          className="fixed inset-0 z-50 pointer-events-none flex items-center justify-center"
        >
          <span
            className="text-9xl drop-shadow-[0_0_30px_rgba(255,200,80,0.8)]"
            style={{ animation: "gift-fly 2.5s ease-out forwards" }}
          >
            {floatingGift.emoji}
          </span>
          <style>{`
            @keyframes gift-fly {
              0% { transform: scale(0.3) translateY(40vh); opacity: 0; }
              25% { transform: scale(1.4) translateY(0); opacity: 1; }
              60% { transform: scale(1.1) translateY(0) rotate(0deg); opacity: 1; }
              100% { transform: scale(0.5) translateY(-30vh) rotate(20deg); opacity: 0; }
            }
          `}</style>
        </div>
      )}

      {/* Gift shop modal */}
      {showGifts && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full sm:max-w-md bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[85vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <Gift className="w-5 h-5 text-amber-500" />
                <h3 className="font-bold text-foreground">Enviar Gift</h3>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1 text-xs text-primary bg-primary/10 px-2 py-1 rounded-full">
                  <WalletIcon className="w-3 h-3" />
                  <span className="font-bold">{balance.toLocaleString()} Kz</span>
                </div>
                <button
                  onClick={() => setShowGifts(false)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Recipient picker */}
            {others.length > 1 && (
              <div className="px-4 py-3 border-b border-border">
                <p className="text-xs font-medium text-muted-foreground mb-2">Para quem?</p>
                <div className="flex flex-wrap gap-2">
                  {others.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setSelectedRecipient(p.id)}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                        selectedRecipient === p.id
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border bg-secondary text-muted-foreground"
                      }`}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: COLORS[p.color] }}
                      />
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Gift grid */}
            <div className="flex-1 overflow-y-auto p-3 grid grid-cols-3 gap-2">
              {GIFT_CATALOG.map((g) => {
                const affordable = balance >= g.price;
                const selected = selectedGift?.id === g.id;
                return (
                  <button
                    key={g.id}
                    onClick={() => affordable && setSelectedGift(g)}
                    disabled={!affordable}
                    className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all ${
                      selected
                        ? "border-amber-400 bg-amber-400/10 scale-105"
                        : affordable
                          ? "border-border bg-secondary/50 hover:border-amber-400/50"
                          : "border-border bg-secondary/20 opacity-40 cursor-not-allowed"
                    }`}
                  >
                    <span className="text-3xl">{g.emoji}</span>
                    <span className="text-[10px] font-medium text-foreground">{g.name}</span>
                    <span className="text-[10px] font-bold text-primary">
                      {g.price.toLocaleString()} Kz
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Confirm */}
            <div className="p-3 border-t border-border">
              <button
                onClick={sendGift}
                disabled={
                  !selectedGift ||
                  !selectedRecipient ||
                  sendingGift ||
                  balance < (selectedGift?.price ?? 0)
                }
                className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 to-pink-500 text-white font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
              >
                {!selectedGift
                  ? "Escolhe um gift"
                  : !selectedRecipient
                    ? "Escolhe o destinatário"
                    : sendingGift
                      ? "A enviar..."
                      : `Enviar ${selectedGift.emoji} · ${selectedGift.price.toLocaleString()} Kz`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
