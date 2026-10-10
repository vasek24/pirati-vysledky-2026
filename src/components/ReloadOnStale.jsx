import { Component } from 'react';

// Stránka načtená před nasazením může chtít skripty, které už neexistují (hashované soubory).
// Místo prázdné stránky se jednou sama načte znovu; podruhé (do minuty) ukáže odkaz.
const KEY = 'kv26_stale_reload';

export default class ReloadOnStale extends Component {
    state = { failed: false };

    static getDerivedStateFromError() {
        return { failed: true };
    }

    componentDidCatch() {
        try {
            const last = Number(sessionStorage.getItem(KEY) || 0);
            if (Date.now() - last > 60_000) {
                sessionStorage.setItem(KEY, String(Date.now()));
                window.location.reload();
            }
        } catch {
            /* bez sessionStorage zůstane odkaz níže */
        }
    }

    render() {
        if (!this.state.failed) return this.props.children;
        return (
            <div className="min-h-dvh bg-black p-6 text-white">
                <p>Stránku se nepodařilo načíst.</p>
                <p className="mt-3"><a className="underline" href={window.location.pathname}>Načíst znovu</a></p>
            </div>
        );
    }
}
