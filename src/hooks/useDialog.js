import { useEffect, useRef } from 'react';

// Společné chování překryvných oken (menu, Co je nové, nahlášení chyby):
// Esc zavře, stránka pod oknem se neroluje, fokus skočí do okna a po
// zavření se vrátí tam, kde byl. Vrací ref pro kontejner okna
// (potřebuje tabIndex={-1}, aby šel zaměřit).
export function useDialog(open, onClose) {
    const ref = useRef(null);
    const closeRef = useRef(onClose);
    useEffect(() => {
        closeRef.current = onClose;
    }, [onClose]);

    // Tlačítko Zpět (hlavně na telefonu) zavře okno a nevyhodí návštěvníka ze stránky:
    // otevřené okno má vlastní záznam v historii, zavření křížkem/Esc ho zase odebere
    useEffect(() => {
        if (!open) return undefined;
        const id = `dlg${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
        let closedByBack = false;
        history.pushState({ dlg: id }, '');
        const onPop = () => {
            closedByBack = true;
            closeRef.current?.();
        };
        window.addEventListener('popstate', onPop);
        return () => {
            window.removeEventListener('popstate', onPop);
            if (!closedByBack && history.state?.dlg === id) history.back();
        };
    }, [open]);

    useEffect(() => {
        if (!open) return undefined;
        const previous = document.activeElement;
        ref.current?.focus({ preventScroll: true });
        const onKey = (e) => {
            if (e.key === 'Escape') closeRef.current?.();
        };
        window.addEventListener('keydown', onKey);
        const html = document.documentElement;
        const overflow = html.style.overflow;
        html.style.overflow = 'hidden';
        return () => {
            window.removeEventListener('keydown', onKey);
            html.style.overflow = overflow;
            if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
        };
    }, [open]);

    return ref;
}
