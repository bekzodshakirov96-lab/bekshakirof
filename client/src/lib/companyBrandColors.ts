function rgb(hex: string) {
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
}
function mix(hex: string, target: string, amount: number) {
  return (
    "#" +
    rgb(hex)
      .map((value, i) =>
        Math.round(value * (1 - amount) + rgb(target)[i] * amount)
          .toString(16)
          .padStart(2, "0")
      )
      .join("")
  );
}
function luminance(hex: string) {
  const values = rgb(hex).map(v => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}
export function colorContrast(a: string, b: string) {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
export function contrastText(color: string) {
  return colorContrast(color, "#FFFFFF") >= colorContrast(color, "#000000")
    ? "#FFFFFF"
    : "#000000";
}
/** Brand accents/tints only. Financial success, warning and error colors retain
 * their existing semantics. No arbitrary CSS text can enter these properties. */
export function companyBrandVariables(
  color: string | null,
  dark: boolean,
  backgrounds: { light?: string | null; dark?: string | null } = {}
): Record<string, string> {
  const valid = (value: string | null | undefined): value is string =>
    !!value && /^#[0-9a-f]{6}$/i.test(value);
  const primary = valid(color) ? color : null;
  const selected = dark ? backgrounds.dark : backgrounds.light;
  const customBackground = valid(selected) ? selected : null;
  if (!primary && !customBackground) return {};
  // The chosen background is exact. Adapt nearby surfaces/text when the owner
  // picks e.g. black in light mode or white in dark mode, preserving legibility.
  const surfaceDark = customBackground
    ? contrastText(customBackground) === "#FFFFFF"
    : dark;
  const tint = primary ?? "#285BD4";
  const bg =
    customBackground ??
    (dark ? mix(tint, "#080D18", 0.95) : mix(tint, "#FFFFFF", 0.97));
  const standardFg = surfaceDark ? "#F1F5F9" : "#172033";
  const fg =
    colorContrast(bg, standardFg) >= 4.5 ? standardFg : contrastText(bg);
  const card = surfaceDark ? mix(tint, "#111827", 0.95) : "#FFFFFF";
  const secondary = surfaceDark
    ? mix(tint, "#182235", 0.88)
    : mix(tint, "#FFFFFF", 0.91);
  const border = surfaceDark
    ? mix(tint, "#334155", 0.8)
    : mix(tint, "#CCD5E0", 0.88);
  const standardMuted = surfaceDark ? "#ADBBCF" : "#536176";
  const muted = colorContrast(bg, standardMuted) >= 4.5 ? standardMuted : fg;
  const ring =
    colorContrast(tint, bg) >= 3
      ? tint
      : mix(tint, surfaceDark ? "#FFFFFF" : "#000000", 0.5);
  return {
    ...(primary
      ? {
          "--primary": primary,
          "--primary-foreground": contrastText(primary),
          "--company-sidebar-primary": primary,
          "--company-sidebar-primary-foreground": contrastText(primary),
        }
      : {}),
    "--ring": ring,
    "--background": bg,
    "--foreground": fg,
    "--card": card,
    "--card-foreground": fg,
    "--popover": card,
    "--popover-foreground": fg,
    "--secondary": secondary,
    "--secondary-foreground": fg,
    "--muted": secondary,
    "--muted-foreground": muted,
    "--accent": secondary,
    "--accent-foreground": fg,
    "--border": border,
    "--input": border,
    "--company-sidebar": surfaceDark
      ? mix(tint, "#060B14", 0.94)
      : mix(tint, "#FFFFFF", 0.93),
  };
}
