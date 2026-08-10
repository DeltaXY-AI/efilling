# eFiling WhatsApp MVP

One-month MVP for a WhatsApp-based 24x7 ON Courts experience, using the Twilio WhatsApp Sandbox.

## Initial scope

- Complainant Advocate journey
- English and Malayalam onboarding
- Cheque-case data and document collection
- Filing review and simulated acknowledgement
- Case status and notifications
- Scrutiny defect correction
- Hearing attendance or adjournment response
- Provider-neutral messaging architecture for later migration

See [PRD.md](./PRD.md) for the complete product requirements.

## Status

Bootstrapped. The backend is a TypeScript/Express application with a health endpoint, deployable to Vercel.

## Requirements

- Node.js 20+
- npm

## Setup

```bash
npm install
cp .env.example .env
```

## Development

Run the app locally with hot reload:

```bash
npm run dev
```

The server listens on `http://localhost:3000` by default (configurable via `PORT` in `.env`).

## Type-checking

```bash
npm run typecheck
```

## Testing

```bash
npm test
```

## Build

Compile TypeScript to `dist/`:

```bash
npm run build
npm start
```

## API

### `GET /health`

Returns `200` with:

```json
{
  "status": "ok",
  "service": "efilling-whatsapp",
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

## Deployment (Vercel)

The Express app is exported as the default export of `src/index.ts` and deployed as a
single Vercel serverless function via `vercel.json`.

1. Install the [Vercel CLI](https://vercel.com/docs/cli) and log in: `vercel login`.
2. From the repository root, run `vercel` to link the project (first time only).
3. Deploy to production: `vercel --prod`.
4. Verify the deployment by requesting `https://<your-production-domain>/health`.

No environment variables are required for this slice, but any added later should be set
in the Vercel project's environment variable settings (Development/Preview/Production)
and documented in `.env.example`.
