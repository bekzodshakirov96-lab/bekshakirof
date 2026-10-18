import { trpc } from "./trpc";
import {
  defaultCompanyPreferences,
  companyColumnLabel,
  companyCashLabel,
  type CompanyColumnKey,
  type CompanyModuleKey,
} from "@shared/companyPreferences";

export function useCompanyPreferences(date?: string) {
  const query = trpc.companyPreferences.get.useQuery(
    date ? { date } : undefined,
    { staleTime: 30_000 }
  );
  const preferences = query.data?.preferences ?? defaultCompanyPreferences();
  return {
    query,
    preferences,
    label: (key: CompanyColumnKey) => companyColumnLabel(preferences, key),
    cashLabel: (category: string) => companyCashLabel(preferences, category),
    visible: (key: CompanyModuleKey) =>
      !preferences.hiddenModules.includes(key),
  };
}
