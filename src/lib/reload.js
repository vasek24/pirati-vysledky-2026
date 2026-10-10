// Smí se stránka po nasazení nové verze sama obnovit? Ve volební noci nikdy
// viditelná záložka (zmizela by divákovi obrazovka s výsledky); skrytá ano.
export const shouldAutoReload = ({ hidden, electionNight }) => !electionNight || hidden;
