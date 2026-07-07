import { useEffect, useRef, useState } from "react";
import "./Dice.css";

/**
 * Dado 3D em CSS puro — sem libs externas.
 *
 * Implementação: cubo com `transform-style: preserve-3d` e 6 faces
 * posicionadas a meio-tamanho de cada eixo. A rotação do cubo é
 * controlada pelo state interno e transitions CSS.
 *
 * Props:
 *   value           — face a mostrar (1..6) quando para de rolar
 *   isRolling       — true: roda continuamente; false: assenta na face do `value`
 *   size            — tamanho em px (default 64)
 *   onRollComplete  — chamado quando a animação de assentamento termina
 *   theme           — 'gold' (pips dourados em fundo escuro) | 'classic' (default)
 */

export interface DiceProps {
  value: number;
  isRolling: boolean;
  size?: number;
  onRollComplete?: () => void;
  theme?: "classic" | "gold";
}

/**
 * Rotação do cubo necessária para trazer cada face para a câmara,
 * assumindo o layout standard:
 *   1 frente, 2 direita, 3 cima, 4 baixo, 5 esquerda, 6 trás.
 */
const SHOW_ROTATION: Record<number, [number, number]> = {
  1: [0, 0],
  2: [0, -90],
  3: [-90, 0],
  4: [90, 0],
  5: [0, 90],
  6: [0, 180],
};

/**
 * Transformação inicial de cada face dentro do cubo.
 * Posiciona a face na superfície correcta e vira-a para fora.
 */
const FACE_TRANSFORM: Record<number, (half: number) => string> = {
  1: (h) => `translateZ(${h}px)`,
  2: (h) => `rotateY(90deg) translateZ(${h}px)`,
  3: (h) => `rotateX(90deg) translateZ(${h}px)`,
  4: (h) => `rotateX(-90deg) translateZ(${h}px)`,
  5: (h) => `rotateY(-90deg) translateZ(${h}px)`,
  6: (h) => `rotateY(180deg) translateZ(${h}px)`,
};

/** Posições dos pips em coordenadas viewBox 100×100 (cada pip é desenhado por SVG). */
const PIP_LAYOUTS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [
    [27, 27],
    [73, 73],
  ],
  3: [
    [24, 24],
    [50, 50],
    [76, 76],
  ],
  4: [
    [27, 27],
    [73, 27],
    [27, 73],
    [73, 73],
  ],
  5: [
    [27, 27],
    [73, 27],
    [50, 50],
    [27, 73],
    [73, 73],
  ],
  6: [
    [27, 25],
    [73, 25],
    [27, 50],
    [73, 50],
    [27, 75],
    [73, 75],
  ],
};

function DiceFaceSvg({ value }: { value: number }) {
  const pips = PIP_LAYOUTS[value] || PIP_LAYOUTS[1];
  return (
    <svg viewBox="0 0 100 100" width="78%" height="78%" style={{ display: "block" }}>
      {pips.map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r={9} className="nanter-dice-pip" />
      ))}
    </svg>
  );
}

export function Dice({ value, isRolling, size = 64, onRollComplete, theme = "gold" }: DiceProps) {
  const [rot, setRot] = useState<[number, number]>(SHOW_ROTATION[value] || [0, 0]);
  const tumbleRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const settleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const baseRotRef = useRef<[number, number]>([0, 0]);

  useEffect(() => {
    if (isRolling) {
      // Tumble: rotação aleatória a cada 110ms. Cada incremento é múltiplo de
      // 360 (volta inteira) para que o cubo *acabe sempre numa orientação
      // alinhada* e o assentamento final caia na face correcta.
      const tumble = () => {
        const rx = baseRotRef.current[0] + 360 + (1 + Math.floor(Math.random() * 2)) * 360;
        const ry = baseRotRef.current[1] + 360 + (1 + Math.floor(Math.random() * 2)) * 360;
        baseRotRef.current = [rx, ry];
        setRot([rx, ry]);
      };
      tumble();
      tumbleRef.current = setInterval(tumble, 550);
    } else {
      // Pára: assenta na face do `value`. Garantimos que partimos de um
      // múltiplo exacto de 360 (orientação neutra) e somamos a rotação
      // específica da face — assim o que o utilizador vê bate sempre com `value`.
      if (tumbleRef.current) {
        clearInterval(tumbleRef.current);
        tumbleRef.current = null;
      }
      const [tx, ty] = SHOW_ROTATION[value] || [0, 0];
      // Próximo múltiplo de 360 acima do valor actual, + 1 volta extra de drama
      const ceilTo360 = (n: number) => Math.ceil(n / 360) * 360;
      const finalX = ceilTo360(baseRotRef.current[0]) + 360 + tx;
      const finalY = ceilTo360(baseRotRef.current[1]) + 360 + ty;
      baseRotRef.current = [finalX, finalY];
      setRot([finalX, finalY]);
      settleRef.current = setTimeout(() => {
        onRollComplete?.();
      }, 1500);
    }
    return () => {
      if (tumbleRef.current) clearInterval(tumbleRef.current);
      if (settleRef.current) clearTimeout(settleRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRolling, value]);

  const half = size / 2;

  return (
    <div className="nanter-dice-scene" style={{ width: size, height: size, position: "relative" }}>
      <div
        className={`nanter-dice ${isRolling ? "is-rolling" : ""} theme-${theme}`}
        style={{
          width: size,
          height: size,
          transform: `rotateX(${rot[0]}deg) rotateY(${rot[1]}deg)`,
        }}
      >
        {([1, 2, 3, 4, 5, 6] as const).map((face) => (
          <div
            key={face}
            className="nanter-dice-face"
            style={{ transform: FACE_TRANSFORM[face](half) }}
          >
            <DiceFaceSvg value={face} />
          </div>
        ))}
      </div>
      <div className="nanter-dice-shadow" aria-hidden />
    </div>
  );
}
