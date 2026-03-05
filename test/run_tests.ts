// test/run_tests.ts
// Comprehensive automated test suite for prisma-to-ecto
// Run with: npx ts-node test/run_tests.ts

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { parsePrismaSchema } from "../src/parser";
import { generateEctoSchema } from "../src/ectoGenerator";
import { generateMigrationFiles } from "../src/migrationGenerator";
import { ParsedSchema } from "../src/types";

// ─────────────────────────────────────────────────────────────────────────────
// Tiny test framework
// ─────────────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    passed++;
  } catch (e: any) {
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`      → ${e.message}`);
    failures.push(`${name}: ${e.message}`);
    failed++;
  }
}

function group(name: string, fn: () => void) {
  console.log(`\n\x1b[1m${name}\x1b[0m`);
  fn();
}

function expect(actual: any) {
  return {
    toBe(expected: any) {
      if (actual !== expected)
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    },
    toContain(substr: string) {
      if (!String(actual).includes(substr))
        throw new Error(`Expected output to contain:\n  "${substr}"\n  Got:\n  "${String(actual).slice(0, 400)}"`);
    },
    notToContain(substr: string) {
      if (String(actual).includes(substr))
        throw new Error(`Expected output NOT to contain: "${substr}"`);
    },
    toEqual(expected: any) {
      const a = JSON.stringify(actual);
      const b = JSON.stringify(expected);
      if (a !== b) throw new Error(`Expected ${b}, got ${a}`);
    },
    toBeTruthy() {
      if (!actual) throw new Error(`Expected truthy, got ${actual}`);
    },
    toBeFalsy() {
      if (actual) throw new Error(`Expected falsy, got ${actual}`);
    },
    toHaveLength(n: number) {
      if ((actual as any[]).length !== n)
        throw new Error(`Expected length ${n}, got ${(actual as any[]).length}`);
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseSchema(prisma: string): ParsedSchema {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pte-test-"));
  const schemaPath = path.join(tmp, "schema.prisma");
  fs.writeFileSync(schemaPath, prisma, "utf8");
  const result = parsePrismaSchema(schemaPath);
  fs.rmSync(tmp, { recursive: true });
  return result;
}

function generateAll(prisma: string): { schemas: Record<string, string>; migrations: Record<string, string> } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pte-gen-"));
  const schemaPath = path.join(tmp, "schema.prisma");
  const schemaOut = path.join(tmp, "schemas");
  const migOut = path.join(tmp, "migrations");
  fs.writeFileSync(schemaPath, prisma, "utf8");

  const schema = parsePrismaSchema(schemaPath);
  generateEctoSchema(schema, schemaOut);
  generateMigrationFiles(schema, migOut);

  const schemas: Record<string, string> = {};
  const migrations: Record<string, string> = {};

  if (fs.existsSync(schemaOut)) {
    for (const f of fs.readdirSync(schemaOut)) {
      schemas[f] = fs.readFileSync(path.join(schemaOut, f), "utf8");
    }
  }
  if (fs.existsSync(migOut)) {
    for (const f of fs.readdirSync(migOut)) {
      migrations[f] = fs.readFileSync(path.join(migOut, f), "utf8");
    }
  }

  fs.rmSync(tmp, { recursive: true });
  return { schemas, migrations };
}

function schemaFile(schemas: Record<string, string>, name: string): string {
  const key = Object.keys(schemas).find((k) => k === `${name}.ex`);
  if (!key) throw new Error(`Schema file ${name}.ex not found. Files: ${Object.keys(schemas).join(", ")}`);
  return schemas[key];
}

function migFile(migrations: Record<string, string>, tableSubstr: string): string {
  const key = Object.keys(migrations).find((k) => k.includes(`create_${tableSubstr}`));
  if (!key) throw new Error(`Migration for ${tableSubstr} not found. Files: ${Object.keys(migrations).join(", ")}`);
  return migrations[key];
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST SUITE
// ─────────────────────────────────────────────────────────────────────────────

// ── GROUP 1: Parser – field types ────────────────────────────────────────────

group("Parser: scalar field types", () => {
  const schema = parseSchema(`
    model AllScalars {
      id        Int      @id @default(autoincrement())
      strF      String
      intF      Int
      floatF    Float
      boolF     Boolean
      dtF       DateTime
      jsonF     Json
      decF      Decimal
      bigF      BigInt
      bytF      Bytes
    }
  `);
  const m = schema.models[0];

  test("parses all 9 scalar types", () => {
    const types = m.fields.filter(f => !f.isId).map(f => f.type);
    expect(types).toEqual(["String","Int","Float","Boolean","DateTime","Json","Decimal","BigInt","Bytes"]);
  });

  test("marks all as isScalar=true", () => {
    expect(m.fields.every(f => f.isScalar)).toBe(true);
  });
});

// ── GROUP 2: Parser – optional and array fields ───────────────────────────────

group("Parser: optional and array modifiers", () => {
  const schema = parseSchema(`
    model Modifiers {
      id        Int      @id @default(autoincrement())
      required  String
      optional  String?
      array     String[]
      optArray  String[]
    }
  `);
  const m = schema.models[0];
  const byName = (n: string) => m.fields.find(f => f.name === n)!;

  test("required field: isOptional=false", () => expect(byName("required").isOptional).toBe(false));
  test("optional field: isOptional=true",  () => expect(byName("optional").isOptional).toBe(true));
  test("array field: isArray=true",         () => expect(byName("array").isArray).toBe(true));
  test("required field: isArray=false",     () => expect(byName("required").isArray).toBe(false));
});

// ── GROUP 3: Parser – @default variants ──────────────────────────────────────

group("Parser: @default variants", () => {
  const schema = parseSchema(`
    model Defaults {
      id       Int      @id @default(autoincrement())
      uuid     String   @default(uuid())
      cuid     String   @default(cuid())
      nowDt    DateTime @default(now())
      litStr   String   @default("hello")
      litInt   Int      @default(42)
      litBool  Boolean  @default(true)
      litDec   Decimal  @default(3.14)
      dbgen    String   @default(dbgenerated("gen_random_uuid()::text"))
      dbNested String   @default(dbgenerated("(now() AT TIME ZONE 'utc')"))
    }
  `);
  const m = schema.models[0];
  const f = (n: string) => m.fields.find(x => x.name === n)!;

  test("autoincrement",           () => expect(f("id").default?.kind).toBe("autoincrement"));
  test("uuid()",                  () => expect(f("uuid").default?.kind).toBe("uuid"));
  test("cuid()",                  () => expect(f("cuid").default?.kind).toBe("cuid"));
  test("now()",                   () => expect(f("nowDt").default?.kind).toBe("now"));
  test("string literal",          () => { expect(f("litStr").default?.kind).toBe("literal"); expect(f("litStr").default?.value).toBe("hello"); });
  test("integer literal",         () => { expect(f("litInt").default?.kind).toBe("literal"); expect(f("litInt").default?.value).toBe("42"); });
  test("boolean literal",         () => { expect(f("litBool").default?.kind).toBe("literal"); expect(f("litBool").default?.value).toBe("true"); });
  test("decimal literal",         () => { expect(f("litDec").default?.kind).toBe("literal"); expect(f("litDec").default?.value).toBe("3.14"); });
  test("dbgenerated simple",      () => { expect(f("dbgen").default?.kind).toBe("dbgenerated"); expect(f("dbgen").default?.value).toBe("gen_random_uuid()::text"); });
  test("dbgenerated nested parens", () => { expect(f("dbNested").default?.kind).toBe("dbgenerated"); expect(f("dbNested").default?.value).toContain("now()"); });
});

// ── GROUP 4: Parser – @id variants ───────────────────────────────────────────

group("Parser: @id kinds", () => {
  const schema = parseSchema(`
    model A { id Int    @id @default(autoincrement()) name String }
    model B { id String @id @default(uuid())          name String }
    model C { id String @id @default(cuid())          name String }
    model D { id String @id                           name String }
  `);

  test("autoincrement idKind", () => expect(schema.models[0].fields[0].idKind).toBe("autoincrement"));
  test("uuid idKind",          () => expect(schema.models[1].fields[0].idKind).toBe("uuid"));
  test("cuid idKind",          () => expect(schema.models[2].fields[0].idKind).toBe("cuid"));
  test("string idKind",        () => expect(schema.models[3].fields[0].idKind).toBe("string"));
});

// ── GROUP 5: Parser – relations ───────────────────────────────────────────────

group("Parser: relations", () => {
  const schema = parseSchema(`
    model User {
      id      Int     @id @default(autoincrement())
      posts   Post[]
      profile Profile?
    }
    model Post {
      id       Int    @id @default(autoincrement())
      userId   Int
      user     User   @relation(fields: [userId], references: [id])
      tags     Tag[]
    }
    model Profile {
      id     Int  @id @default(autoincrement())
      userId Int  @unique
      user   User @relation(fields: [userId], references: [id])
    }
    model Tag {
      id    Int    @id @default(autoincrement())
      posts Post[]
    }
  `);

  const user = schema.models.find(m => m.name === "User")!;
  const post = schema.models.find(m => m.name === "Post")!;

  test("has_many detected",       () => expect(user.fields.find(f => f.name === "posts")?.relation?.kind).toBe("one-to-many"));
  test("has_one detected",        () => expect(user.fields.find(f => f.name === "profile")?.relation?.kind).toBe("one-to-one"));
  test("belongs_to isOwner",      () => expect(post.fields.find(f => f.name === "user")?.relation?.isOwner).toBe(true));
  test("belongs_to fields",       () => expect(post.fields.find(f => f.name === "user")?.relation?.fields).toEqual(["userId"]));
  test("FK scalar isForeignKey",  () => expect(post.fields.find(f => f.name === "userId")?.isForeignKey).toBe(true));
  test("non-FK not marked",       () => expect(post.fields.find(f => f.name === "id")?.isForeignKey).toBe(false));
});

// ── GROUP 6: Parser – named relations ────────────────────────────────────────

group("Parser: named relations", () => {
  const schema = parseSchema(`
    model User {
      id               Int      @id @default(autoincrement())
      sentMessages     Message[] @relation("Sender")
      receivedMessages Message[] @relation("Receiver")
    }
    model Message {
      id         Int  @id @default(autoincrement())
      senderId   Int
      receiverId Int
      sender     User @relation("Sender",   fields: [senderId],   references: [id])
      receiver   User @relation("Receiver", fields: [receiverId], references: [id])
    }
  `);

  const msg = schema.models.find(m => m.name === "Message")!;
  const sender = msg.fields.find(f => f.name === "sender")!;
  const receiver = msg.fields.find(f => f.name === "receiver")!;

  test("sender relation name",   () => expect(sender.relation?.name).toBe("Sender"));
  test("receiver relation name", () => expect(receiver.relation?.name).toBe("Receiver"));
  test("sender fields",          () => expect(sender.relation?.fields).toEqual(["senderId"]));
  test("receiver fields",        () => expect(receiver.relation?.fields).toEqual(["receiverId"]));
  test("both are owners",        () => { expect(sender.relation?.isOwner).toBe(true); expect(receiver.relation?.isOwner).toBe(true); });
});

// ── GROUP 7: Parser – self-referential ───────────────────────────────────────

group("Parser: self-referential model", () => {
  const schema = parseSchema(`
    model Comment {
      id       Int       @id @default(autoincrement())
      body     String
      parentId Int?
      parent   Comment?  @relation("Replies", fields: [parentId], references: [id])
      replies  Comment[] @relation("Replies")
    }
  `);
  const m = schema.models[0];

  test("parentId is FK",    () => expect(m.fields.find(f => f.name === "parentId")?.isForeignKey).toBe(true));
  test("parent is owner",   () => expect(m.fields.find(f => f.name === "parent")?.relation?.isOwner).toBe(true));
  test("replies not owner", () => expect(m.fields.find(f => f.name === "replies")?.relation?.isOwner).toBe(false));
  test("replies is array",  () => expect(m.fields.find(f => f.name === "replies")?.isArray).toBe(true));
});

// ── GROUP 8: Parser – enums ───────────────────────────────────────────────────

group("Parser: enums", () => {
  const schema = parseSchema(`
    enum Status { ACTIVE INACTIVE PENDING_REVIEW }
    enum Color  { RED GREEN BLUE }
    model Thing {
      id     Int    @id @default(autoincrement())
      status Status @default(ACTIVE)
      color  Color?
    }
  `);

  test("two enums parsed",         () => expect(schema.enums).toHaveLength(2));
  test("enum values correct",      () => expect(schema.enums[0].values.map(v=>v.name)).toEqual(["ACTIVE","INACTIVE","PENDING_REVIEW"]));
  test("enum field type encoded",  () => expect(schema.models[0].fields.find(f => f.name === "status")?.type).toBe("Ecto.Enum:Status"));
  test("enum field isScalar=true", () => expect(schema.models[0].fields.find(f => f.name === "status")?.isScalar).toBe(true));
  test("enum default preserved",   () => expect(schema.models[0].fields.find(f => f.name === "status")?.default?.value).toBe("ACTIVE"));
  test("optional enum",            () => expect(schema.models[0].fields.find(f => f.name === "color")?.isOptional).toBe(true));
});

// ── GROUP 9: Parser – block-level attributes ──────────────────────────────────

group("Parser: @@map, @@id, @@unique, @@index", () => {
  const schema = parseSchema(`
    model Lookup {
      tenantId String
      key      String
      value    String
      @@id([tenantId, key])
      @@unique([tenantId, value])
      @@index([key])
      @@map("lookup_entries")
    }
  `);
  const m = schema.models[0];

  test("@@map parsed",        () => expect(m.tableName).toBe("lookup_entries"));
  test("@@id parsed",         () => expect(m.compoundId).toEqual(["tenantId","key"]));
  test("@@unique parsed",     () => expect(m.compoundUniques[0].fields).toEqual(["tenantId","value"]));
  test("@@index parsed",      () => expect(m.indexes[0].fields).toEqual(["key"]));
});

// ── GROUP 10: Parser – @ignore ────────────────────────────────────────────────

group("Parser: @ignore field", () => {
  const schema = parseSchema(`
    model Widget {
      id      Int    @id @default(autoincrement())
      name    String
      secret  String @ignore
      cache   Json?  @ignore
    }
  `);
  const m = schema.models[0];

  test("@ignore fields excluded",  () => expect(m.fields.find(f => f.name === "secret")).toBe(undefined));
  test("@ignore optional excluded",() => expect(m.fields.find(f => f.name === "cache")).toBe(undefined));
  test("non-ignored field kept",   () => expect(m.fields.find(f => f.name === "name")).toBeTruthy());
});

// ── GROUP 11: Parser – @map field ────────────────────────────────────────────

group("Parser: @map on fields", () => {
  const schema = parseSchema(`
    model User {
      id       Int    @id @default(autoincrement())
      userName String @map("user_name")
      zipCode  String @map("zip")
    }
  `);
  const m = schema.models[0];

  test("@map value stored",    () => expect(m.fields.find(f => f.name === "userName")?.columnName).toBe("user_name"));
  test("@map zip stored",      () => expect(m.fields.find(f => f.name === "zipCode")?.columnName).toBe("zip"));
  test("no @map = undefined",  () => expect(m.fields.find(f => f.name === "id")?.columnName).toBe(undefined));
});

// ── GROUP 12: Parser – @updatedAt / createdAt skipped ────────────────────────

group("Parser: timestamp field exclusion", () => {
  const schema = parseSchema(`
    model Post {
      id        Int      @id @default(autoincrement())
      title     String
      createdAt DateTime @default(now())
      updatedAt DateTime @updatedAt
    }
  `);
  const m = schema.models[0];

  test("createdAt excluded", () => expect(m.fields.find(f => f.name === "createdAt")).toBe(undefined));
  test("updatedAt excluded", () => expect(m.fields.find(f => f.name === "updatedAt")).toBe(undefined));
  test("other fields kept",  () => expect(m.fields.find(f => f.name === "title")).toBeTruthy());
});

// ── GROUP 13: Parser – @db.* annotations (should be ignored) ─────────────────

group("Parser: @db.* native type annotations ignored", () => {
  const schema = parseSchema(`
    model Product {
      id    Int    @id @default(autoincrement())
      name  String @db.VarChar(255)
      price Float  @db.DoublePrecision
      data  Bytes  @db.ByteA
    }
  `);
  const m = schema.models[0];

  test("@db.VarChar field still parsed", () => expect(m.fields.find(f => f.name === "name")?.type).toBe("String"));
  test("@db.DoublePrecision parsed",     () => expect(m.fields.find(f => f.name === "price")?.type).toBe("Float"));
  test("field count correct",            () => expect(m.fields).toHaveLength(4));
});

// ── GROUP 14: Parser – comments in schema ────────────────────────────────────

group("Parser: schema with comments", () => {
  const schema = parseSchema(`
    // This is a top-level comment
    model Article {
      id      Int    @id @default(autoincrement()) // inline comment
      // full line comment
      title   String
      body    String?
    }
  `);
  const m = schema.models[0];

  test("model parsed despite comments",  () => expect(m.name).toBe("Article"));
  test("fields parsed correctly",        () => expect(m.fields).toHaveLength(3));
  test("title field present",            () => expect(m.fields.find(f => f.name === "title")).toBeTruthy());
});

// ── GROUP 15: Ecto Generator – basic schema output ───────────────────────────

group("EctoGenerator: basic schema", () => {
  const { schemas } = generateAll(`
    model User {
      id    Int    @id @default(autoincrement())
      email String @unique
      name  String?
    }
  `);
  const s = schemaFile(schemas, "user");

  test("defmodule present",           () => expect(s).toContain("defmodule MyApp.User do"));
  test("use Ecto.Schema",             () => expect(s).toContain("use Ecto.Schema"));
  test("import Ecto.Changeset",       () => expect(s).toContain("import Ecto.Changeset"));
  test("schema table name",           () => expect(s).toContain('schema "users" do'));
  test("email field",                 () => expect(s).toContain("field :email, :string"));
  test("optional name field",         () => expect(s).toContain("field :name, :string"));
  test("timestamps present",          () => expect(s).toContain("timestamps(type: :utc_datetime)"));
  test("changeset function",          () => expect(s).toContain("def changeset(user, attrs) do"));
  test("cast includes email",         () => expect(s).toContain(":email"));
  test("validate_required has email", () => expect(s).toContain("validate_required"));
  test("unique_constraint for email", () => expect(s).toContain("unique_constraint(:email)"));
  test("no @id field as plain field", () => expect(s).notToContain("field :id,"));
});

// ── GROUP 16: Ecto Generator – UUID primary key ───────────────────────────────

group("EctoGenerator: UUID primary key", () => {
  const { schemas, migrations } = generateAll(`
    model Token {
      id    String @id @default(uuid())
      value String
    }
  `);
  const s = schemaFile(schemas, "token");
  const mig = migFile(migrations, "tokens");

  test("@primary_key binary_id",       () => expect(s).toContain("@primary_key {:id, :binary_id, autogenerate: true}"));
  test("@foreign_key_type binary_id",  () => expect(s).toContain("@foreign_key_type :binary_id"));
  test("migration adds uuid id col",   () => expect(mig).toContain("add :id, :uuid, primary_key: true"));
  test("migration uses gen_random_uuid",() => expect(mig).toContain("gen_random_uuid()"));
});

// ── GROUP 17: Ecto Generator – cuid primary key ───────────────────────────────

group("EctoGenerator: cuid primary key", () => {
  const { schemas } = generateAll(`
    model Session {
      id    String @id @default(cuid())
      token String
    }
  `);
  const s = schemaFile(schemas, "session");

  test("@primary_key string no autogenerate", () => expect(s).toContain("@primary_key {:id, :string, autogenerate: false}"));
});

// ── GROUP 18: Ecto Generator – belongs_to / has_many / has_one ───────────────

group("EctoGenerator: relations", () => {
  const { schemas } = generateAll(`
    model User {
      id      Int     @id @default(autoincrement())
      posts   Post[]
      profile Profile?
    }
    model Post {
      id     Int  @id @default(autoincrement())
      userId Int
      user   User @relation(fields: [userId], references: [id])
    }
    model Profile {
      id     Int  @id @default(autoincrement())
      userId Int  @unique
      user   User @relation(fields: [userId], references: [id])
    }
  `);

  test("User has_many posts",       () => expect(schemaFile(schemas, "user")).toContain("has_many :posts, MyApp.Post"));
  test("User has_one profile",      () => expect(schemaFile(schemas, "user")).toContain("has_one :profile, MyApp.Profile"));
  test("Post belongs_to user",      () => expect(schemaFile(schemas, "post")).toContain("belongs_to :user, MyApp.User"));
  test("Post no plain userId field",() => expect(schemaFile(schemas, "post")).notToContain("field :user_id"));
  test("Profile belongs_to user",   () => expect(schemaFile(schemas, "profile")).toContain("belongs_to :user, MyApp.User"));
});

// ── GROUP 19: Ecto Generator – optional belongs_to ────────────────────────────

group("EctoGenerator: optional belongs_to", () => {
  const { schemas } = generateAll(`
    model Task {
      id       Int  @id @default(autoincrement())
      title    String
      userId   Int?
      user     User? @relation(fields: [userId], references: [id])
    }
    model User { id Int @id @default(autoincrement()) tasks Task[] }
  `);
  const s = schemaFile(schemas, "task");

  test("optional belongs_to has required: false", () => expect(s).toContain("belongs_to :user, MyApp.User, required: false"));
});

// ── GROUP 20: Ecto Generator – non-standard FK column name ────────────────────

group("EctoGenerator: non-standard FK foreign_key opt", () => {
  const { schemas } = generateAll(`
    model Order {
      id         Int  @id @default(autoincrement())
      customerId Int
      buyer      User @relation(fields: [customerId], references: [id])
    }
    model User { id Int @id @default(autoincrement()) orders Order[] }
  `);
  const s = schemaFile(schemas, "order");

  test("foreign_key opt when FK name != assoc_id", () => expect(s).toContain("foreign_key: :customer_id"));
});

// ── GROUP 21: Ecto Generator – enum fields ────────────────────────────────────

group("EctoGenerator: enum fields", () => {
  const { schemas } = generateAll(`
    enum Role { ADMIN USER GUEST }
    model Account {
      id   Int  @id @default(autoincrement())
      role Role @default(USER)
    }
  `);
  const s = schemaFile(schemas, "account");
  const e = schemaFile(schemas, "role");

  test("enum schema file generated",  () => expect(e).toContain("defmodule MyApp.Enums.Role do"));
  test("use EctoEnum in enum file",   () => expect(e).toContain("use EctoEnum"));
  test("enum atom values in module",  () => expect(e).toContain(":admin"));
  test("field uses Ecto.Enum",        () => expect(s).toContain("Ecto.Enum, values: MyApp.Enums.Role"));
  test("validate_inclusion for enum", () => expect(s).toContain("validate_inclusion(:role"));
});

// ── GROUP 22: Ecto Generator – composite PK ───────────────────────────────────

group("EctoGenerator: composite PK (@@id)", () => {
  const { schemas } = generateAll(`
    model UserRole {
      userId Int
      roleId Int
      @@id([userId, roleId])
    }
  `);
  const s = schemaFile(schemas, "user_role");

  test("@primary_key false",             () => expect(s).toContain("@primary_key false"));
  test("no plain PK field declaration",  () => expect(s).notToContain("field :id,"));
});

// ── GROUP 23: Ecto Generator – @@map table name ───────────────────────────────

group("EctoGenerator: @@map table name override", () => {
  const { schemas } = generateAll(`
    model AuditEvent {
      id Int @id @default(autoincrement())
      action String
      @@map("audit_events_log")
    }
  `);
  const s = schemaFile(schemas, "audit_event");

  test("@@map overrides table name", () => expect(s).toContain('schema "audit_events_log" do'));
  test("no auto-pluralized name",    () => expect(s).notToContain('"audit_events"'));
});

// ── GROUP 24: Ecto Generator – @map field (source:) ──────────────────────────

group("EctoGenerator: @map on field (source:)", () => {
  const { schemas } = generateAll(`
    model User {
      id       Int    @id @default(autoincrement())
      userName String @map("user_name")
    }
  `);
  const s = schemaFile(schemas, "user");

  // When @map alias matches snake_case of field name exactly, no source: needed
  test("field name is snake_cased map value", () => expect(s).toContain("field :user_name, :string"));
  // source: only when DB col differs from Elixir atom
  test("no redundant source: when names match", () => expect(s).notToContain("source: :user_name"));
});

// ── GROUP 25: Ecto Generator – @map field where names differ ─────────────────

group("EctoGenerator: @map with genuinely different column name", () => {
  const { schemas } = generateAll(`
    model User {
      id      Int    @id @default(autoincrement())
      zipCode String @map("zip")
    }
  `);
  const s = schemaFile(schemas, "user");

  test("field uses mapped column as atom", () => expect(s).toContain("field :zip, :string"));
});

// ── GROUP 26: Ecto Generator – named relations produce comments ───────────────

group("EctoGenerator: named relation comments", () => {
  const { schemas } = generateAll(`
    model User {
      id       Int      @id @default(autoincrement())
      created  Ticket[] @relation("Creator")
      assigned Ticket[] @relation("Assignee")
    }
    model Ticket {
      id         Int  @id @default(autoincrement())
      creatorId  Int
      assigneeId Int?
      creator    User @relation("Creator",  fields: [creatorId],  references: [id])
      assignee   User? @relation("Assignee", fields: [assigneeId], references: [id])
    }
  `);
  const ticket = schemaFile(schemas, "ticket");
  const user   = schemaFile(schemas, "user");

  test("ticket belongs_to creator comment",         () => expect(ticket).toContain('Named relation: "Creator"'));
  test("ticket belongs_to assignee comment",        () => expect(ticket).toContain('Named relation: "Assignee"'));
  test("user has_many with foreign_key TODO",       () => expect(user).toContain("foreign_key: :TODO_set_correct_fk"));
  test("no Elixir-invalid trailing comma comment",  () => expect(ticket).notToContain(', # relation:'));
});

// ── GROUP 27: Ecto Generator – self-referential model ────────────────────────

group("EctoGenerator: self-referential", () => {
  const { schemas } = generateAll(`
    model Category {
      id       Int        @id @default(autoincrement())
      name     String
      parentId Int?
      parent   Category?  @relation("Tree", fields: [parentId], references: [id])
      children Category[] @relation("Tree")
    }
  `);
  const s = schemaFile(schemas, "category");

  test("belongs_to self",          () => expect(s).toContain("belongs_to :parent, MyApp.Category"));
  test("has_many self",            () => expect(s).toContain("has_many :children, MyApp.Category"));
  test("no plain parent_id field", () => expect(s).notToContain("field :parent_id"));
});

// ── GROUP 28: Ecto Generator – field defaults in schema ──────────────────────

group("EctoGenerator: field defaults emitted", () => {
  const { schemas } = generateAll(`
    model Config {
      id      Int     @id @default(autoincrement())
      active  Boolean @default(false)
      count   Int     @default(0)
      label   String  @default("default_label")
      score   Float   @default(1.5)
    }
  `);
  const s = schemaFile(schemas, "config");

  test("boolean default false",    () => expect(s).toContain("default: false"));
  test("integer default 0",        () => expect(s).toContain("default: 0"));
  test("string default",           () => expect(s).toContain('default: "default_label"'));
  test("float default",            () => expect(s).toContain("default: 1.5"));
});

// ── GROUP 29: Ecto Generator – validate_required excludes optional ────────────

group("EctoGenerator: validate_required only required fields", () => {
  const { schemas } = generateAll(`
    model Article {
      id      Int     @id @default(autoincrement())
      title   String
      body    String?
      draft   Boolean @default(true)
    }
  `);
  const s = schemaFile(schemas, "article");

  test("title in validate_required", () => {
    const reqLine = s.split("\n").find(l => l.includes("validate_required"))!;
    expect(reqLine).toContain(":title");
  });
  test("body NOT in validate_required", () => {
    const reqLine = s.split("\n").find(l => l.includes("validate_required"))!;
    expect(reqLine).notToContain(":body");
  });
});

// ── GROUP 30: Migration Generator – basic migration ───────────────────────────

group("MigrationGenerator: basic migration", () => {
  const { migrations } = generateAll(`
    model Post {
      id      Int     @id @default(autoincrement())
      title   String
      body    String?
      views   Int     @default(0)
      active  Boolean @default(true)
    }
  `);
  const mig = migFile(migrations, "posts");

  test("defmodule present",       () => expect(mig).toContain("defmodule MyApp.Repo.Migrations.CreatePost do"));
  test("use Ecto.Migration",      () => expect(mig).toContain("use Ecto.Migration"));
  test("create table posts",      () => expect(mig).toContain("create table(:posts)"));
  test("title not null",          () => expect(mig).toContain("add :title, :string, null: false"));
  test("body null: true",         () => expect(mig).toContain("add :body, :string, null: true"));
  test("views default 0",         () => expect(mig).toContain("default: 0"));
  test("active default true",     () => expect(mig).toContain("default: true"));
  test("timestamps present",      () => expect(mig).toContain("timestamps(type: :utc_datetime)"));
  test("no id column emitted",    () => expect(mig).notToContain("add :id, :integer"));
});

// ── GROUP 31: Migration Generator – FK references ────────────────────────────

group("MigrationGenerator: FK references", () => {
  const { migrations } = generateAll(`
    model User { id Int @id @default(autoincrement()) posts Post[] }
    model Post {
      id     Int  @id @default(autoincrement())
      userId Int
      user   User @relation(fields: [userId], references: [id])
    }
  `);
  const mig = migFile(migrations, "posts");

  test("references users table",      () => expect(mig).toContain("references(:users,"));
  test("on_delete: :nothing",         () => expect(mig).toContain("on_delete: :nothing"));
  test("FK not null",                 () => expect(mig).toContain("null: false"));
  test("no plain userId column",      () => expect(mig).notToContain("add :user_id, :integer"));
});

// ── GROUP 32: Migration Generator – optional FK ───────────────────────────────

group("MigrationGenerator: optional FK is null: true", () => {
  const { migrations } = generateAll(`
    model Post {
      id       Int   @id @default(autoincrement())
      title    String
      authorId Int?
      author   User? @relation(fields: [authorId], references: [id])
    }
    model User { id Int @id @default(autoincrement()) posts Post[] }
  `);
  const mig = migFile(migrations, "posts");

  test("optional FK references users", () => expect(mig).toContain("references(:users"));
  test("optional FK is null: true", () => expect(mig).toContain("null: true"));
});

// ── GROUP 33: Migration Generator – UUID FK references ───────────────────────

group("MigrationGenerator: UUID FK type propagation", () => {
  const { migrations } = generateAll(`
    model Org { id String @id @default(uuid()) name String members Member[] }
    model Member {
      id    Int    @id @default(autoincrement())
      orgId String
      org   Org    @relation(fields: [orgId], references: [id])
    }
  `);
  const mig = migFile(migrations, "members");

  test("references orgs with type: :uuid", () => expect(mig).toContain("type: :uuid"));
});

// ── GROUP 34: Migration Generator – all scalar types ─────────────────────────

group("MigrationGenerator: all scalar migration types", () => {
  const { migrations } = generateAll(`
    model AllTypes {
      id   Int      @id @default(autoincrement())
      str  String
      int  Int
      flt  Float
      bool Boolean
      dt   DateTime
      json Json
      dec  Decimal
      big  BigInt
      byt  Bytes
    }
  `);
  const mig = migFile(migrations, "all_types");

  test(":string",       () => expect(mig).toContain(":string"));
  test(":integer",      () => expect(mig).toContain(":integer"));
  test(":float",        () => expect(mig).toContain(":float"));
  test(":boolean",      () => expect(mig).toContain(":boolean"));
  test(":utc_datetime", () => expect(mig).toContain(":utc_datetime"));
  test(":map",          () => expect(mig).toContain(":map"));
  test(":decimal",      () => expect(mig).toContain(":decimal"));
  test(":bigint",       () => expect(mig).toContain(":bigint"));
  test(":binary",       () => expect(mig).toContain(":binary"));
});

// ── GROUP 35: Migration Generator – composite PK ─────────────────────────────

group("MigrationGenerator: composite PK", () => {
  const { migrations } = generateAll(`
    model UserTag {
      userId Int
      tagId  Int
      @@id([userId, tagId])
    }
  `);
  const mig = migFile(migrations, "user_tags");

  test("primary_key: false on table",  () => expect(mig).toContain("primary_key: false"));
  test("userId column present",        () => expect(mig).toContain(":user_id"));
  test("tagId column present",         () => expect(mig).toContain(":tag_id"));
});

// ── GROUP 36: Migration Generator – @@unique → unique_index ──────────────────

group("MigrationGenerator: @@unique creates unique_index", () => {
  const { migrations } = generateAll(`
    model Subscription {
      id     Int @id @default(autoincrement())
      userId Int
      planId Int
      @@unique([userId, planId])
    }
  `);
  const mig = migFile(migrations, "subscriptions");

  test("unique_index on [userId, planId]", () => expect(mig).toContain("create unique_index(:subscriptions, [:user_id, :plan_id])"));
});

// ── GROUP 37: Migration Generator – @unique → unique_index ───────────────────

group("MigrationGenerator: @unique field creates unique_index", () => {
  const { migrations } = generateAll(`
    model User {
      id    Int    @id @default(autoincrement())
      email String @unique
      slug  String @unique
    }
  `);
  const mig = migFile(migrations, "users");

  test("unique_index for email", () => expect(mig).toContain("create unique_index(:users, [:email])"));
  test("unique_index for slug",  () => expect(mig).toContain("create unique_index(:users, [:slug])"));
});

// ── GROUP 38: Migration Generator – @@index ───────────────────────────────────

group("MigrationGenerator: @@index creates index", () => {
  const { migrations } = generateAll(`
    model Post {
      id       Int @id @default(autoincrement())
      authorId Int
      status   String
      @@index([authorId, status])
    }
  `);
  const mig = migFile(migrations, "posts");

  test("index created", () => expect(mig).toContain("create index(:posts, [:author_id, :status])"));
});

// ── GROUP 39: Migration Generator – topological sort ─────────────────────────

group("MigrationGenerator: topological sort (dep before dependent)", () => {
  const { migrations } = generateAll(`
    model Comment {
      id     Int  @id @default(autoincrement())
      postId Int
      post   Post @relation(fields: [postId], references: [id])
    }
    model Post {
      id       Int       @id @default(autoincrement())
      authorId Int
      author   User      @relation(fields: [authorId], references: [id])
      comments Comment[]
    }
    model User {
      id    Int    @id @default(autoincrement())
      posts Post[]
    }
  `);
  const files = Object.keys(migrations).sort();
  const userIdx    = files.findIndex(f => f.includes("create_users"));
  const postIdx    = files.findIndex(f => f.includes("create_posts"));
  const commentIdx = files.findIndex(f => f.includes("create_comments"));

  test("users before posts",    () => { if (userIdx >= postIdx) throw new Error(`users(${userIdx}) should be before posts(${postIdx})`); });
  test("posts before comments", () => { if (postIdx >= commentIdx) throw new Error(`posts(${postIdx}) should be before comments(${commentIdx})`); });
});

// ── GROUP 40: Migration Generator – dbgenerated default ──────────────────────

group("MigrationGenerator: dbgenerated default", () => {
  const { migrations } = generateAll(`
    model Order {
      id  Int    @id @default(autoincrement())
      ref String @default(dbgenerated("gen_random_uuid()::text"))
    }
  `);
  const mig = migFile(migrations, "orders");

  test("fragment() for dbgenerated", () => expect(mig).toContain('fragment("gen_random_uuid()::text")'));
});

// ── GROUP 41: Migration Generator – implicit m2m join table ──────────────────

group("MigrationGenerator: implicit many-to-many join table", () => {
  const { migrations } = generateAll(`
    model Post { id Int @id @default(autoincrement()) tags Tag[] }
    model Tag  { id Int @id @default(autoincrement()) posts Post[] }
  `);

  const joinKey = Object.keys(migrations).find(k => k.includes("post_tag") || k.includes("tag_post"));
  test("join table migration created", () => expect(joinKey).toBeTruthy());

  const mig = migrations[joinKey!];
  test("join table primary_key: false",          () => expect(mig).toContain("primary_key: false"));
  test("join table has post_id ref",             () => expect(mig).toContain("references(:posts"));
  test("join table has tag_id ref",              () => expect(mig).toContain("references(:tags"));
  test("join table on_delete: :delete_all",      () => expect(mig).toContain("on_delete: :delete_all"));
  test("join table unique_index",                () => expect(mig).toContain("create unique_index"));
});

// ── GROUP 42: Migration Generator – explicit join table = NO implicit ─────────

group("MigrationGenerator: explicit join table NOT treated as implicit m2m", () => {
  const { migrations } = generateAll(`
    model Post { id Int @id @default(autoincrement()) tags PostTag[] }
    model Tag  { id Int @id @default(autoincrement()) posts PostTag[] }
    model PostTag {
      postId Int
      tagId  Int
      post Post @relation(fields: [postId], references: [id])
      tag  Tag  @relation(fields: [tagId],  references: [id])
      @@id([postId, tagId])
    }
  `);

  // Should NOT generate a second phantom join table; PostTag IS the join table
  const joinKeys = Object.keys(migrations).filter(k =>
    !k.includes("create_posts") && !k.includes("create_tags") && !k.includes("create_post_tags")
  );
  test("no spurious extra join tables", () => expect(joinKeys).toHaveLength(0));
});

// ── GROUP 43: Migration Generator – one-to-many NOT m2m ──────────────────────

group("MigrationGenerator: one-to-many does NOT generate join table", () => {
  const { migrations } = generateAll(`
    model User {
      id    Int    @id @default(autoincrement())
      posts Post[]
    }
    model Post {
      id     Int  @id @default(autoincrement())
      userId Int
      user   User @relation(fields: [userId], references: [id])
    }
  `);

  const extraJoin = Object.keys(migrations).find(k =>
    !k.includes("create_users") && !k.includes("create_posts")
  );
  test("no join table for one-to-many", () => expect(extraJoin).toBe(undefined));
});

// ── GROUP 44: utils – toSnakeCase ─────────────────────────────────────────────

group("Utils: toSnakeCase", () => {
  const { toSnakeCase } = require("../src/utils");

  test("camelCase",       () => expect(toSnakeCase("camelCase")).toBe("camel_case"));
  test("PascalCase",      () => expect(toSnakeCase("PascalCase")).toBe("pascal_case"));
  test("UserProfile",     () => expect(toSnakeCase("UserProfile")).toBe("user_profile"));
  test("XMLParser",       () => expect(toSnakeCase("XMLParser")).toBe("xml_parser"));
  test("already_snake",   () => expect(toSnakeCase("already_snake")).toBe("already_snake"));
  test("single word",     () => expect(toSnakeCase("User")).toBe("user"));
  test("createdAt",       () => expect(toSnakeCase("createdAt")).toBe("created_at"));
  test("userId",          () => expect(toSnakeCase("userId")).toBe("user_id"));
});

// ── GROUP 45: utils – pluralize ───────────────────────────────────────────────

group("Utils: pluralize", () => {
  const { pluralize } = require("../src/utils");

  test("post → posts",              () => expect(pluralize("post")).toBe("posts"));
  test("user → users",              () => expect(pluralize("user")).toBe("users"));
  test("category → categories",     () => expect(pluralize("category")).toBe("categories"));
  test("address → addresses",       () => expect(pluralize("address")).toBe("addresses"));
  test("match → matches",           () => expect(pluralize("match")).toBe("matches"));
  test("all_types stays",           () => expect(pluralize("all_types")).toBe("all_types"));
  test("user_profile → user_profiles",() => expect(pluralize("user_profile")).toBe("user_profiles"));
  test("box → boxes",               () => expect(pluralize("box")).toBe("boxes"));
});

// ── GROUP 46: utils – toTableName ────────────────────────────────────────────

group("Utils: toTableName", () => {
  const { toTableName } = require("../src/utils");

  test("User → users",             () => expect(toTableName("User")).toBe("users"));
  test("UserProfile → user_profiles", () => expect(toTableName("UserProfile")).toBe("user_profiles"));
  test("Category → categories",    () => expect(toTableName("Category")).toBe("categories"));
  test("override respected",        () => expect(toTableName("Anything", "custom_table")).toBe("custom_table"));
  test("AllTypes → all_types",      () => expect(toTableName("AllTypes")).toBe("all_types"));
});

// ── GROUP 47: Edge – empty model ─────────────────────────────────────────────

group("Edge: model with only @id field", () => {
  const schema = parseSchema(`
    model Empty {
      id Int @id @default(autoincrement())
    }
  `);
  test("model parsed", () => expect(schema.models).toHaveLength(1));
  test("only id field", () => expect(schema.models[0].fields).toHaveLength(1));
});

// ── GROUP 48: Edge – multiple models, no relations ────────────────────────────

group("Edge: multiple independent models", () => {
  const { schemas, migrations } = generateAll(`
    model Alpha { id Int @id @default(autoincrement()) name String }
    model Beta  { id Int @id @default(autoincrement()) name String }
    model Gamma { id Int @id @default(autoincrement()) name String }
  `);
  test("3 schema files",    () => expect(Object.keys(schemas)).toHaveLength(3));
  test("3 migration files", () => expect(Object.keys(migrations)).toHaveLength(3));
});

// ── GROUP 49: Edge – field named same as model (Prisma allows this) ──────────

group("Edge: tricky field names", () => {
  const schema = parseSchema(`
    model User {
      id   Int    @id @default(autoincrement())
      user String
      type String
    }
  `);
  const m = schema.models[0];
  test("field named 'user' parsed", () => expect(m.fields.find(f => f.name === "user")).toBeTruthy());
  test("field named 'type' parsed", () => expect(m.fields.find(f => f.name === "type")).toBeTruthy());
});

// ── GROUP 50: Edge – multiple @@unique on same model ─────────────────────────

group("Edge: multiple @@unique constraints", () => {
  const { migrations } = generateAll(`
    model Config {
      id    Int    @id @default(autoincrement())
      key   String
      realm String
      code  String
      @@unique([key, realm])
      @@unique([realm, code])
    }
  `);
  const mig = migFile(migrations, "configs");
  test("first @@unique index",  () => expect(mig).toContain("create unique_index(:configs, [:key, :realm])"));
  test("second @@unique index", () => expect(mig).toContain("create unique_index(:configs, [:realm, :code])"));
});

// ── GROUP 51: Edge – Decimal default with decimal point ───────────────────────

group("Edge: Decimal field defaults", () => {
  const { migrations } = generateAll(`
    model Product {
      id    Int     @id @default(autoincrement())
      price Decimal @default(0.00)
      tax   Decimal @default(0.1)
    }
  `);
  const mig = migFile(migrations, "products");
  test("decimal default 0.00",  () => expect(mig).toContain("default: 0.00"));
  test("decimal default 0.1",   () => expect(mig).toContain("default: 0.1"));
});

// ── GROUP 52: Edge – model name pluralization edge cases ─────────────────────

group("Edge: model name pluralization", () => {
  const { toTableName } = require("../src/utils");
  test("Box → boxes",           () => expect(toTableName("Box")).toBe("boxes"));
  test("Quiz → quizzes",        () => expect(toTableName("Quiz")).toBe("quizzes"));
  test("Leaf → leaves... actually leafs", () => {
    // We don't do irregular plurals, just check it doesn't crash
    const result = toTableName("Leaf");
    expect(typeof result).toBe("string");
  });
  test("Status → statuses",     () => expect(toTableName("Status")).toBe("statuses"));
  test("Address → addresses",   () => expect(toTableName("Address")).toBe("addresses"));
});

// ── GROUP 53: Edge – schema with only enums ───────────────────────────────────

group("Edge: schema with enums and no models", () => {
  const schema = parseSchema(`
    enum Color { RED GREEN BLUE }
    enum Size  { SMALL MEDIUM LARGE }
  `);
  test("two enums",    () => expect(schema.enums).toHaveLength(2));
  test("zero models",  () => expect(schema.models).toHaveLength(0));
});

// ── GROUP 54: Edge – @db.* annotations on various types ──────────────────────

group("Edge: @db.* annotations do not break parsing", () => {
  const schema = parseSchema(`
    model Typed {
      id      Int    @id @default(autoincrement())
      name    String @db.VarChar(100)
      data    Bytes  @db.ByteA
      amount  Float  @db.DoublePrecision
      longInt BigInt @db.BigInt
    }
  `);
  const m = schema.models[0];
  test("4 non-id fields parsed", () => expect(m.fields.filter(f => !f.isId)).toHaveLength(4));
  test("name type is String",    () => expect(m.fields.find(f => f.name === "name")?.type).toBe("String"));
});

// ── GROUP 55: Edge – circular FK references (mutual) ─────────────────────────

group("Edge: circular FK references (topo sort survives)", () => {
  // A -> B -> A is unusual but Prisma allows it in some setups (deferred constraints)
  // Topo sort should not infinite loop
  let threw = false;
  try {
    const { migrations } = generateAll(`
      model Team {
        id         Int      @id @default(autoincrement())
        captainId  Int?
        captain    Player?  @relation("Captain", fields: [captainId], references: [id])
        players    Player[] @relation("TeamPlayer")
      }
      model Player {
        id     Int  @id @default(autoincrement())
        teamId Int?
        team   Team? @relation("TeamPlayer", fields: [teamId], references: [id])
        captains Team[] @relation("Captain")
      }
    `);
    // Should not throw — migrations generated in some order
  } catch (e) {
    threw = true;
  }
  test("topo sort survives circular ref", () => expect(threw).toBe(false));
});

// ── GROUP 56: Edge – deeply nested dbgenerated ───────────────────────────────

group("Edge: deeply nested dbgenerated() value", () => {
  const schema = parseSchema(`
    model Event {
      id         Int      @id @default(autoincrement())
      occurredAt DateTime @default(dbgenerated("(now() AT TIME ZONE 'UTC')"))
      label      String   @default(dbgenerated("concat('evt_', gen_random_uuid()::text)"))
    }
  `);
  const m = schema.models[0];
  const f1 = m.fields.find(f => f.name === "occurredAt")!;
  const f2 = m.fields.find(f => f.name === "label")!;

  test("nested dbgenerated parsed",       () => expect(f1.default?.kind).toBe("dbgenerated"));
  test("nested value correct",            () => expect(f1.default?.value).toContain("AT TIME ZONE"));
  test("concat dbgenerated parsed",       () => expect(f2.default?.kind).toBe("dbgenerated"));
  test("concat value correct",            () => expect(f2.default?.value).toContain("concat"));
});

// ─────────────────────────────────────────────────────────────────────────────
// FINAL REPORT
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n" + "─".repeat(60));
console.log(`\x1b[1mResults: ${passed} passed, ${failed} failed\x1b[0m`);
if (failures.length > 0) {
  console.log(`\n\x1b[31mFailed tests:\x1b[0m`);
  failures.forEach(f => console.log(`  • ${f}`));
}
console.log("─".repeat(60) + "\n");
process.exit(failed > 0 ? 1 : 0);

// ═══════════════════════════════════════════════════════════════════════════
// NEW FEATURE TESTS
// ═══════════════════════════════════════════════════════════════════════════

// ── GROUP 57: Parser – referential actions ────────────────────────────────

group("Parser: @relation referential actions", () => {
  const schema = parseSchema(`
    model User {
      id    Int    @id @default(autoincrement())
      posts Post[]
    }
    model Post {
      id       Int  @id @default(autoincrement())
      userId   Int
      user     User @relation(fields: [userId], references: [id], onDelete: Cascade, onUpdate: Restrict)
    }
  `);
  const post = schema.models.find(m => m.name === "Post")!;
  const rel = post.fields.find(f => f.name === "user")!.relation!;

  test("onDelete: Cascade parsed",  () => expect(rel.onDelete).toBe("Cascade"));
  test("onUpdate: Restrict parsed", () => expect(rel.onUpdate).toBe("Restrict"));
});

// ── GROUP 58: Parser – view blocks ────────────────────────────────────────

group("Parser: view keyword blocks", () => {
  const schema = parseSchema(`
    view UserStats {
      userId    Int    @unique
      postCount Int
      avgScore  Float
    }
  `);
  const v = schema.models[0];

  test("view parsed as model with isView=true", () => expect(v.isView).toBe(true));
  test("view name correct",                      () => expect(v.name).toBe("UserStats"));
  test("view has 3 fields",                      () => expect(v.fields).toHaveLength(3));
});

// ── GROUP 59: Parser – @@schema ────────────────────────────────────────────

group("Parser: @@schema multi-schema", () => {
  const schema = parseSchema(`
    model User {
      id   Int    @id @default(autoincrement())
      name String
      @@schema("auth")
    }
    model Product {
      id    Int    @id @default(autoincrement())
      title String
      @@schema("shop")
    }
  `);
  test("User @@schema auth",    () => expect(schema.models.find(m=>m.name==="User")?.dbSchema).toBe("auth"));
  test("Product @@schema shop", () => expect(schema.models.find(m=>m.name==="Product")?.dbSchema).toBe("shop"));
});

// ── GROUP 60: Parser – enum @@schema and @map values ──────────────────────

group("Parser: enum @@schema and value @map", () => {
  const schema = parseSchema(`
    enum Status {
      ACTIVE   @map("active")
      INACTIVE @map("inactive")
      @@schema("common")
    }
  `);
  const e = schema.enums[0];
  test("enum dbSchema parsed",          () => expect(e.dbSchema).toBe("common"));
  test("ACTIVE dbValue mapped",         () => expect(e.values.find(v=>v.name==="ACTIVE")?.dbValue).toBe("active"));
  test("INACTIVE dbValue mapped",       () => expect(e.values.find(v=>v.name==="INACTIVE")?.dbValue).toBe("inactive"));
});

// ── GROUP 61: Parser – @db.* native type annotations ──────────────────────

group("Parser: @db.* nativeType stored", () => {
  const schema = parseSchema(`
    model Product {
      id    Int    @id @default(autoincrement())
      name  String @db.VarChar(200)
      descr String @db.Text
      price Float  @db.DoublePrecision
    }
  `);
  const m = schema.models[0];
  const f = (n: string) => m.fields.find(f => f.name === n)!;

  test("VarChar nativeType stored",       () => expect(f("name").nativeType).toBe("VarChar(200)"));
  test("Text nativeType stored",          () => expect(f("descr").nativeType).toBe("Text"));
  test("DoublePrecision nativeType",      () => expect(f("price").nativeType).toBe("DoublePrecision"));
  test("field type still String",         () => expect(f("name").type).toBe("String"));
});

// ── GROUP 62: Parser – @@index / @@unique with options ────────────────────

group("Parser: @@index / @@unique with map:, type:, where:", () => {
  const schema = parseSchema(`
    model Post {
      id      Int    @id @default(autoincrement())
      title   String
      content String
      @@index([title], map: "posts_title_idx", type: Hash)
      @@unique([title, content], map: "posts_title_content_uniq")
    }
  `);
  const m = schema.models[0];

  test("index name parsed",       () => expect(m.indexes[0].options.name).toBe("posts_title_idx"));
  test("index type Hash parsed",  () => expect(m.indexes[0].options.type).toBe("Hash"));
  test("unique name parsed",      () => expect(m.compoundUniques[0].options.name).toBe("posts_title_content_uniq"));
});

// ── GROUP 63: Parser – @@fulltext ─────────────────────────────────────────

group("Parser: @@fulltext index", () => {
  const schema = parseSchema(`
    model Article {
      id      Int    @id @default(autoincrement())
      title   String
      body    String
      @@fulltext([title, body])
    }
  `);
  const m = schema.models[0];

  test("fulltextIndexes has 1 entry",     () => expect(m.fulltextIndexes).toHaveLength(1));
  test("fulltext fields: title, body",    () => expect(m.fulltextIndexes[0].fields).toEqual(["title", "body"]));
  test("fulltext option set",             () => expect(m.fulltextIndexes[0].options.fulltext).toBe(true));
});

// ── GROUP 64: Parser – @default(auto()) MongoDB ObjectId ──────────────────

group("Parser: @default(auto()) MongoDB ObjectId", () => {
  const schema = parseSchema(`
    model Document {
      id    String @id @default(auto()) @map("_id")
      title String
    }
  `);
  const m = schema.models[0];
  test("idKind is auto",         () => expect(m.fields[0].idKind).toBe("auto"));
  test("default kind is auto",   () => expect(m.fields[0].default?.kind).toBe("auto"));
});

// ── GROUP 65: Ecto Generator – view produces read-only schema ─────────────

group("EctoGenerator: view → read-only schema", () => {
  const { schemas } = generateAll(`
    view UserStats {
      userId    Int    @unique
      postCount Int
    }
  `);
  const s = schemaFile(schemas, "user_stats");

  test("isView comment present",       () => expect(s).toContain("VIEW"));
  test("@primary_key false",           () => expect(s).toContain("@primary_key false"));
  test("no changeset def",             () => expect(s).notToContain("def changeset"));
  test("no timestamps",                () => expect(s).notToContain("timestamps()"));
  test("field post_count present",     () => expect(s).toContain("field :post_count"));
  test("query helper present",         () => expect(s).toContain("def query"));
});

// ── GROUP 66: Ecto Generator – @@schema → @schema_prefix ──────────────────

group("EctoGenerator: @@schema → @schema_prefix", () => {
  const { schemas } = generateAll(`
    model Config {
      id  Int    @id @default(autoincrement())
      key String
      @@schema("admin")
    }
  `);
  const s = schemaFile(schemas, "config");

  test("@schema_prefix emitted", () => expect(s).toContain('@schema_prefix "admin"'));
});

// ── GROUP 67: Ecto Generator – onDelete/onUpdate → schema comment ──────────

group("EctoGenerator: referential actions → comment in schema", () => {
  const { schemas } = generateAll(`
    model User { id Int @id @default(autoincrement()) posts Post[] }
    model Post {
      id     Int  @id @default(autoincrement())
      userId Int
      user   User @relation(fields: [userId], references: [id], onDelete: Cascade, onUpdate: SetNull)
    }
  `);
  const s = schemaFile(schemas, "post");

  test("Cascade comment present", () => expect(s).toContain("onDelete: Cascade"));
  test("SetNull comment present", () => expect(s).toContain("onUpdate: SetNull"));
});

// ── GROUP 68: Ecto Generator – @db.VarChar → validate_length ──────────────

group("EctoGenerator: @db.VarChar → validate_length in changeset", () => {
  const { schemas } = generateAll(`
    model User {
      id   Int    @id @default(autoincrement())
      name String @db.VarChar(100)
    }
  `);
  const s = schemaFile(schemas, "user");

  test("validate_length max: 100", () => expect(s).toContain("validate_length(:name, max: 100)"));
});

// ── GROUP 69: Ecto Generator – sensitive field redaction ──────────────────

group("EctoGenerator: sensitive field names get redact: true", () => {
  const { schemas } = generateAll(`
    model User {
      id           Int    @id @default(autoincrement())
      email        String
      passwordHash String
      apiSecret    String?
    }
  `);
  const s = schemaFile(schemas, "user");

  test("password_hash redact: true",  () => { expect(s).toContain("password_hash"); expect(s).toContain("redact: true"); });
  test("api_secret redact: true",     () => expect(s).toContain("api_secret"));
  test("email NOT redacted",          () => {
    const emailLine = s.split("\n").find(l => l.includes(":email"))!;
    expect(emailLine).notToContain("redact:");
  });
});

// ── GROUP 70: Migration Generator – onDelete/onUpdate → references opts ────

group("MigrationGenerator: referential actions → on_delete:/on_update:", () => {
  const { migrations } = generateAll(`
    model User { id Int @id @default(autoincrement()) posts Post[] }
    model Post {
      id     Int  @id @default(autoincrement())
      userId Int
      user   User @relation(fields: [userId], references: [id], onDelete: Cascade, onUpdate: Restrict)
    }
  `);
  const mig = migFile(migrations, "posts");

  test("on_delete: :delete_all for Cascade",  () => expect(mig).toContain("on_delete: :delete_all"));
  test("on_update: :restrict for Restrict",   () => expect(mig).toContain("on_update: :restrict"));
});

// ── GROUP 71: Migration Generator – @@schema → prefix: in table ───────────

group("MigrationGenerator: @@schema → prefix: option on table", () => {
  const { migrations } = generateAll(`
    model Config {
      id  Int    @id @default(autoincrement())
      key String
      @@schema("admin")
    }
  `);
  const mig = migFile(migrations, "configs");

  test("prefix: admin on table", () => expect(mig).toContain('prefix: "admin"'));
});

// ── GROUP 72: Migration Generator – @db.VarChar(n) → size: n ──────────────

group("MigrationGenerator: @db.VarChar(n) → size: in migration", () => {
  const { migrations } = generateAll(`
    model Product {
      id    Int    @id @default(autoincrement())
      name  String @db.VarChar(255)
      sku   String @db.VarChar(50)
      descr String @db.Text
    }
  `);
  const mig = migFile(migrations, "products");

  test("name size: 255",     () => expect(mig).toContain("size: 255"));
  test("sku size: 50",       () => expect(mig).toContain("size: 50"));
  test("text type for Text", () => expect(mig).toContain(":text"));
});

// ── GROUP 73: Migration Generator – @@index with map: → named index ────────

group("MigrationGenerator: @@index map: → named index", () => {
  const { migrations } = generateAll(`
    model Post {
      id      Int    @id @default(autoincrement())
      title   String
      author  String
      @@index([author, title], map: "posts_author_title_idx")
    }
  `);
  const mig = migFile(migrations, "posts");

  test("named index with map:", () => expect(mig).toContain('name: "posts_author_title_idx"'));
});

// ── GROUP 74: Migration Generator – @@fulltext → using: :fulltext ──────────

group("MigrationGenerator: @@fulltext → index using: :fulltext", () => {
  const { migrations } = generateAll(`
    model Article {
      id    Int    @id @default(autoincrement())
      title String
      body  String
      @@fulltext([title, body])
    }
  `);
  const mig = migFile(migrations, "articles");

  test("fulltext index emitted", () => expect(mig).toContain("using: :fulltext"));
  test("includes title col",     () => expect(mig).toContain(":title"));
  test("includes body col",      () => expect(mig).toContain(":body"));
});

// ── GROUP 75: Migration Generator – view → stub migration ─────────────────

group("MigrationGenerator: view → CREATE VIEW stub migration", () => {
  const { migrations } = generateAll(`
    view UserStats {
      userId    Int    @unique
      postCount Int
    }
  `);
  const viewMig = Object.values(migrations).find(m => m.includes("CREATE OR REPLACE VIEW"))!;

  test("view migration generated",        () => expect(viewMig).toBeTruthy());
  test("CREATE OR REPLACE VIEW present",  () => expect(viewMig).toContain("CREATE OR REPLACE VIEW"));
  test("DROP VIEW in down function",      () => expect(viewMig).toContain("DROP VIEW IF EXISTS"));
  test("up/down migration functions",     () => expect(viewMig).toContain("def up"));
});

// ── GROUP 76: Migration Generator – UUID join table FKs ──────────────────

group("MigrationGenerator: UUID join table with correct type: :uuid", () => {
  const { migrations } = generateAll(`
    model Post { id String @id @default(uuid()) tags Tag[] }
    model Tag  { id String @id @default(uuid()) posts Post[] }
  `);
  const joinKey = Object.keys(migrations).find(k => k.includes("post_tag") || k.includes("tag_post"));
  test("join table migration exists", () => expect(joinKey).toBeTruthy());
  const mig = migrations[joinKey!];
  test("FK type: :uuid in join table", () => expect(mig).toContain("type: :uuid"));
});

// ── GROUP 77: Migration Generator – SetNull → nilify_all ─────────────────

group("MigrationGenerator: SetNull → nilify_all", () => {
  const { migrations } = generateAll(`
    model User { id Int @id @default(autoincrement()) posts Post[] }
    model Post {
      id     Int   @id @default(autoincrement())
      userId Int?
      user   User? @relation(fields: [userId], references: [id], onDelete: SetNull)
    }
  `);
  const mig = migFile(migrations, "posts");

  test("on_delete: :nilify_all for SetNull", () => expect(mig).toContain("on_delete: :nilify_all"));
});

// ── GROUP 78: Migration Generator – cross-schema FK prefix ───────────────

group("MigrationGenerator: cross-schema FK gets prefix: on references", () => {
  const { migrations } = generateAll(`
    model User {
      id    Int    @id @default(autoincrement())
      name  String
      posts Post[]
      @@schema("auth")
    }
    model Post {
      id     Int  @id @default(autoincrement())
      userId Int
      user   User @relation(fields: [userId], references: [id])
      @@schema("content")
    }
  `);
  const mig = migFile(migrations, "posts");

  test("references has prefix: auth", () => expect(mig).toContain('prefix: "auth"'));
});

// ── GROUP 79: Edge – all referential actions round-trip ──────────────────

group("Edge: all referential actions map correctly", () => {
  const { referentialActionToEcto } = require("../src/utils");

  test("Cascade → delete_all",   () => expect(referentialActionToEcto("Cascade")).toBe("delete_all"));
  test("Restrict → restrict",    () => expect(referentialActionToEcto("Restrict")).toBe("restrict"));
  test("SetNull → nilify_all",   () => expect(referentialActionToEcto("SetNull")).toBe("nilify_all"));
  test("SetDefault → nothing",   () => expect(referentialActionToEcto("SetDefault")).toBe("nothing"));
  test("NoAction → nothing",     () => expect(referentialActionToEcto("NoAction")).toBe("nothing"));
});

// ── GROUP 80: Edge – native type mapping coverage ────────────────────────

group("Edge: nativeTypeToMigration coverage", () => {
  const { nativeTypeToMigration } = require("../src/utils");

  test("VarChar(255) → string",   () => expect(nativeTypeToMigration("VarChar(255)", "String")).toBe("string"));
  test("Text → text",             () => expect(nativeTypeToMigration("Text", "String")).toBe("text"));
  test("DoublePrecision → float", () => expect(nativeTypeToMigration("DoublePrecision", "Float")).toBe("float"));
  test("BigInt → bigint",         () => expect(nativeTypeToMigration("BigInt", "BigInt")).toBe("bigint"));
  test("Uuid → uuid",             () => expect(nativeTypeToMigration("Uuid", "String")).toBe("uuid"));
  test("JsonB → map",             () => expect(nativeTypeToMigration("JsonB", "Json")).toBe("map"));
  test("ByteA → binary",          () => expect(nativeTypeToMigration("ByteA", "Bytes")).toBe("binary"));
  test("TimestampTz → utc_datetime", () => expect(nativeTypeToMigration("TimestampTz", "DateTime")).toBe("utc_datetime"));
});

// ── GROUP 81: Edge – enum value @map preserved in comment ────────────────

group("EctoGenerator: enum @map values preserved in module comment", () => {
  const { schemas } = generateAll(`
    enum Status {
      ACTIVE   @map("active")
      INACTIVE @map("inactive")
    }
    model User {
      id     Int    @id @default(autoincrement())
      status Status
    }
  `);
  const enumSchema = schemaFile(schemas, "status");

  test("@map DB values noted in enum module", () => expect(enumSchema).toContain("active"));
});

// ── GROUP 82: Edge – @@index type: Hash → using: :hash ───────────────────

group("MigrationGenerator: @@index type: Hash → using: :hash", () => {
  const { migrations } = generateAll(`
    model Session {
      id    Int    @id @default(autoincrement())
      token String @unique
      @@index([token], type: Hash)
    }
  `);
  const mig = migFile(migrations, "sessions");

  test("hash index using: :hash", () => expect(mig).toContain("using: :hash"));
});

// ── GROUP 83: Edge – view and model in same schema ────────────────────────

group("Edge: schema with both models and views", () => {
  const { schemas, migrations } = generateAll(`
    model User { id Int @id @default(autoincrement()) name String }
    view UserSummary { userId Int @unique name String }
  `);

  test("user schema generated",         () => expect(schemaFile(schemas, "user")).toContain("schema"));
  test("user_summary view generated",   () => expect(schemaFile(schemas, "user_summary")).toContain("VIEW"));
  test("user migration generated",      () => expect(migFile(migrations, "users")).toContain("create table"));
  test("view stub migration generated", () => {
    const viewMig = Object.values(migrations).find(m => m.includes("CREATE OR REPLACE VIEW"));
    expect(viewMig).toBeTruthy();
  });
});

// ── GROUP 84: Edge – @default(auto()) PK in migration ────────────────────

group("Edge: MongoDB auto() PK in migration", () => {
  const { migrations } = generateAll(`
    model Doc {
      id    String @id @default(auto()) @map("_id")
      title String
    }
  `);
  const mig = migFile(migrations, "docs");

  test("uuid pk column emitted for auto()", () => expect(mig).toContain(":uuid, primary_key: true"));
});