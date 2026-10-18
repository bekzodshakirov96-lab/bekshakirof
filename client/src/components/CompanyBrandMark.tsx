import { useState } from "react";
import { companyInitials } from "@shared/companyBranding";
import { cn } from "@/lib/utils";
export function CompanyBrandMark({
  name,
  logoUrl,
  className = "",
}: {
  name: string;
  logoUrl: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <div
      data-no-translit
      className={cn(
        "grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg border border-sidebar-border bg-primary text-xs font-bold text-primary-foreground",
        className
      )}
    >
      {logoUrl && failed !== logoUrl ? (
        <img
          src={logoUrl}
          alt={`${name} logotipi`}
          className="size-full object-contain"
          onError={() => setFailed(logoUrl)}
          referrerPolicy="no-referrer"
        />
      ) : (
        companyInitials(name)
      )}
    </div>
  );
}
