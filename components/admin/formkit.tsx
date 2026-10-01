"use client";
import { useEffect, useState } from "react";
import type { Lang } from "@/lib/competition/i18n";

/**
 * Shared parts of every printout (official forms, reports, question sheets):
 * the same header, fields, tables and footer as the printed forms F1–F4, in
 * one language at a time. The language comes from ?lang=th|en (Thai by
 * default) and can be switched on the page before printing.
 */
export function useFormLang(): [Lang, (l: Lang) => void] {
  const [lang, setLang] = useState<Lang>("th");
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("lang");
    if (p === "en" || p === "th") setLang(p);
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    const u = new URL(window.location.href);
    if (u.searchParams.get("lang") !== lang) {
      u.searchParams.set("lang", lang);
      window.history.replaceState(null, "", u.toString());
    }
  }, [lang]);
  return [lang, setLang];
}

export function Toolbar({ lang, setLang, children }: { lang: Lang; setLang: (l: Lang) => void; children?: React.ReactNode }) {
  const on = { background: "#111", color: "#fff", borderColor: "#111" };
  return (
    <div className="toolbar no-print">
      <button className="primary" onClick={() => window.print()}>🖨 {lang === "th" ? "พิมพ์ / บันทึกเป็น PDF" : "Print / Save as PDF"}</button>
      <span className="small" style={{ fontWeight: 600 }}>{lang === "th" ? "ภาษา" : "Language"}:</span>
      <button onClick={() => setLang("th")} aria-pressed={lang === "th"} style={lang === "th" ? on : undefined}>ภาษาไทย</button>
      <button onClick={() => setLang("en")} aria-pressed={lang === "en"} style={lang === "en" ? on : undefined}>English</button>
      {children}
    </div>
  );
}

export function FormHead({ code, title, sub, lang, badge }: { code: string; title: string; sub?: string; lang: Lang; badge?: string }) {
  return (
    <div className="fhead">
      <div>
        <div className="fbrand"><b>Samaggi</b> University Challenge</div>
        <h1 className="ftitle">{title}{sub ? <small>{sub}</small> : null}</h1>
      </div>
      <div style={{ textAlign: "right" }}>
        <span className="fcode">{code}</span>
        <div className="tiny muted" style={{ marginTop: 6 }}>{badge ?? (lang === "th" ? "เอกสารจากระบบ" : "System printout")}</div>
      </div>
    </div>
  );
}

export function FormFoot({ code, lang, check, note }: { code: string; lang: Lang; check?: string; note?: string }) {
  return (
    <div className="ffoot">
      <span>
        {code} · v2026-10 · {lang === "th" ? "พิมพ์จากระบบ" : "printed from the system"}
        {check ? (
          <>
            {" "}· {lang === "th" ? "รหัสตรวจสอบ" : "Check code"} <b className="code">{check}</b>
          </>
        ) : null}
      </span>
      <span>{note ?? (lang === "th" ? "แก้ไขโดยขีดฆ่าและลงชื่อย่อ" : "Strike through and initial corrections")}</span>
    </div>
  );
}

export function Field({ label, v, tall }: { label: string; v: React.ReactNode; tall?: boolean }) {
  return (
    <div className={tall ? "ffield tall" : "ffield"}>
      <span className="flabel">{label}</span>
      <div className="fval">{v}</div>
    </div>
  );
}

export function Th({ label, w }: { label: string; w: string }) {
  return <th style={{ width: w }}>{label}</th>;
}

export function Ck({ on, children }: { on: boolean; children: React.ReactNode }) {
  return <span className="fck"><i className={on ? "on" : undefined}>{on ? "✓" : ""}</i>{children}</span>;
}

export function Sigs({ items, lang }: { items: string[]; lang: Lang }) {
  const suffix = lang === "th" ? "(ลงนาม/เวลา)" : "(signature/time)";
  return (
    <div className={`fgrid g${Math.min(items.length, 4)}`}>
      {items.map((label) => (
        <Field key={label} label={`${label} ${suffix}`} v="" tall />
      ))}
    </div>
  );
}
