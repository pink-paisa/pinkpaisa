type WellnessSeoIntroProps = {
  eyebrow: string;
  title: string;
  description: string;
  concerns?: string[];
};

export default function WellnessSeoIntro({
  eyebrow,
  title,
  description,
  concerns = [],
}: WellnessSeoIntroProps) {
  return (
    <section className="border-b border-border bg-secondary/40">
      <div className="container mx-auto py-8 md:py-12">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary md:text-sm">
          {eyebrow}
        </p>
        <h1 className="max-w-4xl font-serif text-3xl leading-tight text-foreground md:text-5xl">
          {title}
        </h1>
        <p className="mt-4 max-w-3xl text-base leading-7 text-muted-foreground md:text-lg">
          {description}
        </p>
        {concerns.length ? (
          <div className="mt-6 flex flex-wrap gap-2">
            {concerns.map((concern) => (
              <span
                key={concern}
                className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground"
              >
                {concern}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
