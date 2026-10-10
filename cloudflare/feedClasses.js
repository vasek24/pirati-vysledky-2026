// První třída (spec §3.0): Magistrát + deset největších městských částí
// a přehled. Cron je udržuje čerstvé bez jediného diváka; ostatní
// zastupitelstva se obnovují jen na požádání.
export const FIRST_CLASS_KEYS = [
    '554782', // Magistrát
    '500119', // Praha 4
    '500224', // Praha 10
    '500208', // Praha 8
    '500178', // Praha 6
    '500143', // Praha 5
    '547034', // Praha 11
    '500097', // Praha 3
    '539694', // Praha 13
    '547107', // Praha 12
    '500216', // Praha 9
    'prehled',
];

const FIRST_CLASS = new Set(FIRST_CLASS_KEYS);

export const isFirstClass = (key) => FIRST_CLASS.has(String(key));
