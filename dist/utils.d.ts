/**
 * Convert camelCase or PascalCase to snake_case.
 * "UserProfile" -> "user_profile"
 * "createdAt"   -> "created_at"
 */
export declare function toSnakeCase(str: string): string;
/**
 * Pluralize a snake_case model name for use as a DB table.
 * Handles: -quiz -> -quizzes, -y -> -ies, -s/-sh/-ch/-x/-z -> -es, default +s
 * Non-pluralized suffixes: _types, _settings, _news (already plural concepts)
 */
export declare function pluralize(word: string): string;
/**
 * Convert a PascalCase model name to its Ecto table name.
 */
export declare function toTableName(modelName: string, override?: string): string;
/**
 * Convert a PascalCase model name to an Elixir variable name.
 */
export declare function toVarName(modelName: string): string;
/**
 * Map Prisma scalar types to Ecto schema field types.
 */
export declare function prismaTypeToEcto(prismaType: string): string;
/**
 * Map Prisma scalar types to Ecto migration column types.
 */
export declare function prismaTypeToMigration(prismaType: string): string;
/**
 * Map a @db.* native type annotation to the most appropriate Ecto migration type.
 * Falls back to the Prisma scalar type mapping when unknown.
 */
export declare function nativeTypeToMigration(nativeType: string, fallbackPrismaType: string): string;
/**
 * When @db.VarChar(n) is present, return the column size limit string
 * like `, size: 255` for migrations.
 */
export declare function nativeTypeSize(nativeType: string): string | undefined;
/**
 * Convert a Prisma @default value to an Ecto migration default expression.
 */
export declare function prismaDefaultToMigration(def: {
    kind: string;
    value?: string;
}, prismaType: string): string | undefined;
/**
 * Indent each line of a multi-line string by N spaces.
 */
export declare function indent(str: string, spaces: number): string;
/**
 * Wrap an array of strings as an Elixir list literal.
 * ["a", "b"] -> "[:a, :b]"
 */
export declare function atomList(items: string[]): string;
/**
 * Derive the conventional FK field name from a relation field name.
 * "author" -> "author_id"
 */
export declare function inferForeignKey(fieldName: string): string;
/**
 * Map a Prisma referential action to the Ecto on_delete/on_update atom.
 */
export declare function referentialActionToEcto(action: string): string;
