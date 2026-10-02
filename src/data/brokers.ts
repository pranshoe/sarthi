import directory from "./brokerDirectory.json";

export interface BrokerContact {
  id: string;
  email: string;
  role: string;
  source: string;
  sourceUrl: string;
  lastVerified: string;
}

interface DirectoryShape {
  brokers: Array<{
    id: string;
    names: string[];
    email: string;
    role: string;
    source: string;
    sourceUrl: string;
    lastVerified: string;
  }>;
}

const DIR = directory as DirectoryShape;

/**
 * Find a verified grievance email for the entity the user named.
 * Returns null when the broker is not listed OR has no verified address.
 * Callers must leave "to" empty in that case and say so plainly.
 * Nothing here ever invents an address.
 */
export function findBrokerContact(entityName: string | null | undefined): BrokerContact | null {
  if (!entityName) return null;
  const needle = entityName.toLowerCase().trim();
  if (!needle) return null;

  for (const b of DIR.brokers) {
    if (!b.email) continue; // unverified entries are never used
    for (const name of b.names) {
      const n = name.toLowerCase();
      if (needle.includes(n) || n.includes(needle)) {
        return {
          id: b.id,
          email: b.email,
          role: b.role,
          source: b.source,
          sourceUrl: b.sourceUrl,
          lastVerified: b.lastVerified,
        };
      }
    }
  }
  return null;
}
