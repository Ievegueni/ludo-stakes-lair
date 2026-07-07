# Audit TODO - Ludo Stakes Lair

> Gerado em 2026-05-12 | Varredura completa do projecto

---

## VULNERABILIDADES DE SEGURANCA

### CRITICAS (fazer HOJE)

- [x] **V1 - JWT Secret hardcoded** ✅ 2026-07-07 — crasha em produção sem JWT_SECRET
  - Ficheiro: `server/src/auth.ts:6`
  - Problema: Fallback `'dev-only-change-me-in-prod'` permite forjar tokens se env var nao existir
  - Fix: Crashar se JWT_SECRET nao estiver definido em producao

- [x] **V2 - CORS origin: '\*'** ✅ 2026-07-07 — restringido via env ALLOWED_ORIGINS em produção
  - Ficheiro: `server/src/index.ts:24`
  - Problema: Aceita requests de qualquer dominio
  - Fix: Restringir para dominios especificos

- [x] **V3 - Sem rate limiting na auth** ✅ 2026-07-07 — 5 tentativas/15min por phone+IP
  - Ficheiro: `server/src/routes/auth.ts`
  - Problema: Signup/signin sem limites - brute force facil com passwords de 4-5 chars
  - Fix: Implementar rate limiting (max 5 tentativas por phone/15min)

### ALTAS (fazer esta semana)

- [x] **V4 - SQL dinamico nos profiles** ✅ 2026-07-07 — colunas já eram hardcoded (seguro); adicionada validação de display_name/avatar_url
  - Ficheiro: `server/src/routes/profiles.ts:38`
  - Problema: Nomes de colunas construidos por concatenacao (whitelist implicito mas fragil)
  - Fix: Whitelist explicito de colunas permitidas

- [x] **V5 - Passwords de 4-5 caracteres** ✅ 2026-07-07 — mín. 8, máx. 64 no signup (login aceita contas antigas)
  - Ficheiro: `server/src/routes/auth.ts:19` + `src/components/AuthPhone.tsx:26`
  - Problema: ~22 bits de entropia, facilmente atacavel
  - Fix: Minimo 8 caracteres, maximo 64+

- [x] **V6 - Token JWT no query param do EventSource** ✅ 2026-07-07 — token efémero de 5min com scope 'realtime'; endpoint /api/realtime agora exige auth (estava aberto!)
  - Ficheiro: `src/lib/api.ts:314`
  - Problema: Token exposto em logs, browser history, Referer header
  - Fix: Usar token curto especifico para realtime ou mudar para WebSocket

### MEDIAS (fazer em breve)

- [ ] **V7 - Token no localStorage**
  - Ficheiro: `src/lib/api.ts:60-69`
  - Problema: Vulneravel a XSS
  - Fix: Considerar httpOnly cookies

- [ ] **V8 - Sem invalidacao de tokens no logout**
  - Ficheiro: `src/lib/api.ts:129-131`
  - Problema: Token valido 30 dias apos logout
  - Fix: Blacklist de tokens ou reduzir TTL

- [ ] **V9 - Rate limiting em memoria (reports)**
  - Ficheiro: `server/src/routes/reports.ts:29`
  - Problema: Ineficaz em multi-instancia
  - Fix: Mover para Redis ou PostgreSQL

- [x] **V10 - Sem headers de seguranca** ✅ 2026-07-07 — secureHeaders do Hono (X-Frame-Options DENY, etc.)
  - Ficheiro: `server/src/index.ts`
  - Problema: Falta CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy
  - Fix: Adicionar middleware com todos os headers

- [x] **V11 - Sem validacao de limite maximo no amount** ✅ 2026-07-07 — máx. 10M Kz por transacção
  - Ficheiro: `server/src/routes/wallet.ts:39`
  - Problema: Aceita valores extremos
  - Fix: Definir limite maximo por transacao

---

## ERROS E BUGS DE CODIGO

### ALTOS (fazer esta semana)

- [x] **B1 - useEffect do bot com deps incompletas** ✅ 2026-07-07 — effect movido para depois das callbacks, deps completas
  - Ficheiro: `src/components/LudoBoard.tsx:410`
  - Problema: handleRollDice, handleMovePiece, nextTurn chamados mas nao nas deps
  - Fix: Adicionar deps em falta ou usar useCallback com deps correctas

- [x] **B2 - useEffect do timer com deps incompletas** ✅ 2026-07-07 — nextActiveIdx adicionado às deps (aqui e nos restantes hooks)
  - Ficheiro: `src/components/LudoBoard.tsx:390`
  - Problema: nextActiveIdx chamado mas nao declarado como dependencia
  - Fix: Adicionar nextActiveIdx as deps

### MEDIOS (fazer em breve)

- [ ] **B3 - Race condition no realtime sync**
  - Ficheiro: `src/components/LudoBoard.tsx:363-366`
  - Problema: Check de versao nao e atomico
  - Fix: Melhorar locking ou usar sequential versioning

- [x] **B4 - Memory leak no event listener** ✅ 2026-07-07 — listener registado 1x com ref para sendMessage
  - Ficheiro: `src/components/GameChat.tsx:104-107`
  - Problema: Listeners de 'nanter-quick-emoji' acumulam quando deps mudam
  - Fix: Garantir cleanup correcto dos listeners

- [x] **B5 - Smart dice history global** ✅ já estava corrigido — history isolada por gameId
  - Ficheiro: `src/lib/smart-dice.ts:102`
  - Problema: Map persiste entre jogos - dados viciados carry over
  - Fix: Isolar history por game ou garantir reset no unmount

- [x] **B6 - Array access sem bounds check** ✅ 2026-07-07 — movePiece devolve estado inalterado se peça inválida
  - Ficheiro: `src/lib/ludo-engine.ts:131`
  - Problema: player.pieces[pieceId] sem validar se pieceId e valido
  - Fix: Adicionar validacao de bounds

- [x] **B7 - Erros silenciados no GameChat** ✅ 2026-07-07 — log + toast a avisar o utilizador
  - Ficheiro: `src/components/GameChat.tsx:135,258`
  - Problema: catch vazio - gift pode debitar saldo sem registar no servidor
  - Fix: Adicionar logging e retry ou rollback do saldo

- [x] **B8 - Sound crash se Howl falhar** ✅ obsoleto — sons migrados para Web Audio API com try/catch
  - Ficheiro: `src/utils/sound.ts:72-80`
  - Problema: Se new Howl() falhar, h fica undefined mas h.play() e chamado
  - Fix: Null check antes de .play()

- [ ] **B9 - Tipos any nos queries do servidor**
  - Ficheiro: `server/src/routes/games.ts`
  - Problema: Sem validacao de tipo nos resultados da DB
  - Fix: Criar interfaces para cada query

---

## FICHEIROS NAO UTILIZADOS (38 componentes UI)

> ✅ 2026-07-07 — eliminados todos excepto `button.tsx` e `input.tsx` (únicos com imports
> reais; label/separator/skeleton já não eram usados). Removidas também ~35 dependências
> npm órfãs (radix, recharts, howler, react-hook-form, etc.) e `src/hooks/use-mobile.tsx`.

### Podem ser eliminados (nao sao importados em lado nenhum)

- [ ] `src/components/ui/accordion.tsx`
- [ ] `src/components/ui/alert-dialog.tsx`
- [ ] `src/components/ui/alert.tsx`
- [ ] `src/components/ui/aspect-ratio.tsx`
- [ ] `src/components/ui/avatar.tsx`
- [ ] `src/components/ui/badge.tsx`
- [ ] `src/components/ui/breadcrumb.tsx`
- [ ] `src/components/ui/calendar.tsx`
- [ ] `src/components/ui/card.tsx`
- [ ] `src/components/ui/carousel.tsx`
- [ ] `src/components/ui/chart.tsx`
- [ ] `src/components/ui/checkbox.tsx`
- [ ] `src/components/ui/collapsible.tsx`
- [ ] `src/components/ui/command.tsx`
- [ ] `src/components/ui/context-menu.tsx`
- [ ] `src/components/ui/dialog.tsx` (so usado por command.tsx que tambem nao e usado)
- [ ] `src/components/ui/drawer.tsx`
- [ ] `src/components/ui/dropdown-menu.tsx`
- [ ] `src/components/ui/form.tsx`
- [ ] `src/components/ui/hover-card.tsx`
- [ ] `src/components/ui/input-otp.tsx`
- [ ] `src/components/ui/menubar.tsx`
- [ ] `src/components/ui/navigation-menu.tsx`
- [ ] `src/components/ui/pagination.tsx`
- [ ] `src/components/ui/popover.tsx`
- [ ] `src/components/ui/progress.tsx`
- [ ] `src/components/ui/radio-group.tsx`
- [ ] `src/components/ui/resizable.tsx`
- [ ] `src/components/ui/scroll-area.tsx`
- [ ] `src/components/ui/select.tsx`
- [ ] `src/components/ui/sheet.tsx` (so usado por sidebar.tsx que nao e usado)
- [ ] `src/components/ui/sidebar.tsx`
- [ ] `src/components/ui/slider.tsx`
- [ ] `src/components/ui/sonner.tsx`
- [ ] `src/components/ui/switch.tsx`
- [ ] `src/components/ui/table.tsx`
- [ ] `src/components/ui/tabs.tsx`
- [ ] `src/components/ui/textarea.tsx`
- [ ] `src/components/ui/toggle.tsx` (so usado por toggle-group.tsx que nao e usado)
- [ ] `src/components/ui/toggle-group.tsx`

### Componentes UI em uso (manter)

- `button.tsx` (11 imports)
- `input.tsx` (4 imports)
- `label.tsx` (1 import)
- `separator.tsx` (1 import)
- `skeleton.tsx` (1 import)

---

## ORDEM DE EXECUCAO

1. V1 - JWT Secret hardcoded
2. V2 - CORS origin
3. V3 - Rate limiting auth
4. V5 - Password strength
5. V10 - Security headers
6. B1 - useEffect bot deps
7. B2 - useEffect timer deps
8. B4 - Memory leak GameChat
9. B8 - Sound crash
10. B7 - Erros silenciados GameChat
11. B5 - Smart dice history
12. B6 - Bounds check ludo-engine
13. V4 - SQL dinamico profiles
14. V6 - Token no query param
15. V11 - Limite maximo amount
16. B3 - Race condition realtime
17. B9 - Tipos any
18. Eliminar ficheiros UI nao usados
19. V7 - Token localStorage
20. V8 - Token invalidation
21. V9 - Rate limiting reports
