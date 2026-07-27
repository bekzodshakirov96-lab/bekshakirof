import { getStoredLanguage, LANGUAGE_STORAGE_KEY as STORAGE_KEY, type Language } from "@/lib/languageStorage";
import { toCyrillic } from "@/lib/translit";
import { trpc } from "@/lib/trpc";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export type { Language };

/** Kuzatuv va o'girish tegmaydigan teglar. */
const IGNORED_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "CODE", "PRE"]);

/** Matn ko'rinadigan atributlar — ular ham o'giriladi. */
const TEXT_ATTRIBUTES = ["placeholder", "title", "aria-label"] as const;

type LanguageContextValue = {
  language: Language;
  setLanguage: (next: Language) => void;
};

const LanguageContext = createContext<LanguageContextValue>({ language: "latin", setLanguage: () => {} });

export function useLanguage() {
  return useContext(LanguageContext);
}

/**
 * Sahifadagi barcha matnni kirillga o'giradi.
 *
 * `toCyrillic` idempotent bo'lgani uchun (natijada lotin harf qolmaydi) bir xil
 * tugunni qayta ishlash uni o'zgartirmaydi — shu sabab MutationObserver cheksiz
 * siklga tushmaydi: qiymat o'zgarmasa, biz uni umuman yozmaymiz.
 */
function convertTree(root: Node) {
  const document = root.ownerDocument ?? (root as Document);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
      if (element && (IGNORED_TAGS.has(element.tagName) || element.closest("[data-no-translit]"))) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let current: Node | null = walker.currentNode;
  while (current) {
    if (current.nodeType === Node.TEXT_NODE) {
      const value = current.nodeValue;
      if (value) {
        const next = toCyrillic(value);
        if (next !== value) current.nodeValue = next;
      }
    } else if (current.nodeType === Node.ELEMENT_NODE) {
      const element = current as Element;
      for (const attribute of TEXT_ATTRIBUTES) {
        const value = element.getAttribute(attribute);
        if (value) {
          const next = toCyrillic(value);
          if (next !== value) element.setAttribute(attribute, next);
        }
      }
    }
    current = walker.nextNode();
  }
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery();
  const setLanguageMutation = trpc.auth.setLanguage.useMutation({
    onSuccess: () => utils.auth.me.invalidate(),
    // Kirishdan oldin (login ekranida) hisob yo'q — tanlov faqat brauzerda saqlanadi.
    onError: () => {},
  });
  // Brauzerda saqlangan tanlov darhol qo'llanadi — sahifa avval lotinda ko'rinib,
  // keyin sakrab kirillga o'tmasligi uchun.
  const [language, setLanguageState] = useState<Language>(getStoredLanguage);
  const observerRef = useRef<MutationObserver | null>(null);

  // Hisobdagi tanlov brauzerdagidan ustun — boshqa qurilmada kirganda ham o'sha holat.
  const accountLanguage = me.data?.language;
  useEffect(() => {
    if (accountLanguage && accountLanguage !== language) {
      setLanguageState(accountLanguage);
      window.localStorage.setItem(STORAGE_KEY, accountLanguage);
    }
    // language'ni bog'liqlikka qo'shmaymiz: bu faqat hisobdan kelgan qiymatni qo'llash uchun.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountLanguage]);

  const setLanguage = useCallback(
    (next: Language) => {
      setLanguageState(next);
      window.localStorage.setItem(STORAGE_KEY, next);
      // Lotinga qaytish DOM'ni orqaga o'gira olmaydi (o'girish bir tomonlama),
      // shuning uchun sahifani qayta yuklaymiz — React toza lotin matnini chizadi.
      if (next === "latin") {
        setLanguageMutation.mutate(
          { language: next },
          { onSettled: () => window.location.reload() },
        );
        return;
      }
      setLanguageMutation.mutate({ language: next });
    },
    [setLanguageMutation],
  );

  useEffect(() => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (language !== "cyrillic") return;

    convertTree(document.body);

    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") {
          const value = mutation.target.nodeValue;
          const parent = mutation.target.parentElement;
          if (!value || (parent && (IGNORED_TAGS.has(parent.tagName) || parent.closest("[data-no-translit]")))) continue;
          const next = toCyrillic(value);
          if (next !== value) mutation.target.nodeValue = next;
          continue;
        }
        if (mutation.type === "attributes" && mutation.target.nodeType === Node.ELEMENT_NODE) {
          const element = mutation.target as Element;
          const attribute = mutation.attributeName;
          if (!attribute || element.closest("[data-no-translit]")) continue;
          const value = element.getAttribute(attribute);
          if (!value) continue;
          const next = toCyrillic(value);
          if (next !== value) element.setAttribute(attribute, next);
          continue;
        }
        mutation.addedNodes.forEach(node => convertTree(node));
      }
    });

    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...TEXT_ATTRIBUTES],
    });
    observerRef.current = observer;
    return () => observer.disconnect();
  }, [language]);

  return <LanguageContext.Provider value={{ language, setLanguage }}>{children}</LanguageContext.Provider>;
}
