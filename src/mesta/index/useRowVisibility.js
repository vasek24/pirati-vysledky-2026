// Sdílený kontext shardů a viditelnost řádků: jeden IntersectionObserver pro
// všechny řádky, který plánovači (indexModel.createShardPoller) říká, který
// řádek je vidět — odtud 400 ms dwell a 3 s odklad. Žádný rootMargin: dotaz
// jen na to, co člověk skutečně vidí (jako ověřený prototyp).
import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';

export const ShardsContext = createContext(null);

export function useShardPoller() {
    return useContext(ShardsContext).poller;
}

// Aktuální stav všech shardů (nový objekt při každé změně)
export function useShardSnapshot() {
    const { poller } = useContext(ShardsContext);
    return useSyncExternalStore(poller.subscribe, poller.getSnapshot, poller.getSnapshot);
}

export function createRowWatcher(poller) {
    let io = null;
    let seq = 0;
    const rows = new Map(); // element -> { shardId, key }
    const ensure = () => {
        if (!io && typeof IntersectionObserver !== 'undefined') {
            io = new IntersectionObserver((entries) => {
                for (const e of entries) {
                    const r = rows.get(e.target);
                    if (r) poller.setRowVisible(r.shardId, r.key, e.isIntersecting);
                }
            });
        }
        return io;
    };
    // → funkce, která řádek přestane sledovat (cleanup ref callbacku)
    const watch = (el, shardId) => {
        seq += 1;
        const key = seq;
        const observer = ensure();
        if (!observer) {
            // starý prohlížeč bez IntersectionObserveru: řádek se bere jako viditelný
            poller.setRowVisible(shardId, key, true);
            return () => poller.setRowVisible(shardId, key, false);
        }
        rows.set(el, { shardId, key });
        observer.observe(el);
        return () => {
            observer.unobserve(el);
            rows.delete(el);
            poller.setRowVisible(shardId, key, false);
        };
    };
    return { watch };
}

// ref callback řádku; bez shardId (připojený napevno, např. „největší města") nic nesleduje
export function useRowRef(shardId) {
    const { watch } = useContext(ShardsContext);
    return useCallback((el) => (el && shardId ? watch(el, shardId) : undefined), [watch, shardId]);
}

const subscribeQuery = (query) => (cb) => {
    const mq = window.matchMedia(query);
    mq.addEventListener('change', cb);
    return () => mq.removeEventListener('change', cb);
};

export function useMediaQuery(query) {
    return useSyncExternalStore(
        subscribeQuery(query),
        () => window.matchMedia(query).matches,
        () => false,
    );
}
