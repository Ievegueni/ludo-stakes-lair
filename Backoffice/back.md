# Backoffice NANTER — Especificação Técnica

## Contexto

NANTER é uma plataforma online de Ludo multiplayer com sistema de apostas em
Kwanza (AOA), operando no mercado angolano. Este documento define o backoffice
administrativo da plataforma.

O jogo principal já está em desenvolvimento separado. Este backoffice é uma
aplicação **independente** que consome a mesma base de dados.

---

## Objetivo

Construir um backoffice web que permita:

- Monitorizar a plataforma em tempo real
- Gerir utilizadores, partidas e transações
- Garantir conformidade com regulação angolana (BNA)
- Detetar e prevenir fraude
- Suportar utilizadores

---

## Modelo de identificação — REGRA ESTRITA

### Jogadores (app NANTER)

- **Login:** apenas com **número de telemóvel + password**
- **Registo:** apenas pede **número de telemóvel + password + displayName**
- **NÃO existe campo de email** em parte nenhuma da plataforma
- **NÃO pedir email** em formulários, perfil, recuperação de senha, suporte, ou qualquer outro lugar
- **Recuperação de senha:** via SMS para o número registado (Futurix)
- **Verificação de conta:** via OTP por SMS no número registado
- **KYC opcional:** BI angolano (apenas para saques acima de limites BNA)

### Admins (backoffice)

- **NÃO há registo público** — admins não se registam, são criados
- **Apenas o SUPER_ADMIN pode criar novos admins**
- **Login:** apenas com **username + password + 2FA**
- **NÃO existe campo de email** também no backoffice
- Primeiro admin (SUPER_ADMIN) criado via **seed da base de dados** ou **CLI**
- Recuperação de senha: feita pelo SUPER_ADMIN (reset manual)
- Comunicação com admins: por canais externos (definidos pela empresa)

### Justificação desta regra

- Mercado angolano: telemóvel é universal, email não é
- Reduz fricção no registo do jogador
- Elimina vetor de phishing por email
- Backoffice fechado: zero superfície de ataque por registo público

---

## Stack técnica

### Frontend

- React 18 + Vite + TypeScript
- Tailwind CSS
- shadcn/ui (componentes UI)
- TanStack Table (tabelas avançadas)
- TanStack Query (data fetching)
- Recharts (gráficos)
- React Hook Form + Zod (formulários e validação)
- React Router v6 (rotas)
- Lucide React (ícones)
- date-fns (datas, locale pt-PT)

### Backend

- Node.js + Fastify
- PostgreSQL + Prisma (mesma DB do jogo)
- Redis (cache, sessions)
- BullMQ (jobs: relatórios, notificações em massa)
- JWT (auth) + bcrypt (passwords)
- Zod (validação de schemas)
- Pino (logs)

### Auth

- JWT com refresh tokens
- 2FA obrigatório para todos os admins (TOTP via Google Authenticator)
- Rate limiting (Redis)
- IP whitelist para super admins (configurável)
- Sessões com expiração curta (30 min idle)

### Infra

- Subdomínio: `admin.nanter.com`
- Deploy: Railway ou VM Ubuntu (Nginx + PM2)
- SSL obrigatório
- Logs centralizados

---

## Estrutura de pastas

```
nanter-backoffice/
├── apps/
│   ├── web/                    # Frontend React
│   └── api/                    # Backend Fastify
├── packages/
│   ├── db/                     # Prisma schema partilhado
│   ├── types/                  # Tipos TypeScript partilhados
│   └── utils/                  # Utils partilhados
├── package.json                # Monorepo (pnpm workspaces)
└── README.md
```

---

## Sistema de roles e permissões

| Role          | Permissões                                                |
| ------------- | --------------------------------------------------------- |
| `SUPER_ADMIN` | Tudo. Único que pode criar/remover outros admins.         |
| `FINANCE`     | Transações, saques, conciliação, relatórios financeiros.  |
| `SUPPORT`     | Utilizadores (ver/suspender), denúncias, chat de suporte. |
| `MARKETING`   | Conteúdo, banners, campanhas, notificações em massa.      |
| `MODERATOR`   | Denúncias, banimentos, replays de partidas.               |
| `AUDITOR`     | Read-only em tudo. Não pode alterar nada.                 |

- Cada admin tem um array de roles (pode ter múltiplos)
- Middleware verifica permissões por rota
- UI esconde funcionalidades sem permissão

---

## Modelo de dados (Prisma)

### Tabelas principais (User, Match, Transaction, Report)

```prisma
model User {
  id          String   @id @default(cuid())
  phone       String   @unique // único identificador de login do jogador
  passwordHash String
  displayName String?  // nome a mostrar no jogo (opcional, editável)
  bi          String?  @unique // Bilhete de Identidade angolano (KYC)
  status      UserStatus @default(ACTIVE)
  level       Int      @default(1)
  xp          Int      @default(0)
  vipTier     VipTier  @default(NONE)
  balance     Decimal  @default(0) // saldo em AOA
  coins       Int      @default(0)
  gems        Int      @default(0)
  createdAt   DateTime @default(now())
  lastLoginAt DateTime?
  lastIp      String?
  deviceId    String?

  matches     Match[]
  transactions Transaction[]
  reports     Report[] @relation("ReporterReports")
  reportedIn  Report[] @relation("ReportedUserReports")
}

enum UserStatus {
  ACTIVE
  SUSPENDED
  BANNED
  PENDING_VERIFICATION
}

enum VipTier {
  NONE
  BRONZE
  SILVER
  GOLD
  PLATINUM
}

model Match {
  id          String   @id @default(cuid())
  mode        MatchMode
  stake       Decimal
  rake        Decimal
  status      MatchStatus
  startedAt   DateTime
  endedAt     DateTime?
  winnerId    String?
  state       Json

  players     MatchPlayer[]
  reports     Report[]
}

enum MatchMode {
  TWO_PLAYERS
  FOUR_PLAYERS
  TOURNAMENT
}

enum MatchStatus {
  IN_PROGRESS
  FINISHED
  ABANDONED
  INVALIDATED
}

model Transaction {
  id            String   @id @default(cuid())
  userId        String
  type          TransactionType
  status        TransactionStatus
  amount        Decimal
  currency      String   @default("AOA")
  reference     String?
  gateway       String?
  metadata      Json?
  createdAt     DateTime @default(now())
  processedAt   DateTime?
  approvedById  String?
  notes         String?

  user          User     @relation(fields: [userId], references: [id])
}

enum TransactionType {
  DEPOSIT
  WITHDRAWAL
  MATCH_STAKE
  MATCH_WIN
  RAKE
  BONUS
  REFERRAL
  REFUND
  ADJUSTMENT
}

enum TransactionStatus {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
  CANCELLED
  AWAITING_APPROVAL
}

model Report {
  id              String   @id @default(cuid())
  reporterId      String
  reportedUserId  String
  matchId         String?
  type            ReportType
  description     String
  evidence        Json?
  status          ReportStatus @default(PENDING)
  resolvedById    String?
  resolution      String?
  createdAt       DateTime @default(now())
  resolvedAt      DateTime?
}

enum ReportType {
  CHEATING
  COLLUSION
  ABUSIVE_BEHAVIOR
  BUG_EXPLOIT
  OTHER
}

enum ReportStatus {
  PENDING
  INVESTIGATING
  RESOLVED
  DISMISSED
}
```

### Tabelas exclusivas do backoffice

```prisma
model Admin {
  id          String   @id @default(cuid())
  username    String   @unique
  passwordHash String
  fullName    String
  roles       AdminRole[]
  twoFactorSecret String?
  twoFactorEnabled Boolean @default(false)
  active      Boolean  @default(true)
  mustChangePassword Boolean @default(true)
  createdById String?
  lastLoginAt DateTime?
  lastIp      String?
  createdAt   DateTime @default(now())

  actions     AdminAction[]
}

enum AdminRole {
  SUPER_ADMIN
  FINANCE
  SUPPORT
  MARKETING
  MODERATOR
  AUDITOR
}

model AdminAction {
  id          String   @id @default(cuid())
  adminId     String
  action      String
  targetType  String
  targetId    String
  reason      String?
  metadata    Json?
  ipAddress   String?
  createdAt   DateTime @default(now())

  admin       Admin    @relation(fields: [adminId], references: [id])

  @@index([adminId, createdAt])
  @@index([targetType, targetId])
}

model Banner {
  id          String   @id @default(cuid())
  title       String
  imageUrl    String
  linkUrl     String?
  position    String
  active      Boolean  @default(true)
  startsAt    DateTime?
  endsAt      DateTime?
  priority    Int      @default(0)
  createdAt   DateTime @default(now())
}

model GameSettings {
  id                String   @id @default("default")
  minStake          Decimal  @default(50)
  maxStake          Decimal  @default(50000)
  rakePercentage    Decimal  @default(5)
  turnTimeoutSec    Int      @default(30)
  reconnectGraceSec Int      @default(60)
  welcomeBonus      Decimal  @default(0)
  referralBonus     Decimal  @default(500)
  modesEnabled      Json
  maintenanceMode   Boolean  @default(false)
  maintenanceMessage String?
  updatedAt         DateTime @updatedAt
  updatedById       String?
}

model Notification {
  id          String   @id @default(cuid())
  type        NotificationType
  channel     NotificationChannel
  segmentId   String?
  title       String
  body        String
  imageUrl    String?
  ctaUrl      String?
  status      NotificationStatus @default(DRAFT)
  scheduledAt DateTime?
  sentAt      DateTime?
  totalSent   Int      @default(0)
  totalFailed Int      @default(0)
  createdById String
  createdAt   DateTime @default(now())
}

enum NotificationType {
  PROMOTIONAL
  TRANSACTIONAL
  SYSTEM
}

enum NotificationChannel {
  PUSH
  SMS
  IN_APP
}

enum NotificationStatus {
  DRAFT
  SCHEDULED
  SENDING
  SENT
  FAILED
}

model SuspiciousActivity {
  id          String   @id @default(cuid())
  userId      String
  type        String
  score       Int
  details     Json
  reviewed    Boolean  @default(false)
  reviewedById String?
  createdAt   DateTime @default(now())

  @@index([reviewed, score])
}
```

---

## Funcionalidades — MVP (Fase 1)

### 1. Autenticação

**Rotas:**

- `POST /api/auth/login` — username + password (apenas admins)
- `POST /api/auth/2fa/verify` — código TOTP
- `POST /api/auth/refresh` — refresh token
- `POST /api/auth/logout`

**Fluxo:**

1. Login com password → retorna token temporário
2. Pede código 2FA → retorna access + refresh tokens
3. Access token expira em 30min, refresh em 7 dias

**Páginas:**

- `/login` — formulário com username + password
- `/login/2fa` — input do código de 6 dígitos
- `/login/setup-2fa` — primeira vez (QR code)
- `/login/change-password` — força mudança no primeiro login

### 2. Dashboard principal

**Rota:** `/dashboard`

**Cards de métricas (topo):**

- Utilizadores online (atual)
- Partidas em curso
- Receita hoje (rake total)
- Novos registos hoje
- Saques pendentes (com badge se > 0)
- Denúncias pendentes (com badge se > 0)

**Gráficos:**

- Utilizadores ativos (DAU) — últimos 30 dias
- Receita diária — últimos 30 dias
- Distribuição de partidas por modo (pie chart)
- Top 10 utilizadores por volume jogado (mês)

**Alertas críticos:**

- Manutenção ativa
- Falha em gateway de pagamento
- Spike anormal de denúncias
- Servidor com latência alta

**Endpoint:** `GET /api/dashboard/overview`

### 3. Gestão de utilizadores

**Rota:** `/users`

**Lista com:**

- Avatar, displayName, telefone
- Status (badge: ACTIVE, SUSPENDED, BANNED)
- Saldo atual
- Nível e VIP
- Última atividade
- Ações rápidas: ver, suspender, banir

**Filtros:**

- Status
- VIP tier
- Saldo (range)
- Data de registo
- Pesquisa por displayName/telefone/BI/ID

**Página de detalhe:** `/users/:id`

Tabs:

- **Perfil** — todos os dados, editar nível/VIP/notas
- **Saldo** — saldo atual, histórico de ajustes, botão "Ajustar saldo" (modal com motivo obrigatório)
- **Transações** — todas as transações do user
- **Partidas** — histórico com link para replay
- **Denúncias** — denúncias feitas e recebidas
- **Sessões** — histórico de login (IP, dispositivo)
- **Auditoria** — todas as ações de admin sobre este user

**Ações:**

- Suspender (1d, 7d, 30d, custom) com motivo
- Banir permanentemente com motivo
- Ajustar saldo (+/-) com motivo
- Reset password (envia SMS via Futurix)
- Forçar logout
- Verificar identidade (KYC)

**Endpoints:**

- `GET /api/users` (paginado, filtros)
- `GET /api/users/:id`
- `PATCH /api/users/:id`
- `POST /api/users/:id/balance-adjustment`
- `POST /api/users/:id/suspend`
- `POST /api/users/:id/ban`
- `POST /api/users/:id/unban`

### 4. Gestão de transações

**Rota:** `/transactions`

**Lista com:**

- Data/hora
- User (link para perfil)
- Tipo (badge colorido)
- Valor (verde se entrada, vermelho se saída)
- Status
- Gateway
- Referência

**Filtros:**

- Tipo, Status, Gateway, Range de valor, Range de data, User

**Sub-rotas:**

- `/transactions/withdrawals` — só saques
- `/transactions/withdrawals/pending` — saques aguardando aprovação ⚠️ prioridade alta
- `/transactions/deposits` — só depósitos
- `/transactions/reconciliation` — conciliação com gateway

**Aprovação de saque:**

- Modal com detalhes do user (saldo, KYC status, histórico)
- Verificação de IBAN
- Botão "Aprovar"
- Botão "Rejeitar" com motivo (devolver saldo)

**Endpoints:**

- `GET /api/transactions`
- `GET /api/transactions/:id`
- `POST /api/transactions/:id/approve`
- `POST /api/transactions/:id/reject`
- `POST /api/transactions/:id/retry`

### 5. Gestão de partidas

**Rota:** `/matches`

**Lista com:** ID, Modo, Stake, Status, Jogadores, Vencedor, Duração, Data

**Filtros:** Status, Modo, Stake range, Data, Tem denúncia

**Página de detalhe:** `/matches/:id`

- Replay visual da partida (turno por turno)
- Logs de movimentos
- Chat da partida
- Denúncias associadas
- Botão "Invalidar partida" (devolver stakes)
- Botão "Marcar como suspeita"

**Endpoints:**

- `GET /api/matches`
- `GET /api/matches/:id`
- `GET /api/matches/:id/replay`
- `POST /api/matches/:id/invalidate`

### 6. Sistema de denúncias

**Rota:** `/reports`

**Lista com:** Data, Reporter, Reportado, Tipo, Status, Match, Ações

**Filtros:** Status, Tipo, Data

**Página de detalhe:** `/reports/:id`

- Descrição do reporter
- Evidências (chat, replay)
- Histórico de denúncias do reportado
- Score de comportamento
- Ações: Ignorar, Avisar, Suspender, Banir, Invalidar partida

**Endpoints:**

- `GET /api/reports`
- `GET /api/reports/:id`
- `POST /api/reports/:id/resolve`

### 7. Auditoria de admin

**Rota:** `/audit-log`

**Lista cronológica de todas as ações de admins:**

- Quem, Quando, O quê, IP, Target

**Filtros:** Admin, Tipo de ação, Data, Target

Apenas SUPER_ADMIN e AUDITOR veem tudo. Outros roles veem apenas as suas próprias ações.

**Endpoint:** `GET /api/audit-log`

### 8. Gestão de admins (apenas SUPER_ADMIN)

**Rota:** `/admins`

**Lista:** Username, Nome completo, Roles, Status, 2FA configurado, Último login, Último IP

**Ações:**

- **Criar novo admin** (modal):
  - Username (único)
  - Nome completo
  - Password temporária (gerada automaticamente, mostrada apenas uma vez)
  - Roles (multi-select)
  - `mustChangePassword = true` por defeito
- **Editar roles** de admin existente
- **Desativar admin** (não apaga, apenas bloqueia login)
- **Reativar admin**
- **Reset de password** (gera nova temporária, força mudança no próximo login)
- **Reset de 2FA** (admin terá de reconfigurar no próximo login)
- **Forçar logout**

Visível apenas para SUPER_ADMIN.

**Endpoints:**

- `GET /api/admins`
- `POST /api/admins`
- `PATCH /api/admins/:id`
- `POST /api/admins/:id/reset-password`
- `POST /api/admins/:id/reset-2fa`
- `POST /api/admins/:id/force-logout`

**Bootstrap inicial:**

- Primeiro SUPER_ADMIN criado via comando CLI: `pnpm admin:create-super`
- O CLI pede username, nome completo e password
- Gera registo na DB com `mustChangePassword = false`
- Sem este passo, não há como entrar no backoffice

---

## Funcionalidades — Fase 2 (pós-MVP)

A implementar **só depois do MVP estar estável em produção**.

### 9. Anti-fraude

- Lista de utilizadores com score suspeito
- Detetores: multi-account, win-rate anormal, conluio, padrões de jogo
- Job diário a calcular scores

### 10. Configurações de jogo

- Editar stakes min/max, comissão (rake), timeouts
- Ativar/desativar modos
- Modo manutenção

### 11. Banners e conteúdo

- CRUD de banners do lobby
- Upload de imagens
- Agendamento (start/end date)
- Reordenar drag-and-drop

### 12. Notificações em massa

- Criar campanha (push + SMS + in-app)
- Segmentação (todos, ativos 7d, inativos 30d, VIP, nível X+)
- Preview, agendamento, relatório pós-envio
- Integração com Futurix SMS

### 13. Suporte / chat

- Inbox de mensagens de utilizadores
- Resposta inline, templates
- Marcar como resolvido, SLA tracking

---

## UI/UX — Diretrizes

### Layout geral

```
┌─────────────────────────────────────────┐
│  [Logo NANTER Admin]    [Notif] [User]  │
├──────────┬──────────────────────────────┤
│ Sidebar  │   Conteúdo principal         │
│ Dashboard│                              │
│ Users    │                              │
│ Trans.   │                              │
│ Matches  │                              │
│ Reports  │                              │
│ Settings │                              │
│ Admins   │                              │
│ Audit    │                              │
└──────────┴──────────────────────────────┘
```

### Visual

- **Tema:** dark mode primário
- **Cor primária:** azul profissional (#3B82F6)
- **Cor de alerta:** vermelho (#EF4444)
- **Cor de sucesso:** verde (#10B981)
- **Tipografia:** Inter
- **Espaçamento:** generoso
- **Tabelas:** zebra striping, hover destaque, sticky header

### Boas práticas

- Toda ação destrutiva requer confirmação dupla com motivo obrigatório
- Mostrar quem fez a última ação relevante
- Tooltips em ícones
- Loading states claros
- Toast notifications para feedback
- Atalhos de teclado (Cmd+K para pesquisa)

---

## Segurança — Não negociável

1. 2FA obrigatório para todos os admins
2. HTTPS obrigatório em produção
3. Rate limiting em todas as rotas (Redis)
4. CSRF protection ativa
5. SQL injection prevenida via Prisma
6. XSS prevention — sanitização de inputs, CSP headers
7. Logs de auditoria imutáveis
8. Sessões com expiração curta (30min idle)
9. IP whitelist para SUPER_ADMIN (configurável)
10. Backup automático diário da DB
11. Variáveis sensíveis em .env
12. Senhas hashed com bcrypt (cost factor 12+)

---

## Localização

- Idioma: **Português (PT-PT)**
- Moeda: **Kwanza (AOA)** — formato `1.234.567,89 Kz`
- Datas: `DD/MM/AAAA HH:mm` (Europe/Luanda)
- Números: separador milhares `.`, decimal `,`

---

## Plano de execução

### Fase 1 — Setup (Sprint 1)

1. Inicializar monorepo (pnpm workspaces)
2. Setup do frontend (Vite + React + TS + Tailwind + shadcn/ui)
3. Setup do backend (Fastify + Prisma + Redis)
4. Estrutura de pastas
5. ESLint, Prettier, TS strict
6. Setup de .env e secrets
7. Schema Prisma (Admin, AdminAction)
8. **CLI `pnpm admin:create-super`** para criar primeiro SUPER_ADMIN
9. Layout base (sidebar + topbar)
10. Sistema de auth (username + password) + 2FA
11. Página de login funcional
12. Fluxo "primeiro login" — força mudança de password

**Entregável:** SUPER_ADMIN criado via CLI, login com 2FA funcional.

### Fase 2 — Dashboard e Users (Sprint 2)

1. Dashboard com métricas reais
2. Listagem de utilizadores com filtros
3. Página de detalhe (todas as tabs)
4. Ajuste de saldo com auditoria
5. Suspensão e banimento

### Fase 3 — Transações (Sprint 3)

1. Listagem de transações
2. Aprovação de saques
3. Conciliação com gateway
4. Reprocessamento

### Fase 4 — Matches e Reports (Sprint 4)

1. Listagem de partidas
2. Replay
3. Invalidação
4. Sistema de denúncias

### Fase 5 — Auditoria, Admins e Polimento (Sprint 5)

1. Audit log completo
2. Sistema de roles refinado
3. Gestão de admins (CRUD pelo SUPER_ADMIN)
4. Filtros avançados
5. Exportação CSV
6. Testes E2E
7. Deploy em staging

**Entregável:** MVP pronto para produção.

---

## Antes de começar

### Perguntas a confirmar com o utilizador

1. A base de dados é partilhada com o jogo principal ou separada?
2. Já existe schema Prisma do jogo? Se sim, partilhar.
3. Que gateway de pagamento (ProxyPay, EMIS direto)?
4. Confirmar integração SMS com Futurix.
5. Domínio para o admin (`admin.nanter.com`)?
6. Username e nome completo do primeiro SUPER_ADMIN.
7. Limites BNA específicos (KYC obrigatório acima de X Kz)?
8. Confirmar lista oficial de roles.

### Primeiro passo

1. Ler este documento na totalidade
2. Confirmar respostas às perguntas
3. Apresentar plano detalhado da Fase 1
4. Aguardar aprovação
5. Começar pela inicialização do monorepo

**NÃO começar a programar antes da aprovação do plano.**

---

## Restrições

- ❌ NÃO incluir funcionalidades fora deste documento sem aprovação
- ❌ NÃO usar libs fora da stack definida sem justificar
- ❌ NÃO criar tabelas que dupliquem dados do jogo principal
- ❌ NÃO incluir email em parte alguma da plataforma
- ✅ TypeScript estrito (zero `any`)
- ✅ Comentários em PT-PT em lógica complexa
- ✅ Cada feature termina com resumo + como testar + aguardar aprovação
