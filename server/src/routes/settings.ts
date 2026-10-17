import { Hono } from "hono";
import { one } from "../db.js";
import { loadGameConfig } from "../game/config.js";

/**
 * Endpoint público que devolve a configuração actual do Smart Dice
 * (gerida pelo backoffice em `game_settings.smart_dice`).
 *
 * - Sem auth — é configuração pública lida pelo cliente do jogo.
 * - Cache curto (15s) para evitar pressão na DB.
 * - Defensivo: se a tabela ou coluna não existirem ainda (backoffice
 *   não migrado), devolve os defaults sem falhar o pedido.
 */

// Defaults idênticos aos do cliente (`src/lib/smart-dice.ts`).
// Mantidos aqui para que o servidor possa responder mesmo sem DB schema.
const DEFAULT_SMART_DICE = {
  enabled: true,
  manipulationRate: 0.35,
  mercy: { enabled: true, turnsWithoutSixThreshold: 4, maxBoostPercent: 18 },
  clutch: {
    enabled: true,
    captureBoostPercent: 12,
    finishBoostPercent: 10,
    maxRange: 4,
  },
  comeback: { enabled: true, maxBoostPercent: 10 },
};

const settingsRoutes = new Hono();

// Configs antigas na BD podem ainda ter `botBias` (já sem efeito) — não sai.
function publicConfig(config: Record<string, unknown>) {
  const { botBias: _botBias, ...rest } = config;
  return rest;
}

settingsRoutes.get("/smart-dice", async (c) => {
  try {
    const row = await one<{ smart_dice: unknown }>(
      `SELECT smart_dice FROM game_settings WHERE id = 'default' LIMIT 1`,
    );
    const config =
      row?.smart_dice && typeof row.smart_dice === "object"
        ? (row.smart_dice as Record<string, unknown>)
        : DEFAULT_SMART_DICE;
    c.header("Cache-Control", "public, max-age=15");
    return c.json({ config: publicConfig(config) });
  } catch (err) {
    // Tabela/coluna ainda não existem (backoffice não migrado) — devolve defaults
    console.warn("[settings/smart-dice] fallback to defaults:", (err as Error).message);
    c.header("Cache-Control", "public, max-age=15");
    return c.json({ config: publicConfig(DEFAULT_SMART_DICE) });
  }
});

// Limites, taxa e manutenção — o lobby mostra-os ao jogador.
settingsRoutes.get("/game", async (c) => {
  const cfg = await loadGameConfig();
  c.header("Cache-Control", "public, max-age=15");
  return c.json({ config: cfg });
});

export default settingsRoutes;
