"use client";
// Site languages. English text is the key; lib/i18n-dict.ts holds the translations. Missing ones fall
// back to English. Everyone starts in English; once someone picks a language it is remembered in this
// browser (localStorage "ap_lang"). Learn guides stay in English.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DICT, type Lang } from "./i18n-dict";

export const LANGS: { id: Lang; short: string; name: string }[] = [
  { id: "en", short: "EN", name: "English" },
  { id: "zh", short: "中文", name: "中文" },
  { id: "ko", short: "KO", name: "한국어" },
  { id: "es", short: "ES", name: "Español" },
  { id: "tr", short: "TR", name: "Türkçe" },
  { id: "ru", short: "RU", name: "Русский" },
];

type Vars = Record<string, string | number>;
type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: (s: string, v?: Vars) => string };

const fill = (s: string, v?: Vars) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m)) : s);
const I18n = createContext<Ctx>({ lang: "en", setLang: () => {}, t: fill });

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("ap_lang") as Lang | null;
      if (saved && DICT[saved]) setLangState(saved);
    } catch {}
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : lang;
  }, [lang]);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem("ap_lang", l); } catch {}
  }, []);
  const t = useCallback((s: string, v?: Vars) => fill((lang !== "en" && DICT[lang]?.[s]) || s, v), [lang]);
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18n.Provider value={value}>{children}</I18n.Provider>;
}

export const useI18n = () => useContext(I18n);
export const useT = () => useContext(I18n).t;
