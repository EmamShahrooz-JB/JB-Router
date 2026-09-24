try {
  // workerd polyfill: make dns.setServers no-op
  const dns = await import("node:dns").catch(()=>null);
  if (dns?.setServers) {
    const orig = dns.setServers;
    dns.setServers = (...a) => { try { return orig(...a); } catch {}};
  }
  const dnsPromises = await import("node:dns/promises").catch(()=>null);
  if (dnsPromises?.Resolver?.prototype?.setServers) {
    const orig2 = dnsPromises.Resolver.prototype.setServers;
    dnsPromises.Resolver.prototype.setServers = function(...a){ try{ return orig2.apply(this,a);}catch{}};
  }
} catch {}
