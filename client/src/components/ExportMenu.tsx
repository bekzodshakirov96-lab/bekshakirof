import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FileDown, FileSpreadsheet, FileText, Loader2 } from "lucide-react";

type ExportMenuProps = {
  onExcel: () => void | Promise<void>;
  onPdf: () => void | Promise<void>;
  isLoading?: boolean;
  disabled?: boolean;
};

export function ExportMenu({ onExcel, onPdf, isLoading = false, disabled = false }: ExportMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="gap-2 bg-card" disabled={disabled || isLoading}>
          {isLoading ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />}
          {isLoading ? "Tayyorlanmoqda..." : "Eksport"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Hisobot formatini tanlang</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="gap-3 py-2.5" onSelect={() => void onExcel()}>
          <span className="grid size-8 place-items-center rounded-lg bg-emerald-50 text-emerald-700">
            <FileSpreadsheet className="size-4" />
          </span>
          <span>
            <span className="block font-medium">Excel (.xlsx)</span>
            <span className="text-xs text-muted-foreground">Tahrirlash va tahlil qilish uchun</span>
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-3 py-2.5" onSelect={() => void onPdf()}>
          <span className="grid size-8 place-items-center rounded-lg bg-rose-50 text-rose-700">
            <FileText className="size-4" />
          </span>
          <span>
            <span className="block font-medium">PDF (.pdf)</span>
            <span className="text-xs text-muted-foreground">Chop etish va ulashish uchun</span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
