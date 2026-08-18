Beard Trim Map v11 — Cloudflare-native free test build
This build removes Netlify from the app architecture. The browser app, /api/render-preview endpoint, and Cloudflare Workers AI binding all deploy together as one Cloudflare Worker with static assets.
Why this build is simpler
public/index.html = the Beard Trim Map scanner/live-map app.
src/worker.js = the secure AI preview API.
wrangler.jsonc = static assets + /api/* routing + Workers AI binding (AI).
No OPENAI_API_KEY.
No CLOUDFLARE_API_TOKEN or Account ID is stored in the deployed app. The Worker calls Workers AI through the native env.AI binding.
Deploy from a computer with Wrangler
Unzip this folder.
Open a terminal in the folder.
Run:
npm install npx wrangler login npm run deploy
Cloudflare will provide a https://beard-trim-map-test.<your-subdomain>.workers.dev URL.
Open that URL on the phone and allow camera permission.
Deploy using GitHub / Cloudflare Workers Builds
Put this folder in a GitHub repository.
Cloudflare dashboard → Workers & Pages → Create → Import a repository.
Select the repository. Because wrangler.jsonc is already included, the Worker configuration is part of the project.
Deploy.
Workers AI
The binding is already declared as:
"ai": {
  "binding": "AI",
  "remote": true
}
The preview endpoint calls @cf/black-forest-labs/flux-2-klein-4b directly through env.AI and sends up to four scan images.
The app resizes those reference images below 512px before sending them to FLUX. The front scan is image 0, followed by right profile, left profile, and chin-up references.
Quick health test
After deployment, visit:
https://YOUR-WORKER.workers.dev/api/health
You should see JSON containing:
{"ok":true,"service":"beard-trim-map","aiBinding":true}
If aiBinding is false, the AI binding was not applied.
Local testing
Workers AI cannot be simulated entirely locally. wrangler dev uses the remote AI binding configured in wrangler.jsonc.
Files you no longer need
The old Netlify function and Netlify environment variables are not used by this build.
