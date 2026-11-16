import net from 'node:net';

/**
 * Clients exempt from rate limiting: RATE_LIMIT_ALLOWLIST, a comma-separated list of IPs and CIDR
 * ranges ("127.0.0.1, 10.0.0.0/8"). Empty by default. It exists for load tests, which run from a
 * single address and would otherwise only measure 429s (see docs/load-testing.md). Never set it in
 * production: an exempt address can brute-force logins.
 *
 * Returns null when nothing is configured. Throws on an entry that is not an IP or a CIDR range, so a
 * typo fails at startup instead of silently exempting nothing (or everything).
 */
export function parseAllowlist(raw: string | undefined): ((ip: string) => boolean) | null {
  const entries = (raw ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
  if (entries.length === 0) return null;

  const list = new net.BlockList();
  for (const entry of entries) {
    const [address, prefix] = entry.split('/');
    const family = net.isIP(address ?? '');
    if (!address || family === 0) throw new Error(`RATE_LIMIT_ALLOWLIST: not an IP or CIDR range: "${entry}"`);
    const type = family === 4 ? 'ipv4' : 'ipv6';
    if (prefix === undefined) {
      list.addAddress(address, type);
    } else {
      const bits = Number(prefix);
      if (!/^\d+$/.test(prefix) || bits > (family === 4 ? 32 : 128)) {
        throw new Error(`RATE_LIMIT_ALLOWLIST: bad prefix length in "${entry}"`);
      }
      list.addSubnet(address, bits, type);
    }
  }

  return (ip: string) => {
    // Node reports IPv4 clients on a dual-stack socket as ::ffff:a.b.c.d.
    const plain = ip.startsWith('::ffff:') && net.isIPv4(ip.slice(7)) ? ip.slice(7) : ip;
    const family = net.isIP(plain);
    if (family === 0) return false;
    return list.check(plain, family === 4 ? 'ipv4' : 'ipv6');
  };
}
