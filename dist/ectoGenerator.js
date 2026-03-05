"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateEctoSchema = void 0;
// src/ectoGenerator.ts
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const utils_1 = require("./utils");
// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------
function generateEctoSchema(schema, outputDir) {
    ensureDir(outputDir);
    for (const prismaEnum of schema.enums) {
        const content = renderEnumModule(prismaEnum);
        const filePath = path.join(outputDir, `${(0, utils_1.toSnakeCase)(prismaEnum.name)}.ex`);
        fs.writeFileSync(filePath, content, "utf8");
        console.log(`  \x1b[32m✓\x1b[0m ${filePath}`);
    }
    for (const model of schema.models) {
        const content = model.isView
            ? renderViewModule(model, schema)
            : renderSchemaModule(model, schema);
        const filePath = path.join(outputDir, `${(0, utils_1.toSnakeCase)(model.name)}.ex`);
        fs.writeFileSync(filePath, content, "utf8");
        console.log(`  \x1b[32m✓\x1b[0m ${filePath}`);
    }
}
exports.generateEctoSchema = generateEctoSchema;
// ---------------------------------------------------------------------------
// Enum module
// ---------------------------------------------------------------------------
function renderEnumModule(prismaEnum) {
    const atoms = prismaEnum.values
        .map((v) => `:${(0, utils_1.toSnakeCase)(v.name)}`)
        .join(", ");
    // If any values have @map db overrides, include a mapping comment
    const hasMaps = prismaEnum.values.some((v) => v.dbValue);
    const mapComment = hasMaps
        ? `\n  # DB value mappings: ${prismaEnum.values
            .filter((v) => v.dbValue)
            .map((v) => `${v.name} -> "${v.dbValue}"`)
            .join(", ")}\n`
        : "";
    return trimLeading(`
defmodule MyApp.Enums.${prismaEnum.name} do
  @moduledoc """
  Ecto type for the \`${prismaEnum.name}\` enum.
  Mapped from the Prisma enum of the same name.
  """
${mapComment}
  use EctoEnum, type: :${(0, utils_1.toSnakeCase)(prismaEnum.name)}, enums: [${atoms}]
end
`);
}
// ---------------------------------------------------------------------------
// View module (read-only Ecto schema)
// ---------------------------------------------------------------------------
function renderViewModule(model, schema) {
    const enumNames = new Set(schema.enums.map((e) => e.name));
    const tableName = (0, utils_1.toTableName)(model.name, model.tableName);
    const schemaPrefix = model.dbSchema
        ? `  @schema_prefix "${model.dbSchema}"\n`
        : "";
    const primitiveFields = model.fields.filter((f) => f.isScalar && !f.isUpdatedAt);
    const fieldLines = primitiveFields.map((f) => renderField(f, enumNames)).join("\n");
    return trimLeading(`
defmodule MyApp.${model.name} do
  @moduledoc """
  Read-only Ecto schema for the \`${tableName}\` database VIEW.
  Auto-generated from Prisma view \`${model.name}\`.
  Views support only read operations (no insert/update/delete).
  """

  use Ecto.Schema

${schemaPrefix}  @primary_key false
  schema "${tableName}" do
${fieldLines}
  end

  @doc """
  Views are read-only. Use Repo.all/2, Repo.one/2, Repo.get/3 etc.
  Write operations (insert/update/delete) are NOT supported.
  """
  def query, do: __MODULE__
end
`);
}
// ---------------------------------------------------------------------------
// Schema module
// ---------------------------------------------------------------------------
function renderSchemaModule(model, schema) {
    const enumNames = new Set(schema.enums.map((e) => e.name));
    const tableName = (0, utils_1.toTableName)(model.name, model.tableName);
    const varName = (0, utils_1.toVarName)(model.name);
    // @@schema → @schema_prefix
    const schemaPrefix = model.dbSchema
        ? `  @schema_prefix "${model.dbSchema}"\n`
        : "";
    const pkField = model.fields.find((f) => f.isId);
    const pkAttr = renderPrimaryKeyAttr(model, pkField);
    const isJoinSchema = !!(model.compoundId && model.compoundId.length > 0);
    // Scalar fields: not @id, not @updatedAt, not FK scalars
    const primitiveFields = model.fields.filter((f) => f.isScalar && !f.isId && !f.isUpdatedAt && !f.isForeignKey);
    // Relation fields
    const relationFields = model.fields.filter((f) => f.relation);
    const hasManyFields = relationFields.filter((f) => f.relation.kind === "one-to-many");
    const belongsToFields = relationFields.filter((f) => f.relation.kind === "one-to-one" && f.relation.isOwner);
    const hasOneFields = relationFields.filter((f) => f.relation.kind === "one-to-one" && !f.relation.isOwner);
    const fieldLines = primitiveFields.map((f) => renderField(f, enumNames));
    const belongsLines = belongsToFields.map((f) => renderBelongsTo(f, schema));
    const hasOneLines = hasOneFields.map((f) => renderHasOne(f));
    const hasManyLines = hasManyFields.map((f) => renderHasMany(f, model));
    const schemaBody = [
        ...fieldLines,
        ...belongsLines,
        ...hasOneLines,
        ...hasManyLines,
    ].join("\n");
    // Changeset
    const allCastFields = primitiveFields.map((f) => (0, utils_1.toSnakeCase)(f.columnName ?? f.name));
    const requiredFields = primitiveFields
        .filter((f) => !f.isOptional && !f.default)
        .map((f) => (0, utils_1.toSnakeCase)(f.columnName ?? f.name));
    const uniqueConstraints = primitiveFields
        .filter((f) => f.isUnique)
        .map((f) => `    |> unique_constraint(:${(0, utils_1.toSnakeCase)(f.columnName ?? f.name)})`);
    const compoundUniqueConstraints = model.compoundUniques.map((idx) => `    |> unique_constraint([:${idx.fields.map(utils_1.toSnakeCase).join(", :")}])`);
    const validations = renderValidations(primitiveFields, enumNames);
    const changesetPipeline = [
        `    |> cast(attrs, ${(0, utils_1.atomList)(allCastFields)})`,
        `    |> validate_required(${(0, utils_1.atomList)(requiredFields)})`,
        ...validations,
        ...uniqueConstraints,
        ...compoundUniqueConstraints,
    ].join("\n");
    const hasEnumsUsed = primitiveFields.some((f) => f.type.startsWith("Ecto.Enum:"));
    const enumAlias = hasEnumsUsed ? "\n  alias MyApp.Enums\n" : "";
    const timestampsLine = isJoinSchema ? "" : "    timestamps(type: :utc_datetime)\n";
    return trimLeading(`
defmodule MyApp.${model.name} do
  @moduledoc """
  Ecto schema for the \`${tableName}\` table.
  Auto-generated from Prisma model \`${model.name}\`.
  """

  use Ecto.Schema
  import Ecto.Changeset
${enumAlias}
${schemaPrefix}${pkAttr}  schema "${tableName}" do
${schemaBody}
${timestampsLine}  end

  @doc """
  Changeset for \`${model.name}\`.
  Cast fields: ${allCastFields.join(", ")}
  Required: ${requiredFields.join(", ")}
  """
  @spec changeset(t(), map()) :: Ecto.Changeset.t()
  def changeset(${varName}, attrs) do
    ${varName}
${changesetPipeline}
  end
end
`);
}
// ---------------------------------------------------------------------------
// Primary key attribute
// ---------------------------------------------------------------------------
function renderPrimaryKeyAttr(model, pkField) {
    if (model.compoundId && model.compoundId.length > 0) {
        return "  @primary_key false\n";
    }
    if (!pkField)
        return "";
    switch (pkField.idKind) {
        case "uuid":
            return "  @primary_key {:id, :binary_id, autogenerate: true}\n" +
                "  @foreign_key_type :binary_id\n";
        case "cuid":
        case "string":
            return "  @primary_key {:id, :string, autogenerate: false}\n";
        case "auto":
            return "  @primary_key {:id, :binary_id, autogenerate: true}\n" +
                "  @foreign_key_type :binary_id\n";
        case "autoincrement":
        default:
            return ""; // Ecto default
    }
}
// ---------------------------------------------------------------------------
// Field renderers
// ---------------------------------------------------------------------------
function renderField(field, enumNames) {
    const col = (0, utils_1.toSnakeCase)(field.columnName ?? field.name);
    const opts = [];
    // Enum type: use inline Ecto.Enum with atom values
    if (field.type.startsWith("Ecto.Enum:")) {
        const enumName = field.type.split(":")[1];
        const enumDef = `Ecto.Enum, values: MyApp.Enums.${enumName}.__enum_map__()`;
        return `    field :${col}, ${enumDef}`;
    }
    // @map source override (only when DB column name differs from Elixir atom)
    if (field.columnName && field.columnName !== col) {
        opts.push(`source: :${field.columnName}`);
    }
    // Default values (schema-level hints only; DB defaults live in migrations)
    if (field.default) {
        switch (field.default.kind) {
            case "literal":
                if (field.type === "Boolean")
                    opts.push(`default: ${field.default.value}`);
                else if (["Int", "BigInt", "Float", "Decimal"].includes(field.type))
                    opts.push(`default: ${field.default.value}`);
                else if (field.type === "String")
                    opts.push(`default: "${field.default.value}"`);
                break;
            default:
                break;
        }
    }
    // Redact sensitive fields by convention (passwords, secrets, tokens)
    const sensitiveNames = /password|secret|token|key|ssn|cvv|pin/i;
    if (sensitiveNames.test(field.name)) {
        opts.push("redact: true");
    }
    const ectoType = (0, utils_1.prismaTypeToEcto)(field.type);
    const optsStr = opts.length ? `, ${opts.join(", ")}` : "";
    return `    field :${col}, :${ectoType}${optsStr}`;
}
function renderBelongsTo(field, schema) {
    const assocName = (0, utils_1.toSnakeCase)(field.name);
    const module = `MyApp.${field.relation.relatedModel}`;
    const opts = [];
    // Non-standard FK column name
    if (field.relation.fields && field.relation.fields.length > 0) {
        const fkName = (0, utils_1.toSnakeCase)(field.relation.fields[0]);
        const expected = (0, utils_1.inferForeignKey)(field.name);
        if (fkName !== expected)
            opts.push(`foreign_key: :${fkName}`);
    }
    if (field.isOptional)
        opts.push("required: false");
    // Referential action hint as comment
    const refComment = buildRefActionComment(field.relation.onDelete, field.relation.onUpdate);
    // UUID FK type
    const relatedModel = schema.models.find(m => m.name === field.relation.relatedModel);
    const relPk = relatedModel?.fields.find(f => f.isId);
    if (relPk?.idKind === "uuid") {
        opts.push("type: :binary_id");
    }
    const optsStr = opts.length ? `, ${opts.join(", ")}` : "";
    const line = `    belongs_to :${assocName}, ${module}${optsStr}`;
    const nameComment = field.relation.name
        ? `    # Named relation: "${field.relation.name}"\n`
        : "";
    return `${nameComment}${refComment}${line}`;
}
function renderHasOne(field) {
    const assocName = (0, utils_1.toSnakeCase)(field.name);
    const module = `MyApp.${field.relation.relatedModel}`;
    const nameComment = field.relation.name
        ? `    # Named relation: "${field.relation.name}"\n`
        : "";
    const refComment = buildRefActionComment(field.relation.onDelete, field.relation.onUpdate);
    return `${nameComment}${refComment}    has_one :${assocName}, ${module}`;
}
function renderHasMany(field, model) {
    const assocName = (0, utils_1.toSnakeCase)(field.name);
    const module = `MyApp.${field.relation.relatedModel}`;
    const opts = [];
    const siblingsToSameModel = model.fields.filter((f) => f !== field &&
        f.relation?.kind === "one-to-many" &&
        f.relation.relatedModel === field.relation.relatedModel);
    if (siblingsToSameModel.length > 0) {
        opts.push(`foreign_key: :TODO_set_correct_fk`);
    }
    const optsStr = opts.length ? `, ${opts.join(", ")}` : "";
    const nameComment = field.relation.name
        ? `    # Named relation: "${field.relation.name}"\n`
        : "";
    const refComment = buildRefActionComment(field.relation.onDelete, field.relation.onUpdate);
    return `${nameComment}${refComment}    has_many :${assocName}, ${module}${optsStr}`;
}
function buildRefActionComment(onDelete, onUpdate) {
    const parts = [];
    if (onDelete && onDelete !== "NoAction")
        parts.push(`onDelete: ${onDelete}`);
    if (onUpdate && onUpdate !== "Cascade")
        parts.push(`onUpdate: ${onUpdate}`);
    return parts.length > 0 ? `    # Referential actions: ${parts.join(", ")}\n` : "";
}
// ---------------------------------------------------------------------------
// Validation generation
// ---------------------------------------------------------------------------
function renderValidations(fields, enumNames) {
    const lines = [];
    for (const field of fields) {
        const col = (0, utils_1.toSnakeCase)(field.columnName ?? field.name);
        if (field.type.startsWith("Ecto.Enum:")) {
            const enumName = field.type.split(":")[1];
            lines.push(`    |> validate_inclusion(:${col}, MyApp.Enums.${enumName}.__enum_map__())`);
        }
        if (field.type === "Boolean" && !field.isOptional) {
            lines.push(`    |> validate_inclusion(:${col}, [true, false])`);
        }
        // String length from @db.VarChar(n)
        if (field.nativeType) {
            const sizeMatch = /(?:VarChar|Char|varchar|char)\((\d+)\)/.exec(field.nativeType);
            if (sizeMatch) {
                lines.push(`    |> validate_length(:${col}, max: ${sizeMatch[1]})`);
            }
        }
    }
    return lines;
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function ensureDir(dir) {
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
}
function trimLeading(str) {
    return str.replace(/^\n/, "");
}
//# sourceMappingURL=ectoGenerator.js.map