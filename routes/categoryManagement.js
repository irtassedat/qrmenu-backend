const express = require('express');
const router = express.Router();
const db = require('../db');
const { authorize } = require('./auth');

// Helper function to get or create default branch for brand manager
async function getOrCreateDefaultBranch(brandId) {
  // First check if there are any branches for this brand
  const existingBranch = await db.query(
    'SELECT id FROM branches WHERE brand_id = $1 ORDER BY id LIMIT 1',
    [brandId]
  );
  
  if (existingBranch.rows.length > 0) {
    return existingBranch.rows[0].id;
  }
  
  // Create a default branch if none exists
  const newBranch = await db.query(
    'INSERT INTO branches (name, brand_id, created_at, updated_at) VALUES ($1, $2, NOW(), NOW()) RETURNING id',
    ['Ana Şube', brandId]
  );
  
  return newBranch.rows[0].id;
}

// Get all categories with sort order and visibility settings
router.get('/categories/management', authorize(['super_admin', 'brand_manager', 'branch_manager']), async (req, res) => {
  try {
    const { branchId } = req.query;
    const userRole = req.user.role;
    const userId = req.user.id;
    
    let targetBranchId = branchId;
    
    // Branch manager can only see their own branch
    if (userRole === 'branch_manager') {
      // Önce users tablosundan branch_id'yi kontrol et
      const userBranchId = req.user.branch_id;
      
      if (userBranchId) {
        targetBranchId = userBranchId;
      } else {
        // Eğer users tablosunda yoksa user_branches'e bak
        const branchResult = await db.query(
          'SELECT branch_id FROM user_branches WHERE user_id = $1',
          [userId]
        );
        
        if (branchResult.rows.length === 0) {
          return res.status(403).json({ message: 'No branch assigned to this user' });
        }
        
        targetBranchId = branchResult.rows[0].branch_id;
      }
    } 
    // Brand manager can manage categories for all branches in their brand
    else if (userRole === 'brand_manager') {
      const userBrandId = req.user.brand_id;
      
      if (!userBrandId) {
        return res.status(400).json({ message: 'No brand assigned to this user' });
      }
      
      if (targetBranchId) {
        // If a specific branch is requested, verify it belongs to their brand
        const branchCheck = await db.query(
          'SELECT id FROM branches WHERE id = $1 AND brand_id = $2',
          [targetBranchId, userBrandId]
        );
        
        if (branchCheck.rows.length === 0) {
          return res.status(403).json({ message: 'You do not have access to this branch' });
        }
      } else {
        // If no specific branch requested, get or create default branch
        targetBranchId = await getOrCreateDefaultBranch(userBrandId);
      }
    }
    // Super admin must specify a branch
    else if (!targetBranchId) {
      return res.status(400).json({ message: 'Branch ID is required' });
    }
    
    // Get categories with branch-specific settings
    const result = await db.query(`
      SELECT 
        c.id,
        c.name,
        c.image_url,
        COALESCE(bcs.sort_order, c.sort_order) as sort_order,
        COALESCE(bcs.is_visible, c.is_visible) as is_visible,
        COUNT(DISTINCT p.id) as product_count,
        bcs.id IS NOT NULL as has_custom_settings
      FROM categories c
      LEFT JOIN branch_category_settings bcs ON bcs.category_id = c.id AND bcs.branch_id = $1
      LEFT JOIN products p ON p.category_id = c.id
      LEFT JOIN branch_products pb ON pb.product_id = p.id AND pb.branch_id = $1
      GROUP BY c.id, c.name, c.image_url, c.sort_order, c.is_visible, bcs.sort_order, bcs.is_visible, bcs.id
      ORDER BY COALESCE(bcs.sort_order, c.sort_order), c.id
    `, [targetBranchId]);
    
    res.json({
      branchId: targetBranchId,
      categories: result.rows
    });
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ message: 'Error fetching categories' });
  }
});

// Update category sort order for a specific branch
router.put('/categories/:id/sort', authorize(['super_admin', 'brand_manager', 'branch_manager']), async (req, res) => {
  const { id } = req.params;
  const { sort_order, branchId } = req.body;
  const userRole = req.user.role;
  const userId = req.user.id;
  
  try {
    let targetBranchId = branchId;
    
    // Branch manager can only update their own branch
    if (userRole === 'branch_manager') {
      // First check users table for branch_id
      const userBranchId = req.user.branch_id;
      
      if (userBranchId) {
        targetBranchId = userBranchId;
      } else {
        // If not in users table, check user_branches
        const branchResult = await db.query(
          'SELECT branch_id FROM user_branches WHERE user_id = $1',
          [userId]
        );
        
        if (branchResult.rows.length === 0) {
          return res.status(403).json({ message: 'No branch assigned to this user' });
        }
        
        targetBranchId = branchResult.rows[0].branch_id;
      }
    } 
    // Brand manager needs a branch ID but we validate it belongs to their brand
    else if (userRole === 'brand_manager') {
      const userBrandId = req.user.brand_id;
      
      if (!userBrandId) {
        return res.status(400).json({ message: 'No brand assigned to this user' });
      }
      
      if (!targetBranchId) {
        // If no branch specified, get or create default branch
        targetBranchId = await getOrCreateDefaultBranch(userBrandId);
      } else {
        // Verify the branch belongs to the brand manager's brand
        const branchCheck = await db.query(
          'SELECT id FROM branches WHERE id = $1 AND brand_id = $2',
          [targetBranchId, userBrandId]
        );
        
        if (branchCheck.rows.length === 0) {
          return res.status(403).json({ message: 'You do not have access to this branch' });
        }
      }
    } else if (!targetBranchId) {
      return res.status(400).json({ message: 'Branch ID is required' });
    }
    
    // Insert or update branch-specific setting
    const result = await db.query(
      `INSERT INTO branch_category_settings (branch_id, category_id, sort_order, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (branch_id, category_id)
       DO UPDATE SET sort_order = $3, updated_at = NOW()
       RETURNING *`,
      [targetBranchId, id, sort_order]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating category sort order:', error);
    res.status(500).json({ message: 'Error updating category sort order' });
  }
});

// Update category visibility for a specific branch
router.put('/categories/:id/visibility', authorize(['super_admin', 'brand_manager', 'branch_manager']), async (req, res) => {
  const { id } = req.params;
  const { is_visible, branchId } = req.body;
  const userRole = req.user.role;
  const userId = req.user.id;
  
  try {
    let targetBranchId = branchId;
    
    // Branch manager can only update their own branch
    if (userRole === 'branch_manager') {
      // First check users table for branch_id
      const userBranchId = req.user.branch_id;
      
      if (userBranchId) {
        targetBranchId = userBranchId;
      } else {
        // If not in users table, check user_branches
        const branchResult = await db.query(
          'SELECT branch_id FROM user_branches WHERE user_id = $1',
          [userId]
        );
        
        if (branchResult.rows.length === 0) {
          return res.status(403).json({ message: 'No branch assigned to this user' });
        }
        
        targetBranchId = branchResult.rows[0].branch_id;
      }
    } 
    // Brand manager needs a branch ID but we validate it belongs to their brand
    else if (userRole === 'brand_manager') {
      const userBrandId = req.user.brand_id;
      
      if (!userBrandId) {
        return res.status(400).json({ message: 'No brand assigned to this user' });
      }
      
      if (!targetBranchId) {
        // If no branch specified, get or create default branch
        targetBranchId = await getOrCreateDefaultBranch(userBrandId);
      } else {
        // Verify the branch belongs to the brand manager's brand
        const branchCheck = await db.query(
          'SELECT id FROM branches WHERE id = $1 AND brand_id = $2',
          [targetBranchId, userBrandId]
        );
        
        if (branchCheck.rows.length === 0) {
          return res.status(403).json({ message: 'You do not have access to this branch' });
        }
      }
    } else if (!targetBranchId) {
      return res.status(400).json({ message: 'Branch ID is required' });
    }
    
    // Insert or update branch-specific setting
    const result = await db.query(
      `INSERT INTO branch_category_settings (branch_id, category_id, is_visible, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (branch_id, category_id)
       DO UPDATE SET is_visible = $3, updated_at = NOW()
       RETURNING *`,
      [targetBranchId, id, is_visible]
    );
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating category visibility:', error);
    res.status(500).json({ message: 'Error updating category visibility' });
  }
});

// Bulk update category sort orders for a specific branch
router.put('/categories/bulk-sort', authorize(['super_admin', 'brand_manager', 'branch_manager']), async (req, res) => {
  const { categories, updates, branchId } = req.body; // categories veya updates array'i olabilir
  const updateList = categories || updates || []; // Frontend'ten categories olarak geliyor
  const userRole = req.user.role;
  const userId = req.user.id;
  
  const client = await db.getClient();
  
  try {
    let targetBranchId = branchId;
    
    // Branch manager can only update their own branch
    if (userRole === 'branch_manager') {
      // First check users table for branch_id
      const userBranchId = req.user.branch_id;
      
      if (userBranchId) {
        targetBranchId = userBranchId;
      } else {
        // If not in users table, check user_branches
        const branchResult = await db.query(
          'SELECT branch_id FROM user_branches WHERE user_id = $1',
          [userId]
        );
        
        if (branchResult.rows.length === 0) {
          return res.status(403).json({ message: 'No branch assigned to this user' });
        }
        
        targetBranchId = branchResult.rows[0].branch_id;
      }
    } 
    // Brand manager needs a branch ID but we validate it belongs to their brand
    else if (userRole === 'brand_manager') {
      const userBrandId = req.user.brand_id;
      
      if (!userBrandId) {
        return res.status(400).json({ message: 'No brand assigned to this user' });
      }
      
      if (!targetBranchId) {
        // If no branch specified, get or create default branch
        targetBranchId = await getOrCreateDefaultBranch(userBrandId);
      } else {
        // Verify the branch belongs to the brand manager's brand
        const branchCheck = await db.query(
          'SELECT id FROM branches WHERE id = $1 AND brand_id = $2',
          [targetBranchId, userBrandId]
        );
        
        if (branchCheck.rows.length === 0) {
          return res.status(403).json({ message: 'You do not have access to this branch' });
        }
      }
    } else if (!targetBranchId) {
      return res.status(400).json({ message: 'Branch ID is required' });
    }
    
    await client.query('BEGIN');
    
    for (const update of updateList) {
      await client.query(
        `INSERT INTO branch_category_settings (branch_id, category_id, sort_order, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (branch_id, category_id)
         DO UPDATE SET sort_order = $3, updated_at = NOW()`,
        [targetBranchId, update.id, update.sort_order]
      );
    }
    
    await client.query('COMMIT');
    
    res.json({ message: 'Sort orders updated successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating category sort orders:', error);
    res.status(500).json({ message: 'Error updating category sort orders' });
  } finally {
    client.release();
  }
});

// Get categories for a specific branch
router.get('/branches/:branchId/categories/management', authorize(['super_admin', 'brand_manager', 'branch_manager']), async (req, res) => {
  try {
    const { branchId } = req.params;
    const userRole = req.user.role;
    const userId = req.user.id;
    
    // Verify user has access to this branch
    if (userRole === 'branch_manager') {
      const userBranchId = req.user.branch_id;
      let allowedBranchId = userBranchId;
      
      if (!userBranchId) {
        const branchResult = await db.query(
          'SELECT branch_id FROM user_branches WHERE user_id = $1',
          [userId]
        );
        
        if (branchResult.rows.length === 0) {
          return res.status(403).json({ message: 'No branch assigned to this user' });
        }
        
        allowedBranchId = branchResult.rows[0].branch_id;
      }
      
      if (allowedBranchId !== parseInt(branchId)) {
        return res.status(403).json({ message: 'You do not have access to this branch' });
      }
    } else if (userRole === 'brand_manager') {
      const userBrandId = req.user.brand_id;
      
      if (!userBrandId) {
        return res.status(400).json({ message: 'No brand assigned to this user' });
      }
      
      // Verify the branch belongs to the brand manager's brand
      const branchCheck = await db.query(
        'SELECT id FROM branches WHERE id = $1 AND brand_id = $2',
        [branchId, userBrandId]
      );
      
      if (branchCheck.rows.length === 0) {
        return res.status(403).json({ message: 'You do not have access to this branch' });
      }
    }
    
    // Get categories with branch-specific settings
    const result = await db.query(`
      SELECT 
        c.id,
        c.name,
        c.image_url,
        COALESCE(bcs.sort_order, c.sort_order) as sort_order,
        COALESCE(bcs.is_visible, c.is_visible) as is_visible,
        COUNT(DISTINCT p.id) as product_count,
        bcs.id IS NOT NULL as has_custom_settings
      FROM categories c
      LEFT JOIN branch_category_settings bcs ON bcs.category_id = c.id AND bcs.branch_id = $1
      LEFT JOIN products p ON p.category_id = c.id
      LEFT JOIN branch_products pb ON pb.product_id = p.id AND pb.branch_id = $1
      GROUP BY c.id, c.name, c.image_url, c.sort_order, c.is_visible, bcs.sort_order, bcs.is_visible, bcs.id
      ORDER BY COALESCE(bcs.sort_order, c.sort_order), c.id
    `, [branchId]);
    
    res.json({
      branchId: branchId,
      categories: result.rows
    });
  } catch (error) {
    console.error('Error fetching branch categories:', error);
    res.status(500).json({ message: 'Error fetching branch categories' });
  }
});

module.exports = router;