# Assets — Ludo

> Preenche os URLs antes de pedir ao Claude Code para descarregar.
> Apenas URLs públicos diretos (sem login).

---

## Sons (.mp3)

> **Onde:** https://pixabay.com/sound-effects/ ou https://mixkit.co/free-sound-effects/

| Ficheiro | URL | Pesquisa |
|----------|-----|----------|
| `dice-roll.mp3` | `<COLAR>` | "dice roll" |
| `piece-move.mp3` | `<COLAR>` | "click pop" |
| `piece-capture.mp3` | `<COLAR>` | "pop game" |
| `victory.mp3` | `<COLAR>` | "victory fanfare" |
| `button-click.mp3` | `<COLAR>` | "ui click" |
| `chat-message.mp3` | `<COLAR>` | "message notification" |
| `gift-received.mp3` | `<COLAR>` | "reward chime" |
| `timer-tick.mp3` | `<COLAR>` | "clock tick" |

**Pasta destino:** `public/sounds/`

---

## Animações Lottie (.json)

> **Onde:** https://lottiefiles.com → animação → "Lottie Animation URL"

| Ficheiro | URL | Pesquisa |
|----------|-----|----------|
| `victory.json` | `<COLAR>` | "trophy celebration" |
| `confetti.json` | `<COLAR>` | "confetti burst" |

**Pasta destino:** `public/animations/`

---

## Prompt para Claude Code

```
Lê ./assets.md e descarrega todos os assets com URL preenchido.

1. Cria public/sounds/ e public/animations/
2. Para cada URL preenchido, descarrega com curl
3. Verifica que cada ficheiro tem tamanho > 0 e não é HTML de erro
4. Cria src/assets/registry.ts:
   export const SOUNDS = { diceRoll: "/sounds/dice-roll.mp3", ... }
   export const ANIMATIONS = { victory: "/animations/victory.json", ... }
5. Reporta sucessos e falhas

Não inventar URLs. Não descarregar entradas sem URL.
```
