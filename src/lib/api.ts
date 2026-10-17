const TOKEN_KEY = "nanter.token";

export interface AuthUser {
  id: string;
  phone: string;
}

export interface Profile {
  id: string;
  phone: string | null;
  display_name: string;
  avatar_url: string | null;
  created_at?: string;
  equipped_frame?: string | null;
  level?: number;
}

export interface Transaction {
  id: string;
  type: string;
  amount: number;
  description: string | null;
  created_at: string;
}

export interface RoomPlayer {
  id: string;
  room_id: string;
  user_id: string | null;
  player_index: number;
  is_bot: boolean;
  bot_name: string | null;
  color: string;
  is_ready: boolean;
  bet_paid: boolean;
  level?: number | null;
  equipped_frame?: string | null;
}

export interface Mission {
  id: string;
  label: string;
  goal: number;
  reward: number;
  progress: number;
  claimed: boolean;
}

export interface RankEntry {
  userId: string;
  name: string;
  frame: string | null;
  level: number;
  wins: number;
  won: number;
  rank: number;
}

export interface ShopItem {
  id: string;
  name: string;
  price: number;
  owned: boolean;
}

export interface Room {
  id: string;
  code: string;
  host_id: string;
  bet_amount: number;
  max_players: number;
  status: "waiting" | "playing" | "finished";
  is_private: boolean;
  created_at: string;
  players: RoomPlayer[];
}

export interface GameRecord {
  id: string;
  room_id: string;
  host_id: string;
  state: any;
  version: number;
  created_at: string;
  updated_at: string;
}

const authListeners = new Set<(user: AuthUser | null) => void>();

export function getToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> | undefined),
  };
  if (options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(path, { ...options, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    (err as any).status = res.status;
    (err as any).data = data; // mantém o body completo para o caller poder ler campos extra
    throw err;
  }
  return data as T;
}

export const api = {
  auth: {
    async signUp(phone: string, password: string) {
      const r = await request<{ token: string; user: AuthUser }>("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({ phone, password }),
      });
      setToken(r.token);
      authListeners.forEach((l) => l(r.user));
      return r.user;
    },
    async signIn(phone: string, password: string) {
      const r = await request<{ token: string; user: AuthUser }>("/api/auth/signin", {
        method: "POST",
        body: JSON.stringify({ phone, password }),
      });
      setToken(r.token);
      authListeners.forEach((l) => l(r.user));
      return r.user;
    },
    async me(): Promise<AuthUser | null> {
      if (!getToken()) return null;
      try {
        const r = await request<{ user: AuthUser }>("/api/auth/me");
        return r.user;
      } catch (err: any) {
        if (err?.status === 401) {
          setToken(null);
          authListeners.forEach((l) => l(null));
        }
        return null;
      }
    },
    signOut() {
      // Invalida o token no servidor (best-effort — sai localmente na mesma)
      if (getToken())
        void request("/api/auth/logout", { method: "POST", body: "{}" }).catch(() => {});
      setToken(null);
      authListeners.forEach((l) => l(null));
    },
    onChange(cb: (user: AuthUser | null) => void) {
      authListeners.add(cb);
      return () => authListeners.delete(cb);
    },
  },

  profiles: {
    async me() {
      const r = await request<{ profile: Profile }>("/api/profiles/me");
      return r.profile;
    },
    async update(fields: Partial<Pick<Profile, "display_name" | "avatar_url">>) {
      const r = await request<{ profile: Profile }>("/api/profiles/me", {
        method: "PATCH",
        body: JSON.stringify(fields),
      });
      return r.profile;
    },
    async getMany(ids: string[]) {
      if (ids.length === 0) return [] as Profile[];
      const q = encodeURIComponent(ids.join(","));
      const r = await request<{ profiles: Profile[] }>(`/api/profiles?ids=${q}`);
      return r.profiles;
    },
  },

  wallet: {
    async get() {
      const r = await request<{ balance: number }>("/api/wallet");
      return r.balance;
    },
    /** Saldo real + bónus (não levantável). */
    async getFull() {
      return request<{ balance: number; bonus: number }>("/api/wallet");
    },
    async transactions(limit = 50) {
      const r = await request<{ transactions: Transaction[] }>(
        `/api/wallet/transactions?limit=${limit}`,
      );
      return r.transactions;
    },
    async createTransaction(input: { type: string; amount: number; description?: string }) {
      const r = await request<{
        transaction: Transaction;
        balance: number;
      }>("/api/wallet/transactions", {
        method: "POST",
        body: JSON.stringify(input),
      });
      return r;
    },
  },

  rewards: {
    async missions() {
      const r = await request<{ missions: Mission[] }>("/api/rewards/missions");
      return r.missions;
    },
    async claim(id: string) {
      return request<{ ok: boolean; reward: number }>(`/api/rewards/missions/${id}/claim`, {
        method: "POST",
        body: JSON.stringify({}),
      });
    },
    async leaderboard() {
      return request<{
        top: RankEntry[];
        me: RankEntry | null;
        prizes: number[];
        endsAt: string;
      }>("/api/rewards/leaderboard");
    },
    async shop() {
      return request<{
        items: ShopItem[];
        equipped: string | null;
        level: number;
        xp: number;
        balance: number;
        bonus: number;
      }>("/api/rewards/shop");
    },
    async buy(id: string) {
      return request<{ ok: boolean }>(`/api/rewards/shop/${id}/buy`, {
        method: "POST",
        body: JSON.stringify({}),
      });
    },
    async equip(id: string | null) {
      return request<{ ok: boolean }>(`/api/rewards/shop/${id ?? "none"}/equip`, {
        method: "POST",
        body: JSON.stringify({}),
      });
    },
  },

  rooms: {
    async listWaiting() {
      const r = await request<{ rooms: Room[] }>("/api/rooms?status=waiting");
      return r.rooms;
    },
    async create(bet_amount: number, is_private = false) {
      const r = await request<{ room: Room }>("/api/rooms", {
        method: "POST",
        body: JSON.stringify({ bet_amount, is_private }),
      });
      return r.room;
    },
    async get(id: string) {
      const r = await request<{ room: Room }>(`/api/rooms/${id}`);
      return r.room;
    },
    /** Jogo rápido: melhor sala em espera para o meu nível (ou null). */
    async match(bet: number) {
      const r = await request<{ roomId: string | null }>(`/api/rooms/match?bet=${bet}`);
      return r.roomId;
    },
    async byCode(code: string) {
      const r = await request<{ room: Room }>(`/api/rooms/by-code/${code}`);
      return r.room;
    },
    async join(id: string) {
      const r = await request<{ room: Room }>(`/api/rooms/${id}/join`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      return r.room;
    },
    async addBot(id: string) {
      const r = await request<{ room: Room }>(`/api/rooms/${id}/bots`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      return r.room;
    },
    async leave(id: string): Promise<{ ok: boolean; refunded: boolean }> {
      const r = await request<{ ok: boolean; refunded?: boolean }>(`/api/rooms/${id}/leave`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      return { ok: r.ok, refunded: !!r.refunded };
    },
  },

  chat: {
    async list(gameId: string) {
      const r = await request<{ messages: any[] }>(`/api/games/${gameId}/chat`);
      return r.messages;
    },
    async send(gameId: string, text: string) {
      const r = await request<{ message: any }>(`/api/games/${gameId}/chat`, {
        method: "POST",
        body: JSON.stringify({ text }),
      });
      return r.message;
    },
    /** Gift: o servidor debita, credita o destinatário e publica no chat. */
    async gift(gameId: string, giftId: string, toPlayerId: string) {
      return request<{ balance: number }>(`/api/games/${gameId}/gift`, {
        method: "POST",
        body: JSON.stringify({ giftId, toPlayerId }),
      });
    },
  },

  games: {
    async start(roomId: string) {
      const r = await request<{ game: GameRecord }>(`/api/games/start/${roomId}`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      return r.game;
    },
    async active() {
      const r = await request<{ game: GameRecord | null }>(`/api/games/active`);
      return r.game;
    },
    async byRoom(roomId: string) {
      const r = await request<{ game: GameRecord }>(`/api/games/by-room/${roomId}`);
      return r.game;
    },
    async get(id: string) {
      const r = await request<{ game: GameRecord }>(`/api/games/${id}`);
      return r.game;
    },
    /** Liga/desliga o auto-play do próprio jogador (o servidor joga por ele). */
    async autoplay(id: string, enabled: boolean) {
      const r = await request<{ game: GameRecord }>(`/api/games/${id}/autoplay`, {
        method: "POST",
        body: JSON.stringify({ enabled }),
      });
      return r.game;
    },
    /** Lança o dado NO SERVIDOR — devolve o valor e o estado actualizado. */
    async roll(id: string) {
      const r = await request<{ game: GameRecord; dice: number; movable: number[] }>(
        `/api/games/${id}/roll`,
        { method: "POST", body: JSON.stringify({}) },
      );
      return r;
    },
    /** Move uma peça — validado e aplicado pelo motor do servidor. */
    async move(id: string, pieceId: number) {
      const r = await request<{ game: GameRecord; captured: boolean; dice: number }>(
        `/api/games/${id}/move`,
        { method: "POST", body: JSON.stringify({ pieceId }) },
      );
      return r;
    },
    async resign(gameId: string) {
      const r = await request<{
        ok: boolean;
        resignStreak: number;
        cooldownMinutes: number;
        cooldownUntil: string | null;
        betLost: number;
      }>(`/api/games/${gameId}/resign`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      return r;
    },
  },

  settings: {
    /**
     * Configuração actual do Smart Dice — gerida pelo admin no backoffice.
     * Endpoint público (sem auth) com cache do lado do servidor.
     */
    async smartDice() {
      const r = await request<{ config: import("./smart-dice").SmartDiceConfig }>(
        `/api/settings/smart-dice`,
      );
      return r.config;
    },
  },

  realtime: {
    subscribe(
      onChange: (ev: {
        table: string;
        event: "INSERT" | "UPDATE" | "DELETE";
        row: Record<string, any>;
        /** Linha grande demais para o pg_notify: `row` só tem o id. */
        truncated?: boolean;
      }) => void,
    ): () => void {
      if (!getToken()) return () => {};
      // O EventSource não suporta headers, por isso usa um token efémero
      // (5min) pedido ao servidor — o token principal nunca vai no URL.
      // Quando a ligação cai (ou o token expira), pede um novo e reconecta.
      let es: EventSource | null = null;
      let closed = false;
      let retry = 0;
      const connect = async () => {
        if (closed || !getToken()) return;
        try {
          const r = await request<{ token: string }>("/api/auth/realtime-token", {
            method: "POST",
            body: JSON.stringify({}),
          });
          if (closed) return;
          es = new EventSource(`/api/realtime?token=${encodeURIComponent(r.token)}`);
          es.addEventListener("change", (e) => {
            try {
              onChange(JSON.parse((e as MessageEvent).data));
            } catch {}
          });
          es.onopen = () => {
            retry = 0;
          };
          es.onerror = () => {
            es?.close();
            if (!closed) {
              setTimeout(connect, Math.min(1000 * 2 ** retry++, 15_000));
            }
          };
        } catch {
          if (!closed) {
            setTimeout(connect, Math.min(1000 * 2 ** retry++, 15_000));
          }
        }
      };
      void connect();
      return () => {
        closed = true;
        es?.close();
      };
    },
  },
};
