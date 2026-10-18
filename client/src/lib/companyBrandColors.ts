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
  dark: boolean
): Record<string, string> {
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return {};
  const fg = dark ? "#F1F5F9" : "#172033";
  const bg = dark ? mix(color, "#080D18", 0.95) : mix(color, "#FFFFFF", 0.97);
  const card = dark ? mix(color, "#111827", 0.95) : "#FFFFFF";
  const secondary = dark
    ? mix(color, "#182235", 0.88)
    : mix(color, "#FFFFFF", 0.91);
  const border = dark
    ? mix(color, "#334155", 0.8)
    : mix(color, "#CCD5E0", 0.88);
  const ring =
    colorContrast(color, bg) >= 3
      ? color
      : mix(color, dark ? "#FFFFFF" : "#000000", 0.5);
  return {
    "--primary": color,
    "--primary-foreground": contrastText(color),
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
    "--muted-foreground": dark ? "#ADBBCF" : "#536176",
    "--accent": secondary,
    "--accent-foreground": fg,
    "--border": border,
    "--input": border,
    "--company-sidebar": dark
      ? mix(color, "#060B14", 0.94)
      : mix(color, "#FFFFFF", 0.93),
    "--company-sidebar-primary": color,
    "--company-sidebar-primary-foreground": contrastText(color),
  };
}
