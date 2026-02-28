# EduCoder

Open-source annotation system for education transcript data, including:
- human annotation workspaces,
- admin assignment and quality-control tooling,
- optional LLM-generated notes,
- structured post-annotation scavenger-hunt reflection,
- transcript media and instructional material management.

Built with Next.js App Router, Clerk authentication, Prisma + Postgres, and Google Cloud Storage.

## Table Of Contents

- [Why EduCoder](#why-educoder)
- [Paper Alignment](#paper-alignment)
- [Core Features](#core-features)
- [System Architecture](#system-architecture)
- [Tech Stack](#tech-stack)
- [Repository Structure](#repository-structure)
- [Data Model Overview](#data-model-overview)
- [Prerequisites](#prerequisites)
- [Environment Variables](#environment-variables)
- [Local Development Setup](#local-development-setup)
- [Running The App](#running-the-app)
- [Authentication And Roles](#authentication-and-roles)
- [Transcript File Requirements](#transcript-file-requirements)
- [Storage And Upload Workflows](#storage-and-upload-workflows)
- [LLM Annotation Workflow](#llm-annotation-workflow)
- [Deployment Notes](#deployment-notes)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [Roadmap Ideas](#roadmap-ideas)
- [Citation](#citation)
- [License](#license)

## Why EduCoder

EduCoder is designed for research and practitioner teams working with classroom conversation transcripts that need a repeatable process to:
- assign annotation work,
- capture evidence-based notes tied to specific transcript lines,
- compare human and LLM-generated annotations,
- administer structured follow-up tasks (scavenger hunts),
- manage associated instructional context and media.

The platform uses workspace-level data boundaries so each team can work independently.

## Paper Alignment

This repository is aligned with the framing in the EduCoder research paper:

- **Integrated annotation workspace**
  - Transcript text, synchronized video, and instructional context are available in a single workspace.
- **Segment-aware navigation**
  - Annotation can be scoped using transcript metadata (segment columns and optional timing cues), reducing manual clipping workflows.
- **Team-based workflows**
  - Role-aware admin/annotator flows support assignment, monitoring, and export.
- **Human-LLM collaboration**
  - LLM-generated reference notes can be generated with prompt controls and revealed using admin-configurable visibility rules.
- **Structured reflection after annotation**
  - The scavenger-hunt module supports post-annotation comparison and reflection on human vs. LLM interpretations.

Public access and demo links referenced in the paper:
- App: `https://edu-coder.com`

## Core Features

- **Annotator workspace**
  - Browse assigned transcripts in `/workspace`
  - Open detailed annotation interface in `/annotate`
  - Filter transcript lines, flag lines, assign notes to lines
  - View instructional cards and linked transcript video
  - Mark annotations complete

- **Admin dashboard**
  - Manage transcripts, annotators, annotations, LLM annotations, scavenger hunts, and videos under `/admin/*`
  - Upload transcript files and associated reference files
  - Upload or replace transcript-linked videos
  - Download generated artifacts (annotation files, note bundles, submissions)

- **LLM note generation**
  - Uses OpenAI Responses API via server route
  - Supports customizable prompt templates + static prompt components
  - Supports line-range scoping per transcript
  - Includes workspace-level LLM usage quota controls
  - Configurable LLM visibility defaults and per-annotator overrides to reduce annotation bias risk

- **Scavenger hunts**
  - Admins define question sets per transcript
  - Assignments tracked per annotator
  - Visibility controls for admin/user/per-annotator cases
  - Structured post-annotation reflection with exportable submissions

- **Cloud storage integration**
  - Transcript files, reference files, instructional materials, and videos stored in Google Cloud Storage
  - Supports direct server uploads and signed URL video uploads

## System Architecture

- **Frontend/UI**: Next.js App Router pages (`src/app/**/page.tsx`) with React client components for interactive workflows.
- **Backend/API**: Route handlers under `src/app/api/**/route.ts`.
- **Data layer**: Prisma Client with Neon adapter and PostgreSQL schema in `prisma/schema.prisma`.
- **Auth**: Clerk middleware + server auth checks on API routes and protected layouts.
- **Blob/file storage**: Google Cloud Storage through helper utilities in `src/app/api/admin/transcripts/storage.ts`.
- **Prompt assets**: Prompt fragments in `prompts/` used during LLM generation.

## Tech Stack

- **Runtime**: Node.js (recommended: active LTS)
- **Framework**: Next.js 16 + React 19 + TypeScript
- **Styling**: Tailwind CSS
- **Auth**: Clerk (`@clerk/nextjs`)
- **ORM/DB**: Prisma 7 + PostgreSQL (`@prisma/adapter-neon`)
- **Storage**: `@google-cloud/storage`
- **LLM integration**: OpenAI Responses API (HTTP request from server route)
- **File parsing**: `papaparse`, `xlsx`, `jszip`

## Repository Structure

```text
.
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── prompts/
│   ├── note_creation_prompt_part_1_customizable.md
│   ├── note_creation_prompt_part_2_static.md
│   ├── note_assignment_prompt_part_1_customizable.md
│   └── note_assignment_prompt_part_2_static.md
├── public/
├── src/
│   ├── app/
│   │   ├── api/
│   │   ├── admin/
│   │   ├── annotate/
│   │   ├── login/
│   │   └── workspace/
│   ├── components/
│   ├── context/
│   └── lib/
├── LICENSE
└── README.md
```

## Data Model Overview

Major Prisma entities:

- `Workspace`: top-level tenant boundary
- `User`: app user mapped to Clerk auth identity (`auth_user_id`)
- `Transcripts`: transcript metadata, storage paths, visibility settings
- `TranscriptLines`: parsed line-by-line transcript content
- `TranscriptSegments`: optional segment grouping for transcript lines
- `Annotations`: assignment/annotation records per transcript + annotator
- `Notes` + `NoteAssignments`: user and LLM notes, linked to transcript lines
- `FlagAssignments`: user-flagged lines
- `InstructionalMaterial`: per-transcript supporting image assets
- `Videos`: transcript-associated video objects
- `ScavengerHunt*` models: scavenger question/assignment/answer workflows
- `LLMNotePrompts`: per-transcript LLM prompt settings and line-range config

## Prerequisites

Before running locally, ensure you have:

- Node.js 20+ (or current LTS)
- npm 10+
- PostgreSQL database (Neon recommended but not required)
- Clerk project (for auth keys and app URL configuration)
- Google Cloud Storage bucket + service account with object read/write permissions
- OpenAI API key (if using LLM annotation features)

## Environment Variables

Create a local `.env` file in the project root.

Example:

```bash
# Database
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DB?sslmode=require"

# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_..."
CLERK_SECRET_KEY="sk_test_..."

# Google Cloud Storage
GOOGLE_CLOUD_STORAGE_BUCKET="your-bucket-name"
# Optional aliases supported by code:
# GCS_BUCKET_NAME="your-bucket-name"
# GOOGLE_STORAGE_BUCKET="your-bucket-name"

# IMPORTANT: this code expects raw JSON content, not a file path.
# Escape newlines as \n when storing in plain env files.
GOOGLE_APPLICATION_CREDENTIALS='{"type":"service_account","project_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n","client_email":"..."}'

# Optional if not present in GOOGLE_APPLICATION_CREDENTIALS:
GOOGLE_CLOUD_PROJECT_ID="your-gcp-project-id"

# LLM features
OPENAI_API_KEY="sk-..."
```

Notes:
- `DATABASE_URL` is required at startup.
- `CLERK_SECRET_KEY` is required for auth-user provisioning and annotator management routes.
- `OPENAI_API_KEY` is required only for LLM note generation routes.

## Local Development Setup

1) Install dependencies

```bash
npm install
```

2) Apply Prisma migrations

```bash
npx prisma migrate deploy
```

For local schema changes during development:

```bash
npx prisma migrate dev
```

3) Start the app

```bash
npm run dev
```

4) Open:
- `http://localhost:3000`

## Running The App

- `npm run dev` - start dev server
- `npm run build` - generate Prisma client then build Next.js
- `npm start` - run production build
- `npm run lint` - run ESLint over TS/TSX files

## Authentication And Roles

EduCoder uses Clerk for identity and an internal `User` table for app-level roles.

Roles in schema:
- `admin`
- `annotator`
- `llm` (system/support role)

Flow:
- `/` serves login UI.
- Clerk session is validated by middleware/protected routes.
- `/api/auth/ensure-user` provisions first-time users in the app database and creates a workspace.
- Admin routes additionally enforce `publicMetadata.role === 'admin'`.

## Transcript File Requirements

Accepted transcript upload file types:
- `.csv`
- `.xls`
- `.xlsx`

Required columns (header matching is flexible/case-insensitive):
- line number (`Line Number`, `#`, etc.)
- `Speaker`
- utterance/dialogue (`Utterance` or `Dialogue`)

Optional columns:
- segment (`Segment`)
- timing cues (`In Cue`, `Out Cue`) including decimal seconds or SMPTE-like values.

If headers are missing or data rows are invalid, upload routes return validation errors.

## Storage And Upload Workflows

Storage helpers live in `src/app/api/admin/transcripts/storage.ts`.

Objects stored include:
- transcript source files
- associated/reference annotation files
- instructional material files
- transcript video files

Video upload options:
- stream upload through backend route
- signed URL flow with metadata validation and completion callback

When replacing existing video assets, previous objects are cleaned up best-effort.

### CORS For Signed Video Uploads

Signed uploads from browsers require bucket CORS allowing `PUT` and required `x-goog-meta-*` headers.

Example policy:

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

Apply:

```bash
gsutil cors set cors.gcs.json gs://YOUR_BUCKET_NAME
```

You can also adapt the included `cors.gcs.json` file in this repo.

## LLM Annotation Workflow

LLM note generation endpoint:
- `POST /api/admin/transcripts/[transcriptId]/llm-notes/generate`

High-level flow:
1. Validate actor and transcript ownership
2. Build transcript prompt payload (full transcript or configured line range)
3. Merge customizable + static prompt components from `prompts/`
4. Request structured output from OpenAI Responses API
5. Parse and normalize notes + note-to-line assignments
6. Persist notes/assignments and update transcript status/usage counters

Related capabilities:
- per-transcript prompt settings
- downloadable LLM note outputs
- admin default visibility + per-annotator visibility controls

Design note:
- The implementation supports using LLM outputs as optional reference annotations; human annotation remains primary in the workflow.

## Deployment Notes

- Runtime is Node.js (`export const runtime = 'nodejs'` in API routes).
- Ensure all required environment variables are configured in deployment platform settings.
- If deploying behind a custom domain, update Clerk allowed URLs and redirect URLs.
- Verify GCS bucket IAM + CORS in production.
- Run migrations in CI/CD before app startup (`npx prisma migrate deploy`).

## Troubleshooting

- **`DATABASE_URL is not set`**
  - Add `DATABASE_URL` to `.env` and restart.

- **Clerk routes returning unauthorized/forbidden**
  - Check Clerk keys, middleware matcher behavior, and user role metadata.

- **`GOOGLE_APPLICATION_CREDENTIALS` parse errors**
  - Value must be valid JSON string content (not file path), with escaped newlines in private key.

- **Upload failures from browser**
  - Confirm bucket CORS and correct signed upload headers.

- **LLM generation fails**
  - Check `OPENAI_API_KEY`, prompt files in `prompts/`, workspace quota, and API route logs.

## Contributing

Contributions are welcome.

Recommended flow:
1. Fork the repo
2. Create a feature branch
3. Make focused changes with clear commit messages
4. Run:
   - `npm run lint`
   - `npm run build`
5. Open a pull request with:
   - problem statement
   - implementation summary
   - screenshots/GIFs for UI changes
   - test/verification notes

Suggested PR checklist:
- [ ] no secrets committed
- [ ] env var changes documented
- [ ] migration changes included if schema changed
- [ ] backward compatibility impact noted

## Roadmap Ideas

- Automated test coverage (unit + integration + route tests)
- Role-scoped audit logs in admin panel
- Better prompt versioning and evaluation workflow for LLM notes
- Bulk assignment/import workflows
- Production monitoring/observability dashboards


## License

This project is licensed under the MIT License.
See `LICENSE` for full text.
