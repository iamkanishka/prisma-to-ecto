// src/migrationGenerator.ts
import * as fs from "fs";
import * as path from "path";
import { ParsedSchema, PrismaField, PrismaIndex, PrismaModel } from "./types";
import {
  nativeTypeToMigration,
  nativeTypeSize,
  prismaDefaultToMigration,
  prismaTypeToMigration,
  referentialActionToEcto,
  toSnakeCase,
  toTableName,
} from "./utils";

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function generateMigrationFiles(schema: ParsedSchema, outputDir: string): void {
  ensureDir(outputDir);

  // Views: emit a SQL stub migration (cannot create views via Ecto.Migration directly)
  const views = schema.models.filter((m) => m.isView);
  const models = schema.models.filter((m) => !m.isView);

  const ordered = topologicalSort(models);
  const baseTs = Date.now();

  ordered.forEach((model, index) => {
    const ts = baseTs + index;
    const tableName = toTableName(model.name, model.tableName);
    const content = renderMigration(model, tableName, schema);
    const fileName = `${ts}_create_${tableName}.exs`;
    const filePath = path.join(outputDir, fileName);
    fs.writeFileSync(filePath, content, "utf8");
    console.log(`  \x1b[32m✓\x1b[0m ${filePath}`);
  });

  // Implicit many-to-many join tables
  const joinTables = collectImplicitJoinTables(models);
  joinTables.forEach((jt, index) => {
    const ts = baseTs + ordered.length + index;
    const content = renderJoinTableMigration(jt, schema);
    const fileName = `${ts}_create_${jt.tableName}.exs`;
    const filePath = path.join(outputDir, fileName);
    fs.writeFileSync(filePath, content, "utf8");
    console.log(`  \x1b[32m✓\x1b[0m ${filePath}`);
  });

  // Views: emit SQL stub migrations
  views.forEach((view, index) => {
    const ts = baseTs + ordered.length + joinTables.length + index;
    const tableName = toTableName(view.name, view.tableName);
    const content = renderViewMigration(view, tableName);
    const fileName = `${ts}_create_view_${tableName}.exs`;
    const filePath = path.join(outputDir, fileName);
    fs.writeFileSync(filePath, content, "utf8");
    console.log(`  \x1b[32m✓\x1b[0m ${filePath}`);
  });
}

// ---------------------------------------------------------------------------
// Migration renderer
// ---------------------------------------------------------------------------

function renderMigration(model: PrismaModel, tableName: string, schema: ParsedSchema): string {
  const pkField = model.fields.find((f) => f.isId);
  const pkColumnDef = renderPkColumn(model, pkField);

  const columnFields = model.fields.filter(
    (f) => f.isScalar && !f.isId && !f.isUpdatedAt && !f.isForeignKey
  );

  const fkFields = model.fields.filter((f) => f.relation?.isOwner);

  const columnLines = columnFields.map((f) => renderColumn(f));
  const fkLines = fkFields.map((f) => renderForeignKey(f, schema));

  const allLines = [
    ...(pkColumnDef ? [pkColumnDef] : []),
    ...columnLines,
    ...fkLines,
  ].filter(Boolean).join("\n");

  // Indexes (regular)
  const indexLines = model.indexes.map((idx) => renderIndexLine(tableName, idx, false));
  // Compound unique indexes
  const uniqueIndexLines = model.compoundUniques.map((idx) => renderIndexLine(tableName, idx, true));
  // Field-level unique
  const fieldUniqueLines = columnFields
    .filter((f) => f.isUnique)
    .map((f) => {
      const col = toSnakeCase(f.columnName ?? f.name);
      return `    create unique_index(:${tableName}, [:${col}])`;
    });
  // Fulltext indexes
  const fulltextLines = model.fulltextIndexes.map((idx) => {
    const cols = idx.fields.map(toSnakeCase).map((c) => `:${c}`).join(", ");
    return `    create index(:${tableName}, [${cols}], using: :fulltext)`;
  });

  const postStatements = [
    ...indexLines,
    ...uniqueIndexLines,
    ...fieldUniqueLines,
    ...fulltextLines,
  ].join("\n");

  const isCompositePk = !!(model.compoundId && model.compoundId.length > 0);
  const isUuidPk = pkField?.idKind === "uuid" || pkField?.idKind === "auto";

  const tableOpts: string[] = [];
  if (isCompositePk || isUuidPk) tableOpts.push("primary_key: false");
  // @@schema → prefix: opt
  if (model.dbSchema) tableOpts.push(`prefix: "${model.dbSchema}"`);

  const tableOptsStr = tableOpts.length ? `, ${tableOpts.join(", ")}` : "";

  // No timestamps for composite-PK join tables that carry no extra data
  const isSimpleJoinTable = isCompositePk &&
    columnFields.length === 0 &&
    fkFields.length >= 2;
  const timestampsLine = isSimpleJoinTable ? "" : "      timestamps(type: :utc_datetime)\n";

  return trimLeading(`
defmodule MyApp.Repo.Migrations.Create${model.name} do
  use Ecto.Migration

  def change do
    create table(:${tableName}${tableOptsStr}) do
${allLines}
${timestampsLine}    end
${postStatements ? "\n" + postStatements : ""}
  end
end
`);
}

function renderIndexLine(tableName: string, idx: PrismaIndex, unique: boolean): string {
  const cols = idx.fields.map(toSnakeCase).map((c) => `:${c}`).join(", ");
  const fn_ = unique ? "unique_index" : "index";
  const opts: string[] = [];
  if (idx.options.name) opts.push(`name: "${idx.options.name}"`);
  if (idx.options.where) opts.push(`where: "${idx.options.where}"`);
  if (idx.options.type) {
    // Map Prisma index types to Ecto index type atoms
    const typeMap: Record<string, string> = {
      Hash: "hash", Gin: "gin", Gist: "gist", SpGist: "spgist", Brin: "brin",
    };
    opts.push(`using: :${typeMap[idx.options.type] ?? idx.options.type.toLowerCase()}`);
  }
  const optsStr = opts.length ? `, ${opts.join(", ")}` : "";
  return `    create ${fn_}(:${tableName}, [${cols}]${optsStr})`;
}

// ---------------------------------------------------------------------------
// PK column
// ---------------------------------------------------------------------------

function renderPkColumn(model: PrismaModel, pkField?: PrismaField): string | null {
  if (!pkField) return null;

  switch (pkField.idKind) {
    case "uuid":
    case "auto":
      return `      add :id, :uuid, primary_key: true, null: false, default: fragment("gen_random_uuid()")`;
    case "cuid":
    case "string":
      return `      add :id, :string, primary_key: true, null: false`;
    case "autoincrement":
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Column renderers
// ---------------------------------------------------------------------------

function renderColumn(field: PrismaField): string {
  const col = toSnakeCase(field.columnName ?? field.name);

  let type: string;
  if (field.type.startsWith("Ecto.Enum:")) {
    type = ":string";
  } else if (field.nativeType) {
    type = `:${nativeTypeToMigration(field.nativeType, field.type)}`;
  } else {
    type = `:${prismaTypeToMigration(field.type)}`;
  }

  const opts = columnOpts(field);
  return `      add :${col}, ${type}${opts.length ? `, ${opts.join(", ")}` : ""}`;
}

function columnOpts(field: PrismaField): string[] {
  const opts: string[] = [];
  opts.push(field.isOptional ? "null: true" : "null: false");

  // Size from @db.VarChar(n)
  if (field.nativeType) {
    const size = nativeTypeSize(field.nativeType);
    if (size) opts.push(`size: ${size}`);
  }

  if (field.default) {
    const migDefault = prismaDefaultToMigration(field.default, field.type);
    if (migDefault !== undefined) opts.push(`default: ${migDefault}`);
  }
  return opts;
}

function renderForeignKey(field: PrismaField, schema: ParsedSchema): string {
  const rel = field.relation!;
  const relatedModel = schema.models.find((m) => m.name === rel.relatedModel);
  const refTable = relatedModel
    ? toTableName(relatedModel.name, relatedModel.tableName)
    : toTableName(rel.relatedModel);

  const fkColName =
    rel.fields && rel.fields.length > 0
      ? toSnakeCase(rel.fields[0])
      : toSnakeCase(`${field.name}_id`);

  const relPkField = relatedModel?.fields.find((f) => f.isId);
  const refType =
    relPkField?.idKind === "uuid" || relPkField?.idKind === "auto" ? ":uuid"
    : relPkField?.idKind === "cuid" || relPkField?.idKind === "string" ? ":string"
    : undefined;
  const refTypeOpt = refType ? `, type: ${refType}` : "";

  // Referential action
  const onDelete = rel.onDelete ? referentialActionToEcto(rel.onDelete) : "nothing";
  const onUpdate = rel.onUpdate ? referentialActionToEcto(rel.onUpdate) : undefined;
  const onUpdateOpt = onUpdate ? `, on_update: :${onUpdate}` : "";

  // @@schema prefix for cross-schema FK
  const refPrefix = relatedModel?.dbSchema
    ? `, prefix: "${relatedModel.dbSchema}"`
    : "";

  const nullOpt = field.isOptional ? "null: true" : "null: false";

  return `      add :${fkColName}, references(:${refTable}, on_delete: :${onDelete}${onUpdateOpt}${refTypeOpt}${refPrefix}), ${nullOpt}`;
}

// ---------------------------------------------------------------------------
// View migration stub
// ---------------------------------------------------------------------------

function renderViewMigration(model: PrismaModel, tableName: string): string {
  const cols = model.fields
    .filter((f) => f.isScalar)
    .map((f) => `--   ${toSnakeCase(f.columnName ?? f.name)} ${prismaTypeToMigration(f.type)}`)
    .join("\n");
  const prefixOpt = model.dbSchema ? `, prefix: "${model.dbSchema}"` : "";

  return trimLeading(`
defmodule MyApp.Repo.Migrations.CreateView${model.name} do
  use Ecto.Migration

  def up do
    # TODO: Replace with your actual CREATE VIEW SQL.
    # Prisma view \`${model.name}\` maps to table/view \`${tableName}\`.
    # Expected columns:
${cols}
    execute """
    CREATE OR REPLACE VIEW ${model.dbSchema ? model.dbSchema + "." : ""}${tableName} AS
    SELECT
      -- TODO: define your view query here
    FROM some_table
    """
  end

  def down do
    execute "DROP VIEW IF EXISTS ${model.dbSchema ? model.dbSchema + "." : ""}${tableName}"
  end
end
`);
}

// ---------------------------------------------------------------------------
// Implicit many-to-many join tables
// ---------------------------------------------------------------------------

interface JoinTable {
  tableName: string;
  modelA: string; tableA: string; schemaA?: string;
  modelB: string; tableB: string; schemaB?: string;
  pkKindA?: string; pkKindB?: string;
}

function collectImplicitJoinTables(models: PrismaModel[]): JoinTable[] {
  const seen = new Set<string>();
  const joinTables: JoinTable[] = [];
  const modelSet = new Set(models.map((m) => m.name));

  for (const model of models) {
    for (const field of model.fields) {
      if (
        field.relation?.kind === "one-to-many" &&
        !field.relation.isOwner &&
        !field.relation.fields &&
        field.isArray &&
        modelSet.has(field.relation.relatedModel)
      ) {
        const other = models.find((m) => m.name === field.relation!.relatedModel);
        if (!other) continue;

        const otherSide = other.fields.find(
          (f) =>
            f.relation?.relatedModel === model.name &&
            f.isArray &&
            !f.relation?.isOwner &&
            !f.relation?.fields
        );
        if (!otherSide) continue;

        const key = [model.name, other.name].sort().join("__");
        if (seen.has(key)) continue;
        seen.add(key);

        const nameA = model.name < other.name ? model.name : other.name;
        const nameB = model.name < other.name ? other.name : model.name;
        const modelAObj = models.find((m) => m.name === nameA)!;
        const modelBObj = models.find((m) => m.name === nameB)!;
        const pkA = modelAObj.fields.find((f) => f.isId);
        const pkB = modelBObj.fields.find((f) => f.isId);

        joinTables.push({
          tableName: `${toSnakeCase(nameA)}_${toSnakeCase(nameB)}`,
          modelA: nameA, tableA: toTableName(nameA, modelAObj.tableName),
          schemaA: modelAObj.dbSchema,
          modelB: nameB, tableB: toTableName(nameB, modelBObj.tableName),
          schemaB: modelBObj.dbSchema,
          pkKindA: pkA?.idKind,
          pkKindB: pkB?.idKind,
        });
      }
    }
  }
  return joinTables;
}

function renderJoinTableMigration(jt: JoinTable, schema: ParsedSchema): string {
  const modName = `${jt.modelA}${jt.modelB}`;

  const refTypeA =
    jt.pkKindA === "uuid" || jt.pkKindA === "auto" ? ", type: :uuid"
    : jt.pkKindA === "cuid" || jt.pkKindA === "string" ? ", type: :string"
    : "";
  const refTypeB =
    jt.pkKindB === "uuid" || jt.pkKindB === "auto" ? ", type: :uuid"
    : jt.pkKindB === "cuid" || jt.pkKindB === "string" ? ", type: :string"
    : "";

  const prefixA = jt.schemaA ? `, prefix: "${jt.schemaA}"` : "";
  const prefixB = jt.schemaB ? `, prefix: "${jt.schemaB}"` : "";

  return trimLeading(`
defmodule MyApp.Repo.Migrations.Create${modName} do
  use Ecto.Migration

  def change do
    create table(:${jt.tableName}, primary_key: false) do
      add :${toSnakeCase(jt.modelA)}_id, references(:${jt.tableA}, on_delete: :delete_all${refTypeA}${prefixA}), null: false
      add :${toSnakeCase(jt.modelB)}_id, references(:${jt.tableB}, on_delete: :delete_all${refTypeB}${prefixB}), null: false
    end

    create unique_index(:${jt.tableName}, [:${toSnakeCase(jt.modelA)}_id, :${toSnakeCase(jt.modelB)}_id])
  end
end
`);
}

// ---------------------------------------------------------------------------
// Topological sort
// ---------------------------------------------------------------------------

function topologicalSort(models: PrismaModel[]): PrismaModel[] {
  const nameToModel = new Map(models.map((m) => [m.name, m]));
  const visited = new Set<string>();
  const visiting = new Set<string>(); // cycle detection
  const result: PrismaModel[] = [];

  function visit(model: PrismaModel) {
    if (visited.has(model.name)) return;
    if (visiting.has(model.name)) {
      // Cycle detected — push now and break cycle
      visited.add(model.name);
      result.push(model);
      return;
    }
    visiting.add(model.name);
    for (const field of model.fields) {
      if (field.relation?.isOwner && field.relation.relatedModel) {
        const dep = nameToModel.get(field.relation.relatedModel);
        if (dep && dep.name !== model.name) visit(dep);
      }
    }
    visiting.delete(model.name);
    visited.add(model.name);
    result.push(model);
  }

  for (const model of models) visit(model);
  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function trimLeading(str: string): string {
  return str.replace(/^\n/, "");
}