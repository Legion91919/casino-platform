// Public URL of each local service: localhost on a laptop, the forwarded https URL in Codespaces.
export const PORTS = { lobby: 7100, dealer: 7101, cashier: 7102, catwalk: 7401 } as const;

/** The studio games on the floor, each its own game server and database (all built on Kiln). */
export const GAMES = [
  { code: "ember-anvil", folder: "ember-anvil", title: "Ember Anvil", port: 7301, db: "ember_anvil", blurb: "Five reels of forge and fire. Embers are wild, crucibles pay anywhere." },
  { code: "rps-land", folder: "rock-paper-scissors", title: "Land of Rock Paper Scissors", port: 7302, db: "rps_land", blurb: "Paper wraps rock, scissors cut paper, rock smashes scissors: sticky wilds, free respins, multipliers." },
] as const;

export function publicUrl(port: number, env = process.env): string {
  if (env.CODESPACE_NAME && env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN) {
    return `https://${env.CODESPACE_NAME}-${port}.${env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`;
  }
  return `http://localhost:${port}`;
}
export const internalUrl = (port: number) => `http://localhost:${port}`;
