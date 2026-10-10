// Styly indexu přesně podle ověřeného prototypu (docs/analysis/mesta-index-prototype):
// pevné výšky (řádek 72 px, hlavička kraje 58 px, hledání 64 px) drží CLS na nule
// a cíle ≥ 44 px. Třídy mají předponu `mi-`, aby se nepotkaly s Tailwindem
// ani s ostatními stránkami; proměnné žijí na kořenu `.mi-root`.
const CSS = String.raw`
.mi-root{--y:#fec900;--bg:#f3f3f1;--ink:#171717;--mute:#5f5f5b;--line:#e2e2de;--card:#fff;--or:#b45309;--gr:#047857;--red:#dc2626;--sb:64px;
  --disp:"Bebas Neue","Bebas Neue Pro","Roboto Condensed","Arial Narrow","Liberation Sans Narrow",sans-serif-condensed,Impact,sans-serif;
  --sans:Roboto,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
.mi-root :focus-visible{outline:2px solid #000;outline-offset:3px;box-shadow:0 0 0 3px var(--y)}
.mi-sr{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
html:has(.mi-root){scroll-padding-top:128px;-webkit-text-size-adjust:100%}
/* hlavička */
.mi-hero{background:#000;color:#fff}
.mi-hero-in{max-width:1240px;margin:0 auto;padding:0 16px 14px}
.mi-back{display:flex;align-items:center;min-height:44px;font-size:13px;font-weight:500;color:rgba(255,255,255,.85);text-decoration:underline;text-underline-offset:3px}
.mi-hero-top{display:flex;align-items:center;gap:12px;min-height:32px}
.mi-hero-top svg{height:26px;width:auto;display:block}
.mi-pill{margin-left:auto;display:inline-flex;align-items:center;gap:6px;font:700 11px/1 var(--sans);letter-spacing:.06em;padding:6px 8px;border-radius:6px;background:rgba(255,255,255,.16);color:#fff;white-space:nowrap}
.mi-pill.mi-live{background:var(--red)}
.mi-pill.mi-live::before{content:"";width:6px;height:6px;border-radius:50%;background:#fff}
.mi-h1{font:400 36px/.9 var(--disp);text-transform:uppercase;letter-spacing:.02em;margin:10px 0 4px}
.mi-h1 span{color:var(--y)}
.mi-hero p{margin:0;font-size:12.5px;color:rgba(255,255,255,.75);min-height:17px}
/* rozložení */
.mi-side{display:contents}
.mi-side>.mi-sec{padding:0 16px;max-width:720px;margin-left:auto;margin-right:auto}
.mi-main{padding:0 16px 40px;max-width:720px;margin:0 auto}
/* lepivé hledání */
.mi-sbar{position:sticky;top:0;z-index:30;background:#000;padding:8px 16px 10px}
.mi-sbar>*{max-width:688px;margin-left:auto;margin-right:auto}
.mi-combo{position:relative}
.mi-inp{display:block;width:100%;height:46px;border-radius:12px;border:2px solid #fff;background:#fff;padding:0 46px 0 40px;font:16px var(--sans);color:var(--ink);-webkit-appearance:none;appearance:none}
.mi-inp:focus{outline:none;border-color:var(--y);box-shadow:0 0 0 2px var(--y)}
.mi-inp::placeholder{color:#76766f}
.mi-combo .mi-ico{position:absolute;left:12px;top:13px;width:20px;height:20px;pointer-events:none;color:#555}
.mi-clear{position:absolute;right:1px;top:1px;width:44px;height:44px;border:0;background:none;border-radius:10px;cursor:pointer;color:#444;font-size:22px;line-height:1}
.mi-pop{position:absolute;z-index:32;left:0;right:0;top:calc(100% + 6px);background:#fff;color:var(--ink);border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.35);max-height:calc(100vh - 150px);max-height:calc(100dvh - 150px);overflow:auto;overscroll-behavior:contain}
.mi-pop ul{list-style:none;margin:0;padding:4px 0}
.mi-opt{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:10px;align-items:center;min-height:52px;padding:6px 14px;cursor:pointer}
.mi-opt+.mi-opt{border-top:1px solid #f0f0ec}
.mi-opt[aria-selected=true]{background:#fff6d1;box-shadow:inset 4px 0 0 var(--y)}
.mi-o-name{font-weight:700;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mi-o-sub{grid-column:1;font-size:12px;color:var(--mute);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mi-o-side{grid-column:2;grid-row:1/3;font:400 22px/1 var(--disp);text-align:right;color:var(--ink)}
.mi-o-side small{display:block;font:500 11px var(--sans);color:var(--mute)}
.mi-o-kraj .mi-o-name::before{content:"▸ ";color:#b08c00}
.mi-o-other .mi-o-name{color:#444;font-weight:600}
.mi-pop-note{padding:12px 14px;font-size:13px;color:var(--mute);border-top:1px solid #f0f0ec}
.mi-pop-note b{color:var(--ink)}
.mi-info{position:absolute;top:calc(100% - 4px);left:16px;right:16px;z-index:31;margin:0 auto;max-width:688px;background:#1d1d1b;color:#fff;border-radius:10px;padding:8px 8px 8px 12px;font-size:13px;display:flex;gap:8px;align-items:center}
.mi-info a{color:var(--y)}
.mi-info button{margin-left:auto;flex:0 0 44px;height:44px;border:0;background:none;color:#fff;font-size:20px;cursor:pointer;border-radius:8px}
/* sekce */
.mi-sec{margin-top:18px}
.mi-sec-h{display:flex;align-items:baseline;gap:8px;font:400 26px/1 var(--disp);text-transform:uppercase;letter-spacing:.02em;margin:0 0 8px}
.mi-sec-h small{font:500 13px var(--sans);color:var(--mute);text-transform:none;letter-spacing:0}
.mi-list{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden}
/* řádek města */
.mi-row{position:relative;display:grid;grid-template-columns:minmax(0,1fr) 84px;grid-template-rows:24px 15px 14px 15px;column-gap:10px;align-content:center;height:72px;padding:0 14px;text-decoration:none;color:inherit;background:var(--card)}
.mi-row+.mi-row{border-top:1px solid var(--line)}
.mi-row[hidden]{display:none}
.mi-row:hover{background:#fafaf7}
.mi-row:active{background:#fff6d1}
.mi-row:focus-visible{outline:3px solid #000;outline-offset:-3px;box-shadow:inset 0 0 0 3px var(--y)}
.mi-r-name{font:400 23px/24px var(--disp);text-transform:uppercase;letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mi-r-val{font:400 24px/24px var(--disp);text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.mi-r-meta{font-size:12px;line-height:15px;color:var(--mute);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mi-r-seats{font-size:12px;line-height:15px;text-align:right;color:var(--mute);white-space:nowrap}
.mi-r-prog{display:flex;align-items:center;min-width:0;font-size:11.5px;line-height:14px;color:var(--mute);white-space:nowrap}
.mi-r-txt{overflow:hidden;text-overflow:ellipsis}
.mi-bar{flex:0 0 48px;height:4px;border-radius:2px;background:#e6e6e1;overflow:hidden;margin-right:8px}
.mi-bar i{display:block;height:100%;width:0;background:var(--y)}
.mi-r-base{grid-column:1/-1;font-size:11px;line-height:15px;color:var(--mute);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.mi-r-time{font-size:11.5px;line-height:14px;text-align:right;color:var(--mute);font-variant-numeric:tabular-nums;white-space:nowrap}
.mi-badge{display:inline-block;font:700 10px/1 var(--sans);letter-spacing:.05em;text-transform:uppercase;padding:3px 5px;border-radius:4px;margin-right:6px;vertical-align:1px;font-style:normal}
.mi-b-party{background:#000;color:var(--y)}.mi-b-coalition{background:#ffe680;color:#000}.mi-b-association,.mi-b-other{background:#e6e6e1;color:#222}
.mi-is-fin .mi-r-seats{color:var(--ink);font-weight:700}
.mi-is-fin .mi-r-txt{color:var(--gr);font-weight:700}
.mi-is-stale .mi-r-time{color:var(--or);font-weight:700}
.mi-is-err .mi-r-val,.mi-is-err .mi-r-txt{color:var(--or)}
.mi-is-skel .mi-r-val b,.mi-is-skel .mi-r-time span{display:inline-block;width:58px;height:18px;border-radius:4px;background:#ecece8;vertical-align:middle;color:transparent}
.mi-is-skel .mi-r-time span{width:40px;height:11px}
@media (prefers-reduced-motion:no-preference){.mi-is-skel .mi-r-val b,.mi-is-skel .mi-r-time span{animation:mi-pulse 1.2s ease-in-out infinite}.mi-bar i{transition:width .6s}}
@keyframes mi-pulse{50%{opacity:.45}}
/* Moje obec */
.mi-mine .mi-list{border:2px solid #000}
.mi-mine-act{display:flex;gap:8px;margin-top:6px}
.mi-lnk{min-height:44px;padding:0 12px;border:0;background:none;font-weight:600;font-size:14px;text-decoration:underline;text-underline-offset:3px;cursor:pointer;border-radius:8px}
.mi-lnk:hover{background:#e9e9e4}
/* čipy */
.mi-chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 10px}
.mi-chip{min-height:44px;padding:0 14px;border-radius:999px;border:1px solid #c9c9c3;background:#fff;font:600 14px var(--sans);cursor:pointer;white-space:nowrap}
.mi-chip[aria-pressed=true]{background:#000;color:#fff;border-color:#000}
.mi-chip.mi-tog[aria-pressed=true]{background:var(--y);color:#000;border-color:#c9a200}
.mi-chip.mi-tog[aria-pressed=true]::before{content:"✓ "}
.mi-newbar{display:flex;align-items:center;min-height:44px;margin:0 0 10px;font-size:13px;color:var(--mute)}
.mi-newbar button{min-height:44px;border:2px solid #000;background:var(--y);border-radius:10px;padding:0 12px;font-weight:700;cursor:pointer}
/* kraje */
.mi-region{margin-top:8px}
.mi-rh{margin:0;position:sticky;top:var(--sb);z-index:10}
.mi-rh button{display:grid;grid-template-columns:minmax(0,1fr) 28px;width:100%;min-height:58px;padding:8px 10px 8px 14px;text-align:left;background:#fff;border:1px solid var(--line);border-radius:14px;cursor:pointer;align-content:center}
.mi-rh button[aria-expanded=true]{background:#000;color:#fff;border-color:#000;border-radius:14px 14px 0 0}
.mi-rh-name{font:400 23px/1 var(--disp);text-transform:uppercase;letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mi-rh-sub{grid-column:1;font-size:12.5px;line-height:17px;height:17px;margin-top:3px;color:var(--mute);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mi-rh button[aria-expanded=true] .mi-rh-sub{color:rgba(255,255,255,.78)}
.mi-rh-sub.mi-err{color:var(--or)!important;font-weight:700}
.mi-rh button[aria-expanded=true] .mi-rh-sub.mi-err{color:#ffb366!important}
.mi-chev{grid-column:2;grid-row:1/3;align-self:center;justify-self:center;width:10px;height:10px;border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(45deg);margin-top:-4px}
[aria-expanded=true] .mi-chev{transform:rotate(-135deg);margin-top:4px}
.mi-rl{border-radius:0 0 14px 14px;border-top:0}
.mi-empty{padding:14px;font-size:13px;color:var(--mute)}
.mi-regnav{display:none}
.mi-foot{margin-top:28px;font-size:12px;color:var(--mute);line-height:1.5}
.mi-foot a{text-underline-offset:3px;display:inline-block;padding:15px 4px;margin:-15px -4px}
@media (min-width:600px){.mi-h1{font-size:52px}}
@media (min-width:700px){
  .mi-g2{display:grid;grid-template-columns:1fr 1fr}
  .mi-g2 .mi-row+.mi-row{border-top:0}
  .mi-g2 .mi-row{border-bottom:1px solid var(--line)}
  .mi-g2 .mi-row:nth-child(odd){border-right:1px solid var(--line)}
}
/* desktop: postranní panel s hledáním, Moje obec a skokem na kraje; řádky ve dvou sloupcích */
@media (min-width:1024px){
  .mi-layout{max-width:1240px;margin:0 auto;display:grid;grid-template-columns:320px minmax(0,1fr);gap:28px;padding:0 24px}
  .mi-side{display:block;position:sticky;top:0;align-self:start;max-height:100vh;overflow:auto;padding:16px 4px 24px 0}
  .mi-sbar{position:static;background:none;padding:0}
  .mi-info{position:static;margin:8px 0 0;max-width:none}
  .mi-inp{border-color:#000}
  .mi-side>.mi-sec{padding:0}
  .mi-main{padding:0 0 48px;max-width:none;margin:0}
  .mi-rh{top:0}
  .mi-regnav{display:block;margin-top:20px}
  .mi-regnav h2{font:400 22px/1 var(--disp);text-transform:uppercase;margin:0 0 6px}
  .mi-regnav ul{list-style:none;margin:0;padding:0}
  .mi-regnav a{display:flex;justify-content:space-between;align-items:center;min-height:36px;padding:0 10px;border-radius:8px;text-decoration:none;font-size:14px}
  .mi-regnav a:hover{background:#e9e9e4}
  .mi-regnav a span{color:var(--mute);font-variant-numeric:tabular-nums}
  html:has(.mi-root){scroll-padding-top:72px}
}

.mi-root{min-height:100dvh;background:var(--bg);color:var(--ink);font:15px/1.35 var(--sans)}
.mi-root a{color:inherit}
.mi-root button{font:inherit;color:inherit}
.mi-hero p{margin:0}
.mi-toast{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:50;max-width:calc(100vw - 32px);width:max-content;background:#000;color:#fff;border:2px solid var(--y);border-radius:12px;padding:10px 14px;font-size:14px;box-shadow:0 8px 24px rgba(0,0,0,.3)}
.mi-r-val b{font-weight:400}
.mi-r-meta .mi-r-list{vertical-align:baseline}
`;

export default function IndexStyles() {
    return <style>{CSS}</style>;
}
