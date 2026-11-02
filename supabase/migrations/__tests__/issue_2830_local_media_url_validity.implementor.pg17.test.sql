-- Regression for 20280309002830: the Website audit accepts loopback http
-- media only on a Sites service config marked environment='local'. Without
-- that row (every hosted database), media must stay https-only.

\set ON_ERROR_STOP on
BEGIN;

DO $i2830mu$
BEGIN
  IF EXISTS (SELECT 1 FROM public.brand_site_service_config WHERE environment = 'local') THEN
    RAISE EXCEPTION 'test precondition: this database must not be marked local';
  END IF;
  IF NOT public.brand_context_media_url_valid('https://cdn.example.invalid/a.png') THEN
    RAISE EXCEPTION 'https media must be valid';
  END IF;
  IF public.brand_context_media_url_valid('http://127.0.0.1:56333/storage/v1/object/public/a.png') THEN
    RAISE EXCEPTION 'loopback http media must be refused outside a local Sites stack';
  END IF;
  IF public.brand_context_media_url_valid('http://localhost:54321/a.png') THEN
    RAISE EXCEPTION 'localhost http media must be refused outside a local Sites stack';
  END IF;
  IF public.brand_context_media_url_valid('http://cdn.example.invalid/a.png') THEN
    RAISE EXCEPTION 'plain http media must be refused';
  END IF;
  IF public.brand_context_media_url_valid(NULL) OR public.brand_context_media_url_valid('') THEN
    RAISE EXCEPTION 'missing media must not be valid';
  END IF;
END
$i2830mu$;

ROLLBACK;
