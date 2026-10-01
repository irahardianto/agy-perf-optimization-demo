import http from 'node:http';

/**
 * Sends one HTTP request and resolves with the status code once the full response has arrived.
 * @param {{ port: number, method: string, path: string, headers?: Record<string, string>, body?: string, agent?: http.Agent, timeoutMs?: number }} options
 * @returns {Promise<number>}
 */
export function send({ port, method, path, headers = {}, body, agent, timeoutMs = 30_000 }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers, agent, timeout: timeoutMs }, (res) => {
      res.on('error', reject);
      res.on('end', () => resolve(res.statusCode ?? 0));
      res.resume();
    });
    req.on('timeout', () => req.destroy(new Error(`request timed out after ${timeoutMs} ms`)));
    req.on('error', reject);
    req.end(body);
  });
}

/**
 * Sends one HTTP request and parses the JSON response.
 * @returns {Promise<{ status: number, body: any }>}
 */
export function requestJson({ port, method, path, headers = {}, body, timeoutMs = 30_000 }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers, timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try {
          resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : null });
        } catch {
          reject(new Error(`${method} ${path}: response is not JSON (status ${res.statusCode})`));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error(`request timed out after ${timeoutMs} ms`)));
    req.on('error', reject);
    req.end(body);
  });
}
