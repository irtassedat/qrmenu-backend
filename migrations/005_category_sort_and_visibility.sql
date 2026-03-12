-- Migration: Add sort_order and visibility to categories table
-- Date: 2025-01-05

-- Add sort_order column for custom ordering
ALTER TABLE categories 
ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 999;

-- Add is_visible column for showing/hiding categories
ALTER TABLE categories 
ADD COLUMN IF NOT EXISTS is_visible BOOLEAN DEFAULT true;

-- Create index for better performance on sorting
CREATE INDEX IF NOT EXISTS idx_categories_sort_visible 
ON categories(sort_order, is_visible);

-- Update existing categories with initial sort order based on their ID
WITH numbered_categories AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY id) * 10 as new_order
  FROM categories
  WHERE sort_order = 999
)
UPDATE categories 
SET sort_order = nc.new_order
FROM numbered_categories nc
WHERE categories.id = nc.id;

-- Add comments for documentation
COMMENT ON COLUMN categories.sort_order IS 'Custom sort order for categories. Lower numbers appear first.';
COMMENT ON COLUMN categories.is_visible IS 'Whether the category is visible in the menu. false = hidden';