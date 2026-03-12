-- Migration: Add constraints for data integrity
-- Date: 2025-01-05

-- Add check constraints for sort_order
ALTER TABLE categories 
ADD CONSTRAINT check_sort_order_positive 
CHECK (sort_order >= 0 AND sort_order <= 9999);

ALTER TABLE branch_category_settings 
ADD CONSTRAINT check_branch_sort_order_positive 
CHECK (sort_order >= 0 AND sort_order <= 9999);

-- Add trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_categories_updated_at BEFORE UPDATE
ON categories FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_branch_category_settings_updated_at BEFORE UPDATE
ON branch_category_settings FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Add function to prevent duplicate sort orders within a branch
CREATE OR REPLACE FUNCTION check_unique_sort_order()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM branch_category_settings 
        WHERE branch_id = NEW.branch_id 
        AND sort_order = NEW.sort_order 
        AND category_id != NEW.category_id
    ) THEN
        RAISE EXCEPTION 'Sort order % already exists for branch %', NEW.sort_order, NEW.branch_id;
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Commented out to allow duplicate sort orders for now
-- CREATE TRIGGER enforce_unique_sort_order BEFORE INSERT OR UPDATE
-- ON branch_category_settings FOR EACH ROW
-- EXECUTE FUNCTION check_unique_sort_order();