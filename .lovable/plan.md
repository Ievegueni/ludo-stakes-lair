
# Jogo de Ludo Online com Apostas

## Visão Geral

Jogo de Ludo interativo jogável no browser, com sistema de apostas simuladas em Kwanza (Kz), wallet digital, salas com valor fixo de aposta, suporte para 2-4 jogadores (amigos ou bots), e autenticação por telefone SMS.

## Funcionalidades

### 1. Autenticação por Telefone (SMS)
- Tela de login/registro com número de telefone angolano
- Verificação por código SMS (via Supabase Auth)
- Perfil básico do jogador (nome, avatar, saldo)

### 2. Wallet (Carteira Digital)
- Saldo em Kz visível no topo da app
- Histórico de transações (depósitos, apostas, ganhos)
- Depósito simulado (botão "Adicionar saldo" para testes — sem integração de pagamento real por agora)
- Saque simulado

### 3. Lobby / Salas de Jogo
- Lista de salas disponíveis com info: valor da aposta, jogadores actuais, vagas
- Salas com valores fixos pré-definidos: 100 Kz, 500 Kz, 1.000 Kz, 5.000 Kz
- Criar sala privada (com código para convidar amigos)
- Preencher vagas com bots (botão "Adicionar Bot")
- Indicador de estado: aguardando jogadores, em jogo, finalizada

### 4. Tabuleiro de Ludo Interativo
- Tabuleiro clássico de Ludo renderizado com cores vermelho, azul, verde, amarelo
- Dado animado com clique para lançar
- 4 peças por jogador, movimentação visual animada
- Regras clássicas: sair da base com 6, captura, casa segura, chegada ao centro
- Indicador de turno claro (destaque no jogador actual)
- Timer por jogada (30 segundos, joga automaticamente se expirar)

### 5. Bots (IA Simples)
- Bots jogam automaticamente com lógica básica (priorizar captura, avançar peça mais adiantada)
- Delay simulado para parecer natural (1-3 segundos)
- Nomes e avatares aleatórios para bots

### 6. Sistema de Apostas
- Ao entrar na sala, o valor da aposta é debitado da wallet
- Vencedor recebe o pot total (soma das apostas) menos 5% de taxa da casa
- Em caso de desistência, perde a aposta
- Histórico de partidas com resultado e ganhos/perdas

### 7. Páginas da App
- **Login** — autenticação por telefone
- **Lobby** — lista de salas, criar sala, entrar em sala
- **Sala de espera** — aguardar jogadores, adicionar bots, iniciar jogo
- **Jogo** — tabuleiro interativo com dado e peças
- **Perfil** — wallet, histórico, estatísticas (vitórias, derrotas)

## Detalhes Técnicos

- **Database**: Lovable Cloud (Supabase) com tabelas para profiles, wallets, transactions, rooms, games, game_moves
- **Auth**: Supabase Phone Auth (SMS)
- **Real-time**: Supabase Realtime para sincronizar estado do jogo entre jogadores
- **Lógica do jogo**: Server functions para validar jogadas e prevenir trapaças
- **Frontend**: Canvas ou SVG para o tabuleiro, animações CSS/JS para dado e peças
