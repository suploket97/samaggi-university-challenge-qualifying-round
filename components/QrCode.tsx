"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";

export function QrCode({ value, className }: { value: string; className?: string }) {
  const [svg, setSvg] = useState<string>("");
  useEffect(() => {
    let alive = true;
    QRCode.toString(value, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#0b0f1a", light: "#ffffff" } })
      .then((s: string) => alive && setSvg(s))
      .catch(() => setSvg(""));
    return () => {
      alive = false;
    };
  }, [value]);
  if (!svg) return <div className={className} />;
  return <div className={className} dangerouslySetInnerHTML={{ __html: svg }} />;
}
