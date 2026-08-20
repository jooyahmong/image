# WOOJOO Image

WOOJOO Image reduces colors, edits palettes, crops artwork, and exports editable
SVG or PNG files entirely in the visitor's browser. Uploaded images are never
sent to an application server or stored remotely.

## Architecture

- React and Vite generate a static site in `dist/`.
- Cloudflare Workers Static Assets serves the site without running Worker code.
- `public/_headers` enables long-lived caching for fingerprinted assets and uses
  `no-transform` so Cloudflare does not inject the Web Analytics beacon.
- There are no API routes, databases, storage bindings, authentication systems,
  payment SDKs, or server-side image transformations.

## Commands

- `npm run dev`: start the local Vite development server.
- `npm run build`: generate the production static assets.
- `npm run typecheck`: run the TypeScript checker.
- `npm run lint`: run ESLint.
- `npm test`: build and run the vector and deployment regression tests.
- `npm run deploy`: build and deploy the static assets with Wrangler.
