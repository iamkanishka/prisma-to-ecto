# prisma-to-ecto

Convert **Prisma schemas** into **Elixir Ecto schemas and migrations**.

`prisma-to-ecto` is a CLI tool that reads a Prisma `schema.prisma` file and generates:

* Ecto schemas (`.ex`)
* Ecto migrations (`.exs`)
* Enum modules
* Join tables for implicit many-to-many relations
* View schema stubs

It helps teams migrating from **Prisma → Elixir / Phoenix / Ecto** or maintaining a **Prisma-first schema workflow**.

---

# Installation

## Global Installation (Recommended)

```bash
npm install -g prisma-to-ecto
```

Run the CLI:

```bash
prisma-to-ecto convert
```

---

## Local Installation

Install inside your project:

```bash
npm install --save-dev prisma-to-ecto
```

Run using `npx`:

```bash
npx prisma-to-ecto convert
```

---

# Project Structure

Your project only needs the Prisma schema.

Example:

```
my-project/
├── prisma/
│   └── schema.prisma
├── lib/
│   └── my_app/
├── priv/
│   └── repo/
│       └── migrations/
└── package.json
```

Only **`prisma/schema.prisma`** is required.

---

# Place Your Prisma Schema

Create the Prisma directory if it doesn't exist:

```bash
mkdir -p prisma
```

Place your schema at:

```
prisma/schema.prisma
```

---

# Running the Converter

## Default Conversion

```bash
npx prisma-to-ecto convert
```

Default output:

```
Schema: ./prisma/schema.prisma
Schemas → ./prisma-to-ecto/schemas
Migrations → ./prisma-to-ecto/migrations
```

---

## Custom Output Directories

```bash
npx prisma-to-ecto convert ./prisma/schema.prisma \
  --schema-out ./lib/my_app \
  --migration-out ./priv/repo/migrations
```

---

## Generate Schemas Only

```bash
npx prisma-to-ecto convert --no-migrations
```

---

## Generate Migrations Only

```bash
npx prisma-to-ecto convert --no-schemas
```

---

## CLI Help

```bash
npx prisma-to-ecto --help
```

---

# Example Output

```
prisma-to-ecto
  Schema:    ./prisma/schema.prisma
  Schemas →  ./lib/my_app
  Migrations → ./priv/repo/migrations

Parsed 20 model(s), 8 enum(s)

Generating Ecto schemas...
  ✓ user.ex
  ✓ task.ex
  ✓ project_stats.ex
  ... (28 total files)

Generating migrations...
  ✓ ..._create_users.exs
  ✓ ..._create_tasks.exs
  ✓ ..._create_label_task.exs
  ... (23 total files)

✓ Done!
```

---

# Generated Files

Example structure:

```
lib/my_app/
├── user.ex
├── task.ex
├── notification_preference.ex
├── audit_log.ex
└── user_role.ex

priv/repo/migrations/
├── ..._create_users.exs
├── ..._create_tasks.exs
├── ..._create_label_task.exs
└── ..._create_view_project_statses.exs
```

---

# Supported Prisma Features

The converter supports advanced Prisma schema features.

| Feature                   | Example                          |
| ------------------------- | -------------------------------- |
| UUID primary keys         | `@id @default(uuid())`           |
| Database schemas          | `@@schema("auth")`               |
| Referential actions       | `Cascade`, `SetNull`, `Restrict` |
| Named relations           | `Task.assignee`, `Task.reporter` |
| Self-referential models   | `Task.subtasks`                  |
| Database annotations      | `@db.VarChar(320)`               |
| Full-text indexes         | `@@fulltext`                     |
| Enum mapping              | `@map`                           |
| Composite primary keys    | `@@id([userId, channel])`        |
| Custom table names        | `@@map`                          |
| Views                     | `view ProjectStats`              |
| BigInt                    | `Attachment.sizeBytes`           |
| Decimal                   | `Invoice.amountCents`            |
| JSON fields               | `Json`                           |
| Implicit many-to-many     | `Task ↔ Label`                   |
| Sensitive field detection | password / secret / token        |

---

# Manual Review After Conversion

The generator may add `TODO` comments for items requiring manual review.

| Item           | Location             | Action                                  |
| -------------- | -------------------- | --------------------------------------- |
| Foreign keys   | `User.assignedTasks` | Set correct `foreign_key:`              |
| Database views | View migration       | Write SQL query                         |
| Enums          | Migrations           | Create Postgres enum type or use string |

---

# Example package.json Script

Add a shortcut command:

```json
{
  "scripts": {
    "convert": "prisma-to-ecto convert"
  }
}
```

Run with:

```bash
npm run convert
```

---

# Using With Phoenix / Ecto

After generating migrations:

```bash
mix ecto.migrate
```

---

# License

MIT
