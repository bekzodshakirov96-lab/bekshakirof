import {
  and,
  eq,
  getTableColumns,
  is,
  Column,
  Name,
  Param,
  Placeholder,
  SQL,
  StringChunk,
  Subquery,
} from "drizzle-orm";
import { MySqlDialect, MySqlTable } from "drizzle-orm/mysql-core";
import {
  MySql2Database,
  MySql2Session,
  type MySql2Client,
} from "drizzle-orm/mysql2";

const scopedSql = new WeakMap<SQL, string>();
export function markTenantSql(query: SQL, tenantId: string): SQL {
  scopedSql.set(query, tenantId);
  return query;
}
function column(table: MySqlTable) {
  const tenant = getTableColumns(table).tenantId;
  if (!tenant || tenant.name !== "tenant_id")
    throw new Error("Unscoped business table is forbidden.");
  return tenant;
}
export class TenantDialect extends MySqlDialect {
  constructor(readonly tenantId: string) {
    super();
    if (!/^[a-z][a-z0-9-]{1,62}$/.test(tenantId))
      throw new Error("A server-verified company ID is required.");
  }
  private source(source: unknown): SQL | undefined {
    if (is(source, MySqlTable)) return eq(column(source), this.tenantId);
    if (is(source, Subquery) && scopedSql.get(source._.sql) === this.tenantId)
      return undefined;
    throw new Error("Raw/unscoped FROM or JOIN sources are forbidden.");
  }
  private expression(value: unknown): void {
    if (
      is(value, Column) ||
      is(value, Param) ||
      is(value, Name) ||
      is(value, Placeholder)
    )
      return;
    if (is(value, StringChunk)) {
      if (
        /\b(select|from|join|union|with)\b|--|\/\*|;|#/i.test(
          value.value.join("")
        )
      )
        throw new Error(
          "Raw SQL statements/comments require an explicitly tenant-scoped implementation."
        );
      return;
    }
    if (is(value, SQL.Aliased)) {
      this.expression(value.sql);
      return;
    }
    if (is(value, SQL)) {
      const scope = scopedSql.get(value);
      if (scope) {
        if (scope !== this.tenantId)
          throw new Error("SQL expression belongs to another company.");
        return;
      }
      for (const chunk of value.queryChunks) {
        if (is(chunk, MySqlTable) || is(chunk, Subquery))
          throw new Error("Use an explicitly tenant-scoped subquery.");
        this.expression(chunk);
      }
    } else if (Array.isArray(value))
      value.forEach(item => this.expression(item));
    else if (value && typeof value === "object" && "getSQL" in value)
      throw new Error("Unknown SQL wrapper is not tenant-scoped.");
    else if (
      value &&
      typeof value === "object" &&
      Object.getPrototypeOf(value) === Object.prototype
    )
      Object.values(value).forEach(item => this.expression(item));
  }
  override buildSelectQuery(
    config: Parameters<MySqlDialect["buildSelectQuery"]>[0]
  ): SQL {
    if (config.withList?.length || config.setOperators?.length)
      throw new Error("CTE/union require an explicitly scoped implementation.");
    this.expression(config.fields);
    this.expression(config.where);
    this.expression(config.having);
    this.expression(config.orderBy);
    this.expression(config.groupBy);
    const joins = config.joins?.map(join => {
      if (join.joinType !== "left" && join.joinType !== "inner")
        throw new Error("Only tenant-scoped LEFT/INNER JOINs are supported.");
      this.expression(join.on);
      return { ...join, on: and(join.on, this.source(join.table)) };
    });
    return markTenantSql(
      super.buildSelectQuery({
        ...config,
        joins,
        where: and(config.where, this.source(config.table)),
      }),
      this.tenantId
    );
  }
  override buildUpdateSet(
    table: MySqlTable,
    set: Parameters<MySqlDialect["buildUpdateSet"]>[1]
  ): SQL {
    column(table);
    if (Object.hasOwn(set, "tenantId") || Object.hasOwn(set, "id"))
      throw new Error("Record ownership/ID cannot be changed.");
    this.expression(Object.values(set));
    return super.buildUpdateSet(table, set);
  }
  override buildUpdateQuery(
    config: Parameters<MySqlDialect["buildUpdateQuery"]>[0]
  ): SQL {
    if (config.withList?.length)
      throw new Error("Unscoped update CTE is forbidden.");
    this.expression(config.where);
    this.expression(config.orderBy);
    return super.buildUpdateQuery({
      ...config,
      where: and(config.where, this.source(config.table)),
    });
  }
  override buildDeleteQuery(
    config: Parameters<MySqlDialect["buildDeleteQuery"]>[0]
  ): SQL {
    if (config.withList?.length)
      throw new Error("Unscoped delete CTE is forbidden.");
    this.expression(config.where);
    this.expression(config.orderBy);
    return super.buildDeleteQuery({
      ...config,
      where: and(config.where, this.source(config.table)),
    });
  }
  override buildInsertQuery(
    config: Parameters<MySqlDialect["buildInsertQuery"]>[0]
  ) {
    const tenant = column(config.table);
    if (config.select || !Array.isArray(config.values))
      throw new Error(
        "INSERT SELECT requires an explicitly scoped implementation."
      );
    const columns = getTableColumns(config.table);
    const values = config.values.map(row => {
      if (
        row.tenantId &&
        (!is(row.tenantId, Param) || row.tenantId.value !== this.tenantId)
      )
        throw new Error("Cannot insert a record for another company.");
      if (columns.id?.primary && Object.hasOwn(row, "id"))
        throw new Error("Explicit business record IDs are not accepted.");
      this.expression(Object.values(row));
      return { ...row, tenantId: new Param(this.tenantId, tenant) };
    });
    return super.buildInsertQuery({ ...config, values });
  }
}

/** Hide raw SQL/client access. The dialect is shared by all nested transactions. */
function businessFacade<T extends object>(db: T): T {
  return new Proxy(db, {
    get(target, key, receiver) {
      if (
        [
          "execute",
          "$client",
          "session",
          "dialect",
          "query",
          "$with",
          "with",
          "$count",
        ].includes(String(key))
      )
        throw new Error(
          "Unscoped database access is forbidden in business code."
        );
      const value = Reflect.get(target, key, receiver);
      if (key === "transaction")
        return (callback: (tx: object) => unknown, ...args: unknown[]) =>
          Reflect.apply(value as (...args: unknown[]) => unknown, target, [
            (tx: object) => callback(businessFacade(tx)),
            ...args,
          ]);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
export function createTenantDatabase(client: MySql2Client, tenantId: string) {
  const dialect = new TenantDialect(tenantId);
  const session = new MySql2Session(client, dialect, undefined, {
    mode: "default",
  });
  return businessFacade(
    new MySql2Database(dialect, session, undefined, "default")
  );
}
