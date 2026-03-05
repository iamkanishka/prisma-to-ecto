#!/usr/bin/env node
"use strict";
// src/index.ts
Object.defineProperty(exports, "__esModule", { value: true });
const parser_1 = require("./parser");
const ectoGenerator_1 = require("./ectoGenerator");
const migrationGenerator_1 = require("./migrationGenerator");
// ---------------------------------------------------------------------------
// CLI config
// ---------------------------------------------------------------------------
const DEFAULT_SCHEMA_PATH = "./prisma/schema.prisma";
const DEFAULT_SCHEMA_OUT = "./prisma-to-ecto/schemas";
const DEFAULT_MIGRATION_OUT = "./prisma-to-ecto/migrations";
const HELP = `
\x1b[1mprisma-to-ecto\x1b[0m — Convert a Prisma schema to Ecto schemas and migrations

\x1b[1mUsage:\x1b[0m
  prisma-to-ecto convert [schema-path] [options]

\x1b[1mArguments:\x1b[0m
  schema-path          Path to schema.prisma (default: ./prisma/schema.prisma)

\x1b[1mOptions:\x1b[0m
  --schema-out <dir>   Output directory for Ecto schemas   (default: ./prisma-to-ecto/schemas)
  --migration-out <dir> Output directory for migrations    (default: ./prisma-to-ecto/migrations)
  --no-migrations      Skip migration generation
  --no-schemas         Skip schema generation
  --help, -h           Show this help message

\x1b[1mExamples:\x1b[0m
  prisma-to-ecto convert
  prisma-to-ecto convert ./db/schema.prisma
  prisma-to-ecto convert --schema-out lib/my_app --migration-out priv/repo/migrations
`.trimStart();
function parseArgs(argv) {
    const args = argv.slice(2); // strip node + script
    if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
        console.log(HELP);
        process.exit(0);
    }
    const command = args[0];
    if (command !== "convert") {
        console.error(`\x1b[31mUnknown command: "${command}"\x1b[0m`);
        console.error("Run `prisma-to-ecto --help` for usage.");
        process.exit(1);
    }
    const opts = {
        schemaPath: DEFAULT_SCHEMA_PATH,
        schemaOut: DEFAULT_SCHEMA_OUT,
        migrationOut: DEFAULT_MIGRATION_OUT,
        generateSchemas: true,
        generateMigrations: true,
    };
    let i = 1; // start after "convert"
    while (i < args.length) {
        const arg = args[i];
        if (arg === "--schema-out") {
            opts.schemaOut = args[++i] ?? DEFAULT_SCHEMA_OUT;
        }
        else if (arg === "--migration-out") {
            opts.migrationOut = args[++i] ?? DEFAULT_MIGRATION_OUT;
        }
        else if (arg === "--no-migrations") {
            opts.generateMigrations = false;
        }
        else if (arg === "--no-schemas") {
            opts.generateSchemas = false;
        }
        else if (!arg.startsWith("--")) {
            opts.schemaPath = arg;
        }
        else {
            console.warn(`\x1b[33mWarning: Unknown option "${arg}" — ignoring.\x1b[0m`);
        }
        i++;
    }
    return opts;
}
// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
    const opts = parseArgs(process.argv);
    if (!opts)
        return;
    console.log(`\n\x1b[1mprisma-to-ecto\x1b[0m`);
    console.log(`  Schema:    ${opts.schemaPath}`);
    if (opts.generateSchemas)
        console.log(`  Schemas →  ${opts.schemaOut}`);
    if (opts.generateMigrations)
        console.log(`  Migrations → ${opts.migrationOut}`);
    console.log();
    const schema = (0, parser_1.parsePrismaSchema)(opts.schemaPath);
    console.log(`\x1b[36mParsed ${schema.models.length} model(s), ${schema.enums.length} enum(s)\x1b[0m\n`);
    if (opts.generateSchemas) {
        console.log("Generating Ecto schemas...");
        (0, ectoGenerator_1.generateEctoSchema)(schema, opts.schemaOut);
        console.log();
    }
    if (opts.generateMigrations) {
        console.log("Generating migrations...");
        (0, migrationGenerator_1.generateMigrationFiles)(schema, opts.migrationOut);
        console.log();
    }
    console.log("\x1b[32m✓ Done!\x1b[0m\n");
}
main();
//# sourceMappingURL=index.js.map