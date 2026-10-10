// Připojuje plánovač shardů (indexModel.createShardPoller) k Reactu: jeden
// objekt pro celou stránku místo jednoho useLiveResults na shard — shardů je
// až 18, připojují se líně podle viditelných řádků a po odpojení si pamatují
// poslední souhrny. `featured` = „největší města" (vždy), `mineShard` = shard
// Moje obce, `allIds` = „Jen sečtené" (všechny kraje jednou, pak co 3 min).
import { useEffect, useMemo, useState } from 'react';
import { createShardPoller } from '../indexModel.js';
import { ShardsContext, createRowWatcher } from './useRowVisibility.js';

export default function ShardSubscriber({ shards, version, fetchImpl, featured, mineShard, allIds, children }) {
    const [poller] = useState(() => createShardPoller({ shards, version, fetchImpl }));
    const [watcher] = useState(() => createRowWatcher(poller));
    const value = useMemo(() => ({ poller, watch: watcher.watch }), [poller, watcher]);

    useEffect(() => {
        poller.connect();
        const onVisibility = () => poller.pageVisibilityChanged();
        const onOnline = () => poller.online();
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('online', onOnline);
        return () => {
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('online', onOnline);
            poller.disconnect();
        };
    }, [poller]);
    useEffect(() => { poller.setFeatured(featured); }, [poller, featured]);
    useEffect(() => { poller.setMine(mineShard); }, [poller, mineShard]);
    useEffect(() => { poller.setAll(allIds); }, [poller, allIds]);

    return <ShardsContext value={value}>{children}</ShardsContext>;
}
