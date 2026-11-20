// Decides what to do with each incoming event. Nothing reaches a player's history unless the
// studio's signature verifies with a key that studio registered at Dealer.
import { unsignedPart, verifyCanonical, type Envelope } from "@casino-platform/studio-sdk";
import { InvalidEvent, parseBetSettled, parseRoundOutcome } from "../domain/events.ts";
import type { IngestAction, KeyDirectory } from "./ports.ts";

export async function decide(event: Envelope, keys: KeyDirectory): Promise<IngestAction> {
  try {
    if (event.eventType === "RoundOutcomeRecorded") {
      const round = parseRoundOutcome(event);
      const ring = await keys.studioKeys(round.studioCode, round.signature.keyId);
      if (!verifyCanonical(unsignedPart(round), round.signature, ring)) {
        return { kind: "quarantine", reason: `signature does not verify with ${round.studioCode}'s registered keys (keyId ${round.signature.keyId})` };
      }
      return { kind: "round", round, operatorCode: event.operatorCode!, eventId: event.eventId };
    }
    if (event.eventType === "BetSettled") return { kind: "settlement", settlement: parseBetSettled(event), eventId: event.eventId };
    return { kind: "ignore" }; // e.g. BetPlaced: other consumers need it, Catwalk does not
  } catch (e) {
    if (e instanceof InvalidEvent) return { kind: "quarantine", reason: e.message };
    throw e; // infrastructure trouble (Dealer unreachable): retry the page later, don't quarantine
  }
}
