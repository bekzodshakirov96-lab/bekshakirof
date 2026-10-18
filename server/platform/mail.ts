import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { PlatformConfig } from "./config";

export type SendMail = (
  email: string,
  kind: "verify" | "reset",
  token: string
) => Promise<void>;
export function mailSender(config: PlatformConfig): SendMail {
  return async (email, kind, token) => {
    if (config.mail.mode === "disabled")
      throw new Error("Email delivery is disabled.");
    const link = `${config.origin}/platforma/${kind === "verify" ? "tasdiqlash" : "parol"}#${token}`;
    const subject =
      kind === "verify"
        ? "BiznesControl: emailingizni tasdiqlang"
        : "BiznesControl: parolni tiklash";
    if (config.mail.mode === "local") {
      await mkdir(path.dirname(config.mail.file), { recursive: true });
      await appendFile(
        config.mail.file,
        JSON.stringify({ email, subject, link, at: new Date().toISOString() }) +
          "\n",
        { mode: 0o600 }
      );
      return;
    }
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${config.mail.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: config.mail.from,
        to: [email],
        subject,
        text: `${subject}\n\n${link}\n\nHavola bir marta ishlatiladi. Bu amalni siz bajarmagan bo‘lsangiz, xatni e’tiborsiz qoldiring.`,
      }),
    });
    if (!response.ok) throw new Error("Verification delivery failed.");
  };
}
