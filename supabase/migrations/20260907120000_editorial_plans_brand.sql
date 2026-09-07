-- Piani Editoriali IHC: aggiunge lo scoping per sotto-brand a editorial_plans,
-- cosi' ogni sotto-brand IHC ha un proprio calendario/post indipendente.
-- Il Piano Editoriale "storico" (single-tenant) continua a usare brand = null,
-- quindi resta invariato e non richiede backfill.

alter table public.editorial_plans add column brand text;

alter table public.editorial_plans drop constraint if exists editorial_plans_year_month_key;

-- Un solo piano "storico" (brand null) per anno/mese...
create unique index editorial_plans_year_month_no_brand_idx
  on public.editorial_plans (year, month)
  where brand is null;

-- ...e un solo piano per anno/mese/brand quando il brand e' specificato.
create unique index editorial_plans_year_month_brand_idx
  on public.editorial_plans (year, month, brand)
  where brand is not null;
