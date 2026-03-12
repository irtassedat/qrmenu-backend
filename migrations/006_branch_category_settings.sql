-- Migration: Create branch-specific category settings
-- Date: 2025-01-05

-- Create branch_category_settings table
CREATE TABLE IF NOT EXISTS branch_category_settings (
    id SERIAL PRIMARY KEY,
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    sort_order INTEGER DEFAULT 999,
    is_visible BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Ensure unique combination of branch and category
    UNIQUE(branch_id, category_id)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_branch_category_settings_branch 
ON branch_category_settings(branch_id);

CREATE INDEX IF NOT EXISTS idx_branch_category_settings_visible 
ON branch_category_settings(branch_id, is_visible, sort_order);

-- Insert default settings for existing branches
-- Copy global category settings to each branch
INSERT INTO branch_category_settings (branch_id, category_id, sort_order, is_visible)
SELECT b.id, c.id, c.sort_order, c.is_visible
FROM branches b
CROSS JOIN categories c
ON CONFLICT (branch_id, category_id) DO NOTHING;

-- Add comments
COMMENT ON TABLE branch_category_settings IS 'Branch-specific category display settings';
COMMENT ON COLUMN branch_category_settings.sort_order IS 'Display order for this category in this branch';
COMMENT ON COLUMN branch_category_settings.is_visible IS 'Whether this category is visible in this branch';