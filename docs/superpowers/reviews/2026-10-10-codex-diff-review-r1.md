Static review only in a read-only sandbox; I did not run tests, migrations, or the build.

### [HIGH] Deployment keeps the old application version, disabling update detection
SCOPE: in-range  
WHERE: src/changelog.js:9, src/changelog.js:11, src/changelog.js:93, src/hooks/useUpdateCheck.js:22  
WHY IT IS WRONG: The base and new revisions both identify themselves as `1.5.1`. After deployment, an existing `1.5.1` tab receives `version.json` containing `1.5.1`, so `newVersion` is never set. The election-night update button and hidden-tab reload therefore never activate, leaving existing tabs on the old client code.  
EVIDENCE: `version: '1.5.1'`, `export const APP_VERSION = CHANGELOG[0].version;`, and `data.version !== APP_VERSION` is required before `setNewVersion(...)`.

### [HIGH] Production deployment bypasses the mandatory staging and test gates
SCOPE: in-range  
WHERE: .github/workflows/deploy.yml:37  
WHY IT IS WRONG: The manual workflow installs dependencies, runs lint, and immediately invokes the production deploy command. It never runs `npm test` and never invokes the defined staging environment with `--env staging`. Its only smoke check occurs after production has already changed and is skipped entirely when `SMOKE_URL` is unset.  
EVIDENCE:
```yaml
- name: Lint
  run: npm run lint

- name: Deploy
  working-directory: cloudflare
  run: npm run deploy -- --message "$GITHUB_SHA"

- name: Smoke test
  if: ${{ vars.SMOKE_URL != '' }}
```

### [HIGH] The landing-page header omits required freshness information
SCOPE: in-range  
WHERE: src/pages/Landing.jsx:299, src/pages/Landing.jsx:309, src/pages/Landing.jsx:355, src/pages/Landing.jsx:360  
WHY IT IS WRONG: During live counting, the landing page displays only a status pill, an automatic-refresh countdown, `ČSÚ HH:MM:SS`, and the local check time. It never displays the age of the ČSÚ data or the required cadence statement. Its stale banner also omits the data age. This affects every landing-page viewer, on both mobile and desktop.  
EVIDENCE: The only data timestamp is `{phase !== 'pre' && dataTime && <span>ČSÚ {fmtTime(dataTime)}</span>}`, while the stale message is only `'Zdroj teď neodpovídá — ukazuji poslední načtená data, zkouším to znovu.'`.

### [MEDIUM] A page opened in a hidden tab still polls immediately
SCOPE: in-range  
WHERE: src/hooks/useLiveResults.js:219, src/hooks/useLiveResults.js:332  
WHY IT IS WRONG: The mount effect always schedules `runRef.current()` before merely recording that the document is hidden. `run()` itself has no visibility guard. Opening a link in a background tab therefore issues one API request despite the requirement that hidden tabs do not poll.  
EVIDENCE:
```js
timerRef.current = setTimeout(() => {
    const wait = cached && !demoFeed ? cached.nextAt - serverNow() : 0;
    if (wait > 0) schedule(wait);
    else runRef.current?.();
}, 0);
if (document.hidden) hiddenAtRef.current = Date.now();
```

### [MEDIUM] The global refresh floor delays the specified 14:00 wake
SCOPE: in-range  
WHERE: cloudflare/refresh.js:55, cloudflare/refresh.js:58, cloudflare/refresh.js:63  
WHY IT IS WRONG: A pre-election refresh within 20 seconds of poll close is scheduled after 14:00 rather than exactly at 14:00. For example, a refresh at 13:59:50 computes a 14:00 phase deadline but the outer `Math.max` changes it to 14:00:10; the client offset can delay the request further.  
EVIDENCE:
```js
const floor = refreshedAt + REFRESH.FLOOR_MS;
return Math.max(floor, byPhase(...));

case 'pre':
    return Math.min(refreshedAt + REFRESH.PRE_MS, pollsClose);
```

VERDICT: 0 CRITICAL, 3 HIGH