import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import { Shield, Heart, TrendingUp, Users } from "lucide-react";

const reasons = [
  {
    icon: Heart,
    title: "Wealth meets wellness",
    description:
      "We address both the numbers and the feelings because stress and confusion are the real blockers, not math.",
  },
  {
    icon: Shield,
    title: "No jargon, no judgment",
    description:
      "Every guide is written in plain language for women who are just getting started or rebuilding their confidence.",
  },
  {
    icon: TrendingUp,
    title: "Action-first frameworks",
    description:
      "Checklists, templates, and trackers you actually use, not 200-page ebooks that collect dust.",
  },
  {
    icon: Users,
    title: "Built for Indian women",
    description:
      "SIP planning, salary-day rituals, and rupee-based calculators rooted in how money really works here.",
  },
];

const fadeUp = {
  hidden: { opacity: 0, y: 16, filter: "blur(4px)" },
  visible: { opacity: 1, y: 0, filter: "blur(0px)" },
};

const TrustSection = () => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, amount: 0.2 });

  return (
    <section className="bg-rose-soft py-20 md:py-28">
      <div className="container mx-auto">
        <motion.div
          ref={ref}
          initial="hidden"
          animate={isInView ? "visible" : "hidden"}
          transition={{ staggerChildren: 0.1 }}
        >
          <motion.div
            variants={fadeUp}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="mb-14 max-w-xl"
          >
            <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-primary">
              Why Pink Paisa
            </p>
            <h2 className="mb-4 font-serif text-3xl leading-tight md:text-4xl">
              More than money advice and a system you&apos;ll actually follow
            </h2>
          </motion.div>

          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {reasons.map((reason, i) => {
              const Icon = reason.icon;
              return (
                <motion.div
                  key={reason.title}
                  variants={fadeUp}
                  transition={{
                    duration: 0.6,
                    delay: i * 0.08,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                  className="group"
                >
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-card shadow-sm transition-shadow duration-200 group-hover:shadow-md">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="mb-2 text-lg font-semibold">{reason.title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {reason.description}
                  </p>
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      </div>
    </section>
  );
};

export default TrustSection;
