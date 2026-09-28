import "server-only";
import { GameEngine } from "@/lib/game/engine";
import { RedisRoomStore } from "@/lib/game/store";
import { getRedis } from "./redis";
import { SupabaseBankRepo } from "./bank-repo";
import { SupabaseBroadcastPublisher } from "./publisher";
import { SupabaseRecorder } from "./recorder";

let engine: GameEngine | null = null;

export function getEngine(): GameEngine {
  if (!engine) {
    engine = new GameEngine(
      new RedisRoomStore(getRedis()),
      new SupabaseBankRepo(),
      new SupabaseBroadcastPublisher(),
    );
    engine.recorder = new SupabaseRecorder();
  }
  return engine;
}
