# Pink Paisa

Marketplace for women's wellness. Vendors list products, customers buy through Pink Paisa, the platform manages commission and payouts, and AI helps run Instagram marketing.

## Current production direction

- Frontend: Next.js 16 + React 19 (Pages Router) in `frontend-next/`
- Backend: Node + Express + Mongoose in `server/`
- Payments: PhonePe
- AI marketing: OpenAI / Gemini / OpenRouter via internal provider abstraction
- Deploy target: AWS Lightsail + Nginx + PM2

`frontend/` is still present as the older Vite/React codebase for comparison and migration safety, but it should be treated as legacy and not as the active deploy target.

## Local development

1. Copy env files:
   - `server/.env.example` -> `server/.env`
   - `frontend-next/.env.example` -> `frontend-next/.env`
2. Fill in local credentials and URLs.
3. Start the backend:
   - `cd server`
   - `npm install`
   - `npm run dev`
4. Start the frontend:
   - `cd frontend-next`
   - `npm install`
   - `npm run dev`

## Default local ports

- Backend: `http://localhost:5001`
- Frontend: `http://localhost:3000`

## Deploy

See [deploy/lightsail/README.md](deploy/lightsail/README.md).

## Notes

- Do not commit live `.env` files.
- `server/clear.js` has been moved into a guarded dev-only script under `server/scripts/dev/`.
- The top-level deploy archive is a generated artifact and should not be treated as source.
