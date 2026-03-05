// src/types.ts

export type PrismaScalarType =
  | "String"
  | "Int"
  | "Float"
  | "Boolean"
  | "DateTime"
  | "Json"
  | "Decimal"
  | "BigInt"
  | "Bytes";

export type RelationKind =
  | "one-to-one"
  | "one-to-many"
  | "many-to-many";

export type ReferentialAction =
  | "Cascade"
  | "Restrict"
  | "SetNull"
  | "SetDefault"
  | "NoAction";

/** Prisma referential action → Ecto migration on_delete/on_update atom */
export const REFERENTIAL_ACTION_MAP: Record<ReferentialAction, string> = {
  Cascade:    "delete_all",
  Restrict:   "restrict",
  SetNull:    "nilify_all",
  SetDefault: "nothing",
  NoAction:   "nothing",
};

export interface PrismaDefault {
  kind:
    | "autoincrement"
    | "uuid"
    | "cuid"
    | "auto"
    | "now"
    | "dbgenerated"
    | "literal";
  value?: string;
}

export interface PrismaRelation {
  kind: RelationKind;
  relatedModel: string;
  fields?: string[];
  references?: string[];
  name?: string;
  isOwner: boolean;
  onDelete?: ReferentialAction;
  onUpdate?: ReferentialAction;
}

export interface IndexOptions {
  name?: string;
  sort?: Record<string, "Asc" | "Desc">;
  type?: string;
  clustered?: boolean;
  where?: string;
  fulltext?: boolean;
}

export interface PrismaIndex {
  fields: string[];
  options: IndexOptions;
}

export interface PrismaField {
  name: string;
  type: string;
  isScalar: boolean;
  isId: boolean;
  idKind?: "autoincrement" | "uuid" | "cuid" | "string" | "auto";
  isUnique: boolean;
  isOptional: boolean;
  isArray: boolean;
  isUpdatedAt: boolean;
  isIgnored: boolean;
  isForeignKey: boolean;
  default?: PrismaDefault;
  columnName?: string;
  /** @db.VarChar(255) / @db.Text etc — raw native type hint */
  nativeType?: string;
  relation?: PrismaRelation;
}

export interface PrismaEnumValue {
  name: string;
  /** @map("db_value") override */
  dbValue?: string;
}

export interface PrismaEnum {
  name: string;
  values: PrismaEnumValue[];
  dbSchema?: string;
}

export interface PrismaModel {
  name: string;
  tableName?: string;
  dbSchema?: string;
  isView?: boolean;
  fields: PrismaField[];
  compoundId?: string[];
  compoundUniques: PrismaIndex[];
  indexes: PrismaIndex[];
  fulltextIndexes: PrismaIndex[];
}

export interface ParsedSchema {
  models: PrismaModel[];
  enums: PrismaEnum[];
}