import helmet from "helmet";

/** Shared by the real platform server and its HTTP regression tests. */
export function platformHeaders(production: boolean) {
  return helmet({
    // Native SSO form POSTs need the document's Origin. Helmet's no-referrer
    // default makes it "null"; strict-origin discloses no path/query and
    // continues to suppress referrers on an HTTPS -> HTTP downgrade.
    referrerPolicy: { policy: "strict-origin" },
    contentSecurityPolicy: production
      ? { directives: { formAction: ["'self'", "https:"] } }
      : false,
    crossOriginEmbedderPolicy: false,
  });
}
