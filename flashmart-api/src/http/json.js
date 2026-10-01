/** Error that maps directly onto an HTTP response. */
export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} code machine-readable error code
   * @param {string} message human-readable message
   * @param {unknown} [details]
   */
  constructor(status, code, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Reads and parses a JSON request body, enforcing a size limit.
 * @param {import('node:http').IncomingMessage} req
 * @param {number} maxBytes
 */
export async function readJsonBody(req, maxBytes) {
  const contentType = req.headers['content-type'] ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'unsupported_media_type', 'Expected Content-Type: application/json');
  }
  const chunks = [];
  let received = 0;
  for await (const chunk of req) {
    received += chunk.length;
    if (received > maxBytes) {
      throw new HttpError(413, 'payload_too_large', `Request body exceeds ${maxBytes} bytes`);
    }
    chunks.push(chunk);
  }
  if (received === 0) {
    throw new HttpError(400, 'invalid_json', 'Request body is empty');
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body is not valid JSON');
  }
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 * @param {Record<string, string>} [headers]
 */
export function sendJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}
