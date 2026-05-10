import type { Player, PlayerColor } from '@/lib/ludo-engine';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { Dice } from '@/components/Dice/Dice';

const COLORS: Record<PlayerColor, string> = {
  red: '#ef4444',
  blue: '#3b82f6',
  green: '#22c55e',
  yellow: '#facc15',
};

interface PlayerSlotProps {
  player: Player;
  /** É a vez deste jogador? */
  isCurrent: boolean;
  /** É o jogador local (eu)? — destaca o card */
  isMe?: boolean;
  /** Valor actual do dado (só relevante se isCurrent) */
  diceValue?: number | null;
  /** Dado a animar (rolar) */
  isRolling?: boolean;
  /** Tamanho dos elementos: 'sm' (oponentes top) | 'md' (user bottom) */
  size?: 'sm' | 'md';
  /** Nome a mostrar (override; default = player.name) */
  displayName?: string;
}

/**
 * Slot de jogador com avatar + nome + dado lateral.
 * O dado SÓ aparece quando é a vez do jogador. Estilo Ludo Star:
 * o oponente vê o dado dele do lado, o user também vê o seu dado.
 */
export function PlayerSlot({
  player,
  isCurrent,
  isMe = false,
  diceValue = null,
  isRolling = false,
  size = 'sm',
  displayName,
}: PlayerSlotProps) {
  const avatarSize = size === 'sm' ? 36 : 48;
  const diceSize = size === 'sm' ? 30 : 38;
  const showDice = isCurrent && !player.resigned;

  return (
    <div
      className={`flex items-center gap-2 transition-all ${
        isCurrent ? '' : 'opacity-65'
      } ${player.resigned ? 'grayscale opacity-40' : ''}`}
    >
      <PlayerAvatar
        name={player.name}
        color={player.color}
        avatarUrl={player.avatarUrl}
        size={avatarSize}
        isActive={isCurrent}
        isBot={player.isBot}
        resigned={player.resigned}
        isWinner={false}
      />
      <div className="flex flex-col leading-tight min-w-0">
        <span
          className={`font-bold truncate max-w-[110px] ${
            size === 'sm' ? 'text-[12px]' : 'text-sm'
          } ${player.resigned ? 'line-through' : ''}`}
          style={{ color: COLORS[player.color] }}
          title={player.name}
        >
          {displayName ?? (isMe ? 'Tu' : player.name)}
        </span>
        <span
          className={`text-[10px] uppercase tracking-wider ${
            isCurrent ? 'text-amber-300 font-bold' : 'text-muted-foreground'
          }`}
        >
          {isCurrent ? 'A jogar...' : 'Aguarda'}
        </span>
      </div>

      {/* Dado lateral — só visível quando é a vez */}
      <div
        className={`transition-all ${
          showDice ? 'opacity-100 translate-x-0 ml-1' : 'opacity-0 -translate-x-2 w-0 overflow-hidden'
        }`}
        style={{ pointerEvents: showDice ? 'auto' : 'none' }}
      >
        <Dice
          value={diceValue || 1}
          isRolling={isRolling}
          size={diceSize}
          theme="gold"
        />
      </div>
    </div>
  );
}
