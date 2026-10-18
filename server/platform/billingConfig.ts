import type { BillingMode } from "../../shared/billing";
export type BillingConfig = {
  mode: BillingMode;
  payme: { merchantId: string; key: string };
  click: {
    merchantId: string;
    serviceId: string;
    merchantUserId: string;
    key: string;
  };
};
export function readBillingConfig(
  env: NodeJS.ProcessEnv,
  production: boolean
): BillingConfig {
  const mode = env.PLATFORM_BILLING_MODE ?? "off";
  if (!["off", "test", "live"].includes(mode))
    throw new Error("Invalid billing mode.");
  if (mode === "live" && !production)
    throw new Error("Live billing requires production mode.");
  if (mode === "test" && production)
    throw new Error(
      "Test payments must use a separate non-production platform."
    );
  const payme = {
    merchantId: env.PAYME_MERCHANT_ID ?? "",
    key: env.PAYME_MERCHANT_KEY ?? "",
  };
  const click = {
    merchantId: env.CLICK_MERCHANT_ID ?? "",
    serviceId: env.CLICK_SERVICE_ID ?? "",
    merchantUserId: env.CLICK_MERCHANT_USER_ID ?? "",
    key: env.CLICK_SECRET_KEY ?? "",
  };
  if (payme.merchantId && !/^[a-zA-Z0-9_-]{1,100}$/.test(payme.merchantId))
    throw new Error("Invalid Payme merchant ID.");
  for (const value of [click.merchantId, click.serviceId, click.merchantUserId])
    if (value && !/^\d{1,20}$/.test(value))
      throw new Error("Invalid Click identifier.");
  return { mode: mode as BillingMode, payme, click };
}
export const billingOff = readBillingConfig({}, false);
export function readyProviders(config: BillingConfig) {
  return {
    payme:
      config.mode !== "off" && !!config.payme.merchantId && !!config.payme.key,
    click:
      config.mode !== "off" &&
      !!config.click.merchantId &&
      !!config.click.serviceId &&
      !!config.click.key,
  };
}
