const validateCategorySort = (req, res, next) => {
  const { sort_order } = req.body;
  
  if (sort_order !== undefined) {
    if (!Number.isInteger(sort_order) || sort_order < 0 || sort_order > 9999) {
      return res.status(400).json({ 
        message: 'Sıralama değeri 0-9999 arasında bir tam sayı olmalıdır' 
      });
    }
  }
  
  next();
};

const validateBranchId = (req, res, next) => {
  const branchId = req.body.branchId || req.params.branchId || req.query.branchId;
  
  if (branchId && (!Number.isInteger(Number(branchId)) || Number(branchId) < 1)) {
    return res.status(400).json({ 
      message: 'Geçersiz şube ID' 
    });
  }
  
  next();
};

const validateBulkSort = (req, res, next) => {
  const { categories } = req.body;
  
  if (!Array.isArray(categories)) {
    return res.status(400).json({ 
      message: 'Kategoriler bir dizi olmalıdır' 
    });
  }
  
  for (const cat of categories) {
    if (!cat.id || !Number.isInteger(cat.id)) {
      return res.status(400).json({ 
        message: 'Her kategori geçerli bir ID içermelidir' 
      });
    }
    
    if (!Number.isInteger(cat.sort_order) || cat.sort_order < 0) {
      return res.status(400).json({ 
        message: 'Her kategori geçerli bir sıralama değeri içermelidir' 
      });
    }
  }
  
  next();
};

module.exports = {
  validateCategorySort,
  validateBranchId,
  validateBulkSort
};