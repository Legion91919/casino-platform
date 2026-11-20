// Polls producers' outbox feeds (suite ADR-0003) and applies each event exactly once.
import type { Envelope, FeedPage } from "@casino-platform/studio-sdk";
import { decide } from "./ingest.ts";
import type { HistoryStore, KeyDirectory } from "./ports.ts";

export interface Feed { name: string; url: string; token: string }

export async function pollOnce(feed: Feed, store: HistoryStore, keys: KeyDirectory, limit = 200): Promise<{ applied: number; duplicates: number }> {
  const after = await store.checkpoint(feed.name);
  const u = new URL(feed.url);
  if (after) u.searchParams.set("after", after);
  u.searchParams.set("limit", String(limit));
  const res = await fetch(u, { headers: { authorization: `Bearer ${feed.token}` }, signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`${feed.name} feed answered ${res.status}`);
  const page = (await res.json()) as FeedPage;
  let applied = 0, duplicates = 0;
  for (const [i, event] of page.events.entries()) {
    const action = await decide(event as Envelope, keys);
    // The cursor only moves to `next` after the page's last event; until then we cannot address the
    // middle of a page, so a crash mid-page re-reads it and the inbox absorbs the repeats.
    const cursor = i === page.events.length - 1 ? page.next : after ?? "";
    (await store.process(feed.name, event as Envelope, action, cursor)) === "applied" ? applied++ : duplicates++;
  }
  return { applied, duplicates };
}

export function startPolling(feeds: Feed[], store: HistoryStore, keys: KeyDirectory, everyMs = 500, log = console.error) {
  let stopped = false;
  const loop = async (f: Feed) => {
    while (!stopped) {
      try {
        const r = await pollOnce(f, store, keys);
        if (r.applied === 0) await new Promise((ok) => setTimeout(ok, everyMs));
      } catch (e) {
        log(`feed ${f.name}: ${(e as Error).message}`);
        await new Promise((ok) => setTimeout(ok, everyMs * 4));
      }
    }
  };
  feeds.forEach((f) => void loop(f));
  return () => { stopped = true; };
}
