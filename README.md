# QR Menu - Backend API

RESTful API for a multi-brand, multi-branch restaurant management system. Built with **Express.js** and **PostgreSQL**. Handles authentication, product management, ordering, loyalty programs, and theme customization.

> **Live Demo:** [qr.sebastianlogic.com](https://qr.sebastianlogic.com)
> **Customer Menu:** [qr.sebastianlogic.com/menu/19](https://qr.sebastianlogic.com/menu/19)
> **Frontend Repo:** [qrmenu-frontend](https://github.com/irtassedat/qrmenu-frontend)

---

## Screenshots

### Admin Dashboard
![Dashboard](docs/screenshots/dashboard.png)

![Dashboard Tools](docs/screenshots/dashboard-tools.png)

### Brand & Branch Management
![Brand Management](docs/screenshots/brand-management.png)

![Branch Management](docs/screenshots/branch-management.png)

### Price Templates & Mobile Menu
![Price Template](docs/screenshots/price-template.png)

![Mobile QR Menu](docs/screenshots/mobile-qr-menu.png)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Runtime** | Node.js |
| **Framework** | Express.js |
| **Database** | PostgreSQL |
| **Auth** | JWT + bcrypt |
| **File Upload** | Multer |
| **SMS** | OTP-based customer auth |

## API Routes (21 modules, 176+ endpoints)

### Authentication & Users
| Route | Description |
|-------|------------|
| `/api/auth` | JWT login, token refresh, password reset |
| `/api/users` | User CRUD, role assignment, branch binding |
| `/api/customer-auth` | Customer SMS OTP login & verification |
| `/api/permissions` | Fine-grained RBAC permission management |

### Business Management
| Route | Description |
|-------|------------|
| `/api/brands` | Brand CRUD with slug routing & logo upload |
| `/api/branches` | Branch management with theme & template settings |
| `/api/products` | Product CRUD with brand isolation & soft delete |
| `/api/categories` | Category ordering, visibility, image upload |
| `/api/category-management` | Branch-specific category overrides |

### Orders & Commerce
| Route | Description |
|-------|------------|
| `/api/orders` | Order creation, status management, history |
| `/api/cart-settings` | Cart configuration per branch |

### Templates & Theming
| Route | Description |
|-------|------------|
| `/api/templates` | Menu & price templates with branch association |
| `/api/theme` | Brand/branch visual customization (JSONB) |

### Loyalty Program
| Route | Description |
|-------|------------|
| `/api/loyalty` | Points, campaigns, rewards, redemption |

### Operations
| Route | Description |
|-------|------------|
| `/api/admin` | System-level admin operations |
| `/api/dashboard` | Aggregated metrics & analytics |
| `/api/analytics` | Event tracking & reporting |
| `/api/integrations` | External service connections |
| `/api/settings` | Global system settings |
| `/api/waiter-calls` | Real-time waiter call system |
| `/api/waiter-dashboard` | Waiter management dashboard |

## Middleware

| Middleware | Purpose |
|-----------|---------|
| `authorizationMiddleware` | Role-based access control (super_admin, brand_manager, branch_manager) |
| `licenseCheck` | Master password & license validation |
| `validation` | Input validation for category operations |

## Database Schema (25+ tables)

### Core Tables
```
users              - Accounts with role, branch, brand binding
brands             - Restaurant chains (name, slug, logo, contact)
branches           - Locations (address, slug, theme_settings)
products           - Menu items (name, price, category, brand isolation)
categories         - Product groups (sort_order, visibility)
```

### Templates & Customization
```
menu_templates     - Product selection templates
price_templates    - Pricing override templates
theme_settings     - Visual customization (JSONB)
branch_category_settings - Per-branch category config
branch_products    - Per-branch product visibility
```

### Orders & Customers
```
orders / order_items  - Order records with line items
customers             - Customer accounts
customer_profiles     - Extended customer info
```

### Loyalty System
```
loyalty_accounts   - Customer point balances
loyalty_settings   - Program configuration
campaigns          - Marketing campaigns with rules
```

### System
```
permissions        - RBAC permission definitions
user_brands        - User-brand relationships
user_branches      - User-branch relationships (JSONB permissions)
audit_logs         - Action tracking (indexed)
analytics_events   - Usage metrics
system_settings    - Global configuration
```

## Migrations

12 SQL migration files for progressive schema evolution:

```
001_slug_and_permissions.sql      - Slug routing & permission system
002_add_brand_owner_role.sql      - Brand owner role
003_user_limits.sql               - Rate limiting & quotas
004_user_permissions.sql          - User permission assignments
005_category_sort_and_visibility  - Category ordering
006_branch_category_settings      - Branch-level category config
007_audit_logs.sql                - Audit logging with indexes
008_add_constraints.sql           - Foreign key constraints
009_brand_manager_role.sql        - Brand manager role
010_brand_isolation_fix.sql       - Data isolation fix
011_product_brand_isolation.sql   - Product scoping
012_generate_slugs.sql            - Auto slug generation
```

## Getting Started

```bash
# Clone the repository
git clone https://github.com/irtassedat/qrmenu-backend.git
cd qrmenu-backend

# Install dependencies
npm install

# Set environment variables
cp .env.example .env
# Edit .env with your database credentials

# Create PostgreSQL database
createdb qrmenu

# Run migrations
psql -d qrmenu -f migrations/001_slug_and_permissions.sql
# ... run remaining migrations in order

# Start the server
npm start        # production
npm run dev      # development with nodemon
```

## Environment Variables

```env
PORT=3000
DATABASE_URL=postgresql://user:password@localhost:5432/qrmenu
JWT_SECRET=your-secret-key
MASTER_PASSWORD=your-master-password
```

## Project Structure

```
├── index.js              # Express server & middleware setup
├── db.js                 # PostgreSQL connection pool
├── routes/               # 21 API route modules
│   ├── auth.js
│   ├── brands.js
│   ├── branches.js
│   ├── products.js
│   ├── categories.js
│   ├── orders.js
│   ├── loyalty.js
│   ├── theme.js
│   ├── templates.js
│   └── ...
├── middleware/            # Express middleware
│   ├── authorizationMiddleware.js
│   ├── licenseCheck.js
│   └── validation.js
├── migrations/           # SQL schema migrations
└── uploads/              # User-uploaded files
```

## Related

- **Frontend**: [irtassedat/qrmenu-frontend](https://github.com/irtassedat/qrmenu-frontend)

## License

This project is proprietary software developed for SebastianLogic.
