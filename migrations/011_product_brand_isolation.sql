-- Migration: Product Brand Isolation
-- Date: 2025-10-28
-- Purpose: Add brand_id to products and assign existing products to brands

BEGIN;

-- Step 1: Add brand_id column to products
ALTER TABLE products ADD COLUMN IF NOT EXISTS brand_id INTEGER REFERENCES brands(id);

-- Step 2: Create index for performance
CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand_id);

-- Step 3: Assign existing products to brands based on menu_templates
-- Logic: If a product is in multiple templates, assign to the first brand (by template ID)

-- Create temporary table to store product-brand mapping
CREATE TEMP TABLE product_brand_mapping AS
SELECT DISTINCT ON (mtp.product_id)
    mtp.product_id,
    mt.brand_id,
    mt.id as template_id
FROM menu_template_products mtp
JOIN menu_templates mt ON mtp.menu_template_id = mt.id
WHERE mt.brand_id IS NOT NULL
ORDER BY mtp.product_id, mt.id ASC; -- First template wins

-- Update products with brand_id
UPDATE products p
SET brand_id = pbm.brand_id
FROM product_brand_mapping pbm
WHERE p.id = pbm.product_id;

-- Step 4: Report statistics
DO $$
DECLARE
    total_products INTEGER;
    assigned_products INTEGER;
    unassigned_products INTEGER;
BEGIN
    SELECT COUNT(*) INTO total_products FROM products WHERE is_deleted = false;
    SELECT COUNT(*) INTO assigned_products FROM products WHERE brand_id IS NOT NULL AND is_deleted = false;
    unassigned_products := total_products - assigned_products;

    RAISE NOTICE '=== Product Brand Assignment ===';
    RAISE NOTICE 'Total products: %', total_products;
    RAISE NOTICE 'Assigned to brands: %', assigned_products;
    RAISE NOTICE 'Unassigned: %', unassigned_products;
END $$;

-- Step 5: Show brand-product distribution
SELECT
    b.id as brand_id,
    b.name as brand_name,
    COUNT(p.id) as product_count
FROM brands b
LEFT JOIN products p ON p.brand_id = b.id AND p.is_deleted = false
GROUP BY b.id, b.name
ORDER BY b.id;

-- Step 6: Add comment
COMMENT ON COLUMN products.brand_id IS 'Brand isolation: Each product belongs to one brand. NULL means global/unassigned.';

COMMIT;
