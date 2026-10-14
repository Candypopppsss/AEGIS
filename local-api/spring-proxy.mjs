const MAX_BODY_BYTES = 16384;

export function createSpringProxy(origin, { fetchImpl = fetch } = {}) {
  const upstream = new URL(origin);
  if (upstream.protocol !== 'https:' || upstream.username || upstream.password ||
      upstream.pathname !== '/' || upstream.search || upstream.hash) {
    throw new Error('SPRING_API_URL must be an HTTPS origin without credentials or a path.');
  }
  return async (request, response) => {
    const reply = (status, message) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ message }));
    };
    const path = new URL(request.url, 'http://localhost');
    if (!path.pathname.startsWith('/api/')) return reply(404, 'Route not found.');
    const headers = {};
    for (const name of ['authorization', 'content-type', 'origin', 'accept']) {
      if (request.headers[name]) headers[name] = request.headers[name];
    }
    let body;
    if (!['GET', 'HEAD'].includes(request.method)) {
      if (request.body !== undefined) {
        body = typeof request.body === 'string' || Buffer.isBuffer(request.body)
          ? request.body : JSON.stringify(request.body);
      } else {
        const chunks = [];
        let size = 0;
        for await (const chunk of request) {
          size += Buffer.byteLength(chunk);
          if (size > MAX_BODY_BYTES) return reply(413, 'Request body is too large.');
          chunks.push(Buffer.from(chunk));
        }
        body = Buffer.concat(chunks);
      }
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) return reply(413, 'Request body is too large.');
    }
    try {
      const result = await fetchImpl(upstream.origin + path.pathname + path.search, {
        method: request.method, headers, body, redirect: 'error', signal: AbortSignal.timeout(20000),
      });
      const content = Buffer.from(await result.arrayBuffer());
      const responseHeaders = { 'Cache-Control': 'no-store' };
      for (const name of ['content-type', 'www-authenticate', 'retry-after',
        'access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers', 'vary']) {
        const value = result.headers.get(name);
        if (value) responseHeaders[name] = value;
      }
      response.writeHead(result.status, responseHeaders);
      response.end(content);
    } catch {
      reply(503, 'The account service is temporarily unavailable. Please try again shortly.');
    }
  };
}
