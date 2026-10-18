import { useLayoutEffect } from "react";
import { trpc } from "./trpc";
import {
  defaultCompanyBranding,
  type CompanyBranding,
} from "@shared/companyBranding";
import { companyBrandVariables } from "./companyBrandColors";

export function useCompanyBranding() {
  const query = trpc.companyBranding.get.useQuery(undefined, {
    staleTime: 30_000,
  });
  return { query, branding: query.data?.branding ?? defaultCompanyBranding() };
}
export function useCompanyBrandTheme(
  branding: CompanyBranding,
  theme: "light" | "dark"
) {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const values = companyBrandVariables(branding.color, theme === "dark", {
      light: branding.backgroundLight,
      dark: branding.backgroundDark,
    });
    const previous = Object.fromEntries(
      Object.keys(values).map(key => [
        key,
        {
          value: root.style.getPropertyValue(key),
          priority: root.style.getPropertyPriority(key),
        },
      ])
    );
    for (const [key, value] of Object.entries(values))
      root.style.setProperty(key, value);
    return () => {
      for (const [key, prior] of Object.entries(previous)) {
        if (root.style.getPropertyValue(key) !== values[key]) continue;
        if (prior.value)
          root.style.setProperty(key, prior.value, prior.priority);
        else root.style.removeProperty(key);
      }
    };
  }, [
    branding.color,
    branding.backgroundLight,
    branding.backgroundDark,
    theme,
  ]);
  useLayoutEffect(() => {
    const old = document.title,
      title = `${branding.name} — Firma kabineti`;
    document.title = title;
    return () => {
      if (document.title === title) document.title = old;
    };
  }, [branding.name]);
}

/** Browser-normalized raster image; filenames, SVG and external URLs are never saved. */
export async function prepareCompanyLogo(file: File): Promise<string> {
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > 5 * 1024 * 1024
  )
    throw Error("5 MB gacha PNG, JPG yoki WebP rasm tanlang.");
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(Error("Rasmni o‘qib bo‘lmadi."));
    reader.readAsDataURL(file);
  });
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () =>
      reject(Error("Rasmni ochib bo‘lmadi. Boshqa rasm tanlang."));
    image.src = url;
  });
  if (
    !image.naturalWidth ||
    !image.naturalHeight ||
    image.naturalWidth * image.naturalHeight > 40_000_000
  )
    throw Error("Rasm o‘lchami juda katta.");
  const factor = Math.min(
    1,
    256 / Math.max(image.naturalWidth, image.naturalHeight)
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * factor));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * factor));
  const context = canvas.getContext("2d");
  if (!context) throw Error("Brauzerda rasm tayyorlash ishlamadi.");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png").split(",")[1];
}
