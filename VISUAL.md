# Plano Visual — Ludo

## Contexto

O jogo já está funcional: lógica, multiplayer, chat, gifts, desistência. 
Falta apenas melhorar a aparência para o nível Ludo Star.

## Regras

- ❌ NÃO alterar lógica de jogo, multiplayer, chat, gifts, estado
- ❌ NÃO alterar APIs, rotas, base de dados
- ✅ Apenas componentes visuais, estilos, animações
- ✅ Pode adicionar libs visuais (mediante aprovação)
- ✅ TypeScript estrito, comentários em PT-PT

## Stack visual a instalar

```bash
npm install framer-motion canvas-confetti howler lucide-react
npm install -D @types/howler
```

## Plano de execução

### Etapa 1 — Sistema de design
- Criar `src/styles/tokens.css` com:
  - Cores das 4 bases (R, B, Y, G) com variantes light/base/dark/glow
  - Sombras (sm, md, lg, glow)
  - Raios, gradientes, transições
- Aplicar globalmente sem alterar layout

### Etapa 2 — Tabuleiro
- Refinar com gradientes, sombras internas, bordas arredondadas
- Casas seguras: estrelas SVG brilhantes
- Casas globais (entrada das bases): ícone de globo
- Zonas das bases com gradient sutil

### Etapa 3 — Peças
- SVG com gradient radial + coroa/símbolo + sombra inferior + highlight superior
- Estados: idle, ativa (glow pulsante), movível (halo)
- Animação de movimento com Framer Motion (spring, casa-a-casa)
- Animação de captura (peça "voa" para base, fade + scale)

### Etapa 4 — Dado 3D em CSS
- Componente `<Dice />` em `src/components/Dice/`
- Cubo 3D com `transform: rotateX/rotateY/rotateZ`
- 6 faces SVG com pips dourados (#FFD700) sobre fundo escuro
- Animação de roll: rotação aleatória 600-800ms, para na face do `value`
- Sem Lottie, sem libs externas
- Props: `value` (1-6), `isRolling` (boolean), `size` (px), `onRollComplete` (callback)

### Etapa 5 — HUD e botões
- Cards com gradientes, sombras suaves
- Ícones via lucide-react (Crown, MessageCircle, LogOut, Settings, Trophy, Star, Globe, Volume2, Gift, Timer)
- Botões CHAT/DESISTIR/OPÇÕES com hover (scale 1.05) e active (scale 0.95)
- Avatares: frame circular com gradient + badge de nível

### Etapa 6 — Timer circular
- SVG progress ring animado
- Cor dinâmica: verde → amarelo → vermelho
- Pulse quando faltam <5s

### Etapa 7 — Vitória
- canvas-confetti
- Modal com Lottie de troféu (ver assets.md)
- Som de vitória (Howler)

### Etapa 8 — Sons (Howler)
- Carregar todos os sons listados em assets.md
- Criar `src/utils/sound.ts` com helper `playSound(name)`
- Hook em: rolar dado, mover peça, capturar, vencer, clique, chat, gift

### Etapa 9 — Fundo e ambiência
- Gradiente roxo (estilo Ludo Star)
- Padrão sutil em SVG (gerado por código, sem download)

## Fluxo de execução

1. **Auditoria visual** — Lê CLAUDE.md e mapeia componentes existentes. Produz tabela:
   `| Componente | Ficheiro | Estado atual | Melhorias | Prioridade |`
   Aguarda aprovação.

2. **Implementação por etapas** — Após aprovação, implementa etapa por etapa.
   No fim de cada uma:
   - Resumo do que foi feito (ficheiros tocados)
   - Confirmação de que NENHUMA lógica foi alterada
   - Aguarda OK antes de avançar

## Assets externos

Ver `./assets.md` — só a partir da Etapa 7 (vitória) e Etapa 8 (sons).
Etapas 1-6 não precisam de assets externos.
