// src/parser.ts
import * as fs from "fs";
import * as path from "path";
import {
  IndexOptions,
  ParsedSchema,
  PrismaDefault,
  PrismaEnum,
  PrismaEnumValue,
  PrismaField,
  PrismaIndex,
  PrismaModel,
  PrismaRelation,
  ReferentialAction,
} from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCALAR_TYPES = new Set([
  "String", "Int", "Float", "Boolean", "DateTime",
  "Json", "Decimal", "BigInt", "Bytes",
]);

const AUTO_TIMESTAMP_FIELDS = new Set(["createdAt", "updatedAt"]);

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function parsePrismaSchema(schemaPath: string): ParsedSchema {
  const resolved = path.resolve(schemaPath);

  if (!fs.existsSync(resolved)) {
    console.error(`\x1b[31mError: schema.prisma not found at: ${resolved}\x1b[0m`);
    console.warn(`\x1b[33mNote: Default path is ./prisma/schema.prisma\x1b[0m`);
    console.info(`\x1b[36mInfo: Run \`prisma-to-ecto convert <path>\` for a custom path\x1b[0m`);
    process.exit(1);
  }

  const raw = fs.readFileSync(resolved, "utf8");
  const source = stripComments(raw);

  const enums = parseEnums(source);
  const enumNames = new Set(enums.map((e) => e.name));
  const models = parseBlocks(source, enumNames, false);
  const views  = parseBlocks(source, enumNames, true);

  return { models: [...models, ...views], enums };
}

// ---------------------------------------------------------------------------
// Comment stripping
// ---------------------------------------------------------------------------

function stripComments(source: string): string {
  // Strip single-line comments but NOT doc comments (///)
  return source.replace(/(?<!\/)\/{2}(?!\/)([^\n]*)/g, "");
}

// ---------------------------------------------------------------------------
// Enum parsing
// ---------------------------------------------------------------------------

function parseEnums(source: string): PrismaEnum[] {
  const enums: PrismaEnum[] = [];
  const enumPattern = /enum\s+(\w+)\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = enumPattern.exec(source)) !== null) {
    const [, name, body] = m;

    // Parse @@schema if present
    const schemaMatch = /@@schema\("([^"]+)"\)/.exec(body);
    const dbSchema = schemaMatch ? schemaMatch[1] : undefined;

    // Parse each value line: VALUE @map("db_value")
    const values: PrismaEnumValue[] = [];
    for (const line of body.split(/[\n\s]+/).map(s => s.trim()).filter(Boolean)) {
      if (line.startsWith("@@") || line.startsWith("@")) continue;
      if (!line.match(/^\w+/)) continue;
      const mapMatch = /@map\("([^"]+)"\)/.exec(line);
      const rawName = line.split(/\s+/)[0];
      values.push({ name: rawName, dbValue: mapMatch ? mapMatch[1] : undefined });
    }

    enums.push({ name, values, dbSchema });
  }
  return enums;
}

// ---------------------------------------------------------------------------
// Model / View block parsing
// ---------------------------------------------------------------------------

function parseBlocks(source: string, enumNames: Set<string>, parseViews: boolean): PrismaModel[] {
  const blocks: PrismaModel[] = [];
  const keyword = parseViews ? "view" : "model";
  // Match keyword blocks. Closing } may be indented or at column 0.
  const pattern = new RegExp(`${keyword}\\s+(\\w+)\\s*\\{([\\s\\S]*?)(?:\\n[ \\t]*|\\s*)\\}`, "g");
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(source)) !== null) {
    const [, modelName, body] = m;
    blocks.push(parseModelBody(modelName, body, enumNames, parseViews));
  }
  return blocks;
}

function parseModelBody(
  name: string,
  body: string,
  enumNames: Set<string>,
  isView: boolean
): PrismaModel {
  const fkNames = collectForeignKeyNames(body);

  // Split body into individual field/attribute lines
  const rawLines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  const lines: string[] = [];
  for (const rawLine of rawLines) {
    lines.push(...splitFieldDeclarations(rawLine));
  }

  let tableName: string | undefined;
  let dbSchema: string | undefined;
  let compoundId: string[] | undefined;
  const compoundUniques: PrismaIndex[] = [];
  const indexes: PrismaIndex[] = [];
  const fulltextIndexes: PrismaIndex[] = [];
  const fields: PrismaField[] = [];

  for (const line of lines) {
    // @@map
    const mapMatch = /^@@map\("([^"]+)"\)/.exec(line);
    if (mapMatch) { tableName = mapMatch[1]; continue; }

    // @@schema
    const schemaMatch = /^@@schema\("([^"]+)"\)/.exec(line);
    if (schemaMatch) { dbSchema = schemaMatch[1]; continue; }

    // @@id
    const compIdMatch = /^@@id\(\[([^\]]+)\]/.exec(line);
    if (compIdMatch) { compoundId = splitList(compIdMatch[1]); continue; }

    // @@unique([...], options...)
    const compUniqueMatch = /^@@unique\(\[([^\]]+)\](.*)/.exec(line);
    if (compUniqueMatch) {
      compoundUniques.push({
        fields: splitList(compUniqueMatch[1]),
        options: parseIndexOptions(compUniqueMatch[2]),
      });
      continue;
    }

    // @@fulltext([...])
    const fulltextMatch = /^@@fulltext\(\[([^\]]+)\](.*)/.exec(line);
    if (fulltextMatch) {
      fulltextIndexes.push({
        fields: parseIndexFields(fulltextMatch[1]),
        options: { fulltext: true, ...parseIndexOptions(fulltextMatch[2]) },
      });
      continue;
    }

    // @@index([...], options...)
    const indexMatch = /^@@index\(\[([^\]]+)\](.*)/.exec(line);
    if (indexMatch) {
      indexes.push({
        fields: parseIndexFields(indexMatch[1]),
        options: parseIndexOptions(indexMatch[2]),
      });
      continue;
    }

    if (line.startsWith("@@")) continue;

    const field = parseFieldLine(line, fkNames, enumNames);
    if (field) fields.push(field);
  }

  return { name, tableName, dbSchema, isView, fields, compoundId, compoundUniques, indexes, fulltextIndexes };
}

// ---------------------------------------------------------------------------
// Index field parsing (handles sort annotations: field(sort: Desc))
// ---------------------------------------------------------------------------

function parseIndexFields(raw: string): string[] {
  // Strip sort/ops annotations: title(sort: Asc) -> title
  return raw.split(",").map(s => s.trim().replace(/\(.*\)/, "").trim()).filter(Boolean);
}

function parseIndexOptions(rest: string): IndexOptions {
  const opts: IndexOptions = {};
  if (!rest) return opts;

  const nameMatch = /map:\s*"([^"]+)"/.exec(rest);
  if (nameMatch) opts.name = nameMatch[1];

  const typeMatch = /type:\s*(\w+)/.exec(rest);
  if (typeMatch) opts.type = typeMatch[1];

  const clusteredMatch = /clustered:\s*(true|false)/.exec(rest);
  if (clusteredMatch) opts.clustered = clusteredMatch[1] === "true";

  const whereMatch = /where:\s*raw\("([^"]+)"\)/.exec(rest);
  if (whereMatch) opts.where = whereMatch[1];

  return opts;
}

// ---------------------------------------------------------------------------
// Field parsing
// ---------------------------------------------------------------------------

function parseFieldLine(
  line: string,
  fkNames: Set<string>,
  enumNames: Set<string>
): PrismaField | null {
  const lineRe = /^(\w+)\s+(\w+)(\?)?(\[\])?\s*(.*)?$/;
  const lm = lineRe.exec(line);
  if (!lm) return null;

  const [, fieldName, fieldType, optMark, arrMark, attrStr = ""] = lm;

  if (/@ignore\b/.test(attrStr)) return null;
  if (AUTO_TIMESTAMP_FIELDS.has(fieldName)) return null;

  const isOptional = !!optMark;
  const isArray = !!arrMark;
  const isScalar = SCALAR_TYPES.has(fieldType);
  const isEnum = enumNames.has(fieldType);
  const isId = /@id\b/.test(attrStr);
  const isUnique = /@unique\b/.test(attrStr);
  const isUpdatedAt = /@updatedAt\b/.test(attrStr);

  // @map("col_name")
  const mapM = /@map\("([^"]+)"\)/.exec(attrStr);
  const columnName = mapM ? mapM[1] : undefined;

  // @db.VarChar(n) / @db.Text / @db.BigInt etc
  const dbAnnotation = /@db\.(\w+)(?:\(([^)]*)\))?/.exec(attrStr);
  const nativeType = dbAnnotation
    ? dbAnnotation[1] + (dbAnnotation[2] ? `(${dbAnnotation[2]})` : "")
    : undefined;

  const defaultVal = parseDefault(attrStr, fieldType);

  let relation: PrismaRelation | undefined;
  if (!isScalar && !isEnum) {
    relation = parseRelation(fieldType, isArray, attrStr);
  }

  const isForeignKey = isScalar && fkNames.has(fieldName);

  const idKind: PrismaField["idKind"] = isId
    ? (defaultVal?.kind === "uuid" ? "uuid"
      : defaultVal?.kind === "cuid" ? "cuid"
      : defaultVal?.kind === "auto" ? "auto"
      : fieldType === "String" ? "string"
      : "autoincrement")
    : undefined;

  return {
    name: fieldName,
    type: isEnum ? `Ecto.Enum:${fieldType}` : fieldType,
    isScalar: isScalar || isEnum,
    isId,
    idKind,
    isUnique,
    isOptional,
    isArray,
    isUpdatedAt,
    isIgnored: false,
    isForeignKey,
    default: defaultVal,
    columnName,
    nativeType,
    relation,
  };
}

// ---------------------------------------------------------------------------
// @default(...) parsing — depth-counting paren walker
// ---------------------------------------------------------------------------

function parseDefault(attrStr: string, _fieldType: string): PrismaDefault | undefined {
  const atIndex = attrStr.indexOf("@default(");
  if (atIndex === -1) return undefined;
  const start = atIndex + "@default(".length;
  let depth = 1;
  let i = start;
  while (i < attrStr.length && depth > 0) {
    if (attrStr[i] === "(") depth++;
    else if (attrStr[i] === ")") depth--;
    if (depth > 0) i++;
  }
  const inner = attrStr.slice(start, i).trim();

  if (inner === "autoincrement()") return { kind: "autoincrement" };
  if (inner === "now()")           return { kind: "now" };
  if (inner === "uuid()")          return { kind: "uuid" };
  if (inner === "cuid()")          return { kind: "cuid" };
  if (inner === "auto()")          return { kind: "auto" };
  if (/^dbgenerated\(/.test(inner)) {
    const val = /^dbgenerated\("(.+)"\)$/.exec(inner)?.[1];
    return { kind: "dbgenerated", value: val };
  }
  if (inner.startsWith('"')) return { kind: "literal", value: inner.slice(1, -1) };
  return { kind: "literal", value: inner };
}

// ---------------------------------------------------------------------------
// @relation(...) parsing
// ---------------------------------------------------------------------------

function parseRelation(
  fieldType: string,
  isArray: boolean,
  attrStr: string
): PrismaRelation {
  // Named relation — can be first positional arg or name: "..."
  const nameMatch = /@relation\("([^"]+)"/.exec(attrStr) ??
                    /@relation\(name:\s*"([^"]+)"/.exec(attrStr);
  const relationName = nameMatch ? nameMatch[1] : undefined;

  const fieldsMatch = /fields:\s*\[([^\]]+)\]/.exec(attrStr);
  const fields = fieldsMatch ? splitList(fieldsMatch[1]) : undefined;

  const refsMatch = /references:\s*\[([^\]]+)\]/.exec(attrStr);
  const references = refsMatch ? splitList(refsMatch[1]) : undefined;

  const isOwner = !!fields;

  const onDeleteMatch = /onDelete:\s*(\w+)/.exec(attrStr);
  const onUpdateMatch = /onUpdate:\s*(\w+)/.exec(attrStr);
  const onDelete = onDeleteMatch ? onDeleteMatch[1] as ReferentialAction : undefined;
  const onUpdate = onUpdateMatch ? onUpdateMatch[1] as ReferentialAction : undefined;

  const kind: PrismaRelation["kind"] = isArray ? "one-to-many" : "one-to-one";

  return { kind, relatedModel: fieldType, fields, references, name: relationName, isOwner, onDelete, onUpdate };
}

// ---------------------------------------------------------------------------
// FK name collection — respects nested parens in @relation
// ---------------------------------------------------------------------------

function collectForeignKeyNames(body: string): Set<string> {
  const fkNames = new Set<string>();
  const relPattern = /@relation\([^)]*fields:\s*\[([^\]]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = relPattern.exec(body)) !== null) {
    splitList(m[1]).forEach((f) => fkNames.add(f));
  }
  return fkNames;
}

// ---------------------------------------------------------------------------
// Single-line model body splitter (paren/quote-aware)
// ---------------------------------------------------------------------------

function splitFieldDeclarations(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  const fieldStart = /^\w+\s+\w+/;
  if (!fieldStart.test(trimmed)) return [trimmed];

  const results: string[] = [];
  let current = "";
  let parenDepth = 0;
  let inString = false;
  let stringChar = "";
  let i = 0;

  while (i < trimmed.length) {
    const ch = trimmed[i];

    if (inString) {
      current += ch;
      if (ch === "\\" && i + 1 < trimmed.length) {
        current += trimmed[++i];
      } else if (ch === stringChar) {
        inString = false;
      }
      i++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
      current += ch;
      i++;
      continue;
    }

    if (ch === "(") { parenDepth++; current += ch; i++; continue; }
    if (ch === ")") { parenDepth--; current += ch; i++; continue; }

    if (parenDepth === 0 && (ch === " " || ch === "\t")) {
      const rest = trimmed.slice(i).trimStart();
      const nextField = /^(\w+)\s+(\w+)[\s\[\]?@]/.exec(rest);
      if (nextField && current.trim()) {
        const cur = current.trim();
        if (/^\w+\s+\w+/.test(cur)) {
          results.push(cur);
          current = "";
          i += (trimmed.slice(i).length - rest.length);
          continue;
        }
      }
    }

    current += ch;
    i++;
  }

  if (current.trim()) results.push(current.trim());
  return results.length > 0 ? results : [trimmed];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function splitList(str: string): string[] {
  return str.split(",").map((s) => s.trim()).filter(Boolean);
}