// Čisté části cron warm-upu (bez importu cloudflare:workers, aby šly testovat).
import { councilByZastup } from '../src/councils.js';

// Klíč feedu (kód zastupitelstva nebo 'prehled') → handler, normalizovaná
// cesta (klíč cache) a jméno Durable Objectu
export function feedTarget(key) {
    if (key === 'prehled') return { name: 'prehled', path: '/api/prehled', doName: 'prehled' };
    const council = councilByZastup(key);
    if (!council) throw new Error(`unknown feed key: ${key}`);
    const path = `/api/volby?z=${council.zastup}`;
    return { name: 'volby', path, doName: path.slice(5) };
}

const reasonOf = (error) => String(error?.message || error);

// Zavolá callFn(key) pro každý klíč, nejvýše `concurrency` souběžně; každé
// volání má limit `timeoutMs`. Nikdy nevyhodí — selhání jen zaloguje.
export async function runWarmup(keys, callFn, { concurrency = 4, timeoutMs = 15000, log = console.log, warn = console.warn } = {}) {
    const queue = [...keys];
    const one = async (key) => {
        let timer;
        try {
            const timeout = new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
            });
            const out = await Promise.race([callFn(key), timeout]);
            if (out?.status === 200) log('warmup-ok', key, out.status);
            else warn('warmup-failed', key, `status ${out?.status}`);
        } catch (error) {
            warn('warmup-failed', key, reasonOf(error));
        } finally {
            clearTimeout(timer);
        }
    };
    const worker = async () => {
        while (queue.length) await one(queue.shift());
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
}
