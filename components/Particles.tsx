"use client";

/**
 * Floating metallic particles for win moments (qualification, final results).
 * Positions come from a fixed pseudo-random sequence so server and browser render the same markup.
 */
export function Particles({ tone = "gold", count = 36 }: { tone?: "gold" | "bronze"; count?: number }) {
  const color = tone === "gold" ? "255, 215, 0" : "205, 127, 50";
  let seed = tone === "gold" ? 7 : 13;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  return (
    <div className="particles" aria-hidden>
      {Array.from({ length: count }, (_, i) => {
        const size = 2 + rnd() * 5;
        return (
          <span
            key={i}
            style={{
              left: `${rnd() * 100}%`,
              width: size,
              height: size,
              background: `rgba(${color}, ${0.55 + rnd() * 0.45})`,
              boxShadow: `0 0 ${6 + size * 2}px rgba(${color}, 0.8)`,
              animationDuration: `${7 + rnd() * 9}s`,
              animationDelay: `${-rnd() * 14}s`,
              ["--drift" as string]: `${(rnd() - 0.5) * 120}px`,
            }}
          />
        );
      })}
    </div>
  );
}
