/**
 * #2587 — a PostgREST-shaped client backed by real SQL.
 *
 * `loadAuthoritativeContentShare` and `refreshContentShareV1` talk to Supabase
 * through a small, very specific slice of the PostgREST builder. Every other
 * proof of this code path in the repository replaces that slice with a
 * hand-written object that RETURNS THE ANSWER — which is exactly why #2587 was
 * graded "latent" twice: a fake cannot disagree with the code that wrote it.
 *
 * This client implements the same builder surface but resolves every call
 * against a real database. The production module is unmodified and unaware.
 *
 * Deliberately narrow: it supports the operators the share path actually uses
 * and throws on anything else, so a future widening of the query cannot be
 * silently mis-modelled here.
 */
import { lit } from "./pgFixture.mjs";

/** events.brand_id -> brands.id. The one embed the share path performs. */
const EMBEDS = { events: { brands: { table: "brands", localKey: "brand_id", foreignKey: "id" } } };

const splitTopLevel = (text) => {
  const parts = []; let depth = 0; let current = "";
  for (const character of text) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) { parts.push(current); current = ""; continue; }
    current += character;
  }
  if (current.trim()) parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
};

class Builder {
  constructor(db, table) {
    this.db = db; this.table = table; this.columns = "*";
    this.filters = []; this.ordering = null; this.rowLimit = null; this.headOnly = false;
  }
  select(columns, options) { if (columns) this.columns = columns; this.headOnly = options?.head === true; return this; }
  eq(column, value) { this.filters.push(`${this.#ref(column)} = ${lit(value)}`); return this; }
  is(column, value) { this.filters.push(`${this.#ref(column)} IS ${value === null ? "NULL" : lit(value)}`); return this; }
  not(column, operator, value) {
    if (operator !== "is") throw new Error(`#2587 client: unsupported not(${operator})`);
    this.filters.push(`${this.#ref(column)} IS NOT ${value === null ? "NULL" : lit(value)}`); return this;
  }
  in(column, values) { this.filters.push(`${this.#ref(column)} IN (${values.map(lit).join(",")})`); return this; }
  gte(column, value) { this.filters.push(`${this.#ref(column)} >= ${lit(value)}`); return this; }
  order(column, options) { this.ordering = `${this.#ref(column)} ${options?.ascending === false ? "DESC" : "ASC"}`; return this; }
  limit(count) { this.rowLimit = count; return this; }
  update() { throw new Error("#2587 client: the gate proof must never mutate a link row"); }

  #ref(column) {
    if (!column.includes(".")) return `"${this.table}"."${column}"`;
    const [relation, field] = column.split(".");
    const embed = EMBEDS[this.table]?.[relation];
    if (!embed) throw new Error(`#2587 client: unknown embed filter ${column}`);
    return `(SELECT e."${field}" FROM "${embed.table}" e WHERE e."${embed.foreignKey}" = "${this.table}"."${embed.localKey}")`;
  }

  #projection() {
    if (this.columns === "*") return `"${this.table}".*`;
    return splitTopLevel(this.columns).map((piece) => {
      const embedded = /^([A-Za-z_][A-Za-z0-9_]*)(!inner)?\(([^)]*)\)$/.exec(piece);
      if (!embedded) return `"${this.table}"."${piece}"`;
      const [, relation, , inner] = embedded;
      const embed = EMBEDS[this.table]?.[relation];
      if (!embed) throw new Error(`#2587 client: unknown embed ${relation}`);
      const innerColumns = splitTopLevel(inner).map((column) => `e."${column}"`).join(", ");
      return `(SELECT to_jsonb(x) FROM (SELECT ${innerColumns} FROM "${embed.table}" e WHERE e."${embed.foreignKey}" = "${this.table}"."${embed.localKey}") x) AS "${relation}"`;
    }).join(", ");
  }

  #sql() {
    const inner = this.columns.includes("!inner")
      ? splitTopLevel(this.columns).filter((piece) => piece.includes("!inner")).map((piece) => {
        const relation = piece.split("!")[0];
        const embed = EMBEDS[this.table][relation];
        return `EXISTS (SELECT 1 FROM "${embed.table}" e WHERE e."${embed.foreignKey}" = "${this.table}"."${embed.localKey}")`;
      })
      : [];
    const where = [...this.filters, ...inner];
    return [
      `SELECT ${this.#projection()} FROM "${this.table}"`,
      where.length ? `WHERE ${where.join(" AND ")}` : "",
      this.ordering ? `ORDER BY ${this.ordering}` : "",
      this.rowLimit ? `LIMIT ${this.rowLimit}` : "",
    ].filter(Boolean).join(" ");
  }

  #rows() {
    this.db.reads.push({ table: this.table });
    return this.db.pg.rows(this.#sql());
  }

  async maybeSingle() {
    try { const rows = this.#rows(); return { data: rows.length ? rows[0] : null, error: null }; }
    catch (cause) { return { data: null, error: { message: String(cause) } }; }
  }
  then(resolve, reject) {
    try { resolve({ data: this.#rows(), error: null }); }
    catch (cause) { reject ? reject(cause) : resolve({ data: null, error: { message: String(cause) } }); }
  }
}

/** The mint RPC's positional argument order, as declared in the #1615 migration. */
const UPSERT_ARGUMENT_ORDER = [
  "p_entity_kind", "p_creator_principal", "p_source_key", "p_source_reference",
  "p_attribution", "p_facts", "p_media_identity", "p_destination_manifest",
];

export function createPgRestClient(pg) {
  const db = {
    pg,
    reads: [],
    rpcCalls: [],
    from(table) { return new Builder(db, table); },
    async rpc(name, args) {
      db.rpcCalls.push({ name, args });
      try {
        if (name === "issue_2489_address_withheld") {
          return { data: pg.scalar(`SELECT public.issue_2489_address_withheld(${lit(args.p_theme === null || args.p_theme === undefined ? null : JSON.stringify(args.p_theme))}::jsonb)`), error: null };
        }
        if (name === "pg_privileged_ticket_types_remaining" || name === "pg_privileged_event_tier_allin") {
          return { data: pg.rows(`SELECT * FROM public.${name}(${lit(args.p_event_id)}::uuid)`), error: null };
        }
        if (name === "upsert_content_share_version") {
          const positional = UPSERT_ARGUMENT_ORDER.map((key) => {
            const value = args[key];
            if (value === null || value === undefined) return "NULL";
            if (key === "p_entity_kind") return `${lit(value)}::text`;
            if (key === "p_creator_principal") return `${lit(value)}::uuid`;
            if (key === "p_source_key") return `${lit(value)}::text`;
            return `${lit(JSON.stringify(value))}::jsonb`;
          });
          return { data: pg.scalar(`SELECT public.upsert_content_share_version(${positional.join(", ")})`), error: null };
        }
        throw new Error(`#2587 client: unmodelled rpc ${name}`);
      } catch (cause) { return { data: null, error: { message: String(cause) } }; }
    },
  };
  return db;
}
