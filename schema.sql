-- COMPLETE SCHEMA UREN + KILOMETERS
create extension if not exists pgcrypto;

create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique not null,
  name text not null,
  role text not null default 'user'
);

create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean default true
);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id),
  name text not null,
  active boolean default true
);

create table if not exists activities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  billable_default boolean default true,
  active boolean default true
);

create table if not exists time_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  entry_date date not null,
  hours numeric(6,2) not null,
  client_id uuid references clients(id),
  project_id uuid references projects(id),
  activity_id uuid references activities(id),
  description text,
  billable boolean default true,
  created_at timestamptz default now()
);

create table if not exists mileage_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  entry_date date not null,
  kilometers numeric(6,1) not null,
  client_id uuid references clients(id),
  project_id uuid references projects(id),
  description text,
  declared boolean default false,
  created_at timestamptz default now()
);
