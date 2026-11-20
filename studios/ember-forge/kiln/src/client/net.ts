// The game client's only network partner is its own game server.
export interface Money { amountMinor: number; currency: string }
export interface WireLineWin { step?: number; line: number; symbol: string; count: number; positions: [number, number][]; win: Money }
export interface WireStep {
  step: number; stops: number[]; grid: string[][]; landed: string[][];
  held: { reel: number; row: number; symbol: string; spinsLeft: number }[];
  transforms: { kind: string; by: [number, number][]; cells: [number, number][]; into?: string; holdSpins?: number }[];
  winMultiplier: number; win: Money;
}
export interface SpinResponse {
  roundId: string; stake: Money; win: Money; balanceAfter: Money;
  outcome: { stops: number[]; grid: string[][]; lineWins: WireLineWin[]; scatter: { count: number; win: Money }; steps: WireStep[] };
}

export class GameApi {
  private session = "";
  async open(launchToken: string): Promise<{ currency: string; balance: number }> {
    const { status, json } = await this.post("/v1/sessions", { launchToken });
    if (status !== 201) throw new Error(json.detail ?? "This launch link can't be used. Launch again from the lobby.");
    this.session = json.sessionToken;
    return { currency: json.currency, balance: json.balance.amountMinor };
  }
  get ready() { return this.session !== ""; }

  /** One paid round. Retries the SAME roundId while the result waits for the wallet. */
  async spin(lineBetMinor: number, onWaiting: () => void): Promise<SpinResponse> {
    const roundId = crypto.randomUUID();
    for (let attempt = 0; ; attempt++) {
      const { status, json } = await this.post("/v1/spins", { roundId, lineBetMinor });
      if (status === 200) return json as SpinResponse;
      if (status === 503 && json.code === "ROUND_PENDING") {
        onWaiting();
        await new Promise((ok) => setTimeout(ok, Math.min(8000, 1000 * 2 ** attempt)));
        continue;
      }
      if (json.code === "SESSION_EXPIRED") this.session = "";
      throw Object.assign(new Error(MESSAGES[json.code as string] ?? json.detail ?? "Something went wrong. No stake was taken."), { code: json.code });
    }
  }

  private async post(path: string, body: unknown) {
    const res = await fetch(path, {
      method: "POST", body: JSON.stringify(body),
      headers: { "content-type": "application/json", ...(this.session ? { authorization: `Bearer ${this.session}` } : {}) },
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  }
}

const MESSAGES: Record<string, string> = {
  INSUFFICIENT_FUNDS: "Not enough balance for this bet. Lower the bet or top up in the lobby.",
  WALLET_UNAVAILABLE: "The wallet didn't answer, so no stake was taken. Try again in a moment.",
  SESSION_EXPIRED: "Your game session has ended. Relaunch the game from the lobby.",
  LIMIT_REACHED: "Play is paused on your account. The lobby has the details.",
  PLAYER_EXCLUDED: "Play is paused on your account. The lobby has the details.",
};
