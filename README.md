# Transcript Annotation Workspace (Next.js)

This project now runs on **Next.js 16** with the App Router, React Server Components, and Tailwind CSS. The UI is organized as a workspace for browsing transcripts (`/`) and performing detailed annotations (`/annotate`).

## Getting Started

```bash
npm install
npm run dev
```

- Development server: http://localhost:3000
- Production build: `npm run build`
- Start production server: `npm start`
- Lint: `npm run lint`

## Project Structure

- `src/app/` – App Router entry points, shared layout, and route segments.
- `src/components/` – Reusable UI (e.g., `WorkspaceHeader`).
- `src/context/` – Client providers such as `ThemeContext`.
- `public/` – Static assets served via Next.js (icons, reference images, etc.).

`src/app/layout.tsx` wires global fonts, styles, and wraps all pages in the `ThemeProvider`. Client-heavy routes like `/` and `/annotate` are marked with `"use client"` so they can keep using React state, effects, and Lucide icons.

## Styling

Tailwind CSS powers utility styling. Content paths in `tailwind.config.js` include `src/app`, `src/components`, and `src/context`. Global resets and the custom scrollbar styles live in `src/app/globals.css`. Fonts are loaded via `next/font` for better performance.

## Theming

`ThemeContext` remains client-side and persists the selected background in `localStorage`. The provider is registered in `src/app/providers.tsx` and injected by the root layout so every route shares the same theming controls exposed in the workspace header.

## Notes

- Vite configuration has been removed; all commands now go through Next.js.
- Static HTML entry points are no longer used—routing is handled by App Router segments.
- If you add new directories with Tailwind classes, update `tailwind.config.js` so JIT picks them up.

## Google Cloud Storage uploads

The admin transcript uploader sends files to Google Cloud Storage through the backend. Configure the following environment variables before running locally or deploying:

- `GOOGLE_CLOUD_STORAGE_BUCKET` (or `GCS_BUCKET_NAME`) – bucket that stores transcript files.
- `GOOGLE_APPLICATION_CREDENTIALS` – absolute or project-relative path to the service-account JSON (for example `keys/service-account.json`).
- `GOOGLE_CLOUD_PROJECT_ID` – optional but recommended; only needed if it cannot be inferred from the credentials file.

Ensure the service account has write access to the bucket and that the bucket’s IAM or ACL rules allow whichever access pattern you intend to use (public URLs vs. signed URLs).

### CORS for signed uploads

If you are using signed upload URLs from the browser, you must allow your frontend origin(s) to `PUT` objects and to send the `x-goog-meta-*` headers. Otherwise, the browser request will be blocked by CORS.

Create a `cors.json` (replace the origins with your Vercel domain and localhost for dev):

```json
[
  {
    "origin": ["https://www.edu-coder.com", "http://localhost:3000"],
    "method": ["PUT"],
    "responseHeader": ["Content-Type", "x-goog-meta-*"],
    "maxAgeSeconds": 3600
  }
]
```

Apply it to your bucket:

```bash
gsutil cors set cors.json gs://YOUR_BUCKET_NAME
```
