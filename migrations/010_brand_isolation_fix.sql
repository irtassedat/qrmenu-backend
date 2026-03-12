-- Migration: Brand Isolation Fix
-- Date: 2025-10-28
-- Backup: /root/backups/brand_isolation_20251028_223510/

BEGIN;

-- Step 1: Add brand_id to price_templates if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'price_templates' AND column_name = 'brand_id'
    ) THEN
        ALTER TABLE price_templates ADD COLUMN brand_id INTEGER REFERENCES brands(id);
        RAISE NOTICE 'Added brand_id column to price_templates';
    END IF;
END $$;

-- Step 2: Assign existing menu templates to brands
UPDATE menu_templates SET brand_id = 6 WHERE id = 63; -- Cesme
UPDATE menu_templates SET brand_id = 7 WHERE id = 65; -- testaslacati
UPDATE menu_templates SET brand_id = 9 WHERE id = 86; -- Alaçatı

-- Step 3: Create new template for deploy brand
DO $$
DECLARE
    new_menu_template_id INTEGER;
    new_price_template_id INTEGER;
BEGIN
    -- Create menu template
    INSERT INTO menu_templates (name, description, brand_id, is_active)
    VALUES ('Deploy Menu Template', 'Menu template for Deploy brand', 8, true)
    RETURNING id INTO new_menu_template_id;

    -- Copy products from template 63
    INSERT INTO menu_template_products (menu_template_id, product_id, price, is_visible, updated_at)
    SELECT new_menu_template_id, product_id, price, is_visible, updated_at
    FROM menu_template_products WHERE menu_template_id = 63;

    -- Create price template
    INSERT INTO price_templates (name, description, brand_id, is_active, menu_template_id)
    VALUES ('Deploy Price Template', 'Price template for Deploy brand', 8, true, new_menu_template_id)
    RETURNING id INTO new_price_template_id;

    -- Copy price products from template 29
    INSERT INTO price_template_products (price_template_id, product_id, price, updated_at)
    SELECT new_price_template_id, product_id, price, updated_at
    FROM price_template_products WHERE price_template_id = 29;

    -- Update deploy branch
    UPDATE branches SET menu_template_id = new_menu_template_id, price_template_id = new_price_template_id
    WHERE id = 18;

    RAISE NOTICE 'Created new templates for Deploy brand: menu=%, price=%', new_menu_template_id, new_price_template_id;
END $$;

-- Step 4: Update price_templates with brand_id from menu_templates
UPDATE price_templates pt SET brand_id = mt.brand_id
FROM menu_templates mt
WHERE pt.menu_template_id = mt.id AND pt.brand_id IS NULL AND mt.brand_id IS NOT NULL;

-- Step 5: Create indexes
CREATE INDEX IF NOT EXISTS idx_menu_templates_brand ON menu_templates(brand_id);
CREATE INDEX IF NOT EXISTS idx_price_templates_brand ON price_templates(brand_id);

-- Step 6: Add comments
COMMENT ON COLUMN menu_templates.brand_id IS 'Brand isolation: Each template belongs to one brand';
COMMENT ON COLUMN price_templates.brand_id IS 'Brand isolation: Each price template belongs to one brand';

COMMIT;
