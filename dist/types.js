"use strict";
// src/types.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.REFERENTIAL_ACTION_MAP = void 0;
/** Prisma referential action → Ecto migration on_delete/on_update atom */
exports.REFERENTIAL_ACTION_MAP = {
    Cascade: "delete_all",
    Restrict: "restrict",
    SetNull: "nilify_all",
    SetDefault: "nothing",
    NoAction: "nothing",
};
//# sourceMappingURL=types.js.map