import Link from "next/link";
import { WELLNESS_HUB_PATH, type WellnessPageConfig } from "@/lib/wellnessSeo";

type WellnessCollectionNavProps = {
  activePath: string;
  collections: WellnessPageConfig[];
};

export default function WellnessCollectionNav({ activePath, collections }: WellnessCollectionNavProps) {
  const links = [
    { label: "Wellness Home", href: WELLNESS_HUB_PATH },
    ...collections.map((config) => ({ label: config.label, href: config.path })),
  ];

  return (
    <nav aria-label="Wellness collections" className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
      <div className="flex w-max gap-2 sm:w-auto sm:flex-wrap">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            aria-current={activePath === link.href ? "page" : undefined}
            className={`inline-flex min-h-10 shrink-0 items-center rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              activePath === link.href
                ? "bg-primary text-primary-foreground"
                : "bg-accent text-accent-foreground hover:bg-accent/80"
            }`}
          >
            {link.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
