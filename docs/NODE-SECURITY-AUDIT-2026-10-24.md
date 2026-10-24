# Node.js security audit — 24 October 2026

Scope: accessible default branches of Pryshvitsyn repositories. Repository configuration is evidence of build intent, not evidence of the version currently deployed. No production systems, secrets, or deployments were changed.

Sources: Render email `Important advisory on recent industry security disclosures`, 23 October 2026; https://nodejs.org/en/blog/vulnerability/october-2026-security-releases ; https://render.com/docs/node-version . Security baselines: 22.23.4, 24.22.1, 26.12.1 (or later patched releases in the corresponding major).

| Repository | Evidence | Assessment |
| --- | --- | --- |
| content-factory-v2 | Main 4be55b59848566456963cbf8814ffc1f3a96cb09; CI job 119653456934, 22 October, logs `node: v22.23.3`; all setup-node declarations select major 22; no engines or runtime file | Confirmed outdated CI runtime. Production version and Render usage unknown. |
| ImpulseOff | Main 6bb532c9e8615728b016670bfdc8c7a28cbdb04f; CI pins 22.13.0; EAS profiles omit Node version | Confirmed vulnerable CI pin. Actual EAS runtime unknown. Native mobile runtime is not Node.js. |
| luxuryitaly-renovation | deploy-pages.yml selects Node 20 | Confirmed unsupported build branch. Static GitHub Pages output is not a Node server. |
| n8n | Fork version 1.86.0; docker/images/n8n-base/Dockerfile and docker/images/n8n/Dockerfile default NODE_VERSION=20; package engines >=20.15 | Confirmed unsafe default build configuration. Deployed image/version unknown. Updating this old fork requires a separate n8n migration/build compatibility check; do not blindly substitute an n8nio/base tag. |
| Del_Sole | Dockerfile FROM n8nio/n8n without tag/digest; render.yaml references Render with a template repo URL | Render configuration exists, but active deployment and image digest/Node version are unknown. package engines would not control Node inside this image. Verify the actual image before choosing a supported pinned n8n release. |
| edilemi | engines >=22.13.0; CI selects 22; wrangler.jsonc targets Cloudflare Workers with nodejs_compat | Allows old build runtimes; actual CI version unconfirmed. Workers runtime is managed separately and is not a Node.js installation. |
| tune-into-her | CI selects 22; no engines; EAS omits Node version | Build/runtime version unconfirmed; native mobile app does not run Node.js. |
| TRUTHBACK, STAY | Expo package.json without Node pin | Build Node version unknown; no evidence of a Node production server. |
| TGSIMON.COM, corrosion-pro-builder, pastamore, pastamore2 | Vite package.json without runtime constraint | Build Node version unknown. Static output alone does not imply Node hosting. @types/node is not runtime evidence. |
| luxury-test | Next.js package.json without Node constraint | Node server is possible; deployment/version unknown. |
| delsole.cc, ORIGINESIS | No runtime selectors/package.json found in tree | No demonstrated Node installation. |
| Del_Sole oldrender.yaml | File read failed | Contents not assessed. |
| luxury_2 | Repository reported empty | No runtime evidence. |

Only default branches were audited; pending feature branches and external dashboard overrides may differ. Full-tree retrieval for TGSIMON.COM exceeded connector limits; root directory and root package.json were inspected instead.

## Content Factory remediation and validation

Pin all eleven setup-node uses to 22.23.4 (avoid stale hosted-toolcache selections), add .node-version, set engines to >=22.23.4 <23, align lockfile metadata and README. Stay within the existing major; application dependencies and behavior are unchanged.

Locally executed with actual Node 22.23.4: npm ci --ignore-scripts; test:v2.1; test:v2.10 (including 20 UI tests); test:v2.10.4; test:v2.11; dashboard:build. All passed. Real provider calls: zero. npm test was attempted but could not execute its database smoke test because DATABASE_URL is absent; PostgreSQL integration suites were not run locally. Existing PR CI must complete before merge.

## Production follow-up (requires separately authorized access/deployment)

For each running Node service, read process.version and the deployed commit/image digest; inspect dashboard NODE_VERSION overrides and service root directories. A repository pin alone does not repair an already-running process. On Render, check each web service, background worker and cron independently. For Docker, verify Node and the certificate store inside the rebuilt image; do not assume an untagged image is patched. Rebuild/redeploy only after review and approval, then verify the running version. Do not expose a public diagnostic endpoint or print environment variables.

A credential-like literal was also observed in the public Del_Sole template configuration. Its validity is unknown; it was not tested, copied into this report, changed, or rotated. Review privately if that template was ever deployed.
