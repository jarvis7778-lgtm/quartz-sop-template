# Architecture

## Overview

```text
┌─────────────────────────────────────────────────────────────┐
│ Static hosting                                               │
│ Cloudflare Pages / GitHub Pages / any static host            │
│                                                             │
│  Quartz static site                                          │
│  - Markdown content                                          │
│  - Search, backlinks, navigation                             │
│  - Custom collaboration components                           │
└─────────────────────────────────────────────────────────────┘
                              │ browser API calls
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ Supabase                                                     │
│ - Auth: GitHub OAuth                                         │
│ - Database: PostgreSQL                                       │
│ - Realtime: annotations, reservations; comments: refresh              │
│                                                             │
│ Tables: users / annotations / comments / comment_likes /     │
│         reservations                                         │
└─────────────────────────────────────────────────────────────┘
```

## Responsibilities

| Layer                                        | Responsibility                                      |
| -------------------------------------------- | --------------------------------------------------- |
| `content/`                                   | Markdown pages edited by the team                   |
| `quartz/`                                    | Quartz site generator and custom UI components      |
| `quartz/components/Auth.tsx`                 | GitHub sign-in/out UI and Supabase client bootstrap |
| `quartz/components/SupaComments.tsx`         | Page comments, replies, manual refresh, and deletes |
| `quartz/components/Annotation.tsx`           | Page-level annotation UI                            |
| `quartz/components/ReservationCalendar.tsx`  | Reservation calendar UI                             |
| `supabase/migrations/001_initial_schema.sql` | Database tables, triggers, indexes, and RLS         |

## Data Model

```sql
users (
  id uuid primary key,
  github_id text unique,
  username text,
  email text,
  avatar_url text,
  role text default 'member',
  created_at timestamp,
  updated_at timestamp
)

annotations (
  id uuid primary key,
  page_path text,
  paragraph_id text,
  text_selection text,
  content text,
  author_id uuid references users,
  created_at timestamp,
  updated_at timestamp
)

comments (
  id uuid primary key,
  page_path text,
  content text,
  author_id uuid references users,
  parent_id uuid references comments,
  likes integer default 0,
  created_at timestamp,
  updated_at timestamp
)

comment_likes (
  id uuid primary key,
  comment_id uuid references comments,
  user_id uuid references users,
  created_at timestamp,
  unique(comment_id, user_id)
)

reservations (
  id uuid primary key,
  title text,
  description text,
  equipment text,
  user_id uuid references users,
  start_time timestamp,
  end_time timestamp,
  color text,
  created_at timestamp,
  updated_at timestamp
)
```

## Auth Flow

1. Visitor clicks **GitHub Login**.
2. Supabase redirects to GitHub OAuth.
3. GitHub returns to Supabase, then back to the site.
4. Supabase creates an `auth.users` record.
5. A database trigger mirrors the user into `public.users`.
6. Components use the active Supabase session for comments, annotations, and reservations.

## Access Control

Supabase Row Level Security protects collaborative data after login. It does not hide static Markdown pages. If your content must be private, put the whole static site behind Cloudflare Access or an equivalent edge access-control layer.

## Deployment Flow

```text
Edit Markdown → commit to GitHub → static build → deploy public/ → browser calls Supabase
```
