# VISUAL_AUDIT.md — NANTER

Auditoria visual da aplicação. Nenhum estilo foi tocado nesta fase.

> Convenção de prioridade: **P0** = impacto enorme/imediato, **P1** = grande mas pode esperar 1 etapa, **P2** = polish.

---

## 1 — Mapa de componentes visuais

### Jogo (durante a partida)

| # | Componente | Ficheiro | Estado actual (resumido) | Melhorias propostas | Prioridade |
|---|---|---|---|---|---|
| 1 | **Tabuleiro (SVG 100×100)** | `src/components/LudoBoard.tsx` (l. 600-720) | SVG plano com `<rect>` de cor + `<text>` ☆ nas safe spots; gradient `linear-gradient(135deg, rgba(30,30,30,.9), rgba(15,15,15,.95))` no contentor; bordas finas | Refazer com gradiente radial por zona, sombra interior tipo "vinheta", estrelas SVG verdadeiras (não emoji ☆), ícone de globo nas casas de saída, vinco diagonal sutil entre quadrantes, painel central com troféu animado | **P0** |
| 2 | **Peças (home + pista)** | `LudoBoard.tsx` (l. 540-690) | `<circle>` chapado + `<ellipse>` highlight branco; `drop-shadow` simples; pulse só via `cursor-pointer` | SVG com gradient radial (luz→sombra), coroa/símbolo no topo, drop-shadow forte com tinta da cor do jogador, halo pulsante quando movível, animação de salto entre casas (Framer Motion spring), animação de "voo" para a base na captura | **P0** |
| 3 | **Dado** | `LudoBoard.tsx` (l. 52-63 + l. 720-755) | Ícones `Dice1..6` do `lucide-react` num quadrado `bg-card`; rotação CSS `animate-spin` durante o roll | Substituir por Lottie 3D (ou SVG faces 3D com transform) com queda + bounce; sombra elevada por baixo; vibração ao parar; integrar com som Howler `dice-roll.mp3` | **P0** |
| 4 | **Botão "Lançar Dado"** | `LudoBoard.tsx` (l. 760-790) | Pílula amarela com sombra; texto dinâmico ("Vez de X" / "Bot a jogar..." / "Lançar Dado") | Manter texto, adicionar gradient amarelo com brilho animado, glow pulsante quando é a tua vez, pressed-state com scale 0.95 | **P1** |
| 5 | **Timer circular** | `LudoBoard.tsx` (l. 700-720) | SVG ring `stroke-dasharray` com `transition-all duration-1000`; cor fixa `#eab308`; pulse só nos últimos 5s via `text-destructive animate-pulse` | Cor do anel muda gradualmente (verde > amarelo > laranja > vermelho); pulsação do anel inteiro <5s; ticker mais grosso; subtle wobble no número | **P1** |
| 6 | **Sidebar Jogadores (desktop)** | `LudoBoard.tsx` (l. 350-400) | Card `bg-card` com lista; ring colorido no jogador da vez; bolinhas pequenas indicando peças | Avatares circulares (foto do perfil) com gradient ring de nível; barra de progresso tipo "X/4 peças no fim"; setinha animada `▶▶` no jogador da vez; status "DESISTIU" riscado | **P1** |
| 7 | **Barra mobile compacta de jogadores** | `LudoBoard.tsx` (l. 290-330) | Pílulas horizontais scrolláveis com cor + nome + "X/4" | Mesmas com avatar miniatura, ring colorido animado quando vez, sombra interior ao desistir | **P2** |
| 8 | **Pot Total** | `LudoBoard.tsx` (l. 320 mobile + l. 805 desktop) | Chip ou card simples `text-primary` | Card com gradient dourado, ícone de moedas, animação de count-up ao iniciar, partícula de brilho no canto | **P1** |
| 9 | **Chips de nome nos cantos do tabuleiro** | `LudoBoard.tsx` (l. 525-555) | Caixa `border-color`, `text-color`, line-through quando desistiu | Adicionar avatar mini circular ao lado do nome, glow ao redor quando vez do jogador, ícone 🏳️ pequeno quando desistiu | **P2** |
| 10 | **Notification banner ("⚔️ CAPTURASTE...", "X DESISTIU")** | `LudoBoard.tsx` (l. 280-285) | `bg-yellow-500 text-black animate-bounce` por 2.5s | Slide-in do topo com Framer Motion, ícone tipo, sombra grande, fade-out elegante; variantes por evento (capturar = vermelho, desistir = laranja, vitória = dourado) | **P1** |
| 11 | **Log de jogadas (sidebar histórico)** | `LudoBoard.tsx` (l. 815-845) | Lista vertical de cards `bg-secondary/30`; highlight `bg-primary/15` em eventos especiais | Fade-in das novas entradas (Framer Motion `AnimatePresence`), ícones por tipo (🎲 dado, ➡️ mover, ⚔️ capturar, 🏳️ desistir, 🏆 vencer), agrupamento por jogador | **P2** |
| 12 | **Botões CHAT / DESISTIR / OPÇÕES** | `LudoBoard.tsx` (l. 793-815) | `Button variant="outline" size="sm"` plano com ícone | Cards com gradient subtle, hover scale 1.05 + glow, active scale 0.95, badge de "novas mensagens" no CHAT | **P1** |
| 13 | **Modal de Vitória** | `LudoBoard.tsx` (l. 855-890) | Modal escuro com 🏆 emoji 6xl, prémio, botão "Voltar ao Lobby" | Lottie de troféu animado, canvas-confetti em loop curto, som Howler `victory.mp3`, count-up do prémio em Kz, partículas douradas, scale-in com spring | **P0** |
| 14 | **Modal de confirmação Desistir** | `LudoBoard.tsx` (l. 825-855) | Modal com 🏳️, texto, 2 botões | Animação de scale-in, ícone Lottie pequeno opcional | **P2** |

### Lobby & navegação

| # | Componente | Ficheiro | Estado actual | Melhorias propostas | Prioridade |
|---|---|---|---|---|---|
| 15 | **Header app (saldo + logout)** | `src/routes/index.tsx` (l. 110-130) | Sticky com `backdrop-blur` + chip Kz | Logo NANTER (SVG estilizado em vez de 🎲), chip de saldo com gradient verde + ícone moeda, animação ao recarregar | **P1** |
| 16 | **Bottom nav (Jogar / Carteira / Perfil)** | `routes/index.tsx` (l. 155-175) | Tabs simples; cor primária na activa | Indicador deslizante por baixo do tab activo (Framer Motion `layoutId`), ripple effect on tap, vibração visual | **P1** |
| 17 | **Cartões de sala (Lobby)** | `src/components/Lobby.tsx` (l. 280-320) | Card `bg-card` com código, aposta, contador, botão Entrar | Hover lift, badge animada de "ao vivo", gradient na aposta, avatares mini dos jogadores já dentro | **P1** |
| 18 | **Sala de espera (waiting room)** | `Lobby.tsx` (l. 165-260) | Lista vertical de "vagas" + botões | Avatares grandes em círculo (estilo lobby), pulse na vaga aberta, código copiável com animação de check | **P1** |
| 19 | **Selector de aposta** | `Lobby.tsx` (l. 350-385) | Botões grid 2-cols com `border-primary` | Pílulas com escala + gradient quando seleccionado, ícone de moeda animado | **P2** |
| 20 | **AuthPhone (login/registo)** | `src/components/AuthPhone.tsx` | Card central simples com 🎲 emoji | Logo NANTER em SVG grande com animação de roll, fundo com gradient + partículas, transição suave login↔signup | **P1** |
| 21 | **Avatares (Profile, Lobby, jogo)** | `Profile.tsx` (l. 175-200), `Lobby.tsx` rooms list | Círculo `border-2 border-primary` ou círculo com emoji `👤`/`🤖` | Componente único `<PlayerAvatar>`: foto > inicial colorida; ring com gradient da cor do jogador; badge de "🤖" no canto se bot; tamanho variável | **P0** |
| 22 | **Wallet (saldo + depósitos)** | `src/components/Wallet.tsx` | Card gradient simples + grid de botões | Card 3D com gradient mais rico, contagem animada, ícones lucide nos tipos de transação, lista com fade-in | **P2** |
| 23 | **Profile (avatar + nome)** | `src/components/Profile.tsx` | Avatar 96px com hover overlay câmara | Frame com gradient ring, badge de "verificado" opcional, animação de upload | **P2** |

### Chat & Gifts

| # | Componente | Ficheiro | Estado actual | Melhorias propostas | Prioridade |
|---|---|---|---|---|---|
| 24 | **GameChat (mensagens)** | `src/components/GameChat.tsx` | Balões `bg-primary` (eu) / `bg-secondary` (outros), header simples | Bubble com tail, avatar mini ao lado, animação slide-in nas novas, indicador "a escrever..." opcional | **P1** |
| 25 | **Quick emojis bar** | `GameChat.tsx` (l. 280-300) | Linha horizontal scroll com emojis | Pop animation ao tocar, badge "+N" no fim, gradient fade nas bordas | **P2** |
| 26 | **Modal Gift Shop** | `GameChat.tsx` (l. 350-440) | Bottom-sheet com grid 3-cols de gifts | Cards com hover lift + glow dourado, preview do emoji em grande no preview superior, animação de selecção | **P1** |
| 27 | **Mensagem de Gift (no chat)** | `GameChat.tsx` (l. 215-245) | Card gradient amber/pink com emoji 3xl | Já bom; adicionar pulse mais forte e mini-confete ao receber | **P2** |
| 28 | **Floating Gift animation** | `GameChat.tsx` (l. 300-325) | Emoji 9xl com keyframes manuais | Substituir keyframes manuais por Framer Motion (spring + path), partículas douradas, som `gift-received.mp3` | **P0** |

### Globais / ambiência

| # | Componente | Ficheiro | Estado actual | Melhorias propostas | Prioridade |
|---|---|---|---|---|---|
| 29 | **Fundo da app** | `src/styles.css` + bg classes | `bg-background` plano (oklch escuro) | Gradiente roxo/escuro Ludo Star, padrão SVG repetido com baixa opacidade, vinheta nas bordas, partículas leves opcionais (`tsparticles`) | **P0** |
| 30 | **Toaster (sonner)** | `routes/index.tsx` | Default sonner | Custom variants combinando com tema (gradient borders, ícones lucide) | **P2** |
| 31 | **Loading state** | `routes/index.tsx` (l. 60-68) | 🎲 emoji animate-bounce | Lottie de dado ou logo com partículas | **P2** |
| 32 | **Tipografia** | `index.html` font default | System fonts | Importar fonte gamificada (ex: "Fredoka" / "Baloo") via Google Fonts ou self-hosted; manter peso variável | **P0** |
| 33 | **Tokens de design** | (não existe) | Cores hardcoded em vários sítios (`#ef4444`, `#3b82f6`, `rgba(...,0.3)`) | Criar `src/styles/tokens.css` com cores das bases (R/B/Y/G × light/base/dark/glow), sombras (sm/md/lg/glow), raios (sm/md/lg/full), gradientes | **P0** |

---

## 2 — Dependências propostas

| Pacote | Razão | Tamanho gz | Prioridade |
|---|---|---|---|
| `framer-motion` | Animação de movimento (peças casa-a-casa, layouts, modal scale-in, banner slide). Componentes (`<motion.div>`) com API declarativa, springs físicos. | ~32 KB | **Essencial (P0)** |
| `lottie-react` | Render de animações Lottie JSON (dado, troféu de vitória, loaders). Sem CSS 3D complexo. | ~17 KB | **Essencial (P0)** |
| `canvas-confetti` | Confetes na vitória. Trivial e leve. | ~6 KB | **Essencial (P0)** |
| `howler` | Pool de áudio gerido (carregamento prévio, volume, mute global). HTML5 Audio standalone seria viável mas Howler dá controle melhor. | ~9 KB | **Essencial (P1)** |
| `@tsparticles/react` + `@tsparticles/slim` | Partículas no fundo / vitória (opcional). | ~40 KB | **Opcional (P2)** — só se ambiência ficar pobre depois do bg. Pode ser cortado. |
| (já instalado) `lucide-react` | Ícones | — | — |

**Total mínimo (essenciais):** ~64 KB gzip — aceitável para mobile. tsparticles fica para uma decisão posterior.

---

## 3 — Ficheiros sem mudanças (lógica intacta)

Os seguintes ficheiros NÃO serão tocados em nenhuma etapa visual:

- `src/lib/ludo-engine.ts` — regras de jogo, dados, captura, vencedor
- `src/lib/api.ts` — cliente HTTP/SSE
- `src/hooks/use-auth.tsx` — auth
- `server/**` — backend Postgres + Hono + SSE
- Estrutura de estado (`gameState`, `useState`, props) em todos os componentes

Todas as alterações serão:
- adicionar/refinar classes Tailwind
- substituir markup SVG do tabuleiro/peças
- adicionar wrappers `<motion.*>` à volta de elementos existentes
- importar e tocar sons em pontos já existentes (não criar novos)
- adicionar tokens CSS

---

## 4 — Plano de execução proposto (ordem)

| Etapa | Visual.md ref | Estimativa | Pré-requisito |
|---|---|---|---|
| **A.** Tokens + tipografia + fundo | 2.1 + 2.10 + #32 | 1 unidade | Aprovação |
| **B.** Tabuleiro (SVG novo + safe stars + globos) | 2.2 | 2 unidades | A |
| **C.** Peças (gradient radial + halo + Framer-motion movimento) | 2.3 | 2 unidades | A, B + framer-motion |
| **D.** Dado (Lottie + som) + botão Lançar | 2.4 + #4 | 1 unidade | A + lottie-react + howler + assets |
| **E.** Timer + Notification banner + Log animado | 2.6 + #10 + 2.7 | 1 unidade | A, framer-motion |
| **F.** HUD: avatares unificados, botões, sidebar, mobile chips | 2.5 + #6, #7, #15, #16, #21 | 1 unidade | A |
| **G.** Modal Vitória (Lottie + confetti + som) | 2.8 + 2.9 | 1 unidade | D + canvas-confetti + assets |
| **H.** Lobby/Auth/Wallet/Profile polish | #17-23 | 1 unidade | F |
| **I.** Chat: bubbles, gift shop, floating gift com framer | #24-28 | 1 unidade | C, framer-motion + howler |
| **J.** (Opcional) tsparticles | 2.10 | 0.5 unidade | A |

A cada fim de etapa: resumo, descrição visual, confirmação de "lógica intacta", aguardar OK.

---

## 5 — Assets que precisarei (vou listar em `assets-list.md` na próxima etapa)

- **Lottie JSONs:** dado a rolar (3D), troféu de vitória, loader genérico
- **Sons MP3/OGG curtos:** `dice-roll`, `piece-move`, `piece-capture`, `victory`, `chat-message`, `gift-received`, `tick` (timer <5s opcional)
- **Fontes:** "Fredoka" ou "Baloo 2" (Google Fonts) — autorizado?
- **(Opcional)** padrão SVG de fundo (tipo geometric blobs)

URLs serão fornecidas pelo user — não vou inventar nem ir buscar a fontes pagas.

---

## ⏸ STOP — aguardo aprovação

**Próximo passo só com OK explícito:**
1. Instalar `framer-motion`, `lottie-react`, `canvas-confetti`, `howler` (4 pacotes, ~64 KB gz total)
2. Criar `src/styles/tokens.css` e `assets-list.md`
3. Começar pela **Etapa A** (tokens + tipografia + fundo)

Indicar:
- ✅ / ❌ instalar deps
- ✅ / ❌ ordem das etapas (ou alterar)
- Confirmação para usar Google Fonts (Fredoka/Baloo)
- Se queres tsparticles ou cortar
