import { useEffect, useState } from 'react';
import { APP_VERSION } from '../changelog';

// Periodicky kontroluje /version.json (generuje se při buildu). Když se
// nasazená verze liší od té, se kterou běží tenhle bundle, vrátí novou verzi
// — o vynucený reload se stará UpdateManager. Kontrola jednou za ~5 minut
// (±20 % jitter, přepočítaný každý cyklus, ať se klienti nesešikují)
// a hned při návratu do záložky.
export function useUpdateCheck({ intervalMs = 5 * 60e3 } = {}) {
    const [newVersion, setNewVersion] = useState(null);

    useEffect(() => {
        let cancelled = false;
        let lastCheck = 0;

        const check = async () => {
            lastCheck = Date.now();
            try {
                const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
                if (!res.ok) return;
                const data = await res.json();
                if (!cancelled && data?.version && data.version !== APP_VERSION) {
                    setNewVersion(data.version);
                }
            } catch {
                // offline apod. — zkusí se při další kontrole
            }
        };

        check();
        let timer = null;
        const tick = () => {
            if (!document.hidden) check();
            timer = setTimeout(tick, intervalMs * (0.8 + Math.random() * 0.4));
        };
        timer = setTimeout(tick, intervalMs * (0.8 + Math.random() * 0.4));
        // Mobil se k appce vrací z pozadí — zkontrolovat hned (nejvýš 1× za minutu)
        const onVisible = () => {
            if (document.visibilityState === 'visible' && Date.now() - lastCheck > 60e3) check();
        };
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('focus', onVisible);

        return () => {
            cancelled = true;
            clearTimeout(timer);
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('focus', onVisible);
        };
    }, [intervalMs]);

    return newVersion;
}
