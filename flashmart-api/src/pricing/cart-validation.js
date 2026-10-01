import { HttpError } from '../http/json.js';

export const SUPPORTED_COUNTRIES = Object.freeze(['ID', 'SG', 'MY', 'TH', 'PH', 'VN', 'AU', 'US']);
export const MAX_ITEMS = 50;
export const MAX_QUANTITY = 20;

const CUSTOMER_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SKU = /^FM-\d{6}$/;
const POSTAL_CODE = /^[A-Za-z0-9 -]{3,10}$/;

/**
 * Validates a cart pricing request and returns a normalized copy.
 * @param {unknown} body
 * @returns {{ customerId: string, destination: { country: string, postalCode: string }, items: { sku: string, quantity: number }[] }}
 */
export function validateCartRequest(body) {
  const problems = [];
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'invalid_cart', 'Request body must be a JSON object');
  }

  const { customerId, destination, items } = /** @type {Record<string, any>} */ (body);
  if (typeof customerId !== 'string' || !CUSTOMER_ID.test(customerId)) {
    problems.push('customerId must be 1-64 characters of letters, digits, "_" or "-"');
  }
  if (destination === null || typeof destination !== 'object') {
    problems.push('destination must be an object with country and postalCode');
  } else {
    if (!SUPPORTED_COUNTRIES.includes(destination.country)) {
      problems.push(`destination.country must be one of: ${SUPPORTED_COUNTRIES.join(', ')}`);
    }
    if (typeof destination.postalCode !== 'string' || !POSTAL_CODE.test(destination.postalCode)) {
      problems.push('destination.postalCode must be 3-10 alphanumeric characters');
    }
  }

  const seen = new Set();
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) {
    problems.push(`items must be an array of 1-${MAX_ITEMS} entries`);
  } else {
    items.forEach((item, i) => {
      if (item === null || typeof item !== 'object') {
        problems.push(`items[${i}] must be an object`);
        return;
      }
      if (typeof item.sku !== 'string' || !SKU.test(item.sku)) problems.push(`items[${i}].sku must look like FM-000123`);
      else if (seen.has(item.sku)) problems.push(`items[${i}].sku ${item.sku} appears more than once`);
      else seen.add(item.sku);
      if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_QUANTITY) {
        problems.push(`items[${i}].quantity must be an integer between 1 and ${MAX_QUANTITY}`);
      }
    });
  }

  if (problems.length > 0) {
    throw new HttpError(400, 'invalid_cart', 'Cart request is invalid', problems);
  }
  return {
    customerId,
    destination: { country: destination.country, postalCode: destination.postalCode },
    items: items.map(({ sku, quantity }) => ({ sku, quantity })),
  };
}
