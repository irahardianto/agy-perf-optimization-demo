/**
 * Small method + path router. Patterns support `:param` segments, e.g. `/api/products/:sku`.
 */
export function createRouter() {
  const routes = [];

  function compile(pattern) {
    const names = [];
    const source = pattern
      .split('/')
      .map((segment) => {
        if (segment.startsWith(':')) {
          names.push(segment.slice(1));
          return '([^/]+)';
        }
        return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');
    return { regex: new RegExp(`^${source}/?$`), names };
  }

  return {
    /**
     * @param {'GET'|'POST'} method
     * @param {string} pattern
     * @param {(ctx: object) => Promise<{ status: number, body: unknown }>} handler
     * @param {{ auth?: 'apiKey' | 'internal' | 'none', body?: boolean, name?: string }} [options]
     *   `body: true` parses a JSON request body before the handler runs.
     */
    add(method, pattern, handler, options = {}) {
      routes.push({
        method,
        pattern,
        handler,
        auth: options.auth ?? 'apiKey',
        body: options.body ?? false,
        name: options.name ?? pattern,
        ...compile(pattern),
      });
    },

    match(method, pathname) {
      let pathMatched = false;
      for (const route of routes) {
        const m = route.regex.exec(pathname);
        if (!m) continue;
        pathMatched = true;
        if (route.method !== method) continue;
        const params = {};
        route.names.forEach((name, i) => {
          params[name] = decodeURIComponent(m[i + 1]);
        });
        return { route, params };
      }
      return pathMatched ? { methodNotAllowed: true } : null;
    },
  };
}
