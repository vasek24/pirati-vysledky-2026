// Jen pro testy: vitest (konfigurace cloudflare-senat) transformuje JSX klasicky, bez
// automatického runtime jako vite build — proto globální React. Importovat jako první.
import React from 'react'

globalThis.React = React
