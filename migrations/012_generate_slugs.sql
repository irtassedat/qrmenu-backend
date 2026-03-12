-- Migration: Generate Slugs for Brands and Branches
-- Date: 2025-10-28
-- Purpose: Create slug and full_slug for all brands and branches

BEGIN;

-- Function to generate slug from text (Turkish character support)
CREATE OR REPLACE FUNCTION generate_slug(input_text TEXT) RETURNS TEXT AS $$
DECLARE
    slug TEXT;
BEGIN
    slug := LOWER(input_text);

    -- Replace Turkish characters
    slug := REPLACE(slug, 'ı', 'i');
    slug := REPLACE(slug, 'ğ', 'g');
    slug := REPLACE(slug, 'ü', 'u');
    slug := REPLACE(slug, 'ş', 's');
    slug := REPLACE(slug, 'ö', 'o');
    slug := REPLACE(slug, 'ç', 'c');
    slug := REPLACE(slug, 'İ', 'i');
    slug := REPLACE(slug, 'Ğ', 'g');
    slug := REPLACE(slug, 'Ü', 'u');
    slug := REPLACE(slug, 'Ş', 's');
    slug := REPLACE(slug, 'Ö', 'o');
    slug := REPLACE(slug, 'Ç', 'c');

    -- Replace spaces with hyphens
    slug := REPLACE(slug, ' ', '-');

    -- Remove special characters (keep only letters, numbers, hyphens)
    slug := REGEXP_REPLACE(slug, '[^a-z0-9\-]', '', 'g');

    -- Replace multiple consecutive hyphens with single hyphen
    slug := REGEXP_REPLACE(slug, '\-+', '-', 'g');

    -- Remove leading/trailing hyphens
    slug := TRIM(BOTH '-' FROM slug);

    RETURN slug;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Step 1: Generate slugs for brands
UPDATE brands
SET slug = generate_slug(name)
WHERE slug IS NULL OR slug = '';

-- Step 2: Generate slugs for branches
UPDATE branches
SET slug = generate_slug(name)
WHERE slug IS NULL OR slug = '';

-- Step 3: Generate full_slug for branches (brand_slug/branch_slug)
UPDATE branches b
SET full_slug = br.slug || '/' || b.slug
FROM brands br
WHERE b.brand_id = br.id
  AND (b.full_slug IS NULL OR b.full_slug = '');

-- Step 4: Handle duplicates by appending branch ID
UPDATE branches
SET full_slug = full_slug || '-' || id::TEXT
WHERE id IN (
    SELECT b1.id
    FROM branches b1
    JOIN branches b2 ON b1.full_slug = b2.full_slug AND b1.id != b2.id
    WHERE b1.id > b2.id
);

-- Step 5: Report statistics
DO $$
DECLARE
    total_brands INTEGER;
    brands_with_slug INTEGER;
    total_branches INTEGER;
    branches_with_full_slug INTEGER;
BEGIN
    SELECT COUNT(*) INTO total_brands FROM brands;
    SELECT COUNT(*) INTO brands_with_slug FROM brands WHERE slug IS NOT NULL AND slug != '';
    SELECT COUNT(*) INTO total_branches FROM branches;
    SELECT COUNT(*) INTO branches_with_full_slug FROM branches WHERE full_slug IS NOT NULL AND full_slug != '';

    RAISE NOTICE '=== Slug Generation Statistics ===';
    RAISE NOTICE 'Total brands: %', total_brands;
    RAISE NOTICE 'Brands with slug: %', brands_with_slug;
    RAISE NOTICE 'Total branches: %', total_branches;
    RAISE NOTICE 'Branches with full_slug: %', branches_with_full_slug;
END $$;

-- Step 6: Display sample results
SELECT
    b.id,
    b.name as brand_name,
    b.slug as brand_slug
FROM brands b
ORDER BY b.id;

SELECT
    br.id,
    br.name as branch_name,
    br.slug as branch_slug,
    br.full_slug,
    b.name as brand_name
FROM branches br
JOIN brands b ON br.brand_id = b.id
ORDER BY br.id
LIMIT 10;

COMMIT;
