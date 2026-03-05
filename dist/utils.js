"use strict";
// src/utils.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.referentialActionToEcto = exports.inferForeignKey = exports.atomList = exports.indent = exports.prismaDefaultToMigration = exports.nativeTypeSize = exports.nativeTypeToMigration = exports.prismaTypeToMigration = exports.prismaTypeToEcto = exports.toVarName = exports.toTableName = exports.pluralize = exports.toSnakeCase = void 0;
/**
 * Convert camelCase or PascalCase to snake_case.
 * "UserProfile" -> "user_profile"
 * "createdAt"   -> "created_at"
 */
function toSnakeCase(str) {
    return str
        .replace(/([a-z])([A-Z])/g, "$1_$2")
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
        .toLowerCase();
}
exports.toSnakeCase = toSnakeCase;
/**
 * Pluralize a snake_case model name for use as a DB table.
 * Handles: -quiz -> -quizzes, -y -> -ies, -s/-sh/-ch/-x/-z -> -es, default +s
 * Non-pluralized suffixes: _types, _settings, _news (already plural concepts)
 */
function pluralize(word) {
    if (word.endsWith("_types") || word.endsWith("_settings") || word.endsWith("_news"))
        return word;
    if (/quiz$/.test(word))
        return word + "zes";
    if (/[^aeiou]y$/.test(word))
        return word.slice(0, -1) + "ies";
    if (/(s|sh|ch|x|z)$/.test(word))
        return word + "es";
    return word + "s";
}
exports.pluralize = pluralize;
/**
 * Convert a PascalCase model name to its Ecto table name.
 */
function toTableName(modelName, override) {
    if (override)
        return override;
    return pluralize(toSnakeCase(modelName));
}
exports.toTableName = toTableName;
/**
 * Convert a PascalCase model name to an Elixir variable name.
 */
function toVarName(modelName) {
    return toSnakeCase(modelName);
}
exports.toVarName = toVarName;
/**
 * Map Prisma scalar types to Ecto schema field types.
 */
function prismaTypeToEcto(prismaType) {
    switch (prismaType) {
        case "String": return "string";
        case "Int": return "integer";
        case "BigInt": return "integer"; // :integer in schema; :bigint in migrations
        case "Float": return "float";
        case "Decimal": return "decimal";
        case "Boolean": return "boolean";
        case "DateTime": return "utc_datetime";
        case "Json": return "map";
        case "Bytes": return "binary";
        default: return "string";
    }
}
exports.prismaTypeToEcto = prismaTypeToEcto;
/**
 * Map Prisma scalar types to Ecto migration column types.
 */
function prismaTypeToMigration(prismaType) {
    switch (prismaType) {
        case "String": return "string";
        case "Int": return "integer";
        case "BigInt": return "bigint";
        case "Float": return "float";
        case "Decimal": return "decimal";
        case "Boolean": return "boolean";
        case "DateTime": return "utc_datetime";
        case "Json": return "map";
        case "Bytes": return "binary";
        default: return "string";
    }
}
exports.prismaTypeToMigration = prismaTypeToMigration;
/**
 * Map a @db.* native type annotation to the most appropriate Ecto migration type.
 * Falls back to the Prisma scalar type mapping when unknown.
 */
function nativeTypeToMigration(nativeType, fallbackPrismaType) {
    const base = nativeType.replace(/\(.*\)/, "").toLowerCase();
    switch (base) {
        // String variants
        case "varchar": return "string";
        case "char": return "string";
        case "text": return "text";
        case "mediumtext": return "text";
        case "longtext": return "text";
        case "citext": return "string"; // case-insensitive text
        case "uuid": return "uuid";
        // Integer variants
        case "int":
        case "int2":
        case "int4":
        case "integer": return "integer";
        case "int8":
        case "bigint": return "bigint";
        case "smallint": return "integer";
        case "tinyint": return "integer";
        // Float variants
        case "float":
        case "float4":
        case "real": return "float";
        case "float8":
        case "doubleprecision": return "float";
        // Decimal
        case "decimal":
        case "numeric": return "decimal";
        // Boolean
        case "boolean":
        case "bool": return "boolean";
        // Date/time
        case "timestamp":
        case "timestamptz": return "utc_datetime";
        case "date": return "date";
        case "time": return "time";
        // Binary
        case "bytea":
        case "bytes":
        case "blob": return "binary";
        // JSON
        case "json":
        case "jsonb": return "map";
        // PostgreSQL extensions
        case "inet": return "string";
        case "cidr": return "string";
        case "macaddr": return "string";
        default: return prismaTypeToMigration(fallbackPrismaType);
    }
}
exports.nativeTypeToMigration = nativeTypeToMigration;
/**
 * When @db.VarChar(n) is present, return the column size limit string
 * like `, size: 255` for migrations.
 */
function nativeTypeSize(nativeType) {
    const m = /\((\d+)\)/.exec(nativeType);
    return m ? m[1] : undefined;
}
exports.nativeTypeSize = nativeTypeSize;
/**
 * Convert a Prisma @default value to an Ecto migration default expression.
 */
function prismaDefaultToMigration(def, prismaType) {
    switch (def.kind) {
        case "autoincrement":
            return undefined;
        case "now":
            return `fragment("now()")`;
        case "uuid":
            return `fragment("gen_random_uuid()")`;
        case "cuid":
            return undefined;
        case "auto":
            return undefined;
        case "dbgenerated":
            return def.value ? `fragment("${def.value}")` : undefined;
        case "literal":
            if (prismaType === "Boolean")
                return def.value === "true" ? "true" : "false";
            if (prismaType === "String")
                return `"${def.value}"`;
            if (!["Int", "BigInt", "Float", "Decimal"].includes(prismaType))
                return `"${def.value}"`; // Enum literals
            return def.value ?? undefined;
        default:
            return undefined;
    }
}
exports.prismaDefaultToMigration = prismaDefaultToMigration;
/**
 * Indent each line of a multi-line string by N spaces.
 */
function indent(str, spaces) {
    const pad = " ".repeat(spaces);
    return str
        .split("\n")
        .map((l) => (l.trim() ? pad + l : l))
        .join("\n");
}
exports.indent = indent;
/**
 * Wrap an array of strings as an Elixir list literal.
 * ["a", "b"] -> "[:a, :b]"
 */
function atomList(items) {
    return `[${items.map((i) => `:${i}`).join(", ")}]`;
}
exports.atomList = atomList;
/**
 * Derive the conventional FK field name from a relation field name.
 * "author" -> "author_id"
 */
function inferForeignKey(fieldName) {
    return `${toSnakeCase(fieldName)}_id`;
}
exports.inferForeignKey = inferForeignKey;
/**
 * Map a Prisma referential action to the Ecto on_delete/on_update atom.
 */
function referentialActionToEcto(action) {
    switch (action) {
        case "Cascade": return "delete_all";
        case "Restrict": return "restrict";
        case "SetNull": return "nilify_all";
        case "SetDefault": return "nothing";
        case "NoAction": return "nothing";
        default: return "nothing";
    }
}
exports.referentialActionToEcto = referentialActionToEcto;
//# sourceMappingURL=utils.js.map