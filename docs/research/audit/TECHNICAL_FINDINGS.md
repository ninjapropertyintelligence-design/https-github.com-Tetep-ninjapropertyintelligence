# Technical findings and evidence limits

Updated 2026-10-20. This is an audit of the authorized browser-visible application, not private backend source.

| Finding | Classification | Basis and limit |
| --- | --- | --- |
| Authenticated Chrome UI/DOM inspection works in the user's chosen profile | Verified runtime capability | [E-NET-00](evidence/OBSERVATIONS.md). No other Chrome profile was used for target analysis. |
| The page has a `div#root`, `/runtime-config.js`, and a hashed `/assets/index-*.js` script reference | Verified DOM observation | [E-TECH-01](evidence/OBSERVATIONS.md). Suggests a bundled browser app, but does **not** by itself prove React, Vite, bundler version, or backend stack. |
| The refreshed page's publicly retrievable 5.6 MB JS bundle contains literal `/api/v2/...` request-construction strings | Verified static code observation, **not runtime traffic** | [E-JS-01](evidence/OBSERVATIONS.md), [bounded candidate list](evidence/STATIC_BUNDLE_API_CANDIDATES.md). The code was not executed. |
| REA attempted static analysis but exhausted its default worker heap before parsing the minified bundle | Verified analysis limitation | Retained parent Evidence `ev_6430112e4adad7e455d0731e8b6d62bc26452ea2820bba86c47976eec6c3947d`; zero parsed JavaScript files. The candidate route list is from a separate literal-text scan, not REA semantic output. |
| `/krpano/krpano.js` and analytics/Tag Manager/LinkedIn Insight scripts are referenced | Verified DOM observation | [E-TECH-01](evidence/OBSERVATIONS.md). Reference is not proof of execution or transmitted data. |
| Matterport, Potree, Autodesk, and S3-hosted media appear as distinct browser display origins | Verified runtime observation | [E-DT-02–04, E-STORAGE-01](evidence/OBSERVATIONS.md). Backend integrations unknown. |
| REA MCP is connected but its browser recorder is not attached to this Chrome-extension tab | Verified tooling limit | [E-NET-00](evidence/OBSERVATIONS.md); REA requires loopback CDP for browser capture. No REA network Evidence ID exists for the target. |
| Request/response schemas, backend services, database engine, auth implementation | Unknown | No suitable source, API specification, or sanitized network capture supplied. See [API_OBSERVATIONS.md](API_OBSERVATIONS.md). |

Do not mistake [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md), which is an independent-app proposal, for findings about IDS. The frontend bundle was scanned for literal request construction but **not** successfully decompiled or semantically analyzed by REA. A script filename or literal path alone cannot establish runtime behavior.
