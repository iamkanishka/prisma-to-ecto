# prisma-to-ecto — Setup & Testing Guide

## 1. Project Structure

Put all files like this inside your project folder:

```
my-converter/
├── prisma/
│   └── schema.prisma          ← put the schema here (see attached schema.prisma)
├── src/
│   ├── types.ts
│   ├── utils.ts
│   ├── parser.ts
│   ├── ectoGenerator.ts
│   ├── migrationGenerator.ts
│   └── index.ts
├── test/
│   └── run_tests.ts
├── tsconfig.json
├── tsconfig.test.json
└── package.json
```

---

## 2. Install Dependencies

```bash
mkdir my-converter && cd my-converter

# Init npm
npm init -y

# TypeScript + types
npm install --save-dev typescript @types/node ts-node

# Create tsconfig.json
cat > tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
EOF

# Create tsconfig.test.json
cat > tsconfig.test.json << 'EOF'
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist-test",
    "rootDir": "."
  },
  "include": ["src/**/*", "test/**/*"]
}
EOF
```

---

## 3. Add the Source Files

Copy all `.ts` files from this package into `src/` and `test/`:

```
src/types.ts
src/utils.ts
src/parser.ts
src/ectoGenerator.ts
src/migrationGenerator.ts
src/index.ts
test/run_tests.ts
```

---

## 4. Place the Schema

```bash
mkdir -p prisma
# Copy schema.prisma into prisma/schema.prisma
```

The schema (`schema.prisma`) is a real-world SaaS project management platform with:

| Feature                     | Example                                              |
|-----------------------------|------------------------------------------------------|
| **UUID primary keys**       | All models use `@id @default(uuid())`                |
| **`@@schema`**              | `User`, `Session`, `OAuthAccount`, `NotifPref` in `auth` schema |
| **Referential actions**     | `onDelete: Cascade`, `SetNull`, `Restrict`           |
| **Named relations**         | `Task` → `assignee`/`reporter` both point to `User`  |
| **Self-referential**        | `Task.subtasks`, `Comment.replies`                   |
| **`@db.*` annotations**     | `@db.VarChar(320)`, `@db.Text`, `@db.Decimal(10,2)` |
| **`@@index` with `map:`**   | All indexes have custom DB names                     |
| **`@@fulltext`**            | `Task` title + description full-text index           |
| **Enum `@map`**             | `TaskStatus.IN_PROGRESS @map("in_progress")`         |
| **Composite `@@id`**        | `NotificationPreference` on `[userId, channel]`      |
| **`@@unique` with `map:`**  | `OAuthAccount`, `OrgMembership`, etc.                |
| **`@@map` table override**  | `AuditLog` → `audit_logs` table                      |
| **`view` block**            | `ProjectStats` analytics view                        |
| **`BigInt`**                | `Attachment.sizeBytes`                               |
| **`Decimal`**               | `Organisation.storageGb`, `Invoice.amountCents`      |
| **`Json`**                  | `Task.metadata`, `Invoice.lineItems`                 |
| **Implicit many-to-many**   | `Task ↔ Label` (no join model in schema)             |
| **Sensitive field redaction** | `passwordHash`, `apiSecret`, `secret`, `token`     |

---

## 5. Run the Converter

```bash
# Compile TypeScript
npx tsc

# Convert with defaults (reads ./prisma/schema.prisma)
node dist/index.js convert

# Or with explicit paths
node dist/index.js convert ./prisma/schema.prisma \
  --schema-out ./lib/my_app \
  --migration-out ./priv/repo/migrations

# Schemas only (skip migrations)
node dist/index.js convert --no-migrations

# Migrations only (skip schemas)
node dist/index.js convert --no-schemas

# Help
node dist/index.js --help
```

**Expected output:**
```
prisma-to-ecto
  Schema:    ./prisma/schema.prisma
  Schemas →  ./prisma-to-ecto/schemas
  Migrations → ./prisma-to-ecto/migrations

Parsed 20 model(s), 8 enum(s)

Generating Ecto schemas...
  ✓ prisma-to-ecto/schemas/user.ex
  ✓ prisma-to-ecto/schemas/task.ex
  ... (28 total files)

Generating migrations...
  ✓ prisma-to-ecto/migrations/..._create_users.exs
  ✓ prisma-to-ecto/migrations/..._create_tasks.exs
  ... (23 total files)

✓ Done!
```

---

## 6. Run the Test Suite

```bash
# Compile tests
npx tsc -p tsconfig.test.json

# Run all 197 tests
node dist-test/test/run_tests.js
```

**Expected output:**
```
Results: 197 passed, 0 failed
```

Or add npm scripts to `package.json`:
```json
{
  "scripts": {
    "build":    "tsc",
    "build:test": "tsc -p tsconfig.test.json",
    "test":     "npm run build:test && node dist-test/test/run_tests.js",
    "convert":  "npm run build && node dist/index.js convert"
  }
}
```

Then just:
```bash
npm test
npm run convert
```

---

## 7. Output Locations

After running, you'll find:

```
prisma-to-ecto/
├── schemas/
│   ├── user.ex                    ← Ecto schema with @schema_prefix "auth"
│   ├── task.ex                    ← Named relations, self-ref, fulltext note
│   ├── project_stats.ex           ← Read-only view schema
│   ├── notification_preference.ex ← Composite @primary_key false
│   ├── audit_log.ex               ← @@map table name override
│   ├── user_role.ex               ← EctoEnum module
│   └── ... (28 files total)
└── migrations/
    ├── ..._create_users.exs       ← UUID PK, size: constraints, prefix:
    ├── ..._create_tasks.exs       ← onDelete:, fulltext index, named indexes
    ├── ..._create_label_task.exs  ← Implicit many-to-many join table
    ├── ..._create_view_project_statses.exs  ← CREATE VIEW SQL stub
    └── ... (23 files total)
```

---

## 8. What to Manually Review After Conversion

The converter flags these with `TODO` comments:

| Item | Where | What to do |
|------|-------|------------|
| `TODO_set_correct_fk` | `has_many` on `User` (assignedTasks / reportedTasks) | Set the correct `foreign_key:` for each named relation |
| `CREATE OR REPLACE VIEW ... SELECT ...` | View migration | Write the actual SQL query for `ProjectStats` |
| Enum DB type in Postgres | Migrations use `:string` for enum columns | Run `CREATE TYPE` in Postgres or use string check constraints |