import Link from "next/link";

const cards = [
  { href: "/play", title: "Join a quiz", body: "On your phone. Enter the room code shown on the big screen.", cta: "Play", accent: "from-gold/25" },
  { href: "/stage", title: "Big screen", body: "For the projector or TV. Shows questions, timer and leaderboard.", cta: "Open stage", accent: "from-sky/20" },
  { href: "/admin", title: "Host", body: "Run the game, manage question packs and import from CSV or Excel.", cta: "Host login", accent: "from-panel-2" },
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col justify-center px-5 py-12">
      <h1 className="font-headline text-6xl md:text-8xl">
        <span className="text-gold">Samaggi</span> University Challenge
        <span className="mt-3 block font-sans text-base font-bold uppercase tracking-[0.3em] text-muted md:text-lg">Qualifying Round</span>
      </h1>
      <p className="mt-4 max-w-xl text-lg text-muted">Everyone plays the same question at the same time. Answers are sealed until the host reveals them.</p>
      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className={`group rounded-2xl border border-line bg-gradient-to-br ${c.accent} to-panel p-6 transition hover:-translate-y-1 hover:border-muted`}
          >
            <h2 className="font-headline text-3xl">{c.title}</h2>
            <p className="mt-2 text-muted">{c.body}</p>
            <span className="mt-6 inline-block font-semibold text-gold group-hover:underline">{c.cta} →</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
