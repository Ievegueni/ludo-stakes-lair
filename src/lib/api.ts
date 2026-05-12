const TOKEN_KEY = 'nanter.token';

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
}

export interface Room {
  id: string;
  code: string;
  host_id: string;
  bet_amount: number;
  max_players: number;
  status: 'waiting' | 'playing' | 'finished';
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
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> | undefined),
  };
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) headers['Authorization'] = `Bearer ${token}`;

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
      const r = await request<{ token: string; user: AuthUser }>(
        '/api/auth/signup',
        { method: 'POST', body: JSON.stringify({ phone, password }) },
      );
      setToken(r.token);
      authListeners.forEach((l) => l(r.user));
      return r.user;
    },
    async signIn(phone: string, password: string) {
      const r = await request<{ token: string; user: AuthUser }>(
        '/api/auth/signin',
        { method: 'POST', body: JSON.stringify({ phone, password }) },
      );
      setToken(r.token);
      authListeners.forEach((l) => l(r.user));
      return r.user;
    },
    async me(): Promise<AuthUser | null> {
      if (!getToken()) return null;
      try {
        const r = await request<{ user: AuthUser }>('/api/auth/me');
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
      const r = await request<{ profile: Profile }>('/api/profiles/me');
      return r.profile;
    },
    async update(fields: Partial<Pick<Profile, 'display_name' | 'avatar_url'>>) {
      const r = await request<{ profile: Profile }>('/api/profiles/me', {
        method: 'PATCH',
        body: JSON.stringify(fields),
      });
      return r.profile;
    },
    async getMany(ids: string[]) {
      if (ids.length === 0) return [] as Profile[];
      const q = encodeURIComponent(ids.join(','));
      const r = await request<{ profiles: Profile[] }>(
        `/api/profiles?ids=${q}`,
      );
      return r.profiles;
    },
  },

  wallet: {
    async get() {
      const r = await request<{ balance: number }>('/api/wallet');
      return r.balance;
    },
    async transactions(limit = 50) {
      const r = await request<{ transactions: Transaction[] }>(
        `/api/wallet/transactions?limit=${limit}`,
      );
      return r.transactions;
    },
    async createTransaction(input: {
      type: string;
      amount: number;
      description?: string;
    }) {
      const r = await request<{
        transaction: Transaction;
        balance: number;
      }>('/api/wallet/transactions', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      return r;
    },
  },

  rooms: {
    async listWaiting() {
      const r = await request<{ rooms: Room[] }>('/api/rooms?status=waiting');
      return r.rooms;
    },
    async create(bet_amount: number, is_private = false) {
      const r = await request<{ room: Room }>('/api/rooms', {
        method: 'POST',
        body: JSON.stringify({ bet_amount, is_private }),
      });
      return r.room;
    },
    async get(id: string) {
      const r = await request<{ room: Room }>(`/api/rooms/${id}`);
      return r.room;
    },
    async byCode(code: string) {
      const r = await request<{ room: Room }>(`/api/rooms/by-code/${code}`);
      return r.room;
    },
    async setStatus(id: string, status: Room['status']) {
      const r = await request<{ room: Room }>(`/api/rooms/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      return r.room;
    },
    async join(id: string) {
      const r = await request<{ room: Room }>(`/api/rooms/${id}/join`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      return r.room;
    },
    async addBot(id: string, bot_name: string) {
      const r = await request<{ room: Room }>(`/api/rooms/${id}/bots`, {
        method: 'POST',
        body: JSON.stringify({ bot_name }),
      });
      return r.room;
    },
    async leave(id: string): Promise<{ ok: boolean; refunded: boolean }> {
      const r = await request<{ ok: boolean; refunded?: boolean }>(
        `/api/rooms/${id}/leave`,
        { method: 'POST', body: JSON.stringify({}) },
      );
      return { ok: r.ok, refunded: !!r.refunded };
    },
  },

  chat: {
    async list(gameId: string) {
      const r = await request<{ messages: any[] }>(`/api/games/${gameId}/chat`);
      return r.messages;
    },
    async send(
      gameId: string,
      payload: {
        author_name: string;
        color: string;
        text?: string;
        gift?: { emoji: string; name: string; price: number; toName: string; toColor: string };
      },
    ) {
      const r = await request<{ message: any }>(`/api/games/${gameId}/chat`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      return r.message;
    },
  },

  games: {
    async start(roomId: string) {
      const r = await request<{ game: GameRecord }>(
        `/api/games/start/${roomId}`,
        { method: 'POST', body: JSON.stringify({}) },
      );
      return r.game;
    },
    async active() {
      const r = await request<{ game: GameRecord | null }>(`/api/games/active`);
      return r.game;
    },
    async byRoom(roomId: string) {
      const r = await request<{ game: GameRecord }>(
        `/api/games/by-room/${roomId}`,
      );
      return r.game;
    },
    async get(id: string) {
      const r = await request<{ game: GameRecord }>(`/api/games/${id}`);
      return r.game;
    },
    async update(id: string, state: any, baseVersion: number) {
      const r = await request<{ game: GameRecord }>(`/api/games/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ state, baseVersion }),
      });
      return r.game;
    },
    async resign(gameId: string) {
      const r = await request<{
        ok: boolean;
        resignStreak: number;
        cooldownMinutes: number;
        cooldownUntil: string | null;
        betLost: number;
      }>(`/api/games/${gameId}/resign`, {
        method: 'POST',
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
      const r = await request<{ config: import('./smart-dice').SmartDiceConfig }>(
        `/api/settings/smart-dice`,
      );
      return r.config;
    },
  },

  realtime: {
    subscribe(
      onChange: (ev: {
        table: string;
        event: 'INSERT' | 'UPDATE' | 'DELETE';
        row: Record<string, any>;
      }) => void,
    ): () => void {
      const token = getToken();
      if (!token) return () => {};
      const url = `/api/realtime?token=${encodeURIComponent(token)}`;
      const es = new EventSource(url);
      es.addEventListener('change', (e) => {
        try {
          onChange(JSON.parse((e as MessageEvent).data));
        } catch {}
      });
      es.onerror = () => {
        // Browser auto-reconnects; nothing else to do
      };
      return () => es.close();
    },
  },
};
