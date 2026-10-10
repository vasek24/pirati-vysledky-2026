import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8')

// Chování ověřeno ručně v prohlížeči (Zpět zavře menu); tady hlídáme, že kód nezmizí
describe('Zpět v překryvných oknech a po nasazení', () => {
    it('useDialog dává otevřenému oknu záznam v historii a zavírá ho na popstate', () => {
        const code = read('./hooks/useDialog.js')
        expect(code).toContain('history.pushState')
        expect(code).toContain("addEventListener('popstate'")
        expect(code).toContain('history.back()')
    })
    it('vstup stránky je obalený ReloadOnStale', () => {
        expect(read('./main.jsx')).toContain('<ReloadOnStale>')
        expect(read('./components/ReloadOnStale.jsx')).toContain('window.location.reload()')
    })
})
