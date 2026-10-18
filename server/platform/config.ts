import { readBillingConfig, type BillingConfig } from "./billingConfig";
export type PlatformConfig = {
  billing?: BillingConfig;
  databaseUrl: string;
  origin: string;
  production: boolean;
  mail: {
    mode: "resend" | "local";
    apiKey: string;
    from: string;
    file: string;
  };
};

export function checkedOrigin(value: string, production: boolean): string {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Only a bare origin is allowed.");
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      !production &&
      ["localhost", "127.0.0.1"].includes(url.hostname)
    )
  ) {
    throw new Error(
      "HTTPS is required (loopback HTTP is allowed in development)."
    );
  }
  return url.origin;
}

export function readPlatformConfig(
  env: NodeJS.ProcessEnv = process.env
): PlatformConfig {
  const databaseUrl = env.PLATFORM_DATABASE_URL;
  if (!databaseUrl)
    throw new Error(
      "PLATFORM_DATABASE_URL is required; never use a company's DATABASE_URL."
    );
  const db = new URL(databaseUrl);
  if (!db.pathname.slice(1))
    throw new Error("A separate platform database is required.");
  if (env.DATABASE_URL) {
    const business = new URL(env.DATABASE_URL);
    if (
      db.hostname === business.hostname &&
      (db.port || "3306") === (business.port || "3306") &&
      db.pathname === business.pathname
    ) {
      throw new Error("The platform and business databases must be different.");
    }
  }
  const production = env.NODE_ENV === "production";
  const mode = env.PLATFORM_MAIL_MODE ?? "resend";
  if (mode !== "resend" && mode !== "local")
    throw new Error("Unknown mail mode.");
  if (production && mode === "local")
    throw new Error("Local email delivery is forbidden in production.");
  if (mode === "resend" && (!env.RESEND_API_KEY || !env.PLATFORM_MAIL_FROM))
    throw new Error(
      "Configure verification email delivery before opening registration."
    );
  return {
    billing: readBillingConfig(env, production),
    databaseUrl,
    production,
    origin: checkedOrigin(
      env.PLATFORM_ORIGIN ?? "http://localhost:4180",
      production
    ),
    mail: {
      mode,
      apiKey: env.RESEND_API_KEY ?? "",
      from: env.PLATFORM_MAIL_FROM ?? "",
      file: env.PLATFORM_MAIL_FILE ?? "data/platform-local-mail.jsonl",
    },
  };
}
